// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"context"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/pipeline"
)

func newPipelineCmd(opts *Options) *cobra.Command {
	var specPath, projectDir, fanoutReference string
	var stages []string
	var dryRun bool

	runCmd := &cobra.Command{
		Use:   "run",
		Short: "Run the design pipeline",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, cancel := context.WithTimeout(cmd.Context(), opts.Timeout)
			defer cancel()

			payload := map[string]any{
				"spec":            specPath,
				"project":         projectDir,
				"dryRun":          dryRun,
				"fanoutReference": fanoutReference,
			}
			if len(stages) > 0 {
				payload["stages"] = stages
			}

			res, err := pipeline.RunAction(ctx, "pipeline.run", payload,
				func(ctx context.Context, action string, p map[string]any) (*backend.Result, error) {
					return dispatch(ctx, opts, action, p)
				})
			return finish("pipeline.run", res, err)
		},
	}
	runCmd.Flags().StringVar(&specPath, "spec", "", "S0 design spec JSON")
	runCmd.Flags().StringVar(&projectDir, "project", "", "project directory (default: cwd)")
	runCmd.Flags().StringSliceVar(&stages, "stages", nil, "only run these stages")
	runCmd.Flags().BoolVar(&dryRun, "dry-run", false, "do not modify documents")
	runCmd.Flags().StringVar(&fanoutReference, "fanout-reference", "",
		"footprint reference to fan out (enables the fanout stage)")

	statusCmd := &cobra.Command{
		Use:   "status",
		Short: "Show the last pipeline report",
		RunE: func(cmd *cobra.Command, args []string) error {
			res, err := pipeline.RunAction(cmd.Context(), "pipeline.status",
				map[string]any{"project": projectDir}, nil)
			return finish("pipeline.status", res, err)
		},
	}
	statusCmd.Flags().StringVar(&projectDir, "project", "", "project directory (default: cwd)")

	cmd := &cobra.Command{
		Use:   "pipeline",
		Short: "Design pipeline orchestration",
	}
	cmd.AddCommand(runCmd, statusCmd)
	return cmd
}

// pipelineWorkflow bridges the offline workflow.* actions to their implementation.
func pipelineWorkflow(action string, p map[string]any) (*backend.Result, error) {
	return pipeline.WorkflowCall(action, p)
}
