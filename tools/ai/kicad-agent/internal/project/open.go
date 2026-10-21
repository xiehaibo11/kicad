// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package project starts and attaches to headless KiCad API servers.
package project

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

// Options describes a project-open request.
type Options struct {
	CLI      string
	Socket   string
	Document string
	Project  string
	Timeout  time.Duration
}

// Open attaches to an existing API server when possible; otherwise it starts a
// detached `kicad-cli api-server` for the document and waits for its socket.
func Open(ctx context.Context, opts Options) (*backend.Result, error) {
	path := opts.Document

	if path == "" {
		path = opts.Project
	}
	if path == "" {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "project or document is required"}
	}

	path, err := Resolve(path)
	if err != nil {
		return nil, err
	}

	// Prefer the running GUI. A refused switch must not silently create another
	// session: the user may have cancelled saving an open editor.
	if opts.Socket != "" || fileExists(backend.DefaultSocketPath()) {
		client := backend.NewIPCClient(opts.Socket)
		client.Timeout = 30 * time.Second

		if res, callErr := client.CallAction(ctx, "project.open", map[string]any{
			"document": path,
		}); callErr == nil && res != nil && res.OK {
			return res, nil
		} else if callErr != nil {
			var be *backend.Error
			if !errors.As(callErr, &be) || be.Code != "IPC_UNAVAILABLE" {
				return nil, callErr
			}
		} else {
			return res, &backend.Error{Code: "PROJECT_OPEN_FAILED", Message: "the running KiCad server refused to open the project"}
		}
	}

	socket := opts.Socket
	if socket == "" {
		// Subsequent CLI/MCP calls use this same standard socket. A private
		// per-process socket would strand the document after tools/call exits.
		socket = backend.DefaultSocketPath()
	}

	if err := os.MkdirAll(filepath.Dir(socket), 0o700); err != nil {
		return nil, &backend.Error{Code: "SOCKET_FAILED", Message: err.Error()}
	}
	// The KiCad server owns stale-socket cleanup under its api.lock. Unlinking
	// here could disconnect a GUI that started between our probe and spawn.

	logPath := socket + ".log"
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, &backend.Error{Code: "SERVER_START_FAILED", Message: err.Error()}
	}

	cmd := exec.Command(opts.CLI, "api-server", path, "--socket", socket)
	cmd.Env = os.Environ()
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	detach(cmd)

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, &backend.Error{Code: "SERVER_START_FAILED",
			Message: "failed to start kicad-cli api-server",
			Detail:  err.Error()}
	}

	pid := cmd.Process.Pid
	_ = cmd.Process.Release()
	logFile.Close()

	timeout := opts.Timeout
	if timeout <= 0 {
		timeout = 60 * time.Second
	}

	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		if fileExists(socket) {
			client := backend.NewIPCClient(socket)
			client.Timeout = time.Second
			ready, readyErr := client.CallAction(ctx, "system.capabilities", nil)
			if readyErr != nil || ready == nil || !ready.OK {
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
				time.Sleep(250 * time.Millisecond)
				continue
			}
			return &backend.Result{
				Action: "project.open",
				OK:     true,
				Data: map[string]any{
					"document": path,
					"socket":   socket,
					"pid":      pid,
					"spawned":  true,
					"log":      logPath,
				},
			}, nil
		}

		if ctx.Err() != nil {
			return nil, ctx.Err()
		}

		time.Sleep(250 * time.Millisecond)
	}

	logTail := tailFile(logPath, 4000)

	return nil, &backend.Error{Code: "SERVER_TIMEOUT",
		Message: "timed out waiting for the KiCad API socket",
		Detail:  fmt.Sprintf("socket=%s pid=%d log=%s\n%s", socket, pid, logPath, logTail)}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func tailFile(path string, max int) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}

	if len(data) > max {
		data = data[len(data)-max:]
	}

	return string(data)
}
