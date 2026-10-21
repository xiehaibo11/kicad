// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"fmt"
	"math"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// dfmFull extends board.dfm.analyze/fix with the checks EDA reviews ask for in
// one batch: narrow tracks and off-45° segments (board.dfm.*), dangling track
// stubs, acute track junctions and silkscreen text mirrored for the wrong
// side.  With fix=true it widens narrow tracks, removes zero-length and
// dangling stubs, and un-mirrors/mirrors silk text; stub removal is undone if
// the zone-aware connectivity proof of an affected net gets worse.
func dfmFull(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.dfm.full"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	fix := argBool(p, "fix", false)

	result := map[string]any{"fix": fix}
	issues := map[string]int{}
	var findings []map[string]any
	note := func(kind string, f map[string]any) {
		issues[kind]++
		f["type"] = kind
		findings = append(findings, f)
	}

	// 1. Width / angle / zero length through the existing engine.
	base := "board.dfm.analyze"
	args := map[string]any{"document": doc, "minWidthMm": argFloat(p, "minWidthMm", 0.15)}
	if fix {
		base, args["dryRun"] = "board.dfm.fix", false
	}
	if res, err := dispatch(ctx, base, args); err == nil && res != nil {
		data := toMap(res.Data)
		vs, _ := data["violations"].([]any)
		for _, raw := range vs {
			v, _ := raw.(map[string]any)
			note(argString(v, "type"), map[string]any{"item": argString(v, "item"), "net": argString(v, "net"),
				"layer": argString(v, "layer"), "fixable": v["fixable"], "detail": argString(v, "fix") + argString(v, "note")})
		}
		result["widthAngle"] = map[string]any{"fixed": data["fixed"], "deleted": data["deleted"], "failed": data["failed"]}
	} else if err != nil {
		result["widthAngleError"] = err.Error()
	}

	// 2. Track topology: dangling ends and acute junctions.
	tdata, _, err := call(ctx, dispatch, "board.items.get", map[string]any{"document": doc, "types": []string{"track", "via"}})
	if err != nil {
		return nil, err
	}
	type seg struct {
		id, net, layer string
		a, b           point
		width          int64
		raw            map[string]any
	}
	var segs []seg
	type disc struct {
		at  point
		r   int64
		net string
	}
	var anchors []disc
	for _, item := range itemsOf(tdata) {
		switch itemType(item) {
		case "Track":
			st, _ := item["start"].(map[string]any)
			en, _ := item["end"].(map[string]any)
			w, _ := item["width"].(map[string]any)
			segs = append(segs, seg{itemID(item), netName(item), argString(item, "layer"),
				point{num(st["xNm"]), num(st["yNm"])}, point{num(en["xNm"]), num(en["yNm"])}, num(w["valueNm"]), item})
		case "Via":
			pos, _ := positionOf(item)
			r := int64(300000)
			if ps, ok := item["padStack"].(map[string]any); ok {
				if cl, ok := ps["copperLayers"].([]any); ok && len(cl) > 0 {
					if l, ok := cl[0].(map[string]any); ok {
						if s, ok := l["size"].(map[string]any); ok {
							r = num(s["xNm"]) / 2
						}
					}
				}
			}
			anchors = append(anchors, disc{pos, r, netName(item)})
		}
	}
	fps, err := footprints(ctx, dispatch, doc)
	if err != nil {
		return nil, err
	}
	for _, fp := range fps {
		for _, pad := range padsOf(fp) {
			r := max(pad.SizeX, pad.SizeY) / 2
			anchors = append(anchors, disc{pad.Pos, r, pad.Net})
		}
	}
	// Zones: an end inside a filled zone of its net is connected.
	zdata, _, _ := call(ctx, dispatch, "board.items.get", map[string]any{"document": doc, "types": []string{"zone"}})
	zoneNets := map[string]bool{}
	for _, z := range itemsOf(zdata) {
		if cs, ok := z["copperSettings"].(map[string]any); ok {
			if n, ok := cs["net"].(map[string]any); ok {
				zoneNets[argString(n, "name")] = true
			}
		}
	}

	touches := func(s seg, end point) bool {
		tol := s.width / 2
		for _, o := range segs {
			if o.id == s.id || o.net != s.net {
				continue
			}
			if dist(end, o.a) <= float64(tol+o.width/2) || dist(end, o.b) <= float64(tol+o.width/2) {
				return true
			}
		}
		for _, a := range anchors {
			if a.net == s.net && dist(end, a.at) <= float64(a.r+tol) {
				return true
			}
		}
		return false
	}
	var stubs []seg
	for _, s := range segs {
		if s.a == s.b {
			continue // zero length: handled by the width/angle engine
		}
		freeA, freeB := !touches(s, s.a), !touches(s, s.b)
		if (freeA || freeB) && !zoneNets[s.net] {
			end := s.a
			if !freeA {
				end = s.b
			}
			note("dangling", map[string]any{"item": s.id, "net": s.net, "layer": s.layer,
				"xMm": nmToMm(end.X), "yMm": nmToMm(end.Y), "fixable": freeA != freeB,
				"detail": "track end connects to nothing"})
			if freeA != freeB {
				stubs = append(stubs, s)
			}
		}
	}
	acuteLimit := argFloat(p, "acuteDeg", 90)
	for i, s := range segs {
		for j := i + 1; j < len(segs); j++ {
			o := segs[j]
			if o.net != s.net || o.layer != s.layer {
				continue
			}
			var shared, sOther, oOther point
			switch {
			case s.a == o.a:
				shared, sOther, oOther = s.a, s.b, o.b
			case s.a == o.b:
				shared, sOther, oOther = s.a, s.b, o.a
			case s.b == o.a:
				shared, sOther, oOther = s.b, s.a, o.b
			case s.b == o.b:
				shared, sOther, oOther = s.b, s.a, o.a
			default:
				continue
			}
			v1x, v1y := float64(sOther.X-shared.X), float64(sOther.Y-shared.Y)
			v2x, v2y := float64(oOther.X-shared.X), float64(oOther.Y-shared.Y)
			n1, n2 := math.Hypot(v1x, v1y), math.Hypot(v2x, v2y)
			if n1 == 0 || n2 == 0 {
				continue
			}
			angle := math.Acos(math.Max(-1, math.Min(1, (v1x*v2x+v1y*v2y)/(n1*n2)))) * 180 / math.Pi
			if angle < acuteLimit-0.5 {
				note("acute_angle", map[string]any{"items": []string{s.id, o.id}, "net": s.net, "layer": s.layer,
					"angleDeg": math.Round(angle*10) / 10, "xMm": nmToMm(shared.X), "yMm": nmToMm(shared.Y),
					"fixable": false, "detail": "re-route the junction with 135° corners"})
			}
		}
	}

	// 3. Silkscreen text mirrored for the wrong side.
	textData, _, _ := call(ctx, dispatch, "board.items.get", map[string]any{"document": doc, "types": []string{"text"}})
	var textFixes []any
	for _, t := range itemsOf(textData) {
		layer := argString(t, "layer")
		txt, _ := t["text"].(map[string]any)
		attrs, _ := txt["attributes"].(map[string]any)
		mirrored, _ := attrs["mirrored"].(bool)
		wrong := (strings.HasPrefix(layer, "BL_F_") && mirrored) || (strings.HasPrefix(layer, "BL_B_") && !mirrored)
		if !wrong || !strings.Contains(layer, "Silk") {
			continue
		}
		note("silk_mirrored", map[string]any{"item": itemID(t), "layer": layer, "text": argString(txt, "text"),
			"fixable": true, "detail": fmt.Sprintf("mirrored=%v on %s", mirrored, layer)})
		if fix && attrs != nil {
			clean := stripType(t)
			ct, _ := clean["text"].(map[string]any)
			ca, _ := ct["attributes"].(map[string]any)
			ca["mirrored"] = !mirrored
			textFixes = append(textFixes, map[string]any{"type": "text", "json": clean})
		}
	}
	for _, fp := range fps {
		for _, key := range []string{"referenceField", "valueField"} {
			field, _ := fp[key].(map[string]any)
			ft, _ := field["text"].(map[string]any)
			layer := argString(ft, "layer")
			inner, _ := ft["text"].(map[string]any)
			attrs, _ := inner["attributes"].(map[string]any)
			mirrored, _ := attrs["mirrored"].(bool)
			visible, _ := attrs["visible"].(bool)
			if !visible || !strings.Contains(layer, "Silk") {
				continue
			}
			if (strings.HasPrefix(layer, "BL_F_") && mirrored) || (strings.HasPrefix(layer, "BL_B_") && !mirrored) {
				note("silk_mirrored", map[string]any{"item": itemID(fp), "reference": referenceOf(fp), "field": key,
					"layer": layer, "fixable": false, "detail": "footprint field mirrored for the wrong side (flip or edit the footprint field)"})
			}
		}
	}

	result["issues"] = issues
	result["findings"] = findings
	if !fix {
		if len(findings) > 0 {
			result["status"] = "violations"
		} else {
			result["status"] = "clean"
		}
		return ok(action, result), nil
	}

	// Apply silk fixes.
	if len(textFixes) > 0 {
		if _, _, err := call(ctx, dispatch, "board.items.update", map[string]any{"document": doc, "items": textFixes}); err != nil {
			result["silkFixError"] = err.Error()
		} else {
			result["silkFixed"] = len(textFixes)
		}
	}

	// Remove dangling stubs, guarded by a per-net connectivity proof.
	if len(stubs) > 0 {
		affected := map[string]bool{}
		var ids []string
		var restore []any
		for _, s := range stubs {
			affected[s.net] = true
			ids = append(ids, s.id)
			restore = append(restore, map[string]any{"type": "track", "json": stripType(s.raw)})
		}
		nets := sortedKeys(affected)
		proofBefore := netProof(ctx, dispatch, doc, nets)
		if _, _, err := call(ctx, dispatch, "board.items.delete", map[string]any{"document": doc, "ids": ids}); err != nil {
			result["stubError"] = err.Error()
		} else {
			proofAfter := netProof(ctx, dispatch, doc, nets)
			if proofAfter > proofBefore {
				if _, _, err := call(ctx, dispatch, "board.items.create", map[string]any{"document": doc, "items": restore}); err != nil {
					result["stubRestoreError"] = err.Error()
				}
				result["stubsRestored"] = len(ids)
				result["stubNote"] = "removing the stubs made connectivity worse; they were restored"
			} else {
				result["stubsRemoved"] = len(ids)
			}
		}
	}

	// Re-analyze to report what remains.
	again, err := dfmFull(ctx, map[string]any{"document": doc, "minWidthMm": argFloat(p, "minWidthMm", 0.15),
		"acuteDeg": acuteLimit}, dispatch)
	if err == nil {
		remaining := toMap(again.Data)
		result["remaining"] = remaining["issues"]
	}
	result["next"] = "run board.drc.live: widened tracks and removed stubs must be re-checked for clearance"
	return ok(action, result), nil
}

// netProof counts unproven nets among nets (-1 if the proof is unavailable).
func netProof(ctx context.Context, dispatch Dispatcher, doc any, nets []string) int {
	res, err := dispatch(ctx, "board.connectivity.prove", map[string]any{"document": doc, "nets": nets})
	if err != nil || res == nil {
		return -1
	}
	data := toMap(res.Data)
	list, _ := data["unconnectedNets"].([]any)
	return len(list)
}
