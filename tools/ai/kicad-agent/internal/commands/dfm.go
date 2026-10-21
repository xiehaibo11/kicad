// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/dfm"
)

func newDFMCmd(opts *Options) *cobra.Command {
	var document string
	var minWidth float64
	var apply bool

	runAction := func(base context.Context, action string) error {
		if document == "" {
			return &exitError{code: 1, err: fmt.Errorf("--document is required")}
		}

		ctx, cancel := context.WithTimeout(base, opts.Timeout)
		defer cancel()

		dryRun := true
		if action == "board.dfm.fix" && apply {
			dryRun = false
		}

		res, err := dfm.Run(ctx, action, map[string]any{
			"document":   map[string]any{"type": "pcb", "path": document},
			"minWidthMm": minWidth,
			"dryRun":     dryRun,
		}, func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
			return dispatch(ctx, opts, a, p)
		})
		return finish(action, res, err)
	}

	analyze := &cobra.Command{
		Use:   "analyze",
		Short: "Analyze tracks for DFM issues",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAction(cmd.Context(), "board.dfm.analyze")
		},
	}

	fix := &cobra.Command{
		Use:   "fix",
		Short: "Fix width and zero-length DFM issues (dry-run unless --apply)",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAction(cmd.Context(), "board.dfm.fix")
		},
	}

	for _, c := range []*cobra.Command{analyze, fix} {
		c.Flags().StringVar(&document, "document", "", "board .kicad_pcb path")
		c.Flags().Float64Var(&minWidth, "min-width-mm", 0.15, "minimum track width in mm")
	}

	fix.Flags().BoolVar(&apply, "apply", false, "apply fixes (default is a dry run)")

	cmd := &cobra.Command{
		Use:   "dfm",
		Short: "Batch DFM analysis and fixes",
	}
	cmd.AddCommand(analyze, fix)
	return cmd
}
