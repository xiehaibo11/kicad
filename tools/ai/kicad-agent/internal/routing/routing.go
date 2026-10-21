// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package routing implements a deterministic first-pass router on top of the
// KiCad IPC item API.
//
// The autorouter is an L-router: it connects consecutive pads on a net with
// horizontal/vertical segments on the same layer.  It is intentionally simple
// and reports "verified": false; a DRC run is required after routing.  It does
// not rip up, shove, or search around obstacles.
//
// Differential-pair routing produces two parallel L paths and reports the
// requested gap; it does not perform coupled-line length tuning.
package routing

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

type Pad struct {
	Ref         string
	Number      string
	Net         string
	Layer       string
	Layers      []string
	X, Y        int64
	SizeX       int64
	SizeY       int64
	HasPosition bool
}

type NetResult struct {
	Net       string   `json:"net"`
	PadCount  int      `json:"padCount"`
	Routed    int      `json:"routed"`
	Skipped   int      `json:"skipped"`
	Reason    string   `json:"reason,omitempty"`
	TrackIds  []string `json:"trackIds,omitempty"`
	Expanded  int      `json:"expandedCells,omitempty"`
	PathCells int      `json:"pathCells,omitempty"`
}

type Result struct {
	Nets        []NetResult `json:"nets"`
	Created     int         `json:"created"`
	Failed      int         `json:"failed"`
	DryRun      bool        `json:"dryRun"`
	Verified    bool        `json:"verified"`
	Planner     string      `json:"planner,omitempty"`
	PitchMm     float64     `json:"gridMm,omitempty"`
	ClearanceMm float64     `json:"clearanceMm,omitempty"`
	Layers      []string    `json:"layers,omitempty"`
	Vias        int         `json:"vias,omitempty"`
	Note        string      `json:"note,omitempty"`
	Errors      []string    `json:"errors,omitempty"`
}

func Run(ctx context.Context, action string, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	document := p["document"]
	if document == nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "document is required"}
	}

	switch action {
	case "board.route.autoroute":
		return autoroute(ctx, p, dispatch, document)
	case "board.route.diff_pair":
		return diffPair(ctx, p, dispatch, document)
	case "board.route.length_report":
		return lengthReport(ctx, p, dispatch, document)
	case "board.route.tune_length":
		return tuneLength(ctx, p, dispatch, document)
	}

	return nil, &backend.Error{Code: "UNKNOWN_ACTION", Message: action}
}

