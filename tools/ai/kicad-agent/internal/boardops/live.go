// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"os"
	"path/filepath"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// LiveRules runs native DRC (board.drc.run) or ERC (schematic.erc.run) on the
// document as it is open in KiCad, including unsaved edits: KiCad writes a
// copy of the in-memory document (with its project file) through the API and
// kicad-cli checks that copy.  The open document and its file are untouched,
// and the check keeps kicad-cli's cooperative timeout (timeoutMs).
func LiveRules(ctx context.Context, rulesAction string, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	doc := p["document"]
	if doc == nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "document (open board or schematic path) is required"}
	}
	path := documentPath(doc)
	dir, err := os.MkdirTemp("", "kicad-agent-live-*")
	if err != nil {
		return nil, &backend.Error{Code: "TEMP_FAILED", Message: err.Error()}
	}
	copyPath := filepath.Join(dir, filepath.Base(path))
	saveArgs := map[string]any{"document": doc, "path": copyPath}
	if rulesAction == "schematic.erc.run" {
		saveArgs["type"] = "schematic"
	}
	if _, _, err := call(ctx, dispatch, "document.save_copy", saveArgs); err != nil {
		return nil, &backend.Error{Code: "LIVE_COPY_FAILED",
			Message: "could not copy the open document for checking: " + backend.ErrorFrom(err).Message,
			Detail:  "is the document open in the connected KiCad? Without a live session pass input=<saved file> instead"}
	}
	if _, err := os.Stat(copyPath); err != nil {
		return nil, &backend.Error{Code: "LIVE_COPY_FAILED", Message: "KiCad reported success but wrote no copy at " + copyPath}
	}

	q := map[string]any{}
	for k, v := range p {
		if k != "document" {
			q[k] = v
		}
	}
	q["input"] = copyPath
	if argString(q, "output") == "" {
		q["output"] = filepath.Join(dir, "report.json")
	}
	if argString(q, "format") == "" {
		q["format"] = "json"
	}
	res, err := dispatch(ctx, rulesAction, q)
	if err != nil {
		return nil, err
	}
	if data, ok := res.Data.(map[string]any); ok {
		data["source"] = "live"
		data["document"] = path
		data["checkedCopy"] = copyPath
	}
	res.Diagnostics = append(res.Diagnostics, backend.Diagnostic{Severity: "info", Code: "LIVE_DOCUMENT",
		Message: "checked the in-memory document (unsaved edits included) via a temporary copy"})
	return res, nil
}
