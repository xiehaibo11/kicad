// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testClient(t *testing.T, url string) *Client {
	t.Helper()

	client, err := NewClient(ProviderConfig{
		Type: "openai", BaseURL: url, Model: "test", Retries: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func TestOpenAIChatOmitsTemperatureWhenUnset(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode body: %v", err)
		}
		if _, present := body["temperature"]; present {
			t.Errorf("temperature should be omitted when nil")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": `{"final":"ok"}`}}},
		})
	}))
	defer server.Close()

	out, err := testClient(t, server.URL).Chat(context.Background(),
		[]Message{{Role: "user", Content: "hi"}})
	if err != nil {
		t.Fatal(err)
	}
	if out != `{"final":"ok"}` {
		t.Fatalf("unexpected content: %q", out)
	}
}

func TestAnthropicSplitsSystemAndSetsMaxTokens(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != "" {
			t.Errorf("unexpected API key")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["system"] != "rules" {
			t.Errorf("system prompt was not extracted: %v", body["system"])
		}
		if body["max_tokens"] != float64(4096) {
			t.Errorf("max_tokens = %v", body["max_tokens"])
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"content": []any{map[string]any{"type": "text", "text": `{"final":"ok"}`}},
		})
	}))
	defer server.Close()

	client, err := NewClient(ProviderConfig{
		Type: "anthropic", BaseURL: server.URL, Model: "test", MaxTokens: 4096,
	})
	if err != nil {
		t.Fatal(err)
	}

	_, err = client.Chat(context.Background(), []Message{
		{Role: "system", Content: "rules"},
		{Role: "user", Content: "hi"},
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestClientRetriesTransientStatus(t *testing.T) {
	attempts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts == 1 {
			w.Header().Set("Retry-After", "0")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": "ok"}}},
		})
	}))
	defer server.Close()

	out, err := testClient(t, server.URL).Chat(context.Background(),
		[]Message{{Role: "user", Content: "hi"}})
	if err != nil {
		t.Fatal(err)
	}
	if out != "ok" || attempts != 2 {
		t.Fatalf("out=%q attempts=%d", out, attempts)
	}
}

func TestClientRejectsRedirect(t *testing.T) {
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("redirect target must not be reached")
	}))
	defer target.Close()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()

	if _, err := testClient(t, server.URL).Chat(context.Background(),
		[]Message{{Role: "user", Content: "hi"}}); err == nil {
		t.Fatal("expected redirect to fail")
	}
}

func TestClientSurfacesProviderError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"type":"auth","message":"bad key"},"secret":"leak"}`))
	}))
	defer server.Close()

	_, err := testClient(t, server.URL).Chat(context.Background(),
		[]Message{{Role: "user", Content: "hi"}})

	if err == nil || !strings.Contains(err.Error(), "bad key") {
		t.Fatalf("expected provider message, got %v", err)
	}
	if strings.Contains(err.Error(), "leak") {
		t.Fatalf("raw body must not be included: %v", err)
	}
}

func TestClientRejectsEmptyAndTruncatedResponses(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{"empty", `{"choices":[{"message":{"content":""}}]}`},
		{"truncated", `{"choices":[{"message":{"content":"partial"},"finish_reason":"length"}]}`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()

			if _, err := testClient(t, server.URL).Chat(context.Background(),
				[]Message{{Role: "user", Content: "hi"}}); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}

func TestJoinURL(t *testing.T) {
	tests := map[string]string{
		"v1/messages": "https://api.anthropic.com/v1/messages",
		"/v1/chat":    "https://api.anthropic.com/v1/chat",
	}

	for suffix, want := range tests {
		got, err := joinURL("https://api.anthropic.com/v1/", suffix)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("joinURL(%q) = %q, want %q", suffix, got, want)
		}
	}
}
