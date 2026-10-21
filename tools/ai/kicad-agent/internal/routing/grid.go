// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 The KiCad Developers, see AUTHORS.txt for contributors.

package routing

import (
	"container/heap"
	"context"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/zhoushoujianwork/easyeda-agent/kicad-agent/internal/backend"
)

type obstacleTrack struct {
	X1, Y1, X2, Y2 int64
	Width          int64
	Net            string
	Layer          string
}

type obstacleVia struct {
	X, Y, Diameter int64
	Net            string
}

type edgeCircle struct {
	X, Y, Radius int64
}

type obstacleArea struct {
	Points []point
	Layers []string
	Rule   bool
}

type grid struct {
	minX, minY int64
	pitch      int64
	nx, ny     int
	blocked    []bool
}

func newGrid(minX, minY, maxX, maxY, pitch int64) *grid {
	nx := int((maxX-minX)/pitch) + 1
	ny := int((maxY-minY)/pitch) + 1

	if nx < 1 {
		nx = 1
	}
	if ny < 1 {
		ny = 1
	}

	return &grid{
		minX: minX, minY: minY, pitch: pitch,
		nx: nx, ny: ny, blocked: make([]bool, nx*ny),
	}
}

func (g *grid) cellOf(x, y int64) (int, int) {
	ix := int((x - g.minX) / g.pitch)
	iy := int((y - g.minY) / g.pitch)

	if ix < 0 {
		ix = 0
	}
	if iy < 0 {
		iy = 0
	}
	if ix >= g.nx {
		ix = g.nx - 1
	}
	if iy >= g.ny {
		iy = g.ny - 1
	}

	return ix, iy
}

func (g *grid) center(ix, iy int) (int64, int64) {
	return g.minX + int64(ix)*g.pitch + g.pitch/2,
		g.minY + int64(iy)*g.pitch + g.pitch/2
}

func (g *grid) free(ix, iy int) bool {
	if ix < 0 || iy < 0 || ix >= g.nx || iy >= g.ny {
		return false
	}
	return !g.blocked[iy*g.nx+ix]
}

func (g *grid) block(ix, iy int) {
	if ix >= 0 && iy >= 0 && ix < g.nx && iy < g.ny {
		g.blocked[iy*g.nx+ix] = true
	}
}

func (g *grid) markCircle(cx, cy, radius int64) {
	x0, y0 := g.cellOf(cx-radius, cy-radius)
	x1, y1 := g.cellOf(cx+radius, cy+radius)
	r2 := float64(radius) * float64(radius)

	for iy := y0; iy <= y1; iy++ {
		for ix := x0; ix <= x1; ix++ {
			px, py := g.center(ix, iy)
			dx := float64(px - cx)
			dy := float64(py - cy)

			if dx*dx+dy*dy <= r2 {
				g.block(ix, iy)
			}
		}
	}
}

func (g *grid) markCapsule(x1, y1, x2, y2, radius int64) {
	minX := minInt64(minInt64(x1, x2)-radius, minInt64(x1, x2)-radius)
	maxX := maxInt64(maxInt64(x1, x2)+radius, maxInt64(x1, x2)+radius)
	minY := minInt64(minInt64(y1, y2)-radius, minInt64(y1, y2)-radius)
	maxY := maxInt64(maxInt64(y1, y2)+radius, maxInt64(y1, y2)+radius)

	ix0, iy0 := g.cellOf(minX, minY)
	ix1, iy1 := g.cellOf(maxX, maxY)

	for iy := iy0; iy <= iy1; iy++ {
		for ix := ix0; ix <= ix1; ix++ {
			px, py := g.center(ix, iy)

			if pointSegmentDistance(float64(px), float64(py),
				float64(x1), float64(y1), float64(x2), float64(y2)) <= float64(radius) {
				g.block(ix, iy)
			}
		}
	}
}

func (g *grid) markRing(cx, cy, radius, band int64) {
	x0, y0 := g.cellOf(cx-radius-band, cy-radius-band)
	x1, y1 := g.cellOf(cx+radius+band, cy+radius+band)

	for iy := y0; iy <= y1; iy++ {
		for ix := x0; ix <= x1; ix++ {
			px, py := g.center(ix, iy)
			d := math.Hypot(float64(px-cx), float64(py-cy))

			if math.Abs(d-float64(radius)) <= float64(band) {
				g.block(ix, iy)
			}
		}
	}
}

