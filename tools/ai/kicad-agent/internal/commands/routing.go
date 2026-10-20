// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/routing"
)

func newRouteCmd(opts *Options) *cobra.Command {
	var document, nets, netName string
	var width, gap, target, amplitude, spacing, clearance, gridMm float64
	var viaDrill, viaDiameter float64
	var layers, planner string
	var apply, dryRunFlag bool
	var pairsJSON string

	runAction := func(cmd *cobra.Command, action string, extra map[string]any) error {
		if document == "" {
			return &exitError{code: 1, err: fmt.Errorf("--document is required")}
		}

		payload := map[string]any{
			"document":    map[string]any{"type": "pcb", "path": document},
			"widthMm":     width,
			"gapMm":       gap,
			"clearanceMm": clearance,
			"gridMm":      gridMm,
			"drillMm":     viaDrill,
			"diameterMm":  viaDiameter,
			"planner":     planner,
			"layers":      splitList(layers),
			"dryRun":      !apply || dryRunFlag,
		}
		if nets != "" {
			payload["nets"] = strings.Split(nets, ",")
		}
		for k, v := range extra {
			payload[k] = v
		}

		ctx, cancel := context.WithTimeout(cmd.Context(), opts.Timeout)
		defer cancel()

		res, err := routing.Run(ctx, action, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
		return finish(action, res, err)
	}

	autoroute := &cobra.Command{
		Use:   "autoroute",
		Short: "Route nets (L-router baseline or obstacle-aware grid planner)",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAction(cmd, "board.route.autoroute", nil)
		},
	}

	diffPair := &cobra.Command{
		Use:   "diff-pair",
		Short: "Route differential pairs with parallel L paths",
		RunE: func(cmd *cobra.Command, args []string) error {
			var pairs []any
			if err := json.Unmarshal([]byte(pairsJSON), &pairs); err != nil {
				return &exitError{code: 1, err: fmt.Errorf("invalid --pairs JSON: %w", err)}
			}
			return runAction(cmd, "board.route.diff_pair", map[string]any{"pairs": pairs})
		},
	}

	length := &cobra.Command{
		Use:   "length",
		Short: "Report routed length for a net",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAction(cmd, "board.route.length_report", map[string]any{
				"net": netName, "targetMm": target,
			})
		},
	}

	tune := &cobra.Command{
		Use:   "tune",
		Short: "Insert a serpentine to reach a target net length",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAction(cmd, "board.route.tune_length", map[string]any{
				"net": netName, "targetMm": target,
				"amplitudeMm": amplitude, "spacingMm": spacing,
			})
		},
	}

	for _, c := range []*cobra.Command{autoroute, diffPair, length, tune} {
		c.Flags().StringVar(&document, "document", "", "board .kicad_pcb path")
		c.Flags().StringVar(&nets, "nets", "", "comma-separated nets (or net for length)")
		c.Flags().Float64Var(&width, "width-mm", 0.25, "track width in mm")
		c.Flags().Float64Var(&gap, "gap-mm", 0.2, "differential gap in mm")
		c.Flags().Float64Var(&target, "target-mm", 0, "target length in mm")
		c.Flags().Float64Var(&clearance, "clearance-mm", 0.2, "clearance in mm (grid planner)")
		c.Flags().Float64Var(&gridMm, "grid-mm", 0.25, "grid pitch in mm (grid planner)")
		c.Flags().Float64Var(&viaDrill, "via-drill-mm", 0.3, "via drill in mm (grid planner)")
		c.Flags().Float64Var(&viaDiameter, "via-diameter-mm", 0.6, "via diameter in mm (grid planner)")
		c.Flags().StringVar(&layers, "layers", "", "comma-separated copper layers for the grid planner (default: F.Cu,B.Cu)")
		c.Flags().StringVar(&planner, "planner", "", "planner: lrouter (default) or grid")
		c.Flags().BoolVar(&apply, "apply", false, "apply changes (default: dry run)")
		c.Flags().BoolVar(&dryRunFlag, "dry-run", false, "report only, do not modify")
	}
	length.Flags().StringVar(&netName, "net", "", "net name for the length report")
	tune.Flags().StringVar(&netName, "net", "", "net name to tune")
	tune.Flags().Float64Var(&amplitude, "amplitude-mm", 0.5, "serpentine amplitude in mm")
	tune.Flags().Float64Var(&spacing, "spacing-mm", 0.5, "serpentine pitch in mm")
	diffPair.Flags().StringVar(&pairsJSON, "pairs", "[]",
		"JSON array of {p_start,p_end,n_start,n_end} pad references")

	cmd := &cobra.Command{
		Use:   "route",
		Short: "Routing and length analysis",
	}
	cmd.AddCommand(autoroute, diffPair, length, tune)
	return cmd
}

func splitList(value string) []string {
	var out []string

	for _, part := range strings.Split(value, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}

	return out
}
