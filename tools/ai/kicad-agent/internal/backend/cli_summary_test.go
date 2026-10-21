// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package backend

import (
	"strings"
	"testing"
)

func TestRuleReportSummary(t *testing.T) {
	report := map[string]any{
		"violations": []any{
			map[string]any{"type": "shorting_items", "severity": "error",
				"description": strings.Repeat("x", 400),
				"items": []any{map[string]any{"uuid": "abc", "description": "Track [+5V]",
					"pos": map[string]any{"x": 12.5, "y": 34.5}}}},
			map[string]any{"type": "clearance", "severity": "error"},
			map[string]any{"type": "text_height", "severity": "warning"},
		},
		"unconnected_items": []any{
			map[string]any{"type": "unconnected_items", "severity": "error"},
		},
		"schematic_parity": []any{},
		"ignored_checks":   []any{map[string]any{"key": "missing_courtyard"}},
	}

	summary := ruleReportSummary(report, "/tmp/drc.json")
	if summary["reportPath"] != "/tmp/drc.json" {
		t.Fatalf("reportPath = %v", summary["reportPath"])
	}
	if summary["total"] != 4 {
		t.Fatalf("total = %v, want 4", summary["total"])
	}
	if summary["violations"] != 3 || summary["unconnected_items"] != 1 {
		t.Fatalf("group counts = %v / %v", summary["violations"], summary["unconnected_items"])
	}
	byType := summary["byType"].(map[string]int)
	if byType["clearance"] != 1 || byType["text_height"] != 1 {
		t.Fatalf("byType = %v", byType)
	}
	bySeverity := summary["bySeverity"].(map[string]int)
	if bySeverity["error"] != 3 || bySeverity["warning"] != 1 {
		t.Fatalf("bySeverity = %v", bySeverity)
	}

	sample := sampleRuleViolations(report, 2)
	if len(sample) != 2 {
		t.Fatalf("sample length = %d, want 2", len(sample))
	}
	first := sample[0].(map[string]any)
	if first["type"] != "shorting_items" || first["group"] != "violations" {
		t.Fatalf("sample = %v", first)
	}
	// The second sample must be a different type, not another clearance item.
	if second := sample[1].(map[string]any); second["type"] != "clearance" {
		t.Fatalf("sample is not type-diverse: %v", second)
	}
	all := sampleRuleViolations(report, 4)
	if len(all) != 4 {
		t.Fatalf("full sample length = %d, want 4", len(all))
	}
	if desc := first["description"].(string); len([]rune(desc)) > 303 {
		t.Fatalf("description was not shortened: %d runes", len([]rune(desc)))
	}
	item := first["items"].([]any)[0].(map[string]any)
	if item["uuid"] != "abc" || item["x"] != 12.5 || item["y"] != 34.5 {
		t.Fatalf("compact item = %v", item)
	}
}

func TestNormalizeIPCError(t *testing.T) {
	bbox := normalizeIPCError("board.bbox.get", &Error{
		Code:    "UNHANDLED",
		Message: "no handler available for request of type kiapi.common.commands.GetBoundingBox",
	}).(*Error)
	if bbox.Code != "BOARD_NOT_OPEN" {
		t.Fatalf("bbox code = %s", bbox.Code)
	}
	if !strings.Contains(bbox.Detail, "board.export.stats") {
		t.Fatalf("bbox detail = %s", bbox.Detail)
	}

	docs := normalizeIPCError("project.info", &Error{
		Code:    "UNHANDLED",
		Message: "no handler available for request of type kiapi.common.commands.GetOpenDocuments",
	}).(*Error)
	if docs.Code != "DOCUMENTS_UNAVAILABLE" {
		t.Fatalf("documents code = %s", docs.Code)
	}
	if !strings.Contains(docs.Detail, "project.list") {
		t.Fatalf("documents detail = %s", docs.Detail)
	}

	other := &Error{Code: "IPC_UNAVAILABLE", Message: "socket missing"}
	if got := normalizeIPCError("board.items.get", other); got != other {
		t.Fatal("non-UNHANDLED errors must pass through unchanged")
	}
}