func (g *grid) markPolygon(points []point) {
	if len(points) < 3 {
		return
	}

	minX, minY, maxX, maxY := points[0].X, points[0].Y, points[0].X, points[0].Y

	for _, p := range points {
		minX = minInt64(minX, p.X)
		minY = minInt64(minY, p.Y)
		maxX = maxInt64(maxX, p.X)
		maxY = maxInt64(maxY, p.Y)
	}

	x0, y0 := g.cellOf(minX, minY)
	x1, y1 := g.cellOf(maxX, maxY)

	for iy := y0; iy <= y1; iy++ {
		for ix := x0; ix <= x1; ix++ {
			px, py := g.center(ix, iy)

			if pointInPolygon(float64(px), float64(py), points) {
				g.block(ix, iy)
			}
		}
	}
}

func pointInPolygon(x, y float64, points []point) bool {
	inside := false

	for i, j := 0, len(points)-1; i < len(points); j, i = i, i+1 {
		xi, yi := float64(points[i].X), float64(points[i].Y)
		xj, yj := float64(points[j].X), float64(points[j].Y)

		if (yi > y) != (yj > y) &&
			x < (xj-xi)*(y-yi)/(yj-yi)+xi {
			inside = !inside
		}
	}

	return inside
}

func pointSegmentDistance(px, py, x1, y1, x2, y2 float64) float64 {
	dx := x2 - x1
	dy := y2 - y1

	if dx == 0 && dy == 0 {
		return math.Hypot(px-x1, py-y1)
	}

	t := ((px-x1)*dx + (py-y1)*dy) / (dx*dx + dy*dy)
	t = math.Max(0, math.Min(1, t))

	return math.Hypot(px-(x1+t*dx), py-(y1+t*dy))
}

func (g *grid) findFree(ix, iy, radius int) (int, int, bool) {
	if g.free(ix, iy) {
		return ix, iy, true
	}

	for r := 1; r <= radius; r++ {
		for dy := -r; dy <= r; dy++ {
			for dx := -r; dx <= r; dx++ {
				if int(math.Abs(float64(dx))) != r && int(math.Abs(float64(dy))) != r {
					continue
				}
				if g.free(ix+dx, iy+dy) {
					return ix + dx, iy + dy, true
				}
			}
		}
	}

	return ix, iy, false
}

type pqNode struct {
	idx int
	f   float64
}

type priorityQueue []pqNode

func (p priorityQueue) Len() int           { return len(p) }
func (p priorityQueue) Less(i, j int) bool { return p[i].f < p[j].f }
func (p priorityQueue) Swap(i, j int)      { p[i], p[j] = p[j], p[i] }
func (p *priorityQueue) Push(x any)        { *p = append(*p, x.(pqNode)) }
func (p *priorityQueue) Pop() any {
	old := *p
	n := len(old)
	item := old[n-1]
	*p = old[:n-1]
	return item
}

func octile(dx, dy int) float64 {
	ax := math.Abs(float64(dx))
	ay := math.Abs(float64(dy))
	return ax + ay + (math.Sqrt2-2)*math.Min(ax, ay)
}

