// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { callTool, toolsList } from '../tools.mjs';
import { Runtime } from '../runtime.mjs';
import { KiCadIPC } from '../ipc.mjs';
import { RAW_LIMIT } from '../views.mjs';

const at = (x, y) => ({ xNm: String(x * 1e6), yNm: String(y * 1e6) });
const track = i => ({ '@type': 'type.googleapis.com/kiapi.board.types.Track', id: { value: 't' + i }, start: at(i, 0), end: at(i, 3), width: { valueNm: '200000' }, layer: i % 2 ? 'BL_B_Cu' : 'BL_F_Cu', net: { name: i % 3 ? 'SIG' + i : 'GND' }, customProperties: [] });
const padItem = (n, net) => ({ '@type': 'type.googleapis.com/kiapi.board.types.Pad', id: { value: 'p' + n }, number: String(n), net: { name: net }, type: 'PT_SMD', position: at(10 + n, 10), padStack: { layers: ['BL_F_Cu'], copperLayers: [{ size: at(0.5, 0.6) }], drill: { diameter: { xNm: '0' } } } });
const footprint = (ref, nets) => ({ '@type': 'type.googleapis.com/kiapi.board.types.FootprintInstance', id: { value: 'fp-' + ref }, position: at(10, 10), orientation: { valueDegrees: 90 }, layer: 'BL_F_Cu', locked: 'LS_UNLOCKED',
  referenceField: { text: { text: { text: ref } } }, valueField: { text: { text: { text: '10k' } } },
  definition: { id: { libraryNickname: 'Lib', entryName: 'R0603' }, items: [...nets.map((net, i) => padItem(i + 1, net)), ...Array.from({ length: 40 }, () => ({ '@type': 'type.googleapis.com/kiapi.board.types.BoardGraphicShape', shape: { segment: { start: at(0, 0), end: at(1, 1) } }, layer: 'BL_F_SilkS' }))] } });
const board = [...Array.from({ length: 300 }, (_, i) => track(i)), footprint('R1', ['GND', 'VCC']), footprint('U7', ['GND', 'SDA', 'SCL'])];
function fakeRuntime(items) {
  const calls = [];
  return { calls, async dispatch(action, payload) { calls.push([action, payload]); return { ok: true, action, data: { header: null, status: 'IRS_OK', items } }; } };
}

test('large item reads return a compact, paged mm view and filters never reach the native request', async () => {
  const runtime = fakeRuntime(board);
  const page = await callTool(runtime, 'kicad_board', { action: 'board.items.get', payload: { types: ['track', 'footprint'] } });
  assert.ok(JSON.stringify(board).length > RAW_LIMIT);
  assert.equal(page.data.view, 'compact'); assert.equal(page.data.total, 302); assert.equal(page.data.count, 100); assert.equal(page.data.nextOffset, 100);
  assert.deepEqual(page.data.counts.byKind, { Track: 300, Footprint: 2 });
  assert.deepEqual(page.data.items[1], { id: 't1', kind: 'Track', net: 'SIG1', layer: 'BL_B_Cu', width: 0.2, start: [1, 0], end: [1, 3], length: 3 });
  assert.deepEqual(runtime.calls[0][1], { types: ['track', 'footprint'] });
  const fp = await callTool(runtime, 'kicad_board', { action: 'board.items.get', payload: { refs: ['u*'] } });
  assert.equal(fp.data.total, 1); assert.equal(fp.data.unfiltered, 302);
  const u7 = fp.data.items[0];
  assert.equal(u7.ref, 'U7'); assert.equal(u7.footprint, 'Lib:R0603'); assert.deepEqual(u7.at, [10, 10]); assert.equal(u7.rotation, 90); assert.deepEqual(u7.nets, ['GND', 'SCL', 'SDA']);
  assert.deepEqual(u7.pads[0], { number: '1', net: 'GND', at: [11, 10], type: 'PT_SMD', size: [0.5, 0.6] }, 'refs adds pads without per-pad ids');
  const gnd = await callTool(runtime, 'kicad_board', { action: 'board.items.get', payload: { nets: 'gnd', layers: ['F.Cu'], limit: 5, offset: 5 } });
  assert.equal(gnd.data.offset, 5); assert.equal(gnd.data.count, 5); assert.ok(gnd.data.items.every(i => i.kind === 'Footprint' || (i.net === 'GND' && i.layer === 'BL_F_Cu')));
  const raw = await callTool(runtime, 'kicad_board', { action: 'board.items.get', payload: { refs: 'R1', detail: 'full' } });
  assert.equal(raw.data.items[0]['@type'], board[300]['@type']); assert.equal(raw.data.total, 1); assert.equal(raw.data.nextOffset, null);
  await assert.rejects(callTool(runtime, 'kicad_board', { action: 'board.items.get', payload: { limit: 0 } }), /limit must be/);
  await assert.rejects(callTool(runtime, 'kicad_board', { action: 'board.items.get', payload: { detail: 'everything' } }), /detail must be/);
});

