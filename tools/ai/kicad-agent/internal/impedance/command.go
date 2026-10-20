// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package impedance

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type Dispatcher func(context.Context, string, map[string]any) (*backend.Result, error)

func RunAction(ctx context.Context, action string, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	switch action {
	case "board.impedance.layers", "board.impedance.calculate", "board.impedance.check":
	default:
		return nil, &backend.Error{Code: "UNKNOWN_ACTION", Message: action}
	}

	stackupJSON, err := loadStackup(ctx, p, dispatch)
	if err != nil {
		return nil, err
	}

	layers, err := LayersFromStackup(stackupJSON)
	if err != nil {
		return nil, &backend.Error{Code: "BAD_STACKUP", Message: err.Error()}
	}

	switch action {
	case "board.impedance.layers":
		return &backend.Result{Action: action, OK: true,
			Data: map[string]any{"layers": layers}}, nil

	case "board.impedance.calculate":
		return calculate(p, layers)

	case "board.impedance.check":
		return check(ctx, p, dispatch, layers)
	}

	return nil, &backend.Error{Code: "UNKNOWN_ACTION", Message: action}
}

func calculate(p map[string]any, layers []LayerInfo) (*backend.Result, error) {
	layerName := argString(p, "layer")
	if layerName == "" && len(layers) > 0 {
		layerName = layers[0].Name
	}

	layer, ok := FindLayer(layers, layerName)
	if !ok {
		return nil, &backend.Error{Code: "BAD_LAYER",
			Message: fmt.Sprintf("layer %q not found in stackup", layerName)}
	}

	target, hasTarget, err := argFloatStrict(p, "targetOhm")
	if err != nil {
		return nil, err
	}
	width, hasWidth, err := argFloatStrict(p, "widthMm")
	if err != nil {
		return nil, err
	}
	gap, hasGap, err := argFloatStrict(p, "gapMm")
	if err != nil {
		return nil, err
	}

	differential := argBool(p, "differential")

	if hasWidth && width <= 0 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "widthMm must be positive"}
	}
	if differential {
		if !hasGap || gap <= 0 {
			return nil, &backend.Error{Code: "BAD_INPUT",
				Message: "gapMm must be positive for a differential calculation"}
		}
		if !hasWidth && !hasTarget {
			return nil, &backend.Error{Code: "BAD_INPUT",
				Message: "provide widthMm or targetOhm"}
		}
	}

	synthesize := argBool(p, "synthesize") || !hasWidth

	if synthesize && (!hasTarget || target <= 0) {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "targetOhm is required when synthesizing a width"}
	}

	result, err := Analyze(Request{
		Layer:        layer,
		TargetOhm:    target,
		WidthMm:      width,
		GapMm:        gap,
		Differential: differential,
		Synthesize:   synthesize,
	})
	if err != nil {
		return nil, &backend.Error{Code: "IMPEDANCE_FAILED", Message: err.Error()}
	}

	return &backend.Result{Action: "board.impedance.calculate", OK: true, Data: result}, nil
}

type violation struct {
	Item       string  `json:"item,omitempty"`
	Net        string  `json:"net"`
	Layer      string  `json:"layer"`
	WidthMm    float64 `json:"widthMm"`
	ExpectedMm float64 `json:"expectedMm"`
	ErrorPct   float64 `json:"errorPct"`
	Start      string  `json:"start,omitempty"`
	End        string  `json:"end,omitempty"`
}