// astar returns a simplified path in board coordinates (nm).
func (g *grid) astar(sx, sy, ex, ey int64, maxExpansions int) ([]point, int, error) {
	sxi, syi := g.cellOf(sx, sy)
	exi, eyi := g.cellOf(ex, ey)

	sxi, syi, ok := g.findFree(sxi, syi, 8)
	if !ok {
		return nil, 0, fmt.Errorf("start cell is blocked")
	}

	exi, eyi, ok = g.findFree(exi, eyi, 8)
	if !ok {
		return nil, 0, fmt.Errorf("end cell is blocked")
	}

	start := syi*g.nx + sxi
	goal := eyi*g.nx + exi
	total := g.nx * g.ny

	gScore := make([]float64, total)
	came := make([]int32, total)
	closed := make([]bool, total)

	for i := 0; i < total; i++ {
		gScore[i] = math.Inf(1)
		came[i] = -1
	}

	gScore[start] = 0

	pq := &priorityQueue{{idx: start, f: octile(exi-sxi, eyi-syi)}}
	heap.Init(pq)

	dirs := [8][2]int{
		{1, 0}, {-1, 0}, {0, 1}, {0, -1},
		{1, 1}, {1, -1}, {-1, 1}, {-1, -1},
	}

	expanded := 0

	for pq.Len() > 0 {
		cur := heap.Pop(pq).(pqNode)

		if closed[cur.idx] {
			continue
		}

		closed[cur.idx] = true
		expanded++

		if cur.idx == goal {
			break
		}
		if expanded > maxExpansions {
			return nil, expanded, fmt.Errorf("expanded %d cells without reaching the goal", expanded)
		}

		cx := cur.idx % g.nx
		cy := cur.idx / g.nx

		for d, dir := range dirs {
			nx := cx + dir[0]
			ny := cy + dir[1]

			if !g.free(nx, ny) {
				continue
			}

			if d >= 4 {
				if !g.free(cx+dir[0], cy) || !g.free(cx, cy+dir[1]) {
					continue
				}
			}

			ni := ny*g.nx + nx

			if closed[ni] {
				continue
			}

			step := 1.0
			if d >= 4 {
				step = math.Sqrt2
			}

			tentative := gScore[cur.idx] + step

			if tentative < gScore[ni] {
				gScore[ni] = tentative
				came[ni] = int32(cur.idx)

				heap.Push(pq, pqNode{idx: ni, f: tentative + octile(exi-nx, eyi-ny)})
			}
		}
	}

	if goal != start && came[goal] == -1 {
		return nil, expanded, fmt.Errorf("no path")
	}

	var cells []int

	for at := goal; at != -1; at = int(came[at]) {
		cells = append(cells, at)
		if at == start {
			break
		}
	}

	for i, j := 0, len(cells)-1; i < j; i, j = i+1, j-1 {
		cells[i], cells[j] = cells[j], cells[i]
	}

	points := make([]point, 0, len(cells)+2)

	if cells[0] != start {
		points = append(points, point{X: sx, Y: sy})
	}

	for _, idx := range cells {
		x, y := g.center(idx%g.nx, idx/g.nx)
		points = append(points, point{X: x, Y: y})
	}

	if len(points) == 0 || points[len(points)-1] != (point{X: ex, Y: ey}) {
		points = append(points, point{X: ex, Y: ey})
	}

	return simplifyPoints(points), expanded, nil
}

func simplifyPoints(points []point) []point {
	if len(points) <= 2 {
		return points
	}

	out := []point{points[0]}

	for i := 1; i+1 < len(points); i++ {
		a := out[len(out)-1]
		b := points[i]
		c := points[i+1]

		abx := b.X - a.X
		aby := b.Y - a.Y
		bcx := c.X - b.X
		bcy := c.Y - b.Y

		if abx*bcy == aby*bcx {
			continue
		}

		out = append(out, b)
	}

	out = append(out, points[len(points)-1])
	return out
}

type obstacleGeometry struct {
	Pads    []Pad
	Tracks  []obstacleTrack
	Vias    []obstacleVia
	Edges   []obstacleTrack
	Circles []edgeCircle
	Areas   []obstacleArea
}

