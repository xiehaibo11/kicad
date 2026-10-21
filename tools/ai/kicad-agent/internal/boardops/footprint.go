// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package boardops

import (
	"context"
	"fmt"
	"math"
	"os"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/library"
)

// Library footprints are placed by translating the .kicad_mod definition into
// a FootprintInstance (pads, courtyard/fab/silk lines, rectangles and circles,
// reference and value) and creating it through the item API.  Elements the
// translator does not handle are listed in "skipped", never dropped silently.

func resolveFootprintFile(p map[string]any) (string, string, error) {
	if file := argString(p, "file"); file != "" {
		return file, "", nil
	}
	libID := argString(p, "libId")
	lib, name, found := strings.Cut(libID, ":")
	if !found || lib == "" || name == "" {
		return "", "", &backend.Error{Code: "BAD_INPUT", Message: "libId 'Library:Footprint' or file (.kicad_mod) is required"}
	}
	hits, err := library.SearchFootprints(map[string]any{"query": strings.ToLower(name), "library": lib, "limit": float64(200)})
	if err != nil {
		return "", "", err
	}
	for _, h := range hits {
		if h.Name == name {
			return h.Path, libID, nil
		}
	}
	return "", "", &backend.Error{Code: "FOOTPRINT_NOT_IN_LIBRARY",
		Message: libID + " was not found in the footprint libraries (pass file for a project library)"}
}

type placement struct {
	origin point
	angle  float64 // degrees, KiCad convention (counter-clockwise on screen)
}

func (pl placement) at(x, y float64) map[string]any {
	rad := pl.angle * math.Pi / 180
	rx := x*math.Cos(rad) + y*math.Sin(rad)
	ry := -x*math.Sin(rad) + y*math.Cos(rad)
	return map[string]any{"xNm": pl.origin.X + mmToNm(rx), "yNm": pl.origin.Y + mmToNm(ry)}
}

func expandLayers(names []string) []any {
	var out []any
	seen := map[string]bool{}
	add := func(l string) {
		if !seen[l] {
			seen[l] = true
			out = append(out, l)
		}
	}
	for _, n := range names {
		switch {
		case n == "*.Cu" || n == "F&B.Cu":
			add("BL_F_Cu")
			add("BL_B_Cu")
		case strings.HasPrefix(n, "*."):
			suffix := strings.TrimPrefix(n, "*.")
			add(layerEnum("F." + suffix))
			add(layerEnum("B." + suffix))
		default:
			add(layerEnum(n))
		}
	}
	return out
}

var padShapes = map[string]string{"circle": "PSS_CIRCLE", "rect": "PSS_RECTANGLE", "oval": "PSS_OVAL",
	"roundrect": "PSS_ROUNDRECT", "trapezoid": "PSS_TRAPEZOID"}
var padTypes = map[string]string{"smd": "PT_SMD", "thru_hole": "PT_PTH", "np_thru_hole": "PT_NPTH", "connect": "PT_EDGE_CONNECTOR"}

