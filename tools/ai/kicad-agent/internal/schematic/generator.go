// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

// Package schematic generates schematics from a declarative circuit spec.
//
// The generator is deliberately label-first: after placing a symbol and
// reading its absolute pin positions, it places a local label with the net name
// at each pin endpoint.  KiCad's connectivity engine treats that as a real
// connection, so the result can be annotated, saved, and ERC-checked without
// routing wires across the sheet.
package schematic

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type Dispatcher func(context.Context, string, map[string]any) (*backend.Result, error)

type Position struct {
	XMm float64 `json:"xMm"`
	YMm float64 `json:"yMm"`
}

type Component struct {
	Reference string    `json:"reference"`
	LibID     string    `json:"libId"`
	Value     string    `json:"value,omitempty"`
	Footprint string    `json:"footprint,omitempty"`
	Unit      int       `json:"unit,omitempty"`
	Position  *Position `json:"position,omitempty"`
}

type Net struct {
	Name string   `json:"name"`
	Pins []string `json:"pins"`
}

type Spec struct {
	Components     []Component `json:"components"`
	Nets           []Net       `json:"nets"`
	Annotate       bool        `json:"annotate"`
	GenerateLabels *bool       `json:"generateLabels,omitempty"`
}

type ComponentReport struct {
	Reference string            `json:"reference"`
	LibID     string            `json:"libId"`
	Unit      int               `json:"unit,omitempty"`
	Status    string            `json:"status"`
	Error     string            `json:"error,omitempty"`
	Pins      map[string]string `json:"pins,omitempty"`
}

type NetReport struct {
	Name   string   `json:"name"`
	Labels int      `json:"labels"`
	Status string   `json:"status"`
	Error  string   `json:"error,omitempty"`
	Pins   []string `json:"pins,omitempty"`
}

type Report struct {
	Spec          string            `json:"spec"`
	Project       string            `json:"project"`
	Schematic     string            `json:"schematic"`
	DryRun        bool              `json:"dryRun"`
	StartedAt     string            `json:"startedAt"`
	FinishedAt    string            `json:"finishedAt"`
	Components    []ComponentReport `json:"components"`
	Nets          []NetReport       `json:"nets"`
	Annotated     bool              `json:"annotated"`
	Saved         bool              `json:"saved"`
	ERCRan        bool              `json:"ercRan"`
	ERCOK         bool              `json:"ercOk"`
	ERCViolations int               `json:"ercViolations"`
	ERC           any               `json:"erc,omitempty"`
	OK            bool              `json:"ok"`
	Diagnostics   []string          `json:"diagnostics,omitempty"`
}

type Options struct {
	SpecPath     string
	ProjectDir   string
	DocumentPath string
	CreateNew    bool
	DryRun       bool
	RunERC       bool
}

func LoadSpec(path string) (*Spec, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var spec Spec
	if err := json.Unmarshal(raw, &spec); err != nil {
		return nil, fmt.Errorf("parse circuit spec: %w", err)
	}

	if len(spec.Components) == 0 {
		return nil, fmt.Errorf("circuit spec has no components")
	}

	return &spec, nil
}