func loadObstacleGeometry(ctx context.Context, dispatch Dispatcher, document any) (
	*obstacleGeometry, error) {
	res, err := dispatch(ctx, "board.items.get", map[string]any{
		"document": document,
		"types": []string{"KOT_PCB_FOOTPRINT", "KOT_PCB_TRACE", "KOT_PCB_VIA",
			"KOT_PCB_SHAPE", "KOT_PCB_ZONE"},
	})
	if err != nil {
		return nil, err
	}
	if res == nil || !res.OK {
		return nil, &backend.Error{Code: "GET_ITEMS_FAILED",
			Message: "failed to read board geometry"}
	}

	data, _ := res.Data.(map[string]any)
	items, _ := data["items"].([]any)

	geometry := &obstacleGeometry{}

	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		typeName := argString(item, "@type")

		switch {
		case strings.HasSuffix(typeName, ".FootprintInstance"):
			geometry.Pads = append(geometry.Pads, padsOfFootprint(item)...)
			geometry.addFootprintEdges(item)
		case strings.HasSuffix(typeName, ".Track"):
			start, _ := item["start"].(map[string]any)
			end, _ := item["end"].(map[string]any)
			width, _ := item["width"].(map[string]any)
			net, _ := item["net"].(map[string]any)

			geometry.Tracks = append(geometry.Tracks, obstacleTrack{
				X1: numeric(start["xNm"]), Y1: numeric(start["yNm"]),
				X2: numeric(end["xNm"]), Y2: numeric(end["yNm"]),
				Width: numeric(width["valueNm"]), Net: argString(net, "name"),
				Layer: argString(item, "layer"),
			})
		case strings.HasSuffix(typeName, ".BoardGraphicShape"):
			geometry.addShape(item)

		case strings.HasSuffix(typeName, ".Zone"):
			geometry.addZone(item)

		case strings.HasSuffix(typeName, ".Via"):
			pos, _ := item["position"].(map[string]any)
			net, _ := item["net"].(map[string]any)
			padStack, _ := item["padStack"].(map[string]any)
			diameter := int64(0)

			if copperLayers, ok := padStack["copperLayers"].([]any); ok && len(copperLayers) > 0 {
				if first, ok := copperLayers[0].(map[string]any); ok {
					if size, ok := first["size"].(map[string]any); ok {
						diameter = maxInt64(numeric(size["xNm"]), numeric(size["yNm"]))
					}
				}
			}
			if diameter == 0 {
				if drill, ok := padStack["drill"].(map[string]any); ok {
					if d, ok := drill["diameter"].(map[string]any); ok {
						diameter = maxInt64(numeric(d["xNm"]), numeric(d["yNm"]))
					}
				}
			}

			geometry.Vias = append(geometry.Vias, obstacleVia{
				X: numeric(pos["xNm"]), Y: numeric(pos["yNm"]),
				Diameter: diameter, Net: argString(net, "name"),
			})
		}
	}

	return geometry, nil
}

func (g *obstacleGeometry) addFootprintEdges(footprint map[string]any) {
	definition, _ := footprint["definition"].(map[string]any)
	items, _ := definition["items"].([]any)

	for _, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		if !strings.HasSuffix(argString(item, "@type"), ".BoardGraphicShape") {
			continue
		}

		if strings.HasSuffix(argString(item, "layer"), "_Edge_Cuts") {
			g.addShape(item)
		}
	}
}

func (g *obstacleGeometry) addShape(item map[string]any) {
	layer := argString(item, "layer")

	if !strings.HasSuffix(layer, "_Edge_Cuts") && layer != "BL_Edge_Cuts" {
		return
	}

	shape, _ := item["shape"].(map[string]any)

	addSegment := func(a, b any) {
		start, okStart := a.(map[string]any)
		end, okEnd := b.(map[string]any)

		if !okStart || !okEnd {
			return
		}

		g.Edges = append(g.Edges, obstacleTrack{
			X1: numeric(start["xNm"]), Y1: numeric(start["yNm"]),
			X2: numeric(end["xNm"]), Y2: numeric(end["yNm"]),
		})
	}

	if segment, ok := shape["segment"].(map[string]any); ok {
		addSegment(segment["start"], segment["end"])
	}

	if rectangle, ok := shape["rectangle"].(map[string]any); ok {
		tl, _ := rectangle["topLeft"].(map[string]any)
		br, _ := rectangle["bottomRight"].(map[string]any)

		if tl != nil && br != nil {
			x1, y1 := numeric(tl["xNm"]), numeric(tl["yNm"])
			x2, y2 := numeric(br["xNm"]), numeric(br["yNm"])

			g.Edges = append(g.Edges,
				obstacleTrack{X1: x1, Y1: y1, X2: x2, Y2: y1},
				obstacleTrack{X1: x2, Y1: y1, X2: x2, Y2: y2},
				obstacleTrack{X1: x2, Y1: y2, X2: x1, Y2: y2},
				obstacleTrack{X1: x1, Y1: y2, X2: x1, Y2: y1})
		}
	}

	if arc, ok := shape["arc"].(map[string]any); ok {
		addSegment(arc["start"], arc["mid"])
		addSegment(arc["mid"], arc["end"])
	}

	if circle, ok := shape["circle"].(map[string]any); ok {
		center, _ := circle["center"].(map[string]any)
		radiusPoint, _ := circle["radiusPoint"].(map[string]any)

		if center != nil && radiusPoint != nil {
			cx, cy := numeric(center["xNm"]), numeric(center["yNm"])
			rx, ry := numeric(radiusPoint["xNm"]), numeric(radiusPoint["yNm"])

			g.Circles = append(g.Circles, edgeCircle{
				X: cx, Y: cy, Radius: int64(math.Hypot(float64(rx-cx), float64(ry-cy))),
			})
		}
	}

	if polygon, ok := shape["polygon"].(map[string]any); ok {
		if points := polygonPoints(polygon); len(points) > 1 {
			for i := 0; i+1 < len(points); i++ {
				g.Edges = append(g.Edges, obstacleTrack{
					X1: points[i].X, Y1: points[i].Y,
					X2: points[i+1].X, Y2: points[i+1].Y,
				})
			}
			g.Edges = append(g.Edges, obstacleTrack{
				X1: points[len(points)-1].X, Y1: points[len(points)-1].Y,
				X2: points[0].X, Y2: points[0].Y,
			})
		}
	}
}

