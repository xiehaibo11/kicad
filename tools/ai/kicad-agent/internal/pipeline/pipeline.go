// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package pipeline orchestrates the KiCad design flow.
//
// Stages are explicit.  A stage that depends on an engine KiCad does not yet
// expose is reported as "unimplemented" with remediation instead of being
// silently skipped: an agent must be able to tell "done" from "not attempted".
package pipeline

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	upstreamspec "github.com/zhoushoujianwork/easyeda-agent/internal/spec"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type Dispatcher func(context.Context, string, map[string]any) (*backend.Result, error)

type StageReport struct {
	Name      string   `json:"name"`
	Status    string   `json:"status"` // ok | failed | skipped | unimplemented
	Action    string   `json:"action,omitempty"`
	Message   string   `json:"message,omitempty"`
	Artifacts []string `json:"artifacts,omitempty"`
	ElapsedMs int64    `json:"elapsedMs,omitempty"`
	Data      any      `json:"data,omitempty"`
}

type Report struct {
	Spec       string        `json:"spec"`
	Project    string        `json:"project"`
	StartedAt  string        `json:"startedAt"`
	FinishedAt string        `json:"finishedAt"`
	OK         bool          `json:"ok"`
	Complete   bool          `json:"complete"`
	Stages     []StageReport `json:"stages"`
	Artifacts  []string      `json:"artifacts"`
}

type Options struct {
	SpecPath        string
	ProjectDir      string
	Stages          []string
	DryRun          bool
	Timeout         time.Duration
	FanoutReference string
}

var allStages = []string{
	"spec", "health", "schematic", "netlist", "board", "place", "planes",
	"fanout", "route", "save", "drc", "connectivity", "manufacturing", "verify",
}

