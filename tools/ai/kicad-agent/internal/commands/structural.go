// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/structural"
)

func newStructuralCmd(opts *Options) *cobra.Command {
	var document, heightsPath string
	var exportStep, exactStep bool

	check := &cobra.Command{
		Use:   "check",
		Short: "2.5D structural check (courtyards + heights)",
		RunE: func(cmd *cobra.Command, args []string) error {
			if document == "" {
				return &exitError{code: 1, err: fmt.Errorf("--document is required")}
			}

			heights := map[string]any{}
			if heightsPath != "" {
				raw, err := os.ReadFile(heightsPath)
				if err != nil {
					return &exitError{code: 1, err: err}
				}
				if err := json.Unmarshal(raw, &heights); err != nil {
					return &exitError{code: 1, err: fmt.Errorf("invalid heights JSON: %w", err)}
				}
			}

			ctx, cancel := context.WithTimeout(cmd.Context(), opts.Timeout)
			defer cancel()

			res, err := structural.Run(ctx, map[string]any{
				"document":   map[string]any{"type": "pcb", "path": document},
				"heights":    heights,
				"exportStep": exportStep,
				"exactStep":  exactStep,
			}, func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
			return finish("board.check.3d", res, err)
		},
	}
	check.Flags().StringVar(&document, "document", "", "board .kicad_pcb path")
	check.Flags().StringVar(&heightsPath, "heights", "", "JSON map of reference -> height in mm")
	check.Flags().BoolVar(&exportStep, "export-step", false, "export board.step alongside the check")
	check.Flags().BoolVar(&exactStep, "exact-step", false,
		"run exact OpenCASCADE solid intersection on the exported STEP (implies --export-step)")

	cmd := &cobra.Command{
		Use:   "structural",
		Short: "Structural / 3D checks",
	}
	cmd.AddCommand(check)
	return cmd
}