func Generate(ctx context.Context, opts Options, dispatch Dispatcher) (*Report, error) {
	spec, err := LoadSpec(opts.SpecPath)
	if err != nil {
		return nil, err
	}

	project := opts.ProjectDir
	if project == "" {
		project, err = os.Getwd()
		if err != nil {
			return nil, err
		}
	}
	project, _ = filepath.Abs(project)

	schematicPath := opts.DocumentPath
	if schematicPath == "" {
		schematicPath, err = findSchematic(project)
		if err != nil {
			return nil, err
		}
	}
	if schematicPath == "" && opts.CreateNew {
		schematicPath = filepath.Join(project, filepath.Base(project)+".kicad_sch")
	}
	if schematicPath == "" {
		return nil, fmt.Errorf("no .kicad_sch found in %s; pass --new or --document", project)
	}

	if !filepath.IsAbs(schematicPath) {
		schematicPath = filepath.Join(project, schematicPath)
	}

	report := &Report{
		Spec:      opts.SpecPath,
		Project:   project,
		Schematic: schematicPath,
		DryRun:    opts.DryRun,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}

	if problems := validateSpec(spec); len(problems) > 0 {
		report.Diagnostics = append(report.Diagnostics, problems...)
	}

	if opts.DryRun {
		return dryRunReport(report, spec), nil
	}

	// --new is only a creation request: never replace an existing schematic.
	if opts.CreateNew && fileExists(schematicPath) {
		return nil, fmt.Errorf("refusing to overwrite existing schematic %s; "+
			"remove --new or choose another --document", schematicPath)
	}

	doc := map[string]any{"type": "schematic", "path": schematicPath}

	// Create the document when the file does not exist.  CreateDocument is only
	// served by `kicad-cli api-server`; GUI sessions return UNIMPLEMENTED.
	if !fileExists(schematicPath) {
		res, err := dispatch(ctx, "schematic.create", map[string]any{"path": schematicPath})
		if err != nil {
			return nil, fmt.Errorf("create schematic: %w", err)
		}
		if res == nil || !res.OK {
			return nil, fmt.Errorf("create schematic failed: %s", resultError(res))
		}
		report.Diagnostics = append(report.Diagnostics, "created schematic "+schematicPath)

		// The create response carries the authoritative project specifier.
		// KiCad derives the project name from the new schematic's stem, which
		// can differ from other projects in the same directory.
		if m, ok := res.Data.(map[string]any); ok {
			if d, ok := m["document"].(map[string]any); ok && len(d) > 0 {
				doc = d
			}
		}
	}

	// pinPositions maps "REF@UNIT.PIN" and "REF.PIN" to {xNm,yNm}.
	pinPositions := map[string]map[string]any{}

	for i, comp := range spec.Components {
		cr := ComponentReport{
			Reference: strings.TrimSpace(comp.Reference),
			LibID:     comp.LibID,
			Unit:      comp.Unit,
		}

		if cr.Reference == "" {
			cr.Status = "failed"
			cr.Error = "reference is required"
			report.Components = append(report.Components, cr)
			continue
		}

		pos := comp.Position
		if pos == nil {
			pos = &Position{XMm: 50 + float64(i%6)*30, YMm: 50 + float64(i/6)*30}
		}

		// KiCad ERC flags symbols whose pins are off the connection grid.
		pos = &Position{XMm: snap127(pos.XMm), YMm: snap127(pos.YMm)}

		unit := comp.Unit
		if unit <= 0 {
			unit = 1
		}

		payload := map[string]any{
			"document":  doc,
			"libId":     comp.LibID,
			"position":  map[string]any{"xMm": pos.XMm, "yMm": pos.YMm},
			"reference": cr.Reference,
			"value":     comp.Value,
			"footprint": comp.Footprint,
			"unit":      unit,
		}

		res, err := dispatch(ctx, "schematic.place.symbol", payload)
		if err != nil {
			cr.Status = "failed"
			cr.Error = err.Error()
			report.Components = append(report.Components, cr)
			continue
		}
		if res == nil || !res.OK {
			cr.Status = "failed"
			cr.Error = resultError(res)
			report.Components = append(report.Components, cr)
			continue
		}

		cr.Pins = map[string]string{}

		pins := pinsFromResult(res.Data)
		if len(pins) == 0 {
			cr.Status = "failed"
			cr.Error = "symbol placed but no pin positions were returned"
			report.Components = append(report.Components, cr)
			continue
		}

		for _, pin := range pins {
			number, _ := pin["number"].(string)
			name, _ := pin["name"].(string)
			position, ok := pinPosition(pin)
			if !ok {
				continue
			}

			number = strings.TrimSpace(number)
			name = strings.TrimSpace(name)

			if number != "" {
				pinPositions[pinKey(cr.Reference, unit, number)] = position
				pinPositions[pinKey(cr.Reference, 0, number)] = position
				cr.Pins[number] = positionText(position)
			}
			// Allow specs to reference a pin by its name (e.g. U1.VCC).
			if name != "" && !strings.EqualFold(name, number) {
				pinPositions[pinKey(cr.Reference, unit, name)] = position
				pinPositions[pinKey(cr.Reference, 0, name)] = position
			}
		}

		if len(cr.Pins) == 0 {
			cr.Status = "failed"
			cr.Error = "no usable pin positions were returned"
		} else {
			cr.Status = "ok"
		}

		report.Components = append(report.Components, cr)
	}

	generateLabels := spec.GenerateLabels == nil || *spec.GenerateLabels

	for _, net := range spec.Nets {
		nr := NetReport{Name: strings.TrimSpace(net.Name), Pins: net.Pins}

		if nr.Name == "" {
			nr.Status = "failed"
			nr.Error = "net name is required"
			report.Nets = append(report.Nets, nr)
			continue
		}

		if !generateLabels {
			nr.Status = "skipped"
			report.Nets = append(report.Nets, nr)
			continue
		}

		if len(net.Pins) == 0 {
			nr.Status = "failed"
			nr.Error = "net has no pins"
			report.Nets = append(report.Nets, nr)
			continue
		}

		var failures []string

		for _, pinRef := range net.Pins {
			comp, unit, pin, ok := parsePinRef(pinRef)
			if !ok {
				failures = append(failures, "invalid pin reference "+pinRef)
				continue
			}

			position, found := lookupPin(pinPositions, comp, unit, pin)
			if !found {
				failures = append(failures, "pin "+pinRef+" was not placed")
				continue
			}

			item := map[string]any{
				"type": "label",
				"json": map[string]any{
					"position": position,
					"text":     map[string]any{"text": nr.Name},
				},
			}

			res, err := dispatch(ctx, "schematic.items.create", map[string]any{
				"document": doc,
				"items":    []any{item},
			})

			if err != nil {
				failures = append(failures, pinRef+": "+err.Error())
				continue
			}
			if res == nil || !res.OK {
				failures = append(failures, pinRef+": "+resultError(res))
				continue
			}

			nr.Labels++
		}

		if len(failures) > 0 {
			nr.Status = "failed"
			nr.Error = strings.Join(failures, "; ")
		} else {
			nr.Status = "ok"
		}

		report.Nets = append(report.Nets, nr)
	}

	if spec.Annotate && needsAnnotation(spec) {
		res, err := dispatch(ctx, "schematic.annotate", map[string]any{
			"document": doc,
			"reset":    true,
			"start":    1,
		})
		if err == nil && res != nil && res.OK {
			report.Annotated = true
			applyAnnotations(report, res.Data)
		} else {
			report.Diagnostics = append(report.Diagnostics, "annotate failed: "+resultError(res)+errString(err))
		}
	} else if spec.Annotate {
		report.Diagnostics = append(report.Diagnostics,
			"all references are final; annotation was not needed")
	}

	// Persist before ERC so the CLI job reads the generated content.
	if res, err := dispatch(ctx, "document.save", map[string]any{"document": doc}); err != nil || res == nil || !res.OK {
		report.Diagnostics = append(report.Diagnostics, "save failed: "+resultError(res)+errString(err))
	} else {
		report.Saved = true
	}

	if opts.RunERC {
		artifacts := filepath.Join(project, "artifacts")
		_ = os.MkdirAll(artifacts, 0o755)

		res, err := dispatch(ctx, "schematic.erc.run", map[string]any{
			"input":     schematicPath,
			"output":    filepath.Join(artifacts, "schematic-erc.json"),
			"format":    "json",
			"timeoutMs": 300000,
		})
		if err != nil {
			report.Diagnostics = append(report.Diagnostics, "ERC failed to run: "+err.Error())
		} else if res == nil || !res.OK {
			report.Diagnostics = append(report.Diagnostics, "ERC failed to run: "+resultError(res))
		} else {
			report.ERC = res.Data
			report.ERCRan = true
			report.ERCViolations = countViolations(res.Data)
			report.ERCOK = report.ERCViolations == 0
		}
	}

	report.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	report.OK = true

	if len(report.Diagnostics) > 0 {
		for _, d := range report.Diagnostics {
			if strings.HasPrefix(d, "save failed") || !strings.HasPrefix(d, "created") &&
				!strings.HasSuffix(d, "annotation was not needed") {
				report.OK = false
			}
		}
	}

	for _, c := range report.Components {
		if c.Status != "ok" {
			report.OK = false
		}
	}
	for _, n := range report.Nets {
		if n.Status == "failed" || (n.Status == "skipped" && spec.GenerateLabels == nil) {
			report.OK = false
		}
	}
	if opts.RunERC && (!report.ERCRan || !report.ERCOK) {
		report.OK = false
	}
	if !report.Saved {
		report.OK = false
	}

	return report, nil
}

