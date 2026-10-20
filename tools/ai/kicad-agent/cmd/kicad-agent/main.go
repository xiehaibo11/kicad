// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/commands"
)

func main() {
	// Ctrl+C / SIGTERM cancels in-flight IPC calls and external processes, which
	// CommandContext kills for us.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	root := commands.NewRootCmd()
	root.SetContext(ctx)

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(commands.ExitCode(err))
	}
}
