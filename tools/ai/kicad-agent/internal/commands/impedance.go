// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"context"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	impedancepkg "github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/impedance"
)

func newImpedanceCmd(opts *Options) *cobra.Command {
	var stackupPath, documentPath, layer string
	var target, gap, width, tolerance float64
	var differential bool

	cmd := &cobra.Command{
		Use:   "impedance",
		Short: "Controlled impedance analysis and checks",
	}

	run := func(cmd *cobra.Command, action string, extra map[string]any) error {
		payload := map[string]any{
			"layer":        layer,
			"targetOhm":    target,
			"gapMm":        gap,
			"differential": differential,
			"tolerancePct": tolerance,
		}
		if width > 0 {
			payload["widthMm"] = width
		}
		if stackupPath != "" {
			payload["stackup"] = stackupPath
		}
		if documentPath != "" {
			payload["document"] = map[string]any{"type": "pcb", "path": documentPath}
		}
		for k, v := range extra {
			payload[k] = v
		}

		ctx, cancel := context.WithTimeout(cmd.Context(), opts.Timeout)
		defer cancel()

		res, err := impedancepkg.RunAction(ctx, action, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
		return finish(action, res, err)
	}

	layersCmd := &cobra.Command{
		Use:   "layers",
		Short: "List copper layers with dielectric data",
		RunE: func(cmd *cobra.Command, args []string) error {
			return run(cmd, "board.impedance.layers", nil)
		},
	}

	calculateCmd := &cobra.Command{
		Use:   "calculate",
		Short: "Analyze or synthesize trace width for a target impedance",
		RunE: func(cmd *cobra.Command, args []string) error {
			return run(cmd, "board.impedance.calculate", nil)
		},
	}

	checkCmd := &cobra.Command{
		Use:   "check",
		Short: "Check board track widths against a target impedance",
		RunE: func(cmd *cobra.Command, args []string) error {
			return run(cmd, "board.impedance.check", nil)
		},
	}

	for _, c := range []*cobra.Command{layersCmd, calculateCmd, checkCmd} {
		c.Flags().StringVar(&stackupPath, "stackup", "", "stackup JSON file (or omit with --document)")
		c.Flags().StringVar(&documentPath, "document", "", "board .kicad_pcb path")
		c.Flags().StringVar(&layer, "layer", "", "copper layer, e.g. F.Cu or In1.Cu")
		c.Flags().Float64Var(&target, "target", 50, "target impedance in ohms")
		c.Flags().Float64Var(&gap, "gap", 0.2, "differential pair gap in mm")
		c.Flags().Float64Var(&width, "width", 0, "trace width in mm (0 = synthesize)")
		c.Flags().Float64Var(&tolerance, "tolerance", 10, "check tolerance in percent")
		c.Flags().BoolVar(&differential, "diff", false, "differential pair")
	}

	cmd.AddCommand(layersCmd, calculateCmd, checkCmd)
	return cmd
}
