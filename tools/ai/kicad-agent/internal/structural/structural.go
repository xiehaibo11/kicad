// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package structural implements a 2.5D structural check: footprint bounding
// boxes (pads and courtyard/graphic items) plus optional per-reference heights.
//
// It is not a mesh-level collision check.  It catches overlapping courtyards,
// obvious component-body overlaps, and missing height data; exact STEP mesh
// collision still requires an external tool (see external.step.check).
package structural

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type Dispatcher func(context.Context, string, map[string]any) (*backend.Result, error)

type Box struct {
	MinX, MinY, MaxX, MaxY int64
}

type Footprint struct {
	Reference   string  `json:"reference"`
	Side        string  `json:"side"`
	HeightMm    float64 `json:"heightMm"`
	HeightKnown bool    `json:"heightKnown"`
	Box         Box     `json:"box"`
}

type Finding struct {
	Type       string  `json:"type"`
	A          string  `json:"a"`
	B          string  `json:"b,omitempty"`
	OverlapMm2 float64 `json:"overlapMm2,omitempty"`
	VolumeMm3  float64 `json:"volumeMm3,omitempty"`
	Message    string  `json:"message"`
}

type Result struct {
	Footprints     []Footprint `json:"footprints"`
	Findings       []Finding   `json:"findings"`
	Step           string      `json:"step,omitempty"`
	MeshChecked    bool        `json:"meshChecked"`
	MeshCollisions int         `json:"meshCollisions"`
	Verified       bool        `json:"verified"`
	Note           string      `json:"note"`
}

