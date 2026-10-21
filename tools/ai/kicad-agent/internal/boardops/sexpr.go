// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"fmt"
	"strconv"
	"strings"
)

// sexpr is a minimal KiCad s-expression node: (name arg arg ...).  Atoms and
// strings are kept as Go strings; nested lists are *sexpr.
type sexpr struct {
	Name string
	Args []any
}

func parseSexpr(text string) (*sexpr, error) {
	p := &sexprParser{s: text}
	p.skip()
	if p.i >= len(p.s) || p.s[p.i] != '(' {
		return nil, fmt.Errorf("s-expression must start with '('")
	}
	return p.list()
}

type sexprParser struct {
	s string
	i int
}

func (p *sexprParser) skip() {
	for p.i < len(p.s) && strings.ContainsRune(" \t\r\n", rune(p.s[p.i])) {
		p.i++
	}
}

func (p *sexprParser) list() (*sexpr, error) {
	p.i++ // '('
	node := &sexpr{}
	first := true
	for {
		p.skip()
		if p.i >= len(p.s) {
			return nil, fmt.Errorf("unterminated list")
		}
		switch p.s[p.i] {
		case ')':
			p.i++
			return node, nil
		case '(':
			child, err := p.list()
			if err != nil {
				return nil, err
			}
			node.Args = append(node.Args, child)
		case '"':
			str, err := p.str()
			if err != nil {
				return nil, err
			}
			if first {
				node.Name = str
			} else {
				node.Args = append(node.Args, str)
			}
		default:
			start := p.i
			for p.i < len(p.s) && !strings.ContainsRune(" \t\r\n()", rune(p.s[p.i])) {
				p.i++
			}
			atom := p.s[start:p.i]
			if first {
				node.Name = atom
			} else {
				node.Args = append(node.Args, atom)
			}
		}
		first = false
	}
}

func (p *sexprParser) str() (string, error) {
	var b strings.Builder
	p.i++ // opening quote
	for p.i < len(p.s) {
		c := p.s[p.i]
		switch c {
		case '\\':
			if p.i+1 < len(p.s) {
				b.WriteByte(p.s[p.i+1])
				p.i += 2
				continue
			}
		case '"':
			p.i++
			return b.String(), nil
		}
		b.WriteByte(c)
		p.i++
	}
	return "", fmt.Errorf("unterminated string")
}

// child returns the first child list with the given name.
func (n *sexpr) child(name string) *sexpr {
	for _, a := range n.Args {
		if c, ok := a.(*sexpr); ok && c.Name == name {
			return c
		}
	}
	return nil
}

func (n *sexpr) children(name string) []*sexpr {
	var out []*sexpr
	for _, a := range n.Args {
		if c, ok := a.(*sexpr); ok && c.Name == name {
			out = append(out, c)
		}
	}
	return out
}

// atoms returns the non-list arguments.
func (n *sexpr) atoms() []string {
	var out []string
	if n == nil {
		return out
	}
	for _, a := range n.Args {
		if s, ok := a.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// floats parses the leading numeric atoms.
func (n *sexpr) floats() []float64 {
	var out []float64
	for _, a := range n.atoms() {
		f, err := strconv.ParseFloat(a, 64)
		if err != nil {
			break
		}
		out = append(out, f)
	}
	return out
}
