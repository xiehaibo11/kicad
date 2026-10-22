// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, required, nm, number, ok, fail } from './utils.mjs';
import { doc, items, call, point, refOf, padsOf, idOf, itemBoxes, bounds, grow, rectangle, polygon, layerEnum, createItems } from './board-common.mjs';
async function region(p, dispatch, document) {
  if (p.outline) {
    if (!Array.isArray(p.outline) || p.outline.length < 3) bad('outline needs at least three points');
    return { outline: p.outline.map(point), source: 'outline' };
  }
  if (p.box) {
    const { x1Mm, y1Mm, x2Mm, y2Mm } = p.box;
    const box = bounds([{ x: nm(x1Mm), y: nm(y1Mm) }, { x: nm(x2Mm), y: nm(y2Mm) }]);
    if (box.minX === box.maxX || box.minY === box.maxY) bad('box must have nonzero size');
    return { outline: rectangle(box), source: 'box', box };
  }
  const ref = required(p, 'reference'), fp = (await items(dispatch, document, ['footprint'])).find(f => refOf(f).toUpperCase() === ref.toUpperCase());
  if (!fp) bad('Footprint not found: ' + ref);
  let box;
  if (p.pads?.length) {
    const pads = padsOf(fp).filter(pad => p.pads.includes(pad.number));
    if (pads.length !== new Set(p.pads).size) bad('One or more requested pads not found');
    box = bounds(pads.flatMap(pad => [{ x: pad.x - pad.sizeX / 2, y: pad.y - pad.sizeY / 2 }, { x: pad.x + pad.sizeX / 2, y: pad.y + pad.sizeY / 2 }]));
  } else box = (await itemBoxes(dispatch, document, [idOf(fp)]))[idOf(fp)];
  if (!box) bad('No bounding box available for ' + ref);
  box = grow(box, nm(number(p.marginMm, 1)));
  return { outline: rectangle(box), source: ref + (p.pads?.length ? ' pads' : ' bounding box'), box };
}
export async function regionAction(action, input, dispatch) {
  let p = input;
  const document = doc(p);
  if (action === 'board.rules.region.set') return regionRules(p, dispatch);
  if (action === 'board.keepout.antenna') p = { ...p, name: p.name ?? 'ANTENNA_KEEPOUT_' + String(p.reference ?? '').toUpperCase(), marginMm: p.marginMm ?? 2, keepout: p.keepout ?? { tracks: true, vias: true, copper: true, footprints: p.keepoutFootprints ?? false } };
  const name = required(p, 'name'), area = await region(p, dispatch, document);
  let layers = p.layers;
  if (!layers?.length || layers.length === 1 && layers[0] === '*') layers = (await call(dispatch, 'board.layers.get', { document })).layers.filter(l => l.endsWith('_Cu'));
  if (!layers.length) bad('No enabled copper layers');
  layers = layers.map(layerEnum);
  const flags = Object.fromEntries(['tracks', 'vias', 'pads', 'copper', 'footprints'].map(k => ['keepout' + k[0].toUpperCase() + k.slice(1), p.keepout?.[k] ?? false]));
  for (const value of Object.values(flags)) if (typeof value !== 'boolean') bad('keepout flags must be boolean');
  const zone = { type: 'ZT_RULE_AREA', name, layers, outline: polygon(area.outline), ruleAreaSettings: flags };
  const data = { name, layers, keepout: flags, region: area, verified: false };
  if (p.dryRun) return ok(action, { ...data, dryRun: true, applied: false, plan: zone });
  const back = (await createItems(dispatch, document, [{ type: 'zone', json: zone }])).items[0]; data.zone = idOf(back);
  data.verified = back.type === zone.type && back.name === name && layers.every(l => back.layers?.includes(l)) && Object.entries(flags).every(([k, v]) => (back.ruleAreaSettings?.[k] ?? false) === v);
  return data.verified ? ok(action, data) : fail(action, 'RULE_AREA_NOT_PERSISTED', 'Rule area readback differs', { ...data, readback: back });
}
async function regionRules(p, dispatch) {
  const action = 'board.rules.region.set', document = doc(p), area = p.area;
  if (area && /['\\\x00-\x1f]/.test(area)) bad('area contains invalid rule-expression characters');
  const rules = [...(p.rules ?? [])];
  if (area) {
    const condition = `A.insideArea('${area}')` + (p.condition ? ' && ' + p.condition : '');
    for (const [key, suffix, type] of [['clearanceMm', 'clearance', 'CLEARANCE'], ['trackWidthMm', 'track_width', 'TRACK_WIDTH'], ['viaDiameterMm', 'via_diameter', 'VIA_DIAMETER'], ['holeSizeMm', 'hole_size', 'HOLE_SIZE'], ['annularWidthMm', 'annular_width', 'ANNULAR_WIDTH'], ['holeClearanceMm', 'hole_clearance', 'HOLE_CLEARANCE']]) if (p[key] !== undefined) {
      if (number(p[key]) <= 0) bad(key + ' must be positive');
      const numeric = { min: nm(p[key]), ...(key === 'trackWidthMm' && p.trackWidthMaxMm !== undefined ? { max: nm(p.trackWidthMaxMm) } : {}) };
      if (numeric.max !== undefined && numeric.max < numeric.min) bad('trackWidthMaxMm must be >= trackWidthMm');
      rules.push({ name: area + '_' + suffix, condition, constraints: [{ type: 'CRCT_' + type, numeric }] });
    }
  }
  if (!rules.length) bad('Give area and constraints, or rules[]');
  const names = rules.map(r => required(r, 'name'));
  if (new Set(names).size !== names.length) bad('Rule names must be unique');
  const current = (await call(dispatch, 'board.rules.custom.get', { document })).rules ?? [], merged = [...current.filter(r => !names.includes(r.name)), ...rules];
  const data = { area, added: rules.length, replaced: current.length + rules.length - merged.length, total: merged.length, verified: false };
  if (p.dryRun) return ok(action, { ...data, dryRun: true, applied: false, rules });
  await call(dispatch, 'board.rules.custom.set', { document, rules: merged });
  const back = (await call(dispatch, 'board.rules.custom.get', { document })).rules ?? [];
  const contains = (actual, expected) => expected && typeof expected === 'object' ? actual && Object.entries(expected).every(([k, v]) => contains(actual[k], v)) : String(actual) === String(expected);
  data.verified = rules.every(rule => back.some(r => r.name === rule.name && contains(r, rule)));
  return data.verified ? ok(action, data) : fail(action, 'RULES_NOT_PERSISTED', 'Rules missing on readback', { ...data, readback: back });
}
