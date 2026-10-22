// SPDX-License-Identifier: GPL-3.0-or-later
import path from 'node:path';
import { bad, required, unwrap, DirectError, nm, number } from './utils.mjs';
export const doc = p => required({ document: p.document ?? p.input }, 'document');
export const docPath = d => path.resolve(typeof d === 'string' ? d : d.path ?? path.join(d.project?.path ?? '.', d.boardFilename ?? ''));
export const idOf = i => i.id?.value ?? (typeof i.id === 'string' ? i.id : '');
export const kindOf = i => i['@type']?.split('.').at(-1) ?? i.type;
export const netOf = i => i.net?.name ?? '';
export const refOf = i => i.referenceField?.text?.text?.text ?? i.referenceField?.text?.text ?? '';
export const itemsOf = d => ['items', 'createdItems', 'updatedItems'].flatMap(k => (d[k] ?? []).map(i => i.item ?? i));
export const clean = i => { const { ['@type']: _, ...rest } = structuredClone(i); return rest; };
export const call = async (dispatch, action, p) => unwrap(await dispatch(action, p));
export const items = async (dispatch, document, types) => itemsOf(await call(dispatch, 'board.items.get', { document, ...(types ? { types } : {}) }));
export const point = v => {
  if (!v || typeof v !== 'object') bad('Point must be an object');
  if (v.xMm !== undefined && v.yMm !== undefined) return { xNm: nm(v.xMm), yNm: nm(v.yMm) };
  if (v.xNm === undefined || v.yNm === undefined) bad('Point needs xMm/yMm or xNm/yNm');
  return { xNm: number(v.xNm), yNm: number(v.yNm) };
};
export const xy = v => ({ x: number(v?.xNm), y: number(v?.yNm) });
export const vector = v => ({ xNm: Math.round(v.x), yNm: Math.round(v.y) });
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const layerEnum = l => l.startsWith('BL_') ? l : 'BL_' + l.replaceAll('.', '_');
export const polygon = points => ({ polygons: [{ outline: { closed: true, nodes: points.map(p => ({ point: p })) }, holes: [] }] });
export const rectangle = b => [{ xNm: b.minX, yNm: b.minY }, { xNm: b.maxX, yNm: b.minY }, { xNm: b.maxX, yNm: b.maxY }, { xNm: b.minX, yNm: b.maxY }];
export const grow = (b, d) => ({ minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d });
export const overlap = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
export function bounds(points) {
  if (!points.length) bad('No geometry points');
  return { minX: Math.min(...points.map(p => p.x)), minY: Math.min(...points.map(p => p.y)), maxX: Math.max(...points.map(p => p.x)), maxY: Math.max(...points.map(p => p.y)) };
}
export function padsOf(fp) {
  return (fp.definition?.items ?? []).filter(i => kindOf(i) === 'Pad').map(p => {
    const ps = p.padStack ?? {}, size = ps.copperLayers?.[0]?.size ?? {}, at = xy(p.position);
    return { ...at, item: p, id: idOf(p), ref: refOf(fp), number: p.number, net: netOf(p), layers: ps.layers ?? [fp.layer], layer: ps.layers?.[0] ?? fp.layer, sizeX: number(size.xNm), sizeY: number(size.yNm), pinType: p.symbolPin?.type ?? '' };
  });
}
export async function itemBoxes(dispatch, document, ids, mode) {
  if (!ids.length) return {};
  const result = await call(dispatch, 'board.bbox.get', { document, ids, ...(mode ? { mode } : {}) });
  return Object.fromEntries((result.boxes ?? []).map((b, i) => {
    const p = xy(b.position), s = xy(b.size);
    return [result.items[i].value, { minX: p.x, minY: p.y, maxX: p.x + s.x, maxY: p.y + s.y }];
  }));
}
export async function createItems(dispatch, document, plan) {
  const created = [], ids = [];
  try {
    for (let i = 0; i < plan.length; i += 50) {
      const batch = plan.slice(i, i + 50), result = await dispatch('board.items.create', { document, items: batch });
      // Partial native results remain evidence even when one item in the batch fails.
      for (const v of itemsOf(result?.data ?? result?.error?.detail ?? {})) if (idOf(v)) { created.push(v); ids.push(idOf(v)); }
      unwrap(result);
      if (created.length !== Math.min(i + 50, plan.length)) throw new DirectError('CREATE_INCOMPLETE', 'Native creation returned an incomplete batch');
    }
    const back = ids.length ? itemsOf(await call(dispatch, 'board.items.get_by_id', { document, ids })) : [];
    if (back.length !== ids.length || new Set(back.map(idOf)).size !== ids.length || ids.some(id => !back.some(i => idOf(i) === id))) throw new DirectError('READBACK_INCOMPLETE', 'Created items are missing on readback');
    return { ids, items: back };
  } catch (err) { throw new DirectError(err.code ?? 'CREATE_FAILED', err.message, { createdIds: ids, cause: err.detail }); }
}
export async function updateItems(dispatch, document, updates) {
  const updatedIds = [];
  try {
    for (let i = 0; i < updates.length; i += 50) {
      const batch = updates.slice(i, i + 50);
      const result = await dispatch('board.items.update', { document, items: batch });
      for (const v of itemsOf(result?.data ?? result?.error?.detail ?? {})) if (idOf(v)) updatedIds.push(idOf(v));
      unwrap(result);
      if (updatedIds.length !== Math.min(i + 50, updates.length)) throw new DirectError('UPDATE_INCOMPLETE', 'Native update returned an incomplete batch');
    }
    const back = itemsOf(await call(dispatch, 'board.items.get_by_id', { document, ids: updates.map(i => idOf(i.json ?? i)) }));
    if (back.length !== updates.length || new Set(back.map(idOf)).size !== updates.length || updates.some(i => !back.some(b => idOf(b) === idOf(i.json ?? i)))) throw new DirectError('READBACK_INCOMPLETE', 'Updated items missing on readback');
    return back;
  } catch (err) { throw new DirectError(err.code ?? 'UPDATE_FAILED', err.message, { updatedIds, cause: err.detail }); }
}
