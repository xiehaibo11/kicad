// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package kicadactions defines the typed KiCad automation action catalog.
//
// The catalog is the single source of truth used by:
//   - `kicad-agent actions` (discovery for humans and agents)
//   - the MCP server (one tool per domain, action enum from this catalog)
//   - the pipeline orchestrator (each stage names an action)
//
// Actions are grouped by domain and declare their backend transport.  A KiCad
// action must never pretend an unimplemented engine exists: missing capabilities
// are reported as UNIMPLEMENTED by the backend and remain visible in the catalog.
package kicadactions

import "sync"

type Domain string

const (
	DomainSystem    Domain = "system"
	DomainProject   Domain = "project"
	DomainDocument  Domain = "document"
	DomainSchematic Domain = "schematic"
	DomainBoard     Domain = "board"
	DomainLibrary   Domain = "library"
	DomainExternal  Domain = "external"
	DomainEditor    Domain = "editor"
	DomainPipeline  Domain = "pipeline"
	DomainSpec      Domain = "spec"
	DomainWorkflow  Domain = "workflow"
	DomainBlocks    Domain = "blocks"
	DomainAudit     Domain = "audit"
	DomainWeb       Domain = "web"
	DomainGerber    Domain = "gerber"
	DomainReference Domain = "reference"
)

// Backend names the transport that serves an action.
type Backend string

const (
	BackendIPC       Backend = "ipc"       // KiCad protobuf API over NNG
	BackendCLI       Backend = "cli"       // kicad-cli subprocess
	BackendExternal  Backend = "external"  // third-party tool (Freerouting, ngspice, ...)
	BackendOffline   Backend = "offline"   // local analysis, no live KiCad
	BackendComposite Backend = "composite" // orchestrates other actions
)

type ActionSpec struct {
	Name         string   `json:"name"`
	Domain       Domain   `json:"domain"`
	Backend      Backend  `json:"backend"`
	Mutates      bool     `json:"mutates"`
	Experimental bool     `json:"experimental,omitempty"`
	Description  string   `json:"description"`
	Inputs       []string `json:"inputs,omitempty"`
	Outputs      []string `json:"outputs,omitempty"`
	VerifyWith   []string `json:"verifyWith,omitempty"`
	// Keywords are extra natural-language triggers (Chinese and English) used
	// by action search and MCP tool descriptions.
	Keywords []string `json:"keywords,omitempty"`
	// CLI is the kicad-cli subcommand path served by a generic CLI action.
	CLI []string `json:"cli,omitempty"`
}

var (
	catalogOnce  sync.Once
	catalogCache []ActionSpec
)

// All returns the complete KiCad action catalog.  The result is shared; callers
// must not modify it.
func All() []ActionSpec {
	catalogOnce.Do(func() {
		var out []ActionSpec
		for _, group := range [][]ActionSpec{
			coreActions(), editorActions(), boardExtraActions(), reviewActions(), engineeringActions(),
			ipcExtraActions(), cliGeneratedActions(), designActions(),
		} {
			out = append(out, group...)
		}
		attachCLIPaths(out)
		applyCoreKeywords(out)
		catalogCache = out
	})
	return catalogCache
}

