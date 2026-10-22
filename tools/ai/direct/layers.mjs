// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { bad, ok, fail, object, tempDir, DirectError } from './utils.mjs';
import { doc, docPath, call } from './board-common.mjs';
import { parse, child, values, head, replace } from './sexpr.mjs';
export function layerTable(text) {
  const table = child(parse(text), 'layers');
  if (!table) bad('No layer table in board file');
  return table.children.slice(1).filter(n => n.children).map(n => ({ id: head(n), name: n.children[1]?.value, type: n.children[2]?.value, userName: n.children[3]?.value, token: n.children[2] })).filter(n => n.name?.endsWith('.Cu'));
}
async function isLive(dispatch, file) {
  const result = await dispatch('document.list', { type: 'pcb' });
  return Boolean(result.ok && result.data.documents?.some(d => d.boardFilename === path.basename(file) && (!d.project?.path || path.resolve(d.project.path) === path.dirname(file))));
}
export async function layers(action, p, dispatch) {
  const file = docPath(doc(p)), live = await isLive(dispatch, file);
  const read = async () => live ? (await call(dispatch, 'board.export.string', { document: file })).contents : fs.readFileSync(file, 'utf8');
  if (action.endsWith('.get')) return ok(action, { source: live ? 'live' : 'file', copperLayers: layerTable(await read()).map(({ token, ...v }) => v) });
  const want = Array.isArray(p.layers) ? Object.fromEntries(p.layers.map(l => [l.layer, l.type])) : p.layers;
  if (!object(want) || !Object.keys(want).length) bad('layers map is required');
  for (const [name, kind] of Object.entries(want)) if (!name.endsWith('.Cu') || !['signal', 'power', 'mixed', 'jumper'].includes(kind)) bad('Invalid copper layer/type ' + name + ': ' + kind);
  const liveText = await read(), liveEntries = layerTable(liveText);
  const changed = [], edits = [];
  for (const [name, kind] of Object.entries(want)) {
    const entry = liveEntries.find(l => l.name === name);
    if (!entry) bad('Layer not enabled: ' + name);
    if (entry.type !== kind) changed.push({ layer: name, from: entry.type, to: kind });
  }
  const result = { live, changed, verified: false };
  // Preview must never trigger saveFirst, even when the editor has dirty changes.
  if (p.dryRun) return ok(action, { ...result, dryRun: true, applied: false });
  if (live) {
    const state = await call(dispatch, 'document.modified', { document: file });
    if (!['DMS_MODIFIED', 'DMS_UNMODIFIED'].includes(state.state)) throw new DirectError('MODIFIED_STATE_UNKNOWN', 'Cannot overwrite a board while its editor state is unknown');
    if (state.state === 'DMS_MODIFIED') {
      if (!p.saveFirst) throw new DirectError('UNSAVED_CHANGES', 'Pass saveFirst:true to preserve unsaved edits before rewriting layer types');
      await call(dispatch, 'document.save', { document: file });
    }
  }
  const text = fs.readFileSync(file, 'utf8'), table = layerTable(text);
  for (const entry of table) if (want[entry.name] && want[entry.name] !== entry.type) edits.push({ start: entry.token.start, end: entry.token.end, text: want[entry.name] });
  if (edits.length) {
    result.backup = path.join(tempDir('kicad-layer-types-'), path.basename(file)); fs.writeFileSync(result.backup, text, { mode: 0o600 });
    const temporary = file + '.' + process.pid + '.tmp';
    try { fs.writeFileSync(temporary, replace(text, edits), { flag: 'wx', mode: fs.statSync(file).mode }); fs.renameSync(temporary, file); } finally { fs.rmSync(temporary, { force: true }); }
    if (live) { const res = await dispatch('document.revert', { document: file }); if (!res.ok) return fail(action, 'RELOAD_FAILED', 'File changed but open board did not reload', { ...result, reload: res }); }
  }
  result.readback = layerTable(await read()).map(({ token, ...v }) => v);
  result.verified = Object.entries(want).every(([name, kind]) => result.readback.some(l => l.name === name && l.type === kind));
  return result.verified ? ok(action, result) : fail(action, 'LAYER_TYPE_NOT_PERSISTED', 'Layer readback did not match', result);
}