func RunAction(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	opts := Options{
		SpecPath:     argString(p, "spec"),
		ProjectDir:   argString(p, "project"),
		DocumentPath: argString(p, "document"),
		CreateNew:    argBool(p, "new"),
		DryRun:       argBool(p, "dryRun"),
		RunERC:       !argBool(p, "noErc"),
	}

	if opts.SpecPath == "" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "spec is required"}
	}

	report, err := Generate(ctx, opts, dispatch)
	if err != nil {
		return nil, err
	}

	res := &backend.Result{Action: "schematic.generate", OK: report.OK, Data: report}
	if !report.OK {
		res.Error = &backend.Error{Code: "SCHEMATIC_GENERATE_FAILED",
			Message: "schematic generation did not complete cleanly; see report.diagnostics"}
	}
	return res, nil
}

func dryRunReport(report *Report, spec *Spec) *Report {
	report.OK = len(report.Diagnostics) == 0

	for _, comp := range spec.Components {
		status := "planned"
		if strings.TrimSpace(comp.Reference) == "" || strings.TrimSpace(comp.LibID) == "" {
			status = "invalid"
		}
		report.Components = append(report.Components, ComponentReport{
			Reference: comp.Reference, LibID: comp.LibID, Unit: comp.Unit, Status: status,
		})
	}

	for _, net := range spec.Nets {
		status := "planned"
		if strings.TrimSpace(net.Name) == "" || len(net.Pins) == 0 {
			status = "invalid"
		}
		report.Nets = append(report.Nets, NetReport{
			Name: net.Name, Pins: net.Pins, Status: status,
		})
	}

	report.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	return report
}

