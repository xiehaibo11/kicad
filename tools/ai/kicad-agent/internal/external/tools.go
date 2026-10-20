// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package external integrates third-party EDA tools used by the design pipeline.
//
// Security model: the model may only invoke a fixed allowlist of executables,
// the allowlist cannot be overridden from a tool payload, the child environment
// is filtered so project files cannot exfiltrate API keys or other secrets,
// and every command runs under the caller's deadline.
package external

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type ToolStatus struct {
	Name      string `json:"name"`
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	Hint      string `json:"hint,omitempty"`
	Error     string `json:"error,omitempty"`
}

type toolDef struct {
	name        string
	command     string
	versionArgs []string
	hint        string
}

var knownTools = []toolDef{
	{"kicad-cli", "kicad-cli", []string{"version"}, "build KiCad or set KICAD_CLI"},
	{"freerouting", "freerouting", []string{"--version"}, "install Freerouting or set FREEROUTING_JAR"},
	{"java", "java", []string{"-version"}, "install a JRE (required by Freerouting)"},
	{"ngspice", "ngspice", []string{"--version"}, "brew install ngspice"},
	{"gerbv", "gerbv", []string{"--version"}, "brew install gerbv"},
	{"openscad", "openscad", []string{"--version"}, "brew install --cask openscad"},
	{"FreeCAD", "FreeCAD", []string{"--version"}, "install FreeCAD for mechanical checks"},
	{"python3", "python3", []string{"--version"}, "install Python 3"},
}

// Detect reports which known tools are available.
func Detect() []ToolStatus {
	return DetectWithCLI("")
}

// DetectWithCLI is Detect with an explicit kicad-cli path (for build-tree runs).
func DetectWithCLI(kicadCLIPath string) []ToolStatus {
	out := make([]ToolStatus, 0, len(knownTools))

	for _, t := range knownTools {
		status := ToolStatus{Name: t.name, Hint: t.hint}
		path := t.command

		if t.name == "kicad-cli" {
			if kicadCLIPath != "" {
				path = kicadCLIPath
			} else {
				path = defaultKicadCLI()
			}
		}

		resolved, err := exec.LookPath(path)
		if err != nil {
			if t.name == "freerouting" {
				if jar := freeroutingJar(); jar != "" {
					status.Available = true
					status.Path = jar
					status.Version = "jar"
					out = append(out, status)
					continue
				}
			}
			status.Error = "not found"
			out = append(out, status)
			continue
		}

		status.Available = true
		status.Path = resolved

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		stdout, stderr, _, _ := run(ctx, resolved, t.versionArgs)
		cancel()

		version := strings.TrimSpace(stdout)
		if version == "" {
			version = strings.TrimSpace(stderr)
		}
		if line, _, ok := strings.Cut(version, "\n"); ok {
			version = line
		}
		status.Version = truncateText(version, 512)

		out = append(out, status)
	}

	return out
}

// Call dispatches an external action.
func Call(ctx context.Context, action string, p map[string]any, timeout time.Duration) (*backend.Result, error) {
	switch action {
	case "external.tools.list":
		return &backend.Result{Action: action, OK: true,
			Data: map[string]any{"tools": Detect()}}, nil

	case "external.freerouting.run":
		return runFreerouting(ctx, p, timeout)

	case "external.ngspice.run":
		return runNgspice(ctx, p, timeout)

	case "external.step.check":
		return runStepCheck(ctx, p, timeout)

	case "external.step.meshcheck":
		return runStepMeshCheck(ctx, p, timeout)

	case "external.command.run":
		return runAllowed(ctx, p, timeout)
	}

	return nil, &backend.Error{Code: "UNKNOWN_ACTION",
		Message: fmt.Sprintf("external backend does not implement %q", action)}
}

