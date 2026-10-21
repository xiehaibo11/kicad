// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/kicadactions"
)

// cliPositionalKeys are payload keys consumed as positional arguments.
var cliPositionalKeys = map[string]bool{
	"input": true, "inputs": true, "fileA": true, "fileB": true,
	"ancestor": true, "ours": true, "theirs": true,
}

// runGeneric serves any kicad-cli subcommand from its generated schema.  Every
// payload key must name a positional or an option of that subcommand.
func (c *KicadCLI) runGeneric(ctx context.Context, action string, cmd kicadactions.CLICommand,
	p map[string]any, res *Result, start time.Time) (*Result, error) {
	args := append([]string{}, cmd.Path...)

	consumed := map[string]bool{"timeoutMs": true}
	options, err := cliOptionArgs(cmd, p, consumed, true)
	if err != nil {
		return nil, err
	}
	args = append(args, options...)

	keys := cmd.PositionalKeys()
	for i, key := range keys {
		consumed[key] = true
		if i < len(cmd.Positionals) && cmd.Positionals[i].Multiple {
			values := argStrings(p, key)
			if len(values) == 0 && !cmd.Positionals[i].Optional {
				return nil, &Error{Code: "BAD_INPUT", Message: key + "[] is required"}
			}
			args = append(args, values...)
			continue
		}
		value := argString(p, key)
		if value == "" {
			if i < len(cmd.Positionals) && cmd.Positionals[i].Optional {
				continue
			}
			return nil, &Error{Code: "BAD_INPUT", Message: key + " is required",
				Detail: "kicad-cli " + strings.Join(cmd.Path, " ") + ": " + cmd.Usage}
		}
		args = append(args, value)
	}

	if unknown := unconsumed(p, consumed); len(unknown) > 0 {
		return nil, unknownOptionsError(cmd, unknown)
	}

	output := firstNonEmptyString(argString(p, "output"), argString(p, "outputDir"))
	outputIsDir := false
	if output != "" {
		outputIsDir = outputIsDirectory(cmd, p)
		target := output
		if !outputIsDir {
			target = filepath.Dir(output)
		}
		if err := os.MkdirAll(target, 0o755); err != nil {
			return nil, &Error{Code: "OUTPUT_UNWRITABLE", Message: err.Error()}
		}
	}

	if t := argInt(p, "timeoutMs"); t > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(t)*time.Millisecond)
		defer cancel()
	}

	stdout, stderr, code, err := c.run(ctx, args...)
	if err != nil {
		return nil, err
	}

	data := map[string]any{"args": args, "exitCode": code}
	text := strings.TrimSpace(string(stdout))
	var parsed any
	if text != "" && json.Unmarshal([]byte(text), &parsed) == nil {
		data["json"] = parsed
	} else {
		data["stdout"] = truncateText(text, 256*1024)
	}
	if s := strings.TrimSpace(string(stderr)); s != "" {
		data["stderr"] = truncateText(s, 64*1024)
	}

	res.OK = code == 0
	res.Data = data
	res.ElapsedMs = time.Since(start).Milliseconds()
	if output != "" {
		res.Artifacts = []string{output}
		// kicad-cli sometimes reports a plotting failure on stderr with exit
		// code 0; success requires the artifact to exist.
		if code == 0 && !artifactExists(output, outputIsDir) {
			res.OK = false
			res.Error = &Error{Code: "ARTIFACT_MISSING",
				Message: "kicad-cli exited 0 but produced no output at " + output,
				Detail:  truncateText(strings.TrimSpace(string(stderr)), 4000)}
		}
	}
	if code != 0 {
		res.Error = &Error{Code: "KICAD_CLI_FAILED",
			Message: fmt.Sprintf("kicad-cli %s exited with %d", strings.Join(cmd.Path, " "), code),
			Detail:  truncateText(strings.TrimSpace(string(stderr)), 4000)}
	}
	return res, nil
}