func (g *obstacleGeometry) addZone(item map[string]any) {
	if _, isRule := item["ruleAreaSettings"]; !isRule {
		return
	}

	outline, _ := item["outline"].(map[string]any)
	points := polygonPoints(outline)

	if len(points) < 3 {
		return
	}

	area := obstacleArea{Points: points, Rule: true}
	layers, _ := item["layers"].([]any)

	for _, raw := range layers {
		if name, ok := raw.(string); ok {
			area.Layers = append(area.Layers, name)
		}
	}

	g.Areas = append(g.Areas, area)
}

func polygonPoints(polygon map[string]any) []point {
	polys, _ := polygon["polygons"].([]any)
	var points []point

	for _, raw := range polys {
		poly, ok := raw.(map[string]any)
		if !ok {
			continue
		}

		outline, _ := poly["outline"].(map[string]any)
		nodes, _ := outline["nodes"].([]any)

		for _, rawNode := range nodes {
			node, ok := rawNode.(map[string]any)
			if !ok {
				continue
			}

			if pt, ok := node["point"].(map[string]any); ok {
				points = append(points, point{X: numeric(pt["xNm"]), Y: numeric(pt["yNm"])})
			}

			if arc, ok := node["arc"].(map[string]any); ok {
				for _, key := range []string{"start", "mid", "end"} {
					if pt, ok := arc[key].(map[string]any); ok {
						points = append(points, point{X: numeric(pt["xNm"]), Y: numeric(pt["yNm"])})
					}
				}
			}
		}

		break // the primary outline; holes do not matter for a keepout
	}

	return points
}

func padsOfFootprint(item map[string]any) []Pad {
	definition, _ := item["definition"].(map[string]any)
	items, _ := definition["items"].([]any)
	ref := referenceOf(item)

	var pads []Pad

	for _, raw := range items {
		padItem, ok := raw.(map[string]any)
		if !ok || !strings.HasSuffix(argString(padItem, "@type"), ".Pad") {
			continue
		}

		pos, _ := padItem["position"].(map[string]any)
		padStack, _ := padItem["padStack"].(map[string]any)
		layers, _ := padStack["layers"].([]any)
		copperLayers, _ := padStack["copperLayers"].([]any)

		layer := "BL_F_Cu"
		var padLayers []string

		for _, rawLayer := range layers {
			if name, ok := rawLayer.(string); ok && strings.HasSuffix(name, "_Cu") {
				padLayers = append(padLayers, name)

				if layer == "BL_F_Cu" {
					layer = name
				}
			}
		}

		if len(padLayers) == 0 {
			padLayers = []string{layer}
		}

		var sizeX, sizeY int64
		if len(copperLayers) > 0 {
			if first, ok := copperLayers[0].(map[string]any); ok {
				if size, ok := first["size"].(map[string]any); ok {
					sizeX = numeric(size["xNm"])
					sizeY = numeric(size["yNm"])
				}
			}
		}

		net, _ := padItem["net"].(map[string]any)

		x, xok := numericOK(pos["xNm"])
		y, yok := numericOK(pos["yNm"])

		pads = append(pads, Pad{
			Ref: ref, Number: argString(padItem, "number"),
			Net: argString(net, "name"), Layer: layer, Layers: padLayers,
			X: x, Y: y, SizeX: sizeX, SizeY: sizeY,
			HasPosition: xok && yok,
		})
	}

	return pads
}

