// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/external"
)

func newSpecCmd(opts *Options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "spec",
		Short: "Design spec (S0) operations",
	}

	validate := &cobra.Command{
		Use:   "validate <file>",
		Short: "Parse and validate a design spec",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := offlineSpec(map[string]any{"input": args[0]})
			return finish("spec.validate", res, err)
		},
	}

	cmd.AddCommand(validate)
	return cmd
}

func newBlocksCmd(opts *Options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "blocks",
		Short: "Reusable circuit block library (upstream easyeda-agent)",
	}

	ls := &cobra.Command{
		Use:   "ls",
		Short: "List blocks",
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := offlineBlocks("blocks.list", nil)
			return finish("blocks.list", res, err)
		},
	}

	search := &cobra.Command{
		Use:   "search <query>",
		Short: "Search blocks",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := offlineBlocks("blocks.search", map[string]any{"query": args[0]})
			return finish("blocks.search", res, err)
		},
	}

	show := &cobra.Command{
		Use:   "show <id>",
		Short: "Show one block",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := offlineBlocks("blocks.show", map[string]any{"id": args[0]})
			return finish("blocks.show", res, err)
		},
	}

	cmd.AddCommand(ls, search, show)
	return cmd
}

func newExternalCmd(opts *Options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "external",
		Short: "Third-party tool integration",
	}

	toolsCmd := &cobra.Command{
		Use:   "tools",
		Short: "List external tools and availability",
		RunE: func(cmd *cobra.Command, args []string) error {
			res := &backend.Result{Action: "external.tools.list", OK: true,
				Data: map[string]any{"tools": external.Detect()}}
			writeResult(os.Stdout, res)
			return nil
		},
	}

	var payloadRaw string
	runCmd := &cobra.Command{
		Use:   "run <action>",
		Short: "Run an external action (e.g. external.freerouting.run)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			payload := map[string]any{}
			if payloadRaw != "" {
				if err := json.Unmarshal([]byte(payloadRaw), &payload); err != nil {
					return &exitError{code: 1, err: fmt.Errorf("invalid --payload: %w", err)}
				}
			}
			res, err := external.Call(cmd.Context(), args[0], payload, opts.Timeout)
			return finish(args[0], res, err)
		},
	}
	runCmd.Flags().StringVar(&payloadRaw, "payload", "", "action payload as JSON")

	cmd.AddCommand(toolsCmd, runCmd)
	return cmd
}
