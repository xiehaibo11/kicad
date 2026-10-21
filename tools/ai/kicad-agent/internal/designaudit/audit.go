// SPDX-License-Identifier: GPL-3.0-or-later
// The backend is the sole owner of engineering audit policy and execution.
package designaudit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type Dispatcher func(context.Context, string, map[string]any) (*backend.Result, error)
type Check struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Detail any    `json:"detail,omitempty"`
}
type Report struct {
	PolicyVersion      string            `json:"policyVersion"`
	CreatedAt          string            `json:"createdAt"`
	Board              string            `json:"board"`
	Inputs             map[string]string `json:"inputSha256"`
	Checks             []Check           `json:"checks"`
	Pending            []string          `json:"pendingEvidence"`
	NativeChecksPassed bool              `json:"nativeChecksPassed"`
	Ready              bool              `json:"readyForFabrication"`
	Note               string            `json:"note"`
}

func Rules() map[string]any {
	return map[string]any{
		"version": "2026-10-20.2", "execution": "backend-only; frontend displays results, never evaluates engineering rules",
		"nativeScope":               []string{"all enabled native DRC providers", "all track errors", "all severities including exclusions", "zone refill in memory without saving", "board/schematic parity", "schematic ERC", "disabled-check inventory", "project rule and custom .kicad_dru provenance"},
		"pcbCategories":             []string{"shorts and connectivity", "clearance and creepage", "track widths", "via/drill/annulus and hole spacing", "copper/board edges and outlines", "solder mask and paste", "silkscreen", "zones and thermal connections", "courtyard and footprint geometry", "library and schematic parity", "length/differential-pair constraints from the project"},
		"footprintCategories":       []string{"pad geometry and drill/copper-layer consistency", "courtyard/fabrication/reference definitions", "datasheet pin mapping and exposed-pad identity", "package dimensions and assembly orientation", "3D/mechanical fit"},
		"evidenceRequiredBeyondDrc": []string{"manufacturer process limits and stackup", "datasheet-based footprint/pin/electrical review", "mechanical/assembly fit", "design-specific power, thermal, high-speed and safety constraints where applicable"},
		"manufacturingProfile":      map[string]any{"format": "JSON object", "requiredPositiveMm": []string{"minClearanceMm", "minTrackWidthMm", "minDrillMm", "minAnnularWidthMm", "minCopperEdgeClearanceMm"}, "source": "manufacturer process specification; never invented defaults", "comparison": "project global minima must meet the profile; custom-rule overrides require review too"},
		"sources":                   []string{"https://docs.kicad.org/master/en/cli/cli.html#pcb_drc", "https://docs.kicad.org/master/en/cli/cli.html#schematic_erc", "https://klc.kicad.org/footprint/"},
		"policy":                    "Never equate zero DRC with fabrication readiness. Missing reports, ignored checks, unknown limits and unverified datasheet/mechanical assumptions remain explicit blockers. Never relax or disable project rules automatically.",
	}
}

func str(p map[string]any, key string) string { value, _ := p[key].(string); return value }
func fingerprint(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:]), nil
}
func inputFile(path, extension string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || strings.ToLower(filepath.Ext(absolute)) != extension {
		return "", fmt.Errorf("expected a regular %s file", extension)
	}
	return absolute, nil
}

