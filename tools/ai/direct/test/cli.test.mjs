// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cliCommands, cliArgs, commandFor, KiCadCLI } from '../cli.mjs';
import { execute } from '../utils.mjs';
test('all 57 native CLI schemas accept required paths and reject unknown options', () => {
  assert.equal(cliCommands.length, 57);
  for (const command of cliCommands) {
    const p = Object.fromEntries(command.positionals.filter(p => !p.optional).map(p => [p.name, p.multiple ? ['path with spaces', '参数'] : 'path with spaces']));
    if (/^pcb export (svg|dxf|pdf|ps)$/.test(command.path.join(' '))) p.layers = 'F.Cu';
    const args = cliArgs(command, p); assert.deepEqual(args.slice(0, command.path.length), command.path);
    assert.throws(() => cliArgs(command, { ...p, unsafeUnknownFlag: true }), /Unknown/);
  }
});
test('typed CLI flags preserve commas, repeated defines, booleans and literal shell metacharacters', () => {
  const command = commandFor('board.export.gerbers');
  const args = cliArgs(command, { input: '/tmp/$(touch should-not-run).kicad_pcb', outputDir: '/tmp/中文 dir', layers: ['F.Cu', 'B.Cu'], variables: { VERSION: 'literal; value', NAME: 'a=b' }, noNetlist: true });
  assert.ok(args.includes('F.Cu,B.Cu')); assert.equal(args.filter(x => x === '--define-var').length, 2); assert.ok(args.includes('VERSION=literal; value')); assert.ok(args.includes('--no-netlist'));
  assert.throws(() => cliArgs(command, { input: '-bad' }), /prefix/);
  assert.throws(() => cliArgs(command, { input: 'x', noNetlist: 'false' }), /boolean/);
  assert.throws(() => cliArgs(command, { input: 'x', output: 'a', '--output': 'b' }), /Duplicate/);
});
test('CLI inputs accept the IPC document name and plot exports require layers before starting a job', () => {
  const vrml = commandFor('board.export.vrml');
  assert.deepEqual(cliArgs(vrml, { document: '/tmp/a.kicad_pcb' }).slice(-1), ['/tmp/a.kicad_pcb']);
  assert.deepEqual(cliArgs(vrml, { document: { path: '/tmp/a.kicad_pcb', type: 'pcb' } }).slice(-1), ['/tmp/a.kicad_pcb']);
  assert.throws(() => cliArgs(vrml, { input: '/tmp/a.kicad_pcb', document: '/tmp/b.kicad_pcb' }), /only one of/);
  assert.throws(() => cliArgs(vrml, {}), /input \(or document\)/);
  for (const action of ['board.export.svg', 'board.export.dxf', 'board.export.pdf', 'board.export.ps']) {
    assert.throws(() => cliArgs(commandFor(action), { input: '/tmp/a.kicad_pcb' }), /layers is required/);
    assert.ok(cliArgs(commandFor(action), { document: '/tmp/a.kicad_pcb', layers: ['F.Cu', 'Edge.Cuts'] }).includes('F.Cu,Edge.Cuts'));
  }
});
test('native rule summaries count every DRC group and every ERC sheet, preserving full reports', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-rules-test-'));
  try {
    for (const [action, report, total] of [
      ['board.drc.run', { violations: [{ severity: 'error', type: 'clearance' }], unconnected_items: [{ severity: 'warning', type: 'unconnected' }], schematic_parity: [{ severity: 'error', type: 'parity' }] }, 3],
      ['schematic.erc.run', { sheets: [{ violations: [{ severity: 'error', type: 'a' }] }, { violations: [{ severity: 'warning', type: 'b' }] }] }, 2],
    ]) {
      const output = path.join(dir, action + '.json'); const cli = new KiCadCLI({ run: async () => { fs.writeFileSync(output, JSON.stringify(report)); return { exitCode: 5, stdout: '', stderr: '' }; } });
      const result = await cli.action(action, { input: 'fixture', output, full: true }); assert.equal(result.ok, true); assert.equal(result.data.status, 'violations'); assert.equal(result.data.summary.total, total); assert.ok(result.data.reportJson); assert.deepEqual(result.artifacts, [output]);
    }
    const missing = new KiCadCLI({ run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) });
    assert.equal((await missing.action('board.drc.run', { input: 'fixture', output: path.join(dir, 'missing.json') })).error.code, 'REPORT_UNREADABLE');
    assert.equal((await missing.action('board.export.svg', { input: 'fixture', output: path.join(dir, 'missing.svg'), layers: 'F.Cu' })).error.code, 'OUTPUT_MISSING');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('process wrapper preserves split UTF8 and supports real deadline/cancellation without a shell', async () => {
  const utf8 = await execute(process.execPath, ['-e', "const b=Buffer.from('嘉立创');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),10)"]); assert.equal(utf8.stdout, '嘉立创');
  await assert.rejects(execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 20 }), e => e.code === 'TIMEOUT');
  const c = new AbortController(), job = execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: c.signal }); c.abort(); await assert.rejects(job, e => e.code === 'CANCELLED');
  await assert.rejects(execute(process.execPath, ['-e', "process.stdout.write('x'.repeat(2000))"], { maxBytes: 100 }), e => e.code === 'OUTPUT_LIMIT');
});