// validateSpec checks cross-field constraints before any document is touched.
func validateSpec(spec *Spec) []string {
	var problems []string

	refs := map[string]bool{}
	units := map[string]map[int]bool{}

	for _, c := range spec.Components {
		ref := strings.TrimSpace(c.Reference)

		if ref == "" {
			problems = append(problems, "component has an empty reference")
			continue
		}
		if strings.TrimSpace(c.LibID) == "" {
			problems = append(problems, ref+": libId is required")
		}

		key := strings.ToUpper(ref)
		if refs[key] && c.Unit <= 0 {
			problems = append(problems, ref+": duplicate reference")
		}
		refs[key] = true

		if c.Unit > 0 {
			if units[key] == nil {
				units[key] = map[int]bool{}
			}
			if units[key][c.Unit] {
				problems = append(problems, fmt.Sprintf("%s: duplicate unit %d", ref, c.Unit))
			}
			units[key][c.Unit] = true
		}
	}

	nets := map[string]bool{}
	pinNet := map[string]string{}

	for _, n := range spec.Nets {
		name := strings.TrimSpace(n.Name)
		if name == "" {
			problems = append(problems, "net has an empty name")
			continue
		}

		key := strings.ToUpper(name)
		if nets[key] {
			problems = append(problems, "duplicate net name "+name)
		}
		nets[key] = true

		if len(n.Pins) == 0 {
			problems = append(problems, "net "+name+" has no pins")
		}

		for _, pinRef := range n.Pins {
			comp, unit, pin, ok := parsePinRef(pinRef)
			if !ok {
				problems = append(problems, "invalid pin reference "+pinRef)
				continue
			}

			refKey := strings.ToUpper(comp)
			if !refs[refKey] {
				problems = append(problems, pinRef+": unknown component "+comp)
				continue
			}
			if unit > 0 && units[refKey] != nil && !units[refKey][unit] {
				problems = append(problems, fmt.Sprintf("%s: component %s has no unit %d", pinRef, comp, unit))
				continue
			}

			key := refKey + "." + strings.ToUpper(pin)
			if prev, exists := pinNet[key]; exists && prev != name {
				problems = append(problems,
					fmt.Sprintf("pin %s is assigned to both %s and %s", pinRef, prev, name))
			} else {
				pinNet[key] = name
			}
		}
	}

	return problems
}

