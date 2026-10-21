// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package project

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInfoReadsSavedProject(t *testing.T) {
	dir := t.TempDir()
	stem := filepath.Join(dir, "demo")

	projectJSON := `{
		"meta": {"filename": "demo.kicad_pro", "version": 3},
		"sheets": [["uuid-1", "Power"], ["uuid-2", "SoC"]],
		"text_variables": {"REV": "A"},
		"board": {"design_settings": {"rules": {"min_clearance": 0.2}}},
		"net_settings": {"classes": []}
	}`
	if err := os.WriteFile(stem+".kicad_pro", []byte(projectJSON), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stem+".kicad_pcb", []byte("(kicad_pcb)"), 0o600); err != nil {
		t.Fatal(err)
	}

	info, err := Info(dir)
	if err != nil {
		t.Fatal(err)
	}
	if info["source"] != "file" || info["name"] != "demo" {
		t.Fatalf("identity = %v", info)
	}
	if info["directory"] != dir {
		t.Fatalf("directory = %v, want %s", info["directory"], dir)
	}
	documents := info["documents"].(map[string]any)
	if documents["project"] != stem+".kicad_pro" || documents["board"] != stem+".kicad_pcb" {
		t.Fatalf("documents = %v", documents)
	}
	if _, ok := documents["schematic"]; ok {
		t.Fatalf("missing schematic must not be listed: %v", documents)
	}
	if len(info["sheets"].([]any)) != 2 {
		t.Fatalf("sheets = %v", info["sheets"])
	}
	if info["textVariables"].(map[string]any)["REV"] != "A" {
		t.Fatalf("textVariables = %v", info["textVariables"])
	}
	if info["designRules"].(map[string]any)["min_clearance"] != 0.2 {
		t.Fatalf("designRules = %v", info["designRules"])
	}
}

func TestInfoMissingPath(t *testing.T) {
	if _, err := Info(filepath.Join(t.TempDir(), "absent")); err == nil {
		t.Fatal("expected an error for a missing path")
	}
}