func coreActions() []ActionSpec {
	return []ActionSpec{
		// System / session
		{
			Name: "system.health", Domain: DomainSystem, Backend: BackendComposite,
			Description: "Check the kicad-cli binary, the KiCad IPC socket, and enabled external tools.",
			Outputs:     []string{"kicad-cli version", "ipc status", "external tools"},
		},
		{
			Name: "system.version", Domain: DomainSystem, Backend: BackendCLI,
			Description: "Return the KiCad build version.",
			Outputs:     []string{"version"},
		},
		{
			Name: "system.capabilities", Domain: DomainSystem, Backend: BackendIPC,
			Description: "Enumerate capabilities served by the running KiCad API instance.",
			Outputs:     []string{"api version", "capabilities"},
		},

		// Project / document lifecycle
		{
			Name: "project.list", Domain: DomainProject, Backend: BackendOffline,
			Description: "Discover KiCad projects and root documents in a workspace directory without opening editors. Use the returned full project path to switch; never guess the first PCB in a multi-project directory.",
			Inputs:      []string{"directory optional (default working directory)", "depth optional (0-8, default 2)"},
			Outputs:     []string{"projects", "count"}, Keywords: []string{"工程目录", "查看工程", "切换工程", "项目列表", "workspace", "project directory"},
		},
		{
			Name: "project.resolve", Domain: DomainProject, Backend: BackendOffline,
			Description: "Resolve a directory or file to a whole KiCad project; reports PROJECT_AMBIGUOUS and candidates when a directory contains several projects.",
			Inputs:      []string{"project or directory"}, Outputs: []string{"path", "directory"},
		},
		{
			Name: "project.switch", Domain: DomainProject, Backend: BackendComposite, Mutates: true,
			Description: "Switch to a selected project using its full path, preserving the GUI manager and its save/cancel checks. Switching to the current project keeps its editors open.",
			Inputs:      []string{"project (directory or .kicad_pro)", "document optional"}, Outputs: []string{"document", "socket"},
		},
		{
			Name: "project.open", Domain: DomainProject, Backend: BackendIPC, Mutates: true,
			Description: "Open a project in the running API server, or start a detached kicad-cli api-server for it.",
			Inputs:      []string{"project (directory or .kicad_pro)", "document optional (.kicad_pcb/.kicad_sch)"},
			Outputs:     []string{"socket", "document", "pid", "spawned"},
		},
		{
			Name: "project.info", Domain: DomainProject, Backend: BackendIPC,
			Description: "Describe a saved project from disk when a path is given (works offline), or return the open project and document identity when it is not.",
			Inputs:      []string{"project optional (directory, .kicad_pro, .kicad_pcb or .kicad_sch)"},
			Outputs:     []string{"source", "name", "directory", "documents", "sheets", "meta"},
		},
		{
			Name: "document.list", Domain: DomainDocument, Backend: BackendIPC,
			Description: "List documents currently open in the KiCad API session.",
			Outputs:     []string{"documents"},
		},
		{
			Name: "document.save", Domain: DomainDocument, Backend: BackendIPC, Mutates: true,
			Description: "Save the active document.",
			Inputs:      []string{"document"},
			Outputs:     []string{"saved"},
		},
		{
			Name: "document.revert", Domain: DomainDocument, Backend: BackendIPC, Mutates: true,
			Description: "Reload the active document from disk.",
			Inputs:      []string{"document"},
			Outputs:     []string{"reverted"},
		},

		// Board item model
		{
			Name: "board.items.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Enumerate board items by type.",
			Inputs:      []string{"document", "types[]", "options optional"},
			Outputs:     []string{"items"},
		},
		{
			Name: "board.items.create", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Create board items from serialized protobuf messages.",
			Inputs:      []string{"document", "items[]", "container optional"},
			Outputs:     []string{"created"},
		},
		{
			Name: "board.items.update", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Update board items by KIID.",
			Inputs:      []string{"document", "items[]"},
			Outputs:     []string{"updated"},
		},
		{
			Name: "board.items.delete", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Delete board items by KIID.",
			Inputs:      []string{"document", "ids[]"},
			Outputs:     []string{"deleted"},
		},
		{
			Name: "board.connectivity.prove", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Prove pad/via connections to copper, including filled zones and inner-layer planes.",
			Inputs:      []string{"document", "anchors[] optional", "nets[] optional", "requireFilledZones optional"},
			Outputs:     []string{"ok", "endpoints", "unconnectedNets", "unconnectedCount"},
			VerifyWith:  []string{"board.drc.run"},
		},
		{
			Name: "board.layers.get", Domain: DomainBoard, Backend: BackendIPC,
			Description: "List the board's enabled layers, including copper layers.",
			Inputs:      []string{"document"},
			Outputs:     []string{"copperLayerCount", "layers"},
		},
		{
			Name: "board.stackup.read", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Read the board stackup.",
			Inputs:      []string{"document"},
			Outputs:     []string{"stackup"},
		},
		{
			Name: "board.stackup.write", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Update stackup thickness and dielectric properties.  Copper layer count is fixed.",
			Inputs:      []string{"document", "stackup"},
			Outputs:     []string{"stackup"},
			VerifyWith:  []string{"board.stackup.read"},
		},
		{
			Name: "board.zones.refill", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Refill copper zones.",
			Inputs:      []string{"document", "zones[] optional"},
			Outputs:     []string{"filled"},
			VerifyWith:  []string{"board.connectivity.prove"},
		},
		{
			Name: "board.netlist.import", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Import a netlist and add/update/delete footprints.",
			Inputs:      []string{"document", "netlist", "dryRun optional", "updateFootprints optional"},
			Outputs:     []string{"matched", "created", "updated", "deleted"},
		},
		{
			Name: "board.place.autoplace", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Automatically place footprints using KiCad's autoplacer (requires a closed Edge_Cuts outline).",
			Inputs:      []string{"document", "footprints[] optional", "placeOffboard optional", "dryRun optional"},
			Outputs:     []string{"placed", "skipped", "report"},
			VerifyWith:  []string{"board.drc.run"},
		},
		{
			Name: "board.fanout.run", Domain: DomainBoard, Backend: BackendComposite, Mutates: true,
			Description: "BGA fanout: create via-in-pad or dog-bone escapes for a footprint.",
			Inputs:      []string{"document", "reference optional", "style via-in-pad|dogbone", "drillMm optional", "diameterMm optional", "clearanceMm optional", "trackWidthMm optional", "dryRun optional"},
			Outputs:     []string{"padCount", "viaCount", "trackCount", "created", "failed"},
			VerifyWith:  []string{"board.drc.run", "board.connectivity.prove"},
		},
		{
			Name: "board.plane.create", Domain: DomainBoard, Backend: BackendIPC, Mutates: true,
			Description: "Create a copper zone bound to an arbitrary net on inner layers (a KiCad plane is a net-bound zone).",
			Inputs:      []string{"document", "net", "layers[]", "outline[] optional", "clearanceNm optional", "minThicknessNm optional", "priority optional", "name optional", "fill optional"},
			Outputs:     []string{"plane"},
			VerifyWith:  []string{"board.plane.verify", "board.connectivity.prove"},
		},
		{
			Name: "board.plane.verify", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Verify a plane's materialized fill and pad/via connectivity.",
			Inputs:      []string{"document", "zone"},
			Outputs:     []string{"plane", "unconnectedPads", "unconnectedVias"},
		},
		{
			Name: "board.jobs.svg", Domain: DomainBoard, Backend: BackendIPC,
			Description: "Run the API export-SVG job and return a job id usable with job.status.",
			Inputs:      []string{"document", "output", "layers[] optional", "timeoutMs optional"},
			Outputs:     []string{"job_id", "status", "outputPaths", "elapsedMs"},
		},
		{
			Name: "board.drc.run", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Run design rule checks with a cooperative timeout and structured report. Large reports return summary/sampleViolations with the complete report at reportPath; pass full=true to inline reportJson.",
			Inputs:      []string{"input", "output optional", "format report|json", "timeoutMs optional", "refillZones optional", "schematicParity optional", "full optional", "sampleViolations optional"},
			Outputs:     []string{"status", "summary", "reportPath", "reportJson", "sampleViolations", "elapsedMs"},
		},
		{
			Name: "board.render", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Render the board to PNG/JPEG (2D or raytraced 3D).",
			Inputs:      []string{"input", "output", "width", "height", "side", "quality", "timeoutMs optional"},
			Outputs:     []string{"artifact"},
		},
		{
			Name: "board.impedance.layers", Domain: DomainBoard, Backend: BackendComposite,
			Description: "List copper layers with dielectric height and Er from the stackup.",
			Inputs:      []string{"stackup file optional", "document optional"},
			Outputs:     []string{"layers"},
		},
		{
			Name: "board.impedance.calculate", Domain: DomainBoard, Backend: BackendComposite,
			Description: "Analyze or synthesize microstrip/stripline/differential width for a target impedance.",
			Inputs:      []string{"stackup or document", "layer", "targetOhm", "gapMm optional", "widthMm optional", "differential optional"},
			Outputs:     []string{"z0Ohm", "zdiffOhm", "widthMm", "errorPct"},
		},
		{
			Name: "board.impedance.check", Domain: DomainBoard, Backend: BackendComposite,
			Description: "Check board track widths against the target impedance.",
			Inputs:      []string{"document", "layer optional", "targetOhm", "gapMm optional", "differential optional", "tolerancePct optional"},
			Outputs:     []string{"checkedTracks", "violations"},
		},
		{
			Name: "board.dfm.analyze", Domain: DomainBoard, Backend: BackendComposite,
			Description: "Analyze track widths and angles for batch DFM issues.",
			Inputs:      []string{"document", "minWidthMm optional"},
			Outputs:     []string{"trackCount", "violations"},
		},
		{
			Name: "board.dfm.fix", Domain: DomainBoard, Backend: BackendComposite, Mutates: true,
			Description: "Fix track widths below the minimum and snap off-grid angles.",
			Inputs:      []string{"document", "minWidthMm optional", "dryRun optional"},
			Outputs:     []string{"fixed", "failed", "violations"},
			VerifyWith:  []string{"board.drc.run"},
		},
		{
			Name: "board.route.autoroute", Domain: DomainBoard, Backend: BackendComposite, Mutates: true,
			Description: "Route nets with the L-router baseline or obstacle-aware grid planner (dry-run by default).",
			Inputs:      []string{"document", "nets[] optional", "widthMm optional", "planner optional (lrouter|grid)", "clearanceMm optional", "gridMm optional", "dryRun optional"},
			Outputs:     []string{"nets", "created", "verified"},
			VerifyWith:  []string{"board.drc.run", "board.connectivity.prove"},
		},
		{
			Name: "board.route.diff_pair", Domain: DomainBoard, Backend: BackendComposite, Mutates: true,
			Description: "Route differential pairs with parallel paths; refuses a pair that would short existing copper.",
			Inputs:      []string{"document", "pairs[]", "widthMm optional", "gapMm optional", "dryRun optional"},
			Outputs:     []string{"nets", "created", "verified"},
			VerifyWith:  []string{"board.drc.run", "board.connectivity.prove"},
		},
		{
			Name: "board.route.length_report", Domain: DomainBoard, Backend: BackendComposite,
			Description: "Report routed copper length for a net and the deficit to a target.",
			Inputs:      []string{"document", "net", "targetMm optional"},
			Outputs:     []string{"lengthMm", "deficitMm", "segments"},
		},
		{
			Name: "board.route.tune_length", Domain: DomainBoard, Backend: BackendComposite, Mutates: true,
			Description: "Replace the longest straight track on a net with a rectangular serpentine to reach a target length.",
			Inputs:      []string{"document", "net", "targetMm", "amplitudeMm optional", "spacingMm optional", "dryRun optional"},
			Outputs:     []string{"currentMm", "extraMm", "teeth", "created", "deleted", "verified"},
			VerifyWith:  []string{"board.route.length_report", "board.drc.run"},
		},
		{
			Name: "board.check.3d", Domain: DomainBoard, Backend: BackendComposite,
			Description: "2.5D structural check: footprint bounding boxes plus optional heights, with STEP export.",
			Inputs:      []string{"document", "heights optional", "exportStep optional"},
			Outputs:     []string{"footprints", "findings", "step"},
		},
		{
			Name: "board.export.gerbers", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Export Gerber files for manufacturing.",
			Inputs:      []string{"input", "outputDir", "layers optional", "timeoutMs optional"},
			Outputs:     []string{"artifacts"},
		},
		{
			Name: "board.export.drill", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Export Excellon/Gerber drill files, map, and report.",
			Inputs:      []string{"input", "outputDir", "format optional", "units optional", "generateMap optional", "timeoutMs optional"},
			Outputs:     []string{"artifacts"},
		},
		{
			Name: "board.export.position", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Export pick-and-place position data.",
			Inputs:      []string{"input", "output", "side optional", "format optional", "units optional", "timeoutMs optional"},
			Outputs:     []string{"artifact"},
		},
		{
			Name: "board.export.step", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Export a 3D model (STEP/STEPZ/BREP/GLB/VRML/STL).",
			Inputs:      []string{"input", "output", "format optional", "timeoutMs optional"},
			Outputs:     []string{"artifact"},
		},
		{
			Name: "board.export.svg", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Export board layers to SVG.",
			Inputs:      []string{"input", "outputDir", "layers optional", "timeoutMs optional"},
			Outputs:     []string{"artifacts"},
		},
		{
			Name: "board.export.pdf", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Export board layers to PDF.",
			Inputs:      []string{"input", "outputDir", "layers optional", "timeoutMs optional"},
			Outputs:     []string{"artifacts"},
		},
		{
			Name: "board.export.png", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Export board layers to PNG.",
			Inputs:      []string{"input", "outputDir", "layers optional", "dpi optional", "timeoutMs optional"},
			Outputs:     []string{"artifacts"},
		},
		{
			Name: "board.export.ipc2581", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Export IPC-2581 manufacturing data.",
			Inputs:      []string{"input", "output", "version optional", "units optional", "timeoutMs optional"},
			Outputs:     []string{"artifact"},
		},
		{
			Name: "board.export.odb", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Export ODB++ manufacturing data.",
			Inputs:      []string{"input", "output", "compression optional", "units optional", "timeoutMs optional"},
			Outputs:     []string{"artifact"},
		},
		{
			Name: "board.diff", Domain: DomainBoard, Backend: BackendCLI,
			Description: "Diff two boards and emit JSON/text/PNG/SVG.",
			Inputs:      []string{"fileA", "fileB", "format optional", "output optional"},
			Outputs:     []string{"diff"},
		},

		// Schematic
		{
			Name: "schematic.items.get", Domain: DomainSchematic, Backend: BackendIPC,
			Description: "Enumerate schematic items by type.",
			Inputs:      []string{"document", "types[]"},
			Outputs:     []string{"items"},
		},
		{
			Name: "schematic.items.create", Domain: DomainSchematic, Backend: BackendIPC, Mutates: true,
			Description: "Create schematic items from serialized protobuf messages.",
			Inputs:      []string{"document", "items[]"},
			Outputs:     []string{"created"},
		},
		{
			Name: "schematic.items.update", Domain: DomainSchematic, Backend: BackendIPC, Mutates: true,
			Description: "Update schematic items by KIID.",
			Inputs:      []string{"document", "items[]"},
			Outputs:     []string{"updated"},
		},
		{
			Name: "schematic.items.delete", Domain: DomainSchematic, Backend: BackendIPC, Mutates: true,
			Description: "Delete schematic items by KIID.",
			Inputs:      []string{"document", "ids[]"},
			Outputs:     []string{"deleted"},
		},
		{
			Name: "schematic.erc.run", Domain: DomainSchematic, Backend: BackendCLI,
			Description: "Run electrical rules checks with a cooperative timeout and structured report. Large reports return summary/sampleViolations with the complete report at reportPath; pass full=true to inline reportJson.",
			Inputs:      []string{"input", "output optional", "format report|json", "timeoutMs optional", "full optional", "sampleViolations optional"},
			Outputs:     []string{"status", "summary", "reportPath", "reportJson", "sampleViolations", "elapsedMs"},
		},
		{
			Name: "schematic.create", Domain: DomainSchematic, Backend: BackendIPC, Mutates: true,
			Description: "Create a new empty schematic document in the open project.",
			Inputs:      []string{"path"},
			Outputs:     []string{"document"},
		},
		{
			Name: "schematic.place.symbol", Domain: DomainSchematic, Backend: BackendIPC, Mutates: true,
			Description: "Place a symbol from a library and return its absolute pin positions.",
			Inputs:      []string{"document", "libId", "position", "unit optional", "reference optional", "value optional", "footprint optional"},
			Outputs:     []string{"item", "symbol", "pins"},
			VerifyWith:  []string{"schematic.erc.run"},
		},
		{
			Name: "schematic.annotate", Domain: DomainSchematic, Backend: BackendIPC, Mutates: true,
			Description: "Annotate schematic symbols using KiCad's reference list.",
			Inputs:      []string{"document", "reset optional", "start optional", "useSheetNumber optional", "sheetInterval optional"},
			Outputs:     []string{"annotations"},
			VerifyWith:  []string{"schematic.erc.run"},
		},
		{
			Name: "schematic.generate", Domain: DomainSchematic, Backend: BackendComposite, Mutates: true,
			Description: "Generate a schematic from a circuit spec: place symbols, label nets, annotate, save, and run ERC.",
			Inputs:      []string{"spec", "project", "document optional", "new optional", "dryRun optional"},
			Outputs:     []string{"components", "nets", "pins", "erc"},
		},
		{
			Name: "schematic.netlist.get", Domain: DomainSchematic, Backend: BackendIPC,
			Description: "Return the connectivity-derived schematic netlist.",
			Inputs:      []string{"document"},
			Outputs:     []string{"nets"},
		},
		{
			Name: "schematic.export.netlist", Domain: DomainSchematic, Backend: BackendCLI,
			Description: "Export a netlist (KiCad s-expression/XML, SPICE, or CAD interchange formats).",
			Inputs:      []string{"input", "output", "format optional", "timeoutMs optional"},
			Outputs:     []string{"artifact"},
		},
		{
			Name: "schematic.export.bom", Domain: DomainSchematic, Backend: BackendCLI,
			Description: "Export a BOM (CSV/TSV/HTML/JSON or a format preset).",
			Inputs:      []string{"input", "output", "formatPreset optional", "fields optional", "excludeDnp optional", "timeoutMs optional"},
			Outputs:     []string{"artifact"},
		},
		{
			Name: "schematic.export.pdf", Domain: DomainSchematic, Backend: BackendCLI,
			Description: "Export schematic sheets to PDF.",
			Inputs:      []string{"input", "outputDir", "pages optional", "timeoutMs optional"},
			Outputs:     []string{"artifacts"},
		},
		{
			Name: "schematic.export.svg", Domain: DomainSchematic, Backend: BackendCLI,
			Description: "Export schematic sheets to SVG.",
			Inputs:      []string{"input", "outputDir", "pages optional", "timeoutMs optional"},
			Outputs:     []string{"artifacts"},
		},
		{
			Name: "schematic.export.pythonbom", Domain: DomainSchematic, Backend: BackendCLI,
			Description: "Export the legacy XML BOM source consumed by the Python BOM scripts.",
			Inputs:      []string{"input", "output"},
			Outputs:     []string{"artifact"},
		},
		{
			Name: "schematic.diff", Domain: DomainSchematic, Backend: BackendCLI,
			Description: "Diff two schematics and emit JSON/text/PNG/SVG.",
			Inputs:      []string{"fileA", "fileB", "format optional", "output optional"},
			Outputs:     []string{"diff"},
		},

		// Library / discovery (server-side search is planned; see the C++ roadmap)
		{
			Name: "library.search.symbols", Domain: DomainLibrary, Backend: BackendIPC,
			Description: "Search symbol libraries by name, keywords, pin count, or footprint filter.",
			Inputs:      []string{"query", "library optional", "minPins optional", "maxPins optional", "keywords[] optional", "limit optional"},
			Outputs:     []string{"symbols"},
		},
		{
			Name: "library.get.symbol", Domain: DomainLibrary, Backend: BackendIPC,
			Description: "Load one symbol's full embedded definition and pin list.",
			Inputs:      []string{"libId ('Library:Symbol')"},
			Outputs:     []string{"definition", "pins"},
		},
		{
			Name: "library.search.footprints", Domain: DomainLibrary, Backend: BackendOffline,
			Experimental: true,
			Description:  "Search footprint libraries by name, keywords, pad count, or courtyard size.",
			Inputs:       []string{"query", "library optional", "minPads optional", "maxPads optional", "limit optional"},
			Outputs:      []string{"footprints"},
		},

		{
			Name: "kicad.cli.run", Domain: DomainSystem, Backend: BackendComposite, Mutates: true,
			Description: "Run any non-interactive kicad-cli subcommand (version, pcb, sch, sym, fp, gerber, import, jobset).",
			Inputs:      []string{"args[]"},
			Outputs:     []string{"exitCode", "stdout", "stderr"},
		},
		{
			Name: "job.status", Domain: DomainSystem, Backend: BackendIPC,
			Description: "Return the state and timing of a dispatched job.",
			Inputs:      []string{"job_id"},
			Outputs:     []string{"status", "elapsedMs", "message"},
		},
		{
			Name: "job.cancel", Domain: DomainSystem, Backend: BackendIPC,
			Description: "Request cooperative cancellation of a running job.",
			Inputs:      []string{"job_id"},
			Outputs:     []string{"cancelRequested", "message"},
		},

		// External tools
		{
			Name: "external.tools.list", Domain: DomainExternal, Backend: BackendOffline,
			Description: "List known external tools and whether they are installed.",
			Outputs:     []string{"tools"},
		},
		{
			Name: "external.freerouting.run", Domain: DomainExternal, Backend: BackendExternal, Mutates: true,
			Description: "Run Freerouting on a Specctra DSN and import the resulting SES.",
			Inputs:      []string{"input", "output optional", "jar optional", "passes optional", "timeoutMs optional"},
			Outputs:     []string{"artifact", "status"},
			VerifyWith:  []string{"board.drc.run", "board.connectivity.prove"},
		},
		{
			Name: "external.ngspice.run", Domain: DomainExternal, Backend: BackendExternal,
			Description: "Run an ngspice batch simulation on an exported SPICE deck.",
			Inputs:      []string{"input", "output optional", "timeoutMs optional"},
			Outputs:     []string{"vectors", "log"},
		},
		{
			Name: "external.step.check", Domain: DomainExternal, Backend: BackendExternal,
			Description: "Run a mechanical/STEP check (external script or tool).",
			Inputs:      []string{"input", "enclosure optional", "timeoutMs optional"},
			Outputs:     []string{"collisions", "heights"},
		},
		{
			Name: "external.step.meshcheck", Domain: DomainExternal, Backend: BackendExternal,
			Description: "Exact STEP solid-collision check (OpenCASCADE boolean intersection).",
			Inputs:      []string{"input (STEP file)", "minVolumeMm3 optional", "maxPairs optional", "timeoutMs optional"},
			Outputs:     []string{"solids", "collisions", "checkedPairs"},
		},
		{
			Name: "external.command.run", Domain: DomainExternal, Backend: BackendExternal,
			Description: "Run an explicitly allowed external command and capture stdout/stderr.",
			Inputs:      []string{"command", "args[]", "timeoutMs optional"},
			Outputs:     []string{"exitCode", "stdout", "stderr"},
		},

		// Offline design intelligence (reused from upstream packages)
		{
			Name: "spec.validate", Domain: DomainSpec, Backend: BackendOffline,
			Description: "Parse and validate an S0 design spec (modules, interfaces, stackup, flow).",
			Inputs:      []string{"input (JSON file)"},
			Outputs:     []string{"spec", "issues"},
		},
		{
			Name: "workflow.init", Domain: DomainWorkflow, Backend: BackendOffline, Mutates: true,
			Description: "Initialize the design workflow state for a project.",
			Inputs:      []string{"project"},
			Outputs:     []string{"state"},
		},
		{
			Name: "workflow.status", Domain: DomainWorkflow, Backend: BackendOffline,
			Description: "Return the current workflow stage and gates.",
			Inputs:      []string{"project", "reconcile optional"},
			Outputs:     []string{"state"},
		},
		{
			Name: "workflow.advance", Domain: DomainWorkflow, Backend: BackendOffline, Mutates: true,
			Description: "Advance the workflow stage when gates pass.",
			Inputs:      []string{"project", "minScore optional", "maxCrossings optional"},
			Outputs:     []string{"state"},
		},
		{
			Name: "workflow.confirm", Domain: DomainWorkflow, Backend: BackendOffline, Mutates: true,
			Description: "Record an explicit user confirmation (layout or outline).",
			Inputs:      []string{"project", "confirmation", "note optional"},
			Outputs:     []string{"state"},
		},
		{
			Name: "workflow.reset", Domain: DomainWorkflow, Backend: BackendOffline, Mutates: true,
			Description: "Reset workflow state from a stage or entirely.",
			Inputs:      []string{"project", "resetAll optional", "resetFrom optional"},
			Outputs:     []string{"state"},
		},
		{
			Name: "blocks.list", Domain: DomainBlocks, Backend: BackendOffline,
			Description: "List reusable circuit blocks from the upstream block library.",
			Outputs:     []string{"blocks"},
		},
		{
			Name: "blocks.search", Domain: DomainBlocks, Backend: BackendOffline,
			Description: "Search reusable circuit blocks.",
			Inputs:      []string{"query"},
			Outputs:     []string{"blocks"},
		},
		{
			Name: "blocks.show", Domain: DomainBlocks, Backend: BackendOffline,
			Description: "Show one circuit block definition.",
			Inputs:      []string{"id"},
			Outputs:     []string{"block"},
		},

		// Composite pipeline
		{
			Name: "pipeline.run", Domain: DomainPipeline, Backend: BackendComposite, Mutates: true,
			Description: "Run the design pipeline from a spec: schematic → ERC → PCB → verification → manufacturing outputs.",
			Inputs:      []string{"spec", "project", "stages optional", "dryRun optional", "timeoutMs optional"},
			Outputs:     []string{"stages", "status", "artifacts"},
		},
		{
			Name: "pipeline.status", Domain: DomainPipeline, Backend: BackendComposite,
			Description: "Return the last pipeline stage report.",
			Inputs:      []string{"project"},
			Outputs:     []string{"stages", "status"},
		},
	}
}

var (
	byNameOnce  sync.Once
	byNameCache map[string]ActionSpec
)

// ByName indexes the catalog.
func ByName() map[string]ActionSpec {
	byNameOnce.Do(func() {
		all := All()
		byNameCache = make(map[string]ActionSpec, len(all))
		for _, a := range all {
			byNameCache[a.Name] = a
		}
	})
	return byNameCache
}
