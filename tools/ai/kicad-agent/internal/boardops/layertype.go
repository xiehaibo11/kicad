// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// Copper layer types are stored in the board file's (layers ...) table and are
// not exposed by the KiCad API, so they are edited in the saved file and the
// open document is reloaded from disk.  KiCad keeps the type exactly as written
// (unlike EasyEDA's plane flag), which the readback proves.

var layerLine = regexp.MustCompile(`^(\s*\()(\d+)(\s+"([^"]+)"\s+)(signal|power|mixed|jumper|user)((?:\s+"[^"]*")?\)\s*)$`)

var copperTypes = map[string]bool{"signal": true, "power": true, "mixed": true, "jumper": true}

type layerEntry struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Type     string `json:"type"`
	UserName string `json:"userName,omitempty"`
	line     int
}

// parseLayerTable returns the board-level (layers ...) entries.
func parseLayerTable(text string) ([]layerEntry, error) {
	lines := strings.Split(text, "\n")
	for i, line := range lines {
		if strings.TrimSpace(line) != "(layers" || i+1 >= len(lines) || !layerLine.MatchString(lines[i+1]) {
			continue
		}
		var out []layerEntry
		for j := i + 1; j < len(lines); j++ {
			m := layerLine.FindStringSubmatch(lines[j])
			if m == nil {
				break
			}
			e := layerEntry{ID: m[2], Name: m[4], Type: m[5], line: j}
			if user := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(m[6]), ")")); user != "" {
				e.UserName = strings.Trim(user, `"`)
			}
			out = append(out, e)
		}
		return out, nil
	}
	return nil, &backend.Error{Code: "LAYER_TABLE_NOT_FOUND", Message: "no (layers ...) table in the board file"}
}

func copperEntries(entries []layerEntry) []layerEntry {
	var out []layerEntry
	for _, e := range entries {
		if strings.HasSuffix(e.Name, ".Cu") {
			out = append(out, e)
		}
	}
	return out
}

// liveBoard reports whether the board file is open in the connected KiCad.
func liveBoard(ctx context.Context, dispatch Dispatcher, path string) bool {
	data, _, err := call(ctx, dispatch, "document.list", map[string]any{"type": "pcb"})
	if err != nil {
		return false
	}
	docs, _ := data["documents"].([]any)
	for _, raw := range docs {
		d, _ := raw.(map[string]any)
		file := argString(d, "boardFilename")
		pj, _ := d["project"].(map[string]any)
		if file == filepath.Base(path) &&
			(argString(pj, "path") == "" || filepath.Clean(argString(pj, "path")) == filepath.Dir(path)) {
			return true
		}
	}
	return false
}

func layerTypeGet(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	path := documentPath(doc)
	source := "file"
	var text string
	if liveBoard(ctx, dispatch, path) {
		data, _, err := call(ctx, dispatch, "board.export.string", map[string]any{"document": path})
		if err != nil {
			return nil, err
		}
		text, source = argString(data, "contents"), "live"
	} else {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: err.Error()}
		}
		text = string(raw)
	}
	entries, err := parseLayerTable(text)
	if err != nil {
		return nil, err
	}
	return ok("board.layers.type.get", map[string]any{
		"source": source, "copperLayers": copperEntries(entries)}), nil
}

