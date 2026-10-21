// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/fanout"
)

func newFanoutCmd(opts *Options) *cobra.Command {
	var document, reference, style string
	var drill, diameter, clearance, trackWidth float64
	var dryRun, apply bool

	run := &cobra.Command{
		Use:   "run",
		Short: "Fan out a BGA footprint",
		RunE: func(cmd *cobra.Command, args []string) error {
			if document == "" {
				return &exitError{code: 1, err: fmt.Errorf("--document is required")}
			}

			ctx, cancel := context.WithTimeout(cmd.Context(), opts.Timeout)
			defer cancel()

			if apply {
				dryRun = false
			}

			payload := map[string]any{
				"document":     map[string]any{"type": "pcb", "path": document},
				"reference":    reference,
				"style":        style,
				"drillMm":      drill,
				"diameterMm":   diameter,
				"clearanceMm":  clearance,
				"trackWidthMm": trackWidth,
				"dryRun":       dryRun,
			}

			res, err := fanout.Run(ctx, payload,
				func(ctx context.Context, action string, p map[string]any) (*backend.Result, error) {
					return dispatch(ctx, opts, action, p)
				})
			return finish("board.fanout.run", res, err)
		},
	}
	run.Flags().StringVar(&document, "document", "", "board .kicad_pcb path")
	run.Flags().StringVar(&reference, "reference", "", "footprint reference (default: largest pad count)")
	run.Flags().StringVar(&style, "style", "via-in-pad", "via-in-pad or dogbone")
	run.Flags().Float64Var(&drill, "drill-mm", 0.2, "via drill in mm")
	run.Flags().Float64Var(&diameter, "diameter-mm", 0.45, "via diameter in mm")
	run.Flags().Float64Var(&clearance, "clearance-mm", 0.15, "dog-bone clearance in mm")
	run.Flags().Float64Var(&trackWidth, "track-width-mm", 0.1, "dog-bone escape track width in mm")
	run.Flags().BoolVar(&dryRun, "dry-run", true, "report without creating items (default)")
	run.Flags().BoolVar(&apply, "apply", false, "create the planned vias and tracks")

	cmd := &cobra.Command{
		Use:   "fanout",
		Short: "BGA fanout",
	}
	cmd.AddCommand(run)
	return cmd
}