func autoroute(ctx context.Context, p map[string]any, dispatch Dispatcher,
	document any) (*backend.Result, error) {
	planner := strings.ToLower(argString(p, "planner"))

	if planner == "grid" || planner == "obstacle" || argBool(p, "obstacleAware") {
		return gridAutoroute(ctx, p, dispatch, document)
	}

	dryRun := true
	if v, ok := p["dryRun"].(bool); ok {
		dryRun = v
	}

	widthMm := argFloatDefault(p, "widthMm", 0.25)
	if widthMm <= 0 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "widthMm must be positive"}
	}
	widthNm := int64(math.Round(widthMm * 1e6))
	wanted := stringSet(p["nets"])

	pads, err := loadPads(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	existingTracks, err := loadTracks(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	padMap, err := loadPadMap(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	geometry, err := loadObstacleGeometry(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	connectedNets := map[string]bool{}

	if proof, pErr := dispatch(ctx, "board.connectivity.prove", map[string]any{
		"document":           document,
		"requireFilledZones": false,
	}); pErr == nil && proof != nil {
		if data, ok := proof.Data.(map[string]any); ok {
			unconnected := stringSet(data["unconnectedNets"])

			for net := range pads {
				connectedNets[net] = !unconnected[net]
			}
		}
	}

	result := &Result{DryRun: dryRun, Verified: false,
		Note: "obstacle-checked L-router; run board.drc.run after routing"}

	var items []any
	var accepted []plannedSeg

	var nets []string

	for net := range pads {
		if len(wanted) > 0 && !wanted[net] {
			continue
		}
		nets = append(nets, net)
	}

	sort.Strings(nets)

	for _, net := range nets {
		list := pads[net]
		sort.Slice(list, func(i, j int) bool {
			if list[i].X != list[j].X {
				return list[i].X < list[j].X
			}
			return list[i].Y < list[j].Y
		})

		nr := NetResult{Net: net, PadCount: len(list)}

		if len(list) < 2 {
			nr.Reason = "fewer than two pads"
			result.Nets = append(result.Nets, nr)
			continue
		}

		if connectedNets[net] {
			nr.Reason = "already connected"
			result.Nets = append(result.Nets, nr)
			continue
		}

		for i := 0; i+1 < len(list); i++ {
			a, b := list[i], list[i+1]

			if a.Layer != b.Layer {
				nr.Skipped++
				nr.Reason = "pads on different layers; use --planner grid for via routing"
				continue
			}

			candidates := [][][2]point{
				lSegments(a.X, a.Y, b.X, b.Y),
				lSegmentsAlt(a.X, a.Y, b.X, b.Y),
			}

			chosen := -1
			conflict := ""

			for c, segments := range candidates {
				var planned []plannedSeg

				for _, seg := range segments {
					planned = append(planned,
						plannedSeg{from: seg[0], to: seg[1], net: net})
				}

				if cErr := pairConflict(planned, existingTracks, accepted, padMap,
					widthNm, a.Layer); cErr == "" {
					if eErr := edgeConflict(planned, geometry, widthNm); eErr == "" {
						chosen = c
						break
					} else {
						conflict = eErr
					}
				} else {
					conflict = cErr
				}
			}

			if chosen < 0 {
				nr.Skipped++
				nr.Reason = "both L directions are blocked: " + conflict
				continue
			}

			for _, seg := range candidates[chosen] {
				items = append(items, trackItem(seg[0], seg[1], widthNm, a.Layer, net))
				accepted = append(accepted,
					plannedSeg{from: seg[0], to: seg[1], net: net})
			}

			nr.Routed++
		}

		result.Nets = append(result.Nets, nr)
	}

	if dryRun {
		return &backend.Result{Action: "board.route.autoroute", OK: true, Data: result}, nil
	}
	if len(items) == 0 {
		out := &backend.Result{Action: "board.route.autoroute", OK: false, Data: result}
		out.Error = &backend.Error{Code: "ROUTE_NO_TRACKS",
			Message: "no routable pad pairs were found; see nets[].reason"}
		return out, nil
	}

	apply(ctx, dispatch, document, items, result)
	return routeResult("board.route.autoroute", result), nil
}

func diffPair(ctx context.Context, p map[string]any, dispatch Dispatcher,
	document any) (*backend.Result, error) {
	dryRun := true
	if v, ok := p["dryRun"].(bool); ok {
		dryRun = v
	}

	widthMm := argFloatDefault(p, "widthMm", 0.2)
	gapMm := argFloatDefault(p, "gapMm", 0.2)

	if widthMm <= 0 || gapMm <= 0 {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "widthMm and gapMm must be positive"}
	}

	widthNm := int64(math.Round(widthMm * 1e6))

	pairs, _ := p["pairs"].([]any)
	if len(pairs) == 0 {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "pairs[] is required (p_start/p_end/n_start/n_end)"}
	}

	padMap, err := loadPadMap(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	existingTracks, err := loadTracks(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	result := &Result{DryRun: dryRun, Verified: false,
		Note: fmt.Sprintf("parallel L-router; requested gap %.3f mm; run DRC and length tuning", gapMm)}

	var items []any
	var accepted []plannedSeg

	for _, raw := range pairs {
		pair, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		keys := []string{"p_start", "p_end", "n_start", "n_end"}
		refs := make([]Pad, 0, 4)
		valid := true

		for _, key := range keys {
			pad, ok := padMap[argString(pair, key)]
			if !ok {
				valid = false
				result.Errors = append(result.Errors,
					fmt.Sprintf("%s: unknown pad %q", key, argString(pair, key)))
				break
			}
			refs = append(refs, pad)
		}

		if !valid {
			continue
		}

		nr := NetResult{Net: refs[0].Net + "/" + refs[2].Net, PadCount: 4}

		pStart, pEnd := refs[0], refs[1]
		nStart, nEnd := refs[2], refs[3]

		if pStart.Net != pEnd.Net || nStart.Net != nEnd.Net {
			nr.Skipped++
			nr.Reason = "a pair pad does not match its partner's net"
			result.Errors = append(result.Errors,
				fmt.Sprintf("pair %s: P nets %q/%q, N nets %q/%q",
					nr.Net, pStart.Net, pEnd.Net, nStart.Net, nEnd.Net))
			result.Nets = append(result.Nets, nr)
			continue
		}
		if pStart.Net == nStart.Net {
			nr.Skipped++
			nr.Reason = "P and N pads are on the same net"
			result.Nets = append(result.Nets, nr)
			continue
		}
		if pStart.Layer != pEnd.Layer || nStart.Layer != nEnd.Layer ||
			pStart.Layer != nStart.Layer {
			nr.Skipped++
			nr.Reason = "pair pads are not all on the same layer"
			result.Nets = append(result.Nets, nr)
			continue
		}

		layer := pStart.Layer
		halfSpacing := (widthMm + gapMm) / 2

		// Centerline between the midpoints of each pad pair.
		mStart := point{X: (pStart.X + nStart.X) / 2, Y: (pStart.Y + nStart.Y) / 2}
		mEnd := point{X: (pEnd.X + nEnd.X) / 2, Y: (pEnd.Y + nEnd.Y) / 2}

		if mStart == mEnd {
			nr.Skipped++
			nr.Reason = "pad pairs share the same midpoint"
			result.Nets = append(result.Nets, nr)
			continue
		}

		// Try a direct diagonal first, then an L route.  Large pads often make
		// one of the two collide with the pad row; the conflict check below
		// rejects a candidate that would short.
		candidates := [][]point{{mStart, mEnd}}

		if mStart.X != mEnd.X && mStart.Y != mEnd.Y {
			candidates = append(candidates, []point{mStart, {mEnd.X, mStart.Y}, mEnd})
		}

		type pairPlan struct {
			items  []any
			segs   []plannedSeg
			routed int
		}

		planFor := func(center []point) pairPlan {
			ux, uy := unitVector(center[0], center[1])
			vx := float64(pStart.X - mStart.X)
			vy := float64(pStart.Y - mStart.Y)
			side := vx*(-uy) + vy*ux

			pOffset := halfSpacing
			nOffset := -halfSpacing

			if side < 0 {
				pOffset, nOffset = nOffset, pOffset
			}

			pPath := offsetPolyline(center, pOffset)
			nPath := offsetPolyline(center, nOffset)

			plan := pairPlan{}

			addPath := func(path []point, net string) {
				for i := 0; i+1 < len(path); i++ {
					if path[i] == path[i+1] {
						continue
					}

					plan.items = append(plan.items,
						trackItem(path[i], path[i+1], widthNm, layer, net))
					plan.segs = append(plan.segs,
						plannedSeg{from: path[i], to: path[i+1], net: net})
					plan.routed++
				}
			}

			addPath(pPath, pStart.Net)
			addPath(nPath, nStart.Net)

			fanIn := []struct {
				from point
				to   point
				net  string
			}{
				{point{X: pStart.X, Y: pStart.Y}, pPath[0], pStart.Net},
				{point{X: nStart.X, Y: nStart.Y}, nPath[0], nStart.Net},
				{pPath[len(pPath)-1], point{X: pEnd.X, Y: pEnd.Y}, pEnd.Net},
				{nPath[len(nPath)-1], point{X: nEnd.X, Y: nEnd.Y}, nEnd.Net},
			}

			for _, fan := range fanIn {
				if fan.from == fan.to {
					continue
				}

				plan.items = append(plan.items,
					trackItem(fan.from, fan.to, widthNm, layer, fan.net))
				plan.segs = append(plan.segs,
					plannedSeg{from: fan.from, to: fan.to, net: fan.net})
				plan.routed++
			}

			return plan
		}

		var chosen *pairPlan
		var conflicts []string

		for _, center := range candidates {
			plan := planFor(center)

			if conflict := pairConflict(plan.segs, existingTracks, accepted, padMap,
				widthNm, layer); conflict != "" {
				conflicts = append(conflicts, conflict)
				continue
			}

			chosen = &plan
			break
		}

		if chosen == nil {
			nr.Skipped++
			nr.Reason = strings.Join(conflicts, "; ")
			result.Errors = append(result.Errors, nr.Net+": "+nr.Reason)
			result.Nets = append(result.Nets, nr)
			continue
		}

		items = append(items, chosen.items...)
		accepted = append(accepted, chosen.segs...)
		nr.Routed = chosen.routed
		result.Nets = append(result.Nets, nr)
	}

	if dryRun {
		return &backend.Result{Action: "board.route.diff_pair", OK: true, Data: result}, nil
	}

	apply(ctx, dispatch, document, items, result)
	return routeResult("board.route.diff_pair", result), nil
}

func lengthReport(ctx context.Context, p map[string]any, dispatch Dispatcher,
	document any) (*backend.Result, error) {
	document = p["document"]
	net := argString(p, "net")
	targetMm := argFloatDefault(p, "targetMm", 0)

	tracks, err := loadTracks(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	total := 0.0
	segments := 0

	for _, track := range tracks {
		if net != "" && track.Net != net {
			continue
		}

		total += track.LengthMm
		segments++
	}

	result := map[string]any{
		"net": net, "segments": segments, "lengthMm": total,
	}
	if targetMm > 0 {
		result["targetMm"] = targetMm
		result["deficitMm"] = math.Max(0, targetMm-total)
	}

	return &backend.Result{Action: "board.route.length_report", OK: true, Data: result}, nil
}

// tuneLength replaces the longest straight segment of a net with a rectangular
// serpentine so the routed length approaches the requested target.
func tuneLength(ctx context.Context, p map[string]any, dispatch Dispatcher,
	document any) (*backend.Result, error) {
	dryRun := true
	if v, ok := p["dryRun"].(bool); ok {
		dryRun = v
	}

	net := argString(p, "net")
	if net == "" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "net is required"}
	}

	target := argFloatDefault(p, "targetMm", 0)
	if target <= 0 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "targetMm is required"}
	}

	amplitude := argFloatDefault(p, "amplitudeMm", 0.5)
	spacing := argFloatDefault(p, "spacingMm", 0.5)

	if amplitude <= 0 || spacing <= 0 {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "amplitudeMm and spacingMm must be positive"}
	}

	tracks, err := loadTracks(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	current := 0.0
	var segment *trackInfo

	for i := range tracks {
		if tracks[i].Net != net {
			continue
		}

		current += tracks[i].LengthMm

		if segment == nil || tracks[i].LengthMm > segment.LengthMm {
			segment = &tracks[i]
		}
	}

	result := map[string]any{
		"net": net, "currentMm": current, "targetMm": target,
		"dryRun": dryRun, "verified": false,
	}

	extra := target - current

	if extra <= 0.01 {
		result["status"] = "already_met"
		result["extraMm"] = 0.0
		return &backend.Result{Action: "board.route.tune_length", OK: true, Data: result}, nil
	}

	result["extraMm"] = extra

	if segment == nil || segment.LengthMm <= 0 || segment.ID == "" {
		return nil, &backend.Error{Code: "NO_TRACK",
			Message: fmt.Sprintf("no track found for net %q", net)}
	}

	lengthMm := segment.LengthMm
	usable := lengthMm - 1.0 // 0.5 mm lead-in and lead-out

	if usable < 0.2 {
		result["status"] = "insufficient_straight_length"
		result["requiredMm"] = extra
		return &backend.Result{Action: "board.route.tune_length", OK: true, Data: result}, nil
	}

	teeth := int(math.Ceil(extra / (2 * amplitude)))
	if teeth < 1 {
		teeth = 1
	}

	pitch := spacing

	if float64(teeth)*pitch > usable {
		pitch = usable / float64(teeth)
	}

	if pitch < 0.2 {
		teeth = int(math.Floor(usable / 0.2))
		if teeth < 1 {
			result["status"] = "insufficient_straight_length"
			return &backend.Result{Action: "board.route.tune_length", OK: true, Data: result}, nil
		}
		pitch = usable / float64(teeth)
	}

	toothAmplitude := extra / (2 * float64(teeth))

	if toothAmplitude < 0.05 {
		result["status"] = "amplitude_too_small"
		return &backend.Result{Action: "board.route.tune_length", OK: true, Data: result}, nil
	}

	if toothAmplitude > 2*amplitude {
		result["status"] = "insufficient_straight_length"
		result["requiredAmplitudeMm"] = toothAmplitude
		return &backend.Result{Action: "board.route.tune_length", OK: true, Data: result}, nil
	}

	lead := (lengthMm - float64(teeth)*pitch) / 2

	sx := float64(segment.StartX)
	sy := float64(segment.StartY)
	ux := float64(segment.EndX-segment.StartX) / (lengthMm * 1e6)
	uy := float64(segment.EndY-segment.StartY) / (lengthMm * 1e6)
	px := -uy
	py := ux

	pointAt := func(t, offset float64) point {
		return point{
			X: int64(math.Round(sx + (ux*t+px*offset)*1e6)),
			Y: int64(math.Round(sy + (uy*t+py*offset)*1e6)),
		}
	}

	points := []point{{X: segment.StartX, Y: segment.StartY}}
	t := lead

	for i := 0; i < teeth; i++ {
		sign := 1.0
		if i%2 == 1 {
			sign = -1
		}

		points = append(points,
			pointAt(t, 0),
			pointAt(t, sign*toothAmplitude),
			pointAt(t+pitch, sign*toothAmplitude),
			pointAt(t+pitch, 0))

		t += pitch
	}

	points = append(points, point{X: segment.EndX, Y: segment.EndY})

	// Remove consecutive duplicates so no zero-length track is emitted.
	clean := make([]point, 0, len(points))

	for _, pt := range points {
		if len(clean) == 0 || clean[len(clean)-1] != pt {
			clean = append(clean, pt)
		}
	}

	var items []any

	for i := 0; i+1 < len(clean); i++ {
		items = append(items, trackItem(clean[i], clean[i+1], segment.WidthNm,
			segment.Layer, net))
	}

	plannedLength := 0.0
	for i := 0; i+1 < len(clean); i++ {
		dx := float64(clean[i+1].X-clean[i].X) / 1e6
		dy := float64(clean[i+1].Y-clean[i].Y) / 1e6
		plannedLength += math.Hypot(dx, dy)
	}

	expectedLength := lengthMm + extra

	result["plannedLengthMm"] = plannedLength
	result["expectedLengthMm"] = expectedLength

	if math.Abs(plannedLength-expectedLength) > math.Max(0.01, 0.002*expectedLength) {
		result["status"] = "plan_mismatch"
		out := &backend.Result{Action: "board.route.tune_length", OK: false, Data: result}
		out.Error = &backend.Error{Code: "TUNE_PLAN_MISMATCH",
			Message: "the planned serpentine length does not match the requested target"}
		return out, nil
	}

	result["status"] = "planned"
	result["teeth"] = teeth
	result["amplitudeMm"] = toothAmplitude
	result["spacingMm"] = pitch
	result["plannedTracks"] = len(items)
	result["segment"] = map[string]any{
		"id": segment.ID, "layer": segment.Layer,
		"start": map[string]any{"x_nm": segment.StartX, "y_nm": segment.StartY},
		"end":   map[string]any{"x_nm": segment.EndX, "y_nm": segment.EndY},
	}

	if dryRun {
		return &backend.Result{Action: "board.route.tune_length", OK: true, Data: result}, nil
	}

	var applyResult Result
	apply(ctx, dispatch, document, items, &applyResult)

	result["created"] = applyResult.Created
	result["failed"] = applyResult.Failed

	if applyResult.Failed > 0 || applyResult.Created == 0 {
		result["status"] = "create_failed"
		out := &backend.Result{Action: "board.route.tune_length", OK: false, Data: result}
		out.Error = &backend.Error{Code: "TUNE_CREATE_FAILED",
			Message: "failed to create the serpentine tracks"}
		return out, nil
	}

	deleteRes, deleteErr := dispatch(ctx, "board.items.delete", map[string]any{
		"document": document,
		"ids":      []string{segment.ID},
	})

	if deleteErr != nil || deleteRes == nil || !deleteRes.OK {
		result["status"] = "delete_failed"
		result["deleted"] = false

		out := &backend.Result{Action: "board.route.tune_length", OK: false, Data: result}
		out.Error = &backend.Error{Code: "TUNE_DELETE_FAILED",
			Message: "serpentine created but the original straight track was not deleted"}
		return out, nil
	}

	result["deleted"] = true
	result["status"] = "tuned"
	result["verified"] = false

	if after, err := loadTracks(ctx, dispatch, document); err == nil {
		lengthAfter := 0.0

		for _, track := range after {
			if track.Net == net {
				lengthAfter += track.LengthMm
			}
		}

		result["verifiedLengthMm"] = lengthAfter
		result["verified"] = math.Abs(lengthAfter-target) <= math.Max(0.05, 0.01*target)

		if !result["verified"].(bool) {
			result["status"] = "tuned_unverified"
		}
	}

	return &backend.Result{Action: "board.route.tune_length", OK: true, Data: result}, nil
}

