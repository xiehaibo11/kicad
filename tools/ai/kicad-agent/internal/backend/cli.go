// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadactions"
)

// KicadCLI runs actions through the kicad-cli executable.
type KicadCLI struct {
	Binary  string
	Env     []string
	Timeout time.Duration
}

func NewKicadCLI(binary string) *KicadCLI {
	if binary == "" {
		binary = os.Getenv("KICAD_CLI")
	}
	if binary == "" {
		binary = "kicad-cli"
	}
	return &KicadCLI{Binary: binary, Timeout: 30 * time.Minute}
}

// RunRaw executes an allowlisted kicad-cli subcommand.  It gives the terminal
// and MCP layers a single, discoverable passthrough for every non-interactive
// kicad-cli tool without exposing arbitrary binaries.
func (c *KicadCLI) RunRaw(ctx context.Context, args []string, timeout time.Duration) (*Result, error) {
	if len(args) == 0 {
		return nil, &Error{Code: "BAD_INPUT",
			Message: "args[] is required, e.g. [\"pcb\",\"export\",\"step\",\"board.kicad_pcb\"]"}
	}

	allowed := map[string]bool{
		"version": true, "pcb": true, "sch": true, "sym": true, "fp": true,
		"gerber": true, "import": true, "jobset": true,
		"api-server": true, "mergetool": true, "--help": true, "--version": true,
	}

	if !allowed[args[0]] {
		return nil, &Error{Code: "COMMAND_NOT_ALLOWED",
			Message: fmt.Sprintf("kicad-cli subcommand %q is not allowlisted", args[0]),
			Detail:  "allowed: version, pcb, sch, sym, fp, gerber, import, jobset, api-server, mergetool, --help, --version"}
	}

	runCtx := ctx

	if timeout > 0 {
		if _, ok := ctx.Deadline(); !ok {
			var cancel context.CancelFunc
			runCtx, cancel = context.WithTimeout(ctx, timeout)
			defer cancel()
		}
	}

	stdout, stderr, code, err := c.run(runCtx, args...)
	if err != nil {
		return nil, err
	}

	res := &Result{
		Action: "kicad.cli.run",
		OK:     code == 0,
		Data: map[string]any{
			"args": args, "exitCode": code,
			"stdout": truncateText(strings.TrimSpace(string(stdout)), 256*1024),
			"stderr": truncateText(strings.TrimSpace(string(stderr)), 256*1024),
		},
	}

	if code != 0 {
		res.Error = &Error{Code: "KICAD_CLI_FAILED",
			Message: fmt.Sprintf("kicad-cli %s exited with %d", args[0], code),
			Detail:  truncateText(strings.TrimSpace(string(stderr)), 4000)}
	}

	return res, nil
}

func (c *KicadCLI) Version(ctx context.Context) (string, error) {
	out, _, code, err := c.run(ctx, "version")
	if err != nil {
		return "", err
	}
	if code != 0 {
		return "", &Error{Code: "CLI_FAILED", Message: "kicad-cli version failed",
			Detail: strings.TrimSpace(string(out))}
	}
	return strings.TrimSpace(string(out)), nil
}

