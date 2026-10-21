// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/external"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadactions"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/library"
)

func newVersionCmd(opts *Options) *cobra.Command {
	return &cobra.Command{
		Use:   "version",
		Short: "Print the kicad-cli version",
		RunE: func(cmd *cobra.Command, args []string) error {
			v, err := backend.NewKicadCLI(resolveCLI(opts)).Version(cmd.Context())
			res := &backend.Result{Action: "system.version", OK: err == nil,
				Data: map[string]any{"version": v}}
			if err != nil {
				res.Error = &backend.Error{Code: "CLI_FAILED", Message: err.Error()}
			}
			writeResult(os.Stdout, res)
			if err != nil {
				return &exitError{code: 1, err: err}
			}
			return nil
		},
	}
}

func newActionsCmd(opts *Options) *cobra.Command {
	var domain, search, mutates string

	cmd := &cobra.Command{
		Use:   "actions",
		Short: "List typed KiCad automation actions",
		RunE: func(cmd *cobra.Command, args []string) error {
			all := kicadactions.All()
			if search != "" {
				// Ranked natural-language search (Chinese or English).
				all = all[:0:0]
				for _, hit := range kicadactions.SearchActions(search, 0) {
					all = append(all, hit.ActionSpec)
				}
			}
			out := make([]kicadactions.ActionSpec, 0, len(all))

			for _, a := range all {
				if domain != "" && string(a.Domain) != strings.ToLower(domain) {
					continue
				}
				if mutates != "" {
					want := strings.EqualFold(mutates, "true")
					if a.Mutates != want {
						continue
					}
				}
				out = append(out, a)
			}

			res := &backend.Result{Action: "system.actions", OK: true,
				Data: map[string]any{"count": len(out), "actions": out}}
			writeResult(os.Stdout, res)
			return nil
		},
	}

	cmd.Flags().StringVar(&domain, "domain", "", "filter by domain")
	cmd.Flags().StringVar(&search, "search", "", "ranked natural-language search in Chinese or English")
	cmd.Flags().StringVar(&mutates, "mutates", "", "true or false")
	return cmd
}

func newHealthCmd(opts *Options) *cobra.Command {
	return &cobra.Command{
		Use:   "health",
		Short: "Check kicad-cli, IPC, and external tools",
		RunE: func(cmd *cobra.Command, args []string) error {
			res := healthResult(cmd.Context(), opts)
			writeResult(os.Stdout, res)
			if !res.OK {
				return &exitError{code: 1, err: fmt.Errorf("kicad-cli is unavailable")}
			}
			return nil
		},
	}
}

// healthResult is shared by `kicad-agent health` and the pipeline's health stage.
func healthResult(ctx context.Context, opts *Options) *backend.Result {
	report := map[string]any{}
	checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	cli := backend.NewKicadCLI(resolveCLI(opts))
	version, cliErr := cli.Version(checkCtx)
	cliReport := map[string]any{
		"path":      cli.Binary,
		"available": cliErr == nil,
		"version":   version,
	}
	if cliErr != nil {
		cliReport["error"] = cliErr.Error()
	}
	report["kicadCli"] = cliReport

	socket := opts.Socket
	if socket == "" {
		socket = os.Getenv("KICAD_API_SOCKET")
	}
	ipc := backend.NewIPCClient(socket)
	ipc.Timeout = 2 * time.Second
	ipcRes, ipcErr := ipc.CallAction(checkCtx, "system.capabilities", map[string]any{})
	ipcReport := map[string]any{
		"socket":    ipc.SocketPath,
		"available": ipcErr == nil && ipcRes != nil && ipcRes.OK,
	}
	if ipcErr != nil {
		ipcReport["error"] = ipcErr.Error()
	} else if ipcRes != nil {
		ipcReport["capabilities"] = ipcRes.Data
	}
	report["ipc"] = ipcReport
	documents := map[string]any{"available": false, "pcb": nil, "schematic": nil}
	if ipcErr == nil && ipcRes != nil && ipcRes.OK {
		documents["available"] = true
		for _, kind := range []string{"pcb", "schematic"} {
			res, err := ipc.CallAction(checkCtx, "document.list", map[string]any{"type": kind})
			if err != nil {
				documents[kind] = map[string]any{"available": false, "error": err.Error()}
			} else if res != nil {
				documents[kind] = map[string]any{"available": res.OK, "data": res.Data}
			}
		}
	}
	report["documents"] = documents
	report["compiledCapabilities"] = manifestResult().Data
	report["scope"] = "CLI, IPC, loaded documents and optional tools are independent layers. MCP catalog availability does not imply a live KiCad document."

	report["externalTools"] = external.DetectWithCLI(cli.Binary)

	res := &backend.Result{Action: "system.health", OK: cliErr == nil, Data: report}
	if cliErr != nil {
		res.Error = &backend.Error{Code: "CLI_UNAVAILABLE", Message: cliErr.Error()}
	}
	return res
}

// runOffline executes actions that do not need a live KiCad instance.
func runOffline(action string, p map[string]any) (*backend.Result, error) {
	switch action {
	case "spec.validate":
		return offlineSpec(p)
	case "blocks.list", "blocks.search", "blocks.show":
		return offlineBlocks(action, p)
	case "external.tools.list":
		return &backend.Result{Action: action, OK: true,
			Data: map[string]any{"tools": external.Detect()}}, nil
	case "library.search.footprints":
		footprints, err := library.SearchFootprints(p)
		if err != nil {
			return nil, err
		}
		return &backend.Result{Action: action, OK: true,
			Data: map[string]any{"footprints": footprints, "count": len(footprints)}}, nil
	case "workflow.init", "workflow.status", "workflow.advance", "workflow.confirm", "workflow.reset":
		return pipelineWorkflow(action, p)
	case "editor.native.search", "editor.native.list", "editor.native.show", "editor.native.categories":
		return nativeToolsResult(action, p)
	default:
		return nil, &backend.Error{Code: "UNKNOWN_ACTION",
			Message: fmt.Sprintf("offline backend does not implement %q", action)}
	}
}

func jsonEncode(v any) string {
	raw, _ := json.MarshalIndent(v, "", "  ")
	return string(raw)
}
