// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"context"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/schematic"
)

func newSchematicCmd(opts *Options) *cobra.Command {
	var specPath, projectDir, documentPath string
	var createNew, dryRun, noERC bool

	generate := &cobra.Command{
		Use:   "generate",
		Short: "Generate a schematic from a circuit spec",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, cancel := context.WithTimeout(cmd.Context(), opts.Timeout)
			defer cancel()

			payload := map[string]any{
				"spec":     specPath,
				"project":  projectDir,
				"document": documentPath,
				"new":      createNew,
				"dryRun":   dryRun,
				"noErc":    noERC,
			}

			res, err := schematic.RunAction(ctx, payload,
				func(ctx context.Context, action string, p map[string]any) (*backend.Result, error) {
					return dispatch(ctx, opts, action, p)
				})
			return finish("schematic.generate", res, err)
		},
	}
	generate.Flags().StringVar(&specPath, "spec", "", "circuit spec JSON")
	generate.Flags().StringVar(&projectDir, "project", "", "project directory (default: cwd)")
	generate.Flags().StringVar(&documentPath, "document", "", "target .kicad_sch path")
	generate.Flags().BoolVar(&createNew, "new", false, "create the schematic if it does not exist")
	generate.Flags().BoolVar(&dryRun, "dry-run", false, "validate and report without modifying")
	generate.Flags().BoolVar(&noERC, "no-erc", false, "skip the ERC check")

	var query, library string
	var limit int
	search := &cobra.Command{
		Use:   "search",
		Short: "Search symbol libraries",
		RunE: func(cmd *cobra.Command, args []string) error {
			payload := map[string]any{
				"query": query, "library": library, "limit": limit,
			}
			res, err := dispatch(cmd.Context(), opts, "library.search.symbols", payload)
			return finish("library.search.symbols", res, err)
		},
	}
	search.Flags().StringVar(&query, "query", "", "search text")
	search.Flags().StringVar(&library, "library", "", "library nickname filter")
	search.Flags().IntVar(&limit, "limit", 50, "maximum results")

	var libID, reference, value, footprint string
	var xMm, yMm float64
	var unit int
	place := &cobra.Command{
		Use:   "place",
		Short: "Place a symbol from a library",
		RunE: func(cmd *cobra.Command, args []string) error {
			payload := map[string]any{
				"document":  map[string]any{"type": "schematic", "path": documentPath},
				"libId":     libID,
				"position":  map[string]any{"xMm": xMm, "yMm": yMm},
				"reference": reference,
				"value":     value,
				"footprint": footprint,
				"unit":      unit,
			}
			res, err := dispatch(cmd.Context(), opts, "schematic.place.symbol", payload)
			return finish("schematic.place.symbol", res, err)
		},
	}
	place.Flags().StringVar(&documentPath, "document", "", "target .kicad_sch path")
	place.Flags().StringVar(&libID, "lib-id", "", "Library:Symbol")
	place.Flags().Float64Var(&xMm, "x-mm", 50, "X position in mm")
	place.Flags().Float64Var(&yMm, "y-mm", 50, "Y position in mm")
	place.Flags().StringVar(&reference, "reference", "", "reference designator")
	place.Flags().StringVar(&value, "value", "", "value")
	place.Flags().StringVar(&footprint, "footprint", "", "footprint LIB_ID")
	place.Flags().IntVar(&unit, "unit", 1, "unit number")

	var reset bool
	annotate := &cobra.Command{
		Use:   "annotate",
		Short: "Annotate the schematic",
		RunE: func(cmd *cobra.Command, args []string) error {
			payload := map[string]any{
				"document": map[string]any{"type": "schematic", "path": documentPath},
				"reset":    reset,
				"start":    1,
			}
			res, err := dispatch(cmd.Context(), opts, "schematic.annotate", payload)
			return finish("schematic.annotate", res, err)
		},
	}
	annotate.Flags().StringVar(&documentPath, "document", "", "target .kicad_sch path")
	annotate.Flags().BoolVar(&reset, "reset", false, "clear existing annotations first")

	cmd := &cobra.Command{
		Use:   "sch",
		Short: "Schematic generation and library operations",
	}
	cmd.AddCommand(generate, search, place, annotate)
	return cmd
}