func runFreerouting(ctx context.Context, p map[string]any, timeout time.Duration) (*backend.Result, error) {
	ctx, cancel := withTimeout(ctx, timeout)
	defer cancel()

	input := argString(p, "input")
	if input == "" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "input DSN is required"}
	}

	output := argString(p, "output")
	if output == "" {
		output = strings.TrimSuffix(input, filepath.Ext(input)) + ".ses"
	}

	var name string
	var args []string

	if jar := firstNonEmpty(argString(p, "jar"), freeroutingJar()); jar != "" {
		name = "java"
		args = []string{"-jar", jar}
	} else if bin, err := exec.LookPath("freerouting"); err == nil {
		name = bin
	} else {
		return nil, &backend.Error{
			Code:    "TOOL_MISSING",
			Message: "Freerouting is not installed",
			Detail:  "install Freerouting and set FREEROUTING_JAR, or add the freerouting CLI to PATH",
		}
	}

	args = append(args, "-de", input, "-do", output)
	if passes := argInt(p, "passes"); passes > 0 {
		args = append(args, "-mp", strconv.Itoa(passes))
	}
	args = append(args, argStrings(p, "args")...)

	stdout, stderr, code, err := run(ctx, name, args)
	if err != nil {
		return nil, externalError("freerouting", ctx, err)
	}

	status := "ok"
	ok := code == 0
	if !ok {
		status = "failed"
	}
	if _, statErr := os.Stat(output); statErr == nil && ok {
		status = "routed"
	}

	res := &backend.Result{
		Action: "external.freerouting.run",
		OK:     ok,
		Data: map[string]any{
			"status": status, "exitCode": code, "output": output,
			"stdout": truncateText(strings.TrimSpace(stdout), maxOutputChars),
			"stderr": truncateText(strings.TrimSpace(stderr), maxOutputChars),
		},
		Artifacts: []string{output},
	}
	if !ok {
		res.Error = &backend.Error{Code: "FREEROUTING_FAILED",
			Message: fmt.Sprintf("Freerouting exited with %d", code)}
	}
	return res, nil
}

func runNgspice(ctx context.Context, p map[string]any, timeout time.Duration) (*backend.Result, error) {
	ctx, cancel := withTimeout(ctx, timeout)
	defer cancel()

	input := argString(p, "input")
	if input == "" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "input SPICE deck is required"}
	}

	output := argString(p, "output")
	if output == "" {
		output = strings.TrimSuffix(input, filepath.Ext(input)) + ".log"
	}

	bin, err := exec.LookPath("ngspice")
	if err != nil {
		return nil, &backend.Error{Code: "TOOL_MISSING", Message: "ngspice is not installed",
			Detail: "brew install ngspice"}
	}

	stdout, stderr, code, err := run(ctx, bin, []string{"-b", "-o", output, input})
	if err != nil {
		return nil, externalError("ngspice", ctx, err)
	}

	res := &backend.Result{
		Action: "external.ngspice.run",
		OK:     code == 0,
		Data: map[string]any{
			"exitCode": code, "log": output,
			"stdout": truncateText(strings.TrimSpace(stdout), maxOutputChars),
			"stderr": truncateText(strings.TrimSpace(stderr), maxOutputChars),
		},
		Artifacts: []string{output},
	}
	if code != 0 {
		res.Error = &backend.Error{Code: "NGSPICE_FAILED",
			Message: fmt.Sprintf("ngspice exited with %d", code)}
	}
	return res, nil
}

func runStepMeshCheck(ctx context.Context, p map[string]any, timeout time.Duration) (*backend.Result, error) {
	input := argString(p, "input")
	if input == "" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "input STEP file is required"}
	}

	checker := findStepChecker()
	if checker == "" {
		return nil, &backend.Error{Code: "TOOL_MISSING",
			Message: "kicad-stepcheck was not found",
			Detail:  "build it with -DKICAD_BUILD_AI_AGENT=ON (requires OpenCASCADE) or set KICAD_STEPCHECK"}
	}

	args := []string{input}

	if v, ok := floatValue(p["minVolumeMm3"]); ok && v > 0 {
		args = append(args, "--min-volume-mm3", strconv.FormatFloat(v, 'f', -1, 64))
	}
	if v := argInt(p, "maxPairs"); v > 0 {
		args = append(args, "--max-pairs", strconv.Itoa(v))
	}

	ctx, cancel := withTimeout(ctx, timeout)
	defer cancel()

	stdout, stderr, code, err := run(ctx, checker, args)
	if err != nil {
		return nil, externalError("kicad-stepcheck", ctx, err)
	}

	var report map[string]any
	if err := json.Unmarshal([]byte(strings.TrimSpace(stdout)), &report); err != nil {
		return nil, &backend.Error{Code: "STEPCHECK_BAD_OUTPUT",
			Message: "kicad-stepcheck did not return valid JSON",
			Detail:  truncateText(strings.TrimSpace(stderr+" "+stdout), 2000)}
	}

	res := &backend.Result{
		Action:    "external.step.meshcheck",
		OK:        code == 0,
		Data:      report,
		Artifacts: []string{input},
	}

	switch code {
	case 0:
	case 5:
		res.Error = &backend.Error{Code: "STEP_COLLISIONS",
			Message: "exact STEP solid intersection found overlapping bodies"}
	case 1:
		res.Error = &backend.Error{Code: "STEPCHECK_FAILED",
			Message: "kicad-stepcheck could not evaluate one or more solid pairs"}
	default:
		res.Error = &backend.Error{Code: "STEPCHECK_FAILED",
			Message: fmt.Sprintf("kicad-stepcheck exited with %d", code)}
	}

	if stderr = strings.TrimSpace(stderr); stderr != "" {
		res.Diagnostics = append(res.Diagnostics, backend.Diagnostic{
			Severity: "info", Code: "STEPCHECK_STDERR", Message: truncateText(stderr, 2000),
		})
	}

	return res, nil
}