func check(ctx context.Context, p map[string]any, dispatch Dispatcher,
	layers []LayerInfo) (*backend.Result, error) {
	target, hasTarget, err := argFloatStrict(p, "targetOhm")
	if err != nil {
		return nil, err
	}
	if !hasTarget || target <= 0 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "targetOhm is required"}
	}

	gap, hasGap, err := argFloatStrict(p, "gapMm")
	if err != nil {
		return nil, err
	}

	differential := argBool(p, "differential")
	if differential && (!hasGap || gap <= 0) {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "gapMm must be positive for a differential check"}
	}

	tolerance, hasTolerance, err := argFloatStrict(p, "tolerancePct")
	if err != nil {
		return nil, err
	}
	if !hasTolerance {
		tolerance = 10
	} else if tolerance < 0 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "tolerancePct must not be negative"}
	}

	layerName := argString(p, "layer")

	document := p["document"]
	if document == nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "document is required"}
	}

	// Cache expected widths per layer.  A layer that cannot be synthesized is a
	// configuration error, not a silent skip.
	expected := map[string]float64{}

	addExpected := func(layer LayerInfo) error {
		width, err := SynthesizeWidth(layer, target, gap, differential)
		if err != nil {
			return fmt.Errorf("layer %s: %w", layer.Name, err)
		}
		expected[layer.Name] = width
		return nil
	}

	if layerName != "" {
		layer, ok := FindLayer(layers, layerName)
		if !ok {
			return nil, &backend.Error{Code: "BAD_LAYER",
				Message: fmt.Sprintf("layer %q not found in stackup", layerName)}
		}
		if err := addExpected(layer); err != nil {
			return nil, &backend.Error{Code: "BAD_LAYER", Message: err.Error()}
		}
	} else {
		for _, layer := range layers {
			if err := addExpected(layer); err != nil {
				return nil, &backend.Error{Code: "BAD_STACKUP", Message: err.Error()}
			}
		}
	}

	res, err := dispatch(ctx, "board.items.get", map[string]any{
		"document": document,
		"types":    []string{"KOT_PCB_TRACE", "KOT_PCB_ARC"},
	})
	if err != nil {
		return nil, err
	}
	if res == nil || !res.OK {
		return nil, &backend.Error{Code: "GET_ITEMS_FAILED",
			Message: "failed to read board tracks"}
	}

	data, _ := res.Data.(map[string]any)
	items, _ := data["items"].([]any)

	var violations []violation
	checked := 0
	skipped := 0

	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		width, ok := item["width"].(map[string]any)
		if !ok {
			skipped++
			continue
		}

		widthNm := numeric(width["valueNm"])
		if widthNm <= 0 {
			skipped++
			continue
		}

		itemLayer := displayName(argString(item, "layer"))

		if layerName != "" && !strings.EqualFold(itemLayer, layerName) {
			continue
		}

		expectedWidth, ok := expected[itemLayer]
		if !ok {
			skipped++
			continue
		}

		checked++

		actualWidth := widthNm / 1e6
		errorPct := (actualWidth - expectedWidth) / expectedWidth * 100

		if math.Abs(errorPct) <= tolerance {
			continue
		}

		net := ""
		if netObj, ok := item["net"].(map[string]any); ok {
			net, _ = netObj["name"].(string)
		}

		id := ""
		if idObj, ok := item["id"].(map[string]any); ok {
			id, _ = idObj["value"].(string)
		}

		violations = append(violations, violation{
			Item: id, Net: net, Layer: itemLayer, WidthMm: actualWidth,
			ExpectedMm: expectedWidth, ErrorPct: errorPct,
			Start: pointText(item["start"]), End: pointText(item["end"]),
		})
	}

	if violations == nil {
		violations = []violation{}
	}

	okResult := checked > 0 && len(violations) == 0

	res = &backend.Result{
		Action: "board.impedance.check",
		OK:     okResult,
		Data: map[string]any{
			"targetOhm": target, "tolerancePct": tolerance,
			"checkedTracks": checked, "skippedItems": skipped,
			"violations": violations, "expectedWidthsMm": expected,
		},
	}

	switch {
	case checked == 0:
		res.Error = &backend.Error{Code: "NO_TRACKS_CHECKED",
			Message: "no tracks on a stackup layer were available to check"}
	case len(violations) > 0:
		res.Error = &backend.Error{Code: "IMPEDANCE_VIOLATIONS",
			Message: fmt.Sprintf("%d track(s) outside the impedance tolerance", len(violations))}
	}

	return res, nil
}

func pointText(raw any) string {
	point, ok := raw.(map[string]any)
	if !ok {
		return ""
	}

	x, xok := numericStrict(point["xNm"])
	y, yok := numericStrict(point["yNm"])

	if !xok || !yok {
		return ""
	}

	return fmt.Sprintf("%.3f,%.3f", x/1e6, y/1e6)
}

func loadStackup(ctx context.Context, p map[string]any, dispatch Dispatcher) ([]byte, error) {
	if raw := p["stackup"]; raw != nil {
		switch v := raw.(type) {
		case string:
			if v == "-" {
				return os.ReadFile("/dev/stdin")
			}
			return os.ReadFile(v)
		case map[string]any:
			return json.Marshal(v)
		default:
			return json.Marshal(v)
		}
	}

	document := p["document"]
	if document == nil {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "provide stackup (file/inline) or document"}
	}

	res, err := dispatch(ctx, "board.stackup.read", map[string]any{"document": document})
	if err != nil {
		return nil, err
	}
	if res == nil || !res.OK {
		return nil, &backend.Error{Code: "STACKUP_READ_FAILED",
			Message: "failed to read board stackup"}
	}

	data, _ := res.Data.(map[string]any)
	stackup, ok := data["stackup"]
	if !ok {
		return nil, &backend.Error{Code: "STACKUP_READ_FAILED",
			Message: "stackup response is missing the stackup field"}
	}

	return json.Marshal(stackup)
}

func displayName(protoName string) string {
	protoName = strings.TrimPrefix(protoName, "BL_")
	return strings.ReplaceAll(protoName, "_", ".")
}

func numeric(v any) float64 {
	f, _ := numericStrict(v)
	return f
}

func numericStrict(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int64:
		return float64(n), true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	case string:
		if i, err := strconv.ParseInt(strings.TrimSpace(n), 10, 64); err == nil {
			return float64(i), true
		}
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f, err == nil
	}
	return 0, false
}

func argString(p map[string]any, key string) string {
	if v, ok := p[key].(string); ok {
		return v
	}
	return ""
}

func argBool(p map[string]any, key string) bool {
	if v, ok := p[key].(bool); ok {
		return v
	}
	return false
}

// argFloatStrict distinguishes "not supplied" from "supplied but invalid".
func argFloatStrict(p map[string]any, key string) (float64, bool, error) {
	raw, present := p[key]
	if !present || raw == nil {
		return 0, false, nil
	}

	f, ok := numericStrict(raw)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, true, &backend.Error{Code: "BAD_INPUT",
			Message: fmt.Sprintf("%s must be a finite number", key)}
	}

	return f, true, nil
}
