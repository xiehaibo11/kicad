// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { executable, execute, required, bad, ok, fail, positive } from './utils.mjs';
export const allowedCommands = ['kicad-cli', 'ngspice', 'gerbv', 'openscad', 'FreeCAD', 'freecadcmd', 'iverilog', 'verilator'];
export function detectTools(cli) {
  return ['kicad-cli', 'freerouting', 'java', 'ngspice', 'gerbv', 'openscad', 'FreeCAD', 'python3', 'kicad-stepcheck'].map(name => {
    const file = executable(name === 'kicad-cli' ? cli : name === 'kicad-stepcheck' ? process.env.KICAD_STEPCHECK ?? name : name);
    return { name, available: Boolean(file), ...(file ? { path: file } : { error: 'not found' }) };
  });
}
export async function external(action, p, options = {}, run = execute) {
  let binary, args = [], output;
  if (action === 'external.freerouting.run') {
    const input = required(p, 'input'), jar = p.jar ?? process.env.FREEROUTING_JAR;
    binary = jar ? 'java' : 'freerouting'; args = jar ? ['-jar', jar] : [];
    output = p.output ?? input.replace(/\.[^.]+$/, '') + '.ses'; args.push('-de', input, '-do', output);
    if (p.passes !== undefined) args.push('-mp', String(positive(p.passes)));
    args.push(...(p.args ?? []));
  } else if (action === 'external.ngspice.run') {
    const input = required(p, 'input'); output = p.output ?? input.replace(/\.[^.]+$/, '') + '.log';
    binary = 'ngspice'; args = ['-b', '-o', output, input];
  } else if (action === 'external.step.meshcheck') {
    binary = process.env.KICAD_STEPCHECK ?? 'kicad-stepcheck'; args = [required(p, 'input')];
    if (p.minVolumeMm3 !== undefined) args.push('--min-volume-mm3', String(positive(p.minVolumeMm3)));
    if (p.maxPairs !== undefined) args.push('--max-pairs', String(positive(p.maxPairs)));
  } else {
    binary = required(p, 'command');
    if (p.allowlist !== undefined || !allowedCommands.includes(path.basename(binary))) bad('External command is not allowlisted; payload cannot widen the allowlist');
    args = action === 'external.step.check' ? [required(p, 'input'), ...(p.enclosure ? ['--enclosure', p.enclosure] : []), ...(p.args ?? [])] : p.args ?? [];
  }
  if (!Array.isArray(args) || args.length > 128 || args.some(v => typeof v !== 'string' || Buffer.byteLength(v) > 4096 || v.includes('\0'))) bad('Invalid command arguments');
  if (p.dryRun) return ok(action, { dryRun: true, applied: false, command: binary, args });
  const resolved = executable(binary);
  if (!resolved) return fail(action, 'TOOL_MISSING', 'Executable not found: ' + binary);
  const result = await run(resolved, args, { ...options, timeoutMs: p.timeoutMs ?? options.timeoutMs });
  let data = { command: resolved, args, ...result };
  if (action === 'external.step.meshcheck') {
    try { data = { ...data, ...JSON.parse(result.stdout) }; }
    catch { return fail(action, 'STEPCHECK_BAD_OUTPUT', 'Checker returned invalid JSON', data); }
  }
  if (result.exitCode) return fail(action, action.endsWith('meshcheck') && result.exitCode === 5 ? 'STEP_COLLISIONS' : 'EXTERNAL_COMMAND_FAILED', 'External tool failed', data, output ? [output] : []);
  if (output && (!fs.existsSync(output) || !fs.statSync(output).size)) return fail(action, 'OUTPUT_MISSING', 'Tool exited successfully without producing its output', data);
  return ok(action, data, output ? [output] : []);
}
