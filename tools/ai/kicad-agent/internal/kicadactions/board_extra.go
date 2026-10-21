// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package kicadactions

// boardExtraActions returns headless-safe PCB queries wired to KiCad IPC
// handlers that were previously unreachable from the agent.  None of these
// require a live editor frame.
func boardExtraActions() []ActionSpec {
	return []ActionSpec{
		{
			Name: "board.nets.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "List the nets in the board.",
			Inputs:      []string{"document", "netclass_filter[] optional"},
			Outputs:     []string{"nets"},
		},
		{
			Name: "board.items.by_net", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the board items belonging to the given nets (by name).",
			Inputs:      []string{"document", "nets[]"},
			Outputs:     []string{"items"},
		},
		{
			Name: "board.items.connected", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the items electrically connected to the given items (by KIID).",
			Inputs:      []string{"document", "ids[]"},
			Outputs:     []string{"items"},
		},
		{
			Name: "board.rules.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the board design rules and custom-rule status.",
			Inputs:      []string{"document"},
			Outputs:     []string{"rules"},
		},
		{
			Name: "board.origin.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the board origin (grid or drill) in nanometers.",
			Inputs:      []string{"document", "type optional (grid|drill)"},
			Outputs:     []string{"x_nm", "y_nm"},
		},
		{
			Name: "board.origin.set", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Set the board grid or drill origin in nanometers.",
			Inputs:      []string{"document", "x_nm", "y_nm", "type optional (grid|drill)"},
		},
		{
			Name: "board.bbox.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the bounding box of the board, or of the given items.",
			Inputs:      []string{"document", "ids[] optional"},
			Outputs:     []string{"boxes"},
		},
		{
			Name: "board.rules.set", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Write the board design rules. Pass rules as the proto JSON object returned by board.rules.get.",
			Inputs:      []string{"document", "rules"},
			Outputs:     []string{"rules"},
		},
		{
			Name: "board.rules.custom.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the custom design rules (text-based rules).",
			Inputs:      []string{"document"},
			Outputs:     []string{"rules", "status"},
		},
		{
			Name: "board.rules.custom.set", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Write the custom design rules. Pass rules as an array of proto JSON rule objects.",
			Inputs:      []string{"document", "rules[]"},
			Outputs:     []string{"rules", "status"},
		},
		{
			Name: "board.items.by_netclass", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the board items in the given net classes.",
			Inputs:      []string{"document", "net_classes[]"},
			Outputs:     []string{"items"},
		},
		{
			Name: "board.items.get_by_id", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the board items with the given KIIDs.",
			Inputs:      []string{"document", "ids[]"},
			Outputs:     []string{"items"},
		},
		{
			Name: "board.flip", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Flip the given items to the opposite side of the board.",
			Inputs:      []string{"document", "ids[]", "direction optional (left_right|top_bottom)"},
			Outputs:     []string{"flipped_items"},
		},
		{
			Name: "board.titleblock.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the title block fields (title, date, revision, company, comments).",
			Inputs:      []string{"document"},
			Outputs:     []string{"title", "date", "revision", "company"},
		},
		{
			Name: "board.titleblock.set", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Write the title block fields. Pass title_block as the proto JSON object returned by board.titleblock.get.",
			Inputs:      []string{"document", "title_block"},
		},
		{
			Name: "board.pagesettings.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the page settings (page size, orientation, drawing sheet).",
			Inputs:      []string{"document"},
			Outputs:     []string{"page_size", "orientation"},
		},
		{
			Name: "board.pagesettings.set", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Write the page settings. Pass page_settings as the proto JSON object returned by board.pagesettings.get.",
			Inputs:      []string{"document", "page_settings"},
		},
		{
			Name: "board.layers.name.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the human name of a board layer given its identifier (enum or name).",
			Inputs:      []string{"document", "layer"},
			Outputs:     []string{"name"},
		},
		{
			Name: "board.layers.by_name.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the board layer identifier for a given layer name.",
			Inputs:      []string{"document", "name"},
			Outputs:     []string{"layer"},
		},
		{
			Name: "board.hittest", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Hit-test whether the item with the given KIID lies at a board position.",
			Inputs:      []string{"document", "id", "x_nm", "y_nm", "tolerance optional"},
			Outputs:     []string{"result"},
		},
		{
			Name: "board.export.string", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Serialize the board document to its file-format string.",
			Inputs:      []string{"document"},
			Outputs:     []string{"contents"},
		},
		{
			Name: "board.netclasses.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the net class of the given nets (operates on the open board).",
			Inputs:      []string{"nets[]"},
			Outputs:     []string{"classes"},
		},
		{
			Name: "board.pad.polygon.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the pad shapes as polygons on the given layer.",
			Inputs:      []string{"document", "pads[]", "layer"},
			Outputs:     []string{"polygons"},
		},
		{
			Name: "board.text.expand", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Expand KiCad text variables in the given strings.",
			Inputs:      []string{"document", "text[]", "expand_env_vars optional"},
			Outputs:     []string{"text"},
		},
		{
			Name: "board.graphics.defaults.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the board graphics defaults (line widths, text sizes, etc.).",
			Inputs:      []string{"document"},
			Outputs:     []string{"defaults"},
		},
		{
			Name: "board.layers.enabled.set", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Set the enabled board layers.",
			Inputs:      []string{"document", "layers[]"},
			Outputs:     []string{"layers"},
		},
		{
			Name: "board.variants.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the board design variants.",
			Inputs:      []string{"document"},
			Outputs:     []string{"variants"},
		},
		{
			Name: "board.embedded.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Return the files embedded in the board.",
			Inputs:      []string{"document"},
			Outputs:     []string{"files"},
		},
	}
}
