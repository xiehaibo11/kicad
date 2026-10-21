// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package backend

import (
	"os"
	"path/filepath"
	"runtime"
)

// DefaultSocketPath mirrors KICAD_API_SERVER::StandardSocketPath(): KiCad
// listens under /tmp on macOS (not $TMPDIR) and under the platform temporary
// directory elsewhere.
func DefaultSocketPath() string {
	dir := os.TempDir()
	if runtime.GOOS == "darwin" {
		dir = "/tmp"
	}

	return filepath.Join(dir, "kicad", "api.sock")
}