func defaultGridLayers(enabled []string) []string {
	var layers []string

	for _, want := range []string{"F.Cu", "B.Cu"} {
		for _, name := range enabled {
			if strings.EqualFold(name, want) {
				layers = append(layers, name)
				break
			}
		}
	}

	if len(layers) < 2 {
		if len(enabled) >= 2 {
			return enabled[:2]
		}
		return enabled
	}

	return layers
}

func areaOnLayer(area obstacleArea, layer string) bool {
	if len(area.Layers) == 0 {
		return true
	}

	for _, name := range area.Layers {
		if strings.EqualFold(name, layer) {
			return true
		}
	}

	return false
}

func protoLayer(name string) string {
	name = strings.TrimSpace(name)

	if strings.Contains(name, ".") {
		parts := strings.SplitN(name, ".", 2)
		return "BL_" + parts[0] + "_" + parts[1]
	}

	return name
}

func gridAutoroute(ctx context.Context, p map[string]any, dispatch Dispatcher,
	document any) (*backend.Result, error) {
	dryRun := true
	if v, ok := p["dryRun"].(bool); ok {
		dryRun = v
	}

	widthMm := argFloatDefault(p, "widthMm", 0.25)
	clearanceMm := argFloatDefault(p, "clearanceMm", 0.2)
	gridMm := argFloatDefault(p, "gridMm", 0.25)

	layerName := argString(p, "layer")
	layersParam := argStrings(p, "layers")

	if layerName != "" {
		layersParam = []string{layerName}
	}

	if len(layersParam) == 0 {
		enabled := enabledCopperLayers(ctx, dispatch, document)
		layersParam = defaultGridLayers(enabled)
	}

	geometry, err := loadObstacleGeometry(ctx, dispatch, document)
	if err != nil {
		return nil, err
	}

	if len(layersParam) > 1 {
		return gridAutorouteMulti(ctx, p, dispatch, document, geometry, layersParam)
	}

	layerName = layersParam[0]

	if widthMm <= 0 || clearanceMm < 0 || gridMm <= 0 {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "widthMm and gridMm must be positive; clearanceMm must not be negative"}
	}
	if math.IsNaN(widthMm) || math.IsInf(widthMm, 0) ||
		math.IsNaN(gridMm) || math.IsInf(gridMm, 0) {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "dimensions must be finite"}
	}

	widthNm := int64(math.Round(widthMm * 1e6))
	clearanceNm := int64(math.Round(clearanceMm * 1e6))
	pitch := int64(math.Round(gridMm * 1e6))
	if pitch < 100000 {
		pitch = 100000
	}

	pads, tracks, vias := geometry.Pads, geometry.Tracks, geometry.Vias

	if len(pads) == 0 {
		return nil, &backend.Error{Code: "NO_PADS", Message: "no pads found on the board"}
	}

	minX, minY := pads[0].X, pads[0].Y
	maxX, maxY := pads[0].X, pads[0].Y

	addBox := func(x, y int64) {
		minX = minInt64(minX, x)
		minY = minInt64(minY, y)
		maxX = maxInt64(maxX, x)
		maxY = maxInt64(maxY, y)
	}

	for _, pad := range pads {
		addBox(pad.X, pad.Y)
	}
	for _, track := range tracks {
		addBox(track.X1, track.Y1)
		addBox(track.X2, track.Y2)
	}
	for _, via := range vias {
		addBox(via.X, via.Y)
	}

	margin := int64(2_000_000)
	minX -= margin
	minY -= margin
	maxX += margin
	maxY += margin

	padsByNet := map[string][]Pad{}

	for _, pad := range pads {
		if pad.Net == "" || pad.Layer != protoLayer(layerName) {
			continue
		}
		padsByNet[pad.Net] = append(padsByNet[pad.Net], pad)
	}

	wanted := stringSet(p["nets"])

	var netNames []string

	for net := range padsByNet {
		if len(wanted) > 0 && !wanted[net] {
			continue
		}
		netNames = append(netNames, net)
	}

	sort.Strings(netNames)

	result := &Result{
		Planner: "grid", PitchMm: float64(pitch) / 1e6,
		ClearanceMm: clearanceMm, DryRun: dryRun, Verified: false,
		Note: "grid A* router; single layer; run DRC after routing",
	}

	var items []any
	var extraTracks []obstacleTrack

	const maxCells = 4000000

	for _, net := range netNames {
		netPads := padsByNet[net]

		if len(netPads) < 2 {
			result.Nets = append(result.Nets, NetResult{
				Net: net, PadCount: len(netPads), Reason: "fewer than two pads"})
			continue
		}

		// Rebuild the grid for this net.  Same-net copper is not an obstacle.
		g := newGrid(minX, minY, maxX, maxY, pitch)
		if g.nx*g.ny > maxCells {
			result.Nets = append(result.Nets, NetResult{
				Net: net, PadCount: len(netPads),
				Reason: fmt.Sprintf("grid too large (%d cells); increase gridMm", g.nx*g.ny)})
			continue
		}

		for _, pad := range pads {
			if pad.Net == net || pad.Layer != protoLayer(layerName) {
				continue
			}
			radius := maxInt64(pad.SizeX, pad.SizeY)/2 + clearanceNm
			g.markCircle(pad.X, pad.Y, radius)
		}

		for _, track := range tracks {
			if track.Net == net || track.Layer != protoLayer(layerName) {
				continue
			}
			g.markCapsule(track.X1, track.Y1, track.X2, track.Y2,
				track.Width/2+clearanceNm)
		}

		for _, via := range vias {
			if via.Net == net {
				continue
			}
			g.markCircle(via.X, via.Y, via.Diameter/2+clearanceNm)
		}

		// Board edges and rule areas are obstacles for every net.
		edgeRadius := clearanceNm + widthNm/2

		for _, edge := range geometry.Edges {
			g.markCapsule(edge.X1, edge.Y1, edge.X2, edge.Y2, edgeRadius)
		}

		for _, circle := range geometry.Circles {
			if circle.Radius > 0 {
				g.markRing(circle.X, circle.Y, circle.Radius, edgeRadius)
			}
		}

		for _, area := range geometry.Areas {
			if areaOnLayer(area, protoLayer(layerName)) {
				g.markPolygon(area.Points)
			}
		}

		for _, track := range extraTracks {
			if track.Net == net || track.Layer != protoLayer(layerName) {
				continue
			}
			g.markCapsule(track.X1, track.Y1, track.X2, track.Y2,
				track.Width/2+clearanceNm)
		}

		sort.Slice(netPads, func(i, j int) bool {
			if netPads[i].X != netPads[j].X {
				return netPads[i].X < netPads[j].X
			}
			return netPads[i].Y < netPads[j].Y
		})

		nr := NetResult{Net: net, PadCount: len(netPads)}

		for i := 0; i+1 < len(netPads); i++ {
			a, b := netPads[i], netPads[i+1]
			path, expanded, err := g.astar(a.X, a.Y, b.X, b.Y, 2000000)
			nr.Expanded += expanded

			if err != nil {
				nr.Skipped++
				nr.Reason = err.Error()
				continue
			}

			nr.PathCells += len(path)

			for j := 0; j+1 < len(path); j++ {
				items = append(items, trackItem(path[j], path[j+1], widthNm,
					protoLayer(layerName), net))
				extraTracks = append(extraTracks, obstacleTrack{
					X1: path[j].X, Y1: path[j].Y, X2: path[j+1].X, Y2: path[j+1].Y,
					Width: widthNm, Net: net, Layer: protoLayer(layerName),
				})
			}

			nr.Routed++
		}

		result.Nets = append(result.Nets, nr)
	}

	result.Planner = "grid"

	if len(items) == 0 {
		out := &backend.Result{Action: "board.route.autoroute", OK: false, Data: result}
		out.Error = &backend.Error{Code: "ROUTE_NO_TRACKS",
			Message: "the grid router found no routable paths"}
		return out, nil
	}

	if dryRun {
		return &backend.Result{Action: "board.route.autoroute", OK: true, Data: result}, nil
	}

	apply(ctx, dispatch, document, items, result)
	return routeResult("board.route.autoroute", result), nil
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