func parsePinRef(ref string) (component string, unit int, pin string, ok bool) {
	parts := strings.Split(strings.TrimSpace(ref), ".")
	switch len(parts) {
	case 2:
		component = strings.TrimSpace(parts[0])
		pin = strings.TrimSpace(parts[1])
	case 3:
		component = strings.TrimSpace(parts[0])
		unit, _ = strconv.Atoi(strings.TrimSpace(parts[1]))
		pin = strings.TrimSpace(parts[2])
	default:
		return "", 0, "", false
	}

	return component, unit, pin, component != "" && pin != ""
}

func pinKey(reference string, unit int, pin string) string {
	ref := strings.ToUpper(strings.TrimSpace(reference))
	p := strings.TrimSpace(pin)

	if unit > 0 {
		return fmt.Sprintf("%s@%d.%s", ref, unit, p)
	}
	return ref + "." + p
}

func lookupPin(index map[string]map[string]any, component string, unit int, pin string) (map[string]any, bool) {
	ref := strings.ToUpper(strings.TrimSpace(component))
	pins := []string{strings.TrimSpace(pin), strings.ToUpper(strings.TrimSpace(pin))}

	for _, p := range pins {
		if p == "" {
			continue
		}
		if unit > 0 {
			if pos, ok := index[pinKey(ref, unit, p)]; ok {
				return pos, true
			}
		}
		if pos, ok := index[pinKey(ref, 0, p)]; ok {
			return pos, true
		}

		// A pin name that exists in exactly one unit is unambiguous.
		prefix := ref + "@"
		suffix := "." + p
		var found map[string]any
		count := 0

		for key, pos := range index {
			if strings.HasPrefix(key, prefix) && strings.HasSuffix(key, suffix) {
				found = pos
				count++
			}
		}
		if count == 1 {
			return found, true
		}
	}

	return nil, false
}

func pinPosition(pin map[string]any) (map[string]any, bool) {
	raw, ok := pin["position"].(map[string]any)
	if !ok {
		return nil, false
	}

	x, xok := nmValue(raw["xNm"])
	if !xok {
		x, xok = nmValue(raw["x_nm"])
	}
	y, yok := nmValue(raw["yNm"])
	if !yok {
		y, yok = nmValue(raw["y_nm"])
	}
	if !xok || !yok {
		return nil, false
	}

	return map[string]any{"xNm": x, "yNm": y}, true
}

// nmValue normalizes protojson int64 (a JSON string) and plain numbers.
func nmValue(value any) (any, bool) {
	switch v := value.(type) {
	case string:
		if _, err := strconv.ParseInt(v, 10, 64); err == nil {
			return v, true
		}
	case float64:
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, false
		}
		return int64(v), true
	case json.Number:
		if n, err := v.Int64(); err == nil {
			return n, true
		}
	}
	return nil, false
}