// buildFootprint translates a parsed .kicad_mod into FootprintInstance JSON.
func buildFootprint(mod *sexpr, libID, reference, value string, pl placement) (map[string]any, []string, int, error) {
	if mod.Name != "footprint" && mod.Name != "module" {
		return nil, nil, 0, fmt.Errorf("not a footprint file (root %q)", mod.Name)
	}
	name := ""
	if a := mod.atoms(); len(a) > 0 {
		name = a[0]
	}
	lib, entry, _ := strings.Cut(libID, ":")
	if entry == "" {
		entry = name
	}

	var items []any
	var skipped []string
	pads := 0
	for _, raw := range mod.Args {
		node, ok := raw.(*sexpr)
		if !ok {
			continue
		}
		switch node.Name {
		case "pad":
			atoms := node.atoms()
			if len(atoms) < 3 {
				skipped = append(skipped, "malformed pad")
				continue
			}
			ptype, shape := padTypes[atoms[1]], padShapes[atoms[2]]
			if ptype == "" || shape == "" {
				skipped = append(skipped, fmt.Sprintf("pad %q (%s %s)", atoms[0], atoms[1], atoms[2]))
				continue
			}
			at := node.child("at").floats()
			size := node.child("size").floats()
			if len(at) < 2 || len(size) < 2 {
				skipped = append(skipped, fmt.Sprintf("pad %q without at/size", atoms[0]))
				continue
			}
			padAngle := pl.angle
			if len(at) > 2 {
				padAngle += at[2]
			}
			layer := map[string]any{"layer": "BL_F_Cu", "shape": shape,
				"size": map[string]any{"xNm": mmToNm(size[0]), "yNm": mmToNm(size[1])}}
			if rr := node.child("roundrect_rratio"); rr != nil {
				if f := rr.floats(); len(f) > 0 {
					layer["cornerRoundingRatio"] = f[0]
				}
			}
			stack := map[string]any{"type": "PST_NORMAL", "layers": expandLayers(node.child("layers").atoms()),
				"copperLayers": []any{layer}, "angle": map[string]any{"valueDegrees": padAngle}}
			if d := node.child("drill"); d != nil {
				f := d.floats()
				shapeName := "DS_CIRCLE"
				if a := d.atoms(); len(a) > 0 && a[0] == "oval" {
					shapeName = "DS_OBLONG"
					f = (&sexpr{Args: d.Args[1:]}).floats()
				}
				if len(f) > 0 {
					dy := f[0]
					if len(f) > 1 {
						dy = f[1]
					}
					stack["drill"] = map[string]any{"startLayer": "BL_F_Cu", "endLayer": "BL_B_Cu", "shape": shapeName,
						"diameter": map[string]any{"xNm": mmToNm(f[0]), "yNm": mmToNm(dy)}}
				}
			}
			if m := node.child("solder_mask_margin"); m != nil {
				if f := m.floats(); len(f) > 0 {
					stack["frontOuterLayers"] = map[string]any{"solderMaskSettings": map[string]any{
						"solderMaskMargin": map[string]any{"valueNm": mmToNm(f[0])}}}
				}
			}
			pad := map[string]any{"@type": "type.googleapis.com/kiapi.board.types.Pad", "number": atoms[0],
				"type": ptype, "position": pl.at(at[0], at[1]), "padStack": stack}
			if c := node.child("clearance"); c != nil {
				if f := c.floats(); len(f) > 0 {
					pad["copperClearanceOverride"] = map[string]any{"valueNm": mmToNm(f[0])}
				}
			}
			for _, prop := range node.children("property") {
				for _, a := range prop.atoms() {
					switch a {
					case "pad_prop_fiducial_glob":
						pad["fabProperty"] = "PFP_FIDUCIAL_GLOBAL"
					case "pad_prop_fiducial_loc":
						pad["fabProperty"] = "PFP_FIDUCIAL_LOCAL"
					case "pad_prop_testpoint":
						pad["fabProperty"] = "PFP_TESTPOINT"
					case "pad_prop_heatsink":
						pad["fabProperty"] = "PFP_HEATSINK"
					}
				}
			}
			items = append(items, pad)
			pads++
		case "fp_line", "fp_rect", "fp_circle":
			shape, err := graphic(node, pl)
			if err != nil {
				skipped = append(skipped, node.Name+": "+err.Error())
				continue
			}
			items = append(items, shape)
		case "property", "attr", "layer", "version", "generator", "generator_version", "descr", "tags",
			"duplicate_pad_numbers_are_jumpers", "embedded_fonts", "solder_mask_margin", "clearance",
			"uuid", "path", "sheetname", "sheetfile":
		case "fp_text":
			// User text such as ${REFERENCE} on Fab is cosmetic.
			skipped = append(skipped, "fp_text (cosmetic user text)")
		default:
			skipped = append(skipped, node.Name)
		}
	}
	if pads == 0 && len(items) == 0 {
		return nil, skipped, 0, fmt.Errorf("footprint has no supported pads or graphics")
	}

	attributes := map[string]any{"description": strings.Join(mod.child("descr").atoms(), " ")}
	if attr := mod.child("attr"); attr != nil {
		for _, a := range attr.atoms() {
			switch a {
			case "smd":
				attributes["mountingStyle"] = "FMS_SMD"
			case "through_hole":
				attributes["mountingStyle"] = "FMS_THROUGH_HOLE"
			case "exclude_from_bom":
				attributes["excludeFromBillOfMaterials"] = true
			case "exclude_from_pos_files":
				attributes["excludeFromPositionFiles"] = true
			case "allow_missing_courtyard":
				attributes["exemptFromCourtyardRequirement"] = true
			}
		}
	}

	field := func(fieldName, text string, fallbackLayer string, dy float64, visible bool) map[string]any {
		layer, x, y := fallbackLayer, 0.0, dy
		for _, prop := range mod.children("property") {
			if a := prop.atoms(); len(a) > 0 && a[0] == fieldName {
				if l := prop.child("layer"); l != nil && len(l.atoms()) > 0 {
					layer = l.atoms()[0]
				}
				if at := prop.child("at").floats(); len(at) >= 2 {
					x, y = at[0], at[1]
				}
			}
		}
		return map[string]any{"name": fieldName, "text": map[string]any{"layer": layerEnum(layer),
			"text": map[string]any{"text": text, "position": pl.at(x, y),
				"attributes": map[string]any{"size": map[string]any{"xNm": 1000000, "yNm": 1000000},
					"strokeWidth": map[string]any{"valueNm": 150000}, "visible": visible}}}}
	}
	if value == "" {
		value = name
	}
	fp := map[string]any{
		"position":    map[string]any{"xNm": pl.origin.X, "yNm": pl.origin.Y},
		"orientation": map[string]any{"valueDegrees": pl.angle},
		"layer":       "BL_F_Cu",
		"definition": map[string]any{"id": map[string]any{"libraryNickname": lib, "entryName": entry},
			"items": items, "attributes": attributes},
		"referenceField": field("Reference", reference, "F.SilkS", -2, true),
		"valueField":     field("Value", value, "F.Fab", 2, false),
	}
	return fp, skipped, pads, nil
}