func (c *KicadCLI) Call(ctx context.Context, action string, p map[string]any) (*Result, error) {
	start := time.Now()
	res := &Result{Action: action}

	switch action {
	case "system.version":
		v, err := c.Version(ctx)
		if err != nil {
			return nil, err
		}
		res.OK = true
		res.Data = map[string]any{"version": v}
		res.ElapsedMs = time.Since(start).Milliseconds()
		return res, nil

	case "board.drc.run":
		return c.runRules(ctx, true, p, res, start)
	case "schematic.erc.run":
		return c.runRules(ctx, false, p, res, start)

	case "board.render":
		return c.runSimple(ctx, action, p, res, start, []string{"pcb", "render"},
			[]string{"input"}, []string{"output"},
			map[string]string{
				"width": "-w", "height": "-h", "side": "--side", "quality": "--quality",
				"preset": "--preset", "zoom": "--zoom", "background": "--background",
			},
			nil)

	case "board.export.gerbers":
		return c.runSimple(ctx, action, p, res, start, []string{"pcb", "export", "gerbers"},
			[]string{"input"}, []string{"outputDir"}, map[string]string{"layers": "-l"}, nil)

	case "board.export.drill":
		return c.runSimple(ctx, action, p, res, start, []string{"pcb", "export", "drill"},
			[]string{"input"}, []string{"outputDir"},
			map[string]string{"format": "--format", "units": "-u", "layers": "-l"},
			[]string{"generateMap", "generateReport"})

	case "board.export.position":
		return c.runSimple(ctx, action, p, res, start, []string{"pcb", "export", "pos"},
			[]string{"input"}, []string{"output"},
			map[string]string{"side": "--side", "format": "--format", "units": "--units"}, nil)

	case "board.export.step":
		format := strings.ToLower(argString(p, "format"))
		switch format {
		case "":
			format = "step"
		case "stepz":
			format = "stpz"
		}
		args := []string{"pcb", "export", format}
		q := make(map[string]any, len(p))
		for k, v := range p {
			if k != "format" {
				q[k] = v
			}
		}
		return c.runSimple(ctx, action, q, res, start, args,
			[]string{"input"}, []string{"output"}, nil, nil)

	case "board.export.svg", "board.export.pdf", "board.export.png":
		kind := strings.TrimPrefix(action, "board.export.")
		return c.runSimple(ctx, action, p, res, start, []string{"pcb", "export", kind},
			[]string{"input"}, []string{"outputDir"},
			map[string]string{"layers": "-l", "dpi": "--dpi"}, nil)

	case "board.export.ipc2581":
		return c.runSimple(ctx, action, p, res, start, []string{"pcb", "export", "ipc2581"},
			[]string{"input"}, []string{"output"},
			map[string]string{"version": "--version", "units": "--units"}, nil)

	case "board.export.odb":
		return c.runSimple(ctx, action, p, res, start, []string{"pcb", "export", "odb"},
			[]string{"input"}, []string{"output"},
			map[string]string{"compression": "--compression", "units": "--units"}, nil)

	case "board.diff":
		return c.runDiff(ctx, action, p, res, start, "pcb")

	case "schematic.diff":
		return c.runDiff(ctx, action, p, res, start, "sch")

	case "schematic.export.netlist":
		format := argString(p, "format")
		if format == "" {
			format = "kicadsexpr"
		}
		return c.runSimple(ctx, action, p, res, start, []string{"sch", "export", "netlist"},
			[]string{"input"}, []string{"output"}, map[string]string{"format": "--format"}, nil)

	case "schematic.export.bom":
		return c.runSimple(ctx, action, p, res, start, []string{"sch", "export", "bom"},
			[]string{"input"}, []string{"output"},
			map[string]string{"formatPreset": "--format-preset", "fields": "--fields"},
			[]string{"excludeDnp"})

	case "schematic.export.pdf":
		return c.runSimple(ctx, action, p, res, start, []string{"sch", "export", "pdf"},
			[]string{"input"}, []string{"output"}, map[string]string{"pages": "--pages"}, nil)

	case "schematic.export.svg":
		return c.runSimple(ctx, action, p, res, start, []string{"sch", "export", "svg"},
			[]string{"input"}, []string{"outputDir"}, map[string]string{"pages": "--pages"}, nil)

	case "schematic.export.pythonbom":
		return c.runSimple(ctx, action, p, res, start, []string{"sch", "export", "python-bom"},
			[]string{"input"}, []string{"output"}, nil, nil)

	default:
		if cmd, ok := kicadactions.CLICommandFor(action); ok {
			return c.runGeneric(ctx, action, cmd, p, res, start)
		}
		return nil, &Error{Code: "UNKNOWN_ACTION",
			Message: fmt.Sprintf("kicad-cli backend does not implement %q", action)}
	}
}