func findStepChecker() string {
	name := "kicad-stepcheck"
	if _, err := os.Stat(name + ".exe"); err == nil {
		name += ".exe"
	}

	if path := os.Getenv("KICAD_STEPCHECK"); path != "" {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path
		}
	}

	if path, err := exec.LookPath(name); err == nil {
		return path
	}

	candidates := []string{filepath.Join(filepath.Dir(defaultKicadCLI()), name)}

	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), name))
	}

	dir, err := os.Getwd()
	if err == nil {
		for {
			candidates = append(candidates, filepath.Join(dir, "build", "bin", name))

			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}

	return ""
}

func floatValue(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	case string:
		f, err := strconv.ParseFloat(strings.TrimSpace(n), 64)
		return f, err == nil
	}
	return 0, false
}

func runStepCheck(ctx context.Context, p map[string]any, timeout time.Duration) (*backend.Result, error) {
	command := argString(p, "command")
	if command == "" {
		return nil, &backend.Error{
			Code:    "TOOL_MISSING",
			Message: "no mechanical checker configured",
			Detail:  "provide an allowlisted command (see external.command.run) or integrate an exact mesh-collision tool",
		}
	}

	args := []string{}
	if input := argString(p, "input"); input != "" {
		args = append(args, input)
	}
	if enclosure := argString(p, "enclosure"); enclosure != "" {
		args = append(args, "--enclosure", enclosure)
	}
	args = append(args, argStrings(p, "args")...)

	return runAllowedCommand(ctx, "external.step.check", command, args, timeout)
}

func runAllowed(ctx context.Context, p map[string]any, timeout time.Duration) (*backend.Result, error) {
	command := argString(p, "command")
	if command == "" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "command is required"}
	}

	// A payload must not be able to widen the command allowlist.
	if len(argStrings(p, "allowlist")) > 0 {
		return nil, &backend.Error{Code: "COMMAND_NOT_ALLOWED",
			Message: "the allowlist cannot be overridden from a tool payload"}
	}

	return runAllowedCommand(ctx, "external.command.run", command, argStrings(p, "args"), timeout)
}

func runAllowedCommand(ctx context.Context, action, command string, args []string, timeout time.Duration) (*backend.Result, error) {
	base := filepath.Base(command)
	if !defaultAllowlist()[base] {
		return nil, &backend.Error{Code: "COMMAND_NOT_ALLOWED",
			Message: fmt.Sprintf("external command %q is not allowlisted", base),
			Detail:  "kicad-agent only runs a fixed set of EDA tools; use a dedicated action instead"}
	}
	if len(args) > 128 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "too many arguments"}
	}
	for _, arg := range args {
		if len(arg) > 4096 {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "an argument exceeds 4096 bytes"}
		}
	}

	ctx, cancel := withTimeout(ctx, timeout)
	defer cancel()

	stdout, stderr, code, err := run(ctx, command, args)
	if err != nil {
		return nil, externalError(base, ctx, err)
	}

	res := &backend.Result{
		Action: action,
		OK:     code == 0,
		Data: map[string]any{
			"command": command, "args": args, "exitCode": code,
			"stdout": truncateText(strings.TrimSpace(stdout), maxOutputChars),
			"stderr": truncateText(strings.TrimSpace(stderr), maxOutputChars),
		},
	}
	if code != 0 {
		res.Error = &backend.Error{Code: "EXTERNAL_COMMAND_FAILED",
			Message: fmt.Sprintf("%s exited with %d", base, code)}
	}
	return res, nil
}

const maxOutputChars = 256 * 1024

type limitedBuffer struct {
	buf       bytes.Buffer
	max       int
	truncated bool
}

func (w *limitedBuffer) Write(p []byte) (int, error) {
	if w.buf.Len() >= w.max {
		w.truncated = true
		return len(p), nil
	}

	room := w.max - w.buf.Len()
	if len(p) > room {
		w.buf.Write(p[:room])
		w.truncated = true
		return len(p), nil
	}

	return w.buf.Write(p)
}