func graphic(node *sexpr, pl placement) (map[string]any, error) {
	layerNode := node.child("layer")
	if layerNode == nil || len(layerNode.atoms()) == 0 {
		return nil, fmt.Errorf("no layer")
	}
	width := 0.1
	if st := node.child("stroke"); st != nil {
		if w := st.child("width").floats(); len(w) > 0 {
			width = w[0]
		}
	} else if w := node.child("width").floats(); len(w) > 0 {
		width = w[0]
	}
	fill := "GFT_UNFILLED"
	if f := node.child("fill"); f != nil {
		if a := f.atoms(); len(a) > 0 && (a[0] == "yes" || a[0] == "solid") {
			fill = "GFT_FILLED"
		}
	}
	shape := map[string]any{"attributes": map[string]any{
		"stroke": map[string]any{"width": map[string]any{"valueNm": mmToNm(width)}},
		"fill":   map[string]any{"fillType": fill}}}
	xy := func(name string) ([]float64, error) {
		v := node.child(name).floats()
		if len(v) < 2 {
			return nil, fmt.Errorf("missing %s", name)
		}
		return v, nil
	}
	switch node.Name {
	case "fp_line":
		s, err := xy("start")
		if err != nil {
			return nil, err
		}
		e, err := xy("end")
		if err != nil {
			return nil, err
		}
		shape["segment"] = map[string]any{"start": pl.at(s[0], s[1]), "end": pl.at(e[0], e[1])}
	case "fp_rect":
		s, err := xy("start")
		if err != nil {
			return nil, err
		}
		e, err := xy("end")
		if err != nil {
			return nil, err
		}
		if pl.angle != 0 {
			// A rotated rectangle is not axis aligned: emit it as a polygon.
			corners := [][2]float64{{s[0], s[1]}, {e[0], s[1]}, {e[0], e[1]}, {s[0], e[1]}}
			var nodes []any
			for _, c := range corners {
				nodes = append(nodes, map[string]any{"point": pl.at(c[0], c[1])})
			}
			shape["polygon"] = map[string]any{"polygons": []any{map[string]any{
				"outline": map[string]any{"closed": true, "nodes": nodes}}}}
		} else {
			shape["rectangle"] = map[string]any{"topLeft": pl.at(s[0], s[1]), "bottomRight": pl.at(e[0], e[1])}
		}
	case "fp_circle":
		c, err := xy("center")
		if err != nil {
			return nil, err
		}
		e, err := xy("end")
		if err != nil {
			return nil, err
		}
		shape["circle"] = map[string]any{"center": pl.at(c[0], c[1]), "radiusPoint": pl.at(e[0], e[1])}
	}
	return map[string]any{"@type": "type.googleapis.com/kiapi.board.types.BoardGraphicShape",
		"shape": shape, "layer": layerEnum(layerNode.atoms()[0])}, nil
}