type plannedSeg struct {
	from point
	to   point
	net  string
}

// pairConflict reports copper of another net that a planned pair would short.
func pairConflict(segs []plannedSeg, existing []trackInfo, accepted []plannedSeg,
	pads map[string]Pad, widthNm int64, layer string) string {
	for _, seg := range segs {
		for _, track := range existing {
			if track.Layer != layer || track.Net == seg.net {
				continue
			}

			threshold := float64(widthNm+track.WidthNm) / 2
			gap := segmentGap(seg.from, seg.to,
				point{X: track.StartX, Y: track.StartY},
				point{X: track.EndX, Y: track.EndY})

			if gap < threshold {
				return fmt.Sprintf("would short to existing track on net %q", track.Net)
			}
		}

		for _, other := range accepted {
			if other.net == seg.net {
				continue
			}

			if segmentGap(seg.from, seg.to, other.from, other.to) < float64(widthNm) {
				return fmt.Sprintf("would short to a previously planned track on net %q", other.net)
			}
		}

		for _, pad := range pads {
			if pad.Layer != layer || pad.Net == "" || pad.Net == seg.net {
				continue
			}

			gap := segmentRectGap(seg.from, seg.to, pad)
			threshold := float64(widthNm) / 2

			if gap < threshold {
				return fmt.Sprintf("would short to pad %s.%s on net %q",
					pad.Ref, pad.Number, pad.Net)
			}
		}
	}

	return ""
}