func run(ctx context.Context, name string, args []string) (string, string, int, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = sanitizedEnv()
	cmd.Stdin = nil

	var out, errBuf limitedBuffer
	out.max = maxOutputChars
	errBuf.max = maxOutputChars
	cmd.Stdout = &out
	cmd.Stderr = &errBuf

	err := cmd.Run()
	if err != nil {
		if ctx.Err() != nil {
			return out.buf.String(), errBuf.buf.String(), -1, ctx.Err()
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			return out.buf.String(), errBuf.buf.String(), exitErr.ExitCode(), nil
		}
		return out.buf.String(), errBuf.buf.String(), -1, err
	}

	return out.buf.String(), errBuf.buf.String(), 0, nil
}

func withTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return ctx, func() {}
	}
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, timeout)
}

func externalError(tool string, ctx context.Context, err error) error {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return &backend.Error{Code: "TIMEOUT",
			Message: fmt.Sprintf("%s exceeded its deadline", tool)}
	}
	if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		return &backend.Error{Code: "CANCELLED", Message: tool + " was cancelled"}
	}
	return &backend.Error{Code: "EXTERNAL_FAILED", Message: err.Error()}
}

// sanitizedEnv builds a minimal child environment.  Secrets such as
// ANTHROPIC_API_KEY or OPENAI_API_KEY must never reach an external tool, where
// a malicious project file could print them.
func sanitizedEnv() []string {
	var env []string

	for _, entry := range os.Environ() {
		name, _, ok := strings.Cut(entry, "=")
		if !ok {
			continue
		}

		if allowedEnv(name) {
			env = append(env, entry)
		}
	}

	return env
}

func allowedEnv(name string) bool {
	switch name {
	case "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USER", "LOGNAME",
		"LANG", "LANGUAGE", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR",
		"XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
		"DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH", "LD_LIBRARY_PATH",
		"FREEROUTING_JAR", "KICAD_CLI", "KICAD_API_SOCKET",
		"KICAD_CONFIG_HOME", "KICAD_USER_TEMPLATE_DIR":
		return true
	}

	if strings.HasPrefix(name, "LC_") {
		return true
	}
	if strings.HasPrefix(name, "KICAD9_") || strings.HasPrefix(name, "KICAD10_") {
		return true
	}
	if strings.HasPrefix(name, "NGSPICE_") {
		return true
	}

	return false
}

func truncateText(value string, max int) string {
	if len(value) <= max {
		return value
	}

	cut := max
	for cut > 0 && (value[cut]&0xC0) == 0x80 {
		cut--
	}

	return value[:cut] + "...(truncated)"
}

func defaultAllowlist() map[string]bool {
	// Only EDA-specific tools.  General-purpose interpreters (python3, make,
	// java) and shells are deliberately excluded: a model-controlled argument
	// list for them is arbitrary code execution.
	return map[string]bool{
		"kicad-cli":  true,
		"ngspice":    true,
		"gerbv":      true,
		"openscad":   true,
		"FreeCAD":    true,
		"freecadcmd": true,
		"iverilog":   true,
		"verilator":  true,
	}
}

// defaultKicadCLI finds kicad-cli from the environment, PATH, or a build tree.
func defaultKicadCLI() string {
	if env := os.Getenv("KICAD_CLI"); env != "" {
		return env
	}

	if path, err := exec.LookPath("kicad-cli"); err == nil {
		return path
	}

	dir, err := os.Getwd()
	if err == nil {
		for {
			for _, rel := range []string{
				"build/kicad/KiCad.app/Contents/MacOS/kicad-cli",
				"build/bin/kicad-cli",
				"build/kicad-cli",
			} {
				candidate := filepath.Join(dir, rel)
				if _, statErr := os.Stat(candidate); statErr == nil {
					return candidate
				}
			}

			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}

	return "kicad-cli"
}

func freeroutingJar() string {
	if jar := os.Getenv("FREEROUTING_JAR"); jar != "" {
		if _, err := os.Stat(jar); err == nil {
			return jar
		}
	}

	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, "freerouting", "freerouting.jar"),
		"/Applications/Freerouting.app/Contents/Java/freerouting.jar",
		"/opt/homebrew/share/freerouting/freerouting.jar",
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func argString(p map[string]any, key string) string {
	if v, ok := p[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func argInt(p map[string]any, key string) int {
	if v, ok := p[key]; ok {
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case int64:
			return int(n)
		}
	}
	return 0
}

func argStrings(p map[string]any, key string) []string {
	raw, ok := p[key]
	if !ok {
		return nil
	}
	switch v := raw.(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	case string:
		if v == "" {
			return nil
		}
		return []string{v}
	}
	return nil
}