// extraOptions validates payload keys not consumed by a hand-written handler
// against the kicad-cli schema for path and returns them as flags.
func extraOptions(path []string, p map[string]any, consumed map[string]bool) ([]string, error) {
	cmd, ok := kicadactions.CLICommandByPath(path)
	if !ok {
		return nil, nil
	}
	consumed["timeoutMs"] = true
	extra, err := cliOptionArgs(cmd, p, consumed, false)
	if err != nil {
		return nil, err
	}
	if unknown := unconsumed(p, consumed); len(unknown) > 0 {
		return nil, unknownOptionsError(cmd, unknown)
	}
	return extra, nil
}

func (c *KicadCLI) runRules(ctx context.Context, board bool, p map[string]any, res *Result, start time.Time) (*Result, error) {
	input := argString(p, "input")
	if input == "" {
		return nil, &Error{Code: "BAD_INPUT", Message: "input is required"}
	}

	output := argString(p, "output")
	tmp := ""
	if output == "" {
		f, err := os.CreateTemp("", "kicad-agent-rules-*.json")
		if err != nil {
			return nil, err
		}
		tmp = f.Name()
		f.Close()
		output = tmp
	}
	_ = tmp // the generated report is an artifact; keep it for the caller

	args := []string{}
	if board {
		args = append(args, "pcb", "drc")
	} else {
		args = append(args, "sch", "erc")
	}
	args = append(args, input, "-o", output)

	format := argString(p, "format")
	if format == "" {
		format = "json"
	}
	args = append(args, "--format", format)

	if t := argInt(p, "timeoutMs"); t > 0 {
		args = append(args, "--timeout", strconv.Itoa(t))
	}
	if board {
		if argBool(p, "refillZones") {
			args = append(args, "--refill-zones")
		}
		if argBool(p, "schematicParity") {
			args = append(args, "--schematic-parity")
		}
		if argBool(p, "allTrackErrors") {
			args = append(args, "--all-track-errors")
		}
	}

	if argBool(p, "severityAll") {
		args = append(args, "--severity-all")
	}
	// Ask the CLI to signal violations via exit code so the agent can branch on it.
	args = append(args, "--exit-code-violations")

	consumed := map[string]bool{"input": true, "output": true, "format": true,
		"refillZones": true, "schematicParity": true, "allTrackErrors": true,
		"severityAll": true, "exitCodeViolations": true, "full": true,
		"sampleViolations": true}
	extra, err := extraOptions(args[:2], p, consumed)
	if err != nil {
		return nil, err
	}
	args = append(args, extra...)

	_, stderr, code, err := c.run(ctx, args...)
	if err != nil {
		return nil, err
	}

	status := "clean"
	switch code {
	case 0:
		status = "clean"
	case 5:
		status = "violations"
	case 8:
		status = "timeout"
	case 9:
		status = "cancelled"
	default:
		return nil, &Error{Code: "KICAD_CLI_FAILED",
			Message: fmt.Sprintf("rules check exited with %d", code),
			Detail:  strings.TrimSpace(string(stderr))}
	}

	res.OK = status != "timeout" && status != "cancelled"
	res.Data = map[string]any{"status": status, "exitCode": code, "report": output, "reportPath": output}
	res.Artifacts = []string{output}
	res.ElapsedMs = time.Since(start).Milliseconds()

	switch status {
	case "timeout":
		res.Error = &Error{Code: "TIMEOUT", Message: "rules check exceeded its deadline"}
	case "cancelled":
		res.Error = &Error{Code: "CANCELLED", Message: "rules check was cancelled"}
	}

	if format == "json" {
		raw, readErr := os.ReadFile(output)
		if readErr != nil {
			res.Diagnostics = append(res.Diagnostics, Diagnostic{
				Severity: "warning", Code: "REPORT_UNREADABLE",
				Message: "rules report could not be read: " + readErr.Error(),
			})
		} else if len(raw) > 0 {
			var report any
			if err := json.Unmarshal(raw, &report); err != nil {
				res.Diagnostics = append(res.Diagnostics, Diagnostic{
					Severity: "warning", Code: "REPORT_INVALID_JSON",
					Message: "rules report is not valid JSON: " + err.Error(),
				})
			} else {
				// ERC reports nest violations under sheets[]; DRC reports put
				// them at the top level.  Normalize to a top-level list so
				// agents have one shape to consume.
				reportObj, isObject := report.(map[string]any)
				if isObject {
					if sheets, ok := reportObj["sheets"].([]any); ok {
						all := []any{}
						for _, sheet := range sheets {
							if sheetObj, ok := sheet.(map[string]any); ok {
								if violations, ok := sheetObj["violations"].([]any); ok {
									all = append(all, violations...)
								}
							}
						}
						reportObj["violations"] = all
					}
				}

				data := map[string]any{
					"status": status, "exitCode": code, "report": output, "reportPath": output,
				}
				if isObject {
					data["summary"] = ruleReportSummary(reportObj, output)
				}
				// Full reports for large boards run to hundreds of kilobytes
				// and overflow the tool-result channel.  Inline a sample and
				// keep the complete report at reportPath unless full is set.
				if !isObject || argBool(p, "full") || len(raw) <= maxInlineRuleReport {
					data["reportJson"] = report
				} else {
					limit := argInt(p, "sampleViolations")
					if limit <= 0 {
						limit = 50
					}
					data["reportJsonOmitted"] = true
					data["reportBytes"] = len(raw)
					data["sampleViolations"] = sampleRuleViolations(reportObj, limit)
					data["next"] = "read reportPath for the complete report, or re-run with full=true to inline it"
					res.Diagnostics = append(res.Diagnostics, Diagnostic{
						Severity: "warning", Code: "REPORT_OMITTED",
						Message: fmt.Sprintf("report is %d bytes; reportJson was replaced by summary/sampleViolations (full report: %s)", len(raw), output),
					})
				}
				res.Data = data
			}
		}
	}
	if len(stderr) > 0 {
		res.Diagnostics = append(res.Diagnostics, Diagnostic{
			Severity: "info", Code: "KICAD_CLI_STDERR", Message: strings.TrimSpace(string(stderr)),
		})
	}
	return res, nil
}

