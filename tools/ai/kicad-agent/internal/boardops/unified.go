// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"fmt"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// finding is one entry of the unified report.  Native DRC findings are the
// sign-off source; the other sources are engineering checks that DRC does not
// perform and are labelled as such, so counts are never mixed up.
type finding struct {
	Source   string   `json:"source"`
	Severity string   `json:"severity"`
	Type     string   `json:"type"`
	Message  string   `json:"message"`
	XMm      *float64 `json:"xMm,omitempty"`
	YMm      *float64 `json:"yMm,omitempty"`
	Items    []string `json:"items,omitempty"`
}

func fptr(v float64) *float64 { return &v }

func unifiedCheck(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.check.unified"
	doc := p["document"]
	input := argString(p, "input")
	if doc == nil && input == "" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "document (open board) or input (saved .kicad_pcb) is required"}
	}
	if doc == nil {
		doc = input
	}
	path := documentPath(doc)
	live := liveBoard(ctx, dispatch, path)

	var findings []finding
	sources := map[string]any{}
	add := func(f finding) { findings = append(findings, f) }

	// 1. Native DRC (authoritative).
	var drcRes *backend.Result
	var drcErr error
	drcArgs := map[string]any{"severityAll": true, "refillZones": argBool(p, "refillZones", true),
		"timeoutMs": argFloat(p, "timeoutMs", 600000), "full": true}
	if live {
		drcArgs["document"] = doc
		drcRes, drcErr = LiveRules(ctx, "board.drc.run", drcArgs, dispatch)
	} else {
		drcArgs["input"] = path
		drcArgs["format"] = "json"
		drcRes, drcErr = dispatch(ctx, "board.drc.run", drcArgs)
	}
	if drcErr != nil || drcRes == nil {
		sources["drc"] = map[string]any{"status": "failed", "error": backend.ErrorFrom(drcErr)}
	} else {
		data := toMap(drcRes.Data)
		report, _ := data["reportJson"].(map[string]any)
		count := 0
		for _, key := range []string{"violations", "unconnected_items", "schematic_parity"} {
			list, _ := report[key].([]any)
			for _, raw := range list {
				v, _ := raw.(map[string]any)
				f := finding{Source: "drc", Severity: argString(v, "severity"), Type: argString(v, "type"),
					Message: argString(v, "description")}
				if items, ok := v["items"].([]any); ok {
					for i, it := range items {
						im, _ := it.(map[string]any)
						if id := argString(im, "uuid"); id != "" {
							f.Items = append(f.Items, id)
						}
						if pos, ok := im["pos"].(map[string]any); ok && i == 0 {
							f.XMm, f.YMm = fptr(argFloat(pos, "x", 0)), fptr(argFloat(pos, "y", 0))
						}
					}
				}
				add(f)
				count++
			}
		}
		sources["drc"] = map[string]any{"status": argString(data, "status"), "count": count,
			"live": live, "report": data["report"]}
	}

	if !live {
		sources["ipcChecks"] = "skipped: the board is not open in a connected KiCad (DFM, connectivity, decoupling, fiducial and keepout checks need the live board)"
	} else {
		// 2. DFM heuristics.
		if dfm, res, err := call(ctx, dispatch, "board.dfm.analyze", map[string]any{"document": doc,
			"minWidthMm": argFloat(p, "minWidthMm", 0.1)}); err == nil || res != nil {
			if res != nil {
				dfm = toMap(res.Data)
			}
			vs, _ := dfm["violations"].([]any)
			for _, raw := range vs {
				v, _ := raw.(map[string]any)
				f := finding{Source: "dfm", Severity: "warning", Type: argString(v, "type"),
					Message: strings.TrimSpace(fmt.Sprintf("%s on %s %s %s", argString(v, "type"),
						argString(v, "layer"), argString(v, "net"), argString(v, "note")))}
				if f.Type == "" {
					f.Type = "dfm"
				}
				if id := argString(v, "item"); id != "" {
					f.Items = []string{id}
				}
				add(f)
			}
			sources["dfm"] = map[string]any{"count": len(vs)}
		} else {
			sources["dfm"] = map[string]any{"status": "failed", "error": err.Error()}
		}

		// 3. Zone-aware connectivity proof.
		proof, res, err := call(ctx, dispatch, "board.connectivity.prove", map[string]any{"document": doc,
			"requireFilledZones": true})
		if res != nil {
			proof = toMap(res.Data)
			nets, _ := proof["unconnectedNets"].([]any)
			for _, n := range nets {
				add(finding{Source: "connectivity", Severity: "error", Type: "net_not_proven",
					Message: fmt.Sprintf("net %v is not proven connected (zones must be filled)", n)})
			}
			sources["connectivity"] = map[string]any{"ok": err == nil, "unconnectedNets": len(nets)}
		} else if err != nil {
			sources["connectivity"] = map[string]any{"status": "failed", "error": err.Error()}
		}

		// 4. Decoupling distance.
		if res, err := decapCheck(ctx, map[string]any{"document": doc,
			"maxDistanceMm": argFloat(p, "maxDecapDistanceMm", 3.0)}, dispatch); err == nil {
			data, _ := res.Data.(map[string]any)
			list, _ := data["findings"].([]decapFinding)
			for _, d := range list {
				msg := fmt.Sprintf("%s pin %s (%s): %s", d.IC, d.Pin, d.Net, d.Problem)
				if d.Capacitor != "" {
					msg += fmt.Sprintf(" (%s at %.2f mm)", d.Capacitor, d.DistanceMm)
				}
				add(finding{Source: "decap", Severity: "warning", Type: "decap_too_far", Message: msg,
					XMm: fptr(d.XMm), YMm: fptr(d.YMm)})
			}
			sources["decap"] = map[string]any{"count": len(list), "powerPins": data["powerPins"]}
		} else {
			sources["decap"] = map[string]any{"status": "failed", "error": err.Error()}
		}

		// 5. Fiducials and antenna keepouts.
		if fps, err := footprints(ctx, dispatch, doc); err == nil {
			fid := 0
			for _, fp := range fps {
				isFid := strings.HasPrefix(strings.ToUpper(referenceOf(fp)), "FID")
				def, _ := fp["definition"].(map[string]any)
				items, _ := def["items"].([]any)
				for _, raw := range items {
					if pad, ok := raw.(map[string]any); ok && argString(pad, "fabProperty") == "PFP_FIDUCIAL_GLOBAL" {
						isFid = true
					}
				}
				if isFid {
					fid++
				}
			}
			want := int(argFloat(p, "fiducials", 3))
			if want > 0 && fid < want {
				add(finding{Source: "fiducial", Severity: "warning", Type: "fiducial_missing",
					Message: fmt.Sprintf("%d global fiducial(s) found, %d expected (board.fiducial.add can place them)", fid, want)})
			}
			sources["fiducial"] = map[string]any{"found": fid, "expected": want}

			if refs := argStrings(p, "antennaRefs"); len(refs) > 0 {
				zones, _, zerr := call(ctx, dispatch, "board.items.get", map[string]any{"document": doc, "types": []string{"zone"}})
				var areas []map[string]any
				if zerr == nil {
					for _, z := range itemsOf(zones) {
						if argString(z, "type") == "ZT_RULE_AREA" {
							areas = append(areas, z)
						}
					}
				}
				for _, ref := range refs {
					fp := findFootprint(fps, ref)
					if fp == nil {
						add(finding{Source: "antenna", Severity: "warning", Type: "antenna_ref_missing", Message: ref + " not found"})
						continue
					}
					covered := false
					for _, z := range areas {
						if strings.Contains(strings.ToUpper(argString(z, "name")), strings.ToUpper(ref)) {
							covered = true
						}
					}
					if !covered {
						add(finding{Source: "antenna", Severity: "warning", Type: "antenna_keepout_missing",
							Message: "no rule-area keepout named for " + ref + " (board.keepout.antenna creates one)"})
					}
				}
			}
		}
	}

	summary := map[string]map[string]int{}
	for _, f := range findings {
		if summary[f.Source] == nil {
			summary[f.Source] = map[string]int{}
		}
		summary[f.Source][f.Severity]++
	}

	markers := 0
	if live && argBool(p, "injectMarkers", false) {
		for _, f := range findings {
			if f.Source == "drc" || f.XMm == nil {
				continue
			}
			sev := "DRS_WARNING"
			if f.Severity == "error" {
				sev = "DRS_ERROR"
			}
			if _, _, err := call(ctx, dispatch, "board.drc.marker.add", map[string]any{"document": doc,
				"severity": sev, "message": "[" + f.Source + "] " + f.Message,
				"position": map[string]any{"xNm": mmToNm(*f.XMm), "yNm": mmToNm(*f.YMm)}}); err == nil {
				markers++
			}
		}
	}

	result := map[string]any{
		"board": path, "live": live, "findings": findings, "summary": summary, "sources": sources,
		"markersAdded":        markers,
		"readyForFabrication": false,
		"policy":              "native DRC is the sign-off count; dfm/connectivity/decap/fiducial/antenna are additional engineering checks. Use audit.run for the fabrication review.",
	}
	drcSrc, _ := sources["drc"].(map[string]any)
	if s, _ := drcSrc["status"].(string); s == "failed" || s == "timeout" {
		return fail(action, "DRC_UNAVAILABLE", "native DRC did not complete; the report is incomplete", result), nil
	}
	if len(findings) > 0 {
		result["status"] = "violations"
	} else {
		result["status"] = "clean"
	}
	return ok(action, result), nil
}
