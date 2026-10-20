// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package project starts and attaches to headless KiCad API servers.
package project

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

	abs, err := filepath.Abs(path)
	if err == nil {
		path = abs
	}

	if info, statErr := os.Stat(path); statErr == nil && info.IsDir() {
		resolved, resolveErr := findDocument(path)
		if resolveErr != nil {
			return nil, resolveErr
		}
		path = resolved
	}

	if filepath.Ext(path) != ".kicad_pcb" && filepath.Ext(path) != ".kicad_sch" &&
		filepath.Ext(path) != ".kicad_pro" {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "document must be a .kicad_pcb, .kicad_sch, or .kicad_pro file"}
	}

	// Prefer the already-running server when it can open the document.
	if opts.Socket != "" {
		client := backend.NewIPCClient(opts.Socket)
		client.Timeout = 30 * time.Second

		if res, callErr := client.CallAction(ctx, "project.open", map[string]any{
			"document": path,
		}); callErr == nil && res != nil && res.OK {
			return res, nil
		}
	}

	socket := opts.Socket
	if socket == "" || fileExists(socket) {
		socket = filepath.Join(os.TempDir(), "kicad-agent",
			sanitize(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))+
				fmt.Sprintf("-%d.sock", os.Getpid()))
	}

	if err := os.MkdirAll(filepath.Dir(socket), 0o700); err != nil {
		return nil, &backend.Error{Code: "SOCKET_FAILED", Message: err.Error()}
	}
	_ = os.Remove(socket)

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

func findDocument(dir string) (string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", err
	}

	var pick string

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()

		if strings.HasSuffix(name, ".kicad_pcb") {
			return filepath.Join(dir, name), nil
		}

		if pick == "" && strings.HasSuffix(name, ".kicad_sch") {
			pick = filepath.Join(dir, name)
		}
	}

	if pick == "" {
		return "", &backend.Error{Code: "DOCUMENT_NOT_FOUND",
			Message: "no .kicad_pcb or .kicad_sch found in " + dir}
	}

	return pick, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func sanitize(value string) string {
	var out strings.Builder

	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') ||
			(r >= '0' && r <= '9') || r == '-' || r == '_' {
			out.WriteRune(r)
		} else {
			out.WriteByte('_')
		}
	}

	if out.Len() == 0 {
		return "project"
	}

	return out.String()
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
