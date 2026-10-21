// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"fmt"
	"math"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// lengthMatch equalizes a group of nets (a bus or a set of diff-pair halves):
// it measures every net, picks the target (targetMm or the longest net),
// tunes the short nets with board.route.tune_length and re-measures.  The
// group passes only when every net is within the tolerance after readback.
func lengthMatch(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.route.length_match"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	nets := argStrings(p, "nets")
	if len(nets) < 2 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "nets[] needs at least two nets"}
	}
	tol := argFloat(p, "toleranceMm", 0.5)

	measure := func() (map[string]float64, error) {
		out := map[string]float64{}
		for _, net := range nets {
			data, _, err := call(ctx, dispatch, "board.route.length_report", map[string]any{"document": doc, "net": net})
			if err != nil {
				return nil, err
			}
			out[net] = argFloat(data, "lengthMm", 0)
		}
		return out, nil
	}
	before, err := measure()
	if err != nil {
		return nil, err
	}
	target := argFloat(p, "targetMm", 0)
	if target <= 0 {
		for _, l := range before {
			target = math.Max(target, l)
		}
	}
	type plan struct {
		Net       string  `json:"net"`
		LengthMm  float64 `json:"lengthMm"`
		DeficitMm float64 `json:"deficitMm"`
		Status    string  `json:"status"`
	}
	var plans []plan
	for _, net := range nets {
		pl := plan{Net: net, LengthMm: before[net], DeficitMm: math.Max(0, target-before[net])}
		switch {
		case before[net] == 0:
			pl.Status = "unrouted"
		case before[net] > target+tol:
			pl.Status = "too_long (shorten manually or raise targetMm)"
		case pl.DeficitMm <= tol:
			pl.Status = "within_tolerance"
		default:
			pl.Status = "needs_tuning"
		}
		plans = append(plans, pl)
	}
	result := map[string]any{"targetMm": target, "toleranceMm": tol, "nets": plans}
	if !argBool(p, "apply", false) {
		result["dryRun"] = true
		return ok(action, result), nil
	}

	tuneLog := []any{}
	for _, pl := range plans {
		if pl.Status != "needs_tuning" {
			continue
		}
		res, err := dispatch(ctx, "board.route.tune_length", map[string]any{"document": doc, "net": pl.Net,
			"targetMm": target, "amplitudeMm": argFloat(p, "amplitudeMm", 0.5),
			"spacingMm": argFloat(p, "spacingMm", 0.5), "dryRun": false})
		entry := map[string]any{"net": pl.Net}
		if err != nil {
			entry["error"] = err.Error()
		} else if res != nil {
			entry["result"] = res.Data
			entry["ok"] = res.OK
		}
		tuneLog = append(tuneLog, entry)
	}
	result["tuning"] = tuneLog

	after, err := measure()
	if err != nil {
		return fail(action, "READBACK_FAILED", err.Error(), result), nil
	}
	result["after"] = after
	var off []string
	for _, net := range nets {
		if math.Abs(after[net]-target) > tol {
			off = append(off, fmt.Sprintf("%s=%.3f mm", net, after[net]))
		}
	}
	if len(off) > 0 {
		result["outOfTolerance"] = off
		return fail(action, "LENGTH_NOT_MATCHED", fmt.Sprintf("%d net(s) outside ±%.3f mm of %.3f mm", len(off), tol, target), result), nil
	}
	result["verified"] = true
	result["next"] = "run board.drc.live to check clearances of the new serpentines"
	return ok(action, result), nil
}