test('small reads keep the raw result, natively named inputs stay native and failures pass through', async () => {
  const small = fakeRuntime(board.slice(0, 3));
  const result = await callTool(small, 'kicad_board', { action: 'board.items.get', payload: { types: ['track'] } });
  assert.equal(result.data.items[0]['@type'], board[0]['@type']); assert.equal(result.data.view, undefined); assert.equal(result.data.total, undefined, 'unchanged legacy result');
  assert.equal((await callTool(small, 'kicad_board', { action: 'board.items.get', payload: { nets: ['GND'] } })).data.view, 'compact', 'filters ask for the view');
  await callTool(small, 'kicad_board', { action: 'board.items.by_net', payload: { nets: ['GND'], limit: 2 } });
  assert.deepEqual(small.calls.at(-1)[1], { nets: ['GND'] }, 'nets is the by_net request field, limit is a view option');
  const failing = { async dispatch(action) { return { ok: false, action, error: { code: 'NO_OPEN_DOCUMENT', message: 'x' } }; } };
  assert.equal((await callTool(failing, 'kicad_board', { action: 'board.items.get', payload: { limit: 3 } })).error.code, 'NO_OPEN_DOCUMENT');
});

test('broad action listings return summaries; exact names and narrow searches keep full schemas', async () => {
  const runtime = fakeRuntime([]);
  const domain = await callTool(runtime, 'kicad_actions', { domain: 'board' });
  assert.ok(domain.data.count > 100); assert.equal(domain.data.actions.length, 40); assert.equal(domain.data.nextOffset, 40);
  assert.ok(JSON.stringify(domain).length < 16 * 1024, 'board domain listing was 251 KB');
  assert.equal(domain.data.actions[0].inputSchema, undefined); assert.match(domain.data.note, /exact action name/);
  const exact = await callTool(runtime, 'kicad_actions', { search: 'board.items.get' });
  assert.ok(exact.data.actions.find(a => a.name === 'board.items.get').inputSchema);
  assert.ok(exact.data.actions.find(a => a.name === 'board.items.get').viewOptions.refs, 'item reads document their view options');
  const narrow = await callTool(runtime, 'kicad_actions', { search: 'drc.run' });
  assert.ok(narrow.data.actions.every(a => a.description && (a.cliSchema || a.inputSchema || a.inputs)));
  assert.equal((await callTool(runtime, 'kicad_actions', { domain: 'board', offset: 160 })).data.nextOffset, null);
  const detailed = await callTool(runtime, 'kicad_actions', { domain: 'board', detail: true });
  assert.equal(detailed.data.actions.length, 10); assert.ok(detailed.data.actions.every(a => a.inputs || a.inputSchema)); assert.equal(detailed.data.nextOffset, 10);
});