func Run(ctx context.Context, opts Options, dispatch Dispatcher) (*Report, error) {
	project := opts.ProjectDir
	if project == "" {
		var err error
		project, err = os.Getwd()
		if err != nil {
			return nil, err
		}
	}
	project, _ = filepath.Abs(project)

	artifactsDir := filepath.Join(project, "artifacts")
	if err := os.MkdirAll(artifactsDir, 0o755); err != nil {
		return nil, err
	}
	manufacturingDir := filepath.Join(artifactsDir, "manufacturing")
	_ = os.MkdirAll(manufacturingDir, 0o755)

	report := &Report{
		Spec:      opts.SpecPath,
		Project:   project,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}

	wanted := map[string]bool{}
	for _, s := range opts.Stages {
		wanted[s] = true
	}

	sch := findFile(project, ".kicad_sch")
	boardFile := findFile(project, ".kicad_pcb")
	netlistPath := filepath.Join(artifactsDir, "netlist.net")

	docBoard := map[string]any{"type": "pcb", "path": boardFile}

	stage := func(name, action string, payload map[string]any) StageReport {
		sr := StageReport{Name: name, Action: action}
		start := time.Now()

		res, err := dispatch(ctx, action, payload)
		sr.ElapsedMs = time.Since(start).Milliseconds()

		if err != nil {
			sr.Status = "failed"
			sr.Message = err.Error()
			return sr
		}
		if res == nil {
			sr.Status = "failed"
			sr.Message = "empty action result"
			return sr
		}

		sr.Data = res.Data
		sr.Artifacts = res.Artifacts

		if !res.OK {
			sr.Status = "failed"
			if res.Error != nil {
				sr.Message = res.Error.Code + ": " + res.Error.Message
			}
			return sr
		}

		if m, ok := res.Data.(map[string]any); ok {
			if s, _ := m["status"].(string); s == "violations" {
				sr.Status = "failed"
				sr.Message = action + " reported violations"
				return sr
			}
		}

		sr.Status = "ok"
		return sr
	}

	unimplemented := func(name, message string) StageReport {
		return StageReport{Name: name, Status: "unimplemented", Message: message}
	}

	skipped := func(name, message string) StageReport {
		return StageReport{Name: name, Status: "skipped", Message: message}
	}

	add := func(sr StageReport) {
		if len(wanted) > 0 && !wanted[sr.Name] {
			return
		}
		report.Stages = append(report.Stages, sr)
	}

	// 1. Spec
	if opts.SpecPath != "" {
		add(stage("spec", "spec.validate", map[string]any{"input": opts.SpecPath}))
	} else {
		add(skipped("spec", "no --spec supplied"))
	}

	// 2. Tool/session health
	add(stage("health", "system.health", map[string]any{}))

	// 3. Schematic
	schematicReady := sch != ""
	if schematicReady {
		add(stage("schematic", "schematic.erc.run", map[string]any{
			"input":     sch,
			"output":    filepath.Join(artifactsDir, "erc.json"),
			"format":    "json",
			"timeoutMs": 300000,
		}))
	} else {
		add(unimplemented("schematic",
			"no .kicad_sch found and automatic schematic generation is not yet exposed by "+
				"the KiCad API (library search + place-from-library + annotation are pending)"))
	}

	// 4. Netlist
	if schematicReady {
		add(stage("netlist", "schematic.export.netlist", map[string]any{
			"input":  sch,
			"output": netlistPath,
			"format": "kicadsexpr",
		}))
	} else {
		add(skipped("netlist", "schematic unavailable"))
	}

	// 5. Board / netlist import
	boardReady := boardFile != ""
	if boardReady && fileExists(netlistPath) {
		add(stage("board", "board.netlist.import", map[string]any{
			"document":         docBoard,
			"netlistPath":      netlistPath,
			"dryRun":           opts.DryRun,
			"updateFootprints": true,
		}))
	} else if boardReady {
		add(skipped("board", "netlist not produced"))
	} else {
		add(unimplemented("board", "no .kicad_pcb found in the project"))
	}

	// 6. Placement
	if boardReady {
		add(stage("place", "board.place.autoplace", map[string]any{
			"document":      docBoard,
			"dryRun":        opts.DryRun,
			"placeOffboard": false,
		}))
	} else {
		add(skipped("place", "board unavailable"))
	}

	// 7. Planes
	if boardReady {
		planes := specPlanes(opts.SpecPath)

		if len(planes) == 0 {
			add(skipped("planes", "spec has no stackup.innerLayers"))
		} else {
			start := time.Now()
			var failures []string
			var artifacts []string

			for _, plane := range planes {
				res, err := dispatch(ctx, "board.plane.create", map[string]any{
					"document": docBoard,
					"net":      plane.Net,
					"layers":   []string{plane.Layer},
					"name":     "PLANE_" + plane.Net,
					"fill":     true,
				})
				if err != nil {
					failures = append(failures, plane.Net+": "+err.Error())
					continue
				}
				if res == nil || !res.OK {
					msg := "failed"
					if res != nil && res.Error != nil {
						msg = res.Error.Code + ": " + res.Error.Message
					}
					failures = append(failures, plane.Net+": "+msg)
					continue
				}
				artifacts = append(artifacts, res.Artifacts...)
			}

			status := "ok"
			if len(failures) > 0 {
				status = "failed"
			}
			add(StageReport{
				Name: "planes", Action: "board.plane.create", Status: status,
				Message: strings.Join(failures, "; "), Artifacts: artifacts,
				ElapsedMs: time.Since(start).Milliseconds(),
			})
		}
	} else {
		add(skipped("planes", "board unavailable"))
	}

	// 8. Fanout
	if boardReady && opts.FanoutReference != "" {
		add(stage("fanout", "board.fanout.run", map[string]any{
			"document":  docBoard,
			"reference": opts.FanoutReference,
			"dryRun":    opts.DryRun,
		}))
	} else if boardReady {
		add(skipped("fanout", "no --fanout-reference supplied"))
	} else {
		add(skipped("fanout", "board unavailable"))
	}

	// 9. Routing (deterministic L-router baseline; DRC validates the result)
	if boardReady {
		add(stage("route", "board.route.autoroute", map[string]any{
			"document": docBoard,
			"dryRun":   opts.DryRun,
		}))
	} else {
		add(skipped("route", "board unavailable"))
	}

	// 9.5 Persist API edits before CLI jobs (DRC, manufacturing) read the file.
	if boardReady {
		add(stage("save", "document.save", map[string]any{"document": docBoard}))
	} else {
		add(skipped("save", "board unavailable"))
	}

	// 10. DRC
	if boardReady {
		add(stage("drc", "board.drc.run", map[string]any{
			"input":       boardFile,
			"output":      filepath.Join(artifactsDir, "drc.json"),
			"format":      "json",
			"timeoutMs":   600000,
			"refillZones": true,
		}))
	} else {
		add(skipped("drc", "board unavailable"))
	}

	// 11. Connectivity proof
	if boardReady {
		add(stage("connectivity", "board.connectivity.prove", map[string]any{
			"document":           docBoard,
			"requireFilledZones": true,
		}))
	} else {
		add(skipped("connectivity", "board unavailable"))
	}

	// 12. Manufacturing outputs
	if boardReady {
		add(manufacturingStage(ctx, dispatch, boardFile, manufacturingDir))
	} else {
		add(skipped("manufacturing", "board unavailable"))
	}

	// 13. Verification summary
	report.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	report.OK = true
	report.Complete = true
	for _, s := range report.Stages {
		switch s.Status {
		case "failed":
			report.OK = false
			report.Complete = false
		case "unimplemented":
			report.Complete = false
		}
		for _, a := range s.Artifacts {
			report.Artifacts = append(report.Artifacts, a)
		}
	}
	add(StageReport{
		Name:    "verify",
		Status:  map[bool]string{true: "ok", false: "failed"}[report.OK],
		Message: fmt.Sprintf("ok=%v complete=%v stages=%d", report.OK, report.Complete, len(report.Stages)),
		Data:    map[string]any{"ok": report.OK, "complete": report.Complete},
	})

	// Persist the report.
	reportPath := filepath.Join(project, ".kicad-agent", "pipeline-report.json")
	_ = os.MkdirAll(filepath.Dir(reportPath), 0o755)
	if raw, err := json.MarshalIndent(report, "", "  "); err == nil {
		_ = os.WriteFile(reportPath, append(raw, '\n'), 0o644)
	}

	return report, nil
}