// placeFootprint creates one library footprint and reads it back.
func placeFootprint(ctx context.Context, dispatch Dispatcher, doc any, file, libID, reference, value string,
	pl placement, bottom bool) (map[string]any, error) {
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: err.Error()}
	}
	mod, err := parseSexpr(string(raw))
	if err != nil {
		return nil, &backend.Error{Code: "FOOTPRINT_PARSE_FAILED", Message: err.Error()}
	}
	fp, skipped, pads, err := buildFootprint(mod, libID, reference, value, pl)
	if err != nil {
		return nil, &backend.Error{Code: "FOOTPRINT_UNSUPPORTED", Message: err.Error()}
	}
	data, _, err := call(ctx, dispatch, "board.items.create", map[string]any{"document": doc,
		"items": []any{map[string]any{"type": "footprint", "json": fp}}})
	if err != nil {
		return nil, err
	}
	created := itemsOf(data)
	if len(created) != 1 || itemID(created[0]) == "" {
		return nil, &backend.Error{Code: "FOOTPRINT_CREATE_FAILED", Message: "KiCad returned no footprint"}
	}
	id := itemID(created[0])
	out := map[string]any{"id": id, "reference": reference, "file": file, "skipped": skipped,
		"xMm": nmToMm(pl.origin.X), "yMm": nmToMm(pl.origin.Y), "angleDeg": pl.angle}
	if bottom {
		if _, _, err := call(ctx, dispatch, "board.flip", map[string]any{"document": doc, "ids": []string{id}}); err != nil {
			out["flipError"] = err.Error()
		}
	}
	back, _, err := call(ctx, dispatch, "board.items.get_by_id", map[string]any{"document": doc, "ids": []string{id}})
	if err != nil {
		return out, &backend.Error{Code: "READBACK_FAILED", Message: err.Error()}
	}
	items := itemsOf(back)
	if len(items) != 1 {
		return out, &backend.Error{Code: "READBACK_FAILED", Message: "footprint not found after creation"}
	}
	gotPads := len(padsOf(items[0]))
	out["layer"] = argString(items[0], "layer")
	out["pads"] = gotPads
	if gotPads != pads || referenceOf(items[0]) != reference {
		return out, &backend.Error{Code: "FOOTPRINT_NOT_PERSISTED",
			Message: fmt.Sprintf("read back %d pads (want %d), reference %q (want %q)", gotPads, pads,
				referenceOf(items[0]), reference)}
	}
	if bottom && argString(items[0], "layer") != "BL_B_Cu" {
		return out, &backend.Error{Code: "FOOTPRINT_NOT_FLIPPED", Message: "footprint is not on the bottom layer"}
	}
	out["verified"] = true
	return out, nil
}

