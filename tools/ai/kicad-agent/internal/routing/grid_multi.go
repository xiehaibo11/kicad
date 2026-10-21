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

type gridNode struct {
	X, Y  int64
	Layer int
}

// enabledCopperLayers asks the live board which copper layers exist.  A failed
// query falls back to the two outer layers, which exist on every board.
func enabledCopperLayers(ctx context.Context, dispatch Dispatcher, document any) []string {
	res, err := dispatch(ctx, "board.layers.get", map[string]any{"document": document})
	if err != nil || res == nil {
		return []string{"F.Cu", "B.Cu"}
	}

	data, _ := res.Data.(map[string]any)
	raw, _ := data["layers"].([]any)

	var layers []string

	for _, item := range raw {
		name, ok := item.(string)
		if !ok || !strings.HasPrefix(name, "BL_") || !strings.HasSuffix(name, "_Cu") {
			continue
		}

		name = strings.TrimPrefix(name, "BL_")
		name = strings.ReplaceAll(name, "_", ".")

		if name == "F.Cu" || name == "B.Cu" || strings.HasPrefix(name, "In") {
			layers = append(layers, name)
		}
	}

	if len(layers) < 2 {
		return []string{"F.Cu", "B.Cu"}
	}

	sort.SliceStable(layers, func(i, j int) bool {
		order := func(name string) int {
			switch name {
			case "F.Cu":
				return -1
			case "B.Cu":
				return 1000
			}
			return 0
		}
		if order(layers[i]) != order(layers[j]) {
			return order(layers[i]) < order(layers[j])
		}
		return layers[i] < layers[j]
	})

	return layers
}

func padOnLayer(pad Pad, layer string) bool {
	if len(pad.Layers) == 0 {
		return strings.EqualFold(pad.Layer, layer)
	}

	for _, name := range pad.Layers {
		if strings.EqualFold(name, layer) {
			return true
		}
	}

	return false
}

func padLayerIndex(pad Pad, layers []string) int {
	for i, layer := range layers {
		if padOnLayer(pad, protoLayer(layer)) {
			return i
		}
	}
	return 0
}

func markLayerObstacles(g *grid, layer string, geometry *obstacleGeometry, net string,
	clearanceNm, widthNm, viaDiameterNm int64) {
	half := maxInt64(widthNm, viaDiameterNm) / 2
	padRadius := clearanceNm + half

	for _, pad := range geometry.Pads {
		if pad.Net == net || !pad.HasPosition || !padOnLayer(pad, layer) {
			continue
		}

		g.markCircle(pad.X, pad.Y, maxInt64(pad.SizeX, pad.SizeY)/2+padRadius)
	}

	for _, track := range geometry.Tracks {
		if track.Net == net || !strings.EqualFold(track.Layer, layer) {
			continue
		}

		g.markCapsule(track.X1, track.Y1, track.X2, track.Y2, track.Width/2+padRadius)
	}

	for _, via := range geometry.Vias {
		if via.Net == net {
			continue
		}

		g.markCircle(via.X, via.Y, via.Diameter/2+padRadius)
	}

	for _, edge := range geometry.Edges {
		g.markCapsule(edge.X1, edge.Y1, edge.X2, edge.Y2, padRadius)
	}

	for _, circle := range geometry.Circles {
		if circle.Radius > 0 {
			g.markRing(circle.X, circle.Y, circle.Radius, padRadius)
		}
	}

	for _, area := range geometry.Areas {
		if !areaOnLayer(area, layer) {
			continue
		}

		g.markPolygon(area.Points)

		for i := 0; i < len(area.Points); i++ {
			a := area.Points[i]
			b := area.Points[(i+1)%len(area.Points)]
			g.markCapsule(a.X, a.Y, b.X, b.Y, padRadius)
		}
	}
}

