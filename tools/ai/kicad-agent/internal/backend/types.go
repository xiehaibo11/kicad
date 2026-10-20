// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package backend provides the transports used by kicad-agent actions.
package backend

import (
	"context"
	"errors"
	"fmt"
)

// Error is a structured action failure.  Codes are stable and agent-readable.
type Error struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Detail  string `json:"detail,omitempty"`
}

func (e *Error) Error() string {
	if e.Detail != "" {
		return fmt.Sprintf("%s: %s (%s)", e.Code, e.Message, e.Detail)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// ErrorFrom converts an arbitrary Go error into a structured *Error, preserving
// the stable code when the error already carries one.  Callers use this so a
// failed action still produces a parseable JSON envelope instead of an empty
// stdout and a bare stderr line.
func ErrorFrom(err error) *Error {
	if err == nil {
		return nil
	}

	var be *Error
	if errors.As(err, &be) {
		return be
	}

	if errors.Is(err, context.DeadlineExceeded) {
		return &Error{Code: "TIMEOUT", Message: "action timed out"}
	}

	if errors.Is(err, context.Canceled) {
		return &Error{Code: "CANCELLED", Message: "action cancelled"}
	}

	return &Error{Code: "ACTION_FAILED", Message: err.Error()}
}

type Diagnostic struct {
	Severity string `json:"severity"`
	Code     string `json:"code,omitempty"`
	Message  string `json:"message"`
}

// Result is the canonical action envelope returned to the CLI and MCP layer.
// stdout is never mixed with human-readable logging: logs go to stderr.
type Result struct {
	OK          bool         `json:"ok"`
	Action      string       `json:"action"`
	Data        any          `json:"data,omitempty"`
	Error       *Error       `json:"error,omitempty"`
	Diagnostics []Diagnostic `json:"diagnostics,omitempty"`
	Artifacts   []string     `json:"artifacts,omitempty"`
	ElapsedMs   int64        `json:"elapsedMs,omitempty"`
}

// Runner is implemented by each transport.
type Runner interface {
	Call(ctx context.Context, action string, payload map[string]any) (*Result, error)
}
