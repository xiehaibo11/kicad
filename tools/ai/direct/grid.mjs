// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, positive, number, DirectError } from './utils.mjs';
import { blocked } from './geometry.mjs';
export class Heap {
  constructor() { this.values = []; }
  push(value) { const a = this.values; let i = a.length; a.push(value); while (i) { const p = (i - 1) >> 1; if (a[p].score <= value.score) break; a[i] = a[p]; i = p; } a[i] = value; }
  pop() {
    const a = this.values, first = a[0], last = a.pop();
    if (a.length) { let i = 0; while (2 * i + 1 < a.length) { let c = 2 * i + 1; if (c + 1 < a.length && a[c + 1].score < a[c].score) c++; if (last.score <= a[c].score) break; a[i] = a[c]; i = c; } a[i] = last; }
    return first;
  }
}
export async function gridPath(start, end, net, geometry, options = {}) {
  const pitch = positive(options.gridMm, 0.25) * 1e6, width = positive(options.widthMm, 0.25) * 1e6, clearance = number(options.clearanceMm, 0.2) * 1e6;
  if (clearance < 0) bad('clearanceMm must not be negative');
  const layers = options.layers ?? [start.layer];
  if (!layers.length || layers.length > 32) bad('Route needs 1..32 layers');
  const startLayers = layers.map((l, i) => start.layers?.includes(l) || start.layer === l ? i : -1).filter(i => i >= 0);
  const endLayers = layers.map((l, i) => end.layers?.includes(l) || end.layer === l ? i : -1).filter(i => i >= 0);
  if (!startLayers.length || !endLayers.length) return { error: 'Pad layers excluded from route layers', expanded: 0 };
  const margin = positive(options.marginMm, 5) * 1e6;
  const edges = geometry.edges.flatMap(e => [e.a, e.b]);
  const points = edges.length ? edges : [start, end];
  const minX = Math.floor((Math.min(...points.map(p => p.x)) - (edges.length ? 0 : margin)) / pitch) * pitch;
  const minY = Math.floor((Math.min(...points.map(p => p.y)) - (edges.length ? 0 : margin)) / pitch) * pitch;
  const nx = Math.ceil((Math.max(...points.map(p => p.x)) + (edges.length ? 0 : margin) - minX) / pitch) + 1;
  const ny = Math.ceil((Math.max(...points.map(p => p.y)) + (edges.length ? 0 : margin) - minY) / pitch) + 1;
  const maxCells = options.maxCells ?? 500000;
  if (!Number.isInteger(maxCells) || maxCells < 1 || maxCells > 2000000 || nx * ny * layers.length > maxCells) bad('Grid exceeds cell limit; increase gridMm or bound the board');
  const coord = p => ({ x: Math.round((p.x - minX) / pitch), y: Math.round((p.y - minY) / pitch) });
  const s = coord(start), goal = coord(end), at = n => ({ x: minX + n.x * pitch, y: minY + n.y * pitch });
  const key = n => (n.z * ny + n.y) * nx + n.x;
  const heuristic = n => Math.hypot(n.x - goal.x, n.y - goal.y) + (endLayers.includes(n.z) ? 0 : 6);
  const open = new Heap(), scores = new Map(), parents = new Map(), nodes = new Map();
  for (const z of startLayers) {
    const node = { ...s, z }, k = key(node);
    if (blocked(start, at(node), net, layers[z], width, clearance, geometry)) continue;
    scores.set(k, 0); nodes.set(k, node); open.push({ ...node, score: heuristic(node), cost: 0 });
  }
  let expanded = 0;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (open.values.length) {
    if (options.signal?.aborted) throw new DirectError('CANCELLED', 'Route planning cancelled');
    if (expanded++ > maxCells) return { error: 'Grid search limit reached', expanded };
    if (expanded % 1024 === 0) await new Promise(resolve => setImmediate(resolve));
    const cur = open.pop(), currentKey = key(cur);
    if (cur.cost !== scores.get(currentKey)) continue;
    if (cur.x === goal.x && cur.y === goal.y && endLayers.includes(cur.z) && !blocked(at(cur), end, net, layers[cur.z], width, clearance, geometry)) {
      const path = []; let k = currentKey;
      while (k !== undefined) { const n = nodes.get(k); path.push({ ...at(n), layer: layers[n.z] }); k = parents.get(k); }
      path.reverse(); path.unshift({ x: start.x, y: start.y, layer: path[0].layer }); path.push({ x: end.x, y: end.y, layer: path.at(-1).layer });
      return { path, expanded };
    }
    const neighbors = directions.map(([x, y]) => ({ x: cur.x + x, y: cur.y + y, z: cur.z, step: Math.hypot(x, y) }));
    if (options.allowVias !== false) for (let z = 0; z < layers.length; z++) if (z !== cur.z) neighbors.push({ x: cur.x, y: cur.y, z, step: positive(options.viaCost, 10) });
    for (const next of neighbors) {
      if (next.x < 0 || next.y < 0 || next.x >= nx || next.y >= ny) continue;
      const via = next.z !== cur.z;
      const span = via ? layers : [layers[cur.z]];
      const diameter = via ? positive(options.viaDiameterMm, 0.6) * 1e6 : width;
      if (span.some(l => blocked(at(cur), at(next), net, l, diameter, clearance, geometry, { via }))) continue;
      const cost = cur.cost + next.step, k = key(next);
      if (cost >= (scores.get(k) ?? Infinity)) continue;
      scores.set(k, cost); parents.set(k, currentKey); nodes.set(k, next); open.push({ ...next, cost, score: cost + heuristic(next) });
    }
  }
  return { error: 'No collision-free route found', expanded };
}
