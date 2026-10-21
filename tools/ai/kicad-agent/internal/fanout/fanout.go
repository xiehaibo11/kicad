// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package fanout implements a first-pass BGA fanout on top of the KiCad IPC
// item API.
//
// Two styles are supported:
//   - via-in-pad: a through via is placed at each ball center.
//   - dogbone:    a through via is offset outward from the package center and a
//     short escape track connects the ball to it.
//
// This is a deterministic, geometry-driven first pass.  It does not perform a
// full escape search, layer assignment, or current-capacity planning; those are
// reported as follow-up work rather than silently approximated.
package fanout

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type Dispatcher func(context.Context, string, map[string]any) (*backend.Result, error)

type Pad struct {
	Number      string
	Net         string
	Layer       string
	X, Y        int64
	SizeX       int64
	SizeY       int64
	HasPosition bool
}

type Result struct {
	Footprint   string   `json:"footprint"`
	Style       string   `json:"style"`
	PadCount    int      `json:"padCount"`
	ViaCount    int      `json:"viaCount"`
	TrackCount  int      `json:"trackCount"`
	Created     int      `json:"created"`
	Failed      int      `json:"failed"`
	Skipped     int      `json:"skipped"`
	SkipReasons []string `json:"skipReasons,omitempty"`
	DryRun      bool     `json:"dryRun"`
	Error       string   `json:"error,omitempty"`
}

