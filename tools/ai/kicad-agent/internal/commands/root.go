// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package commands implements the kicad-agent Cobra command tree.
package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/boardops"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/designaudit"
	dfmpkg "github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/dfm"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/external"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/fanout"
	impedancepkg "github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/impedance"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadactions"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/mcp"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/pipeline"
	projectpkg "github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/project"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/routing"
	schematicgen "github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/schematic"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/structural"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/web"
)

type Options struct {
	KicadCLI string
	Socket   string
	Timeout  time.Duration
}

type exitError struct {
	code int
	err  error
}

func (e *exitError) Error() string { return e.err.Error() }
func (e *exitError) Unwrap() error { return e.err }

func ExitCode(err error) int {
	var ee *exitError
	if errors.As(err, &ee) {
		return ee.code
	}
	return 1
}

func NewRootCmd() *cobra.Command {
	opts := &Options{Timeout: 30 * time.Minute}

	root := &cobra.Command{
		Use:           "kicad-agent",
		Short:         "AI-native KiCad automation terminal",
		Long:          "Typed, auditable KiCad automation for agents. Actions are discovered with 'kicad-agent actions' and invoked with 'kicad-agent call'.",
		SilenceUsage:  true,
		SilenceErrors: true,
	}

	root.PersistentFlags().StringVar(&opts.KicadCLI, "kicad-cli", "",
		"path to kicad-cli (default: $KICAD_CLI, PATH, or build tree)")
	root.PersistentFlags().StringVar(&opts.Socket, "socket", "",
		"KiCad API socket path (default: $KICAD_API_SOCKET or /tmp/kicad/api.sock)")
	root.PersistentFlags().DurationVar(&opts.Timeout, "timeout", 30*time.Minute,
		"maximum time for one action")

	root.AddCommand(
		newManifestCmd(),
		newReviewCmd(opts),
		newWebCmd(opts),
		newVersionCmd(opts),
		newActionsCmd(opts),
		newHealthCmd(opts),
		newCallCmd(opts),
		newSpecCmd(opts),
		newBlocksCmd(opts),
		newNativeToolsCmd(opts),
		newExternalCmd(opts),
		newPipelineCmd(opts),
		newWorkflowCmd(opts),
		newSchematicCmd(opts),
		newImpedanceCmd(opts),
		newFanoutCmd(opts),
		newDFMCmd(opts),
		newRouteCmd(opts),
		newStructuralCmd(opts),
		newAICmd(opts),
		newCLICmd(opts),
		newMCPCmd(opts),
	)

	return root
}

func newCLICmd(opts *Options) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "cli -- <kicad-cli args...>",
		Short: "Run any allowlisted kicad-cli subcommand",
		Args:  cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return &exitError{code: 1, err: fmt.Errorf("usage: kicad-agent cli -- <kicad-cli args...>")}
			}

			ctx, cancel := context.WithTimeout(cmd.Context(), opts.Timeout)
			defer cancel()

			res, err := dispatch(ctx, opts, "kicad.cli.run", map[string]any{"args": args})
			if err != nil {
				return &exitError{code: exitCodeForError(err), err: err}
			}

			writeResult(os.Stdout, res)
			if !res.OK {
				return &exitError{code: exitCodeForResult(res),
					err: fmt.Errorf("kicad-cli %s failed", args[0])}
			}
			return nil
		},
	}

	cmd.Flags().SetInterspersed(false)
	return cmd
}

func newMCPCmd(opts *Options) *cobra.Command {
	return &cobra.Command{
		Use:   "mcp",
		Short: "Run the MCP stdio server (for Claude Code, Cursor, etc.)",
		RunE: func(cmd *cobra.Command, args []string) error {
			// The MCP server re-executes this binary for every tool call.  Pass
			// the connection flags through so a non-default socket or CLI path
			// keeps working instead of silently falling back to the defaults.
			baseArgs := []string{}
			if opts.KicadCLI != "" {
				baseArgs = append(baseArgs, "--kicad-cli", opts.KicadCLI)
			}
			if opts.Socket != "" {
				baseArgs = append(baseArgs, "--socket", opts.Socket)
			}
			if opts.Timeout > 0 {
				baseArgs = append(baseArgs, "--timeout", opts.Timeout.String())
			}

			return mcp.Serve(cmd.Context(), os.Stdin, os.Stdout, baseArgs)
		},
	}
}

func resolveCLI(opts *Options) string {
	if opts.KicadCLI != "" {
		return opts.KicadCLI
	}
	if env := os.Getenv("KICAD_CLI"); env != "" {
		return env
	}
	if root := findRepoRoot(); root != "" {
		if p := backend.DefaultBuildCLI(root); p != "" {
			return p
		}
	}
	return "kicad-cli"
}

