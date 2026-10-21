// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"fmt"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// planeBuild creates a net-bound plane zone on the requested copper layers,
// fills it, and proves it is real copper that connects the net: filled
// polygons on every layer (PlaneInfo.has_filled_polygons), no unconnected
// pads or vias of the net, and a zone-aware connectivity proof.  A plane that
// fails verification is removed unless keepOnFailure is set, so a false
// "poured" result can never be left behind silently.
func planeBuild(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.plane.build"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	net := argString(p, "net")
	layers := argStrings(p, "layers")
	if net == "" || len(layers) == 0 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "net and layers[] are required"}
	}
	result := map[string]any{"net": net, "layers": layers, "steps": []string{}}
	step := func(s string) { result["steps"] = append(result["steps"].([]string), s) }

	if t := strings.ToLower(argString(p, "layerType")); t != "" {
		types := map[string]any{}
		for _, l := range layers {
			if strings.HasSuffix(l, ".Cu") && l != "F.Cu" && l != "B.Cu" {
				types[l] = t
			}
		}
		if len(types) > 0 {
			res, err := layerTypeSet(ctx, map[string]any{"document": doc, "layers": types,
				"saveFirst": argBool(p, "saveFirst", false)}, dispatch)
			if err != nil {
				return nil, err
			}
			result["layerType"] = res.Data
			if !res.OK {
				return fail(action, res.Error.Code, "layer type: "+res.Error.Message, result), nil
			}
			step("set inner layer type to " + t)
		}
	}

	create := map[string]any{"document": doc, "net": net, "layers": layers, "fill": true,
		"name": argString(p, "name")}
	if raw, ok := p["outline"]; ok {
		create["outline"] = raw
	}
	if v := argFloat(p, "clearanceMm", 0); v > 0 {
		create["clearanceNm"] = float64(mmToNm(v))
	}
	if v := argFloat(p, "minThicknessMm", 0); v > 0 {
		create["minThicknessNm"] = float64(mmToNm(v))
	}
	if v := argFloat(p, "priority", 0); v > 0 {
		create["priority"] = v
	}
	data, _, err := call(ctx, dispatch, "board.plane.create", create)
	if err != nil {
		return fail(action, "PLANE_CREATE_FAILED", err.Error(), result), nil
	}
	plane, _ := data["plane"].(map[string]any)
	zoneID := ""
	if z, ok := plane["zone"].(map[string]any); ok {
		zoneID = argString(z, "value")
	}
	result["zone"] = zoneID
	result["created"] = plane
	step("created and filled zone " + zoneID)
	if zoneID == "" {
		return fail(action, "PLANE_CREATE_FAILED", "KiCad returned no zone id", result), nil
	}

	var problems []string
	verify, vres, verr := call(ctx, dispatch, "board.plane.verify", map[string]any{"document": doc, "zone": zoneID})
	if vres != nil {
		result["verify"] = vres.Data
		verify = toMap(vres.Data)
	}
	if pi, ok := verify["plane"].(map[string]any); ok {
		if v, _ := pi["hasFilledPolygons"].(bool); !v {
			problems = append(problems, "zone has no filled copper on at least one layer")
		}
	} else if verr != nil {
		problems = append(problems, verr.Error())
	}
	if verr != nil && len(problems) == 0 {
		problems = append(problems, verr.Error())
	}
	step("verified materialized fill")

	proof, pres, perr := call(ctx, dispatch, "board.connectivity.prove", map[string]any{
		"document": doc, "nets": []string{net}, "requireFilledZones": true})
	if pres != nil {
		result["connectivity"] = pres.Data
	}
	if perr != nil {
		problems = append(problems, perr.Error())
	} else if !argBool(proof, "ok", true) {
		problems = append(problems, "connectivity proof failed")
	}
	step("proved net connectivity through zones")

	if len(problems) == 0 {
		result["verified"] = true
		return ok(action, result), nil
	}
	result["problems"] = problems
	if !argBool(p, "keepOnFailure", false) {
		if _, _, err := call(ctx, dispatch, "board.items.delete", map[string]any{"document": doc, "ids": []string{zoneID}}); err == nil {
			result["rolledBack"] = true
			step("removed unverified zone (keepOnFailure=false)")
		} else {
			result["rollbackError"] = err.Error()
		}
	}
	return fail(action, "PLANE_UNVERIFIED", fmt.Sprintf("plane for %s did not verify: %s", net,
		strings.Join(problems, "; ")), result), nil
}
