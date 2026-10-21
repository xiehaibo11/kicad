// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package boardops implements composite PCB engineering actions on top of the
// typed IPC and CLI actions: persistent copper layer types, via creation and
// batch modification, verified planes, rule areas and antenna keepouts,
// region rules, library footprint placement and fiducials, decoupling checks,
// live (unsaved-board) DRC and a unified check report.
//
// Every mutating action reads its result back through KiCad before reporting
// success, and reports partial work instead of claiming success.
package boardops

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// Dispatcher runs another typed action.
type Dispatcher func(context.Context, string, map[string]any) (*backend.Result, error)

// Actions served by this package.
var Actions = map[string]bool{
	"board.layers.type.get": true, "board.layers.type.set": true,
	"board.via.create": true, "board.via.modify": true,
	"board.plane.build":       true,
	"board.rule_area.create":  true,
	"board.keepout.antenna":   true,
	"board.rules.region.set":  true,
	"board.footprint.place":   true,
	"board.fiducial.add":      true,
	"board.decap.check":       true,
	"board.decap.place":       true,
	"board.check.unified":     true,
	"board.drc.live":          true,
	"schematic.erc.live":      true,
	"board.route.length_match": true,
	"board.dfm.full":           true,
}

// Run dispatches one composite action.
func Run(ctx context.Context, action string, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	switch action {
	case "board.layers.type.get":
		return layerTypeGet(ctx, p, dispatch)
	case "board.layers.type.set":
		return layerTypeSet(ctx, p, dispatch)
	case "board.via.create":
		return viaCreate(ctx, p, dispatch)
	case "board.via.modify":
		return viaModify(ctx, p, dispatch)
	case "board.plane.build":
		return planeBuild(ctx, p, dispatch)
	case "board.rule_area.create":
		return ruleAreaCreate(ctx, action, p, dispatch)
	case "board.keepout.antenna":
		return antennaKeepout(ctx, p, dispatch)
	case "board.rules.region.set":
		return regionRulesSet(ctx, p, dispatch)
	case "board.footprint.place":
		return footprintPlace(ctx, p, dispatch)
	case "board.fiducial.add":
		return fiducialAdd(ctx, p, dispatch)
	case "board.decap.check":
		return decapCheck(ctx, p, dispatch)
	case "board.decap.place":
		return decapPlace(ctx, p, dispatch)
	case "board.check.unified":
		return unifiedCheck(ctx, p, dispatch)
	case "board.drc.live":
		return LiveRules(ctx, "board.drc.run", p, dispatch)
	case "schematic.erc.live":
		return LiveRules(ctx, "schematic.erc.run", p, dispatch)
	case "board.route.length_match":
		return lengthMatch(ctx, p, dispatch)
	case "board.dfm.full":
		return dfmFull(ctx, p, dispatch)
	}
	return nil, &backend.Error{Code: "UNKNOWN_ACTION", Message: "boardops does not implement " + action}
}

// call runs an action and converts a failed envelope into an error.
func call(ctx context.Context, dispatch Dispatcher, action string, p map[string]any) (map[string]any, *backend.Result, error) {
	res, err := dispatch(ctx, action, p)
	if err != nil {
		return nil, res, err
	}
	if res == nil {
		return nil, nil, &backend.Error{Code: "ACTION_FAILED", Message: action + ": empty result"}
	}
	if !res.OK {
		if res.Error != nil {
			return nil, res, &backend.Error{Code: res.Error.Code,
				Message: action + ": " + res.Error.Message, Detail: res.Error.Detail}
		}
		return nil, res, &backend.Error{Code: "ACTION_FAILED", Message: action + " failed"}
	}
	return toMap(res.Data), res, nil
}

// toMap returns action data as a JSON object; in-process actions may return
// typed structs, which are normalized through JSON.
func toMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	out := map[string]any{}
	if v == nil {
		return out
	}
	raw, err := json.Marshal(v)
	if err == nil {
		_ = json.Unmarshal(raw, &out)
	}
	return out
}

func requireDocument(p map[string]any) (any, error) {
	doc := p["document"]
	if doc == nil {
		if s := argString(p, "input"); s != "" {
			return s, nil
		}
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "document (board path) is required"}
	}
	return doc, nil
}