func Run(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	document := p["document"]
	if document == nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "document is required"}
	}

	heights := map[string]float64{}
	if raw, ok := p["heights"].(map[string]any); ok {
		for ref, value := range raw {
			if f, ok := floatValue(value); ok {
				heights[ref] = f
			}
		}
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

	result := &Result{Verified: false,
		Note: "2.5D check: footprint bounding boxes + optional heights; use external.step.check for mesh collision"}
	result.Findings = []Finding{}

	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		ref := referenceOf(item)
		side := "front"
		if argString(item, "layer") == "BL_B_Cu" {
			side = "back"
		}

		box, ok := boundsOf(item)
		if !ok {
			result.Findings = append(result.Findings, Finding{
				Type: "geometry_unknown", A: ref,
				Message: "no usable pad or courtyard geometry; excluded from overlap checks",
			})
			continue
		}

		height, known := heights[ref]

		result.Footprints = append(result.Footprints, Footprint{
			Reference: ref, Side: side, HeightMm: height, HeightKnown: known, Box: box,
		})

		if !known {
			result.Findings = append(result.Findings, Finding{
				Type: "height_unknown", A: ref,
				Message: "no height supplied; pass heights[ref] = mm for a collision check",
			})
		}
	}

	sort.Slice(result.Footprints, func(i, j int) bool {
		return result.Footprints[i].Reference < result.Footprints[j].Reference
	})

	for i := 0; i < len(result.Footprints); i++ {
		for j := i + 1; j < len(result.Footprints); j++ {
			a, b := result.Footprints[i], result.Footprints[j]

			if a.Side != b.Side {
				continue
			}

			dx := minInt64(a.Box.MaxX, b.Box.MaxX) - maxInt64(a.Box.MinX, b.Box.MinX)
			dy := minInt64(a.Box.MaxY, b.Box.MaxY) - maxInt64(a.Box.MinY, b.Box.MinY)

			if dx <= 0 || dy <= 0 {
				continue
			}

			overlap := float64(dx) * float64(dy) / 1e12 // nm² -> mm²

			if a.HeightKnown && b.HeightKnown && a.HeightMm > 0 && b.HeightMm > 0 {
				result.Findings = append(result.Findings, Finding{
					Type: "physical_overlap", A: a.Reference, B: b.Reference,
					OverlapMm2: overlap,
					Message: fmt.Sprintf("body bounding boxes overlap by %.3f mm²; heights %.2f/%.2f mm",
						overlap, a.HeightMm, b.HeightMm),
				})
			} else {
				result.Findings = append(result.Findings, Finding{
					Type: "courtyard_overlap", A: a.Reference, B: b.Reference,
					OverlapMm2: overlap,
					Message:    fmt.Sprintf("courtyards overlap by %.3f mm² (height unknown)", overlap),
				})
			}
		}
	}

	if argBool(p, "exportStep") || argBool(p, "exactStep") {
		path := documentPath(document)

		if path == "" {
			result.Findings = append(result.Findings, Finding{
				Type: "step_export_failed", A: "STEP",
				Message: "document has no file path; save it before exporting STEP",
			})
		} else {
			// The export reads the file on disk; persist the live document first.
			if saveRes, saveErr := dispatch(ctx, "document.save", map[string]any{
				"document": document,
			}); saveErr != nil || saveRes == nil || !saveRes.OK {
				result.Findings = append(result.Findings, Finding{
					Type: "step_export_failed", A: "STEP",
					Message: "document could not be saved before STEP export",
				})
			} else {
				stepPath := strings.TrimSuffix(path, ".kicad_pcb") + ".step"
				if out := argString(p, "stepOutput"); out != "" {
					stepPath = out
				}

				stepRes, err := dispatch(ctx, "board.export.step", map[string]any{
					"input": path, "output": stepPath, "format": "step",
				})

				if err == nil && stepRes != nil && stepRes.OK {
					result.Step = stepPath

					if argBool(p, "exactStep") {
						meshRes, meshErr := dispatch(ctx, "external.step.meshcheck", map[string]any{
							"input":     stepPath,
							"timeoutMs": 900000,
						})
						mergeMeshResult(result, meshRes, meshErr)
					}
				} else {
					message := "STEP export failed"

					if err != nil {
						message += ": " + err.Error()
					} else if stepRes != nil && stepRes.Error != nil {
						message += ": " + stepRes.Error.Code + " " + stepRes.Error.Message
					}

					result.Findings = append(result.Findings, Finding{
						Type: "step_export_failed", A: "STEP", Message: message,
					})
				}
			}
		}
	}

	ok := true
	overlap := false

	for _, finding := range result.Findings {
		if finding.Type == "physical_overlap" || finding.Type == "courtyard_overlap" {
			ok = false
			overlap = true
		}
	}

	exactRequested := argBool(p, "exactStep")

	if (argBool(p, "exportStep") || exactRequested) && result.Step == "" {
		ok = false
	}
	if exactRequested && (!result.MeshChecked || result.MeshCollisions > 0) {
		ok = false
	}

	result.Verified = result.MeshChecked && result.MeshCollisions == 0

	out := &backend.Result{Action: "board.check.3d", OK: ok, Data: result}

	switch {
	case overlap:
		out.Error = &backend.Error{Code: "STRUCTURAL_OVERLAP",
			Message: "one or more footprint bounding boxes overlap"}
	case result.MeshCollisions > 0:
		out.Error = &backend.Error{Code: "STEP_COLLISION",
			Message: fmt.Sprintf("%d exact STEP solid collision(s)", result.MeshCollisions)}
	case exactRequested && !result.MeshChecked:
		out.Error = &backend.Error{Code: "STEPCHECK_FAILED",
			Message: "exact STEP collision check did not run"}
	case (argBool(p, "exportStep") || exactRequested) && result.Step == "":
		out.Error = &backend.Error{Code: "STEP_EXPORT_FAILED",
			Message: "STEP export was requested but did not produce a file"}
	}

	return out, nil
}