func findRepoRoot() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "api", "proto")); err == nil {
			if _, err := os.Stat(filepath.Join(dir, "CMakeLists.txt")); err == nil {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

func newCallCmd(opts *Options) *cobra.Command {
	var payloadRaw string
	var payloadFile string

	cmd := &cobra.Command{
		Use:   "call <action>",
		Short: "Run one typed KiCad action",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			payload := map[string]any{}
			if payloadRaw != "" {
				if err := json.Unmarshal([]byte(payloadRaw), &payload); err != nil {
					return fmt.Errorf("invalid --payload JSON: %w", err)
				}
			}
			if payloadFile != "" {
				raw, err := os.ReadFile(payloadFile)
				if err != nil {
					return err
				}
				if err := json.Unmarshal(raw, &payload); err != nil {
					return fmt.Errorf("invalid payload file JSON: %w", err)
				}
			}

			ctx, cancel := context.WithTimeout(cmd.Context(), opts.Timeout)
			defer cancel()

			res, err := dispatch(ctx, opts, args[0], payload)
			return finish(args[0], res, err)
		},
	}

	cmd.Flags().StringVar(&payloadRaw, "payload", "", "action payload as JSON")
	cmd.Flags().StringVar(&payloadFile, "payload-file", "", "read action payload from a JSON file")
	return cmd
}

func dispatch(ctx context.Context, opts *Options, action string, payload map[string]any) (*backend.Result, error) {
	if action == "system.manifest" {
		return manifestResult(), nil
	}
	if action == "audit.rules" {
		return &backend.Result{Action: action, OK: true, Data: designaudit.Rules()}, nil
	}
	if action == "audit.footprint" {
		return designaudit.Footprint(payload)
	}
	if action == "audit.run" {
		return designaudit.Run(ctx, payload, func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
			return dispatch(ctx, opts, a, p)
		})
	}
	if strings.HasPrefix(action, "web.") {
		return web.Call(ctx, action, payload)
	}
	// Composite system actions are implemented by the host command layer.
	if action == "system.health" {
		return healthResult(ctx, opts), nil
	}

	if action == "kicad.cli.run" {
		args := argStrings(payload, "args")

		return backend.NewKicadCLI(resolveCLI(opts)).RunRaw(ctx, args, opts.Timeout)
	}

	if action == "project.list" {
		depth := 2
		if _, ok := payload["depth"]; ok {
			depth = argInt(payload, "depth")
		}
		entries, err := projectpkg.Discover(argString(payload, "directory"), depth)
		if err != nil {
			return nil, err
		}
		return &backend.Result{Action: action, OK: true, Data: map[string]any{"count": len(entries), "projects": entries}}, nil
	}
	if action == "project.resolve" {
		path := argString(payload, "project")
		if path == "" {
			path = argString(payload, "directory")
		}
		if path == "" {
			path = "."
		}
		resolved, err := projectpkg.Resolve(path)
		if err != nil {
			return nil, err
		}
		return &backend.Result{Action: action, OK: true, Data: map[string]any{"path": resolved, "directory": filepath.Dir(resolved)}}, nil
	}
	if action == "project.open" || action == "project.switch" {
		socket := opts.Socket
		if socket == "" {
			socket = os.Getenv("KICAD_API_SOCKET")
		}

		return projectpkg.Open(ctx, projectpkg.Options{
			CLI:      resolveCLI(opts),
			Socket:   socket,
			Document: argString(payload, "document"),
			Project:  argString(payload, "project"),
			Timeout:  opts.Timeout,
		})
	}

	if action == "schematic.generate" {
		return schematicgen.RunAction(ctx, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
	}

	if strings.HasPrefix(action, "board.impedance.") {
		return impedancepkg.RunAction(ctx, action, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
	}

	if action == "board.fanout.run" {
		return fanout.Run(ctx, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
	}

	if strings.HasPrefix(action, "board.dfm.") {
		return dfmpkg.Run(ctx, action, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
	}

	if strings.HasPrefix(action, "board.route.") {
		return routing.Run(ctx, action, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
	}

	if boardops.Actions[action] {
		return boardops.Run(ctx, action, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
	}

	// DRC/ERC of the open document (unsaved edits included) when no saved
	// input file is named.
	if (action == "board.drc.run" || action == "schematic.erc.run") &&
		argString(payload, "input") == "" && payload["document"] != nil {
		return boardops.LiveRules(ctx, action, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
	}

	if action == "board.check.3d" {
		return structural.Run(ctx, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
	}

	if action == "editor.run_action" {
		if err := validateNativeAction(payload); err != nil {
			return nil, err
		}
	}

	spec, ok := kicadactions.ByName()[action]
	if !ok {
		detail := "run 'kicad-agent actions --search <words>' to find actions"
		if hits := kicadactions.SearchActions(strings.ReplaceAll(action, ".", " "), 5); len(hits) > 0 {
			names := make([]string, 0, len(hits))
			for _, h := range hits {
				names = append(names, h.Name)
			}
			detail = "did you mean: " + strings.Join(names, ", ")
		}
		return nil, &backend.Error{Code: "UNKNOWN_ACTION",
			Message: fmt.Sprintf("unknown action %q", action), Detail: detail}
	}

	switch spec.Backend {
	case kicadactions.BackendCLI:
		return backend.NewKicadCLI(resolveCLI(opts)).Call(ctx, action, payload)
	case kicadactions.BackendIPC:
		socket := opts.Socket
		if socket == "" {
			socket = os.Getenv("KICAD_API_SOCKET")
		}
		ipc := backend.NewIPCClient(socket)
		ipc.Timeout = opts.Timeout
		return ipc.CallAction(ctx, action, payload)
	case kicadactions.BackendOffline:
		return runOffline(action, payload)
	case kicadactions.BackendExternal:
		return external.Call(ctx, action, payload, opts.Timeout)
	case kicadactions.BackendComposite:
		return pipeline.RunAction(ctx, action, payload,
			func(ctx context.Context, a string, p map[string]any) (*backend.Result, error) {
				return dispatch(ctx, opts, a, p)
			})
	default:
		return nil, &backend.Error{Code: "UNKNOWN_BACKEND",
			Message: fmt.Sprintf("action %q has unsupported backend %q", action, spec.Backend)}
	}
}

func writeResult(f *os.File, res *backend.Result) {
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	_ = enc.Encode(res)
}

// finish writes the action envelope to stdout and returns a non-nil *exitError
// when the command must exit non-zero.  It guarantees exactly one JSON object
// on stdout for every outcome, including failures, so agents and the VS Code
// front end never see an empty stdout.
func finish(action string, res *backend.Result, err error) error {
	if err != nil {
		writeResult(os.Stdout, &backend.Result{
			OK:     false,
			Action: action,
			Error:  backend.ErrorFrom(err),
		})
		return &exitError{code: exitCodeForError(err), err: err}
	}

	if res == nil {
		writeResult(os.Stdout, &backend.Result{
			OK:     false,
			Action: action,
			Error:  &backend.Error{Code: "ACTION_FAILED", Message: "empty result"},
		})
		return &exitError{code: 1, err: fmt.Errorf("%s: empty result", action)}
	}

	writeResult(os.Stdout, res)

	if !res.OK {
		return &exitError{code: exitCodeForResult(res), err: fmt.Errorf("%s failed", res.Action)}
	}

	if m, ok := res.Data.(map[string]any); ok {
		if s, _ := m["status"].(string); s == "violations" {
			return &exitError{code: 5, err: fmt.Errorf("%s reported violations", res.Action)}
		}
	}

	return nil
}

func exitCodeForError(err error) int {
	var be *backend.Error
	if errors.As(err, &be) {
		switch be.Code {
		case "TIMEOUT", "EXTERNAL_TIMEOUT":
			return 8
		case "CANCELLED":
			return 9
		}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return 8
	}
	if errors.Is(err, context.Canceled) {
		return 9
	}
	return 1
}

func exitCodeForResult(res *backend.Result) int {
	if res == nil || res.Error == nil {
		return 1
	}
	switch res.Error.Code {
	case "TIMEOUT", "EXTERNAL_TIMEOUT":
		return 8
	case "CANCELLED":
		return 9
	}
	return 1
}

// validateNativeAction rejects editor.run_action names that are not in the
// native tool inventory, suggesting close matches.  Plugin and dynamically
// registered actions can bypass the check with "unchecked": true.
func validateNativeAction(p map[string]any) error {
	name := argString(p, "action")
	if name == "" {
		return &backend.Error{Code: "BAD_INPUT", Message: "action is required",
			Detail: "find one with editor.native.search {\"query\": \"...\"}"}
	}
	if unchecked, _ := p["unchecked"].(bool); unchecked {
		return nil
	}
	if _, ok := kicadactions.NativeToolByName(name); ok {
		return nil
	}
	hits := kicadactions.SearchNativeTools(strings.NewReplacer(".", " ", "_", " ").Replace(name), "", "", false, 5)
	names := make([]string, 0, len(hits))
	for _, h := range hits {
		names = append(names, h.Name)
	}
	return &backend.Error{Code: "NATIVE_TOOL_NOT_FOUND",
		Message: fmt.Sprintf("%q is not a registered KiCad tool action", name),
		Detail:  "closest: " + strings.Join(names, ", ") + " (pass unchecked=true for plugin actions)"}
}
