// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

var powerNet = regexp.MustCompile(`(?i)(^|[/_+\-])(VCC|VDD|AVDD|DVDD|VDDIO|VDDQ|VBAT|VIN|VSYS|VCORE|VREF|VPP|PVDD|\d+V\d*|V\d+P\d+)`)
var groundNet = regexp.MustCompile(`(?i)(^|[/_])(GND|AGND|DGND|PGND|VSS|0V)\b`)

type powerPin struct {
	IC    string
	Pin   string
	Net   string
	Pos   point
	Layer string
}

type decapFinding struct {
	IC         string  `json:"ic"`
	Pin        string  `json:"pin"`
	Net        string  `json:"net"`
	Capacitor  string  `json:"capacitor,omitempty"`
	DistanceMm float64 `json:"distanceMm,omitempty"`
	Problem    string  `json:"problem"`
	XMm        float64 `json:"xMm"`
	YMm        float64 `json:"yMm"`
}

type capPad struct {
	Ref string
	Net string
	Pos point
}

func isPowerPin(pad padInfo) bool {
	if pad.Net == "" || groundNet.MatchString(pad.Net) {
		return false
	}
	switch pad.PinType {
	case "EPT_POWER_INPUT", "EPT_POWER_OUTPUT":
		return true
	}
	return powerNet.MatchString(pad.Net)
}

// collectDecap returns the IC power pins and every capacitor pad.
func collectDecap(fps []map[string]any, p map[string]any) ([]powerPin, []capPad, map[string]map[string]any) {
	icPrefixes := map[string]bool{"U": true, "IC": true}
	if list := argStrings(p, "icPrefixes"); len(list) > 0 {
		icPrefixes = map[string]bool{}
		for _, s := range list {
			icPrefixes[strings.ToUpper(s)] = true
		}
	}
	onlyICs := map[string]bool{}
	for _, s := range argStrings(p, "ics") {
		onlyICs[strings.ToUpper(s)] = true
	}
	onlyNets := map[string]bool{}
	for _, s := range argStrings(p, "nets") {
		onlyNets[s] = true
	}
	byRef := map[string]map[string]any{}
	var pins []powerPin
	var caps []capPad
	for _, fp := range fps {
		ref := referenceOf(fp)
		byRef[ref] = fp
		prefix := refPrefix(ref)
		for _, pad := range padsOf(fp) {
			switch {
			case prefix == "C":
				if pad.Net != "" {
					caps = append(caps, capPad{ref, pad.Net, pad.Pos})
				}
			case icPrefixes[prefix] && isPowerPin(pad):
				if len(onlyICs) > 0 && !onlyICs[strings.ToUpper(ref)] {
					continue
				}
				if len(onlyNets) > 0 && !onlyNets[pad.Net] {
					continue
				}
				pins = append(pins, powerPin{ref, pad.Number, pad.Net, pad.Pos, argString(fp, "layer")})
			}
		}
	}
	return pins, caps, byRef
}

func decapCheck(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.decap.check"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	fps, err := footprints(ctx, dispatch, doc)
	if err != nil {
		return nil, err
	}
	maxNm := float64(mmToNm(argFloat(p, "maxDistanceMm", 3.0)))
	pins, caps, _ := collectDecap(fps, p)
	findings, nearest := evaluateDecap(pins, caps, maxNm)
	result := map[string]any{"powerPins": len(pins), "capacitorPads": len(caps),
		"maxDistanceMm": nmToMm(int64(maxNm)), "findings": findings, "nearest": nearest,
		"note": "power pins are pads with a power pin type or a power-like net name; ground nets are excluded"}
	if len(findings) > 0 {
		result["status"] = "violations"
	} else {
		result["status"] = "clean"
	}
	return ok(action, result), nil
}

func evaluateDecap(pins []powerPin, caps []capPad, maxNm float64) ([]decapFinding, []decapFinding) {
	var findings, nearest []decapFinding
	for _, pin := range pins {
		best, bestRef := math.Inf(1), ""
		for _, c := range caps {
			if c.Net != pin.Net {
				continue
			}
			if d := dist(pin.Pos, c.Pos); d < best {
				best, bestRef = d, c.Ref
			}
		}
		f := decapFinding{IC: pin.IC, Pin: pin.Pin, Net: pin.Net, Capacitor: bestRef,
			XMm: nmToMm(pin.Pos.X), YMm: nmToMm(pin.Pos.Y)}
		switch {
		case bestRef == "":
			f.Problem = "no capacitor on this net"
			findings = append(findings, f)
		case best > maxNm:
			f.DistanceMm = math.Round(best/1e3) / 1e3
			f.Problem = "nearest decoupling capacitor too far"
			findings = append(findings, f)
		default:
			f.DistanceMm = math.Round(best/1e3) / 1e3
			f.Problem = ""
			nearest = append(nearest, f)
		}
	}
	return findings, nearest
}

