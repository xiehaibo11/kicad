// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package backend

import (
	"fmt"
	"strings"
)

// normalizeIPCError turns AS_UNHANDLED into an actionable error.  KiCad
// registers request handlers per open editor frame, so a missing handler
// usually means the document is not open -- not that the action is unknown.
func normalizeIPCError(action string, err error) error {
	ipcErr, ok := err.(*Error)
	if !ok || ipcErr.Code != "UNHANDLED" {
		return err
	}

	request := ipcErr.Message
	if i := strings.LastIndex(request, "request of type "); i >= 0 {
		request = request[i+len("request of type "):]
	}

	code := "HANDLER_NOT_AVAILABLE"
	hint := "open the document in a connected KiCad editor"

	switch {
	case strings.Contains(request, "GetOpenDocuments"):
		code = "DOCUMENTS_UNAVAILABLE"
		hint = "KiCad only lists documents that are open; pass a path to project.info " +
			"(offline), or use project.list/project.resolve to discover projects on disk"
	case strings.Contains(request, "GetBoundingBox"):
		code = "BOARD_NOT_OPEN"
		hint = "the PCB editor is not open, so KiCad has no bounding-box handler; " +
			"open the board in KiCad or use board.export.stats for an offline board size"
	}

	return &Error{
		Code:    code,
		Message: fmt.Sprintf("KiCad API has no handler for %s", request),
		Detail:  hint + " (" + action + ")",
	}
}