func footprintPlace(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.footprint.place"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	file, libID, err := resolveFootprintFile(p)
	if err != nil {
		return nil, err
	}
	pos, _ := p["position"].(map[string]any)
	if pos == nil {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "position {xMm,yMm} is required"}
	}
	reference := argString(p, "reference")
	if reference == "" {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "reference is required (e.g. TP1, H1, FID1)"}
	}
	pl := placement{origin: point{mmToNm(argFloat(pos, "xMm", 0)), mmToNm(argFloat(pos, "yMm", 0))},
		angle: argFloat(p, "angleDeg", 0)}
	if argBool(p, "dryRun", false) {
		return ok(action, map[string]any{"dryRun": true, "file": file, "reference": reference,
			"xMm": nmToMm(pl.origin.X), "yMm": nmToMm(pl.origin.Y)}), nil
	}
	out, err := placeFootprint(ctx, dispatch, doc, file, libID, reference, argString(p, "value"), pl,
		strings.EqualFold(argString(p, "side"), "bottom"))
	if err != nil {
		be := backend.ErrorFrom(err)
		return fail(action, be.Code, be.Message, out), nil
	}
	return ok(action, out), nil
}

// boardOutline returns the bounding box of the Edge.Cuts graphics.
func boardOutline(ctx context.Context, dispatch Dispatcher, doc any) (box, error) {
	data, _, err := call(ctx, dispatch, "board.items.get", map[string]any{"document": doc, "types": []string{"shape"}})
	if err != nil {
		return box{}, err
	}
	first := true
	var b box
	add := func(raw any) {
		m, _ := raw.(map[string]any)
		x, xok := numOK(m["xNm"])
		y, yok := numOK(m["yNm"])
		if !xok || !yok {
			return
		}
		if first {
			b, first = box{x, y, x, y}, false
			return
		}
		b = box{min(b.MinX, x), min(b.MinY, y), max(b.MaxX, x), max(b.MaxY, y)}
	}
	for _, item := range itemsOf(data) {
		if argString(item, "layer") != "BL_Edge_Cuts" {
			continue
		}
		shape, _ := item["shape"].(map[string]any)
		for _, key := range []string{"segment", "rectangle", "arc", "circle", "bezier"} {
			g, _ := shape[key].(map[string]any)
			for _, v := range g {
				add(v)
			}
		}
		if c, ok := shape["circle"].(map[string]any); ok {
			center, _ := c["center"].(map[string]any)
			rp, _ := c["radiusPoint"].(map[string]any)
			r := int64(math.Hypot(float64(num(rp["xNm"])-num(center["xNm"])), float64(num(rp["yNm"])-num(center["yNm"]))))
			add(map[string]any{"xNm": num(center["xNm"]) - r, "yNm": num(center["yNm"]) - r})
			add(map[string]any{"xNm": num(center["xNm"]) + r, "yNm": num(center["yNm"]) + r})
		}
		if poly, ok := shape["polygon"].(map[string]any); ok {
			list, _ := poly["polygons"].([]any)
			for _, pr := range list {
				pm, _ := pr.(map[string]any)
				outline, _ := pm["outline"].(map[string]any)
				nodes, _ := outline["nodes"].([]any)
				for _, nr := range nodes {
					nm, _ := nr.(map[string]any)
					add(nm["point"])
				}
			}
		}
	}
	if first || !b.valid() {
		return box{}, &backend.Error{Code: "NO_BOARD_OUTLINE", Message: "no Edge.Cuts outline found"}
	}
	return b, nil
}

