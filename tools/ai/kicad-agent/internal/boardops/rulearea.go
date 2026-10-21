// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"fmt"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// copperLayers returns the board's enabled copper layers as proto enum names.
func copperLayers(ctx context.Context, dispatch Dispatcher, doc any) ([]string, error) {
	data, _, err := call(ctx, dispatch, "board.layers.get", map[string]any{"document": doc})
	if err != nil {
		return nil, err
	}
	var out []string
	list, _ := data["layers"].([]any)
	for _, raw := range list {
		if s, ok := raw.(string); ok && strings.HasSuffix(s, "_Cu") {
			out = append(out, s)
		}
	}
	return out, nil
}

// regionBox resolves the area for a rule area: explicit outline points, a
// box, or the bounding box of a footprint (or some of its pads) plus margin.
func regionBox(ctx context.Context, p map[string]any, dispatch Dispatcher, doc any) ([]any, map[string]any, error) {
	info := map[string]any{}
	if raw, ok := p["outline"].([]any); ok && len(raw) >= 3 {
		var pts []any
		for _, r := range raw {
			m, _ := r.(map[string]any)
			if m == nil {
				return nil, nil, &backend.Error{Code: "BAD_INPUT", Message: "outline points must be {xMm,yMm}"}
			}
			if hasKey(m, "xMm") {
				pts = append(pts, map[string]any{"xNm": mmToNm(argFloat(m, "xMm", 0)), "yNm": mmToNm(argFloat(m, "yMm", 0))})
			} else {
				pts = append(pts, map[string]any{"xNm": num(m["xNm"]), "yNm": num(m["yNm"])})
			}
		}
		info["source"] = "outline"
		return pts, info, nil
	}
	if b, ok := p["box"].(map[string]any); ok {
		bx := box{mmToNm(argFloat(b, "x1Mm", 0)), mmToNm(argFloat(b, "y1Mm", 0)),
			mmToNm(argFloat(b, "x2Mm", 0)), mmToNm(argFloat(b, "y2Mm", 0))}
		if bx.MinX > bx.MaxX {
			bx.MinX, bx.MaxX = bx.MaxX, bx.MinX
		}
		if bx.MinY > bx.MaxY {
			bx.MinY, bx.MaxY = bx.MaxY, bx.MinY
		}
		if !bx.valid() {
			return nil, nil, &backend.Error{Code: "BAD_INPUT", Message: "box needs x1Mm,y1Mm,x2Mm,y2Mm with non-zero size"}
		}
		info["source"] = "box"
		return bx.outline(), info, nil
	}
	ref := argString(p, "reference")
	if ref == "" {
		return nil, nil, &backend.Error{Code: "BAD_INPUT",
			Message: "give outline[] (>=3 points), box {x1Mm,y1Mm,x2Mm,y2Mm} or reference (+ marginMm, pads[])"}
	}
	fps, err := footprints(ctx, dispatch, doc)
	if err != nil {
		return nil, nil, err
	}
	fp := findFootprint(fps, ref)
	if fp == nil {
		return nil, nil, &backend.Error{Code: "FOOTPRINT_NOT_FOUND", Message: "footprint " + ref + " not found"}
	}
	margin := mmToNm(argFloat(p, "marginMm", 1.0))
	var bx box
	if pads := argStrings(p, "pads"); len(pads) > 0 {
		want := map[string]bool{}
		for _, n := range pads {
			want[n] = true
		}
		first := true
		for _, pad := range padsOf(fp) {
			if !want[pad.Number] {
				continue
			}
			pb := box{pad.Pos.X - pad.SizeX/2, pad.Pos.Y - pad.SizeY/2, pad.Pos.X + pad.SizeX/2, pad.Pos.Y + pad.SizeY/2}
			if first {
				bx, first = pb, false
			} else {
				bx = box{min(bx.MinX, pb.MinX), min(bx.MinY, pb.MinY), max(bx.MaxX, pb.MaxX), max(bx.MaxY, pb.MaxY)}
			}
		}
		if first {
			return nil, nil, &backend.Error{Code: "PAD_NOT_FOUND",
				Message: fmt.Sprintf("none of pads %v found on %s", pads, ref)}
		}
		info["source"] = fmt.Sprintf("%s pads %v", ref, pads)
	} else {
		boxes, err := itemBoxes(ctx, dispatch, doc, []string{itemID(fp)})
		if err != nil {
			return nil, nil, err
		}
		b, ok := boxes[itemID(fp)]
		if !ok {
			return nil, nil, &backend.Error{Code: "BBOX_FAILED", Message: "could not read the bounding box of " + ref}
		}
		bx = b
		info["source"] = ref + " bounding box"
	}
	bx = bx.grow(margin)
	info["boxMm"] = map[string]float64{"x1": nmToMm(bx.MinX), "y1": nmToMm(bx.MinY), "x2": nmToMm(bx.MaxX), "y2": nmToMm(bx.MaxY)}
	return bx.outline(), info, nil
}

