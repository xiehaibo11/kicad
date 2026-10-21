// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/llm"
)

func newMockClient(t *testing.T, handler http.HandlerFunc) *llm.Client {
	t.Helper()

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	client, err := llm.NewClient(llm.ProviderConfig{
		Type:    "openai",
		BaseURL: server.URL + "/v1",
		Model:   "mock",
	})
	if err != nil {
		t.Fatalf("new client: %v", err)
	}

	return client
}

func TestCompactorSummarizesMiddle(t *testing.T) {
	client := newMockClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{
				"message": map[string]any{"content": "SUMMARY: placed components and routed GND"},
			}},
		})
	})

	compactor := NewCompactor(client)

	messages := []llm.Message{
		{Role: "system", Content: "rules"},
		{Role: "user", Content: "task"},
	}
	for i := 0; i < 20; i++ {
		role := "assistant"
		if i%2 == 1 {
			role = "user"
		}
		messages = append(messages, llm.Message{Role: role, Content: strings.Repeat("x", 1000)})
	}

	compacted := compactor.Compact(context.Background(), messages, 4000)

	if compacted[0].Content != "rules" {
		t.Fatal("system prompt was dropped")
	}
	if !strings.HasPrefix(compacted[1].Content, "task") {
		t.Fatalf("original task was dropped: %q", compacted[1].Content)
	}

	found := false
	for _, m := range compacted {
		if strings.Contains(m.Content, "SUMMARY: placed components") {
			found = true
		}
	}
	if !found {
		t.Fatalf("summary note missing: %+v", compacted)
	}

	if totalBytes(compacted) > 4000 {
		t.Fatalf("compacted conversation exceeds budget: %d > 4000", totalBytes(compacted))
	}
}

func TestCompactorFallsBackOnError(t *testing.T) {
	client := newMockClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	compactor := NewCompactor(client)

	messages := []llm.Message{
		{Role: "system", Content: "rules"},
		{Role: "user", Content: "task"},
	}
	for i := 0; i < 20; i++ {
		role := "assistant"
		if i%2 == 1 {
			role = "user"
		}
		messages = append(messages, llm.Message{Role: role, Content: strings.Repeat("x", 1000)})
	}

	compacted := compactor.Compact(context.Background(), messages, 4000)

	if compacted[0].Content != "rules" || !strings.HasPrefix(compacted[1].Content, "task") {
		t.Fatal("head was dropped during fallback")
	}
	if totalBytes(compacted) > 4000 {
		t.Fatalf("fallback exceeded budget")
	}
}

func TestCompactorNoopUnderBudget(t *testing.T) {
	compactor := NewCompactor(nil)

	messages := []llm.Message{
		{Role: "system", Content: "rules"},
		{Role: "user", Content: "task"},
		{Role: "assistant", Content: "ok"},
	}

	if got := compactor.Compact(context.Background(), messages, 100000); len(got) != len(messages) {
		t.Fatalf("under-budget conversation changed: %d != %d", len(got), len(messages))
	}
}