// cliOptionArgs converts payload keys naming options into flags.  Keys already
// in consumed are skipped; matched keys are added to consumed.  When strict is
// false unknown keys are left for the caller.
func cliOptionArgs(cmd kicadactions.CLICommand, p map[string]any, consumed map[string]bool,
	strict bool) ([]string, error) {
	index := map[string]kicadactions.CLIOption{}
	for _, opt := range cmd.Options {
		index[kicadactions.NormalizeOptionKey(opt.Long)] = opt
		for _, alias := range opt.Aliases {
			if strings.HasPrefix(alias, "--") {
				index[kicadactions.NormalizeOptionKey(alias)] = opt
			}
		}
	}

	keys := make([]string, 0, len(p))
	for key := range p {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var args []string
	for _, key := range keys {
		if consumed[key] || cliPositionalKeys[key] {
			continue
		}
		value := p[key]
		lookup := key
		switch key {
		case "outputDir":
			lookup = "output"
		case "defineVars", "variables":
			vars, ok := value.(map[string]any)
			if !ok {
				return nil, &Error{Code: "BAD_INPUT", Message: key + " must be an object of KEY: VALUE"}
			}
			if _, has := index["definevar"]; !has {
				return nil, &Error{Code: "BAD_INPUT",
					Message: "kicad-cli " + strings.Join(cmd.Path, " ") + " does not accept --define-var"}
			}
			names := make([]string, 0, len(vars))
			for k := range vars {
				names = append(names, k)
			}
			sort.Strings(names)
			for _, k := range names {
				args = append(args, "--define-var", k+"="+scalarString(vars[k]))
			}
			consumed[key] = true
			continue
		}

		opt, ok := index[kicadactions.NormalizeOptionKey(lookup)]
		if !ok {
			if strict {
				continue // reported by the caller via unconsumed()
			}
			continue
		}
		consumed[key] = true

		if !opt.Value {
			b, isBool := value.(bool)
			if !isBool {
				return nil, &Error{Code: "BAD_INPUT",
					Message: fmt.Sprintf("%s is a switch; pass true or false", key)}
			}
			if b {
				args = append(args, opt.Long)
			}
			continue
		}

		switch v := value.(type) {
		case nil:
		case []any:
			if opt.Repeat {
				for _, item := range v {
					args = append(args, opt.Long, scalarString(item))
				}
			} else {
				parts := make([]string, 0, len(v))
				for _, item := range v {
					parts = append(parts, scalarString(item))
				}
				args = append(args, opt.Long, strings.Join(parts, ","))
			}
		case []string:
			if opt.Repeat {
				for _, item := range v {
					args = append(args, opt.Long, item)
				}
			} else {
				args = append(args, opt.Long, strings.Join(v, ","))
			}
		case map[string]any:
			return nil, &Error{Code: "BAD_INPUT", Message: key + " must be a scalar or list"}
		default:
			args = append(args, opt.Long, scalarString(v))
		}
	}
	return args, nil
}

func unconsumed(p map[string]any, consumed map[string]bool) []string {
	var out []string
	for key := range p {
		if !consumed[key] {
			out = append(out, key)
		}
	}
	sort.Strings(out)
	return out
}

func unknownOptionsError(cmd kicadactions.CLICommand, unknown []string) error {
	valid := append([]string{}, cmd.PositionalKeys()...)
	for _, opt := range cmd.Options {
		valid = append(valid, kicadactions.OptionKey(opt.Long))
	}
	return &Error{Code: "BAD_INPUT",
		Message: "unknown option(s) for kicad-cli " + strings.Join(cmd.Path, " ") + ": " + strings.Join(unknown, ", "),
		Detail:  "valid keys: " + strings.Join(valid, ", ") + ", timeoutMs"}
}

func scalarString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case int:
		return strconv.Itoa(x)
	case int64:
		return strconv.FormatInt(x, 10)
	case bool:
		return strconv.FormatBool(x)
	case json.Number:
		return x.String()
	}
	return fmt.Sprint(v)
}

// outputIsDirectory reports whether --output names a directory for this
// command (per its help text), honouring single-file modes.
func outputIsDirectory(cmd kicadactions.CLICommand, p map[string]any) bool {
	if argBool(p, "modeSingle") {
		return false
	}
	for _, opt := range cmd.Options {
		if opt.Long == "--output" {
			return strings.Contains(strings.ToLower(opt.Help), "directory")
		}
	}
	return false
}

func artifactExists(path string, dir bool) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	if !dir || !info.IsDir() {
		return true
	}
	entries, err := os.ReadDir(path)
	return err == nil && len(entries) > 0
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