func (c *KicadCLI) runSimple(ctx context.Context, action string, p map[string]any, res *Result,
	start time.Time, base []string, requiredInputs, requiredOutputs []string,
	stringFlags map[string]string, boolFlags []string) (*Result, error) {
	args := append([]string{}, base...)

	for _, key := range requiredInputs {
		v := argString(p, key)
		if v == "" {
			return nil, &Error{Code: "BAD_INPUT", Message: key + " is required"}
		}
		args = append(args, v)
	}
	for _, key := range requiredOutputs {
		v := argString(p, key)
		if v == "" {
			return nil, &Error{Code: "BAD_INPUT", Message: key + " is required"}
		}
		args = append(args, "-o", v)
	}

	for key, flag := range stringFlags {
		if v := argString(p, key); v != "" {
			args = append(args, flag, v)
		}
	}
	for _, key := range boolFlags {
		if argBool(p, key) {
			args = append(args, "--"+kebab(key))
		}
	}

	consumed := map[string]bool{}
	for _, keys := range [][]string{requiredInputs, requiredOutputs, boolFlags} {
		for _, key := range keys {
			consumed[key] = true
		}
	}
	for key := range stringFlags {
		consumed[key] = true
	}
	extra, err := extraOptions(base, p, consumed)
	if err != nil {
		return nil, err
	}
	args = append(args, extra...)

	if t := argInt(p, "timeoutMs"); t > 0 {
		// Only `pcb drc` and `sch erc` expose --timeout.  Other commands get a
		// local deadline instead of an option the CLI would reject.
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(t)*time.Millisecond)
		defer cancel()
	}

	stdout, stderr, code, err := c.run(ctx, args...)
	if err != nil {
		return nil, err
	}
	if code != 0 {
		return nil, &Error{Code: "KICAD_CLI_FAILED",
			Message: fmt.Sprintf("%s exited with %d", action, code),
			Detail:  strings.TrimSpace(string(stderr))}
	}

	artifacts := []string{}
	for _, key := range append(append([]string{}, requiredInputs...), requiredOutputs...) {
		if v := argString(p, key); v != "" && key != "input" {
			artifacts = append(artifacts, v)
		}
	}

	res.OK = true
	res.Data = map[string]any{"stdout": strings.TrimSpace(string(stdout))}
	res.Artifacts = artifacts
	res.ElapsedMs = time.Since(start).Milliseconds()
	if len(stderr) > 0 {
		res.Diagnostics = append(res.Diagnostics, Diagnostic{
			Severity: "info", Code: "KICAD_CLI_STDERR", Message: strings.TrimSpace(string(stderr)),
		})
	}
	return res, nil
}