func ruleAreaCreate(ctx context.Context, action string, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	pts, info, err := regionBox(ctx, p, dispatch, doc)
	if err != nil {
		return nil, err
	}
	layers := argStrings(p, "layers")
	if len(layers) == 0 || (len(layers) == 1 && layers[0] == "*") {
		if layers, err = copperLayers(ctx, dispatch, doc); err != nil {
			return nil, err
		}
	} else {
		for i, l := range layers {
			layers[i] = layerEnum(l)
		}
	}

	keep, _ := p["keepout"].(map[string]any)
	if keep == nil {
		keep = map[string]any{}
	}
	flags := map[string]any{
		"keepoutTracks":     argBool(keep, "tracks", false),
		"keepoutVias":       argBool(keep, "vias", false),
		"keepoutPads":       argBool(keep, "pads", false),
		"keepoutCopper":     argBool(keep, "copper", false),
		"keepoutFootprints": argBool(keep, "footprints", false),
	}

	nodes := make([]any, 0, len(pts))
	for _, pt := range pts {
		nodes = append(nodes, map[string]any{"point": pt})
	}
	name := argString(p, "name")
	zone := map[string]any{
		"type": "ZT_RULE_AREA", "layers": layers, "name": name,
		"outline": map[string]any{"polygons": []any{map[string]any{
			"outline": map[string]any{"closed": true, "nodes": nodes}, "holes": []any{}}}},
		"ruleAreaSettings": flags,
	}
	result := map[string]any{"name": name, "layers": layers, "keepout": flags, "region": info}
	if argBool(p, "dryRun", false) {
		result["dryRun"] = true
		return ok(action, result), nil
	}
	data, _, err := call(ctx, dispatch, "board.items.create", map[string]any{"document": doc,
		"items": []any{map[string]any{"type": "zone", "json": zone}}})
	if err != nil {
		return fail(action, "RULE_AREA_CREATE_FAILED", err.Error(), result), nil
	}
	created := itemsOf(data)
	if len(created) != 1 || itemID(created[0]) == "" {
		return fail(action, "RULE_AREA_CREATE_FAILED", "KiCad returned no rule area", result), nil
	}
	id := itemID(created[0])
	result["zone"] = id

	back, _, err := call(ctx, dispatch, "board.items.get_by_id", map[string]any{"document": doc, "ids": []string{id}})
	if err != nil {
		return fail(action, "READBACK_FAILED", err.Error(), result), nil
	}
	items := itemsOf(back)
	if len(items) != 1 {
		return fail(action, "READBACK_FAILED", "rule area not found after creation", result), nil
	}
	z := items[0]
	var problems []string
	if argString(z, "type") != "ZT_RULE_AREA" {
		problems = append(problems, "type="+argString(z, "type"))
	}
	if name != "" && argString(z, "name") != name {
		problems = append(problems, "name="+argString(z, "name"))
	}
	settings, _ := z["ruleAreaSettings"].(map[string]any)
	for key, want := range flags {
		if got, _ := settings[key].(bool); got != want.(bool) {
			problems = append(problems, fmt.Sprintf("%s=%v", key, got))
		}
	}
	if len(problems) > 0 {
		result["mismatches"] = problems
		return fail(action, "RULE_AREA_NOT_PERSISTED", strings.Join(problems, "; "), result), nil
	}
	result["verified"] = true
	return ok(action, result), nil
}

// antennaKeepout is a rule area around any footprint (or its antenna pads):
// no tracks, vias or copper pour on every copper layer by default.
func antennaKeepout(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	if argString(p, "reference") == "" && p["outline"] == nil && p["box"] == nil {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "reference is required (any footprint, e.g. U21), optionally pads[] for the antenna pins"}
	}
	q := map[string]any{}
	for k, v := range p {
		q[k] = v
	}
	if !hasKey(q, "keepout") {
		q["keepout"] = map[string]any{"tracks": true, "vias": true, "copper": true,
			"pads": false, "footprints": argBool(p, "keepoutFootprints", false)}
	}
	if !hasKey(q, "marginMm") {
		q["marginMm"] = 2.0
	}
	if argString(q, "name") == "" {
		q["name"] = "ANTENNA_KEEPOUT_" + strings.ToUpper(argString(p, "reference"))
	}
	res, err := ruleAreaCreate(ctx, "board.keepout.antenna", q, dispatch)
	if res != nil {
		res.Action = "board.keepout.antenna"
	}
	return res, err
}

