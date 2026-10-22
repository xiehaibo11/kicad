// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, number, positive, required, readJSON, unwrap, ok, fail } from './utils.mjs';
export const layerName = value => String(value).replace(/^BL_/, '').replaceAll('_', '.');
export function stackupLayers(stackup) {
  const raw = stackup.layers ?? [], copper = raw.map((l, i) => l.type === 'BSLT_COPPER' && l.enabled !== false && l.layer ? i : -1).filter(i => i >= 0);
  function dielectric(index, step) {
    for (let i = index + step; i >= 0 && i < raw.length; i += step) {
      const l = raw[i];
      if (l.type !== 'BSLT_DIELECTRIC' || l.enabled === false) continue;
      let t = 0, tr = 0;
      for (const sub of l.dielectric?.layer ?? []) {
        const h = number(sub.thickness?.valueNm);
        if (h < 0) bad('Negative dielectric thickness');
        if (!h) continue;
        const er = positive(sub.epsilonR);
        if (number(sub.lossTangent) < 0) bad('Negative loss tangent');
        t += h; tr += h / er;
      }
      if (!t || !tr) bad('Dielectric has no physical thickness');
      return { t, er: t / tr };
    }
  }
  if (!copper.length) bad('Stackup contains no enabled copper layers');
  return copper.map((index, pos) => {
    const l = raw[index], above = dielectric(index, -1), below = dielectric(index, 1);
    const strip = pos > 0 && pos < copper.length - 1 && above && below;
    const d = pos === 0 ? below : above ?? below;
    const spacing = strip ? above.t + below.t : d?.t ?? 0;
    return { name: layerName(l.layer), kind: strip ? 'stripline' : 'microstrip', er: strip ? spacing / (above.t / above.er + below.t / below.er) : d?.er ?? 0, heightMm: spacing / (strip ? 2e6 : 1e6), planeSpacingMm: spacing / 1e6, copperThicknessMm: number(l.thickness?.valueNm) / 1e6 };
  });
}
export function impedanceAt(l, width, gap, differential) {
  const er = positive(l.er), h = positive(l.heightMm), b = positive(l.planeSpacingMm ?? h), t = number(l.copperThicknessMm);
  if (t < 0 || !['microstrip', 'stripline'].includes(l.kind ?? 'microstrip')) bad('Invalid copper thickness or layer kind');
  const ref = l.kind === 'stripline' ? b : h;
  if (width / ref < 0.1 - 1e-12 || width / ref > 2 + 1e-12) bad('Width outside IPC-2141 validity range (0.1..2 times height/spacing)');
  const ratio = l.kind === 'stripline' ? 4 * b / (0.67 * Math.PI * width * (0.8 + t / width)) : 5.98 * h / (0.8 * width + t);
  if (ratio <= 1) bad('Geometry produces nonphysical impedance');
  const z0 = (l.kind === 'stripline' ? 60 / Math.sqrt(er) : 87 / Math.sqrt(er + 1.41)) * Math.log(ratio);
  if (differential) positive(gap);
  const zdiff = differential ? 2 * z0 * (1 - (l.kind === 'stripline' ? 0.347 * Math.exp(-2.9 * gap / h) : 0.48 * Math.exp(-0.96 * gap / h))) : undefined;
  return { z0, zdiff, z: differential ? zdiff : z0 };
}
export function analyzeImpedance(layer, p) {
  const target = p.targetOhm === undefined ? 0 : positive(p.targetOhm), gap = number(p.gapMm), differential = Boolean(p.differential);
  let width = p.widthMm === undefined ? 0 : positive(p.widthMm);
  if (!width || p.synthesize) {
    positive(target);
    const ref = layer.kind === 'stripline' ? layer.planeSpacingMm : layer.heightMm;
    let lo = 0.1 * ref, hi = 2 * ref;
    if (target > impedanceAt(layer, lo, gap, differential).z || target < impedanceAt(layer, hi, gap, differential).z) bad('Target is unreachable within IPC-2141 validity range');
    for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (impedanceAt(layer, mid, gap, differential).z > target) lo = mid; else hi = mid; }
    width = (lo + hi) / 2;
  }
  const z = impedanceAt(layer, width, gap, differential);
  return { ...layer, layer: layer.name, widthMm: width, gapMm: gap, z0Ohm: z.z0, ...(differential ? { zdiffOhm: z.zdiff } : {}), ...(target ? { targetOhm: target, errorPct: (z.z - target) / target * 100 } : {}), scope: 'IPC-2141 approximation; verify with manufacturer field solver' };
}
export async function impedance(action, p, dispatch) {
  let stackup = typeof p.stackup === 'string' ? readJSON(p.stackup) : p.stackup;
  stackup ??= unwrap(await dispatch('board.stackup.read', { document: required(p, 'document') })).stackup;
  const layers = stackupLayers(stackup);
  if (action.endsWith('.layers')) return ok(action, { layers });
  // Accept native enum spellings such as BL_In1_Cu as well as In1.Cu.
  const layer = layers.find(l => l.name.toLowerCase() === layerName(p.layer ?? layers[0].name).toLowerCase());
  if (!layer) bad(`Layer ${p.layer} not found in stackup; copper layers: ${layers.map(l => l.name).join(', ')}`);
  if (action.endsWith('.calculate')) return ok(action, analyzeImpedance(layer, p));
  const expected = Object.fromEntries(layers.filter(l => !p.layer || l.name === layer.name).map(l => [l.name, analyzeImpedance(l, { ...p, widthMm: undefined }).widthMm]));
  const items = unwrap(await dispatch('board.items.get', { document: required(p, 'document'), types: ['track', 'arc'] })).items ?? [];
  const violations = []; let checkedTracks = 0, skippedItems = 0;
  const tolerancePct = number(p.tolerancePct, 10); if (tolerancePct < 0) bad('tolerancePct must not be negative');
  for (const item of items) {
    const name = layerName(item.layer), widthMm = number(item.width?.valueNm) / 1e6;
    if (p.layer && name !== layer.name) continue;
    if (!expected[name] || !widthMm) { skippedItems++; continue; }
    checkedTracks++; const errorPct = (widthMm - expected[name]) / expected[name] * 100;
    if (Math.abs(errorPct) > tolerancePct) violations.push({ item: item.id?.value, net: item.net?.name ?? '', layer: name, widthMm, expectedMm: expected[name], errorPct });
  }
  const data = { targetOhm: p.targetOhm, tolerancePct, checkedTracks, skippedItems, violations, expectedWidthsMm: expected };
  return !checkedTracks ? fail(action, 'NO_TRACKS_CHECKED', 'No tracks available to check', data) : violations.length ? fail(action, 'IMPEDANCE_VIOLATIONS', 'Tracks outside tolerance', data) : ok(action, data);
}