// segmentRectGap is the distance from a segment to an axis-aligned pad box.
func segmentRectGap(a, b point, pad Pad) float64 {
	hx := float64(pad.SizeX) / 2
	hy := float64(pad.SizeY) / 2
	cx, cy := float64(pad.X), float64(pad.Y)

	inside := func(x, y float64) bool {
		return math.Abs(x-cx) <= hx && math.Abs(y-cy) <= hy
	}

	if inside(float64(a.X), float64(a.Y)) || inside(float64(b.X), float64(b.Y)) {
		return 0
	}

	corners := [4]point{
		{X: int64(cx - hx), Y: int64(cy - hy)},
		{X: int64(cx + hx), Y: int64(cy - hy)},
		{X: int64(cx + hx), Y: int64(cy + hy)},
		{X: int64(cx - hx), Y: int64(cy + hy)},
	}

	for i := 0; i < 4; i++ {
		if segmentsIntersect(a, b, corners[i], corners[(i+1)%4]) {
			return 0
		}
	}

	best := pointRectDistance(float64(a.X), float64(a.Y), cx, cy, hx, hy)
	best = math.Min(best, pointRectDistance(float64(b.X), float64(b.Y), cx, cy, hx, hy))

	for _, corner := range corners {
		best = math.Min(best, pointSegmentDistance(float64(corner.X), float64(corner.Y),
			float64(a.X), float64(a.Y), float64(b.X), float64(b.Y)))
	}

	return best
}

