// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"fmt"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// viaSpec is the requested via geometry and IPC-4761 protection.
type viaSpec struct {
	drillNm, diameterNm int64
	viaType             string // proto ViaType
	start, end          string // proto BoardLayer names
	filled, capped      *bool
	plugged, covered    string // "", none, front, back, both
}

var viaTypes = map[string]string{
	"through": "VT_THROUGH", "blind": "VT_BLIND", "buried": "VT_BURIED",
	"micro": "VT_MICRO", "microvia": "VT_MICRO", "blind_buried": "VT_BLIND_BURIED",
}

func layerEnum(name string) string {
	if strings.HasPrefix(name, "BL_") {
		return name
	}
	return "BL_" + strings.ReplaceAll(name, ".", "_")
}

func optBool(p map[string]any, key string) *bool {
	if v, ok := p[key].(bool); ok {
		return &v
	}
	return nil
}

func parseViaSpec(p map[string]any, defaults bool) (viaSpec, error) {
	s := viaSpec{}
	if defaults || hasKey(p, "drillMm") {
		s.drillNm = mmToNm(argFloat(p, "drillMm", 0.3))
	}
	if defaults || hasKey(p, "diameterMm") {
		s.diameterNm = mmToNm(argFloat(p, "diameterMm", 0.6))
	}
	if s.drillNm < 0 || s.diameterNm < 0 || (s.drillNm > 0 && s.diameterNm > 0 && s.drillNm >= s.diameterNm) {
		return s, &backend.Error{Code: "BAD_INPUT", Message: "drillMm must be positive and smaller than diameterMm"}
	}
	if t := strings.ToLower(argString(p, "type")); t != "" || defaults {
		if t == "" {
			t = "through"
		}
		vt, ok := viaTypes[t]
		if !ok {
			return s, &backend.Error{Code: "BAD_INPUT", Message: "type must be through, blind, buried or micro"}
		}
		s.viaType = vt
	}
	if v := argString(p, "startLayer"); v != "" || defaults {
		if v == "" {
			v = "F.Cu"
		}
		s.start = layerEnum(v)
	}
	if v := argString(p, "endLayer"); v != "" || defaults {
		if v == "" {
			v = "B.Cu"
		}
		s.end = layerEnum(v)
	}
	s.filled, s.capped = optBool(p, "filled"), optBool(p, "capped")
	for _, key := range []string{"plugged", "covered"} {
		v := strings.ToLower(argString(p, key))
		if b, isBool := p[key].(bool); isBool {
			v = "none"
			if b {
				v = "both"
			}
		}
		switch v {
		case "", "none", "front", "back", "both":
		default:
			return s, &backend.Error{Code: "BAD_INPUT", Message: key + " must be none, front, back, both or a boolean"}
		}
		if key == "plugged" {
			s.plugged = v
		} else {
			s.covered = v
		}
	}
	return s, nil
}

func modeFor(_ string, want string, on, off string) (front, back string) {
	switch want {
	case "":
		return "", ""
	case "none":
		return off, off
	case "front":
		return on, off
	case "back":
		return off, on
	}
	return on, on
}

// apply writes the spec into a via JSON object (new or read back).
func (s viaSpec) apply(via map[string]any) {
	ps, _ := via["padStack"].(map[string]any)
	if ps == nil {
		ps = map[string]any{"type": "PST_NORMAL"}
		via["padStack"] = ps
	}
	drill, _ := ps["drill"].(map[string]any)
	if drill == nil {
		drill = map[string]any{"shape": "DS_CIRCLE"}
		ps["drill"] = drill
	}
	if s.viaType != "" {
		via["type"] = s.viaType
	}
	if s.start != "" {
		drill["startLayer"] = s.start
	}
	if s.end != "" {
		drill["endLayer"] = s.end
	}
	if s.start != "" || s.end != "" {
		ps["layers"] = []any{argString(drill, "startLayer"), argString(drill, "endLayer")}
	}
	if s.drillNm > 0 {
		drill["diameter"] = map[string]any{"xNm": s.drillNm, "yNm": s.drillNm}
	}
	if s.diameterNm > 0 {
		layers, _ := ps["copperLayers"].([]any)
		if len(layers) == 0 {
			ps["copperLayers"] = []any{map[string]any{"layer": "BL_F_Cu", "shape": "PSS_CIRCLE",
				"size": map[string]any{"xNm": s.diameterNm, "yNm": s.diameterNm}}}
		} else {
			for _, raw := range layers {
				if l, ok := raw.(map[string]any); ok {
					l["size"] = map[string]any{"xNm": s.diameterNm, "yNm": s.diameterNm}
				}
			}
		}
	}
	if s.filled != nil {
		drill["filled"] = map[bool]string{true: "VDFM_FILLED", false: "VDFM_UNFILLED"}[*s.filled]
	}
	if s.capped != nil {
		drill["capped"] = map[bool]string{true: "VDCM_CAPPED", false: "VDCM_UNCAPPED"}[*s.capped]
	}
	outer := func(key string) map[string]any {
		m, _ := ps[key].(map[string]any)
		if m == nil {
			m = map[string]any{}
			ps[key] = m
		}
		return m
	}
	if f, b := modeFor("", s.plugged, "VPM_PLUGGED", "VPM_UNPLUGGED"); f != "" {
		outer("frontOuterLayers")["pluggingMode"] = f
		outer("backOuterLayers")["pluggingMode"] = b
	}
	if f, b := modeFor("", s.covered, "VCM_COVERED", "VCM_UNCOVERED"); f != "" {
		outer("frontOuterLayers")["coveringMode"] = f
		outer("backOuterLayers")["coveringMode"] = b
	}
}