func manufacturingStage(ctx context.Context, dispatch Dispatcher, boardFile, dir string) StageReport {
	sr := StageReport{Name: "manufacturing", Action: "board.export.*"}
	start := time.Now()

	steps := []struct {
		action  string
		payload map[string]any
	}{
		{"board.export.gerbers", map[string]any{"input": boardFile, "outputDir": filepath.Join(dir, "gerbers")}},
		{"board.export.drill", map[string]any{"input": boardFile, "outputDir": filepath.Join(dir, "drill")}},
		{"board.export.position", map[string]any{
			"input": boardFile, "output": filepath.Join(dir, "position.csv"),
			"side": "both", "format": "csv", "units": "mm",
		}},
		{"board.export.step", map[string]any{
			"input": boardFile, "output": filepath.Join(dir, "board.step"), "format": "step",
		}},
	}

	var failures []string
	for _, step := range steps {
		res, err := dispatch(ctx, step.action, step.payload)
		if err != nil {
			failures = append(failures, step.action+": "+err.Error())
			continue
		}
		if res == nil || !res.OK {
			msg := "failed"
			if res != nil && res.Error != nil {
				msg = res.Error.Code + ": " + res.Error.Message
			}
			failures = append(failures, step.action+": "+msg)
			continue
		}
		sr.Artifacts = append(sr.Artifacts, res.Artifacts...)
	}

	sr.ElapsedMs = time.Since(start).Milliseconds()
	if len(failures) > 0 {
		sr.Status = "failed"
		sr.Message = strings.Join(failures, "; ")
	} else {
		sr.Status = "ok"
	}
	return sr
}

func findFile(dir, suffix string) string {
	var found string
	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == "artifacts" || name == ".git" || name == ".kicad-agent" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(strings.ToLower(d.Name()), suffix) && found == "" {
			found = path
		}
		return nil
	})
	return found
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

type planeSpec struct {
	Net   string
	Layer string
}

// specPlanes maps stackup.innerLayers (an ordered list of net names) to
// In1.Cu, In2.Cu, ... layers.
func specPlanes(specPath string) []planeSpec {
	if specPath == "" {
		return nil
	}

	raw, err := os.ReadFile(specPath)
	if err != nil {
		return nil
	}

	s, err := upstreamspec.Parse(raw)
	if err != nil || s.Stackup == nil {
		return nil
	}

	inners := s.Stackup.Inners()
	out := make([]planeSpec, 0, len(inners))

	for i, net := range inners {
		if net == "" {
			continue
		}
		out = append(out, planeSpec{Net: net, Layer: fmt.Sprintf("In%d.Cu", i+1)})
	}

	return out
}

// RunAction handles pipeline.run and pipeline.status.
func RunAction(ctx context.Context, action string, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	switch action {
	case "pipeline.run":
		opts := Options{
			SpecPath:        argString(p, "spec"),
			ProjectDir:      argString(p, "project"),
			Stages:          argStrings(p, "stages"),
			DryRun:          argBool(p, "dryRun"),
			Timeout:         time.Duration(argInt(p, "timeoutMs")) * time.Millisecond,
			FanoutReference: argString(p, "fanoutReference"),
		}
		report, err := Run(ctx, opts, dispatch)
		if err != nil {
			return nil, err
		}
		res := &backend.Result{Action: action, OK: report.OK, Data: report,
			Artifacts: report.Artifacts}
		if !report.OK {
			res.Error = &backend.Error{Code: "PIPELINE_FAILED",
				Message: "one or more pipeline stages failed"}
		}
		return res, nil

	case "pipeline.status":
		project := argString(p, "project")
		if project == "" {
			project, _ = os.Getwd()
		}
		path := filepath.Join(project, ".kicad-agent", "pipeline-report.json")
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil, &backend.Error{Code: "NO_PIPELINE_REPORT",
				Message: "no pipeline report found", Detail: path}
		}
		var report Report
		if err := json.Unmarshal(raw, &report); err != nil {
			return nil, err
		}
		return &backend.Result{Action: action, OK: true, Data: report}, nil
	}

	return nil, &backend.Error{Code: "UNKNOWN_ACTION", Message: action}
}