// fiducialAdd places global fiducials at board corners (three by default, an
// asymmetric set so the assembly machine can detect orientation), avoiding
// existing footprints, then reads them back.
func fiducialAdd(ctx context.Context, p map[string]any, dispatch Dispatcher) (*backend.Result, error) {
	const action = "board.fiducial.add"
	doc, err := requireDocument(p)
	if err != nil {
		return nil, err
	}
	q := map[string]any{"libId": argString(p, "libId"), "file": argString(p, "file")}
	if q["libId"] == "" && q["file"] == "" {
		q["libId"] = "Fiducial:Fiducial_1mm_Mask2mm"
	}
	file, libID, err := resolveFootprintFile(q)
	if err != nil {
		return nil, err
	}
	count := int(argFloat(p, "count", 3))
	if count < 1 || count > 4 {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "count must be 1..4"}
	}
	inset := mmToNm(argFloat(p, "insetMm", 3))
	clearance := mmToNm(argFloat(p, "clearanceMm", 1.5))
	prefix := argString(p, "referencePrefix")
	if prefix == "" {
		prefix = "FID"
	}

	outline, err := boardOutline(ctx, dispatch, doc)
	if err != nil {
		return nil, err
	}
	fps, err := footprints(ctx, dispatch, doc)
	if err != nil {
		return nil, err
	}
	existing := 0
	maxIndex := 0
	var ids []string
	for _, fp := range fps {
		ref := referenceOf(fp)
		if strings.HasPrefix(strings.ToUpper(ref), prefix) {
			existing++
			var n int
			if _, err := fmt.Sscanf(ref[len(prefix):], "%d", &n); err == nil && n > maxIndex {
				maxIndex = n
			}
		}
		ids = append(ids, itemID(fp))
	}
	if existing > 0 && !argBool(p, "force", false) {
		return fail(action, "FIDUCIALS_EXIST", fmt.Sprintf("%d %s* footprints already exist; pass force=true to add more", existing, prefix),
			map[string]any{"existing": existing}), nil
	}
	boxes, err := itemBoxes(ctx, dispatch, doc, ids)
	if err != nil {
		return nil, err
	}
	keepClear := mmToNm(1.25) + clearance // fiducial courtyard radius + clearance

	corners := []struct {
		name   string
		at     point
		dx, dy int64
	}{
		{"top-left", point{outline.MinX + inset, outline.MinY + inset}, 1, 1},
		{"top-right", point{outline.MaxX - inset, outline.MinY + inset}, -1, 1},
		{"bottom-left", point{outline.MinX + inset, outline.MaxY - inset}, 1, -1},
		{"bottom-right", point{outline.MaxX - inset, outline.MaxY - inset}, -1, -1},
	}
	type site struct {
		Corner string  `json:"corner"`
		XMm    float64 `json:"xMm"`
		YMm    float64 `json:"yMm"`
		at     point
	}
	var sites []site
	var blocked []string
	for _, c := range corners[:count] {
		placed := false
		step := mmToNm(0.5)
		for i := 0; i < 40 && !placed; i++ {
			cand := point{c.at.X + c.dx*step*int64(i), c.at.Y + c.dy*step*int64(i)}
			fb := box{cand.X - keepClear, cand.Y - keepClear, cand.X + keepClear, cand.Y + keepClear}
			if !outline.contains(cand) {
				break
			}
			collision := false
			for _, b := range boxes {
				if fb.overlaps(b) {
					collision = true
					break
				}
			}
			if !collision {
				sites = append(sites, site{c.name, nmToMm(cand.X), nmToMm(cand.Y), cand})
				placed = true
			}
		}
		if !placed {
			blocked = append(blocked, c.name)
		}
	}
	result := map[string]any{"file": file, "outlineMm": map[string]float64{"x1": nmToMm(outline.MinX), "y1": nmToMm(outline.MinY),
		"x2": nmToMm(outline.MaxX), "y2": nmToMm(outline.MaxY)}, "sites": sites}
	if len(blocked) > 0 {
		result["blockedCorners"] = blocked
	}
	if argBool(p, "dryRun", false) {
		result["dryRun"] = true
		return ok(action, result), nil
	}
	var placed []map[string]any
	for i, s := range sites {
		ref := fmt.Sprintf("%s%d", prefix, maxIndex+i+1)
		out, err := placeFootprint(ctx, dispatch, doc, file, libID, ref, "", placement{origin: s.at}, strings.EqualFold(argString(p, "side"), "bottom"))
		if out != nil {
			placed = append(placed, out)
		}
		if err != nil {
			result["placed"] = placed
			be := backend.ErrorFrom(err)
			return fail(action, be.Code, ref+": "+be.Message, result), nil
		}
	}
	result["placed"] = placed
	if len(blocked) > 0 {
		return fail(action, "FIDUCIAL_SITES_BLOCKED", "no clear site near "+strings.Join(blocked, ", "), result), nil
	}
	result["verified"] = true
	result["next"] = "run board.drc.live to confirm courtyard and mask clearances"
	return ok(action, result), nil
}
