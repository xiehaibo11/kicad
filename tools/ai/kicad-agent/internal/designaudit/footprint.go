// SPDX-License-Identifier: GPL-3.0-or-later
package designaudit

import (
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"unicode"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type node struct {
	atom     string
	children []node
}

func (n node) name() string {
	if len(n.children) > 0 {
		return n.children[0].atom
	}
	return ""
}
func (n node) find(name string) node {
	for _, child := range n.children {
		if child.name() == name {
			return child
		}
	}
	return node{}
}
func (n node) value(index int) string {
	if index < len(n.children) {
		return n.children[index].atom
	}
	return ""
}
func parse(raw string) (node, error) {
	runes := []rune(raw)
	index, nodes := 0, 0
	var read func(int) (node, error)
	read = func(depth int) (node, error) {
		if depth > 128 || nodes > 300000 {
			return node{}, fmt.Errorf("footprint expression is too complex")
		}
		nodes++
		for index < len(runes) && unicode.IsSpace(runes[index]) {
			index++
		}
		if index >= len(runes) {
			return node{}, fmt.Errorf("unexpected end of footprint")
		}
		if runes[index] == '(' {
			index++
			out := node{}
			for {
				for index < len(runes) && unicode.IsSpace(runes[index]) {
					index++
				}
				if index >= len(runes) {
					return node{}, fmt.Errorf("unclosed footprint expression")
				}
				if runes[index] == ')' {
					index++
					return out, nil
				}
				child, err := read(depth + 1)
				if err != nil {
					return node{}, err
				}
				out.children = append(out.children, child)
			}
		}
		if runes[index] == ')' {
			return node{}, fmt.Errorf("unexpected closing parenthesis")
		}
		start := index
		if runes[index] == '"' {
			index++
			closed := false
			for index < len(runes) {
				if runes[index] == '\\' {
					index += 2
					continue
				}
				if runes[index] == '"' {
					index++
					closed = true
					break
				}
				index++
			}
			if !closed || index > len(runes) {
				return node{}, fmt.Errorf("unterminated quoted string")
			}
			value, err := strconv.Unquote(string(runes[start:index]))
			return node{atom: value}, err
		}
		for index < len(runes) && !unicode.IsSpace(runes[index]) && runes[index] != '(' && runes[index] != ')' {
			index++
		}
		return node{atom: string(runes[start:index])}, nil
	}
	result, err := read(0)
	if err != nil {
		return node{}, err
	}
	if strings.TrimSpace(string(runes[index:])) != "" {
		return node{}, fmt.Errorf("trailing footprint data")
	}
	return result, nil
}

func Footprint(p map[string]any) (*backend.Result, error) {
	path, err := inputFile(str(p, "input"), ".kicad_mod")
	if err != nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: err.Error()}
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > 16*1024*1024 {
		return nil, fmt.Errorf("footprint exceeds 16 MiB")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	root, err := parse(string(raw))
	if err != nil {
		return nil, &backend.Error{Code: "FOOTPRINT_PARSE_FAILED", Message: err.Error()}
	}
	if root.name() != "footprint" && root.name() != "module" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "expected a footprint/module expression"}
	}
	findings := []Check{}
	pads := 0
	courtyard, fab, reference, value := false, false, false, false
	var visit func(node)
	visit = func(n node) {
		if n.name() == "layer" {
			if strings.HasSuffix(n.value(1), ".CrtYd") {
				courtyard = true
			}
			if strings.HasSuffix(n.value(1), ".Fab") {
				fab = true
			}
		}
		if (n.name() == "fp_text" && n.value(1) == "reference") || (n.name() == "property" && n.value(1) == "Reference") {
			reference = true
		}
		if (n.name() == "fp_text" && n.value(1) == "value") || (n.name() == "property" && n.value(1) == "Value") {
			value = true
		}
		if n.name() == "pad" {
			pads++
			id, kind := n.value(1), n.value(2)
			size := n.find("size")
			x, ex := strconv.ParseFloat(size.value(1), 64)
			y, ey := strconv.ParseFloat(size.value(2), 64)
			if ex != nil || ey != nil || !positiveFinite(x) || !positiveFinite(y) {
				findings = append(findings, Check{"pad-size", "fail", "pad " + id + " needs positive X/Y dimensions"})
			}
			layers := n.find("layers")
			copper := false
			if len(layers.children) > 0 {
				for _, l := range layers.children[1:] {
					if strings.HasSuffix(l.atom, ".Cu") {
						copper = true
					}
				}
			}
			if len(layers.children) == 0 {
				findings = append(findings, Check{"pad-layers", "fail", "pad " + id + " has no layers"})
			}
			if kind != "np_thru_hole" && (!copper || id == "") {
				findings = append(findings, Check{"electrical-pad", "fail", "electrical pad needs a number and copper layer"})
			}
			drill := n.find("drill")
			if kind == "thru_hole" || kind == "np_thru_hole" {
				at := 1
				if drill.value(1) == "oval" {
					at = 2
				}
				dx, ex := strconv.ParseFloat(drill.value(at), 64)
				dy, ey := dx, ex
				if at == 2 {
					dy, ey = strconv.ParseFloat(drill.value(at+1), 64)
				}
				if ex != nil || ey != nil || !positiveFinite(dx) || !positiveFinite(dy) {
					findings = append(findings, Check{"pad-drill", "fail", "pad " + id + " needs finite positive drill dimensions"})
				} else if kind == "thru_hole" && (dx >= x || dy >= y) {
					findings = append(findings, Check{"pad-annulus", "fail", "pad " + id + " drill leaves no annular ring"})
				}
			}
		}
		for _, child := range n.children {
			if len(child.children) > 0 {
				visit(child)
			}
		}
	}
	visit(root)
	if pads == 0 {
		findings = append(findings, Check{"pads", "blocked", "no pads; confirm this is an intentionally mechanical footprint"})
	}
	for name, present := range map[string]bool{"courtyard": courtyard, "fabrication-layer": fab, "reference": reference, "value": value} {
		if !present {
			findings = append(findings, Check{name, "blocked", "definition missing; review package/library requirements"})
		}
	}
	hash, err := fingerprint(path)
	if err != nil {
		return nil, err
	}
	out := &backend.Result{Action: "audit.footprint", OK: len(findings) == 0, Data: map[string]any{"input": path, "sha256": hash, "padCount": pads, "findings": findings, "structuralChecksPassed": len(findings) == 0, "readyForFabrication": false, "pendingEvidence": []string{"native board DRC for clearances, courtyard closure and solder mask", "datasheet pin mapping, package dimensions, exposed pad and polarity", "3D/mechanical/assembly fit; structural checks are not complete KLC or IPC-7351 certification"}}}
	if !out.OK {
		out.Error = &backend.Error{Code: "FOOTPRINT_NOT_PASSED", Message: "footprint has invalid geometry or incomplete definitions"}
	}
	return out, nil
}

func positiveFinite(value float64) bool {
	return value > 0 && !math.IsNaN(value) && !math.IsInf(value, 0)
}