// regionRulesSet writes named custom DRC rules scoped to a rule area (for
// example T1/T2 regions under a BGA) and reads the rule set back.
func regionRulesSet(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.rules.region.set"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	area := argString(p, "area")
	rawRules, _ := p["rules"].([]any)
	if area == "" && len(rawRules) == 0 {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: `area (rule area name) and constraints are required, e.g. {"area":"T1","clearanceMm":0.1,"trackWidthMm":0.09}`}
	}

	var rules []any
	if area != "" {
		condition := fmt.Sprintf("A.insideArea('%s')", area)
		if extra := argString(p, "condition"); extra != "" {
			condition = condition + " && " + extra
		}
		add := func(suffix, ctype string, minMm, maxMm float64) {
			c := map[string]any{"type": ctype, "numeric": map[string]any{}}
			if minMm > 0 {
				c["numeric"].(map[string]any)["min"] = mmToNm(minMm)
			}
			if maxMm > 0 {
				c["numeric"].(map[string]any)["max"] = mmToNm(maxMm)
			}
			rules = append(rules, map[string]any{"name": area + "_" + suffix, "condition": condition,
				"constraints": []any{c}})
		}
		if v := argFloat(p, "clearanceMm", 0); v > 0 {
			add("clearance", "CRCT_CLEARANCE", v, 0)
		}
		if v := argFloat(p, "trackWidthMm", 0); v > 0 {
			add("track_width", "CRCT_TRACK_WIDTH", v, argFloat(p, "trackWidthMaxMm", 0))
		}
		if v := argFloat(p, "viaDiameterMm", 0); v > 0 {
			add("via_diameter", "CRCT_VIA_DIAMETER", v, 0)
		}
		if v := argFloat(p, "holeSizeMm", 0); v > 0 {
			add("hole_size", "CRCT_HOLE_SIZE", v, 0)
		}
		if v := argFloat(p, "annularWidthMm", 0); v > 0 {
			add("annular_width", "CRCT_ANNULAR_WIDTH", v, 0)
		}
		if v := argFloat(p, "holeClearanceMm", 0); v > 0 {
			add("hole_clearance", "CRCT_HOLE_CLEARANCE", v, 0)
		}
	}
	rules = append(rules, rawRules...)
	if len(rules) == 0 {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "no constraints given (clearanceMm, trackWidthMm, viaDiameterMm, holeSizeMm, annularWidthMm, holeClearanceMm or rules[])"}
	}

	current, _, err := call(ctx, dispatch, "board.rules.custom.get", map[string]any{"document": doc})
	if err != nil {
		return nil, err
	}
	names := map[string]bool{}
	for _, r := range rules {
		if m, ok := r.(map[string]any); ok {
			names[argString(m, "name")] = true
		}
	}
	merged := []any{}
	existing, _ := current["rules"].([]any)
	replaced := 0
	for _, r := range existing {
		m, _ := r.(map[string]any)
		if names[argString(m, "name")] {
			replaced++
			continue // same-name rules are replaced, never duplicated
		}
		merged = append(merged, r)
	}
	merged = append(merged, rules...)
	result := map[string]any{"area": area, "added": len(rules), "replaced": replaced, "total": len(merged)}
	if argBool(p, "dryRun", false) {
		result["dryRun"], result["rules"] = true, rules
		return ok(action, result), nil
	}
	set, _, err := call(ctx, dispatch, "board.rules.custom.set", map[string]any{"document": doc, "rules": merged})
	if err != nil {
		return fail(action, "RULES_SET_FAILED", err.Error(), result), nil
	}
	result["status"], result["errorText"] = set["status"], set["errorText"]
	if s := argString(set, "status"); s != "" && s != "CRS_VALID" && s != "CRS_NONE" {
		return fail(action, "RULES_INVALID", fmt.Sprintf("KiCad rejected the rules: %s %s", s, argString(set, "errorText")), result), nil
	}

	back, _, err := call(ctx, dispatch, "board.rules.custom.get", map[string]any{"document": doc})
	if err != nil {
		return fail(action, "READBACK_FAILED", err.Error(), result), nil
	}
	have := map[string]bool{}
	list, _ := back["rules"].([]any)
	for _, r := range list {
		if m, ok := r.(map[string]any); ok {
			have[argString(m, "name")] = true
		}
	}
	var missing []string
	for name := range names {
		if !have[name] {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		result["missing"] = missing
		return fail(action, "RULES_NOT_PERSISTED", "rules missing after readback: "+strings.Join(missing, ", "), result), nil
	}
	result["verified"] = true
	result["next"] = "run board.drc.live to evaluate the region rules"
	return ok(action, result), nil
}
