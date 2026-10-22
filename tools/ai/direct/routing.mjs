// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, positive, number, nm, required, ok, fail } from './utils.mjs';
import { doc, call, items, idOf, kindOf, netOf, xy, distance, vector, layerEnum, createItems, clean } from './board-common.mjs';
import { loadGeometry, blocked, pairs, trackItem, trackLength } from './geometry.mjs';
import { gridPath } from './grid.mjs';
import { applyVia } from './vias.mjs';
const dry = p => p.dryRun ?? true;
const simplify = path => path.filter((p, i) => !i || i === path.length - 1 || p.layer !== path[i - 1].layer || p.layer !== path[i + 1].layer || Math.abs((p.x - path[i - 1].x) * (path[i + 1].y - p.y) - (p.y - path[i - 1].y) * (path[i + 1].x - p.x)) > 1);
function planPath(path, net, width, viaOptions = {}) {
  const result = [];
  for (const [a, b] of pairs(simplify(path))) {
    if (a.layer !== b.layer) result.push({ type: 'via', json: applyVia({ position: vector(a), net: { name: net } }, viaOptions) });
    else if (distance(a, b) > 1) result.push(trackItem(a, b, width, a.layer, net));
  }
  return result;
}
function accept(plan, geometry) {
  for (const { json: t, type } of plan) geometry.obstacles.push({ a: xy(type === 'via' ? t.position : t.start), b: xy(type === 'via' ? t.position : t.end), width: type === 'via' ? number(t.padStack.copperLayers[0].size.xNm) : number(t.width.valueNm), layers: type === 'via' ? ['*'] : [t.layer], net: t.net.name });
}
export async function routing(action, p, dispatch, options = {}) {
  if (action.endsWith('.length_report')) return lengthReport(p, dispatch);
  if (action.endsWith('.tune_length')) return tuneLength(p, dispatch, options);
  if (action.endsWith('.length_match')) return lengthMatch(p, dispatch);
  const document = doc(p), geometry = await loadGeometry(dispatch, document), width = nm(positive(p.widthMm, action.endsWith('.diff_pair') ? 0.2 : 0.25)), clearance = nm(number(p.clearanceMm, 0.2));
  if (clearance < 0) bad('clearanceMm must not be negative');
  const data = { nets: [], created: 0, failed: 0, dryRun: dry(p), verified: false, planner: p.planner ?? 'lrouter', note: 'Planned copper requires native DRC and connectivity verification' }, plan = [];
  if (action.endsWith('.diff_pair')) {
    const padMap = new Map(geometry.pads.map(pad => [pad.ref + '.' + pad.number, pad]));
    for (const pair of required(p, 'pairs')) {
      const pads = ['p_start', 'p_end', 'n_start', 'n_end'].map(key => padMap.get(pair[key]));
      if (pads.some(v => !v)) bad('Differential pair contains an unknown pad');
      const [a, b, c, d] = pads;
      if (!a.net || !c.net || a.net !== b.net || c.net !== d.net || a.net === c.net || pads.some(pad => pad.layer !== a.layer)) bad('Differential pair requires two distinct nets with endpoints on a common layer');
      const spacing = width + nm(positive(p.gapMm, 0.2)), start = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 }, end = { x: (b.x + d.x) / 2, y: (b.y + d.y) / 2 };
      const candidates = [[start, end], [start, { x: end.x, y: start.y }, end], [start, { x: start.x, y: end.y }, end]];
      let chosen;
      for (const center of candidates) {
        if (distance(center[0], center[1]) < 1) continue;
        const dx = center[1].x - start.x, dy = center[1].y - start.y;
        const sign = (a.x - start.x) * -dy + (a.y - start.y) * dx < 0 ? -1 : 1;
        const pp = offsetPath(center, sign * spacing / 2), nn = offsetPath(center, -sign * spacing / 2);
        const paths = [[a, ...pp, b], [c, ...nn, d]];
        const candidate = paths.flatMap((path, i) => planPath(path.map(v => ({ ...v, layer: a.layer })), i ? c.net : a.net, width));
        const temporary = { ...geometry, obstacles: [...geometry.obstacles] };
        let conflict = false;
        for (const part of candidate) {
          const t = part.json;
          if (blocked(xy(t.start), xy(t.end), t.net.name, t.layer, width, clearance, temporary)) { conflict = true; break; }
          accept([part], temporary);
        }
        if (!conflict) { chosen = candidate; break; }
      }
      if (chosen) { plan.push(...chosen); accept(chosen, geometry); }
      data.nets.push({ net: a.net + '/' + c.net, padCount: 4, routed: chosen?.length ?? 0, skipped: chosen ? 0 : 1, reason: chosen ? '' : 'Pair path blocked by copper, keepout or board edge' });
    }
  } else {
    if (!['lrouter', 'grid', 'obstacle'].includes(data.planner)) bad('planner must be lrouter or grid');
    let layers = p.layers?.map(layerEnum);
    if (!layers && data.planner !== 'lrouter') layers = (await call(dispatch, 'board.layers.get', { document })).layers.filter(l => l.endsWith('_Cu'));
    const grouped = new Map();
    for (const pad of geometry.pads) if (pad.net && (!p.nets?.length || p.nets.includes(pad.net))) { if (!grouped.has(pad.net)) grouped.set(pad.net, []); grouped.get(pad.net).push(pad); }
    // Only a complete connectivity proof may suppress an already connected net.
    const proof = await dispatch('board.connectivity.prove', { document, requireFilledZones: false });
    const proofData = proof.data ?? proof.error?.detail;
    for (const [net, pads] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
      const nr = { net, padCount: pads.length, routed: 0, skipped: 0 }; data.nets.push(nr);
      if (pads.length < 2) { nr.reason = 'Fewer than two pads'; continue; }
      if (proofData && Array.isArray(proofData.unconnectedNets) && !proofData.unconnectedNets.includes(net) && (proofData.ok || proofData.netCount > 0)) { nr.reason = 'Already connected'; continue; }
      pads.sort((a, b) => a.x - b.x || a.y - b.y);
      for (const [a, b] of pairs(pads)) {
        let path;
        if (data.planner !== 'lrouter') {
          const result = await gridPath(a, b, net, geometry, { ...p, layers, signal: options.signal });
          path = result.path; nr.expandedCells = (nr.expandedCells ?? 0) + result.expanded;
          if (!path) nr.reason = result.error;
        } else if (a.layer === b.layer) {
          path = [[a, { x: b.x, y: a.y }, b], [a, { x: a.x, y: b.y }, b]].find(candidate => pairs(candidate).every(([c, d]) => !blocked(c, d, net, a.layer, width, clearance, geometry)))?.map(v => ({ ...v, layer: a.layer }));
        }
        if (!path) { nr.skipped++; nr.reason ??= 'Both L paths blocked or pads on different layers; try planner:grid'; continue; }
        const part = planPath(path, net, width, { drillMm: p.viaDrillMm, diameterMm: p.viaDiameterMm });
        plan.push(...part); accept(part, geometry); nr.routed++;
      }
    }
  }
  data.planned = plan.length; data.vias = plan.filter(i => i.type === 'via').length;
  if (dry(p)) return ok(action, { ...data, applied: false, plan });
  if (!plan.length) return fail(action, 'ROUTE_NO_TRACKS', 'No routable pad pairs found', data);
  try { const result = await createItems(dispatch, document, plan); data.created = result.ids.length; data.createdIds = result.ids; }
  catch (err) { return fail(action, err.code, err.message, { ...data, partial: err.detail }); }
  data.failed = data.nets.reduce((n, r) => n + r.skipped, 0);
  return data.failed ? fail(action, 'ROUTE_INCOMPLETE', 'Some pad pairs could not be routed', data) : ok(action, data);
}
export function offsetPath(points, offset) {
  const normals = pairs(points).map(([a, b]) => { const d = distance(a, b); return { x: -(b.y - a.y) / d, y: (b.x - a.x) / d }; });
  return points.map((p, i) => {
    if (!i || i === points.length - 1) { const n = normals[i ? i - 1 : 0]; return { x: p.x + offset * n.x, y: p.y + offset * n.y }; }
    const a = normals[i - 1], b = normals[i], divisor = 1 + a.x * b.x + a.y * b.y;
    if (Math.abs(divisor) < 1e-6) bad('Cannot offset a reversing path');
    return { x: p.x + offset * (a.x + b.x) / divisor, y: p.y + offset * (a.y + b.y) / divisor };
  });
}
export async function lengthReport(p, dispatch) {
  const tracks = (await items(dispatch, doc(p), ['track', 'arc'])).filter(t => !p.net || netOf(t) === p.net);
  const lengthMm = tracks.reduce((n, t) => n + trackLength(t), 0);
  return ok('board.route.length_report', { net: p.net ?? '', segments: tracks.length, lengthMm, ...(p.targetMm !== undefined ? { targetMm: positive(p.targetMm), deficitMm: Math.max(0, p.targetMm - lengthMm) } : {}) });
}
export async function tuneLength(p, dispatch) {
  const action = 'board.route.tune_length', document = doc(p), net = required(p, 'net'), target = positive(required(p, 'targetMm'));
  const tracks = (await items(dispatch, document, ['track', 'arc'])).filter(t => netOf(t) === net);
  const current = tracks.reduce((n, t) => n + trackLength(t), 0), extra = target - current;
  const data = { net, currentMm: current, targetMm: target, extraMm: Math.max(0, extra), dryRun: dry(p), verified: false };
  if (extra <= 0.01) return ok(action, { ...data, status: 'already_met' });
  const segment = tracks.filter(t => kindOf(t) === 'Track' && idOf(t)).sort((a, b) => trackLength(b) - trackLength(a))[0];
  if (!segment) bad('No straight track found for net ' + net);
  const len = trackLength(segment), usable = len - 1, amplitude = positive(p.amplitudeMm, 0.5), spacing = positive(p.spacingMm, 0.5);
  let teeth = Math.max(1, Math.ceil(extra / (2 * amplitude)));
  teeth = Math.min(teeth, Math.floor(usable / 0.2));
  if (teeth < 1 || extra / (2 * teeth) > 2 * amplitude) return fail(action, 'INSUFFICIENT_STRAIGHT_LENGTH', 'Not enough straight track for target length', data);
  const pitch = Math.min(spacing, usable / teeth), height = extra / (2 * teeth), lead = (len - teeth * pitch) / 2, a = xy(segment.start), b = xy(segment.end), ux = (b.x - a.x) / (len * 1e6), uy = (b.y - a.y) / (len * 1e6);
  const at = (t, h) => ({ x: a.x + (ux * t - uy * h) * 1e6, y: a.y + (uy * t + ux * h) * 1e6 });
  const points = [a];
  for (let i = 0; i < teeth; i++) { const t = lead + i * pitch, h = (i % 2 ? -1 : 1) * height; points.push(at(t, 0), at(t, h), at(t + pitch, h), at(t + pitch, 0)); }
  points.push(b);
  const path = points.filter((p, i) => !i || distance(p, points[i - 1]) > 1), width = number(segment.width?.valueNm);
  const plan = pairs(path).map(([a, b]) => trackItem(a, b, width, segment.layer, net));
  const geometry = await loadGeometry(dispatch, document), clearance = nm(number(p.clearanceMm, 0.2));
  if (pairs(path).some(([a, b]) => blocked(a, b, net, segment.layer, width, clearance, geometry, { ignoreId: idOf(segment) }))) return fail(action, 'TUNE_BLOCKED', 'Serpentine collides with copper, keepout or board edge', data);
  Object.assign(data, { teeth, amplitudeMm: height, spacingMm: pitch, plannedTracks: plan.length, plannedLengthMm: pairs(path).reduce((n, [a, b]) => n + distance(a, b) / 1e6, 0), segment: idOf(segment) });
  if (Math.abs(data.plannedLengthMm - len - extra) > 0.01) return fail(action, 'TUNE_PLAN_MISMATCH', 'Planned length does not match target', data);
  if (dry(p)) return ok(action, { ...data, applied: false, plan });
  const created = await createItems(dispatch, document, plan); data.createdIds = created.ids;
  const deletion = await dispatch('board.items.delete', { document, ids: [idOf(segment)] });
  if (!deletion.ok) {
    const rollback = await dispatch('board.items.delete', { document, ids: created.ids });
    return fail(action, 'TUNE_DELETE_FAILED', 'Original track was not deleted; attempted to remove new serpentine', { ...data, deletion, rollback });
  }
  data.deleted = true; data.created = created.ids.length;
  data.verifiedLengthMm = (await lengthReport({ document, net }, dispatch)).data.lengthMm;
  data.verified = Math.abs(data.verifiedLengthMm - target) <= Math.max(0.05, 0.01 * target);
  return data.verified ? ok(action, data) : fail(action, 'TUNE_UNVERIFIED', 'Length after tuning differs from target', data);
}
async function lengthMatch(p, dispatch) {
  const nets = required(p, 'nets'); if (!Array.isArray(nets) || new Set(nets).size !== nets.length) bad('nets must be a unique list');
  const before = await Promise.all(nets.map(net => lengthReport({ document: doc(p), net }, dispatch)));
  const target = p.targetMm === undefined ? Math.max(...before.map(r => r.data.lengthMm)) : positive(p.targetMm), tolerance = positive(p.toleranceMm, 0.5);
  const results = [];
  for (const r of before) {
    const { net, lengthMm } = r.data;
    results.push(Math.abs(lengthMm - target) <= tolerance ? r : await tuneLength({ ...p, net, targetMm: target, dryRun: p.dryRun || !p.apply }, dispatch));
  }
  const after = await Promise.all(nets.map(net => lengthReport({ document: doc(p), net }, dispatch)));
  const verified = Boolean(p.apply && !p.dryRun && results.every(r => r.ok) && after.every(r => Math.abs(r.data.lengthMm - target) <= tolerance));
  const data = { nets: before.map(r => r.data), targetMm: target, toleranceMm: tolerance, results, after: after.map(r => r.data), dryRun: p.dryRun || !p.apply, verified };
  return data.dryRun || verified ? ok('board.route.length_match', data) : fail('board.route.length_match', 'LENGTH_MATCH_UNVERIFIED', 'One or more nets outside tolerance', data);
}
