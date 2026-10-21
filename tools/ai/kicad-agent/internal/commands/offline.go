// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package commands

import (
	"fmt"
	"os"

	upstreamblocks "github.com/zhoushoujianwork/easyeda-agent/internal/blocks"
	upstreamspec "github.com/zhoushoujianwork/easyeda-agent/internal/spec"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

func offlineSpec(p map[string]any) (*backend.Result, error) {
	path := argString(p, "input")
	if path == "" {
		path = argString(p, "spec")
	}
	if path == "" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "input (spec file) is required"}
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, &backend.Error{Code: "SPEC_READ_FAILED", Message: err.Error(), Detail: path}
	}

	s, err := upstreamspec.Parse(raw)
	if err != nil {
		return nil, &backend.Error{Code: "SPEC_PARSE_FAILED", Message: err.Error(), Detail: path}
	}

	issues := upstreamspec.Validate(s)
	hasErrors := upstreamspec.HasErrors(issues)

	res := &backend.Result{
		Action: "spec.validate",
		OK:     !hasErrors,
		Data: map[string]any{
			"spec":      s,
			"issues":    issues,
			"hasErrors": hasErrors,
		},
	}
	if hasErrors {
		res.Error = &backend.Error{Code: "SPEC_INVALID",
			Message: "spec validation reported ERROR-level issues"}
	}
	return res, nil
}

func offlineBlocks(action string, p map[string]any) (*backend.Result, error) {
	switch action {
	case "blocks.list":
		all, err := upstreamblocks.Load()
		if err != nil {
			return nil, &backend.Error{Code: "BLOCKS_LOAD_FAILED", Message: err.Error()}
		}
		return &backend.Result{Action: action, OK: true,
			Data: map[string]any{"count": len(all), "blocks": all}}, nil

	case "blocks.search":
		query := argString(p, "query")
		if query == "" {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "query is required"}
		}
		found, err := upstreamblocks.Search(query)
		if err != nil {
			return nil, &backend.Error{Code: "BLOCKS_SEARCH_FAILED", Message: err.Error()}
		}
		return &backend.Result{Action: action, OK: true,
			Data: map[string]any{"query": query, "count": len(found), "blocks": found}}, nil

	case "blocks.show":
		id := argString(p, "id")
		if id == "" {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "id is required"}
		}
		block, ok, err := upstreamblocks.Get(id)
		if err != nil {
			return nil, &backend.Error{Code: "BLOCKS_LOAD_FAILED", Message: err.Error()}
		}
		if !ok {
			return nil, &backend.Error{Code: "BLOCK_NOT_FOUND", Message: fmt.Sprintf("block %q not found", id)}
		}
		return &backend.Result{Action: action, OK: true, Data: block}, nil
	}

	return nil, &backend.Error{Code: "UNKNOWN_ACTION", Message: action}
}

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
