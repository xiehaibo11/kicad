// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestInitializeAndToolsList(t *testing.T) {
	input := strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}`,
		`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
	}, "\n") + "\n"

	var out bytes.Buffer
	if err := Serve(context.Background(), strings.NewReader(input), &out, nil); err != nil {
		t.Fatalf("serve: %v", err)
	}

	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 responses, got %d: %q", len(lines), out.String())
	}

	var initResp map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &initResp); err != nil {
		t.Fatalf("decode initialize: %v", err)
	}
	result := initResp["result"].(map[string]any)
	if result["protocolVersion"] != "2024-11-05" {
		t.Fatalf("unexpected protocol version: %v", result["protocolVersion"])
	}

	var listResp map[string]any
	if err := json.Unmarshal([]byte(lines[1]), &listResp); err != nil {
		t.Fatalf("decode tools/list: %v", err)
	}
	tools := listResp["result"].(map[string]any)["tools"].([]any)
	if len(tools) == 0 {
		t.Fatal("no tools returned")
	}

	names := map[string]bool{}
	for _, raw := range tools {
		tool := raw.(map[string]any)
		name := tool["name"].(string)
		if names[name] {
			t.Fatalf("duplicate MCP tool name %q", name)
		}
		names[name] = true
	}

	for _, want := range []string{"kicad_health", "kicad_actions", "kicad_call", "kicad_board", "kicad_gerber", "kicad_project"} {
		if !names[want] {
			t.Fatalf("missing tool %q", want)
		}
	}
}

func TestNotificationProducesNoResponse(t *testing.T) {
	input := `{"jsonrpc":"2.0","method":"notifications/initialized"}` + "\n"
	var out bytes.Buffer
	if err := Serve(context.Background(), strings.NewReader(input), &out, nil); err != nil {
		t.Fatalf("serve: %v", err)
	}
	if out.Len() != 0 {
		t.Fatalf("notification produced a response: %q", out.String())
	}
}