func (c *KicadCLI) runDiff(ctx context.Context, action string, p map[string]any, res *Result,
	start time.Time, face string) (*Result, error) {
	a, b := argString(p, "fileA"), argString(p, "fileB")
	if a == "" || b == "" {
		return nil, &Error{Code: "BAD_INPUT", Message: "fileA and fileB are required"}
	}
	args := []string{face, "diff", a, b}
	if f := argString(p, "format"); f != "" {
		args = append(args, "--format", f)
	}
	if o := argString(p, "output"); o != "" {
		args = append(args, "-o", o)
	}
	extra, err := extraOptions([]string{face, "diff"}, p,
		map[string]bool{"fileA": true, "fileB": true, "format": true, "output": true})
	if err != nil {
		return nil, err
	}
	args = append(args, extra...)
	stdout, stderr, code, err := c.run(ctx, args...)
	if err != nil {
		return nil, err
	}
	if code != 0 {
		return nil, &Error{Code: "KICAD_CLI_FAILED",
			Message: fmt.Sprintf("%s exited with %d", action, code),
			Detail:  strings.TrimSpace(string(stderr))}
	}
	res.OK = true
	res.Data = map[string]any{"diff": strings.TrimSpace(string(stdout))}
	res.ElapsedMs = time.Since(start).Milliseconds()
	return res, nil
}

// maxInlineRuleReport bounds how much of a DRC/ERC JSON report is inlined in
// the tool result.  Larger reports stay on disk at reportPath.
const maxInlineRuleReport = 256 * 1024

var ruleReportGroups = []string{"violations", "unconnected_items", "schematic_parity"}

func ruleReportSummary(report map[string]any, path string) map[string]any {
	summary := map[string]any{"reportPath": path, "total": 0}
	bySeverity := map[string]int{}
	byType := map[string]int{}

	for _, group := range ruleReportGroups {
		list, _ := report[group].([]any)
		summary[group] = len(list)
		for _, raw := range list {
			v, _ := raw.(map[string]any)
			if v == nil {
				continue
			}
			summary["total"] = summary["total"].(int) + 1
			severity := argString(v, "severity")
			if severity == "" {
				severity = "unknown"
			}
			bySeverity[severity]++
			violationType := argString(v, "type")
			if violationType == "" {
				violationType = "unknown"
			}
			byType[violationType]++
		}
	}
	summary["bySeverity"] = bySeverity
	summary["byType"] = byType

	if ignored, ok := report["ignored_checks"]; ok {
		summary["ignoredChecks"] = ignored
	}
	return summary
}

// sampleRuleViolations returns a bounded, compact slice of the report so an
// agent can inspect typical findings without reading the full report file.
// One example per violation type comes first so a single noisy category (for
// example hundreds of clearance errors) does not hide the other findings.
func sampleRuleViolations(report map[string]any, limit int) []any {
	type candidate struct {
		group     string
		violation map[string]any
	}
	var candidates []candidate
	for _, group := range ruleReportGroups {
		list, _ := report[group].([]any)
		for _, raw := range list {
			if v, _ := raw.(map[string]any); v != nil {
				candidates = append(candidates, candidate{group: group, violation: v})
			}
		}
	}

	out := make([]any, 0, limit)
	picked := make([]bool, len(candidates))
	seenType := map[string]bool{}
	for i, c := range candidates {
		violationType := argString(c.violation, "type")
		if seenType[violationType] {
			continue
		}
		seenType[violationType] = true
		picked[i] = true
		out = append(out, compactRuleViolation(c.group, c.violation))
		if len(out) >= limit {
			return out
		}
	}
	for i, c := range candidates {
		if picked[i] {
			continue
		}
		out = append(out, compactRuleViolation(c.group, c.violation))
		if len(out) >= limit {
			break
		}
	}
	return out
}

