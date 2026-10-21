// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

//go:build !nng

package backend

import (
	"context"
	"time"
)

// IPCClient is a stub when the nng build tag is not enabled.  CLI-only actions
// still work; IPC actions return a structured error with build instructions.
type IPCClient struct {
	SocketPath string
	Timeout    time.Duration
	ClientName string
}

func NewIPCClient(socket string) *IPCClient {
	if socket == "" {
		socket = DefaultSocketPath()
	}
	return &IPCClient{SocketPath: socket, Timeout: 30 * time.Second, ClientName: "kicad-agent"}
}

func (c *IPCClient) CallAction(ctx context.Context, action string, payload map[string]any) (*Result, error) {
	return nil, &Error{
		Code:    "IPC_DISABLED",
		Message: "IPC support is not compiled into this binary",
		Detail:  "rebuild with: make build-ipc (requires NNG 1.x headers and library)",
	}
}

func (c *IPCClient) Close() error { return nil }