func documentPath(doc any) string {
	switch v := doc.(type) {
	case string:
		if abs, err := filepath.Abs(v); err == nil {
			return abs
		}
		return v
	case map[string]any:
		if s := argString(v, "path"); s != "" {
			return s
		}
		if f := argString(v, "boardFilename"); f != "" {
			if pj, ok := v["project"].(map[string]any); ok {
				return filepath.Join(argString(pj, "path"), f)
			}
			return f
		}
	}
	return ""
}

func ok(action string, data any) *backend.Result {
	return &backend.Result{Action: action, OK: true, Data: data}
}

func fail(action, code, message string, data any) *backend.Result {
	return &backend.Result{Action: action, OK: false, Data: data,
		Error: &backend.Error{Code: code, Message: message}}
}

// ---- payload helpers ---------------------------------------------------------

func argString(p map[string]any, key string) string {
	if v, ok := p[key].(string); ok {
		return v
	}
	return ""
}

func argBool(p map[string]any, key string, def bool) bool {
	if v, ok := p[key].(bool); ok {
		return v
	}
	return def
}

func argFloat(p map[string]any, key string, def float64) float64 {
	switch v := p[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			return f
		}
	}
	return def
}

func hasKey(p map[string]any, key string) bool {
	_, ok := p[key]
	return ok
}

func argStrings(p map[string]any, key string) []string {
	switch v := p[key].(type) {
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok && s != "" {
				out = append(out, s)
			}
		}
		return out
	case []string:
		return v
	case string:
		if v == "" {
			return nil
		}
		var out []string
		for _, part := range strings.Split(v, ",") {
			if part = strings.TrimSpace(part); part != "" {
				out = append(out, part)
			}
		}
		return out
	}
	return nil
}

func mmToNm(mm float64) int64 { return int64(math.Round(mm * 1e6)) }
func nmToMm(nm int64) float64 { return float64(nm) / 1e6 }

func num(v any) int64 {
	n, _ := numOK(v)
	return n
}

func numOK(v any) (int64, bool) {
	switch x := v.(type) {
	case float64:
		return int64(x), true
	case int64:
		return x, true
	case int:
		return int64(x), true
	case string:
		i, err := strconv.ParseInt(x, 10, 64)
		return i, err == nil
	}
	return 0, false
}

// ---- item helpers --------------------------------------------------------------

func itemsOf(data map[string]any) []map[string]any {
	var out []map[string]any
	for _, key := range []string{"items", "createdItems", "updatedItems"} {
		list, _ := data[key].([]any)
		for _, raw := range list {
			m, _ := raw.(map[string]any)
			if m == nil {
				continue
			}
			if inner, ok := m["item"].(map[string]any); ok {
				m = inner
			}
			out = append(out, m)
		}
	}
	return out
}

func itemType(item map[string]any) string {
	t := argString(item, "@type")
	if i := strings.LastIndex(t, "."); i >= 0 {
		return t[i+1:]
	}
	return t
}

func itemID(item map[string]any) string {
	if id, ok := item["id"].(map[string]any); ok {
		return argString(id, "value")
	}
	return ""
}

func netName(item map[string]any) string {
	if n, ok := item["net"].(map[string]any); ok {
		return argString(n, "name")
	}
	return ""
}

type point struct{ X, Y int64 }

func positionOf(item map[string]any) (point, bool) {
	pos, _ := item["position"].(map[string]any)
	x, xok := numOK(pos["xNm"])
	y, yok := numOK(pos["yNm"])
	return point{x, y}, xok && yok
}

func referenceOf(item map[string]any) string {
	field, _ := item["referenceField"].(map[string]any)
	fieldText, _ := field["text"].(map[string]any)
	if inner, ok := fieldText["text"].(map[string]any); ok {
		if v := argString(inner, "text"); v != "" {
			return v
		}
	}
	return argString(fieldText, "text")
}

// padInfo is the subset of a pad needed by the checks.
type padInfo struct {
	ID        string
	Footprint string
	Number    string
	Net       string
	PinType   string
	Pos       point
	SizeX     int64
	SizeY     int64
	Layer     string
}

