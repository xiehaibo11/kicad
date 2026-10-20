// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package dfm implements batch DFM analysis and a conservative subset of
// automatic fixes on top of the KiCad IPC item API.
//
// Supported checks:
//   - track width below a minimum (fixable by widening; re-run DRC afterwards)
//   - zero-length tracks (fixable by deleting the degenerate item)
//   - track angle off the 0/45/90/135/180 degree grid (reported only: moving an
//     endpoint would disconnect it from its pad/via)
//
// Fixes never move pads or footprints.  A DRC re-run is required after applying.
package dfm

import (
	"context"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type Dispatcher func(context.Context, string, map[string]any) (*backend.Result, error)

const (
	IssueWidth      = "width_under_minimum"
	IssueAngle      = "off_angle_grid"
	IssueZeroLength = "zero_length_track"
)

type Violation struct {
	Item    string  `json:"item"`
	Net     string  `json:"net"`
	Layer   string  `json:"layer"`
	Type    string  `json:"type"`
	WidthMm float64 `json:"widthMm,omitempty"`
	MinMm   float64 `json:"minWidthMm,omitempty"`
	Angle   float64 `json:"angleDeg,omitempty"`
	Fixable bool    `json:"fixable"`
	Fix     string  `json:"fix,omitempty"`
	Note    string  `json:"note,omitempty"`
}

type Result struct {
	Document   bool        `json:"documentLoaded"`
	TrackCount int         `json:"trackCount"`
	Violations []Violation `json:"violations"`
	Fixed      int         `json:"fixed"`
	Deleted    int         `json:"deleted"`
	Failed     int         `json:"failed"`
	Unfixable  int         `json:"unfixable"`
	DryRun     bool        `json:"dryRun"`
	Note       string      `json:"note,omitempty"`
	Errors     []string    `json:"errors,omitempty"`
}

func Run(ctx context.Context, action string, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	switch action {
	case "board.dfm.analyze", "board.dfm.fix":
	default:
		return nil, &backend.Error{Code: "UNKNOWN_ACTION",
			Message: fmt.Sprintf("dfm backend does not implement %q", action)}
	}

	document := p["document"]
	if document == nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "document is required"}
	}

	minWidthMm := argFloatDefault(p, "minWidthMm", 0.15)
	if minWidthMm <= 0 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "minWidthMm must be positive"}
	}
	minWidthNm := int64(math.Round(minWidthMm * 1_000_000))

	dryRun := true
	if action == "board.dfm.fix" {
		if v, ok := p["dryRun"].(bool); ok {
			dryRun = v
		} else if raw, present := p["dryRun"]; present && raw != nil {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "dryRun must be a boolean"}
		}
	}

	apply := action == "board.dfm.fix" && !dryRun

	res, err := dispatch(ctx, "board.items.get", map[string]any{
		"document": document,
		"types":    []string{"KOT_PCB_TRACE"},
	})
	if err != nil {
		return nil, err
	}
	if res == nil || !res.OK {
		msg := "failed to read board tracks"
		if res != nil && res.Error != nil {
			msg += ": " + res.Error.Code + " " + res.Error.Message
		}
		return nil, &backend.Error{Code: "GET_TRACKS_FAILED", Message: msg}
	}

	data, _ := res.Data.(map[string]any)
	items, _ := data["items"].([]any)

	result := &Result{DryRun: action == "board.dfm.fix" && !apply, Violations: []Violation{}}
	result.Document = true
	result.TrackCount = len(items)

	var updates []any
	var deletes []string

	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok || !strings.HasSuffix(argString(item, "@type"), ".Track") {
			continue
		}

		violations, update, deleteID, unfixable := checkTrack(item, minWidthNm, minWidthMm, apply)
		result.Violations = append(result.Violations, violations...)
		result.Unfixable += unfixable

		if update != nil {
			updates = append(updates, update)
		}
		if deleteID != "" {
			deletes = append(deletes, deleteID)
		}
	}

	if apply {
		if len(updates) > 0 {
			applyUpdates(ctx, dispatch, document, updates, result)
		}
		if len(deletes) > 0 {
			applyDeletes(ctx, dispatch, document, deletes, result)
		}
		if result.Fixed > 0 || result.Deleted > 0 {
			result.Note = "fixes applied; run board.drc.run and board.connectivity.prove to verify"
		}
	}

	var ok bool
	var code, message string

	if apply {
		ok = result.Failed == 0 && result.Unfixable == 0
		code = "DFM_UNFIXED"
		message = fmt.Sprintf("%d unfixable and %d failed DFM issue(s) remain",
			result.Unfixable, result.Failed)
	} else {
		ok = len(result.Violations) == 0
		code = "DFM_VIOLATIONS"
		message = fmt.Sprintf("%d DFM issue(s) found", len(result.Violations))
	}

	out := &backend.Result{Action: action, OK: ok, Data: result}
	if !ok {
		out.Error = &backend.Error{Code: code, Message: message}
	}
	return out, nil
}

