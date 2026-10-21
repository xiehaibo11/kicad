// SPDX-License-Identifier: GPL-3.0-or-later
package project

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

func touch(t *testing.T, dir, name string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestResolveProjectPreservesWholeProject(t *testing.T) {
	dir := t.TempDir()
	project := touch(t, dir, "pic_programmer.kicad_pro")
	touch(t, dir, "pic_programmer.kicad_pcb")
	touch(t, dir, "pic_programmer.kicad_sch")
	touch(t, dir, "child_sheet.kicad_sch")
	got, err := Resolve(dir)
	if err != nil || got != project {
		t.Fatalf("resolve = %q, %v", got, err)
	}
	board := filepath.Join(dir, "pic_programmer.kicad_pcb")
	got, err = Resolve(board)
	if err != nil || got != board {
		t.Fatalf("explicit board = %q, %v", got, err)
	}
}

func TestAmbiguousDirectoryNeverPicksFirstPCB(t *testing.T) {
	dir := t.TempDir()
	touch(t, dir, "a.kicad_pro")
	touch(t, dir, "a.kicad_pcb")
	touch(t, dir, "b.kicad_pro")
	_, err := Resolve(dir)
	var be *backend.Error
	if !errors.As(err, &be) || be.Code != "PROJECT_AMBIGUOUS" || be.Detail == "" {
		t.Fatalf("expected candidates, got %v", err)
	}
	// A document-only directory is also ambiguous with two unrelated boards.
	dir = t.TempDir()
	touch(t, dir, "a.kicad_pcb")
	touch(t, dir, "b.kicad_pcb")
	_, err = Resolve(dir)
	if !errors.As(err, &be) || be.Code != "PROJECT_AMBIGUOUS" {
		t.Fatal(err)
	}
}

func TestDiscoverBoundsAndSkipsBackupsAndSymlinks(t *testing.T) {
	dir := t.TempDir()
	want := touch(t, dir, "real/pic.kicad_pro")
	touch(t, dir, "real/inside/deeper.kicad_pro")
	touch(t, dir, "pic-backups/old.kicad_pro")
	touch(t, dir, ".git/hidden.kicad_pro")
	outside := t.TempDir()
	touch(t, outside, "outside.kicad_pro")
	if err := os.Symlink(outside, filepath.Join(dir, "link")); err != nil {
		t.Fatal(err)
	}
	entries, err := Discover(dir, 1)
	if err != nil || len(entries) != 1 || entries[0].Project != want {
		t.Fatalf("%+v, %v", entries, err)
	}
	if _, err := Resolve(filepath.Join(dir, "missing")); err == nil {
		t.Fatal("missing input succeeded")
	}
	if _, err := Discover(dir, 9); err == nil {
		t.Fatal("unbounded depth succeeded")
	}
}