func layerTypeSet(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.layers.type.set"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	path := documentPath(doc)

	want := map[string]string{}
	switch v := p["layers"].(type) {
	case map[string]any:
		for name, t := range v {
			s, _ := t.(string)
			want[name] = strings.ToLower(s)
		}
	case []any:
		for _, raw := range v {
			m, _ := raw.(map[string]any)
			want[argString(m, "layer")] = strings.ToLower(argString(m, "type"))
		}
	}
	if len(want) == 0 {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: `layers is required, e.g. {"In1.Cu": "power", "In2.Cu": "power"}`}
	}
	for name, t := range want {
		if !strings.HasSuffix(name, ".Cu") {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: name + " is not a copper layer"}
		}
		if !copperTypes[t] {
			return nil, &backend.Error{Code: "BAD_INPUT",
				Message: fmt.Sprintf("%s: type %q must be signal, power, mixed or jumper", name, t)}
		}
	}

	live := liveBoard(ctx, dispatch, path)
	steps := []string{}
	if live {
		data, _, err := call(ctx, dispatch, "document.modified", map[string]any{"document": path})
		if err == nil && argString(data, "state") == "DMS_MODIFIED" {
			if !argBool(p, "saveFirst", false) {
				return nil, &backend.Error{Code: "UNSAVED_CHANGES",
					Message: "the open board has unsaved changes; pass saveFirst=true to save them before the layer table is rewritten"}
			}
			if _, _, err := call(ctx, dispatch, "document.save", map[string]any{"document": path}); err != nil {
				return nil, err
			}
			steps = append(steps, "saved open board")
		}
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: err.Error()}
	}
	entries, err := parseLayerTable(string(raw))
	if err != nil {
		return nil, err
	}
	lines := strings.Split(string(raw), "\n")
	changed := []map[string]string{}
	found := map[string]bool{}
	for _, e := range entries {
		t, ok := want[e.Name]
		if !ok {
			continue
		}
		found[e.Name] = true
		if e.Type == t {
			continue
		}
		m := layerLine.FindStringSubmatch(lines[e.line])
		lines[e.line] = m[1] + m[2] + m[3] + t + m[6]
		changed = append(changed, map[string]string{"layer": e.Name, "from": e.Type, "to": t})
	}
	for name := range want {
		if !found[name] {
			return nil, &backend.Error{Code: "LAYER_NOT_ENABLED",
				Message: name + " is not in the board's layer table (enable it in the stackup first)"}
		}
	}

	result := map[string]any{"live": live, "changed": changed, "steps": steps}
	if argBool(p, "dryRun", false) {
		result["dryRun"] = true
		return ok(action, result), nil
	}

	if len(changed) > 0 {
		backup := filepath.Join(os.TempDir(), fmt.Sprintf("kicad-agent-layertype-%d-%s",
			time.Now().UnixNano(), filepath.Base(path)))
		if err := os.WriteFile(backup, raw, 0o600); err != nil {
			return nil, &backend.Error{Code: "BACKUP_FAILED", Message: err.Error()}
		}
		result["backup"] = backup
		tmp := path + ".kicad-agent.tmp"
		if err := os.WriteFile(tmp, []byte(strings.Join(lines, "\n")), 0o644); err != nil {
			return nil, &backend.Error{Code: "WRITE_FAILED", Message: err.Error()}
		}
		if err := os.Rename(tmp, path); err != nil {
			return nil, &backend.Error{Code: "WRITE_FAILED", Message: err.Error()}
		}
		result["steps"] = append(steps, "rewrote layer table")
		if live {
			if _, _, err := call(ctx, dispatch, "document.revert", map[string]any{"document": path}); err != nil {
				return fail(action, "RELOAD_FAILED",
					"file updated but the open board could not be reloaded: "+err.Error(), result), nil
			}
			result["steps"] = append(result["steps"].([]string), "reloaded open board")
		}
	}

	// Readback: from KiCad itself when live, otherwise from the file.
	readback, err := layerTypeGet(ctx, map[string]any{"document": path}, dispatch)
	if err != nil {
		return fail(action, "READBACK_FAILED", err.Error(), result), nil
	}
	rb, _ := readback.Data.(map[string]any)
	result["readback"] = rb
	got := map[string]string{}
	if list, ok := rb["copperLayers"].([]layerEntry); ok {
		for _, e := range list {
			got[e.Name] = e.Type
		}
	}
	var mismatch []string
	for name, t := range want {
		if got[name] != t {
			mismatch = append(mismatch, fmt.Sprintf("%s=%s (want %s)", name, got[name], t))
		}
	}
	if len(mismatch) > 0 {
		return fail(action, "LAYER_TYPE_NOT_PERSISTED", strings.Join(mismatch, "; "), result), nil
	}
	result["verified"] = true
	return ok(action, result), nil
}