func astar3D(grids []*grid, startLayer, goalLayer int, sx, sy, ex, ey int64,
	maxExpansions int) ([]gridNode, int, error) {
	if len(grids) == 0 {
		return nil, 0, fmt.Errorf("no routing layers")
	}

	g0 := grids[0]
	cells := g0.nx * g0.ny
	total := cells * len(grids)

	if total > 8_000_000 {
		return nil, 0, fmt.Errorf("grid is too large (%d cells); increase gridMm", total)
	}

	sxi, syi := g0.cellOf(sx, sy)
	exi, eyi := g0.cellOf(ex, ey)

	sxi, syi, ok := grids[startLayer].findFree(sxi, syi, 8)
	if !ok {
		return nil, 0, fmt.Errorf("start cell is blocked")
	}

	exi, eyi, ok = grids[goalLayer].findFree(exi, eyi, 8)
	if !ok {
		return nil, 0, fmt.Errorf("end cell is blocked")
	}

	start := startLayer*cells + syi*g0.nx + sxi
	goal := goalLayer*cells + eyi*g0.nx + exi

	gScore := make([]float64, total)
	came := make([]int32, total)
	closed := make([]bool, total)

	for i := range gScore {
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

	const viaCost = 8.0

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

		layer := cur.idx / cells
		cell := cur.idx % cells
		cx := cell % g0.nx
		cy := cell / g0.nx

		for d, dir := range dirs {
			nx := cx + dir[0]
			ny := cy + dir[1]

			if !grids[layer].free(nx, ny) {
				continue
			}

			if d >= 4 && (!grids[layer].free(cx+dir[0], cy) || !grids[layer].free(cx, cy+dir[1])) {
				continue
			}

			ni := layer*cells + ny*g0.nx + nx
			step := 1.0
			if d >= 4 {
				step = math.Sqrt2
			}
			ng := gScore[cur.idx] + step

			if ng < gScore[ni] {
				gScore[ni] = ng
				came[ni] = int32(cur.idx)
				heap.Push(pq, pqNode{idx: ni, f: ng + octile(exi-nx, eyi-ny)})
			}
		}

		// A through via at this cell requires the cell to be free on every
		// selected layer.  The per-layer obstruction radius already includes
		// the via annulus.
		allFree := true

		for _, g := range grids {
			if !g.free(cx, cy) {
				allFree = false
				break
			}
		}

		if !allFree {
			continue
		}

		for other := 0; other < len(grids); other++ {
			if other == layer {
				continue
			}

			ni := other*cells + cell
			ng := gScore[cur.idx] + viaCost

			if ng < gScore[ni] {
				gScore[ni] = ng
				came[ni] = int32(cur.idx)
				heap.Push(pq, pqNode{idx: ni, f: ng + octile(exi-cx, eyi-cy)})
			}
		}
	}

	if came[goal] < 0 && goal != start {
		return nil, expanded, fmt.Errorf("no path found")
	}

	var reversed []gridNode

	for at := int32(goal); at >= 0; at = came[at] {
		layer := int(at) / cells
		cell := int(at) % cells
		x, y := g0.center(cell%g0.nx, cell/g0.nx)
		reversed = append(reversed, gridNode{X: x, Y: y, Layer: layer})

		if int(at) == start {
			break
		}
	}

	path := make([]gridNode, 0, len(reversed))

	for i := len(reversed) - 1; i >= 0; i-- {
		path = append(path, reversed[i])
	}

	// Anchor the path at the real pad positions.
	if len(path) > 0 {
		path[0].X, path[0].Y = sx, sy
		path[len(path)-1].X, path[len(path)-1].Y = ex, ey
	}

	return path, expanded, nil
}

func viaItem(node gridNode, net string, drillNm, diameterNm int64) map[string]any {
	return map[string]any{
		"type": "via",
		"json": map[string]any{
			"position": map[string]any{"x_nm": node.X, "y_nm": node.Y},
			"net":      map[string]any{"name": net},
			"padStack": map[string]any{
				"type": "PST_NORMAL",
				"drill": map[string]any{
					"diameter":   map[string]any{"x_nm": drillNm, "y_nm": drillNm},
					"startLayer": "BL_F_Cu",
					"endLayer":   "BL_B_Cu",
					"shape":      "DS_CIRCLE",
				},
				"copperLayers": []any{
					map[string]any{
						"layer": "BL_F_Cu",
						"shape": "PSS_CIRCLE",
						"size":  map[string]any{"x_nm": diameterNm, "y_nm": diameterNm},
					},
				},
				"layers": []any{"BL_F_Cu", "BL_B_Cu"},
			},
		},
	}
}

