// SPDX-License-Identifier: GPL-3.0-or-later
package designaudit

import (
	"context"
	"encoding/json"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNativeAuditNeverConvertsMissingIgnoredOrExcludedEvidenceIntoPass(t *testing.T) {
	cases := []struct {
		name, status string
		report       map[string]any
		want         string
	}{
		{"clean", "clean", map[string]any{"violations": []any{}}, "pass"},
		{"excluded", "clean", map[string]any{"violations": []any{map[string]any{"severity": "exclusion"}}}, "fail"},
		{"ignored", "clean", map[string]any{"ignored_checks": []any{"clearance"}}, "blocked"},
		{"incomplete", "timeout", map[string]any{}, "blocked"},
		{"empty-clean", "clean", map[string]any{}, "blocked"},
		{"malformed-clean", "clean", map[string]any{"violations": "none"}, "blocked"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := nativeCheck("drc", &backend.Result{OK: true, Data: map[string]any{"status": c.status, "reportJson": c.report}}, nil)
			if got.Status != c.want {
				t.Fatalf("got %s want %s", got.Status, c.want)
			}
		})
	}
	if got := nativeCheck("drc", &backend.Result{OK: true, Data: map[string]any{"status": "clean"}}, nil); got.Status != "blocked" {
		t.Fatal("unreadable report passed")
	}
}

func TestReadOnlyAuditUsesFullNativeChecksAndRequiresEngineeringEvidence(t *testing.T) {
	dir := t.TempDir()
	board := filepath.Join(dir, "test.kicad_pcb")
	sch := filepath.Join(dir, "test.kicad_sch")
	for _, p := range []string{board, sch} {
		if err := os.WriteFile(p, []byte("original"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	project := map[string]any{"board": map[string]any{"design_settings": map[string]any{"rules": map[string]any{"min_clearance": 0.2, "min_track_width": 0.2, "min_through_hole_diameter": 0.3, "min_via_annular_width": 0.15, "min_copper_edge_clearance": 0.3}}}}
	raw, _ := json.Marshal(project)
	os.WriteFile(filepath.Join(dir, "test.kicad_pro"), raw, 0600)
	profile := filepath.Join(dir, "manufacturing.json")
	os.WriteFile(profile, []byte(`{"minClearanceMm":0.15,"minTrackWidthMm":0.15,"minDrillMm":0.2,"minAnnularWidthMm":0.1,"minCopperEdgeClearanceMm":0.2}`), 0600)
	calls := []string{}
	result, err := Run(context.Background(), map[string]any{"board": board}, func(ctx context.Context, action string, p map[string]any) (*backend.Result, error) {
		calls = append(calls, action)
		if p["severityAll"] != true || p["format"] != "json" {
			t.Fatal("missing full severity JSON")
		}
		if action == "board.drc.run" && (p["refillZones"] != true || p["schematicParity"] != true || p["allTrackErrors"] != true) {
			t.Fatal("incomplete native DRC")
		}
		if p["saveBoard"] != nil {
			t.Fatal("audit must not save design")
		}
		return &backend.Result{OK: true, Data: map[string]any{"status": "clean", "reportJson": map[string]any{"violations": []any{}, "unconnected_items": []any{}, "schematic_parity": []any{}, "ignored_checks": []any{}, "included_severities": []any{"error", "warning", "exclusion"}}}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	report := result.Data.(Report)
	if !result.OK || !report.NativeChecksPassed || report.Ready || len(report.Pending) == 0 {
		t.Fatalf("incorrect readiness %+v", report)
	}
	if strings.Join(calls, ",") != "board.drc.run,schematic.erc.run" {
		t.Fatal(calls)
	}
	for _, p := range []string{board, sch} {
		raw, _ := os.ReadFile(p)
		if string(raw) != "original" {
			t.Fatal("source changed")
		}
	}
	if len(result.Artifacts) == 0 {
		t.Fatal("no audit artifact")
	}
}

func TestAuditDetectsChangedSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.kicad_pcb")
	os.WriteFile(path, []byte("before"), 0600)
	result, err := Run(context.Background(), map[string]any{"board": path}, func(ctx context.Context, action string, p map[string]any) (*backend.Result, error) {
		os.WriteFile(path, []byte("after"), 0600)
		return &backend.Result{OK: true, Data: map[string]any{"status": "clean", "reportJson": map[string]any{}}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, check := range result.Data.(Report).Checks {
		if check.Name == "snapshot-stability" {
			return
		}
	}
	t.Fatal("changed input not detected")
}

func TestFootprintParserRejectsBrokenPadsAndKeepsDatasheetReviewPending(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.kicad_mod")
	os.WriteFile(path, []byte(`(footprint "QFN test" (layer "F.Cu") (fp_text reference "REF**" (layer "F.SilkS")) (fp_text value "QFN" (layer "F.Fab")) (fp_rect (start 0 0) (end 1 1) (layer "F.CrtYd")) (pad "1" smd rect (size 1 1) (layers "F.Cu" "F.Paste" "F.Mask")))`), 0600)
	res, err := Footprint(map[string]any{"input": path})
	if err != nil || !res.OK {
		t.Fatalf("valid structure: %v %v", res, err)
	}
	if res.Data.(map[string]any)["readyForFabrication"] != false {
		t.Fatal("structural check claimed package proof")
	}
	os.WriteFile(path, []byte(`(footprint "bad" (pad "1" thru_hole circle (size 0 0) (drill -1)))`), 0600)
	res, err = Footprint(map[string]any{"input": path})
	if err != nil || res.OK {
		t.Fatalf("invalid pad: %v %v", res, err)
	}
	for _, input := range []string{`(footprint "unterminated)`, `(footprint "a") trailing`, `(footprint (pad)) )`} {
		if _, err := parse(input); err == nil {
			t.Fatalf("accepted broken expression %s", input)
		}
	}
}

func TestFootprintRejectsNonFiniteSizesAndInvalidOvalDrills(t *testing.T) {
	for _, pad := range []string{
		`(pad "1" smd rect (size NaN 1) (layers "F.Cu"))`,
		`(pad "1" smd rect (size +Inf 1) (layers "F.Cu"))`,
		`(pad "1" thru_hole oval (size 2 2) (drill oval 1 -1) (layers "*.Cu"))`,
		`(pad "1" thru_hole oval (size 2 2) (drill oval 1 3) (layers "*.Cu"))`,
	} {
		path := filepath.Join(t.TempDir(), "bad.kicad_mod")
		os.WriteFile(path, []byte(`(footprint "test" (fp_text reference "REF**" (layer "F.Fab")) (fp_text value "test" (layer "F.Fab")) (fp_rect (layer "F.CrtYd")) `+pad+`)`), 0600)
		result, err := Footprint(map[string]any{"input": path})
		if err != nil || result.OK {
			t.Fatalf("invalid geometry passed: %s %v %v", pad, result, err)
		}
	}
}