func mergeMeshResult(result *Result, res *backend.Result, err error) {
	if err != nil {
		result.Findings = append(result.Findings, Finding{
			Type: "step_check_failed", A: "STEP", Message: err.Error(),
		})
		return
	}
	if res == nil {
		result.Findings = append(result.Findings, Finding{
			Type: "step_check_failed", A: "STEP", Message: "empty mesh-check result",
		})
		return
	}

	data, _ := res.Data.(map[string]any)
	solids, hasSolids := numericOK(data["solids"])

	if hasSolids {
		result.MeshChecked = true
	}

	rawCollisions, _ := data["collisions"].([]any)

	for _, raw := range rawCollisions {
		collision, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		a, _ := collision["a"].(float64)
		b, _ := collision["b"].(float64)
		volume, _ := collision["volumeMm3"].(float64)

		result.MeshCollisions++
		result.Findings = append(result.Findings, Finding{
			Type:      "step_collision",
			A:         fmt.Sprintf("solid %d", int64(a)),
			B:         fmt.Sprintf("solid %d", int64(b)),
			VolumeMm3: volume,
			Message: fmt.Sprintf("STEP solids %d and %d overlap by %.6g mm³",
				int64(a), int64(b), volume),
		})
	}

	if res.Error != nil && res.Error.Code != "STEP_COLLISIONS" {
		result.Findings = append(result.Findings, Finding{
			Type: "step_check_failed", A: "STEP",
			Message: res.Error.Code + ": " + res.Error.Message,
		})
	}

	_ = solids
}

func documentPath(document any) string {
	switch doc := document.(type) {
	case string:
		return doc
	case map[string]any:
		return argString(doc, "path")
	}
	return ""
}

func isCourtyardLayer(layer string) bool {
	return strings.HasSuffix(layer, "_CrtYd")
}