func positionText(position map[string]any) string {
	return fmt.Sprintf("%v,%v", position["xNm"], position["yNm"])
}

func needsAnnotation(spec *Spec) bool {
	for _, c := range spec.Components {
		if strings.Contains(c.Reference, "?") {
			return true
		}
	}
	return false
}

func applyAnnotations(report *Report, data any) {
	m, ok := data.(map[string]any)
	if !ok {
		return
	}

	raw, ok := m["annotations"].([]any)
	if !ok {
		return
	}

	byID := map[string]string{}

	for _, item := range raw {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := entry["item"].(map[string]any)
		value, _ := id["value"].(string)
		ref, _ := entry["reference"].(string)
		if value != "" && ref != "" {
			byID[value] = ref
		}
	}

	// The response does not carry the old reference, so only placeholder
	// references can be mapped reliably.
	next := 0
	for i := range report.Components {
		if !strings.Contains(report.Components[i].Reference, "?") {
			continue
		}
		refs := make([]string, 0, len(byID))
		for _, ref := range byID {
			refs = append(refs, ref)
		}
		sort.Strings(refs)
		if next < len(refs) {
			report.Components[i].Reference = refs[next]
			next++
		}
	}
}

func countViolations(data any) int {
	m, ok := data.(map[string]any)
	if !ok {
		return 0
	}

	if raw, ok := m["violations"].([]any); ok {
		return len(raw)
	}

	// Some ERC reports nest violations per sheet.
	total := 0
	if sheets, ok := m["sheets"].([]any); ok {
		for _, sheet := range sheets {
			if sm, ok := sheet.(map[string]any); ok {
				if raw, ok := sm["violations"].([]any); ok {
					total += len(raw)
				}
			}
		}
	}
	return total
}

func pinsFromResult(data any) []map[string]any {
	m, ok := data.(map[string]any)
	if !ok {
		return nil
	}

	raw, ok := m["pins"].([]any)
	if !ok {
		return nil
	}

	out := make([]map[string]any, 0, len(raw))

	for _, item := range raw {
		if pin, ok := item.(map[string]any); ok {
			out = append(out, pin)
		}
	}

	return out
}

func findSchematic(dir string) (string, error) {
	preferred := filepath.Join(dir, filepath.Base(dir)+".kicad_sch")
	if fileExists(preferred) {
		return preferred, nil
	}

	type candidate struct {
		path  string
		depth int
	}

	var found []candidate

	_ = filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == "artifacts" || name == ".git" || name == ".kicad-agent" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(strings.ToLower(d.Name()), ".kicad_sch") {
			rel, _ := filepath.Rel(dir, path)
			found = append(found, candidate{path: path, depth: strings.Count(rel, string(filepath.Separator))})
		}
		return nil
	})

	if len(found) == 0 {
		return "", nil
	}
	if len(found) == 1 {
		return found[0].path, nil
	}

	sort.Slice(found, func(i, j int) bool {
		if found[i].depth != found[j].depth {
			return found[i].depth < found[j].depth
		}
		return found[i].path < found[j].path
	})

	if found[0].depth == found[1].depth {
		return "", fmt.Errorf("multiple root schematics found in %s (%s, %s); pass --document",
			dir, filepath.Base(found[0].path), filepath.Base(found[1].path))
	}

	return found[0].path, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func resultError(res *backend.Result) string {
	if res == nil {
		return "empty result"
	}
	if res.Error != nil {
		return res.Error.Code + ": " + res.Error.Message
	}
	return "action failed"
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return ": " + err.Error()
}

func argString(p map[string]any, key string) string {
	if v, ok := p[key].(string); ok {
		return v
	}
	return ""
}

func argBool(p map[string]any, key string) bool {
	if v, ok := p[key].(bool); ok {
		return v
	}
	return false
}

// snap127 snaps a coordinate to KiCad's default 1.27 mm schematic grid.
func snap127(v float64) float64 {
	return math.Round(v/1.27) * 1.27
}