test('domain tools carry action search text for capability search; kicad_call stays generic', () => {
  const tools = toolsList(), boardTool = tools.find(t => t.name === 'kicad_board');
  const drc = boardTool.searchActions.find(a => a.name === 'board.drc.run');
  assert.ok(drc.keywords.includes('drc')); assert.equal(drc.text, drc.text.toLowerCase()); assert.equal(drc.mutates, false); assert.ok(drc.inputs.includes('input'));
  assert.equal(tools.find(t => t.name === 'kicad_call').searchActions, undefined);
  assert.equal(tools.find(t => t.name === 'kicad_health').searchActions.length, 1);
});

test('a closed editor is reported as such, with how to open it or read the saved file instead', async () => {
  const ipc = new KiCadIPC({ socket: '/nonexistent' }), sent = [];
  let open = [];
  ipc.call = async (request, body) => {
    sent.push([request, body]);
    if (request.endsWith('GetOpenDocuments')) return { documents: open.filter(d => d.type === body.type) };
    throw Object.assign(new Error('no handler available for request of type ' + request), { code: 'UNHANDLED' });
  };
  try {
    await assert.rejects(ipc.action('board.stackup.read', { document: '/tmp/x/board.kicad_pcb' }), err => err.code === 'NO_OPEN_DOCUMENT' && /board\.kicad_pcb/.test(err.message) && /project\.open/.test(err.message) && /board\.drc\.run/.test(err.message) && err.detail.editor === 'pcb');
    await assert.rejects(ipc.action('schematic.hierarchy.get', {}), err => err.code === 'NO_OPEN_DOCUMENT' && /schematic\.erc\.run/.test(err.message));
    open = [{ type: 'DOCTYPE_PCB', boardFilename: 'board.kicad_pcb', project: { name: 'board', path: '/tmp/x' } }];
    await assert.rejects(ipc.action('board.stackup.read', { document: '/tmp/x/board.kicad_pcb' }), err => err.code === 'UNHANDLED', 'an open editor without the handler is a missing handler');
    ipc.call = async (request, body) => { sent.push([request, body]); return { status: 'IRS_OK', items: [] }; };
    await ipc.action('board.items.by_net', { document: '/tmp/x/board.kicad_pcb', nets: ['GND'], types: ['via', 'track'] });
    assert.deepEqual(sent.at(-1)[1].types, ['KOT_PCB_VIA', 'KOT_PCB_TRACE'], 'short type names work for every typed item query');
  } finally { ipc.close(); }
});

test('project.info without a path describes the open project from disk, else the only workspace project, else says how', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-current-')), project = path.join(dir, 'demo');
  fs.mkdirSync(project); fs.writeFileSync(path.join(project, 'demo.kicad_pro'), JSON.stringify({ meta: { version: 3 }, sheets: [['root', 'Root']] })); fs.writeFileSync(path.join(project, 'demo.kicad_pcb'), '(kicad_pcb)');
  let open = [{ type: 'DOCTYPE_PCB', boardFilename: 'demo.kicad_pcb', project: { name: 'demo', path: project } }];
  const runtime = new Runtime({ ipc: { openDocuments: async () => open, close() {} }, autoConnect: false });
  try {
    const live = await runtime.dispatch('project.info', {});
    assert.equal(live.data.source, 'open-project'); assert.equal(live.data.documents.board, path.join(project, 'demo.kicad_pcb')); assert.deepEqual(live.data.sheets, [['root', 'Root']]); assert.equal(live.data.openDocuments.length, 1);
    open = [];
    const workspace = await runtime.dispatch('project.info', {}, { directory: dir });
    assert.equal(workspace.data.source, 'workspace'); assert.equal(workspace.data.name, 'demo');
    const none = await runtime.dispatch('project.info', {}, { directory: os.tmpdir() + '/kicad-no-such-dir' });
    assert.equal(none.error.code, 'NO_OPEN_DOCUMENT'); assert.match(none.error.message, /Pass project/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
