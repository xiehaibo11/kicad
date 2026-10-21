// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package kicadactions

// editorActions returns the cross-editor automation actions: native tool
// invocation, selection management, and commit/undo transactions.
//
// These map to the IPC RunAction / Selection / Commit command family.  They
// require a live editor frame (a GUI KiCad instance with the API server
// enabled); a headless kicad-cli api-server has no target GUI frame. This
// is the entry point for driving the native TOOL_ACTION commands that are
// not yet expressed as dedicated, headless-safe automation actions.
func editorActions() []ActionSpec {
	return []ActionSpec{
		{
			Name: "editor.run_action", Domain: DomainEditor, Backend: BackendIPC, Mutates: true,
			Experimental: true,
			Description:  "Run a native KiCad tool action by its registered name (e.g. common.Control.zoomFitScreen, pcbnew.ZoneFiller.zoneFillAll). The name is validated against the native tool inventory (unknown names return close matches; pass unchecked=true for plugin actions). Requires a live editor frame. Success only means the action was submitted, not that it completed: read back the result.",
			Inputs:       []string{"action", "editor optional (required for common actions with multiple frames)", "unchecked optional"},
			Keywords:     []string{"执行菜单命令", "运行工具", "run tool"},
			Outputs:      []string{"status"},
		},
		{
			Name: "editor.native.search", Domain: DomainEditor, Backend: BackendOffline,
			Description: "Find native KiCad GUI tools (all ~970 TOOL_ACTIONs) by a Chinese or English request; matches action names, menu text, tooltips and the zh_CN translation. Invoke a hit with editor.run_action.",
			Inputs:      []string{"query", "editor optional (pcbnew|eeschema|common|gerbview|pl_editor|3dviewer|cvpcb|kicad)", "category optional", "mutating optional", "limit optional"},
			Outputs:     []string{"tools"}, Keywords: []string{"原生工具", "菜单", "GUI工具", "native tool", "menu"},
		},
		{
			Name: "editor.native.list", Domain: DomainEditor, Backend: BackendOffline,
			Description: "List native KiCad GUI tools, filtered by editor, category or mutation.",
			Inputs:      []string{"editor optional", "category optional", "mutating optional"},
			Outputs:     []string{"tools"},
		},
		{
			Name: "editor.native.show", Domain: DomainEditor, Backend: BackendOffline,
			Description: "Show one native tool (source, menu text, tooltip, Chinese name, category).",
			Inputs:      []string{"name"}, Outputs: []string{"tool"},
		},
		{
			Name: "editor.native.categories", Domain: DomainEditor, Backend: BackendOffline,
			Description: "Count native tools per category (routing, zone, placement, drawing, selection, view, inspection, edit, file, annotation, library, simulation).",
			Outputs:     []string{"categories"},
		},
		{
			Name:        "editor.selection.get", Domain: DomainEditor, Backend: BackendIPC,
			Description: "Return the items currently selected in the editor frame.",
			Inputs:      []string{"document optional"},
			Outputs:     []string{"items"},
		},
		{
			Name:        "editor.selection.clear", Domain: DomainEditor, Backend: BackendIPC, Mutates: true,
			Description: "Clear the editor selection.",
			Inputs:      []string{"document optional"},
		},
		{
			Name:        "editor.selection.add", Domain: DomainEditor, Backend: BackendIPC, Mutates: true,
			Description: "Add items (by KIID) to the editor selection.",
			Inputs:      []string{"ids[]", "document optional"},
			Outputs:     []string{"items"},
		},
		{
			Name:        "editor.selection.remove", Domain: DomainEditor, Backend: BackendIPC, Mutates: true,
			Description: "Remove items (by KIID) from the editor selection.",
			Inputs:      []string{"ids[]", "document optional"},
			Outputs:     []string{"items"},
		},
		{
			Name:        "editor.commit.begin", Domain: DomainEditor, Backend: BackendIPC, Mutates: true,
			Description: "Begin a transaction/commit. Changes made until editor.commit.end are grouped for commit or drop.",
			Inputs:      []string{"document optional"},
			Outputs:     []string{"id"},
		},
		{
			Name:        "editor.commit.end", Domain: DomainEditor, Backend: BackendIPC, Mutates: true,
			Description: "End a transaction: commit the grouped changes, or drop them.",
			Inputs:      []string{"id", "action (commit|drop)", "message optional", "document optional"},
		},
	}
}
