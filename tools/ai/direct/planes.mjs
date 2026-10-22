// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, required, nm, ok, fail } from './utils.mjs';
import { doc, call } from './board-common.mjs';
export async function plane(p, dispatch) {
  const action = 'board.plane.build', document = doc(p), net = required(p, 'net'), layers = required(p, 'layers');
  if (!Array.isArray(layers) || layers.some(l => typeof l !== 'string')) bad('layers must be a string array');
  const data = { net, layers, verified: false, steps: [] };
  const create = { document, net, layers, fill: true, name: p.name ?? '' };
  for (const key of ['outline', 'priority']) if (p[key] !== undefined) create[key] = p[key];
  if (p.clearanceMm !== undefined) create.clearanceNm = nm(p.clearanceMm);
  if (p.minThicknessMm !== undefined) create.minThicknessNm = nm(p.minThicknessMm);
  if (p.dryRun) return ok(action, { ...data, dryRun: true, applied: false, plan: create, layerType: p.layerType });
  if (p.layerType) {
    const types = Object.fromEntries(layers.filter(l => l !== 'F.Cu' && l !== 'B.Cu' && l.endsWith('.Cu')).map(l => [l, p.layerType]));
    if (Object.keys(types).length) data.layerType = await call(dispatch, 'board.layers.type.set', { document, layers: types, saveFirst: p.saveFirst ?? false });
  }
  const created = await dispatch('board.plane.create', create); data.created = created.data;
  // Preserve the zone id even if fill/connection verification in CreatePlane fails.
  data.zone = created.data?.plane?.zone?.value ?? created.error?.detail?.plane?.zone?.value;
  if (!data.zone) return fail(action, 'PLANE_CREATE_FAILED', 'No zone id returned', { ...data, createResult: created });
  const verify = await dispatch('board.plane.verify', { document, zone: data.zone }); data.verify = verify.data ?? verify.error?.detail;
  const connectivity = await dispatch('board.connectivity.prove', { document, nets: [net], requireFilledZones: true }); data.connectivity = connectivity.data ?? connectivity.error?.detail;
  data.verified = Boolean(created.ok && verify.ok && data.verify?.plane?.hasFilledPolygons && connectivity.ok && data.connectivity?.ok);
  if (data.verified) return ok(action, data);
  if (!p.keepOnFailure) {
    const rollback = await dispatch('board.items.delete', { document, ids: [data.zone] });
    data.rolledBack = rollback.ok;
    if (!rollback.ok) data.rollbackError = rollback;
  }
  return fail(action, 'PLANE_UNVERIFIED', 'Plane fill or zone-aware connectivity did not verify', data);
}