func nativeCheck(name string, res *backend.Result, err error) Check {
	if err != nil {
		return Check{name, "blocked", err.Error()}
	}
	if res == nil {
		return Check{name, "blocked", "missing native result"}
	}
	data, ok := res.Data.(map[string]any)
	if !ok || !res.OK {
		return Check{name, "blocked", res}
	}
	report, ok := data["reportJson"].(map[string]any)
	if !ok {
		return Check{name, "blocked", "native JSON report missing or unreadable"}
	}
	// A status string cannot turn a missing/malformed finding list into proof.
	required := []string{"violations"}
	if name == "native-drc" {
		required = append(required, "unconnected_items", "schematic_parity")
	}
	for _, key := range required {
		if _, ok := report[key].([]any); !ok {
			return Check{name, "blocked", "native finding array missing or malformed: " + key}
		}
	}
	if name == "native-drc" || name == "native-erc" {
		if _, ok := report["ignored_checks"].([]any); !ok {
			return Check{name, "blocked", "disabled-check inventory missing or malformed"}
		}
		severities, ok := report["included_severities"].([]any)
		if !ok {
			return Check{name, "blocked", "reported severity scope missing"}
		}
		seen := map[string]bool{}
		for _, s := range severities {
			if v, ok := s.(string); ok {
				seen[v] = true
			}
		}
		for _, s := range []string{"error", "warning", "exclusion"} {
			if !seen[s] {
				return Check{name, "blocked", "full native severity scope missing: " + s}
			}
		}
	}
	violations := 0
	for _, key := range []string{"violations", "unconnected_items", "schematic_parity"} {
		if items, ok := report[key].([]any); ok {
			violations += len(items)
		}
	}
	ignored, _ := report["ignored_checks"].([]any)
	detail := map[string]any{"violations": violations, "ignoredChecks": ignored, "report": data["report"], "nativeReport": report}
	if violations > 0 || data["status"] == "violations" {
		return Check{name, "fail", detail}
	}
	if data["status"] != "clean" {
		return Check{name, "blocked", detail}
	}
	if len(ignored) > 0 {
		return Check{name, "blocked", detail}
	}
	return Check{name, "pass", detail}
}

