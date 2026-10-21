// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package backend

import "testing"

func TestKebab(t *testing.T) {
	cases := map[string]string{
		"excludeDnp":   "exclude-dnp",
		"dryRun":       "dry-run",
		"simple":       "simple",
		"formatPreset": "format-preset",
	}
	for in, want := range cases {
		if got := kebab(in); got != want {
			t.Errorf("kebab(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPayloadHelpers(t *testing.T) {
	p := map[string]any{
		"s": "value",
		"b": true,
		"i": float64(42),
		"l": []any{"a", "b"},
	}

	if argString(p, "s") != "value" {
		t.Fatal("argString failed")
	}
	if !argBool(p, "b") {
		t.Fatal("argBool failed")
	}
	if argInt(p, "i") != 42 {
		t.Fatal("argInt failed")
	}
	if got := argStrings(p, "l"); len(got) != 2 || got[1] != "b" {
		t.Fatalf("argStrings failed: %v", got)
	}
	if argString(p, "missing") != "" {
		t.Fatal("missing string should be empty")
	}
}
