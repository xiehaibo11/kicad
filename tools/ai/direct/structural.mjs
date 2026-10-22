// SPDX-License-Identifier: GPL-3.0-or-later
import path from 'node:path';
import { positive, number, ok, fail } from './utils.mjs';
import { doc, items, idOf, refOf, itemBoxes, overlap, call } from './board-common.mjs';
import { liveCopy } from './live.mjs';
export async function structural(p, dispatch) {
  const action = 'board.check.3d', document = doc(p), fps = await items(dispatch, document, ['footprint']), boxes = await itemBoxes(dispatch, document, fps.map(idOf)), findings = [], components = fps.map(fp => ({ reference: refOf(fp), id: idOf(fp), side: fp.layer, box: boxes[idOf(fp)], heightMm: p.heights?.[refOf(fp)] }));
  for (const c of components) {
    if (!c.box) findings.push({ type: 'missing_geometry', reference: c.reference });
    if (c.heightMm === undefined) findings.push({ type: 'missing_height', reference: c.reference }); else positive(c.heightMm);
  }
  for (let i = 0; i < components.length; i++) for (const b of components.slice(i + 1)) { const a = components[i]; if (a.box && b.box && a.side === b.side && overlap(a.box, b.box)) findings.push({ type: 'bbox_overlap', references: [a.reference, b.reference] }); }
  const data = { mode: 'bounding-box', verified: false, components, findings, note: 'Bounding boxes are an approximation; solid intersections require exact STEP checking' };
  if (p.exportStep || p.exact) {
    if (p.dryRun) return ok(action, { ...data, dryRun: true, applied: false });
    const snapshot = await liveCopy(p, dispatch), output = p.output ?? path.join(snapshot.dir, 'board.step');
    await call(dispatch, 'board.export.step', { input: snapshot.copy, output, substModels: true }); data.step = output;
    if (p.exact) {
      const result = await dispatch('external.step.meshcheck', { input: output, minVolumeMm3: p.minVolumeMm3, maxPairs: p.maxPairs }); data.exact = result;
      const evidence = result.data ?? {};
      data.verified = result.ok && Number(evidence.solidCount ?? evidence.solids) > 0 && Array.isArray(evidence.collisions) && !evidence.collisions.length && evidence.errors === 0 && evidence.truncated === false;
      if (!data.verified) return fail(action, 'EXACT_CHECK_UNPROVEN', 'Exact solid check failed or returned incomplete evidence', data, [output]);
    }
  }
  return findings.some(f => f.type === 'bbox_overlap') ? fail(action, 'STRUCTURAL_OVERLAPS', 'Component bounding boxes overlap', data, data.step ? [data.step] : []) : ok(action, data, data.step ? [data.step] : []);
}
export async function unified(p, dispatch) {
  const action = 'board.check.unified', results = {}, findings = [];
  const check = async (key, name, payload) => { const result = await dispatch(name, payload); results[key] = result; return result; };
  const native = await check('native', p.document ? 'board.drc.live' : 'board.drc.run', { ...(p.document ? { document: p.document } : { input: p.input }), full: true, severityAll: true, timeoutMs: p.timeoutMs });
  if (p.document) {
    const dfm = await check('dfm', 'board.dfm.full', { document: p.document, minWidthMm: p.minWidthMm }); findings.push(...(dfm.data?.violations ?? []).map(f => ({ source: 'heuristic-dfm', ...f })));
    const decap = await check('decap', 'board.decap.check', { document: p.document, maxDistanceMm: p.maxDecapDistanceMm }); findings.push(...(decap.data?.findings ?? []).map(f => ({ source: 'decap', ...f })));
    await check('connectivity', 'board.connectivity.prove', { document: p.document, requireFilledZones: true });
    const fps = await items(dispatch, p.document, ['footprint']), count = fps.filter(fp => /^FID/i.test(refOf(fp))).length;
    if (count < (p.fiducials ?? 3)) findings.push({ source: 'assembly', type: 'fiducials_missing', expected: p.fiducials ?? 3, actual: count });
    for (const reference of p.antennaRefs ?? []) { const zones = await items(dispatch, p.document, ['zone']); if (!zones.some(z => z.type === 'ZT_RULE_AREA' && z.name?.includes(reference))) findings.push({ source: 'antenna', type: 'keepout_unproven', reference }); }
    if (p.injectMarkers && !p.dryRun) {
      // Native DRC marker generation remains with KiCad; heuristic findings never masquerade as DRC.
      results.markers = { ok: true, added: [] };
      for (const finding of findings.filter(f => f.xMm !== undefined)) {
        const result = await dispatch('board.drc.marker.add', { document: p.document, severity: 'DRS_WARNING', position: { xNm: Math.round(finding.xMm * 1e6), yNm: Math.round(finding.yMm * 1e6) }, message: '[Heuristic] ' + JSON.stringify(finding) });
        results.markers.added.push(result); if (!result.ok) results.markers.ok = false;
      }
    }
  }
  const data = { results, findings, nativeViolationCount: native.data?.summary?.total, verified: false, readyForFabrication: false };
  return Object.values(results).every(r => r.ok) && native.data?.summary?.total === 0 && !findings.length ? ok(action, data) : fail(action, 'CHECK_FINDINGS', 'Native violations, heuristic findings or incomplete checks remain', data);
}
