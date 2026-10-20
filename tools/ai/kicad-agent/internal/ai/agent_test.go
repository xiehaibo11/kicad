// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/llm"
)

func TestAgentToolLoop(t *testing.T) {
	calls := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++

		var content string
		if calls == 1 {
			content = `{"action":"system.version","payload":{}}`
		} else {
			content = `{"final":"done"}`
		}

		resp := map[string]any{
			"choices": []any{
				map[string]any{"message": map[string]any{"content": content}},
			},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer server.Close()

	settings := map[string]any{
		"default": "mock",
		"providers": map[string]any{
			"mock": map[string]any{
				"type":    "openai",
				"baseUrl": server.URL + "/v1",
				"model":   "mock",
			},
		},
	}

	raw, _ := json.Marshal(settings)
	path := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	report, err := Run(context.Background(), Options{
		Prompt:       "check the version",
		SettingsPath: path,
		MaxSteps:     5,
	}, func(ctx context.Context, action string, payload map[string]any) (*backend.Result, error) {
		if action != "system.version" {
			return nil, fmt.Errorf("unexpected action %q", action)
		}
		return &backend.Result{OK: true, Action: action,
			Data: map[string]any{"version": "test"}}, nil
	})

	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if !report.OK || report.Final != "done" {
		t.Fatalf("unexpected report: %+v", report)
	}
	if len(report.Steps) != 2 {
		t.Fatalf("expected 2 steps, got %d", len(report.Steps))
	}
	if report.Steps[0].Action != "system.version" {
		t.Fatalf("expected system.version, got %q", report.Steps[0].Action)
	}
	if calls != 2 {
		t.Fatalf("expected 2 model calls, got %d", calls)
	}
}

func TestParseDecisionFences(t *testing.T) {
	dec, err := parseDecision("```json\n{\"final\":\"ok\"}\n```")
	if err != nil {
		t.Fatal(err)
	}
	if dec.Final != "ok" {
		t.Fatalf("unexpected final: %q", dec.Final)
	}

	if _, err := parseDecision("not json"); err == nil {
		t.Fatal("expected an error for non-JSON input")
	}
}

func TestPolicyBlocksMutatingActions(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{
				"message": map[string]any{
					"content": `{"action":"board.items.delete","payload":{"ids":["x"]}}`,
				},
			}},
		})
	}))
	defer server.Close()

	settings := map[string]any{
		"default": "mock",
		"providers": map[string]any{
			"mock": map[string]any{"type": "openai", "baseUrl": server.URL, "model": "mock"},
		},
	}
	raw, _ := json.Marshal(settings)
	path := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}

	dispatched := false
	policy := DefaultPolicy()
	policy.AllowMutating = false
	policy.AllowedActions = map[string]bool{"system.version": true}

	_, err := Run(context.Background(), Options{
		Prompt: "delete everything", SettingsPath: path, MaxSteps: 1, Policy: &policy,
	}, func(ctx context.Context, action string, payload map[string]any) (*backend.Result, error) {
		dispatched = true
		return &backend.Result{OK: true}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if dispatched {
		t.Fatal("mutating action was dispatched despite the read-only policy")
	}
}

func TestTrimMessagesKeepsSystemAndTask(t *testing.T) {
	messages := []llm.Message{
		{Role: "system", Content: "rules"},
		{Role: "user", Content: "task"},
	}
	for i := 0; i < 10; i++ {
		role := "assistant"
		if i%2 == 1 {
			role = "user"
		}
		messages = append(messages, llm.Message{Role: role, Content: strings.Repeat("x", 1000)})
	}

	trimmed := trimMessages(messages, 3000)

	if trimmed[0].Content != "rules" {
		t.Fatal("system prompt was dropped")
	}
	if !strings.HasPrefix(trimmed[1].Content, "task") {
		t.Fatal("original task was dropped")
	}
	if len(trimmed) >= len(messages) {
		t.Fatal("messages were not trimmed")
	}
}