func pointRectDistance(px, py, cx, cy, hx, hy float64) float64 {
	dx := math.Max(math.Abs(px-cx)-hx, 0)
	dy := math.Max(math.Abs(py-cy)-hy, 0)
	return math.Hypot(dx, dy)
}

func edgeConflict(segs []plannedSeg, geometry *obstacleGeometry, widthNm int64) string {
	threshold := float64(widthNm) / 2

	for _, seg := range segs {
		for _, edge := range geometry.Edges {
			if segmentGap(seg.from, seg.to,
				point{X: edge.X1, Y: edge.Y1}, point{X: edge.X2, Y: edge.Y2}) < threshold {
				return "would cross the board edge or a cutout"
			}
		}

		for _, circle := range geometry.Circles {
			if circle.Radius <= 0 {
				continue
			}

			minDist, maxDist := segmentCircleRange(seg.from, seg.to, circle.X, circle.Y)

			if minDist <= float64(circle.Radius)+threshold &&
				maxDist >= float64(circle.Radius)-threshold {
				return "would cross a circular board cutout"
			}
		}

		for _, area := range geometry.Areas {
			if len(area.Points) < 3 {
				continue
			}

			if pointInPolygon(float64(seg.from.X), float64(seg.from.Y), area.Points) ||
				pointInPolygon(float64(seg.to.X), float64(seg.to.Y), area.Points) {
				return "would enter a rule area"
			}

			for i := 0; i < len(area.Points); i++ {
				a := area.Points[i]
				b := area.Points[(i+1)%len(area.Points)]

				if segmentGap(seg.from, seg.to, a, b) < threshold {
					return "would cross a rule-area boundary"
				}
			}
		}
	}

	return ""
}