func padsOf(fp map[string]any) []padInfo {
	ref := referenceOf(fp)
	def, _ := fp["definition"].(map[string]any)
	list, _ := def["items"].([]any)
	var out []padInfo
	for _, raw := range list {
		pad, _ := raw.(map[string]any)
		if pad == nil || itemType(pad) != "Pad" {
			continue
		}
		pos, _ := positionOf(pad)
		info := padInfo{ID: itemID(pad), Footprint: ref, Number: argString(pad, "number"),
			Net: netName(pad), Pos: pos, Layer: "BL_F_Cu"}
		if sp, ok := pad["symbolPin"].(map[string]any); ok {
			info.PinType = argString(sp, "type")
		}
		if ps, ok := pad["padStack"].(map[string]any); ok {
			if layers, ok := ps["layers"].([]any); ok && len(layers) > 0 {
				if s, ok := layers[0].(string); ok {
					info.Layer = s
				}
			}
			if cl, ok := ps["copperLayers"].([]any); ok && len(cl) > 0 {
				if first, ok := cl[0].(map[string]any); ok {
					if size, ok := first["size"].(map[string]any); ok {
						info.SizeX, info.SizeY = num(size["xNm"]), num(size["yNm"])
					}
				}
			}
		}
		out = append(out, info)
	}
	return out
}

func dist(a, b point) float64 {
	return math.Hypot(float64(a.X-b.X), float64(a.Y-b.Y))
}

func refPrefix(ref string) string {
	i := 0
	for i < len(ref) && (ref[i] < '0' || ref[i] > '9') {
		i++
	}
	return strings.ToUpper(ref[:i])
}

func sortedKeys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func footprints(ctx context.Context, dispatch Dispatcher, doc any) ([]map[string]any, error) {
	data, _, err := call(ctx, dispatch, "board.items.get", map[string]any{
		"document": doc, "types": []string{"footprint"}})
	if err != nil {
		return nil, err
	}
	return itemsOf(data), nil
}

func findFootprint(fps []map[string]any, ref string) map[string]any {
	for _, fp := range fps {
		if strings.EqualFold(referenceOf(fp), ref) {
			return fp
		}
	}
	return nil
}

// box is an axis-aligned rectangle in nanometres.
type box struct{ MinX, MinY, MaxX, MaxY int64 }

func (b box) valid() bool { return b.MaxX > b.MinX && b.MaxY > b.MinY }

func (b box) grow(d int64) box { return box{b.MinX - d, b.MinY - d, b.MaxX + d, b.MaxY + d} }

func (b box) overlaps(o box) bool {
	return b.MinX < o.MaxX && o.MinX < b.MaxX && b.MinY < o.MaxY && o.MinY < b.MaxY
}

func (b box) contains(p point) bool {
	return p.X >= b.MinX && p.X <= b.MaxX && p.Y >= b.MinY && p.Y <= b.MaxY
}

func (b box) outline() []any {
	return []any{
		map[string]any{"xNm": b.MinX, "yNm": b.MinY}, map[string]any{"xNm": b.MaxX, "yNm": b.MinY},
		map[string]any{"xNm": b.MaxX, "yNm": b.MaxY}, map[string]any{"xNm": b.MinX, "yNm": b.MaxY},
	}
}

func boxFromBBox(raw any) (box, bool) {
	m, _ := raw.(map[string]any)
	pos, _ := m["position"].(map[string]any)
	size, _ := m["size"].(map[string]any)
	x, y := num(pos["xNm"]), num(pos["yNm"])
	w, h := num(size["xNm"]), num(size["yNm"])
	b := box{x, y, x + w, y + h}
	return b, b.valid()
}

// itemBoxes returns bounding boxes keyed by KIID via board.bbox.get.
func itemBoxes(ctx context.Context, dispatch Dispatcher, doc any, ids []string) (map[string]box, error) {
	out := map[string]box{}
	if len(ids) == 0 {
		return out, nil
	}
	data, _, err := call(ctx, dispatch, "board.bbox.get", map[string]any{"document": doc, "ids": ids})
	if err != nil {
		return nil, err
	}
	boxes, _ := data["boxes"].([]any)
	items, _ := data["items"].([]any)
	for i, raw := range boxes {
		b, ok := boxFromBBox(raw)
		if !ok || i >= len(items) {
			continue
		}
		idm, _ := items[i].(map[string]any)
		out[argString(idm, "value")] = b
	}
	return out, nil
}

func fmtMm(nm int64) string { return fmt.Sprintf("%.3f mm", nmToMm(nm)) }

// stripType copies a read-back item without its Any type discriminator, the
// form board.items.update expects.
func stripType(item map[string]any) map[string]any {
	out := make(map[string]any, len(item))
	for k, v := range item {
		if k != "@type" {
			out[k] = v
		}
	}
	return out
}