func compactRuleViolation(group string, violation map[string]any) map[string]any {
	sample := map[string]any{"group": group}
	if s := argString(violation, "type"); s != "" {
		sample["type"] = s
	}
	if s := argString(violation, "severity"); s != "" {
		sample["severity"] = s
	}
	if s := argString(violation, "description"); s != "" {
		sample["description"] = shortenRunes(s, 300)
	}
	if items := compactRuleItems(violation); len(items) > 0 {
		sample["items"] = items
	}
	return sample
}

func compactRuleItems(violation map[string]any) []any {
	list, _ := violation["items"].([]any)
	out := make([]any, 0, len(list))
	for _, raw := range list {
		item, _ := raw.(map[string]any)
		if item == nil {
			continue
		}
		compact := map[string]any{}
		if s := argString(item, "description"); s != "" {
			compact["description"] = shortenRunes(s, 200)
		}
		if s := argString(item, "uuid"); s != "" {
			compact["uuid"] = s
		}
		if pos, ok := item["pos"].(map[string]any); ok {
			compact["x"] = pos["x"]
			compact["y"] = pos["y"]
		}
		out = append(out, compact)
	}
	return out
}

func shortenRunes(s string, limit int) string {
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	return string(runes[:limit]) + "..."
}

func (c *KicadCLI) run(ctx context.Context, args ...string) (stdout, stderr []byte, exitCode int, err error) {
	if c.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, c.Timeout)
		defer cancel()
	}

	cmd := exec.CommandContext(ctx, c.Binary, args...)
	cmd.Env = append(os.Environ(), c.Env...)

	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf

	err = cmd.Run()
	if err != nil {
		if ctx.Err() != nil {
			if ctx.Err() == context.DeadlineExceeded {
				return out.Bytes(), errBuf.Bytes(), -1, &Error{
					Code: "TIMEOUT", Message: "kicad-cli exceeded its deadline",
					Detail: strings.TrimSpace(errBuf.String())}
			}
			return out.Bytes(), errBuf.Bytes(), -1, &Error{
				Code: "CANCELLED", Message: "kicad-cli was cancelled"}
		}
		if exitErr, ok := err.(*exec.ExitError); ok {
			return out.Bytes(), errBuf.Bytes(), exitErr.ExitCode(), nil
		}
		return out.Bytes(), errBuf.Bytes(), -1, &Error{
			Code: "KICAD_CLI_NOT_FOUND", Message: "failed to run kicad-cli",
			Detail: err.Error(),
		}
	}
	return out.Bytes(), errBuf.Bytes(), 0, nil
}

// ---- payload helpers -------------------------------------------------------

func argString(p map[string]any, key string) string {
	if v, ok := p[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func argBool(p map[string]any, key string) bool {
	if v, ok := p[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
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
		case json.Number:
			i, _ := n.Int64()
			return int(i)
		case string:
			i, _ := strconv.Atoi(n)
			return i
		}
	}
	return 0
}

func kebab(s string) string {
	var b strings.Builder
	for i, r := range s {
		if r >= 'A' && r <= 'Z' {
			if i > 0 {
				b.WriteByte('-')
			}
			b.WriteRune(r + ('a' - 'A'))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// DefaultBuildCLI finds a build-tree kicad-cli when running from the repo.
func DefaultBuildCLI(repoRoot string) string {
	candidates := []string{
		filepath.Join(repoRoot, "build", "kicad", "KiCad.app", "Contents", "MacOS", "kicad-cli"),
		filepath.Join(repoRoot, "build", "bin", "kicad-cli"),
		filepath.Join(repoRoot, "build", "kicad-cli"),
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	return ""
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
