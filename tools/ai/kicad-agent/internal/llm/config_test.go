// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package llm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeSettings(t *testing.T, body string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "settings.json")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadConfigRejectsUnknownFields(t *testing.T) {
	path := writeSettings(t, `{
		"default": "p",
		"providers": {"p": {"type": "openai", "baseUrl": "https://example.com", "model": "m", "modle": "typo"}}
	}`)

	if _, err := LoadConfig(path); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected unknown-field error, got %v", err)
	}
}

func TestLoadConfigRejectsTrailingData(t *testing.T) {
	path := writeSettings(t, `{"default":"p","providers":{"p":{"type":"openai","baseUrl":"https://example.com","model":"m"}}} {}`)

	if _, err := LoadConfig(path); err == nil {
		t.Fatal("expected trailing-data error")
	}
}

func TestResolveValidation(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		typ     string
		wantErr string
	}{
		{"remote http", "http://example.com/v1", "openai", "HTTPS"},
		{"loopback http", "http://127.0.0.1:11434/v1", "openai", ""},
		{"credentials", "https://user:pass@example.com/v1", "openai", "credentials"},
		{"query", "https://example.com/v1?key=1", "openai", "query"},
		{"bad type", "https://example.com", "mystery", "unsupported type"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := &Config{
				Default: "p",
				Providers: map[string]ProviderConfig{
					"p": {Type: tc.typ, BaseURL: tc.baseURL, Model: "m", APIKeyEnv: "TEST_LLM_KEY"},
				},
			}
			t.Setenv("TEST_LLM_KEY", "test")

			_, _, err := cfg.Resolve("")

			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestResolveTrimsTrailingSlashAndSelectsSingleProvider(t *testing.T) {
	cfg := &Config{
		Providers: map[string]ProviderConfig{
			"only": {Type: "openai", BaseURL: "https://example.com/v1/", Model: "m", APIKeyEnv: "TEST_LLM_KEY"},
		},
	}
	t.Setenv("TEST_LLM_KEY", "test")

	name, provider, err := cfg.Resolve("")
	if err != nil {
		t.Fatal(err)
	}
	if name != "only" {
		t.Fatalf("expected only provider, got %q", name)
	}
	if strings.HasSuffix(provider.BaseURL, "/") {
		t.Fatalf("base URL was not normalized: %q", provider.BaseURL)
	}
}
