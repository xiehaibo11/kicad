// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import catalog from './data/cli-commands.json' with { type: 'json' };
import actions from './data/actions.json' with { type: 'json' };
import { bad, required, ok, fail, execute, tempDir, readJSON, array, object } from './utils.mjs';

const camel = s => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
export const cliCommands = catalog.commands;
const byPath = new Map(cliCommands.map(c => [c.path.join(' '), c]));
const actionPaths = new Map(actions.filter(a => a.cli?.length).map(a => [a.name, Array.isArray(a.cli) ? a.cli : a.cli.split(' ')]));
export function commandFor(action) {
  return byPath.get(actionPaths.get(action)?.join(' '));
}
export function outputIsDirectory(action, p) {
  if (action === 'board.export.svg') return p.modeMulti === true;
  if (action === 'board.export.pdf') return p.modeSeparate === true;
  return ['board.export.gerbers','board.export.drill','schematic.export.svg',
    'schematic.export.dxf','schematic.export.png','schematic.export.ps',
    'library.footprint.export_svg','library.symbol.export_svg'].includes(action);
}
const layerPlots = new Set(['pcb export svg', 'pcb export dxf', 'pcb export pdf', 'pcb export ps']);
export function cliArgs(command, input) {
  if (!command) bad('Unknown CLI command');
  const p = { ...input }, args = [...command.path];
  delete p.timeoutMs; delete p.dryRun;
  if (p.inputs !== undefined) { const pos = command.positionals.find(p => p.multiple); if (!pos) bad('inputs is unsupported by this command'); p[pos.name] = p.inputs; delete p.inputs; }
  for (const key of ['defineVars', 'variables']) if (p[key] !== undefined) { if (!object(p[key])) bad(key + ' must be an object'); p.defineVar = Object.entries(p[key]).map(([k, v]) => k + '=' + v); delete p[key]; }
  // IPC actions name the board/schematic "document"; accept it here too. CLI jobs read the saved file.
  const positionalAliases = command.positionals.length === 2 ? [['fileA', 'a', 'dir1'], ['fileB', 'b', 'dir2']] : [['input', 'file', 'project', 'document']];
  for (const [i, pos] of command.positionals.entries()) {
    const names = [...new Set([pos.name, pos.name.toLowerCase(), camel(pos.name.toLowerCase().replaceAll('_', '-')), ...(positionalAliases[i] ?? [])])];
    const present = names.filter(n => p[n] !== undefined);
    if (present.length > 1) bad(`Use only one of ${present.join(', ')} for ${pos.name}`);
    const key = present[0];
    if (!key) { if (!pos.optional) bad(`${pos.name} is required; pass the file path as input (or document)`); continue; }
    if (key === 'document' && object(p.document) && typeof p.document.path === 'string') p.document = p.document.path;
    const values = pos.multiple ? array(p[key]) : [p[key]];
    if (!values.length || values.some(v => typeof v !== 'string' || !v || v.startsWith('-'))) bad(`${key} must contain paths; prefix a path beginning with '-' with './'`);
    args.push(...values); delete p[key];
  }
  if (p.outputDir !== undefined) { if (p.output !== undefined) bad('Use output or outputDir, not both'); p.output = p.outputDir; delete p.outputDir; }
  for (const opt of command.options) {
    const flag = opt.long || opt.aliases[0], bare = flag.replace(/^-+/, '');
    const keys = [flag, bare, camel(bare), ...opt.aliases.flatMap(a => [a, a.replace(/^-+/, '')])];
    const present = [...new Set(keys)].filter(k => p[k] !== undefined);
    if (present.length > 1) bad('Duplicate option ' + flag);
    if (!present.length) continue;
    const key = present[0], value = p[key]; delete p[key];
    if (!opt.value) {
      if (typeof value !== 'boolean') bad(`${key} must be boolean`);
      if (value) args.push(flag);
    } else {
      const values = Array.isArray(value) && !opt.repeat ? [value.join(',')] : Array.isArray(value) ? value : [value];
      for (const val of values) {
        if (!['number', 'string'].includes(typeof val) || typeof val === 'number' && !Number.isFinite(val)) bad(`${key} must be a string or finite number`);
        args.push(flag, String(val));
      }
    }
  }
  if (Object.keys(p).length) bad('Unknown CLI option(s): ' + Object.keys(p).join(', '));
  // Native plot jobs fail with "At least one layer must be specified" after the process starts.
  if (layerPlots.has(command.path.join(' ')) && !args.includes('--layers')) bad('layers is required: comma separated layer names such as F.Cu,F.SilkS,Edge.Cuts');
  return args;
}
const groups = ['violations', 'unconnected_items', 'schematic_parity'];
export function summarize(report, reportPath) {
  const summary = { reportPath, total: 0, bySeverity: {}, byType: {} };
  if (report.sheets) report.violations = report.sheets.flatMap(s => s.violations ?? []);
  for (const group of groups) {
    const list = report[group] ?? [];
    summary[group] = list.length; summary.total += list.length;
    for (const v of list) {
      const severity = v.severity || 'unknown', kind = v.type || 'unknown';
      summary.bySeverity[severity] = (summary.bySeverity[severity] ?? 0) + 1;
      summary.byType[kind] = (summary.byType[kind] ?? 0) + 1;
    }
  }
  if (report.ignored_checks) summary.ignoredChecks = report.ignored_checks;
  return summary;
}
export class KiCadCLI {
  constructor({ binary = process.env.KICAD_CLI || 'kicad-cli', run = execute } = {}) { this.binary = binary; this.run = run; }
  async raw(args, options = {}) {
    if (!Array.isArray(args) || !['version', 'pcb', 'sch', 'sym', 'fp', 'gerber', 'import', 'jobset', 'api-server', 'mergetool', '--help', '--version'].includes(args[0])) bad('CLI subcommand is not allowed');
    const data = await this.run(this.binary, args, options);
    return data.exitCode === 0 ? ok('kicad.cli.run', { args, ...data }) : fail('kicad.cli.run', 'KICAD_CLI_FAILED', `kicad-cli exited with ${data.exitCode}`, { args, ...data });
  }
  async action(action, input, options = {}) {
    if (action === 'system.version') {
      const res = await this.raw(['version'], options);
      return res.ok ? ok(action, { version: res.data.stdout }) : { ...res, action };
    }
    if (action === 'kicad.cli.run') {
      if (input.dryRun) return ok(action, { dryRun: true, args: required(input, 'args'), applied: false });
      return this.raw(required(input, 'args'), { ...options, timeoutMs: input.timeoutMs ?? options.timeoutMs });
    }
    const p = { ...input };
    const rules = ['board.drc.run', 'schematic.erc.run'].includes(action);
    let command = commandFor(action);
    if (action === 'board.export.step' && p.format) { command = byPath.get('pcb export ' + (p.format === 'stepz' ? 'stpz' : p.format)); delete p.format; }
    if (rules) return this.rules(action, p, command, options);
    const args = cliArgs(command, p);
    if (p.dryRun) return ok(action, { dryRun: true, applied: false, args });
    let output = p.output ?? p.outputDir;
    // jobset --output selects a destination ID, not a filesystem path.
    if (action === 'project.jobset.run') output = undefined;
    // Native import treats --output as a project stem and sets this extension.
    if (action === 'project.import' && output) { const parsed=path.parse(output); output=path.join(parsed.dir,parsed.name+'.kicad_pro'); }
    // Help text can describe both files and directories. Choose from the
    // command's output contract/mode; creating "board.pdf/" breaks native jobs.
    if (output) fs.mkdirSync(outputIsDirectory(action,p) ? output : path.dirname(output), { recursive: true });
    const data = await this.run(this.binary, args, { ...options, timeoutMs: p.timeoutMs ?? options.timeoutMs });
    if (data.exitCode) return fail(action, 'KICAD_CLI_FAILED', `${action} exited with ${data.exitCode}`, data);
    if (output) {
      const nonempty = file => { const stat = fs.statSync(file); return stat.isDirectory() ? fs.readdirSync(file).some(name => fs.statSync(path.join(file, name)).isFile() && fs.statSync(path.join(file, name)).size > 0) : stat.size > 0; };
      if (!fs.existsSync(output) || !nonempty(output)) return fail(action, 'OUTPUT_MISSING', 'Native CLI exited successfully without producing a nonempty output', { ...data, output });
    }
    const result = ok(action, { ...data, ...(action.endsWith('.diff') ? { diff: data.stdout } : {}) }, [output].filter(Boolean));
    if (data.stderr) result.diagnostics = [{ severity: 'info', code: 'KICAD_CLI_STDERR', message: data.stderr }];
    return result;
  }
  async rules(action, p, command, options) {
    const full = p.full, sample = p.sampleViolations ?? 50;
    delete p.full; delete p.sampleViolations;
    if (!Number.isInteger(sample) || sample < 1 || sample > 10000) bad('sampleViolations must be 1..10000');
    p.format ??= 'json'; p.exitCodeViolations = true;
    // Keep the complete report as an artifact, including failure/timeout evidence.
    p.output ??= path.join(tempDir('kicad-rules-'), 'report.' + p.format);
    if (p.timeoutMs) p.timeout = p.timeoutMs;
    const args = cliArgs(command, p);
    if (p.dryRun) return ok(action, { dryRun: true, applied: false, args });
    fs.mkdirSync(path.dirname(p.output), { recursive: true });
    const processResult = await this.run(this.binary, args, { ...options, timeoutMs: p.timeoutMs ?? options.timeoutMs });
    const { exitCode, stderr } = processResult;
    const status = ({ 0: 'clean', 5: 'violations', 8: 'timeout', 9: 'cancelled' })[exitCode];
    if (!status) return fail(action, 'KICAD_CLI_FAILED', `Rules check exited with ${exitCode}`, processResult, [p.output]);
    const data = { status, exitCode, report: p.output, reportPath: p.output }, diagnostics = [];
    if (p.format === 'json') {
      try {
        const report = readJSON(p.output), bytes = fs.statSync(p.output).size;
        data.summary = summarize(report, p.output);
        if (full || bytes <= 256 * 1024) data.reportJson = report;
        else {
          Object.assign(data, { reportJsonOmitted: true, reportBytes: bytes, sampleViolations: groups.flatMap(g => (report[g] ?? []).map(v => ({ group: g, ...v }))).slice(0, sample), next: 'Read reportPath for the complete report, or use full=true.' });
        }
      } catch (err) { diagnostics.push({ severity: 'error', code: 'REPORT_UNREADABLE', message: err.message }); }
    }
    if (stderr) diagnostics.push({ severity: 'info', code: 'KICAD_CLI_STDERR', message: stderr });
    const code = status === 'timeout' ? 'TIMEOUT' : status === 'cancelled' ? 'CANCELLED' : diagnostics.some(d => d.severity === 'error') ? 'REPORT_UNREADABLE' : '';
    const result = code ? fail(action, code, 'Native rules check did not produce complete evidence', data, [p.output]) : ok(action, data, [p.output]);
    if (diagnostics.length) result.diagnostics = diagnostics;
    return result;
  }
}