// mismatches compares a read-back via with the requested spec.
func (s viaSpec) mismatches(via map[string]any) []string {
	var out []string
	ps, _ := via["padStack"].(map[string]any)
	drill, _ := ps["drill"].(map[string]any)
	check := func(label, got, want string) {
		if want != "" && got != want {
			out = append(out, fmt.Sprintf("%s=%s (want %s)", label, got, want))
		}
	}
	check("type", argString(via, "type"), s.viaType)
	check("startLayer", argString(drill, "startLayer"), s.start)
	check("endLayer", argString(drill, "endLayer"), s.end)
	if s.drillNm > 0 {
		d, _ := drill["diameter"].(map[string]any)
		if num(d["xNm"]) != s.drillNm {
			out = append(out, fmt.Sprintf("drill=%s (want %s)", fmtMm(num(d["xNm"])), fmtMm(s.drillNm)))
		}
	}
	if s.filled != nil {
		check("filled", argString(drill, "filled"), map[bool]string{true: "VDFM_FILLED", false: "VDFM_UNFILLED"}[*s.filled])
	}
	if s.capped != nil {
		check("capped", argString(drill, "capped"), map[bool]string{true: "VDCM_CAPPED", false: "VDCM_UNCAPPED"}[*s.capped])
	}
	front, _ := ps["frontOuterLayers"].(map[string]any)
	back, _ := ps["backOuterLayers"].(map[string]any)
	if f, b := modeFor("", s.plugged, "VPM_PLUGGED", "VPM_UNPLUGGED"); f != "" {
		check("frontPlugging", argString(front, "pluggingMode"), f)
		check("backPlugging", argString(back, "pluggingMode"), b)
	}
	if f, b := modeFor("", s.covered, "VCM_COVERED", "VCM_UNCOVERED"); f != "" {
		check("frontCovering", argString(front, "coveringMode"), f)
		check("backCovering", argString(back, "coveringMode"), b)
	}
	return out
}

type viaSite struct {
	At  point
	Net string
	Pad string
}

// viaSites collects positions from positions[], position, or pads of a
// footprint (via-in-pad).
func viaSites(ctx context.Context, p map[string]any, dispatch Dispatcher, doc any) ([]viaSite, error) {
	net := argString(p, "net")
	var sites []viaSite
	addPoint := func(raw any) error {
		m, _ := raw.(map[string]any)
		if m == nil {
			return &backend.Error{Code: "BAD_INPUT", Message: "positions must be objects {xMm,yMm}"}
		}
		var pt point
		switch {
		case hasKey(m, "xMm"):
			pt = point{mmToNm(argFloat(m, "xMm", 0)), mmToNm(argFloat(m, "yMm", 0))}
		case hasKey(m, "xNm"):
			pt = point{num(m["xNm"]), num(m["yNm"])}
		default:
			return &backend.Error{Code: "BAD_INPUT", Message: "position needs xMm/yMm or xNm/yNm"}
		}
		n := net
		if s := argString(m, "net"); s != "" {
			n = s
		}
		sites = append(sites, viaSite{At: pt, Net: n})
		return nil
	}
	if list, ok := p["positions"].([]any); ok {
		for _, raw := range list {
			if err := addPoint(raw); err != nil {
				return nil, err
			}
		}
	}
	if raw, ok := p["position"]; ok {
		if err := addPoint(raw); err != nil {
			return nil, err
		}
	}
	if ref := argString(p, "reference"); ref != "" {
		fps, err := footprints(ctx, dispatch, doc)
		if err != nil {
			return nil, err
		}
		fp := findFootprint(fps, ref)
		if fp == nil {
			return nil, &backend.Error{Code: "FOOTPRINT_NOT_FOUND", Message: "footprint " + ref + " not found"}
		}
		want := map[string]bool{}
		for _, n := range argStrings(p, "pads") {
			want[n] = true
		}
		netFilter := map[string]bool{}
		for _, n := range argStrings(p, "nets") {
			netFilter[n] = true
		}
		for _, pad := range padsOf(fp) {
			if len(want) > 0 && !want[pad.Number] {
				continue
			}
			if len(netFilter) > 0 && !netFilter[pad.Net] {
				continue
			}
			if pad.Net == "" && !argBool(p, "includeUnconnected", false) {
				continue
			}
			sites = append(sites, viaSite{At: pad.Pos, Net: pad.Net, Pad: ref + "." + pad.Number})
		}
	}
	if len(sites) == 0 {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "give positions[], position, or reference (+ pads[]/nets[]) for via-in-pad"}
	}
	return sites, nil
}

