// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, positive, number, nm, ok, fail } from './utils.mjs';
import { doc, xy, refOf, distance, vector, createItems } from './board-common.mjs';
import { loadGeometry, blocked, trackItem } from './geometry.mjs';
import { applyVia } from './vias.mjs';
export async function fanout(p, dispatch) {
  const action = 'board.fanout.run', document = doc(p), geometry = await loadGeometry(dispatch, document), style = p.style ?? 'via-in-pad', dryRun = p.dryRun ?? true;
  if (!['via-in-pad', 'dogbone'].includes(style)) bad('style must be via-in-pad or dogbone');
  const fps = geometry.all.filter(i => i['@type']?.endsWith('.FootprintInstance'));
  const candidates = p.reference ? fps.filter(f => refOf(f).toUpperCase() === p.reference.toUpperCase()) : fps.filter(f => /BGA/i.test(f.definition?.id?.entryName ?? ''));
  if (candidates.length !== 1) bad('Select exactly one BGA footprint with reference');
  const fp = candidates[0], reference = refOf(fp), origin = xy(fp.position), pads = geometry.pads.filter(p => p.ref === reference), plan = [], skipReasons = [], vias = [];
  const drillMm = positive(p.drillMm, 0.2), diameterMm = positive(p.diameterMm, 0.45), diameter = nm(diameterMm), width = nm(positive(p.trackWidthMm, 0.1)), clearance = nm(number(p.clearanceMm, 0.15));
  if (clearance < 0 || drillMm >= diameterMm) bad('Invalid fanout drill/diameter/clearance');
  for (const pad of pads) {
    if (!pad.net) { skipReasons.push(pad.number + ': no net'); continue; }
    let at = { x: pad.x, y: pad.y };
    if (style === 'dogbone') {
      const d = distance(at, origin), dx = d ? (at.x - origin.x) / d : 1, dy = d ? (at.y - origin.y) / d : 0, offset = Math.max(pad.sizeX, pad.sizeY) / 2 + diameter / 2 + clearance;
      at = { x: at.x + dx * offset, y: at.y + dy * offset };
    }
    if (vias.some(v => distance(v, at) < diameter + clearance) || blocked(at, at, pad.net, '*', diameter, clearance, geometry) || style === 'dogbone' && blocked(pad, at, pad.net, pad.layer, width, clearance, geometry)) { skipReasons.push(pad.number + ': copper, edge or pitch clearance'); continue; }
    plan.push({ type: 'via', json: applyVia({ position: vector(at), net: { name: pad.net } }, { drillMm, diameterMm }) });
    if (style === 'dogbone') plan.push(trackItem(pad, at, width, pad.layer, pad.net));
    vias.push(at);
    geometry.obstacles.push({ a: at, b: at, width: diameter, layers: ['*'], net: pad.net });
  }
  const data = { footprint: reference, style, dryRun, padCount: pads.length, viaCount: vias.length, trackCount: plan.length - vias.length, skipped: skipReasons.length, skipReasons, verified: false };
  if (dryRun) return ok(action, { ...data, applied: false, plan });
  if (!plan.length) return fail(action, 'FANOUT_NO_ITEMS', 'No pads can be fanned out', data);
  const result = await createItems(dispatch, document, plan);
  return ok(action, { ...data, created: result.ids.length, createdIds: result.ids, note: 'Native DRC and connectivity proof are required' });
}
