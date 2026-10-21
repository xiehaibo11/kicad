// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package pipeline

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWorkflowLifecycle(t *testing.T) {
	dir := t.TempDir()

	res, err := WorkflowCall("workflow.init", map[string]any{"project": dir})
	if err != nil {
		t.Fatalf("init: %v", err)
	}
	st, ok := res.Data.(*WorkflowState)
	if !ok {
		t.Fatalf("unexpected data type %T", res.Data)
	}
	if st.Stages["spec"] != "pending" {
		t.Fatalf("expected spec pending, got %q", st.Stages["spec"])
	}

	if _, err := WorkflowCall("workflow.advance", map[string]any{
		"project": dir, "stage": "spec",
	}); err != nil {
		t.Fatalf("advance: %v", err)
	}

	res, err = WorkflowCall("workflow.status", map[string]any{"project": dir})
	if err != nil {
		t.Fatalf("status: %v", err)
	}
	st = res.Data.(*WorkflowState)
	if st.Stages["spec"] != "ok" {
		t.Fatalf("expected spec ok, got %q", st.Stages["spec"])
	}

	if _, err := WorkflowCall("workflow.confirm", map[string]any{
		"project": dir, "confirmation": "layout",
	}); err != nil {
		t.Fatalf("confirm: %v", err)
	}

	res, _ = WorkflowCall("workflow.status", map[string]any{"project": dir})
	st = res.Data.(*WorkflowState)
	if !st.Confirmed["layout"] {
		t.Fatal("layout confirmation not recorded")
	}

	if _, err := WorkflowCall("workflow.reset", map[string]any{
		"project": dir, "resetAll": true,
	}); err != nil {
		t.Fatalf("reset: %v", err)
	}
	res, _ = WorkflowCall("workflow.status", map[string]any{"project": dir})
	st = res.Data.(*WorkflowState)
	if st.Stages["spec"] != "pending" {
		t.Fatalf("reset failed: %q", st.Stages["spec"])
	}

	if _, err := os.Stat(filepath.Join(dir, ".kicad-agent", "workflow.json")); err != nil {
		t.Fatalf("workflow state was not persisted: %v", err)
	}
}

func TestWorkflowRejectsUnknownStage(t *testing.T) {
	dir := t.TempDir()
	if _, err := WorkflowCall("workflow.advance", map[string]any{
		"project": dir, "stage": "not-a-stage",
	}); err == nil {
		t.Fatal("expected an error for an unknown stage")
	}
}

func TestWorkflowCannotSkipPendingOrForgeVerified(t *testing.T) {
	dir := t.TempDir()
	for _, stage := range []string{"schematic", "manufacturing", "verified"} {
		if _, err := WorkflowCall("workflow.advance", map[string]any{"project": dir, "stage": stage, "readyForProduction": true, "evidence": true}); err == nil {
			t.Fatalf("forged %s", stage)
		}
	}
	st := newWorkflow(dir)
	for _, stage := range WorkflowStages {
		st.Stages[stage] = "ok"
	}
	if err := saveWorkflow(st); err != nil {
		t.Fatal(err)
	}
	result, err := WorkflowCall("workflow.status", map[string]any{"project": dir})
	if err != nil {
		t.Fatal(err)
	}
	got := result.Data.(*WorkflowState)
	if got.Stages["verified"] == "ok" || got.ReadyForFabrication || got.ReadyForProduction {
		t.Fatal("legacy flag treated as engineering approval")
	}
	if _, err := WorkflowCall("workflow.advance", map[string]any{"project": dir, "stage": "verified", "confirmation": true}); err == nil {
		t.Fatal("verified bypassed")
	}
}