func viaCreate(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.via.create"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	spec, err := parseViaSpec(p, true)
	if err != nil {
		return nil, err
	}
	sites, err := viaSites(ctx, p, dispatch, doc)
	if err != nil {
		return nil, err
	}

	items := make([]any, 0, len(sites))
	for _, site := range sites {
		via := map[string]any{"position": map[string]any{"xNm": site.At.X, "yNm": site.At.Y}}
		if site.Net != "" {
			via["net"] = map[string]any{"name": site.Net}
		}
		spec.apply(via)
		items = append(items, map[string]any{"type": "via", "json": via})
	}
	plan := make([]map[string]any, 0, len(sites))
	for _, s := range sites {
		plan = append(plan, map[string]any{"xMm": nmToMm(s.At.X), "yMm": nmToMm(s.At.Y), "net": s.Net, "pad": s.Pad})
	}
	result := map[string]any{"requested": len(sites), "sites": plan}
	if argBool(p, "dryRun", false) {
		result["dryRun"] = true
		return ok(action, result), nil
	}

	var ids []string
	for start := 0; start < len(items); start += 50 {
		end := min(start+50, len(items))
		data, _, err := call(ctx, dispatch, "board.items.create", map[string]any{"document": doc, "items": items[start:end]})
		if err != nil {
			result["createdIds"] = ids
			return fail(action, "VIA_CREATE_FAILED", err.Error(), result), nil
		}
		for _, item := range itemsOf(data) {
			ids = append(ids, itemID(item))
		}
	}
	result["createdIds"] = ids
	return verifyVias(ctx, dispatch, doc, action, ids, spec, result)
}

func verifyVias(ctx context.Context, dispatch Dispatcher, doc any, action string, ids []string,
	spec viaSpec, result map[string]any) (*backend.Result, error) {
	if len(ids) == 0 {
		return fail(action, "NOTHING_CHANGED", "no vias were created or updated", result), nil
	}
	data, _, err := call(ctx, dispatch, "board.items.get_by_id", map[string]any{"document": doc, "ids": ids})
	if err != nil {
		return fail(action, "READBACK_FAILED", err.Error(), result), nil
	}
	back := itemsOf(data)
	problems := map[string][]string{}
	for _, via := range back {
		if m := spec.mismatches(via); len(m) > 0 {
			problems[itemID(via)] = m
		}
	}
	result["verifiedCount"] = len(back) - len(problems)
	if len(back) != len(ids) {
		result["missing"] = len(ids) - len(back)
		return fail(action, "READBACK_INCOMPLETE",
			fmt.Sprintf("%d of %d vias could not be read back", len(ids)-len(back), len(ids)), result), nil
	}
	if len(problems) > 0 {
		result["mismatches"] = problems
		return fail(action, "VIA_PROPERTY_NOT_PERSISTED",
			fmt.Sprintf("%d via(s) did not keep the requested properties", len(problems)), result), nil
	}
	result["verified"] = true
	result["next"] = "run board.drc.live (or board.drc.run after saving) and board.connectivity.prove"
	return ok(action, result), nil
}

func viaModify(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.via.modify"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	spec, err := parseViaSpec(p, false)
	if err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	for _, id := range argStrings(p, "ids") {
		ids[id] = true
	}
	nets := map[string]bool{}
	for _, n := range argStrings(p, "nets") {
		nets[n] = true
	}
	all := argBool(p, "all", false)
	if len(ids) == 0 && len(nets) == 0 && !all {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "select vias with ids[], nets[] or all=true"}
	}

	data, _, err := call(ctx, dispatch, "board.items.get", map[string]any{"document": doc, "types": []string{"via"}})
	if err != nil {
		return nil, err
	}
	var updates []any
	var touched []string
	for _, via := range itemsOf(data) {
		id := itemID(via)
		if !all && !ids[id] && !nets[netName(via)] {
			continue
		}
		clean := stripType(via)
		spec.apply(clean)
		updates = append(updates, map[string]any{"type": "via", "json": clean})
		touched = append(touched, id)
	}
	result := map[string]any{"selected": len(touched)}
	if len(touched) == 0 {
		return fail(action, "NO_VIAS_SELECTED", "no vias matched the selection", result), nil
	}
	if argBool(p, "dryRun", false) {
		result["dryRun"], result["ids"] = true, touched
		return ok(action, result), nil
	}
	for start := 0; start < len(updates); start += 50 {
		end := min(start+50, len(updates))
		if _, _, err := call(ctx, dispatch, "board.items.update", map[string]any{"document": doc, "items": updates[start:end]}); err != nil {
			result["updatedBeforeFailure"] = start
			return fail(action, "VIA_UPDATE_FAILED", err.Error(), result), nil
		}
	}
	result["updatedIds"] = touched
	return verifyVias(ctx, dispatch, doc, action, touched, spec, result)
}