// pathItems converts a 3D path into track and via items, simplifying
// collinear points within each layer run.
func pathItems(path []gridNode, layers []string, net string, widthNm, drillNm, diameterNm int64) (
	[]any, int, int) {
	var items []any
	vias := 0
	tracks := 0

	if len(path) < 2 {
		return items, vias, tracks
	}

	// Split the path into constant-layer runs, simplify each run to its
	// direction-change points, then emit tracks.
	runStart := 0

	emitRun := func(end int) {
		if end-runStart < 1 {
			return
		}

		layer := protoLayer(layers[path[runStart].Layer])
		run := path[runStart : end+1]

		points := []gridNode{run[0]}

		for i := 1; i+1 < len(run); i++ {
			a, b, c := run[i-1], run[i], run[i+1]
			cross := (b.X-a.X)*(c.Y-b.Y) - (b.Y-a.Y)*(c.X-b.X)
			dot := (b.X-a.X)*(c.X-b.X) + (b.Y-a.Y)*(c.Y-b.Y)

			if cross != 0 || dot <= 0 {
				points = append(points, b)
			}
		}

		points = append(points, run[len(run)-1])

		for i := 0; i+1 < len(points); i++ {
			a, b := points[i], points[i+1]
			if a.X == b.X && a.Y == b.Y {
				continue
			}

			items = append(items, trackItem(point{X: a.X, Y: a.Y}, point{X: b.X, Y: b.Y},
				widthNm, layer, net))
			tracks++
		}
	}

	for i := 1; i < len(path); i++ {
		if path[i].Layer != path[i-1].Layer {
			emitRun(i - 1)
			items = append(items, viaItem(path[i], net, drillNm, diameterNm))
			vias++
			runStart = i
		}
	}

	emitRun(len(path) - 1)

	return items, vias, tracks
}

