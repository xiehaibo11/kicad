// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from '../pipeline.mjs';
import { layers } from '../layers.mjs';
import { plane } from '../planes.mjs';
import { vias } from '../vias.mjs';
import { gridPath } from '../grid.mjs';
import { blocked, arcGeometry, trackLength } from '../geometry.mjs';
import { workflow } from '../workflow.mjs';
import { snapshot, release } from '../release.mjs';
import { nativeCheck } from '../audit.mjs';
import { createItems, updateItems } from '../board-common.mjs';
import { publicIP } from '../web.mjs';
import { generateSchematic } from '../schematic.mjs';
import { analyzeImpedance, impedance } from '../impedance.mjs';
const ok = data => ({ ok: true, data });
const board = '(kicad_pcb (version 20260206) (layers (0 "F.Cu" signal) (4 "In1.Cu" signal) (2 "B.Cu" signal)))';
function project(fn) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-composite-')); fs.writeFileSync(path.join(dir, 'test.kicad_pro'), '{}'); fs.writeFileSync(path.join(dir, 'test.kicad_pcb'), board); return Promise.resolve().then(() => fn(dir, path.join(dir, 'test.kicad_pcb'))).finally(() => fs.rmSync(dir, { recursive: true, force: true })); }
test('pipeline filters stages before dispatch and dry-run dispatches no actions or saves', () => project(async (project, document) => {
  const calls = [], dispatch = async (action, p) => { calls.push(action); return ok({}); };
  const preview = await pipeline('pipeline.run', { project, dryRun: true }, dispatch); assert.ok(preview.ok); assert.equal(calls.length, 0); assert.equal(fs.existsSync(path.join(project, '.kicad-agent')), false);
  await pipeline('pipeline.run', { project, stages: ['health'] }, dispatch); assert.deepEqual(calls, ['system.health']);
}));
test('layer dry-run never invokes saveFirst and edits preserve all other bytes', () => project(async (project, document) => {
  const calls = [], dispatch = async action => { calls.push(action); if (action === 'document.list') return ok({ documents: [{ boardFilename: path.basename(document), project: { path: project } }] }); if (action === 'board.export.string') return ok({ contents: board }); assert.fail('Preview must not save or revert'); };
  const preview = await layers('board.layers.type.set', { document, layers: { 'In1.Cu': 'power' }, dryRun: true, saveFirst: true }, dispatch); assert.ok(preview.ok); assert.equal(calls.includes('document.save'), false); assert.equal(fs.readFileSync(document, 'utf8'), board);
  const offline = async () => ok({ documents: [] }); const result = await layers('board.layers.type.set', { document, layers: { 'In1.Cu': 'power' } }, offline); assert.equal(result.data.verified, true); assert.equal(fs.readFileSync(document, 'utf8'), board.replace('"In1.Cu" signal', '"In1.Cu" power'));
}));
test('plane verification failure rolls back only its created zone', async () => {
  const calls = [], dispatch = async (action, p) => { calls.push([action, p]); if (action === 'board.plane.create') return ok({ plane: { zone: { value: 'new-zone' } } }); if (action === 'board.plane.verify') return ok({ plane: { hasFilledPolygons: false } }); if (action === 'board.connectivity.prove') return { ok: false }; if (action === 'board.items.delete') return ok({}); assert.fail(action); };
  const result = await plane({ document: 'x', net: 'GND', layers: ['F.Cu'] }, dispatch); assert.equal(result.ok, false); assert.equal(result.data.rolledBack, true); assert.deepEqual(calls.at(-1)[1].ids, ['new-zone']);
  calls.length = 0; await plane({ document: 'x', net: 'GND', layers: ['F.Cu'], dryRun: true, layerType: 'power' }, dispatch); assert.equal(calls.length, 0);
});
test('partial creation and missing readback retain IDs and fail instead of claiming success', async () => {
  const created = { '@type': 'kiapi.board.types.Via', id: { value: 'partial-id' } };
  await assert.rejects(createItems(async () => ({ ok: false, data: { createdItems: [{ item: created }] }, error: { code: 'ITEM_REQUEST_FAILED', message: 'partial' } }), 'x', [{ type: 'via', json: {} }]), err => err.detail.createdIds[0] === 'partial-id');
  await assert.rejects(createItems(async action => action === 'board.items.create' ? ok({ createdItems: [{ item: created }] }) : ok({ items: [] }), 'x', [{ type: 'via', json: {} }]), err => err.code === 'READBACK_INCOMPLETE');
});
test('grid planner detours copper and validates clearance to zone holes and all layers', async () => {
  const start = { x: 0, y: 0, layer: 'BL_F_Cu' }, end = { x: 4000000, y: 0, layer: 'BL_F_Cu' }, geometry = { edges: [], obstacles: [{ box: { minX: 1500000, maxX: 2500000, minY: -500000, maxY: 500000 }, layers: ['BL_F_Cu'], net: 'other' }] };
  const result = await gridPath(start, end, 'N', geometry, { gridMm: 0.25, widthMm: 0.2, clearanceMm: 0.2 }); assert.ok(result.path); assert.ok(result.path.some(p => Math.abs(p.y) >= 1000000));
  for (let i = 1; i < result.path.length; i++) assert.equal(blocked(result.path[i - 1], result.path[i], 'N', 'BL_F_Cu', 200000, 200000, geometry), false);
  assert.equal(blocked({ x: 2000000, y: 0 }, { x: 2000000, y: 0 }, 'N', '*', 600000, 200000, geometry), true);
});
test('arcs use sweep length rather than the endpoint chord', () => {
  const arc = arcGeometry({ xNm: 1000000, yNm: 0 }, { xNm: 0, yNm: 1000000 }, { xNm: -1000000, yNm: 0 }); assert.ok(Math.abs(arc.length - Math.PI * 1e6) < 1);
});
test('native audits require complete severity scope and cannot trust success/status alone', () => {
  assert.equal(nativeCheck('native-drc', ok({ status: 'clean' })).status, 'blocked');
  const reportJson = { violations: [], unconnected_items: [], schematic_parity: [], ignored_checks: [], included_severities: ['error', 'warning', 'exclusion'] };
  assert.equal(nativeCheck('native-drc', ok({ status: 'clean', reportJson })).status, 'pass'); reportJson.unconnected_items.push({ type: 'unconnected' }); assert.equal(nativeCheck('native-drc', ok({ status: 'clean', reportJson })).status, 'fail');
});
test('workflow cannot skip earlier gates or promote verified; snapshots bind the saved design', () => project(async (project, document) => {
  assert.throws(() => workflow('workflow.advance', { project, stage: 'drc' }), /not complete/);
  workflow('workflow.init', { project }); assert.throws(() => workflow('workflow.advance', { project, stage: 'verified' }), /engineering approval/);
  const before = snapshot(project); fs.appendFileSync(document, '\n'); assert.notEqual(snapshot(project).digest, before.digest);
  const result = await release('release.check', { project }, async () => ({ ok: false })); assert.equal(result.ok, false); assert.equal(result.data.readyForFabrication, false); assert.equal(result.data.readyForProduction, false);
}));
test('web destination policy rejects local, link-local, reserved and IPv6-mapped private addresses', () => {
  for (const ip of ['127.0.0.1', '10.2.3.4', '172.16.1.2', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1']) assert.equal(publicIP(ip), false, ip);
  assert.equal(publicIP('1.1.1.1'), true); assert.equal(publicIP('2606:4700:4700::1111'), true);
});
test('impedance layer lookup accepts native enum names and lists copper layers when missing', async () => {
  const dielectric = { type: 'BSLT_DIELECTRIC', dielectric: { layer: [{ thickness: { valueNm: '200000' }, epsilonR: 4.3 }] } };
  const stackup = { layers: [{ type: 'BSLT_COPPER', layer: 'BL_F_Cu', thickness: { valueNm: '35000' } }, dielectric, { type: 'BSLT_COPPER', layer: 'BL_B_Cu', thickness: { valueNm: '35000' } }] };
  const result = await impedance('board.impedance.calculate', { stackup, layer: 'BL_B_Cu', widthMm: 0.2 });
  assert.equal(result.data.layer, 'B.Cu');
  await assert.rejects(impedance('board.impedance.calculate', { stackup, layer: 'Top', widthMm: 0.2 }), /Layer Top not found in stackup; copper layers: F\.Cu, B\.Cu/);
});
