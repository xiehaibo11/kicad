// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package pipeline

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// WorkflowState tracks tasks, not engineering approval. release.check owns
// revision-bound evidence completeness; accountable people own final release.
// WorkflowState is the KiCad-native design gate record.  It deliberately does
// not reuse the upstream EasyEDA workflow state: that state is keyed to EasyEDA
// document UUIDs, PLANE-layer artifacts, and `eda.*` action semantics.
type WorkflowState struct {
	Project             string            `json:"project"`
	Stages              map[string]string `json:"stages"`
	Confirmed           map[string]bool   `json:"confirmed"`
	UpdatedAt           string            `json:"updatedAt"`
	Scope               string            `json:"scope"`
	ReadyForFabrication bool              `json:"readyForFabrication"`
	ReadyForProduction  bool              `json:"readyForProduction"`
}

var WorkflowStages = []string{
	"spec", "schematic", "netlist", "board", "place", "planes",
	"fanout", "route", "dfm", "drc", "connectivity", "manufacturing", "verified",
}

func statePath(project string) string {
	return filepath.Join(project, ".kicad-agent", "workflow.json")
}

func newWorkflow(project string) *WorkflowState {
	stages := make(map[string]string, len(WorkflowStages))
	for _, s := range WorkflowStages {
		stages[s] = "pending"
	}
	return &WorkflowState{Project: project, Stages: stages, Confirmed: map[string]bool{}}
}

func normalizeWorkflow(st *WorkflowState, project string) {
	st.Scope = "Task tracking only. Confirmations are operator notes, not authenticated approvals. Use release.check for current evidence; final release requires accountable engineering/quality/manufacturer review."
	st.ReadyForFabrication = false
	st.ReadyForProduction = false
	// Legacy verified flags had no evidence binding and cannot be trusted.
	if st.Stages != nil {
		st.Stages["verified"] = "pending"
	}
	if st.Project == "" {
		st.Project = project
	}
	if st.Stages == nil {
		st.Stages = map[string]string{}
	}
	for _, s := range WorkflowStages {
		if _, ok := st.Stages[s]; !ok {
			st.Stages[s] = "pending"
		}
	}
	if st.Confirmed == nil {
		st.Confirmed = map[string]bool{}
	}
}

func loadWorkflow(project string) (*WorkflowState, error) {
	raw, err := os.ReadFile(statePath(project))
	if err != nil {
		if os.IsNotExist(err) {
			return newWorkflow(project), nil
		}
		return nil, err
	}
	var st WorkflowState
	if err := json.Unmarshal(raw, &st); err != nil {
		return nil, err
	}
	normalizeWorkflow(&st, project)
	return &st, nil
}

func saveWorkflow(st *WorkflowState) error {
	st.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	path := statePath(st.Project)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(raw, '\n'), 0o644)
}

func nextPending(st *WorkflowState) string {
	for _, s := range WorkflowStages {
		if st.Stages[s] != "ok" {
			return s
		}
	}
	return ""
}

func stageIndex(name string) int {
	for i, s := range WorkflowStages {
		if s == name {
			return i
		}
	}
	return -1
}

// WorkflowCall handles workflow.* actions.
func WorkflowCall(action string, p map[string]any) (*backend.Result, error) {
	project := argString(p, "project")
	if project == "" {
		var err error
		project, err = os.Getwd()
		if err != nil {
			return nil, err
		}
	}
	project, _ = filepath.Abs(project)

	st, err := loadWorkflow(project)
	if err != nil {
		return nil, &backend.Error{Code: "WORKFLOW_LOAD_FAILED", Message: err.Error()}
	}

	switch action {
	case "workflow.init":
		if _, err := os.Stat(statePath(project)); os.IsNotExist(err) {
			st = newWorkflow(project)
		}

	case "workflow.status":
		// read-only

	case "workflow.advance":
		stage := argString(p, "stage")
		if stage == "" {
			stage = nextPending(st)
		}
		if stage == "" {
			return nil, &backend.Error{Code: "WORKFLOW_COMPLETE",
				Message: "no pending stage remains"}
		}
		idx := stageIndex(stage)
		if idx < 0 {
			return nil, &backend.Error{Code: "BAD_STAGE",
				Message: fmt.Sprintf("unknown stage %q", stage)}
		}
		if stage == "verified" {
			return nil, &backend.Error{Code: "EVIDENCE_GATE_REQUIRED", Message: "workflow flags cannot confer engineering approval. Use release.template/snapshot/check; final release requires accountable external review."}
		}
		for _, prev := range WorkflowStages[:idx] {
			if st.Stages[prev] != "ok" {
				return nil, &backend.Error{Code: "GATE_BLOCKED",
					Message: fmt.Sprintf("stage %q is not complete; pending/failed stages cannot be skipped", prev)}
			}
		}
		st.Stages[stage] = "ok"

	case "workflow.confirm":
		confirmation := argString(p, "confirmation")
		if confirmation == "" {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "confirmation is required"}
		}
		st.Confirmed[confirmation] = true

	case "workflow.reset":
		if argBool(p, "resetAll") {
			st = newWorkflow(project)
		} else {
			from := argString(p, "resetFrom")
			idx := stageIndex(from)
			if idx < 0 {
				return nil, &backend.Error{Code: "BAD_INPUT",
					Message: "resetFrom must be a known stage"}
			}
			for _, s := range WorkflowStages[idx:] {
				st.Stages[s] = "pending"
			}
		}
	}

	normalizeWorkflow(st, project)
	if action != "workflow.status" {
		if err := saveWorkflow(st); err != nil {
			return nil, &backend.Error{Code: "WORKFLOW_SAVE_FAILED", Message: err.Error()}
		}
	}

	return &backend.Result{Action: action, OK: true, Data: st}, nil
}

// ---- payload helpers -------------------------------------------------------

func argString(p map[string]any, key string) string {
	if v, ok := p[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func argBool(p map[string]any, key string) bool {
	if v, ok := p[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

func argInt(p map[string]any, key string) int {
	if v, ok := p[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case int64:
			return int(n)
		}
	}
	return 0
}

func argStrings(p map[string]any, key string) []string {
	raw, ok := p[key]
	if !ok {
		return nil
	}
	switch v := raw.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	case string:
		if v == "" {
			return nil
		}
		return []string{v}
	}
	return nil
}
