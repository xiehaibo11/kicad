// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package llm provides a provider-agnostic chat client for kicad-agent.
//
// Configuration lives in settings.json.  API keys are read from environment
// variables named in the config so secrets never need to be stored in the file.
package llm

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type ProviderConfig struct {
	// "openai" (OpenAI-compatible chat completions) or "anthropic".
	Type string `json:"type"`

	// Base URL, e.g. https://api.openai.com/v1 or https://api.anthropic.com
	BaseURL string `json:"baseUrl"`

	// Name of the environment variable holding the API key.  Leave empty for
	// local providers such as Ollama that do not require a key.
	APIKeyEnv string `json:"apiKeyEnv,omitempty"`

	Model string `json:"model"`

	// Anthropic API version header.  Defaults to 2023-06-01.
	Version string `json:"version,omitempty"`

	// Optional request timeout in seconds.  Defaults to 120.
	TimeoutSeconds int `json:"timeoutSeconds,omitempty"`

	// Optional sampling temperature.  Omitted when nil, which is required by
	// some reasoning-model endpoints.
	Temperature *float64 `json:"temperature,omitempty"`

	// Optional maximum output tokens.  Defaults to 8192 for Anthropic.
	MaxTokens int `json:"maxTokens,omitempty"`

	// Optional retry count for transient HTTP failures.  Defaults to 3.
	Retries int `json:"retries,omitempty"`
}

type Config struct {
	Default   string                    `json:"default"`
	Providers map[string]ProviderConfig `json:"providers"`

	// Non-fatal configuration warnings (permissions, cleartext HTTP, ...).
	Warnings []string `json:"-"`
}

// DefaultConfigPath returns $XDG_CONFIG_HOME/kicad-agent/settings.json or
// ~/.config/kicad-agent/settings.json.
func DefaultConfigPath() string {
	if dir := os.Getenv("XDG_CONFIG_HOME"); dir != "" {
		return filepath.Join(dir, "kicad-agent", "settings.json")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return "settings.json"
	}

	return filepath.Join(home, ".config", "kicad-agent", "settings.json")
}

func LoadConfig(path string) (*Config, error) {
	if path == "" {
		path = DefaultConfigPath()
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read settings %s: %w", path, err)
	}

	var cfg Config
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()

	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("parse settings %s: %w", path, err)
	}

	var trailing any
	if err := dec.Decode(&trailing); err != io.EOF {
		return nil, fmt.Errorf("parse settings %s: trailing data after the JSON object", path)
	}

	if len(cfg.Providers) == 0 {
		return nil, fmt.Errorf("settings %s has no providers", path)
	}

	if info, err := os.Stat(path); err == nil && info.Mode().Perm()&0o077 != 0 {
		cfg.Warnings = append(cfg.Warnings,
			fmt.Sprintf("settings %s is readable by other users; chmod 600 is recommended", path))
	}

	return &cfg, nil
}

func (c *Config) Resolve(name string) (string, ProviderConfig, error) {
	if name == "" {
		name = c.Default
	}
	if name == "" && len(c.Providers) == 1 {
		for n := range c.Providers {
			name = n
		}
	}
	if name == "" {
		return "", ProviderConfig{}, fmt.Errorf("no provider selected; set default in settings.json or pass --provider")
	}

	provider, ok := c.Providers[name]
	if !ok {
		return "", ProviderConfig{}, fmt.Errorf("provider %q is not configured", name)
	}

	switch strings.ToLower(provider.Type) {
	case "", "openai", "openai-compatible", "deepseek", "ollama", "qwen":
		if provider.Type == "" {
			provider.Type = "openai"
		}
	case "anthropic":
	default:
		return "", ProviderConfig{}, fmt.Errorf("provider %q has unsupported type %q (use openai or anthropic)",
			name, provider.Type)
	}

	if provider.BaseURL == "" {
		return "", ProviderConfig{}, fmt.Errorf("provider %q has no baseUrl", name)
	}
	if provider.Model == "" {
		return "", ProviderConfig{}, fmt.Errorf("provider %q has no model", name)
	}

	parsed, err := url.Parse(provider.BaseURL)
	if err != nil || parsed.Host == "" {
		return "", ProviderConfig{}, fmt.Errorf("provider %q has an invalid baseUrl", name)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", ProviderConfig{}, fmt.Errorf("provider %q baseUrl must use http or https", name)
	}
	if parsed.User != nil {
		return "", ProviderConfig{}, fmt.Errorf("provider %q baseUrl must not contain credentials", name)
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", ProviderConfig{}, fmt.Errorf("provider %q baseUrl must not contain a query or fragment", name)
	}
	if parsed.Scheme == "http" && !isLoopback(parsed.Hostname()) {
		return "", ProviderConfig{}, fmt.Errorf("provider %q must use HTTPS for a remote host", name)
	}
	if provider.APIKeyEnv == "" && !isLoopback(parsed.Hostname()) {
		c.Warnings = append(c.Warnings,
			fmt.Sprintf("provider %q has no apiKeyEnv; a remote endpoint will receive an empty key", name))
	}

	provider.BaseURL = strings.TrimRight(provider.BaseURL, "/")

	return name, provider, nil
}

func isLoopback(host string) bool {
	switch strings.ToLower(host) {
	case "localhost", "127.0.0.1", "::1", "[::1]":
		return true
	}
	return strings.HasPrefix(host, "127.")
}