func Run(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	document := p["document"]
	if document == nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "document is required"}
	}

	reference := argString(p, "reference")
	style := strings.ToLower(argString(p, "style"))
	if style == "" {
		style = "via-in-pad"
	}
	if style != "via-in-pad" && style != "dogbone" {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "style must be via-in-pad or dogbone"}
	}

	drillNm, err := mmToNmStrict(argFloatDefault(p, "drillMm", 0.2))
	if err != nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "drillMm: " + err.Error()}
	}
	diameterNm, err := mmToNmStrict(argFloatDefault(p, "diameterMm", 0.45))
	if err != nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "diameterMm: " + err.Error()}
	}
	clearanceNm, err := mmToNmStrict(argFloatDefault(p, "clearanceMm", 0.15))
	if err != nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "clearanceMm: " + err.Error()}
	}
	trackWidthNm, err := mmToNmStrict(argFloatDefault(p, "trackWidthMm", 0.1))
	if err != nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "trackWidthMm: " + err.Error()}
	}

	if drillNm <= 0 || diameterNm <= 0 || clearanceNm < 0 || trackWidthNm <= 0 {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "drill, diameter, and track width must be positive; clearance must not be negative"}
	}
	if drillNm >= diameterNm {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "drillMm must be smaller than diameterMm"}
	}

	// Fanout is a mutating operation; require an explicit opt-in.
	dryRun := true
	if raw, present := p["dryRun"]; present && raw != nil {
		value, ok := raw.(bool)
		if !ok {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "dryRun must be a boolean"}
		}
		dryRun = value
	}

	res, err := dispatch(ctx, "board.items.get", map[string]any{
		"document": document,
		"types":    []string{"KOT_PCB_FOOTPRINT"},
	})
	if err != nil {
		return nil, err
	}
	if res == nil || !res.OK {
		return nil, &backend.Error{Code: "GET_FOOTPRINTS_FAILED",
			Message: "failed to read board footprints"}
	}

	data, _ := res.Data.(map[string]any)
	items, _ := data["items"].([]any)

	footprint, fpRef, fpX, fpY, pads := selectFootprint(items, reference)

	if footprint == nil {
		return nil, &backend.Error{Code: "FOOTPRINT_NOT_FOUND",
			Message: fmt.Sprintf("footprint %q not found", reference)}
	}

	result := &Result{
		Footprint: fpRef,
		Style:     style,
		PadCount:  len(pads),
		DryRun:    dryRun,
	}

	var createItems []any
	var placedVias []Pad

	skip := func(reason string) {
		result.Skipped++
		if len(result.SkipReasons) < 50 {
			result.SkipReasons = append(result.SkipReasons, reason)
		}
	}

	for _, pad := range pads {
		if pad.Net == "" {
			skip("pad " + pad.Number + ": no net")
			continue
		}
		if !pad.HasPosition {
			skip("pad " + pad.Number + ": no position")
			continue
		}

		viaX, viaY := pad.X, pad.Y

		if style == "via-in-pad" {
			if !viaFits(pads, pad, pad.X, pad.Y, diameterNm, clearanceNm) {
				skip("pad " + pad.Number + ": via diameter + clearance exceeds the pad pitch")
				continue
			}
		} else {
			offset := float64(maxInt64(pad.SizeX, pad.SizeY))/2 +
				float64(diameterNm)/2 + float64(clearanceNm)

			dx := float64(pad.X - fpX)
			dy := float64(pad.Y - fpY)
			length := math.Hypot(dx, dy)

			if length < 1 {
				dx, dy, length = 1, 0, 1
			}

			base := math.Atan2(dy, dx)
			found := false

			// Try the radial escape and then the nearest 45-degree alternatives.
			for step := 0; step < 8 && !found; step++ {
				angle := base + float64(step)*math.Pi/4*directionSign(step)

				cx := pad.X + int64(math.Cos(angle)*offset)
				cy := pad.Y + int64(math.Sin(angle)*offset)

				if viaFits(pads, pad, cx, cy, diameterNm, clearanceNm) &&
					viasFit(placedVias, cx, cy, diameterNm, clearanceNm) {
					viaX, viaY = cx, cy
					found = true
				}
			}

			if !found {
				skip("pad " + pad.Number + ": no clear dog-bone escape direction")
				continue
			}
		}

		if !viasFit(placedVias, viaX, viaY, diameterNm, clearanceNm) {
			skip("pad " + pad.Number + ": via would collide with another fanout via")
			continue
		}

		placedVias = append(placedVias, Pad{Number: pad.Number, X: viaX, Y: viaY})

		via := map[string]any{
			"position": map[string]any{"x_nm": viaX, "y_nm": viaY},
			"net":      map[string]any{"name": pad.Net},
			"padStack": map[string]any{
				"type": "PST_NORMAL",
				"drill": map[string]any{
					"diameter":   map[string]any{"x_nm": drillNm, "y_nm": drillNm},
					"startLayer": "BL_F_Cu",
					"endLayer":   "BL_B_Cu",
					"shape":      "DS_CIRCLE",
				},
				"copperLayers": []any{
					map[string]any{
						"layer": "BL_F_Cu",
						"shape": "PSS_CIRCLE",
						"size":  map[string]any{"x_nm": diameterNm, "y_nm": diameterNm},
					},
				},
				"layers": []any{"BL_F_Cu", "BL_B_Cu"},
			},
		}

		createItems = append(createItems, map[string]any{"type": "via", "json": via})
		result.ViaCount++

		if style == "dogbone" {
			track := map[string]any{
				"start": map[string]any{"x_nm": pad.X, "y_nm": pad.Y},
				"end":   map[string]any{"x_nm": viaX, "y_nm": viaY},
				"width": map[string]any{"value_nm": trackWidthNm},
				"layer": pad.Layer,
				"net":   map[string]any{"name": pad.Net},
			}
			createItems = append(createItems, map[string]any{"type": "track", "json": track})
			result.TrackCount++
		}
	}

	if len(createItems) == 0 {
		out := &backend.Result{Action: "board.fanout.run", OK: false, Data: result}
		out.Error = &backend.Error{Code: "FANOUT_NO_VIAS",
			Message: "no vias could be placed; see skipReasons"}
		return out, nil
	}

	if dryRun {
		return &backend.Result{Action: "board.fanout.run", OK: true, Data: result}, nil
	}

	const chunkSize = 50

	for start := 0; start < len(createItems); start += chunkSize {
		end := start + chunkSize
		if end > len(createItems) {
			end = len(createItems)
		}

		chunk := createItems[start:end]

		createRes, err := dispatch(ctx, "board.items.create", map[string]any{
			"document": document,
			"items":    chunk,
		})

		if err != nil {
			result.Failed += len(chunk)
			result.Error = err.Error()
			continue
		}
		if createRes == nil || !createRes.OK {
			result.Failed += len(chunk)
			if createRes != nil && createRes.Error != nil {
				result.Error = createRes.Error.Code + ": " + createRes.Error.Message
			}
			continue
		}

		result.Created += len(chunk)
	}

	out := &backend.Result{Action: "board.fanout.run", OK: result.Failed == 0, Data: result}
	if result.Failed > 0 {
		out.Error = &backend.Error{Code: "FANOUT_PARTIAL",
			Message: fmt.Sprintf("%d item(s) failed to create", result.Failed)}
	}
	return out, nil
}