// checkTrack returns violations plus the optional update/delete that fixes them.
func checkTrack(item map[string]any, minWidthNm int64, minWidthMm float64,
	collectFix bool) ([]Violation, map[string]any, string, int) {
	var violations []Violation
	var update map[string]any
	deleteID := ""
	unfixable := 0

	id := ""
	if idObj, ok := item["id"].(map[string]any); ok {
		id = argString(idObj, "value")
	}

	net := ""
	if netObj, ok := item["net"].(map[string]any); ok {
		net = argString(netObj, "name")
	}

	layer := displayLayer(argString(item, "layer"))

	widthObj, _ := item["width"].(map[string]any)
	widthNm := numeric(widthObj["valueNm"])

	start, _ := item["start"].(map[string]any)
	end, _ := item["end"].(map[string]any)

	sx, sy := numeric(start["xNm"]), numeric(start["yNm"])
	ex, ey := numeric(end["xNm"]), numeric(end["yNm"])

	if widthNm > 0 && widthNm < minWidthNm {
		violations = append(violations, Violation{
			Item: id, Net: net, Layer: layer, Type: IssueWidth,
			WidthMm: float64(widthNm) / 1e6, MinMm: minWidthMm,
			Fixable: true, Fix: fmt.Sprintf("widen to %.3f mm", minWidthMm),
			Note: "clearance must be re-checked after widening",
		})

		if collectFix {
			widthObj["valueNm"] = strconv.FormatInt(minWidthNm, 10)
			update = updateItem(item)
		}
	}

	if sx == ex && sy == ey {
		violations = append(violations, Violation{
			Item: id, Net: net, Layer: layer, Type: IssueZeroLength,
			Fixable: true, Fix: "delete the zero-length track",
		})

		if collectFix {
			deleteID = id
		}
		return violations, update, deleteID, unfixable
	}

	angle := math.Atan2(float64(ey-sy), float64(ex-sx)) * 180 / math.Pi
	nearest := math.Round(angle/45.0) * 45.0

	if math.Abs(angle-nearest) > 0.5 {
		// Moving an endpoint would detach the track from a pad or via, so this
		// stays a finding unless a human or a dogleg router rewrites the path.
		unfixable++
		violations = append(violations, Violation{
			Item: id, Net: net, Layer: layer, Type: IssueAngle,
			Angle: angle, Fixable: false,
			Note: "not auto-fixed: moving the endpoint would break connectivity",
		})
	}

	return violations, update, deleteID, unfixable
}

func updateItem(item map[string]any) map[string]any {
	// Rebuild without the Any discriminator; CreateItems/UpdateItems take the
	// concrete message JSON.
	clean := map[string]any{}
	for k, v := range item {
		if k == "@type" {
			continue
		}
		clean[k] = v
	}
	return map[string]any{"type": "track", "json": clean}
}

func applyUpdates(ctx context.Context, dispatch Dispatcher, document any,
	updates []any, result *Result) {
	const chunkSize = 50

	for start := 0; start < len(updates); start += chunkSize {
		end := start + chunkSize
		if end > len(updates) {
			end = len(updates)
		}

		chunk := updates[start:end]

		res, err := dispatch(ctx, "board.items.update", map[string]any{
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

		result.Fixed += len(chunk)
	}
}

func applyDeletes(ctx context.Context, dispatch Dispatcher, document any,
	ids []string, result *Result) {
	const chunkSize = 50

	for start := 0; start < len(ids); start += chunkSize {
		end := start + chunkSize
		if end > len(ids) {
			end = len(ids)
		}

		chunk := ids[start:end]

		res, err := dispatch(ctx, "board.items.delete", map[string]any{
			"document": document,
			"ids":      chunk,
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

		result.Deleted += len(chunk)
	}
}

func displayLayer(name string) string {
	name = strings.TrimPrefix(name, "BL_")
	return strings.ReplaceAll(name, "_", ".")
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
	switch n := v.(type) {
	case float64:
		return int64(n)
	case int64:
		return n
	case int:
		return int64(n)
	case string:
		i, _ := strconv.ParseInt(n, 10, 64)
		return i
	}
	return 0
}