func segmentCircleRange(a, b point, cx, cy int64) (float64, float64) {
	d1 := math.Hypot(float64(a.X-cx), float64(a.Y-cy))
	d2 := math.Hypot(float64(b.X-cx), float64(b.Y-cy))
	minDist := math.Min(d1, d2)
	maxDist := math.Max(d1, d2)

	segmentLength := math.Hypot(float64(b.X-a.X), float64(b.Y-a.Y))

	if segmentLength > 0 {
		// Distance from the circle centre to the infinite line, then clamp to
		// the segment.
		cross := math.Abs(float64((b.X-a.X)*(cy-a.Y)-(b.Y-a.Y)*(cx-a.X))) / segmentLength

		dot := float64((cx-a.X)*(b.X-a.X)+(cy-a.Y)*(b.Y-a.Y)) / (segmentLength * segmentLength)

		if dot >= 0 && dot <= 1 {
			minDist = math.Min(minDist, cross)
		}
	}

	return minDist, maxDist
}

func segmentGap(a, b, c, d point) float64 {
	if segmentsIntersect(a, b, c, d) {
		return 0
	}

	best := pointSegmentDistance(float64(a.X), float64(a.Y), float64(c.X), float64(c.Y), float64(d.X), float64(d.Y))
	best = math.Min(best, pointSegmentDistance(float64(b.X), float64(b.Y), float64(c.X), float64(c.Y), float64(d.X), float64(d.Y)))
	best = math.Min(best, pointSegmentDistance(float64(c.X), float64(c.Y), float64(a.X), float64(a.Y), float64(b.X), float64(b.Y)))
	best = math.Min(best, pointSegmentDistance(float64(d.X), float64(d.Y), float64(a.X), float64(a.Y), float64(b.X), float64(b.Y)))

	return best
}

func segmentsIntersect(a, b, c, d point) bool {
	orient := func(p, q, r point) int64 {
		value := (q.Y-p.Y)*(r.X-q.X) - (q.X-p.X)*(r.Y-q.Y)

		if value > 0 {
			return 1
		}
		if value < 0 {
			return -1
		}
		return 0
	}

	o1, o2 := orient(a, b, c), orient(a, b, d)
	o3, o4 := orient(c, d, a), orient(c, d, b)

	return o1 != o2 && o3 != o4
}

func routeResult(action string, result *Result) *backend.Result {
	out := &backend.Result{Action: action, OK: result.Failed == 0 && result.Created > 0, Data: result}

	if result.Failed > 0 {
		out.Error = &backend.Error{Code: "ROUTE_PARTIAL",
			Message: fmt.Sprintf("%d track(s) failed to create", result.Failed)}
	} else if result.Created == 0 {
		out.Error = &backend.Error{Code: "ROUTE_NO_TRACKS",
			Message: "no tracks were created"}
	}

	return out
}

func apply(ctx context.Context, dispatch Dispatcher, document any, items []any, result *Result) {
	const chunkSize = 50

	for start := 0; start < len(items); start += chunkSize {
		end := start + chunkSize
		if end > len(items) {
			end = len(items)
		}

		chunk := items[start:end]

		res, err := dispatch(ctx, "board.items.create", map[string]any{
			"document": document,
			"items":    chunk,
		})

		if err != nil {
			result.Failed += len(chunk)
			result.Errors = append(result.Errors, err.Error())
			continue
		}
		if res == nil || !res.OK {
			result.Failed += len(chunk)
			if res != nil && res.Error != nil {
				result.Errors = append(result.Errors, res.Error.Code+": "+res.Error.Message)
			}
			continue
		}

		result.Created += len(chunk)
	}
}

type point struct{ X, Y int64 }

