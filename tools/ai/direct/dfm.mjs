// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, positive, number, nm, ok, fail } from './utils.mjs';
import { doc, items, idOf, kindOf, netOf, xy, distance, clean, call, updateItems, createItems, padsOf } from './board-common.mjs';
import { pointSegment } from './geometry.mjs';
export async function dfm(action, p, dispatch) {
  const document = doc(p), full = action.endsWith('.full'), fix = full ? p.fix === true && !p.dryRun : action.endsWith('.fix') && p.dryRun === false;
  const minimum = nm(positive(p.minWidthMm, 0.15)), all = await items(dispatch, document, full ? ['track', 'arc', 'via', 'footprint', 'zone', 'text'] : ['track', 'arc']), violations = [], updates = [], deletes = [];
  const report = (type, item, detail = {}) => violations.push({ type, item: idOf(item), net: netOf(item), layer: item.layer, ...detail });
  const tracks = all.filter(t => ['Track', 'Arc'].includes(kindOf(t)));
  for (const t of tracks) {
    const a = xy(t.start), b = xy(t.end), zero = kindOf(t) === 'Track' && distance(a, b) < 1;
    if (zero) { report('zero_length', t, { fixable: true }); deletes.push(t); continue; }
    if (number(t.width?.valueNm) < minimum) { report('narrow_track', t, { widthMm: number(t.width?.valueNm) / 1e6, fixable: true }); const c = clean(t); c.width = { valueNm: minimum }; updates.push({ type: kindOf(t).toLowerCase(), json: c }); }
    if (kindOf(t) === 'Track') { const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI; if (Math.abs(angle / 45 - Math.round(angle / 45)) > 0.01) report('off_45_angle', t, { angleDeg: angle, fixable: false, note: 'Reroute explicitly; snapping endpoints can disconnect copper' }); }
  }
  const stubs = [];
  if (full) {
    const anchors = all.filter(i => kindOf(i) === 'FootprintInstance').flatMap(padsOf).map(p => ({ ...p, r: Math.max(p.sizeX, p.sizeY) / 2 }));
    anchors.push(...all.filter(i => kindOf(i) === 'Via').map(v => ({ ...xy(v.position), net: netOf(v), r: number(v.padStack?.copperLayers?.[0]?.size?.xNm) / 2 })));
    const zoneNets = new Set(all.filter(i => kindOf(i) === 'Zone').map(z => z.copperSettings?.net?.name));
    for (const t of tracks.filter(t => kindOf(t) === 'Track')) {
      const radius = number(t.width?.valueNm) / 2, ends = [xy(t.start), xy(t.end)];
      const touching = at => anchors.some(a => a.net === netOf(t) && distance(at, a) <= radius + a.r) || tracks.some(o => idOf(o) !== idOf(t) && netOf(o) === netOf(t) && o.layer === t.layer && kindOf(o) === 'Track' && pointSegment(at, xy(o.start), xy(o.end)) <= radius + number(o.width?.valueNm) / 2);
      const free = ends.map(at => !touching(at));
      if (free.some(Boolean) && !zoneNets.has(netOf(t)) && distance(...ends) > 1) { report('dangling', t, { fixable: free[0] !== free[1] }); if (free[0] !== free[1]) stubs.push(t); }
      for (const o of tracks.filter(o => kindOf(o) === 'Track' && idOf(o) > idOf(t) && netOf(o) === netOf(t) && o.layer === t.layer)) {
        const oe = [xy(o.start), xy(o.end)];
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) if (distance(ends[a], oe[b]) < 1) {
          const u = { x: ends[1 - a].x - ends[a].x, y: ends[1 - a].y - ends[a].y }, v = { x: oe[1 - b].x - oe[b].x, y: oe[1 - b].y - oe[b].y }, d = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
          if (d) { const angle = Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / d))) * 180 / Math.PI; if (angle < positive(p.acuteDeg, 90) - 0.5) report('acute_angle', t, { other: idOf(o), angleDeg: angle, fixable: false }); }
        }
      }
    }
    for (const item of all.filter(i => ['BoardText', 'FootprintInstance'].includes(kindOf(i)))) {
      const c = clean(item); let changed = false;
      for (const text of kindOf(item) === 'BoardText' ? [c] : [c.referenceField?.text, c.valueField?.text].filter(Boolean)) {
        if (!text.layer?.includes('SilkS') || !text.text?.attributes) continue;
        const wanted = text.layer.startsWith('BL_B_');
        if (Boolean(text.text.attributes.mirrored) !== wanted) { report('silk_mirrored', item, { fixable: true }); text.text.attributes.mirrored = wanted; changed = true; }
      }
      if (changed) updates.push({ type: kindOf(item) === 'BoardText' ? 'text' : 'footprint', json: c });
    }
  }
  const data = { violations, issues: Object.fromEntries([...new Set(violations.map(v => v.type))].map(k => [k, violations.filter(v => v.type === k).length])), fixed: 0, deleted: 0, dryRun: !fix, verified: false };
  if (!fix) return ok(action, { ...data, plan: { updates, deleteIds: deletes.map(idOf), stubIds: stubs.map(idOf) } });
  if (updates.length) { await updateItems(dispatch, document, updates); data.fixed = updates.length; }
  if (deletes.length) { await call(dispatch, 'board.items.delete', { document, ids: deletes.map(idOf) }); data.deleted += deletes.length; }
  if (stubs.length) {
    const before = await call(dispatch, 'board.connectivity.prove', { document, requireFilledZones: false });
    await call(dispatch, 'board.items.delete', { document, ids: stubs.map(idOf) });
    const after = await dispatch('board.connectivity.prove', { document, requireFilledZones: false });
    if (!after.ok || (after.data?.unconnectedCount ?? Infinity) > (before.unconnectedCount ?? 0)) {
      const rollback = await createItems(dispatch, document, stubs.map(t => ({ type: 'track', json: clean(t) })));
      return fail(action, 'DFM_CONNECTIVITY_ROLLBACK', 'Stub removal could not preserve connectivity; restored tracks', { ...data, rollback, after });
    }
    data.deleted += stubs.length;
  }
  return ok(action, { ...data, note: 'Heuristic repair completed; native DRC remains required' });
}
