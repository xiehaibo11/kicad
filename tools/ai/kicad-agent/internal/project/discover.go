// SPDX-License-Identifier: GPL-3.0-or-later
package project

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// Entry identifies a whole project and its root documents without opening it.
type Entry struct {
	Name      string `json:"name"`
	Directory string `json:"directory"`
	Project   string `json:"project,omitempty"`
	Board     string `json:"board,omitempty"`
	Schematic string `json:"schematic,omitempty"`
}

// Discover scans a bounded directory tree. It does not follow directory symlinks
// or descend into source-control, dependency, or KiCad backup directories.
func Discover(path string, depth int) ([]Entry, error) {
	if path == "" {
		path = "."
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, &backend.Error{Code: "PROJECT_NOT_FOUND", Message: err.Error()}
	}
	if !info.IsDir() {
		abs = filepath.Dir(abs)
	}
	if depth < 0 || depth > 8 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "depth must be between 0 and 8"}
	}
	entries := map[string]*Entry{}
	err = filepath.WalkDir(abs, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if d.IsDir() {
			if path == abs {
				return nil
			}
			rel, _ := filepath.Rel(abs, path)
			if len(strings.Split(rel, string(filepath.Separator))) > depth ||
				strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules" ||
				strings.HasSuffix(d.Name(), "-backups") {
				return filepath.SkipDir
			}
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".kicad_pro" && ext != ".kicad_pcb" && ext != ".kicad_sch" {
			return nil
		}
		base := strings.TrimSuffix(path, filepath.Ext(path))
		e := entries[base]
		if e == nil {
			e = &Entry{Name: filepath.Base(base), Directory: filepath.Dir(base)}
			entries[base] = e
		}
		switch ext {
		case ".kicad_pro":
			e.Project = path
		case ".kicad_pcb":
			e.Board = path
		case ".kicad_sch":
			e.Schematic = path
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(entries))
	for _, e := range entries {
		out = append(out, *e)
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i].Project != "") != (out[j].Project != "") {
			return out[i].Project != ""
		}
		return out[i].Directory+"/"+out[i].Name < out[j].Directory+"/"+out[j].Name
	})
	return out, nil
}

// Resolve prefers the project file. An ambiguous directory never silently opens
// an arbitrary PCB; callers can display the candidates and select a full path.
func Resolve(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", &backend.Error{Code: "PROJECT_NOT_FOUND", Message: err.Error()}
	}
	if !info.IsDir() {
		switch strings.ToLower(filepath.Ext(abs)) {
		case ".kicad_pro", ".kicad_pcb", ".kicad_sch":
			return abs, nil
		}
		return "", &backend.Error{Code: "BAD_INPUT", Message: "select a KiCad project, PCB, schematic or directory"}
	}
	entries, err := Discover(abs, 0)
	if err != nil {
		return "", err
	}
	var projects []string
	for _, e := range entries {
		if e.Project != "" {
			projects = append(projects, e.Project)
		}
	}
	if len(projects) == 1 {
		return projects[0], nil
	}
	if len(projects) == 0 && len(entries) == 1 {
		if entries[0].Board != "" {
			return entries[0].Board, nil
		}
		return entries[0].Schematic, nil
	}
	if len(entries) == 0 {
		return "", &backend.Error{Code: "DOCUMENT_NOT_FOUND", Message: "no KiCad project or root document in " + abs + "; use project.list to find projects in subdirectories"}
	}
	detail, _ := json.Marshal(entries)
	return "", &backend.Error{Code: "PROJECT_AMBIGUOUS", Message: "multiple KiCad projects/documents; select a full path from project.list", Detail: string(detail)}
}
