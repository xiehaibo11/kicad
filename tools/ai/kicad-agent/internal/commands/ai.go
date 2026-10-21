// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/ai"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/llm"
)

func newAICmd(opts *Options) *cobra.Command {
	var prompt, settingsPath, provider, model string
	var allowedRaw string
	var maxSteps, maxContextBytes int
	var readOnly, allowExternal, stream bool

	cmd := &cobra.Command{
		Use:   "ai",
		Short: "Run a model-driven design loop against the action catalog",
		RunE: func(cmd *cobra.Command, args []string) error {
			if prompt == "" {
				return &exitError{code: 1, err: fmt.Errorf("--prompt is required")}
			}

			policy := ai.DefaultPolicy()
			if readOnly {
				policy.AllowMutating = false
			}
			policy.AllowExternal = allowExternal
			if allowedRaw != "" {
				policy.AllowedActions = map[string]bool{}
				for _, name := range strings.Split(allowedRaw, ",") {
					name = strings.TrimSpace(name)
					if name != "" {
						policy.AllowedActions[name] = true
					}
				}
			}

			ctx, cancel := context.WithTimeout(cmd.Context(), opts.Timeout)
			defer cancel()

			// Streaming mode emits one NDJSON event per line so a chat front end
			// can render progress while the loop is still running.  It never
			// writes the single-envelope result.
			if stream {
				encoder := json.NewEncoder(os.Stdout)

				emit := func(event map[string]any) {
					_ = encoder.Encode(event)
				}

				emit(map[string]any{"event": "start", "prompt": prompt})

				report, err := ai.Run(ctx, ai.Options{
					Prompt:          prompt,
					SettingsPath:    settingsPath,
					Provider:        provider,
					Model:           model,
					MaxSteps:        maxSteps,
					MaxContextBytes: maxContextBytes,
					Policy:          &policy,
					OnAction: func(action string, payload map[string]any) {
						emit(map[string]any{
							"event": "action", "action": action, "payload": payload,
						})
					},
					OnStep: func(step ai.Step) {
						emit(map[string]any{"event": "step", "step": step})
					},
				}, func(ctx context.Context, action string, payload map[string]any) (*backend.Result, error) {
					return dispatch(ctx, opts, action, payload)
				})

				if err != nil {
					emit(map[string]any{"event": "error", "error": err.Error()})
					return &exitError{code: exitCodeForError(err), err: err}
				}

				emit(map[string]any{
					"event":    "final",
					"ok":       report.OK,
					"final":    report.Final,
					"error":    report.Error,
					"provider": report.Provider,
					"model":    report.Model,
					"steps":    len(report.Steps),
				})

				if !report.OK {
					msg := report.Error
					if msg == "" {
						msg = "agent stopped without a final answer"
					}
					return &exitError{code: 1, err: fmt.Errorf("%s", msg)}
				}
				return nil
			}

			report, err := ai.Run(ctx, ai.Options{
				Prompt:          prompt,
				SettingsPath:    settingsPath,
				Provider:        provider,
				Model:           model,
				MaxSteps:        maxSteps,
				MaxContextBytes: maxContextBytes,
				Policy:          &policy,
			}, func(ctx context.Context, action string, payload map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, action, payload)
			})

			if err != nil {
				return finish("ai.run", nil, err)
			}

			res := &backend.Result{Action: "ai.run", OK: report.OK, Data: report}
			if !report.OK {
				msg := report.Error
				if msg == "" {
					msg = "agent stopped without a final answer"
				}
				res.Error = &backend.Error{Code: "AGENT_FAILED", Message: msg}
			}
			return finish("ai.run", res, nil)
		},
	}

	cmd.Flags().StringVar(&prompt, "prompt", "", "task prompt")
	cmd.Flags().StringVar(&settingsPath, "settings", "", "settings.json path (default: "+llm.DefaultConfigPath()+")")
	cmd.Flags().StringVar(&provider, "provider", "", "provider name from settings.json")
	cmd.Flags().StringVar(&model, "model", "", "override the provider's model")
	cmd.Flags().IntVar(&maxSteps, "max-steps", 20, "maximum model turns (1-100)")
	cmd.Flags().IntVar(&maxContextBytes, "max-context-bytes", 512*1024,
		"trim the conversation to this many bytes before each model call")
	cmd.Flags().BoolVar(&readOnly, "read-only", false,
		"forbid actions that modify the project")
	cmd.Flags().BoolVar(&allowExternal, "allow-external", true,
		"allow the model to run external EDA tools")
	cmd.Flags().StringVar(&allowedRaw, "allowed-actions", "",
		"comma-separated action allowlist (default: the full catalog)")
	cmd.Flags().BoolVar(&stream, "stream", false,
		"emit one NDJSON event per line instead of a single result envelope")
	return cmd
}
