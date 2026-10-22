// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, positive, nm, ok, fail, array } from './utils.mjs';
import { doc, point, items, padsOf, refOf, netOf, clean, layerEnum, createItems, updateItems, idOf } from './board-common.mjs';
const types = { through: 'VT_THROUGH', blind: 'VT_BLIND', buried: 'VT_BURIED', micro: 'VT_MICRO', microvia: 'VT_MICRO', blind_buried: 'VT_BLIND_BURIED' };
export function applyVia(via, p, defaults = true) {
  via = clean(via);
  const ps = via.padStack ??= { type: 'PST_NORMAL' }, drill = ps.drill ??= { shape: 'DS_CIRCLE' };
  if (defaults || p.type !== undefined) { const t = types[p.type ?? 'through']; if (!t) bad('Invalid via type'); via.type = t; }
  if (defaults || p.startLayer) drill.startLayer = layerEnum(p.startLayer ?? 'F.Cu');
  if (defaults || p.endLayer) drill.endLayer = layerEnum(p.endLayer ?? 'B.Cu');
  if (drill.startLayer && drill.endLayer) ps.layers = [drill.startLayer, drill.endLayer];
  if (defaults || p.drillMm !== undefined) { const d = nm(positive(p.drillMm, 0.3)); drill.diameter = { xNm: d, yNm: d }; }
  if (defaults || p.diameterMm !== undefined) {
    const d = nm(positive(p.diameterMm, 0.6));
    ps.copperLayers ??= []; if (!ps.copperLayers.length) ps.copperLayers.push({ layer: 'BL_F_Cu', shape: 'PSS_CIRCLE' });
    for (const l of ps.copperLayers) l.size = { xNm: d, yNm: d };
  }
  if (Number(drill.diameter?.xNm) >= Number(ps.copperLayers?.[0]?.size?.xNm)) bad('Via drill must be smaller than diameter');
  for (const [key, prefix, on, off] of [['filled', 'VDFM', 'FILLED', 'UNFILLED'], ['capped', 'VDCM', 'CAPPED', 'UNCAPPED']]) if (p[key] !== undefined) {
    if (typeof p[key] !== 'boolean') bad(key + ' must be boolean');
    drill[key] = prefix + '_' + (p[key] ? on : off);
  }
  for (const [key, field, on, off] of [['plugged', 'pluggingMode', 'VPM_PLUGGED', 'VPM_UNPLUGGED'], ['covered', 'coveringMode', 'VCM_COVERED', 'VCM_UNCOVERED']]) {
    let mode = p[key]; if (typeof mode === 'boolean') mode = mode ? 'both' : 'none';
    if (mode === undefined) continue;
    if (!['none', 'front', 'back', 'both'].includes(mode)) bad(key + ' must be none/front/back/both or boolean');
    (ps.frontOuterLayers ??= {})[field] = ['front', 'both'].includes(mode) ? on : off;
    (ps.backOuterLayers ??= {})[field] = ['back', 'both'].includes(mode) ? on : off;
  }
  return via;
}
function mismatches(back, wanted) {
  const errors = [];
  const check = (a, b, key = '') => {
    if (b && typeof b === 'object') { for (const k of Object.keys(b)) check(a?.[k], b[k], key + '.' + k); }
    else if (a !== b && String(a) !== String(b)) errors.push(key + ': ' + a + ' != ' + b);
  };
  for (const key of ['type', 'position', 'net', 'padStack']) if (wanted[key] !== undefined) check(back[key], wanted[key], key);
  return errors;
}
export async function vias(action, p, dispatch) {
  const document = doc(p), modify = action.endsWith('.modify');
  let plan, sites = [];
  if (!modify) {
    for (const v of [...array(p.positions), ...(p.position ? [p.position] : [])]) sites.push({ position: point(v), net: v.net ?? p.net ?? '' });
    if (p.reference) {
      const fp = (await items(dispatch, document, ['footprint'])).find(f => refOf(f).toUpperCase() === p.reference.toUpperCase());
      if (!fp) bad('Footprint not found: ' + p.reference);
      sites.push(...padsOf(fp).filter(pad => (!p.pads?.length || p.pads.includes(pad.number)) && (!p.nets?.length || p.nets.includes(pad.net)) && (pad.net || p.includeUnconnected)).map(pad => ({ position: { xNm: pad.x, yNm: pad.y }, net: pad.net, pad: p.reference + '.' + pad.number })));
    }
    if (!sites.length) bad('Give positions[], position, or reference with pads/nets');
    plan = sites.map(s => applyVia({ position: s.position, ...(s.net ? { net: { name: s.net } } : {}) }, p));
  } else {
    if (!p.all && !p.ids?.length && !p.nets?.length) bad('Select vias with ids[], nets[] or all:true');
    plan = (await items(dispatch, document, ['via'])).filter(v => p.all || p.ids?.includes(idOf(v)) || p.nets?.includes(netOf(v))).map(v => applyVia(v, p, false));
    if (!plan.length) return fail(action, 'NO_VIAS_SELECTED', 'No matching vias', { selected: 0 });
  }
  const data = { requested: plan.length, sites, verified: false };
  if (p.dryRun) return ok(action, { ...data, dryRun: true, applied: false, items: plan });
  const entries = plan.map(json => ({ type: 'via', json }));
  const back = modify ? await updateItems(dispatch, document, entries) : (await createItems(dispatch, document, entries)).items;
  const problems = {};
  for (let i = 0; i < back.length; i++) {
    const want = modify ? plan.find(v => idOf(v) === idOf(back[i])) : plan[i];
    const errors = mismatches(back[i], want); if (errors.length) problems[idOf(back[i])] = errors;
  }
  Object.assign(data, { [modify ? 'updatedIds' : 'createdIds']: back.map(idOf), verifiedCount: back.length - Object.keys(problems).length, mismatches: problems, verified: !Object.keys(problems).length, next: 'Run board.drc.live and board.connectivity.prove' });
  return data.verified ? ok(action, data) : fail(action, 'VIA_PROPERTY_NOT_PERSISTED', 'Via readback differs from requested properties', data);
}
