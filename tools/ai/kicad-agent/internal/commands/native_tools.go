// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadactions"
)

func newNativeToolsCmd(opts *Options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "native-tools",
		Short: "Discover KiCad's native TOOL_ACTION commands (the GUI tool catalog)",
	}

	list := &cobra.Command{
		Use:   "list",
		Short: "List native tools, optionally filtered by editor",
		RunE: func(cmd *cobra.Command, args []string) error {
			p := map[string]any{}
			if v, _ := cmd.Flags().GetString("editor"); v != "" {
				p["editor"] = v
			}
			if ok, _ := cmd.Flags().GetBool("mutating"); ok {
				p["mutating"] = true
			}
			if v, _ := cmd.Flags().GetString("category"); v != "" {
				p["category"] = v
			}
			res, err := nativeToolsResult("native_tools.list", p)
			return finish("native_tools.list", res, err)
		},
	}
	list.Flags().String("editor", "", "Filter by editor (pcbnew, eeschema, common, gerbview, ...)")
	list.Flags().String("category", "", "Filter by category")
	list.Flags().Bool("mutating", false, "Only list tools whose name suggests they mutate the design")

	search := &cobra.Command{
		Use:   "search <query>",
		Short: "Search native tools in Chinese or English (name, menu text, tooltip, zh_CN translation)",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			p := map[string]any{"query": strings.Join(args, " ")}
			if v, _ := cmd.Flags().GetString("editor"); v != "" {
				p["editor"] = v
			}
			if v, _ := cmd.Flags().GetString("category"); v != "" {
				p["category"] = v
			}
			if v, _ := cmd.Flags().GetInt("limit"); v > 0 {
				p["limit"] = float64(v)
			}
			res, err := nativeToolsResult("native_tools.search", p)
			return finish("native_tools.search", res, err)
		},
	}
	search.Flags().String("editor", "", "Filter by editor (pcbnew, eeschema, common, ...)")
	search.Flags().String("category", "", "Filter by category (routing, zone, placement, drawing, selection, view, inspection, edit, file, annotation, library, simulation, other)")
	search.Flags().Int("limit", 20, "Maximum results")

	show := &cobra.Command{
		Use:   "show <name>",
		Short: "Show one native tool by its registered action name",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := nativeToolsResult("native_tools.show", map[string]any{"name": args[0]})
			return finish("native_tools.show", res, err)
		},
	}

	cmd.AddCommand(list, search, show)
	return cmd
}

func nativeToolsResult(action string, p map[string]any) (*backend.Result, error) {
	all, err := kicadactions.NativeTools()
	if err != nil {
		return nil, &backend.Error{Code: "NATIVE_TOOLS_LOAD_FAILED", Message: err.Error()}
	}

	switch action {
	case "native_tools.list", "editor.native.list":
		filtered := all
		if editor := argString(p, "editor"); editor != "" {
			filtered = filterNativeTools(filtered, func(t kicadactions.NativeTool) bool {
				return t.Editor == kicadactions.NormalizeNativeEditor(editor)
			})
		}
		if category := argString(p, "category"); category != "" {
			filtered = filterNativeTools(filtered, func(t kicadactions.NativeTool) bool {
				return strings.EqualFold(t.Category, category)
			})
		}
		if mutating, ok := p["mutating"].(bool); ok && mutating {
			filtered = filterNativeTools(filtered, func(t kicadactions.NativeTool) bool {
				return t.Mutates
			})
		}
		return &backend.Result{Action: action, OK: true,
			Data: map[string]any{"count": len(filtered), "tools": filtered}}, nil

	case "native_tools.search", "editor.native.search":
		query := argString(p, "query")
		if query == "" {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "query is required"}
		}
		limit := argInt(p, "limit")
		if limit <= 0 {
			limit = 20
		}
		mutating, _ := p["mutating"].(bool)
		found := kicadactions.SearchNativeTools(query, argString(p, "editor"),
			argString(p, "category"), mutating, limit)
		return &backend.Result{Action: action, OK: true,
			Data: map[string]any{"query": query, "count": len(found), "tools": found,
				"invoke": "editor.run_action {\"action\": <name>} (requires the live KiCad editor frame)"}}, nil

	case "native_tools.categories", "editor.native.categories":
		counts := map[string]int{}
		for _, t := range all {
			counts[t.Category]++
		}
		return &backend.Result{Action: action, OK: true, Data: map[string]any{"categories": counts}}, nil

	case "native_tools.show", "editor.native.show":
		name := argString(p, "name")
		if name == "" {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "name is required"}
		}
		for _, t := range all {
			if t.Name == name {
				return &backend.Result{Action: action, OK: true, Data: t}, nil
			}
		}
		return nil, &backend.Error{Code: "NATIVE_TOOL_NOT_FOUND",
			Message: fmt.Sprintf("native tool %q not found", name)}
	}

	return nil, &backend.Error{Code: "UNKNOWN_ACTION", Message: action}
}

func filterNativeTools(tools []kicadactions.NativeTool, keep func(kicadactions.NativeTool) bool) []kicadactions.NativeTool {
	out := make([]kicadactions.NativeTool, 0, len(tools))
	for _, t := range tools {
		if keep(t) {
			out = append(out, t)
		}
	}
	return out
}