// Run audits saved files. It does not save/refill the source board or change a
// rule severity. Native reports and hashes are retained for independent review.
func Run(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	board, err := inputFile(str(p, "board"), ".kicad_pcb")
	if err != nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "board: " + err.Error()}
	}
	stem := strings.TrimSuffix(board, filepath.Ext(board))
	report := Report{PolicyVersion: "2026-10-20.2", CreatedAt: time.Now().UTC().Format(time.RFC3339), Board: board, Inputs: map[string]string{}, Checks: []Check{}, Pending: []string{}, Note: "Native checks audit the saved snapshot using the project rules. Complete fabrication approval additionally requires datasheet, manufacturing, mechanical and application-specific engineering evidence. No source design is changed."}
	report.Inputs[board], err = fingerprint(board)
	if err != nil {
		return nil, err
	}
	project := stem + ".kicad_pro"
	custom := stem + ".kicad_dru"
	var projectRules map[string]any
	for _, path := range []string{project, custom} {
		if hash, e := fingerprint(path); e == nil {
			report.Inputs[path] = hash
		}
	}
	if raw, e := os.ReadFile(project); e == nil {
		var cfg map[string]any
		if json.Unmarshal(raw, &cfg) == nil {
			if bs, ok := cfg["board"].(map[string]any); ok {
				if ds, ok := bs["design_settings"].(map[string]any); ok {
					projectRules, _ = ds["rules"].(map[string]any)
				}
			}
		}
	}
	if len(projectRules) == 0 {
		report.Checks = append(report.Checks, Check{"project-rules", "blocked", "project design constraints are missing or unreadable"})
	} else {
		report.Checks = append(report.Checks, Check{"project-rules", "pass", projectRules})
	}
	schematic := str(p, "schematic")
	if schematic == "" {
		if _, e := os.Stat(stem + ".kicad_sch"); e == nil {
			schematic = stem + ".kicad_sch"
		}
	}
	if schematic != "" {
		schematic, err = inputFile(schematic, ".kicad_sch")
		if err != nil {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "schematic: " + err.Error()}
		}
		report.Inputs[schematic], err = fingerprint(schematic)
		if err != nil {
			return nil, err
		}
	}
	dir, err := os.MkdirTemp("", "kicad-design-audit-*")
	if err != nil {
		return nil, err
	}
	params := map[string]any{"input": board, "output": filepath.Join(dir, "drc.json"), "format": "json", "allTrackErrors": true, "severityAll": true, "refillZones": true, "schematicParity": schematic != "", "full": true}
	drc, e := dispatch(ctx, "board.drc.run", params)
	report.Checks = append(report.Checks, nativeCheck("native-drc", drc, e))
	artifacts := []string{}
	if drc != nil {
		artifacts = append(artifacts, drc.Artifacts...)
	}
	if schematic != "" {
		erc, e := dispatch(ctx, "schematic.erc.run", map[string]any{"input": schematic, "output": filepath.Join(dir, "erc.json"), "format": "json", "severityAll": true, "full": true})
		report.Checks = append(report.Checks, nativeCheck("native-erc", erc, e))
		if erc != nil {
			artifacts = append(artifacts, erc.Artifacts...)
		}
		// Native parity discovers the board's corresponding schematic, rather
		// than accepting an arbitrary differently named input.
		if schematic != stem+".kicad_sch" {
			report.Checks = append(report.Checks, Check{"schematic-parity", "blocked", "explicit schematic is not the board's sibling; native parity cannot establish this mapping"})
		}
	} else {
		report.Checks = append(report.Checks, Check{"native-erc-and-parity", "blocked", "corresponding schematic is missing"})
	}
	profile := str(p, "manufacturingProfile")
	if profile == "" {
		candidate := filepath.Join(filepath.Dir(board), "manufacturing.json")
		if _, e := os.Stat(candidate); e == nil {
			profile = candidate
		}
	}
	if profile == "" {
		report.Checks = append(report.Checks, Check{"manufacturing-constraints", "blocked", "manufacturer limits and stackup have not been supplied"})
	} else {
		absolute, e := filepath.Abs(profile)
		if e != nil {
			return nil, e
		}
		raw, e := os.ReadFile(absolute)
		if e != nil {
			return nil, e
		}
		var limits map[string]any
		if e = json.Unmarshal(raw, &limits); e != nil {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "invalid manufacturing profile: " + e.Error()}
		}
		report.Inputs[absolute], _ = fingerprint(absolute)
		pairs := map[string]string{"minClearanceMm": "min_clearance", "minTrackWidthMm": "min_track_width", "minDrillMm": "min_through_hole_diameter", "minAnnularWidthMm": "min_via_annular_width", "minCopperEdgeClearanceMm": "min_copper_edge_clearance"}
		details := []Check{}
		status := "pass"
		for input, key := range pairs {
			limit, ok := limits[input].(float64)
			actual, known := projectRules[key].(float64)
			state := "pass"
			if !ok || limit <= 0 || !known {
				state = "blocked"
			} else if actual < limit {
				state = "fail"
			}
			if state != "pass" {
				status = state
			}
			details = append(details, Check{input, state, map[string]any{"manufacturerMinMm": limit, "projectMinMm": actual}})
		}
		report.Checks = append(report.Checks, Check{"manufacturing-constraints", status, details})
		if _, e := os.Stat(custom); e == nil {
			report.Pending = append(report.Pending, "Review custom rule overrides against manufacturer limits; global minima alone cannot prove every custom constraint.")
		}
	}
	for path, before := range report.Inputs {
		after, e := fingerprint(path)
		if e != nil || before != after {
			report.Checks = append(report.Checks, Check{"snapshot-stability", "blocked", "input changed during audit: " + path})
		}
	}
	report.NativeChecksPassed = schematic != ""
	checksPassed := true
	for _, check := range report.Checks {
		if check.Status != "pass" {
			checksPassed = false
			if strings.HasPrefix(check.Name, "native-") || check.Name == "snapshot-stability" || check.Name == "schematic-parity" {
				report.NativeChecksPassed = false
			}
			report.Pending = append(report.Pending, check.Name+": "+check.Status)
		}
	}
	report.Pending = append(report.Pending, "Datasheet-based footprint/pin/electrical review and package identity remain unverified.", "Mechanical/assembly fit and application-specific electrical, thermal, high-speed and safety constraints require separate evidence.")
	report.Ready = len(report.Pending) == 0
	output := str(p, "output")
	if output == "" {
		output = filepath.Join(dir, "audit.json")
	}
	output, err = filepath.Abs(output)
	if err != nil {
		return nil, err
	}
	raw, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return nil, err
	}
	file, err := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	_, err = file.Write(append(raw, '\n'))
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return nil, err
	}
	artifacts = append(artifacts, output)
	result := &backend.Result{Action: "audit.run", OK: checksPassed, Data: report, Artifacts: artifacts}
	if !result.OK {
		result.Error = &backend.Error{Code: "AUDIT_NOT_PASSED", Message: "audit contains violations or checks without complete evidence; see checks and artifacts"}
	}
	return result, nil
}
