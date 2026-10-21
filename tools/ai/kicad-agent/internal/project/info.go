// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package project

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// Info describes a saved project without opening it in KiCad.  The KiCad API
// only knows about documents that are already open, so callers that pass a
// path get a deterministic answer even when no editor frame is available.
func Info(path string) (map[string]any, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "project path is required for an offline project.info"}
	}

	resolved, err := Resolve(path)
	if err != nil {
		return nil, err
	}
	abs, err := filepath.Abs(resolved)
	if err != nil {
		return nil, err
	}

	stem := strings.TrimSuffix(abs, filepath.Ext(abs))
	projectPath, boardPath, schematicPath := stem+".kicad_pro", stem+".kicad_pcb", stem+".kicad_sch"

	info := map[string]any{
		"source":    "file",
		"name":      filepath.Base(stem),
		"directory": filepath.Dir(abs),
		"documents": map[string]any{},
	}
	documents := info["documents"].(map[string]any)

	for key, candidate := range map[string]string{
		"project":   projectPath,
		"board":     boardPath,
		"schematic": schematicPath,
	} {
		if st, statErr := os.Stat(candidate); statErr == nil && st.Mode().IsRegular() {
			documents[key] = candidate
		}
	}

	raw, readErr := os.ReadFile(projectPath)
	if readErr != nil {
		if os.IsNotExist(readErr) {
			return info, nil
		}
		return nil, &backend.Error{Code: "PROJECT_UNREADABLE", Message: readErr.Error()}
	}

	var cfg map[string]any
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return info, nil
	}
	for key, field := range map[string]string{
		"meta":          "meta",
		"sheets":        "sheets",
		"textVariables": "text_variables",
		"netSettings":   "net_settings",
	} {
		if value, ok := cfg[field]; ok {
			info[key] = value
		}
	}
	if board, ok := cfg["board"].(map[string]any); ok {
		if settings, ok := board["design_settings"].(map[string]any); ok {
			if rules, ok := settings["rules"]; ok {
				info["designRules"] = rules
			}
		}
	}

	return info, nil
}