func lSegmentsAlt(x1, y1, x2, y2 int64) [][2]point {
	var out [][2]point

	if y1 != y2 {
		out = append(out, [2]point{{x1, y1}, {x1, y2}})
	}
	if x1 != x2 {
		out = append(out, [2]point{{x1, y2}, {x2, y2}})
	}

	return out
}

func lSegments(x1, y1, x2, y2 int64) [][2]point {
	var out [][2]point

	if x1 != x2 {
		out = append(out, [2]point{{x1, y1}, {x2, y1}})
	}
	if y1 != y2 {
		out = append(out, [2]point{{x2, y1}, {x2, y2}})
	}

	return out
}

func unitVector(a, b point) (float64, float64) {
	dx := float64(b.X - a.X)
	dy := float64(b.Y - a.Y)
	length := math.Hypot(dx, dy)

	if length < 1e-9 {
		return 1, 0
	}

	return dx / length, dy / length
}

// offsetPolyline shifts a polyline by a signed perpendicular distance (mm),
// using a miter at interior vertices.
func offsetPolyline(points []point, offset float64) []point {
	n := len(points)
	if n < 2 || offset == 0 {
		return append([]point{}, points...)
	}

	dirs := make([][2]float64, n-1)

	for i := 0; i+1 < n; i++ {
		dirs[i][0], dirs[i][1] = unitVector(points[i], points[i+1])
	}

	out := make([]point, n)

	for i := 0; i < n; i++ {
		var nx, ny float64

		switch {
		case i == 0:
			nx, ny = -dirs[0][1], dirs[0][0]
		case i == n-1:
			nx, ny = -dirs[n-2][1], dirs[n-2][0]
		default:
			p1x, p1y := -dirs[i-1][1], dirs[i-1][0]
			p2x, p2y := -dirs[i][1], dirs[i][0]
			mx, my := p1x+p2x, p1y+p2y
			ml := math.Hypot(mx, my)

			if ml < 1e-9 {
				nx, ny = p1x, p1y
			} else {
				mx /= ml
				my /= ml
				d := mx*p1x + my*p1y
				if math.Abs(d) < 1e-9 {
					d = 1
				}
				nx, ny = mx/d, my/d
			}
		}

		out[i] = point{
			X: points[i].X + int64(math.Round(nx*offset*1e6)),
			Y: points[i].Y + int64(math.Round(ny*offset*1e6)),
		}
	}

	return out
}

func trackItem(a, b point, widthNm int64, layer, net string) map[string]any {
	return map[string]any{
		"type": "track",
		"json": map[string]any{
			"start": map[string]any{"x_nm": a.X, "y_nm": a.Y},
			"end":   map[string]any{"x_nm": b.X, "y_nm": b.Y},
			"width": map[string]any{"value_nm": widthNm},
			"layer": layer,
			"net":   map[string]any{"name": net},
		},
	}
}

