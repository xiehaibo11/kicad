// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package library provides filesystem-backed searches used by the offline
// action backend.
package library

import (
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type FootprintInfo struct {
	LibID    string `json:"libId"`
	Name     string `json:"name"`
	Library  string `json:"library"`
	Path     string `json:"path"`
	PadCount int    `json:"padCount"`
}

func argString(p map[string]any, key string) string {
	if v, ok := p[key].(string); ok {
		return v
	}
	return ""
}

func argInt(p map[string]any, key string) int {
	switch v := p[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case int64:
		return int(v)
	case string:
		n, _ := strconv.Atoi(strings.TrimSpace(v))
		return n
	}
	return 0
}

// SearchFootprints searches .pretty libraries under the configured KiCad
// footprint roots.  It is intentionally filesystem-only: it does not require a
// live API server and never mutates anything.
func SearchFootprints(p map[string]any) ([]FootprintInfo, error) {
	query := strings.ToLower(strings.TrimSpace(argString(p, "query")))
	libraryFilter := strings.TrimSpace(argString(p, "library"))
	minPads := argInt(p, "minPads")
	maxPads := argInt(p, "maxPads")
	limit := argInt(p, "limit")

	if limit <= 0 {
		limit = 50
	}
	if limit > 1000 {
		limit = 1000
	}

	roots := footprintRoots()

	if len(roots) == 0 {
		return nil, &backend.Error{Code: "NO_FOOTPRINT_LIBRARIES",
			Message: "no footprint library roots found",
			Detail:  "set KICAD10_FOOTPRINT_DIR, KICAD9_FOOTPRINT_DIR, or KICAD_FOOTPRINT_DIR"}
	}

	results := []FootprintInfo{}
	seen := 0

	for _, root := range roots {
		if seen >= 50000 || len(results) >= limit {
			break
		}

		_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
			if err != nil || seen >= 50000 || len(results) >= limit {
				return filepath.SkipAll
			}

			if !d.IsDir() || !strings.HasSuffix(d.Name(), ".pretty") {
				return nil
			}

			libraryName := strings.TrimSuffix(d.Name(), ".pretty")

			if libraryFilter != "" && !strings.EqualFold(libraryName, libraryFilter) {
				return filepath.SkipDir
			}

			entries, err := os.ReadDir(path)
			if err != nil {
				return nil
			}

			for _, entry := range entries {
				if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".kicad_mod") {
					continue
				}

				seen++

				name := strings.TrimSuffix(entry.Name(), ".kicad_mod")

				if query != "" && !strings.Contains(strings.ToLower(name), query) &&
					!strings.Contains(strings.ToLower(libraryName), query) {
					continue
				}

				fullPath := filepath.Join(path, entry.Name())
				data, err := os.ReadFile(fullPath)
				if err != nil {
					continue
				}

				padCount := strings.Count(string(data), "(pad ")

				if minPads > 0 && padCount < minPads {
					continue
				}
				if maxPads > 0 && padCount > maxPads {
					continue
				}

				results = append(results, FootprintInfo{
					LibID:    libraryName + ":" + name,
					Name:     name,
					Library:  libraryName,
					Path:     fullPath,
					PadCount: padCount,
				})

				if len(results) >= limit {
					return filepath.SkipAll
				}
			}

			return filepath.SkipDir
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return strings.ToLower(results[i].LibID) < strings.ToLower(results[j].LibID)
	})

	return results, nil
}

func footprintRoots() []string {
	var roots []string

	for _, name := range []string{
		"KICAD10_FOOTPRINT_DIR", "KICAD9_FOOTPRINT_DIR",
		"KICAD8_FOOTPRINT_DIR", "KICAD_FOOTPRINT_DIR",
	} {
		if value := os.Getenv(name); value != "" {
			for _, part := range filepath.SplitList(value) {
				if part != "" {
					roots = append(roots, part)
				}
			}
		}
	}

	if len(roots) == 0 {
		roots = stockFootprintRoots()
	}

	if len(roots) == 0 {
		if home, err := os.UserHomeDir(); err == nil {
			roots = append(roots, filepath.Join(home, "Documents", "KiCad"))
		}
	}

	// WalkDir does not descend into a symlinked root.
	for i, root := range roots {
		if resolved, err := filepath.EvalSymlinks(root); err == nil {
			roots[i] = resolved
		}
	}

	return roots
}

// stockFootprintRoots returns KiCad's built-in KICADn_FOOTPRINT_DIR default
// (<bundle>/Contents/SharedSupport/footprints on macOS) for the bundle next to
// this binary, the build tree it was built in, and the standard install paths.
func stockFootprintRoots() []string {
	var candidates []string

	if exe, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "..", "SharedSupport", "footprints"),
			filepath.Join(dir, "..", "kicad", "KiCad.app", "Contents", "SharedSupport", "footprints"),
			filepath.Join(dir, "..", "share", "kicad", "footprints"))
	}

	candidates = append(candidates,
		"/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints",
		"/Library/Application Support/kicad/footprints",
		"/usr/share/kicad/footprints",
		"/usr/local/share/kicad/footprints")

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return []string{filepath.Clean(candidate)}
		}
	}

	return nil
}
