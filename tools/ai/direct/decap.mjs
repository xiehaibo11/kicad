// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, positive, nm, ok, fail, DirectError } from './utils.mjs';
import { doc, items, padsOf, refOf, idOf, distance, xy, clean, updateItems, itemBoxes, grow, overlap, bounds } from './board-common.mjs';
const power = /(^|[/_+\-])(VCC|VDD|AVDD|DVDD|VDDIO|VDDQ|VBAT|VIN|VSYS|VCORE|VREF|VPP|PVDD|\d+V\d*|V\d+P\d+)/i;
const ground = /(^|[/_])(GND|AGND|DGND|PGND|VSS|0V)\b/i;
export function inspectDecaps(fps, p = {}) {
  const maximum = positive(p.maxDistanceMm, 3), caps = fps.filter(f => /^C\d/i.test(refOf(f)) && padsOf(f).some(pad => ground.test(pad.net))), pins = [];
  for (const fp of fps.filter(f => (p.ics?.length ? p.ics.includes(refOf(f)) : (p.icPrefixes ?? ['U', 'IC']).some(prefix => refOf(f).startsWith(prefix))))) {
    for (const pad of padsOf(fp).filter(pad => !ground.test(pad.net) && (power.test(pad.net) || ['EPT_POWER_INPUT', 'EPT_POWER_OUTPUT'].includes(pad.pinType)) && (!p.nets?.length || p.nets.includes(pad.net)))) {
      const nearby = caps.flatMap(cap => padsOf(cap).filter(cp => cp.net === pad.net).map(cp => ({ reference: refOf(cap), distanceMm: distance(pad, cp) / 1e6, pad: cp.number }))).sort((a, b) => a.distanceMm - b.distanceMm);
      pins.push({ ...pad, item: undefined, nearest: nearby[0], status: nearby[0]?.distanceMm <= maximum ? 'ok' : 'missing', maxDistanceMm: maximum });
    }
  }
  return { pins, caps, maxDistanceMm: maximum, findings: pins.filter(pin => pin.status !== 'ok') };
}
// Native footprint API serializes positions in board coordinates; size/offset vectors stay unchanged.
export function translatePositions(item, dx, dy) {
  const copy = clean(item);
  const walk = v => { if (!v || typeof v !== 'object') return; for (const [k, value] of Object.entries(v)) { if (['position', 'start', 'end', 'mid', 'center', 'radiusPoint', 'topLeft', 'bottomRight', 'point'].includes(k) && value && value.xNm !== undefined && value.yNm !== undefined) { value.xNm = Number(value.xNm) + dx; value.yNm = Number(value.yNm) + dy; } else walk(value); } };
  walk(copy); return copy;
}
export async function decap(action, p, dispatch) {
  const document = doc(p), fps = await items(dispatch, document, ['footprint']), analysis = inspectDecaps(fps, p);
  if (action.endsWith('.check')) return ok(action, { ...analysis, caps: analysis.caps.map(refOf) });
  // Include reference/value text in native bounds, otherwise a clear pad/body position
  // can still put the capacitor's silkscreen reference over the IC's copper pads.
  const apply = p.apply === true && !p.dryRun, boxes = await itemBoxes(dispatch, document, fps.map(idOf), 'BBM_ITEM_AND_CHILD_TEXT'), reserved = new Set(analysis.pins.filter(pin => pin.status === 'ok').map(pin => pin.nearest.reference)), plans = [], originals = [];
  for (const pin of analysis.findings) {
    const choices = analysis.caps.filter(f => f.locked !== 'LS_LOCKED' && !reserved.has(refOf(f)) && padsOf(f).some(pad => pad.net === pin.net)).sort((a, b) => distance(xy(a.position), pin) - distance(xy(b.position), pin));
    const cap = choices[0]; if (!cap) continue;
    const capBox = boxes[idOf(cap)]; if (!capBox) continue;
    const cp = padsOf(cap).find(pad => pad.net === pin.net), ic = fps.find(f => refOf(f) === pin.ref), origin = xy(ic.position), angle = Math.atan2(pin.y - origin.y, pin.x - origin.x), reach = nm(positive(p.offsetMm, 1)) + Math.max(capBox.maxX - capBox.minX, capBox.maxY - capBox.minY) / 2;
    placement: for (let radius = reach; radius <= nm(analysis.maxDistanceMm); radius += nm(0.25)) {
     for (const delta of [0, Math.PI / 2, -Math.PI / 2, Math.PI, Math.PI / 4, -Math.PI / 4, 3 * Math.PI / 4, -3 * Math.PI / 4]) {
      const dx = Math.round(pin.x + Math.cos(angle + delta) * radius - cp.x), dy = Math.round(pin.y + Math.sin(angle + delta) * radius - cp.y), moved = { minX: capBox.minX + dx, maxX: capBox.maxX + dx, minY: capBox.minY + dy, maxY: capBox.maxY + dy };
      if (Object.entries(boxes).some(([id, b]) => id !== idOf(cap) && overlap(grow(moved, nm(0.2)), b))) continue;
      plans.push({ type: 'footprint', json: translatePositions(cap, dx, dy) }); originals.push({ type: 'footprint', json: clean(cap) }); boxes[idOf(cap)] = moved; reserved.add(refOf(cap)); break placement;
     }
    }
  }
  const data = { dryRun: !apply, planned: plans.length, findings: analysis.findings, plan: plans, verified: false };
  if (!apply) return ok(action, { ...data, applied: false });
  if (!plans.length) return fail(action, 'DECAP_NO_PLACEMENT', 'No suitable free capacitor/position found', data);
  let before;
  if (!p.skipDrc) { const r = await dispatch('board.drc.live', { document, severityAll: true }); if (!r.ok || !r.data?.summary) return fail(action, 'DECAP_BASELINE_UNAVAILABLE', 'Native DRC baseline is required before moving footprints', { ...data, baseline: r }); before = r.data.summary.total; }
  try {
    const back = await updateItems(dispatch, document, plans);
    if (plans.some(plan => { const got = back.find(i => idOf(i) === idOf(plan.json)); return !got || distance(xy(got.position), xy(plan.json.position)) > 1; })) throw new DirectError('DECAP_READBACK_MISMATCH', 'Footprint position differs from plan');
    if (!p.skipDrc) {
      const after = await dispatch('board.drc.live', { document, severityAll: true });
      if (!after.ok || !after.data?.summary || after.data.summary.total > before) throw new DirectError('DECAP_DRC_REGRESSION', 'DRC failed or violation count increased', after);
    }
    return ok(action, { ...data, moved: plans.length, verified: true, drcSkipped: Boolean(p.skipDrc) });
  } catch (err) {
    let rollback; try { await updateItems(dispatch, document, originals); rollback = 'restored'; } catch (restore) { rollback = { error: restore.message, detail: restore.detail }; }
    return fail(action, err.code ?? 'DECAP_FAILED', err.message, { ...data, rollback, cause: err.detail });
  }
}
