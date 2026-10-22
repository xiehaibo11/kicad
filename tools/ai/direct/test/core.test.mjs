// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Runtime, catalog, listActions } from '../runtime.mjs';
import { encode, decode, type, normalize, requests } from '../protobuf.mjs';
import { mappings, itemAny, KiCadIPC } from '../ipc.mjs';
import { toolsList, callTool } from '../tools.mjs';
import { translateFootprint } from '../footprints.mjs';
import { validateCircuit } from '../schematic.mjs';
import { checkPolicy } from '../ai.mjs';

test('333 supported actions and 130 IPC mappings have registered native commands', () => {
  assert.equal(catalog.length, 333); assert.equal(new Set(catalog.map(a => a.name)).size, 333);
  assert.equal(Object.keys(mappings).length, 130);
  for (const [action, mapping] of Object.entries(mappings)) { assert.ok(requests.has(mapping.request), action); assert.ok(type(mapping.request), action); }
  assert.equal(listActions().length, 333);
  assert.equal(listActions({search:'export.hpgl'}).length,0);
});
test('Any URLs use the canonical native namespace, preserving 64-bit coordinates', () => {
  const message = { header: { document: { type: 'DOCTYPE_PCB', boardFilename: 'x.kicad_pcb' } }, items: [itemAny({ type: 'via', json: { position: { xNm: '9007199254740993', yNm: '-9007199254740993' } } })] };
  const raw = encode('kiapi.common.commands.CreateItems', message), back = decode('kiapi.common.commands.CreateItems', raw);
  assert.equal(back.items[0]['@type'], 'type.googleapis.com/kiapi.board.types.Via');
  assert.equal(back.items[0].position.xNm, '9007199254740993');
  assert.throws(() => encode('kiapi.common.types.Vector2', { xNm: Number.MAX_SAFE_INTEGER + 1 }), /safe|precision|integer/i);
  assert.throws(() => encode('kiapi.common.types.Vector2', { xNm: '9223372036854775808' }), /range|overflow|outside/i);
  assert.throws(() => encode('kiapi.common.types.Vector2', { unknown: 1 }), /Unknown/);
  assert.throws(() => encode('kiapi.common.types.GraphicShape', { segment: {}, arc: {} }), /Only one/);
});
test('native per-item failures fail the whole request and retain partial evidence', async () => {
  const request = 'kiapi.common.commands.CreateItems', response = requests.get(request).response;
  const transport = { request: async () => encode('kiapi.common.ApiResponse', { status: { status: 1 }, message: { '@type': response, status: 'IRS_OK', createdItems: [{ status: { code: 'ISC_INVALID_TYPE' } }] } }), close() {} };
  await assert.rejects(new KiCadIPC({ transport }).call(request, {}), /One or more items failed/);
});
test('20 unique MCP tools restrict domains and annotate mixed tools as mutating', async () => {
  const tools = toolsList(); assert.equal(tools.length, 20); assert.equal(new Set(tools.map(t => t.name)).size, 20);
  for (const name of ['kicad_library', 'kicad_system', 'kicad_board', 'kicad_call']) assert.equal(tools.find(t => t.name === name).annotations.readOnlyHint, false, name);
  await assert.rejects(callTool({ dispatch() { assert.fail('Must not dispatch'); } }, 'kicad_library', { action: 'board.items.delete', payload: {} }), /allowed value/);
  assert.throws(() => checkPolicy('kicad.cli.run', { readOnly: true }), /Read-only/);
  assert.throws(() => checkPolicy('board.items.delete', { allowedActions: 'system.ping' }), /allowed-actions/);
});
test('footprint translator builds schema-valid nested native items and refuses unsupported pads', () => {
  const mod = '(footprint "Test" (attr smd) (pad "1" smd roundrect (at 1 2) (size 1 2) (layers "F.Cu" "F.Mask") (roundrect_rratio 0.25)) (fp_line (start 0 0) (end 1 1) (stroke (width 0.1)) (layer "F.SilkS")) (fp_rect (start 0 0) (end 2 2) (stroke (width 0.1)) (fill none) (layer "F.CrtYd")))';
  const result = translateFootprint(mod, { position: { xMm: 10, yMm: 20 }, reference: 'U1', angleDeg: 90 });
  assert.equal(result.json.definition.items[0].position.xNm, 12000000);
  assert.equal(result.json.definition.items[0].position.yNm, 19000000);
  assert.throws(() => translateFootprint(mod.replace('roundrect', 'custom'), { position: { xMm: 1, yMm: 1 }, reference: 'U1' }), /Unsupported/);
});
test('circuit preflight rejects ambiguous units, duplicate nets and multiply assigned pins', () => {
  const spec = { components: [{ reference: 'U1', libId: 'Amplifier_Operational:LM358', unit: 1 }, { reference: 'U1', libId: 'Amplifier_Operational:LM358', unit: 2 }], nets: [{ name: 'N', pins: ['U1.1'] }] };
  assert.throws(() => validateCircuit(spec), /ambiguous/);
  spec.nets[0].pins = ['U1.1.1']; assert.equal(validateCircuit(spec).pinNets.size, 1);
  spec.nets.push({ name: 'M', pins: ['U1.1.1'] }); assert.throws(() => validateCircuit(spec), /more than once/);
});
test('every catalog action reaches an implementation and async exceptions become structured failures', async () => {
  const runtime = new Runtime({ ipc: { action: async () => ({ ok: true, data: {} }), close() {} }, cli: { binary: 'missing', action: async () => ({ ok: true, data: {} }) } });
  for (const action of catalog) {
    const result = await runtime.dispatch(action.name, { dryRun: true, document: '/no-such-project/test.kicad_pcb' });
    assert.notEqual(result.error?.code, 'HANDLER_MISSING', action.name); assert.equal(typeof result.ok, 'boolean', action.name);
  }
  const error = await runtime.dispatch('library.search.footprints', { limit: -1 }); assert.equal(error.ok, false); assert.ok(error.error.message);
});

test('in-process default project discovery uses the frontend workspace directory', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-workspace-test-'));
  fs.writeFileSync(path.join(directory,'fixture.kicad_pro'),'{}');
  const runtime=new Runtime();
  try {
    const resolved=await runtime.dispatch('project.resolve',{}, {directory});
    assert.equal(resolved.ok,true);assert.equal(resolved.data.path,path.join(directory,'fixture.kicad_pro'));
    const relative=await runtime.dispatch('project.resolve',{project:'fixture.kicad_pro'}, {directory});
    assert.equal(relative.data.path,resolved.data.path);
    const listed=await runtime.dispatch('project.list',{}, {directory});
    assert.equal(listed.ok,true);assert.match(JSON.stringify(listed.data),/fixture.kicad_pro/);
  } finally {runtime.close();fs.rmSync(directory,{recursive:true,force:true});}
});

test('action search ranks the named action before incidental verifyWith matches',()=>{
  const found=listActions({search:'drc.run'});
  assert.equal(found[0].name,'board.drc.run');
  assert.ok(!found.some(a=>a.name==='board.fanout.run'));
  assert.ok(listActions({search:'BGA扇出'}).some(a=>a.name==='board.fanout.run'));
});