func loadPads(ctx context.Context, dispatch Dispatcher, document any) (map[string][]Pad, error) {
	padMap, err := loadPadMap(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	out := map[string][]Pad{}

	for _, pad := range padMap {
		if pad.Net == "" {
			continue
		}
		out[pad.Net] = append(out[pad.Net], pad)
	}

	return out, nil
}

func loadPadMap(ctx context.Context, dispatch Dispatcher, document any) (map[string]Pad, error) {
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

	out := map[string]Pad{}

	for _, raw := range items {
		footprint, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		ref := referenceOf(footprint)
		definition, _ := footprint["definition"].(map[string]any)
		defItems, _ := definition["items"].([]any)

		for _, rawPad := range defItems {
			padItem, ok := rawPad.(map[string]any)
			if !ok || !strings.HasSuffix(argString(padItem, "@type"), ".Pad") {
				continue
			}

			pos, _ := padItem["position"].(map[string]any)
			padStack, _ := padItem["padStack"].(map[string]any)
			layers, _ := padStack["layers"].([]any)
			copperLayers, _ := padStack["copperLayers"].([]any)

			layer := "BL_F_Cu"
			for _, rawLayer := range layers {
				if name, _ := rawLayer.(string); strings.HasSuffix(name, "_Cu") {
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

			netObj, _ := padItem["net"].(map[string]any)
			number := argString(padItem, "number")

			pad := Pad{
				Ref: ref, Number: number, Net: argString(netObj, "name"),
				Layer: layer, X: numeric(pos["xNm"]), Y: numeric(pos["yNm"]),
				SizeX: sizeX, SizeY: sizeY,
			}

			out[ref+"."+number] = pad
		}
	}

	return out, nil
}

type trackInfo struct {
	ID       string
	Net      string
	Layer    string
	StartX   int64
	StartY   int64
	EndX     int64
	EndY     int64
	WidthNm  int64
	LengthMm float64
}

func loadTracks(ctx context.Context, dispatch Dispatcher, document any) ([]trackInfo, error) {
	res, err := dispatch(ctx, "board.items.get", map[string]any{
		"document": document,
		"types":    []string{"KOT_PCB_TRACE", "KOT_PCB_ARC"},
	})
	if err != nil {
		return nil, err
	}
	if res == nil || !res.OK {
		return nil, &backend.Error{Code: "GET_TRACKS_FAILED",
			Message: "failed to read board tracks"}
	}

	data, _ := res.Data.(map[string]any)
	items, _ := data["items"].([]any)

	var out []trackInfo

	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		start, _ := item["start"].(map[string]any)
		end, _ := item["end"].(map[string]any)
		mid, _ := item["mid"].(map[string]any)
		netObj, _ := item["net"].(map[string]any)
		idObj, _ := item["id"].(map[string]any)
		widthObj, _ := item["width"].(map[string]any)

		sx, sy := numeric(start["xNm"]), numeric(start["yNm"])
		ex, ey := numeric(end["xNm"]), numeric(end["yNm"])

		length := 0.0

		if strings.HasSuffix(argString(item, "@type"), ".Arc") && mid != nil {
			length = arcLengthMm(sx, sy, numeric(mid["xNm"]), numeric(mid["yNm"]), ex, ey)
		} else {
			dx := float64(ex-sx) / 1e6
			dy := float64(ey-sy) / 1e6
			length = math.Hypot(dx, dy)
		}

		out = append(out, trackInfo{
			ID:       argString(idObj, "value"),
			Net:      argString(netObj, "name"),
			Layer:    argString(item, "layer"),
			StartX:   sx,
			StartY:   sy,
			EndX:     ex,
			EndY:     ey,
			WidthNm:  numeric(widthObj["valueNm"]),
			LengthMm: length,
		})
	}

	return out, nil
}

// arcLengthMm returns the length of the circular arc through start, mid, end.
func arcLengthMm(ax, ay, bx, by, cx, cy int64) float64 {
	axm, aym := float64(ax)/1e6, float64(ay)/1e6
	bxm, bym := float64(bx)/1e6, float64(by)/1e6
	cxm, cym := float64(cx)/1e6, float64(cy)/1e6

	ab := math.Hypot(bxm-axm, bym-aym)
	bc := math.Hypot(cxm-bxm, cym-bym)
	ca := math.Hypot(cxm-axm, cym-aym)
	area := math.Abs((bxm-axm)*(cym-aym)-(cxm-axm)*(bym-aym)) / 2

	if area < 1e-9 || ab < 1e-9 || bc < 1e-9 || ca < 1e-9 {
		return ca
	}

	radius := ab * bc * ca / (4 * area)

	// Circumcenter.
	d := 2 * (axm*(bym-cym) + bxm*(cym-aym) + cxm*(aym-bym))
	ux := ((axm*axm+aym*aym)*(bym-cym) + (bxm*bxm+bym*bym)*(cym-aym) + (cxm*cxm+cym*cym)*(aym-bym)) / d
	uy := ((axm*axm+aym*aym)*(cxm-bxm) + (bxm*bxm+bym*bym)*(axm-cxm) + (cxm*cxm+cym*cym)*(bxm-axm)) / d

	angle := func(x, y float64) float64 {
		a := math.Atan2(y-uy, x-ux)
		if a < 0 {
			a += 2 * math.Pi
		}
		return a
	}

	ccw := func(from, to float64) float64 {
		delta := to - from
		for delta < 0 {
			delta += 2 * math.Pi
		}
		return delta
	}

	a0, am, a1 := angle(axm, aym), angle(bxm, bym), angle(cxm, cym)
	sweep := ccw(a0, a1)

	// If the midpoint is not on the counter-clockwise arc, take the other one.
	if ccw(a0, am) > sweep {
		sweep = 2*math.Pi - sweep
	}

	return radius * sweep
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

func stringSet(raw any) map[string]bool {
	out := map[string]bool{}

	switch v := raw.(type) {
	case []any:
		for _, item := range v {
			if s, ok := item.(string); ok {
				if s = strings.TrimSpace(s); s != "" {
					out[s] = true
				}
			}
		}
	case []string:
		for _, s := range v {
			if s = strings.TrimSpace(s); s != "" {
				out[s] = true
			}
		}
	case string:
		for _, s := range strings.Split(v, ",") {
			if s = strings.TrimSpace(s); s != "" {
				out[s] = true
			}
		}
	}

	return out
}

func argStrings(p map[string]any, key string) []string {
	switch v := p[key].(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))

		for _, item := range v {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				out = append(out, strings.TrimSpace(s))
			}
		}
		return out
	case string:
		if strings.TrimSpace(v) == "" {
			return nil
		}
		return []string{strings.TrimSpace(v)}
	}
	return nil
}

func argBool(p map[string]any, key string) bool {
	if v, ok := p[key].(bool); ok {
		return v
	}
	return false
}

func argString(p map[string]any, key string) string {
	if v, ok := p[key].(string); ok {
		return v
	}
	return ""
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
		i, err := strconv.ParseInt(strings.TrimSpace(n), 10, 64)
		return i, err == nil
	}
	return 0, false
}
