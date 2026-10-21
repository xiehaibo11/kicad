// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package kicadactions

import (
	_ "embed"
	"encoding/json"
	"sort"
	"strings"
)

// native-tools.json is the inventory produced by tools/ai/Kicad-extension/audit-tools.py:
// every literal TOOL_ACTION registration in the KiCad C++ source, with its
// registered action name, source file and line.
//
//go:embed native-tools.json
var nativeToolsJSON []byte

// native-tools-text.json (scripts/gen-native-text.py) adds each action's
// friendly name and tooltip from the C++ definition and their zh_CN
// translations, so tools can be found by natural-language requests.
//
//go:embed native-tools-text.json
var nativeToolsTextJSON []byte

type nativeText struct {
	FriendlyName string `json:"friendlyName"`
	Tooltip      string `json:"tooltip"`
	ZhName       string `json:"zhName"`
	ZhTooltip    string `json:"zhTooltip"`
}

// NativeTool is one KiCad TOOL_ACTION registration.  Name is the exact string
// the IPC RunAction command accepts, so this catalog is the discovery side of
// the editor.run_action automation action.
type NativeTool struct {
	Name                  string `json:"name"`
	Symbol                string `json:"symbol"`
	Source                string `json:"source"`
	Line                  int    `json:"line"`
	Editor                string `json:"editor"`
	Class                 string `json:"class"`
	Action                string `json:"action"`
	InteractiveActivation bool   `json:"interactiveActivation"`
	// Mutates is a name-based heuristic, not an authoritative declaration.
	// Prefer DRC/ERC/readback to confirm a mutation.
	Mutates bool `json:"mutates"`

	FriendlyName string `json:"friendlyName,omitempty"`
	Tooltip      string `json:"tooltip,omitempty"`
	ZhName       string `json:"zhName,omitempty"`
	ZhTooltip    string `json:"zhTooltip,omitempty"`
	// Category groups tools by purpose (route, zone, selection, view, ...).
	Category string `json:"category"`
}

type rawNativeAction struct {
	Symbol                string `json:"symbol"`
	Source                string `json:"source"`
	Line                  int    `json:"line"`
	Name                  string `json:"name"`
	InteractiveActivation bool   `json:"interactiveActivation"`
}

type nativeToolsDoc struct {
	NativeActions []rawNativeAction `json:"nativeActions"`
}

var cachedNativeTools []NativeTool

// NativeTools returns the complete native TOOL_ACTION catalog, enriched with
// editor/class/action segments and a mutates heuristic.
func NativeTools() ([]NativeTool, error) {
	if cachedNativeTools != nil {
		return cachedNativeTools, nil
	}

	var doc nativeToolsDoc
	if err := json.Unmarshal(nativeToolsJSON, &doc); err != nil {
		return nil, err
	}

	texts := map[string]nativeText{}
	_ = json.Unmarshal(nativeToolsTextJSON, &texts)

	out := make([]NativeTool, 0, len(doc.NativeActions))
	for _, a := range doc.NativeActions {
		tool := enrichNativeTool(a)
		if t, ok := texts[a.Name]; ok {
			tool.FriendlyName, tool.Tooltip = t.FriendlyName, t.Tooltip
			tool.ZhName, tool.ZhTooltip = t.ZhName, t.ZhTooltip
		}
		tool.Category = nativeCategory(tool)
		out = append(out, tool)
	}

	cachedNativeTools = out
	return out, nil
}

func enrichNativeTool(a rawNativeAction) NativeTool {
	editor, class, action := splitNativeName(a.Name)
	return NativeTool{
		Name:                  a.Name,
		Symbol:                a.Symbol,
		Source:                a.Source,
		Line:                  a.Line,
		Editor:                NormalizeNativeEditor(editor),
		Class:                 class,
		Action:                action,
		InteractiveActivation: a.InteractiveActivation,
		// Match on class+action only: the editor namespace otherwise pollutes
		// the heuristic (e.g. "pcbnew" contains the verb "new").
		Mutates: heuristicMutates(strings.Join([]string{class, action}, ".")),
	}
}

// NormalizeNativeEditor accepts native namespaces and the editor names exposed
// by the CLI/MCP schema, without changing the action name sent to KiCad.
func NormalizeNativeEditor(editor string) string {
	switch normalized := strings.ToLower(strings.TrimSpace(editor)); normalized {
	case "pcb":
		return "pcbnew"
	case "schematic":
		return "eeschema"
	case "3dviewer", "3d_viewer", "3d-viewer":
		return "3d-viewer"
	case "pleditor", "pl_editor", "pagelayout_editor":
		return "pagelayout_editor"
	default:
		return normalized
	}
}

