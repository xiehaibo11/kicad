// SPDX-License-Identifier: GPL-3.0-or-later
package commands

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"github.com/spf13/cobra"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/engineering"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadactions"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/mcp"
	"runtime"
)

func manifestResult() *backend.Result {
	actions := kicadactions.All()
	raw, _ := json.Marshal(actions)
	hash := sha256.Sum256(raw)
	native, err := kicadactions.NativeTools()
	if err != nil {
		return &backend.Result{Action: "system.manifest", OK: false, Error: backend.ErrorFrom(err)}
	}
	names := mcp.ToolNames()
	return &backend.Result{Action: "system.manifest", OK: true, Data: map[string]any{"schemaVersion": 1, "agentVersion": "0.2.0", "catalogSha256": hex.EncodeToString(hash[:]), "actionCount": len(actions), "mcpToolCount": len(names), "mcpTools": names, "nativeToolCount": len(native), "engineeringReferences": engineering.Inventory(), "goVersion": runtime.Version(), "os": runtime.GOOS, "arch": runtime.GOARCH}}
}

func newManifestCmd() *cobra.Command {
	return &cobra.Command{Use: "manifest", Short: "Inspect compiled capabilities and build inventory", RunE: func(cmd *cobra.Command, args []string) error { return finish("system.manifest", manifestResult(), nil) }}
}
func newReviewCmd(opts *Options) *cobra.Command {
	parent := &cobra.Command{Use: "audit", Short: "Backend design and footprint audits using native DRC/ERC and project rules"}
	parent.AddCommand(&cobra.Command{Use: "rules", Short: "Query backend audit coverage and evidence policy", RunE: func(cmd *cobra.Command, args []string) error {
		res, err := dispatch(cmd.Context(), opts, "audit.rules", nil)
		return finish("audit.rules", res, err)
	}})
	var board, schematic, profile, output string
	run := &cobra.Command{Use: "run", Short: "Audit a saved PCB and corresponding schematic without modifying them", RunE: func(cmd *cobra.Command, args []string) error {
		res, err := dispatch(cmd.Context(), opts, "audit.run", map[string]any{"board": board, "schematic": schematic, "manufacturingProfile": profile, "output": output})
		return finish("audit.run", res, err)
	}}
	run.Flags().StringVar(&board, "board", "", "PCB file")
	run.Flags().StringVar(&schematic, "schematic", "", "corresponding schematic (default: sibling)")
	run.Flags().StringVar(&profile, "manufacturing-profile", "", "manufacturer limit JSON (default: sibling manufacturing.json)")
	run.Flags().StringVar(&output, "output", "", "new report JSON path")
	_ = run.MarkFlagRequired("board")
	parent.AddCommand(run)
	parent.AddCommand(&cobra.Command{Use: "footprint <file.kicad_mod>", Short: "Audit footprint structure and identify unverified engineering evidence", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		res, err := dispatch(cmd.Context(), opts, "audit.footprint", map[string]any{"input": args[0]})
		return finish("audit.footprint", res, err)
	}})
	return parent
}
func newWebCmd(opts *Options) *cobra.Command {
	parent := &cobra.Command{Use: "web", Short: "Research public websites and component datasheets"}
	var limit int
	search := &cobra.Command{Use: "search <query>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		res, err := dispatch(cmd.Context(), opts, "web.search", map[string]any{"query": args[0], "limit": limit})
		return finish("web.search", res, err)
	}}
	search.Flags().IntVar(&limit, "limit", 5, "result count (1..10)")
	parent.AddCommand(search)
	var output string
	fetch := &cobra.Command{Use: "fetch <url>", Args: cobra.ExactArgs(1), RunE: func(cmd *cobra.Command, args []string) error {
		res, err := dispatch(cmd.Context(), opts, "web.fetch", map[string]any{"url": args[0], "output": output})
		return finish("web.fetch", res, err)
	}}
	fetch.Flags().StringVar(&output, "output", "", "new PDF destination (optional)")
	parent.AddCommand(fetch)
	return parent
}