// boundsOf computes a footprint bounding box from its pads and courtyard
// graphics.  Pad half-extents are rotated by the footprint and padstack angles;
// the pad position itself is already board-absolute.
func boundsOf(footprint map[string]any) (Box, bool) {
	var box Box
	valid := false

	add := func(x, y int64) {
		if !valid {
			box = Box{MinX: x, MinY: y, MaxX: x, MaxY: y}
			valid = true
			return
		}
		box.MinX = minInt64(box.MinX, x)
		box.MinY = minInt64(box.MinY, y)
		box.MaxX = maxInt64(box.MaxX, x)
		box.MaxY = maxInt64(box.MaxY, y)
	}

	addPoint := func(raw any) bool {
		point, ok := raw.(map[string]any)
		if !ok {
			return false
		}

		x, xok := numericOK(point["xNm"])
		y, yok := numericOK(point["yNm"])

		if !xok || !yok {
			return false
		}

		add(x, y)
		return true
	}

	definition, _ := footprint["definition"].(map[string]any)
	items, _ := definition["items"].([]any)

	fpAngle := angleOf(footprint["orientation"])

	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		typeName := argString(item, "@type")

		switch {
		case strings.HasSuffix(typeName, ".Pad"):
			pos, _ := item["position"].(map[string]any)
			x, y := numeric(pos["xNm"]), numeric(pos["yNm"])

			padStack, _ := item["padStack"].(map[string]any)
			theta := (fpAngle + angleOf(padStack["angle"])) * math.Pi / 180
			cosT, sinT := math.Abs(math.Cos(theta)), math.Abs(math.Sin(theta))

			var sx, sy int64

			if copperLayers, ok := padStack["copperLayers"].([]any); ok {
				for _, rawLayer := range copperLayers {
					layer, ok := rawLayer.(map[string]any)
					if !ok {
						continue
					}

					size, _ := layer["size"].(map[string]any)
					lsx, lsy := numeric(size["xNm"]), numeric(size["yNm"])

					if lsx > sx {
						sx = lsx
					}
					if lsy > sy {
						sy = lsy
					}

					// Padstack layer offsets are in the footprint frame.
					if offset, ok := layer["offset"].(map[string]any); ok {
						ox, oy := float64(numeric(offset["xNm"])), float64(numeric(offset["yNm"]))
						x += int64(math.Round(ox*math.Cos(theta) - oy*math.Sin(theta)))
						y += int64(math.Round(ox*math.Sin(theta) + oy*math.Cos(theta)))
					}
				}
			}

			hx := int64((float64(sx)*cosT + float64(sy)*sinT) / 2)
			hy := int64((float64(sx)*sinT + float64(sy)*cosT) / 2)

			add(x-hx, y-hy)
			add(x+hx, y+hy)

		case strings.HasSuffix(typeName, ".BoardGraphicShape"):
			layer := argString(item, "layer")

			if !isCourtyardLayer(layer) {
				continue
			}

			shape, _ := item["shape"].(map[string]any)

			if segment, ok := shape["segment"].(map[string]any); ok {
				addPoint(segment["start"])
				addPoint(segment["end"])
			}

			if rectangle, ok := shape["rectangle"].(map[string]any); ok {
				addPoint(rectangle["topLeft"])
				addPoint(rectangle["bottomRight"])
			}

			if arc, ok := shape["arc"].(map[string]any); ok {
				addPoint(arc["start"])
				addPoint(arc["mid"])
				addPoint(arc["end"])
			}

			if bezier, ok := shape["bezier"].(map[string]any); ok {
				for _, key := range []string{"start", "control1", "control2", "end"} {
					addPoint(bezier[key])
				}
			}

			if circle, ok := shape["circle"].(map[string]any); ok {
				center, _ := circle["center"].(map[string]any)
				radiusPoint, _ := circle["radiusPoint"].(map[string]any)
				cx, cy := numeric(center["xNm"]), numeric(center["yNm"])
				rx, ry := numeric(radiusPoint["xNm"]), numeric(radiusPoint["yNm"])
				radius := int64(math.Hypot(float64(rx-cx), float64(ry-cy)))

				if radius > 0 {
					add(cx-radius, cy-radius)
					add(cx+radius, cy+radius)
				}
			}

			for _, key := range []string{"ellipse", "ellipseArc"} {
				ellipse, ok := shape[key].(map[string]any)
				if !ok {
					continue
				}

				center, _ := ellipse["center"].(map[string]any)
				cx, cy := numeric(center["xNm"]), numeric(center["yNm"])
				major, _ := ellipse["majorRadius"].(map[string]any)
				minor, _ := ellipse["minorRadius"].(map[string]any)
				radius := maxInt64(numeric(major["valueNm"]), numeric(minor["valueNm"]))

				if radius > 0 {
					add(cx-radius, cy-radius)
					add(cx+radius, cy+radius)
				}
			}

			if polygon, ok := shape["polygon"].(map[string]any); ok {
				polys, _ := polygon["polygons"].([]any)

				for _, rawPoly := range polys {
					poly, ok := rawPoly.(map[string]any)
					if !ok {
						continue
					}

					outline, _ := poly["outline"].(map[string]any)
					nodes, _ := outline["nodes"].([]any)

					for _, rawNode := range nodes {
						node, ok := rawNode.(map[string]any)
						if !ok {
							continue
						}

						if point, ok := node["point"].(map[string]any); ok {
							addPoint(point)
						}

						if arc, ok := node["arc"].(map[string]any); ok {
							addPoint(arc["start"])
							addPoint(arc["mid"])
							addPoint(arc["end"])
						}
					}
				}
			}

		case strings.HasSuffix(typeName, ".BoardText"):
			text, _ := item["text"].(map[string]any)
			if !isCourtyardLayer(argString(item, "layer")) {
				continue
			}
			addPoint(text["position"])

		case strings.HasSuffix(typeName, ".BoardTextBox"):
			if !isCourtyardLayer(argString(item, "layer")) {
				continue
			}
			textbox, _ := item["textbox"].(map[string]any)
			addPoint(textbox["topLeft"])
			addPoint(textbox["bottomRight"])
		}
	}

	return box, valid
}

func angleOf(raw any) float64 {
	angle, ok := raw.(map[string]any)
	if !ok {
		return 0
	}
	return floatValueOr(angle["valueDegrees"], 0)
}

func floatValueOr(raw any, def float64) float64 {
	if value, ok := floatValue(raw); ok {
		return value
	}
	return def
}

func referenceOf(item map[string]any) string {
	field, _ := item["referenceField"].(map[string]any)
	fieldMsg, _ := field["text"].(map[string]any)

	if textMsg, ok := fieldMsg["text"].(map[string]any); ok {
		if value := argString(textMsg, "text"); value != "" {
			return value
		}
	}

	return argString(fieldMsg, "text")
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
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

func floatValue(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	}
	return 0, false
}

func numeric(v any) int64 {
	f, _ := numericOK(v)
	return f
}

func numericOK(v any) (int64, bool) {
	f, ok := floatValue(v)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	return int64(math.Round(f)), true
}