// splitNativeName decomposes a registered action name such as
// "pcbnew.InteractiveSelection.SyncSelection" into editor "pcbnew", class
// "InteractiveSelection", and leaf action "SyncSelection".
func splitNativeName(name string) (editor, class, action string) {
	parts := strings.Split(name, ".")
	switch len(parts) {
	case 0:
		return "", "", ""
	case 1:
		return "", "", parts[0]
	case 2:
		return parts[0], "", parts[1]
	default:
		return parts[0], strings.Join(parts[1:len(parts)-1], "."), parts[len(parts)-1]
	}
}

var mutateVerbs = []string{
	"add", "create", "new", "delete", "remove", "move", "edit", "place",
	"route", "draw", "fill", "flip", "rotate", "mirror", "change", "update",
	"trim", "extend", "drag", "cut", "paste", "duplicate", "replace",
	"renumber", "annotate", "assign", "convert", "offset", "position",
	"save", "import", "export", "refill", "hatch", "clean", "align",
	"distribute", "swap", "lock", "unlock", "tune", "reroute",
}

func heuristicMutates(name string) bool {
	lower := strings.ToLower(name)
	for _, verb := range mutateVerbs {
		if strings.Contains(lower, verb) {
			return true
		}
	}
	return false
}

// nativeCategories maps class/action words to a purpose category.
var nativeCategories = []struct {
	category string
	words    []string
}{
	{"routing", []string{"router", "route", "track", "tune", "length", "diffpair", "via", "teardrop"}},
	{"zone", []string{"zone", "fill", "pour"}},
	{"placement", []string{"place", "align", "distribute", "position", "array", "move", "rotate", "flip", "mirror"}},
	{"drawing", []string{"draw", "line", "arc", "circle", "rectangle", "polygon", "dimension", "text", "image", "bezier"}},
	{"selection", []string{"select", "selection", "highlight"}},
	{"view", []string{"zoom", "pan", "center", "show", "hide", "toggle", "visible", "view", "layer", "contrast", "ratsnest", "grid"}},
	{"inspection", []string{"drc", "erc", "inspect", "measure", "check", "clearance", "constraint", "board statistics", "netinspector"}},
	{"edit", []string{"edit", "delete", "remove", "copy", "paste", "cut", "duplicate", "undo", "redo", "properties", "swap", "change", "update", "cleanup", "lock"}},
	{"file", []string{"save", "open", "new", "import", "export", "plot", "print", "close", "archive"}},
	{"annotation", []string{"annotate", "renumber", "reference"}},
	{"library", []string{"library", "footprint", "symbol", "lib"}},
	{"simulation", []string{"simulat", "spice", "probe", "tuner"}},
}

func nativeCategory(t NativeTool) string {
	hay := strings.ToLower(t.Class + " " + t.Action + " " + t.FriendlyName)
	for _, c := range nativeCategories {
		for _, w := range c.words {
			if strings.Contains(hay, w) {
				return c.category
			}
		}
	}
	return "other"
}

// NativeToolByName returns one native tool.
func NativeToolByName(name string) (NativeTool, bool) {
	all, err := NativeTools()
	if err != nil {
		return NativeTool{}, false
	}
	for _, t := range all {
		if t.Name == name {
			return t, true
		}
	}
	return NativeTool{}, false
}

// NativeMatch is a scored native-tool search hit.
type NativeMatch struct {
	NativeTool
	Score int `json:"score"`
}

// SearchNativeTools ranks native tools for a natural-language query (Chinese
// or English), optionally filtered by editor, category and mutation.
func SearchNativeTools(query, editor, category string, mutatingOnly bool, limit int) []NativeMatch {
	all, err := NativeTools()
	if err != nil {
		return nil
	}
	tokens, cjk := ExpandQuery(query)
	var out []NativeMatch
	for _, t := range all {
		if editor != "" && t.Editor != NormalizeNativeEditor(editor) {
			continue
		}
		if category != "" && !strings.EqualFold(t.Category, category) {
			continue
		}
		if mutatingOnly && !t.Mutates {
			continue
		}
		primary := t.Name + " " + t.FriendlyName
		secondary := t.Tooltip + " " + t.Symbol + " " + t.Category
		zh := t.ZhName + " " + t.ZhTooltip
		score := scoreText(tokens, cjk, primary, secondary, zh)
		if query == "" {
			score = 1
		}
		if score > 0 {
			out = append(out, NativeMatch{NativeTool: t, Score: score})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Name < out[j].Name
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}
