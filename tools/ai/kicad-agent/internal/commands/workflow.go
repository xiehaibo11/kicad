// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/pipeline"
)

func newWorkflowCmd(opts *Options) *cobra.Command {
	var project string

	cmd := &cobra.Command{
		Use:   "workflow",
		Short: "KiCad design workflow gates",
	}

	run := func(action string, payload map[string]any) error {
		payload["project"] = project
		res, err := pipeline.WorkflowCall(action, payload)
		return finish(action, res, err)
	}

	initCmd := &cobra.Command{
		Use:   "init",
		Short: "Initialize workflow state",
		RunE: func(cmd *cobra.Command, args []string) error {
			return run("workflow.init", map[string]any{})
		},
	}

	statusCmd := &cobra.Command{
		Use:   "status",
		Short: "Show workflow state",
		RunE: func(cmd *cobra.Command, args []string) error {
			return run("workflow.status", map[string]any{})
		},
	}

	var stage string
	advanceCmd := &cobra.Command{
		Use:   "advance",
		Short: "Advance a workflow stage",
		RunE: func(cmd *cobra.Command, args []string) error {
			return run("workflow.advance", map[string]any{"stage": stage})
		},
	}
	advanceCmd.Flags().StringVar(&stage, "stage", "", "stage to mark ok (default: next pending)")

	var note string
	confirmCmd := &cobra.Command{
		Use:   "confirm <layout|outline>",
		Short: "Record an explicit confirmation",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return run("workflow.confirm", map[string]any{
				"confirmation": args[0], "note": note,
			})
		},
	}
	confirmCmd.Flags().StringVar(&note, "note", "", "confirmation note")

	var resetAll bool
	var resetFrom string
	resetCmd := &cobra.Command{
		Use:   "reset",
		Short: "Reset workflow state",
		RunE: func(cmd *cobra.Command, args []string) error {
			return run("workflow.reset", map[string]any{
				"resetAll": resetAll, "resetFrom": resetFrom,
			})
		},
	}
	resetCmd.Flags().BoolVar(&resetAll, "all", false, "reset every stage")
	resetCmd.Flags().StringVar(&resetFrom, "from", "", "reset from this stage onward")

	cmd.PersistentFlags().StringVar(&project, "project", "", "project directory (default: cwd)")
	cmd.AddCommand(initCmd, statusCmd, advanceCmd, confirmCmd, resetCmd)
	return cmd
}