// translateItem shifts every absolute coordinate in a read-back footprint by
// (dx, dy).  Sizes, drill diameters and relative offsets are left alone.
func translateItem(v any, dx, dy int64) {
	positional := map[string]bool{"position": true, "start": true, "end": true, "center": true,
		"radiusPoint": true, "mid": true, "topLeft": true, "bottomRight": true, "point": true,
		"control1": true, "control2": true}
	var walk func(any)
	walk = func(node any) {
		switch n := node.(type) {
		case map[string]any:
			for key, child := range n {
				if positional[key] {
					if m, ok := child.(map[string]any); ok && hasKey(m, "xNm") && hasKey(m, "yNm") {
						m["xNm"] = num(m["xNm"]) + dx
						m["yNm"] = num(m["yNm"]) + dy
						continue
					}
				}
				walk(child)
			}
		case []any:
			for _, child := range n {
				walk(child)
			}
		}
	}
	walk(v)
}

// decapPlace moves the nearest unassigned capacitor on each failing power net
// next to its pin.  Dry-run by default.  Applied moves are verified by
// readback and, unless skipDrc is set, by live DRC; if the violation count
// rises, every move is reverted.
func decapPlace(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.decap.place"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	fps, err := footprints(ctx, dispatch, doc)
	if err != nil {
		return nil, err
	}
	maxNm := float64(mmToNm(argFloat(p, "maxDistanceMm", 3.0)))
	offset := mmToNm(argFloat(p, "offsetMm", 1.0))
	pins, caps, byRef := collectDecap(fps, p)
	findings, satisfied := evaluateDecap(pins, caps, maxNm)

	claimed := map[string]bool{}
	for _, f := range satisfied {
		claimed[f.Capacitor] = true
	}
	ids := []string{}
	for _, fp := range fps {
		ids = append(ids, itemID(fp))
	}
	boxes, err := itemBoxes(ctx, dispatch, doc, ids)
	if err != nil {
		return nil, err
	}
	refBox := map[string]box{}
	for ref, fp := range byRef {
		if b, ok := boxes[itemID(fp)]; ok {
			refBox[ref] = b
		}
	}

	type move struct {
		Capacitor string  `json:"capacitor"`
		IC        string  `json:"ic"`
		Pin       string  `json:"pin"`
		Net       string  `json:"net"`
		FromXMm   float64 `json:"fromXMm"`
		FromYMm   float64 `json:"fromYMm"`
		ToXMm     float64 `json:"toXMm"`
		ToYMm     float64 `json:"toYMm"`
		dx, dy    int64
	}
	var moves []move
	var unresolved []decapFinding
	sort.Slice(findings, func(i, j int) bool { return findings[i].IC+findings[i].Pin < findings[j].IC+findings[j].Pin })
	for _, f := range findings {
		var cand string
		best := math.Inf(1)
		var pinPos point
		for _, pin := range pins {
			if pin.IC == f.IC && pin.Pin == f.Pin {
				pinPos = pin.Pos
			}
		}
		for _, c := range caps {
			if c.Net != f.Net || claimed[c.Ref] {
				continue
			}
			if d := dist(pinPos, c.Pos); d < best {
				best, cand = d, c.Ref
			}
		}
		icBox, icOK := refBox[f.IC]
		capFp := byRef[cand]
		capBox, capOK := refBox[cand]
		if cand == "" || !icOK || !capOK || capFp == nil {
			f.Problem += "; no free capacitor to move"
			unresolved = append(unresolved, f)
			continue
		}
		center := point{(icBox.MinX + icBox.MaxX) / 2, (icBox.MinY + icBox.MaxY) / 2}
		dirX, dirY := float64(pinPos.X-center.X), float64(pinPos.Y-center.Y)
		if l := math.Hypot(dirX, dirY); l > 0 {
			dirX, dirY = dirX/l, dirY/l
		} else {
			dirX, dirY = 1, 0
		}
		capPos, _ := positionOf(capFp)
		halfW := float64(capBox.MaxX-capBox.MinX) / 2
		halfH := float64(capBox.MaxY-capBox.MinY) / 2
		placed := false
		for _, rot := range []float64{0, math.Pi / 2, -math.Pi / 2, math.Pi / 4, -math.Pi / 4} {
			ux := dirX*math.Cos(rot) - dirY*math.Sin(rot)
			uy := dirX*math.Sin(rot) + dirY*math.Cos(rot)
			reach := float64(offset) + math.Abs(ux)*halfW + math.Abs(uy)*halfH
			target := point{pinPos.X + int64(ux*reach), pinPos.Y + int64(uy*reach)}
			dx, dy := target.X-capPos.X, target.Y-capPos.Y
			moved := box{capBox.MinX + dx, capBox.MinY + dy, capBox.MaxX + dx, capBox.MaxY + dy}
			clash := false
			for ref, b := range refBox {
				if ref == cand {
					continue
				}
				if moved.overlaps(b.grow(mmToNm(0.2))) && ref != f.IC {
					clash = true
					break
				}
				if ref == f.IC && moved.overlaps(b) {
					clash = true
					break
				}
			}
			if !clash {
				moves = append(moves, move{cand, f.IC, f.Pin, f.Net, nmToMm(capPos.X), nmToMm(capPos.Y),
					nmToMm(target.X), nmToMm(target.Y), dx, dy})
				refBox[cand] = moved
				claimed[cand] = true
				placed = true
				break
			}
		}
		if !placed {
			f.Problem += "; no clear spot next to the pin"
			unresolved = append(unresolved, f)
		}
	}

	result := map[string]any{"findings": len(findings), "moves": moves, "unresolved": unresolved}
	if !argBool(p, "apply", false) {
		result["dryRun"] = true
		result["next"] = "pass apply=true to move the capacitors (verified by readback and live DRC)"
		return ok(action, result), nil
	}
	if len(moves) == 0 {
		return fail(action, "NOTHING_TO_MOVE", "no capacitor moves were planned", result), nil
	}

	baseline := -1
	if !argBool(p, "skipDrc", false) {
		baseline = liveViolationCount(ctx, dispatch, doc)
	}
	var originals []any
	var updates []any
	for _, m := range moves {
		fp := byRef[m.Capacitor]
		originals = append(originals, map[string]any{"type": "footprint", "json": stripType(fp)})
		moved := deepCopy(stripType(fp)).(map[string]any)
		translateItem(moved, m.dx, m.dy)
		updates = append(updates, map[string]any{"type": "footprint", "json": moved})
	}
	if _, _, err := call(ctx, dispatch, "board.items.update", map[string]any{"document": doc, "items": updates}); err != nil {
		return fail(action, "MOVE_FAILED", err.Error(), result), nil
	}
	revert := func(reason string) (*backend.Result, error) {
		if _, _, err := call(ctx, dispatch, "board.items.update", map[string]any{"document": doc, "items": originals}); err != nil {
			result["revertError"] = err.Error()
		} else {
			result["reverted"] = true
		}
		return fail(action, "MOVES_REVERTED", reason, result), nil
	}
	// Readback: every moved capacitor must sit at its target.
	var movedIDs []string
	for _, m := range moves {
		movedIDs = append(movedIDs, itemID(byRef[m.Capacitor]))
	}
	back, _, err := call(ctx, dispatch, "board.items.get_by_id", map[string]any{"document": doc, "ids": movedIDs})
	if err != nil {
		return revert("readback failed: " + err.Error())
	}
	for i, item := range itemsOf(back) {
		pos, _ := positionOf(item)
		if i < len(moves) && (math.Abs(nmToMm(pos.X)-moves[i].ToXMm) > 0.01 || math.Abs(nmToMm(pos.Y)-moves[i].ToYMm) > 0.01) {
			return revert(fmt.Sprintf("%s did not move to its target", moves[i].Capacitor))
		}
	}
	if baseline >= 0 {
		after := liveViolationCount(ctx, dispatch, doc)
		result["drcBefore"], result["drcAfter"] = baseline, after
		if after < 0 {
			return revert("live DRC failed after the moves")
		}
		if after > baseline {
			return revert(fmt.Sprintf("DRC violations rose from %d to %d", baseline, after))
		}
	}
	result["applied"] = true
	result["verified"] = true
	result["next"] = "re-route the moved capacitors' connections and run board.check.unified"
	return ok(action, result), nil
}

func deepCopy(v any) any {
	switch x := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(x))
		for k, val := range x {
			out[k] = deepCopy(val)
		}
		return out
	case []any:
		out := make([]any, len(x))
		for i, val := range x {
			out[i] = deepCopy(val)
		}
		return out
	}
	return v
}

// liveViolationCount returns the number of DRC violations of the open board,
// or -1 when live DRC is unavailable.
func liveViolationCount(ctx context.Context, dispatch Dispatcher, doc any) int {
	res, err := LiveRules(ctx, "board.drc.run", map[string]any{"document": doc, "full": true}, dispatch)
	if err != nil || res == nil {
		return -1
	}
	data := toMap(res.Data)
	report, _ := data["reportJson"].(map[string]any)
	if report == nil {
		return -1
	}
	n := 0
	for _, key := range []string{"violations", "unconnected_items", "schematic_parity"} {
		list, _ := report[key].([]any)
		n += len(list)
	}
	return n
}
