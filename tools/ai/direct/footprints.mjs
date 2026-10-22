// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { parse, head, children, child, values, value } from './sexpr.mjs';
import { footprintRoots, projectFootprints } from './library.mjs';
import { bad, required, nm, number, positive, ok, fail } from './utils.mjs';
import { doc, point, vector, xy, layerEnum, polygon, items, refOf, padsOf, idOf, call, createItems, itemBoxes, overlap, grow, bounds } from './board-common.mjs';
import { loadGeometry, blocked } from './geometry.mjs';
import { encode } from './protobuf.mjs';
export function footprintFile(p) {
  if (p.file) return path.resolve(p.file);
  const id = required(p, 'libId').split(':');
  if (id.length !== 2 || id.some(s => !s || s.includes('/') || s.includes('\\') || s === '..')) bad('libId must be Library:Footprint');
  const local = projectFootprints(p).filter(l => l.name === id[0]);
  const files = [...new Set((local.length ? local.map(l => path.join(l.directory, id[1] + '.kicad_mod')) : footprintRoots().map(root => path.join(root, id[0] + '.pretty', id[1] + '.kicad_mod'))).filter(f => fs.existsSync(f)).map(f => fs.realpathSync(f)))];
  if (files.length !== 1) bad('Footprint library entry missing or ambiguous: ' + p.libId);
  return files[0];
}
export function translateFootprint(source, p) {
  const root = parse(source); if (!['footprint', 'module'].includes(head(root))) bad('Expected .kicad_mod footprint');
  const origin = point(required(p, 'position')), angle = number(p.angleDeg), rad = angle * Math.PI / 180, skipped = [], definitionItems = [];
  const pos = (node, key = 'at') => { const [x = 0, y = 0] = values(child(node, key)).map(number); return { xNm: Math.round(Number(origin.xNm) + nm(x) * Math.cos(rad) + nm(y) * Math.sin(rad)), yNm: Math.round(Number(origin.yNm) - nm(x) * Math.sin(rad) + nm(y) * Math.cos(rad)) }; };
  const layerNames = node => values(child(node, 'layers')).flatMap(l => l.startsWith('*.') ? ['F.' + l.slice(2), 'B.' + l.slice(2)] : [l]).map(layerEnum);
  for (const n of root.children.slice(1).filter(n => n.children)) {
    const key = head(n);
    if (key === 'pad') {
      const [name, kind, shape] = values(n), shapes = { circle: 'PSS_CIRCLE', rect: 'PSS_RECTANGLE', oval: 'PSS_OVAL', roundrect: 'PSS_ROUNDRECT', trapezoid: 'PSS_TRAPEZOID' }, types = { smd: 'PT_SMD', thru_hole: 'PT_PTH', np_thru_hole: 'PT_NPTH', connect: 'PT_EDGE_CONNECTOR' };
      if (!shapes[shape] || !types[kind]) bad('Unsupported pad geometry/type: ' + shape + '/' + kind);
      const [w, h] = values(child(n, 'size')).map(v => nm(positive(v))), at = values(child(n, 'at'));
      if (!w || !h) bad('Pad size is required');
      const copper = { layer: 'BL_F_Cu', shape: shapes[shape], size: { xNm: w, yNm: h } };
      if (shape === 'trapezoid') { const delta = values(child(n, 'rect_delta')); copper.trapezoidDelta = { xNm: nm(delta[0] ?? 0), yNm: nm(delta[1] ?? 0) }; }
      if (child(n, 'chamfer')) bad('Chamfered pads require native padstack translation');
      if (child(n, 'offset') || child(child(n, 'drill'), 'offset')) bad('Offset pad drills require native padstack translation');
      if (shape === 'roundrect') copper.cornerRoundingRatio = number(value(n, 'roundrect_rratio', 0.25));
      const stack = { type: 'PST_NORMAL', layers: layerNames(n), angle: { valueDegrees: angle + number(at[2]) }, copperLayers: [copper] };
      const drill = child(n, 'drill');
      if (drill) { const v = values(drill), oval = v[0] === 'oval', d = v.slice(oval ? 1 : 0).filter(v => v !== undefined); stack.drill = { shape: oval ? 'DS_OBLONG' : 'DS_CIRCLE', diameter: { xNm: nm(positive(d[0])), yNm: nm(positive(oval ? d[1] : d[0])) }, startLayer: 'BL_F_Cu', endLayer: 'BL_B_Cu' }; }
      const pad = { number: name, type: types[kind], position: pos(n), padStack: stack };
      if (child(n, 'clearance')) pad.copperClearanceOverride = { valueNm: nm(value(n, 'clearance')) };
      definitionItems.push({ '@type': 'kiapi.board.types.Pad', ...pad });
    } else if (['fp_line', 'fp_rect', 'fp_circle', 'fp_arc', 'fp_poly'].includes(key)) {
      const shape = { attributes: { stroke: { width: { valueNm: nm(value(child(n, 'stroke'), 'width', value(n, 'width', 0.05))) } }, fill: { fillType: value(n, 'fill') === 'solid' ? 'GFT_FILLED' : 'GFT_UNFILLED' } } };
      if (key === 'fp_line') shape.segment = { start: pos(n, 'start'), end: pos(n, 'end') };
      if (key === 'fp_circle') shape.circle = { center: pos(n, 'center'), radiusPoint: pos(n, 'end') };
      if (key === 'fp_arc') { if (!child(n, 'mid')) bad('Legacy angle-defined arcs must be upgraded before placement'); shape.arc = { start: pos(n, 'start'), mid: pos(n, 'mid'), end: pos(n, 'end') }; }
      if (key === 'fp_rect') { const a = values(child(n, 'start')), b = values(child(n, 'end')); const corners = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]; shape.polygon = polygon(corners.map(([x, y]) => pos(parse(`(p (at ${x} ${y}))`)))); }
      if (key === 'fp_poly') shape.polygon = polygon(children(child(n, 'pts'), 'xy').map(pt => pos({ children: [parse('(p)'), { children: [{ value: 'at' }, ...pt.children.slice(1)] }] })));
      definitionItems.push({ '@type': 'kiapi.board.types.BoardGraphicShape', layer: layerEnum(value(n, 'layer', 'F.SilkS')), shape });
    } else if (['fp_text', 'model', 'property'].includes(key)) skipped.push(key + ': ' + (values(n)[0] ?? ''));
  }
  const field = (name, text, y, visible) => ({ name, visible, text: { layer: 'BL_F_SilkS', text: { text, position: { xNm: origin.xNm, yNm: Number(origin.yNm) + nm(y) }, attributes: { size: { xNm: nm(1), yNm: nm(1) }, strokeWidth: { valueNm: nm(0.15) }, visible } } } });
  const attrs = values(child(root, 'attr'));
  const attributes = { mountingStyle: attrs.includes('smd') ? 'FMS_SMD' : attrs.includes('through_hole') ? 'FMS_THROUGH_HOLE' : 'FMS_UNSPECIFIED', excludeFromPositionFiles: attrs.includes('exclude_from_pos_files'), excludeFromBillOfMaterials: attrs.includes('exclude_from_bom'), exemptFromCourtyardRequirement: attrs.includes('allow_missing_courtyard') };
  const [libraryNickname = '', entryName = values(root)[0]] = (p.libId ?? ':' + values(root)[0]).split(':');
  const json = { position: origin, orientation: { valueDegrees: angle }, layer: 'BL_F_Cu', attributes, definition: { id: { libraryNickname, entryName }, attributes, items: definitionItems }, referenceField: field('Reference', required(p, 'reference'), -2, true), valueField: field('Value', p.value ?? entryName, 2, false) };
  encode('kiapi.board.types.FootprintInstance', json);
  return { json, skipped };
}
export async function placeFootprint(p, dispatch) {
  const action = 'board.footprint.place', document = doc(p), file = footprintFile(p), plan = translateFootprint(fs.readFileSync(file, 'utf8'), p);
  if (p.side && !['top', 'bottom'].includes(p.side)) bad('side must be top or bottom');
  const data = { file, reference: p.reference, skipped: plan.skipped, expectedPads: plan.json.definition.items.filter(i => i['@type'].endsWith('.Pad')).length, verified: false };
  if (p.dryRun) return ok(action, { ...data, dryRun: true, applied: false, plan: plan.json });
  const result = await createItems(dispatch, document, [{ type: 'footprint', json: plan.json }]); data.id = result.ids[0];
  let back = result.items[0];
  if (p.side === 'bottom') { await call(dispatch, 'board.flip', { document, ids: result.ids, direction: 'y' }); back = (await call(dispatch, 'board.items.get_by_id', { document, ids: result.ids })).items?.[0]; }
  data.verified = Boolean(back) && refOf(back) === p.reference && padsOf(back).length === data.expectedPads && back.layer === (p.side === 'bottom' ? 'BL_B_Cu' : 'BL_F_Cu');
  return data.verified ? ok(action, data) : fail(action, 'FOOTPRINT_READBACK_MISMATCH', 'Placed footprint did not match the plan', { ...data, readback: back });
}
export async function fiducials(p, dispatch) {
  const action = 'board.fiducial.add', document = doc(p), count = p.count ?? 3;
  if (!Number.isInteger(count) || count < 1 || count > 4) bad('count must be 1..4');
  const existing = await items(dispatch, document, ['footprint']), prefix = p.referencePrefix ?? 'FID';
  if (!p.force && existing.some(f => refOf(f).startsWith(prefix))) bad('Fiducials already present; select force:true to add more');
  const geometry = await loadGeometry(dispatch, document);
  if (!geometry.edges.length) bad('Closed board outline is required');
  const box = bounds(geometry.edges.flatMap(e => [e.a, e.b])), inset = nm(positive(p.insetMm, 3)), clearance = nm(positive(p.clearanceMm, 1.5)), boxes = Object.values(await itemBoxes(dispatch, document, existing.map(idOf)));
  const corners = [[box.minX, box.minY, 1, 1], [box.maxX, box.minY, -1, 1], [box.minX, box.maxY, 1, -1], [box.maxX, box.maxY, -1, -1]], plans = [];
  for (const [x, y, sx, sy] of corners.slice(0, count)) {
    let position;
    for (let i = 0; i < 40; i++) { const at = { x: x + sx * (inset + nm(i * 0.5)), y: y + sy * (inset + nm(i * 0.5)) }, candidate = grow({ minX: at.x, maxX: at.x, minY: at.y, maxY: at.y }, nm(1.25) + clearance); if (!boxes.some(b => overlap(candidate, b)) && !blocked(at, at, '', '*', nm(2.5), clearance, geometry)) { position = { xNm: at.x, yNm: at.y }; boxes.push(candidate); break; } }
    if (!position) return fail(action, 'FIDUCIAL_NO_SPACE', 'No free corner position found', { plans });
    plans.push({ document, libId: p.libId ?? 'Fiducial:Fiducial_1mm_Mask2mm', reference: prefix + (plans.length + 1), position, side: p.side, dryRun: p.dryRun });
  }
  const results = []; for (const plan of plans) { const r = await placeFootprint(plan, dispatch); results.push(r); if (!r.ok) break; }
  const data = { count, results, dryRun: p.dryRun ?? false };
  return results.length === count && results.every(r => r.ok) ? ok(action, data) : fail(action, 'FIDUCIAL_INCOMPLETE', 'Fiducial placement incomplete', data);
}