func selectFootprint(items []any, reference string) (map[string]any, string, int64, int64, []Pad) {
	var best map[string]any
	var bestRef string
	var bestX, bestY int64
	var bestPads []Pad

	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok || !strings.HasSuffix(argString(item, "@type"), ".FootprintInstance") {
			continue
		}

		ref := referenceOf(item)
		if reference != "" && !strings.EqualFold(ref, reference) {
			continue
		}

		pads := padsOf(item)

		if reference != "" || len(pads) > len(bestPads) {
			best = item
			bestRef = ref
			bestPads = pads
			pos, _ := item["position"].(map[string]any)
			bestX = numeric(pos["xNm"])
			bestY = numeric(pos["yNm"])

			if reference != "" {
				break
			}
		}
	}

	return best, bestRef, bestX, bestY, bestPads
}

func referenceOf(item map[string]any) string {
	// Referenced field layout: referenceField.text is a Field message whose
	// text field is a Text message containing the actual string.
	field, _ := item["referenceField"].(map[string]any)
	fieldMsg, _ := field["text"].(map[string]any)

	if textMsg, ok := fieldMsg["text"].(map[string]any); ok {
		if value := argString(textMsg, "text"); value != "" {
			return value
		}
	}

	return argString(fieldMsg, "text")
}

func padsOf(item map[string]any) []Pad {
	definition, _ := item["definition"].(map[string]any)
	items, _ := definition["items"].([]any)

	var pads []Pad

	for _, raw := range items {
		padItem, ok := raw.(map[string]any)
		if !ok || !strings.HasSuffix(argString(padItem, "@type"), ".Pad") {
			continue
		}

		pos, _ := padItem["position"].(map[string]any)
		padStack, _ := padItem["padStack"].(map[string]any)
		layers, _ := padStack["layers"].([]any)
		copperLayers, _ := padStack["copperLayers"].([]any)

		layer := "BL_F_Cu"
		for _, rawLayer := range layers {
			name, _ := rawLayer.(string)
			if strings.HasSuffix(name, "_Cu") {
				layer = name
				break
			}
		}

		var sizeX, sizeY int64
		if len(copperLayers) > 0 {
			if first, ok := copperLayers[0].(map[string]any); ok {
				if size, ok := first["size"].(map[string]any); ok {
					sizeX = numeric(size["xNm"])
					sizeY = numeric(size["yNm"])
				}
			}
		}

		net, _ := padItem["net"].(map[string]any)

		x, xok := numericOK(pos["xNm"])
		y, yok := numericOK(pos["yNm"])

		pads = append(pads, Pad{
			Number:      argString(padItem, "number"),
			Net:         argString(net, "name"),
			Layer:       layer,
			X:           x,
			Y:           y,
			SizeX:       sizeX,
			SizeY:       sizeY,
			HasPosition: xok && yok,
		})
	}

	return pads
}

// viaFits checks a candidate via centre against every other pad.
func viaFits(pads []Pad, own Pad, x, y, diameterNm, clearanceNm int64) bool {
	for _, other := range pads {
		if other.Number == own.Number || !other.HasPosition {
			continue
		}

		radius := maxInt64(other.SizeX, other.SizeY) / 2
		minDistance := diameterNm/2 + radius + clearanceNm
		dx := float64(x - other.X)
		dy := float64(y - other.Y)

		if math.Hypot(dx, dy) < float64(minDistance) {
			return false
		}
	}

	return true
}

func viasFit(vias []Pad, x, y, diameterNm, clearanceNm int64) bool {
	for _, via := range vias {
		dx := float64(x - via.X)
		dy := float64(y - via.Y)

		if math.Hypot(dx, dy) < float64(diameterNm+clearanceNm) {
			return false
		}
	}

	return true
}

func directionSign(step int) float64 {
	if step%2 == 0 {
		return 1
	}
	return -1
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func mmToNmStrict(mm float64) (int64, error) {
	if math.IsNaN(mm) || math.IsInf(mm, 0) {
		return 0, fmt.Errorf("must be a finite number")
	}
	if mm < 0 {
		return 0, fmt.Errorf("must not be negative")
	}
	if mm > 1e6 {
		return 0, fmt.Errorf("is unreasonably large")
	}
	return int64(math.Round(mm * 1_000_000)), nil
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

func argFloatDefault(p map[string]any, key string, def float64) float64 {
	switch v := p[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		f, err := strconv.ParseFloat(v, 64)
		if err == nil {
			return f
		}
	}
	return def
}

func numeric(v any) int64 {
	n, _ := numericOK(v)
	return n
}

func numericOK(v any) (int64, bool) {
	switch n := v.(type) {
	case float64:
		return int64(n), true
	case int64:
		return n, true
	case int:
		return int64(n), true
	case string:
		i, err := strconv.ParseInt(n, 10, 64)
		return i, err == nil
	}
	return 0, false
}