func gridAutorouteMulti(ctx context.Context, p map[string]any, dispatch Dispatcher, document any,
	geometry *obstacleGeometry, layers []string) (*backend.Result, error) {
	widthMm := argFloatDefault(p, "widthMm", 0.25)
	clearanceMm := argFloatDefault(p, "clearanceMm", 0.2)
	gridMm := argFloatDefault(p, "gridMm", 0.25)
	drillMm := argFloatDefault(p, "drillMm", 0.3)
	diameterMm := argFloatDefault(p, "diameterMm", 0.6)

	if widthMm <= 0 || clearanceMm < 0 || gridMm <= 0 || drillMm <= 0 || diameterMm <= drillMm {
		return nil, &backend.Error{Code: "BAD_INPUT",
			Message: "width/grid/drill must be positive, diameter must exceed drill, and clearance must not be negative"}
	}
	if math.IsNaN(widthMm) || math.IsInf(widthMm, 0) ||
		math.IsNaN(gridMm) || math.IsInf(gridMm, 0) {
		return nil, &backend.Error{Code: "BAD_INPUT", Message: "dimensions must be finite"}
	}

	widthNm := int64(math.Round(widthMm * 1e6))
	clearanceNm := int64(math.Round(clearanceMm * 1e6))
	drillNm := int64(math.Round(drillMm * 1e6))
	diameterNm := int64(math.Round(diameterMm * 1e6))
	pitch := int64(math.Round(gridMm * 1e6))

	if pitch < 100000 {
		pitch = 100000
	}

	wanted := stringSet(p["nets"])
	dryRun := true
	if raw, present := p["dryRun"]; present && raw != nil {
		value, ok := raw.(bool)
		if !ok {
			return nil, &backend.Error{Code: "BAD_INPUT", Message: "dryRun must be a boolean"}
		}
		dryRun = value
	}

	// Skip nets that connectivity already reports as fully connected.
	connectedNets := map[string]bool{}

	if proof, err := dispatch(ctx, "board.connectivity.prove", map[string]any{
		"document":           document,
		"requireFilledZones": false,
	}); err == nil && proof != nil {
		if data, ok := proof.Data.(map[string]any); ok {
			unconnected := stringSet(data["unconnectedNets"])

			seen := map[string]bool{}
			for _, pad := range geometry.Pads {
				if pad.Net != "" {
					seen[pad.Net] = true
				}
			}

			for net := range seen {
				connectedNets[net] = !unconnected[net]
			}
		}
	}

	padsByNet := map[string][]Pad{}

	for _, pad := range geometry.Pads {
		if pad.Net == "" || !pad.HasPosition {
			continue
		}

		onSelected := false

		for _, layer := range layers {
			if padOnLayer(pad, protoLayer(layer)) {
				onSelected = true
				break
			}
		}

		if onSelected {
			padsByNet[pad.Net] = append(padsByNet[pad.Net], pad)
		}
	}

	var netNames []string

	for net := range padsByNet {
		if len(wanted) > 0 && !wanted[net] {
			continue
		}
		netNames = append(netNames, net)
	}
	sort.Strings(netNames)

	// Common grid bounds.
	if len(geometry.Pads) == 0 {
		return nil, &backend.Error{Code: "NO_PADS", Message: "no pads found on the board"}
	}

	minX, minY := geometry.Pads[0].X, geometry.Pads[0].Y
	maxX, maxY := minX, minY

	addBox := func(x, y int64) {
		minX = minInt64(minX, x)
		minY = minInt64(minY, y)
		maxX = maxInt64(maxX, x)
		maxY = maxInt64(maxY, y)
	}

	for _, pad := range geometry.Pads {
		addBox(pad.X, pad.Y)
	}
	for _, track := range geometry.Tracks {
		addBox(track.X1, track.Y1)
		addBox(track.X2, track.Y2)
	}
	for _, via := range geometry.Vias {
		addBox(via.X, via.Y)
	}
	for _, edge := range geometry.Edges {
		addBox(edge.X1, edge.Y1)
		addBox(edge.X2, edge.Y2)
	}

	margin := int64(2_000_000)
	minX -= margin
	minY -= margin
	maxX += margin
	maxY += margin

	result := &Result{
		DryRun: dryRun, Verified: false, Planner: "grid-3d",
		PitchMm: float64(pitch) / 1e6, ClearanceMm: clearanceMm, Layers: layers,
		Note: "3D A* grid router; obstacles include pads, tracks, vias, board edges, and rule areas",
	}

	var items []any

	for _, net := range netNames {
		list := padsByNet[net]
		sort.Slice(list, func(i, j int) bool {
			if list[i].X != list[j].X {
				return list[i].X < list[j].X
			}
			return list[i].Y < list[j].Y
		})

		nr := NetResult{Net: net, PadCount: len(list)}

		if len(list) < 2 {
			nr.Reason = "fewer than two pads"
			result.Nets = append(result.Nets, nr)
			continue
		}

		if connectedNets[net] {
			nr.Reason = "already connected"
			result.Nets = append(result.Nets, nr)
			continue
		}

		grids := make([]*grid, len(layers))

		for i, layer := range layers {
			g := newGrid(minX, minY, maxX, maxY, pitch)
			markLayerObstacles(g, protoLayer(layer), geometry, net,
				clearanceNm, widthNm, diameterNm)
			grids[i] = g
		}

		for i := 0; i+1 < len(list); i++ {
			a, b := list[i], list[i+1]

			startLayer := padLayerIndex(a, layers)
			goalLayer := padLayerIndex(b, layers)

			path, expanded, err := astar3D(grids, startLayer, goalLayer,
				a.X, a.Y, b.X, b.Y, 3_000_000)

			nr.Expanded += expanded

			if err != nil {
				nr.Skipped++
				nr.Reason = err.Error()
				continue
			}

			netItems, vias, _ := pathItems(path, layers, net, widthNm, drillNm, diameterNm)

			if len(netItems) == 0 {
				nr.Skipped++
				nr.Reason = "start and end resolve to the same grid cell"
				continue
			}

			items = append(items, netItems...)
			nr.Routed++
			nr.PathCells += len(path)
			result.Vias += vias

			// Make this route an obstacle for subsequent nets.
			for j := 0; j+1 < len(path); j++ {
				if path[j].Layer == path[j+1].Layer {
					geometry.Tracks = append(geometry.Tracks, obstacleTrack{
						X1: path[j].X, Y1: path[j].Y, X2: path[j+1].X, Y2: path[j+1].Y,
						Width: widthNm, Net: net,
						Layer: protoLayer(layers[path[j].Layer]),
					})
				} else {
					geometry.Vias = append(geometry.Vias, obstacleVia{
						X: path[j].X, Y: path[j].Y, Diameter: diameterNm, Net: net,
					})
				}
			}
		}

		result.Nets = append(result.Nets, nr)
	}

	if len(items) == 0 {
		out := &backend.Result{Action: "board.route.autoroute", OK: false, Data: result}
		out.Error = &backend.Error{Code: "ROUTE_NO_TRACKS",
			Message: "the 3D grid router found no routable paths"}
		return out, nil
	}

	if dryRun {
		return &backend.Result{Action: "board.route.autoroute", OK: true, Data: result}, nil
	}

	apply(ctx, dispatch, document, items, result)
	return routeResult("board.route.autoroute", result), nil
}
