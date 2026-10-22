// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import rules from './data/audit-rules.json' with { type: 'json' };
import { parse, head, children, child, values, value } from './sexpr.mjs';
import { bad, ok, fail, required, hashFile, readJSON, writeJSON, tempDir } from './utils.mjs';
export { rules as auditRules };
export function inputFile(file, extension) {
  if (typeof file !== 'string' || !file) bad('Input file is required');
  file = path.resolve(file);
  if (path.extname(file).toLowerCase() !== extension || !fs.statSync(file).isFile()) bad(`Expected a regular ${extension} file`);
  return file;
}
export function auditFootprint(p) {
  const input = inputFile(p.input, '.kicad_mod');
  if (fs.statSync(input).size > 16 * 1024 * 1024) bad('Footprint exceeds 16 MiB');
  const root = parse(fs.readFileSync(input, 'utf8'));
  if (!['footprint', 'module'].includes(head(root))) bad('Expected a footprint/module expression');
  const findings = [], definitions = { courtyard: false, 'fabrication-layer': false, reference: false, value: false }; let padCount = 0;
  const add = (name, status, detail) => findings.push({ name, status, detail });
  const positive = v => Number.isFinite(Number(v)) && Number(v) > 0;
  function visit(node) {
    const name = head(node), v = values(node);
    if (name === 'layer') { if (v[0]?.endsWith('.CrtYd')) definitions.courtyard = true; if (v[0]?.endsWith('.Fab')) definitions['fabrication-layer'] = true; }
    if (name === 'fp_text') { if (v[0] === 'reference') definitions.reference = true; if (v[0] === 'value') definitions.value = true; }
    if (name === 'property') { if (v[0] === 'Reference') definitions.reference = true; if (v[0] === 'Value') definitions.value = true; }
    if (name === 'pad') {
      padCount++; const [id, kind] = v, size = values(child(node, 'size')), layers = values(child(node, 'layers'));
      if (!positive(size[0]) || !positive(size[1])) add('pad-size', 'fail', `Pad ${id} needs positive X/Y dimensions`);
      if (!layers.length) add('pad-layers', 'fail', `Pad ${id} has no layers`);
      if (kind !== 'np_thru_hole' && (!id || !layers.some(l => l.endsWith('.Cu')))) add('electrical-pad', 'fail', 'Electrical pad needs number and copper layer');
      if (['thru_hole', 'np_thru_hole'].includes(kind)) {
        const drill = values(child(node, 'drill')), dims = drill[0] === 'oval' ? drill.slice(1, 3) : [drill[0], drill[0]];
        if (dims.some(d => !positive(d))) add('pad-drill', 'fail', `Pad ${id} needs positive drill dimensions`);
        else if (kind === 'thru_hole' && dims.some((d, i) => Number(d) >= Number(size[i]))) add('pad-annulus', 'fail', `Pad ${id} drill leaves no annular ring`);
      }
    }
    for (const c of node.children ?? []) if (c.children) visit(c);
  }
  visit(root);
  if (!padCount) add('pads', 'blocked', 'No pads; confirm this is intentionally mechanical');
  for (const [name, present] of Object.entries(definitions)) if (!present) add(name, 'blocked', 'Definition missing; review package/library requirements');
  const data = { input, sha256: hashFile(input), padCount, findings, structuralChecksPassed: !findings.length, readyForFabrication: false, pendingEvidence: ['Native board DRC for clearances, courtyard closure and solder mask', 'Datasheet pin mapping, package dimensions, exposed pad and polarity', '3D/mechanical/assembly fit; structural checks are not complete KLC or IPC-7351 certification'] };
  return findings.length ? fail('audit.footprint', 'FOOTPRINT_NOT_PASSED', 'Invalid geometry or incomplete definitions', data) : ok('audit.footprint', data);
}
export function nativeCheck(name, result) {
  const report = result?.data?.reportJson, blocked = detail => ({ name, status: 'blocked', detail });
  if (!result?.ok || !report) return blocked(result ?? 'Missing native result');
  const arrays = ['violations', ...(name === 'native-drc' ? ['unconnected_items', 'schematic_parity'] : []), 'ignored_checks', 'included_severities'];
  for (const key of arrays) if (!Array.isArray(report[key])) return blocked('Native array missing or malformed: ' + key);
  for (const s of ['error', 'warning', 'exclusion']) if (!report.included_severities.includes(s)) return blocked('Full severity scope missing: ' + s);
  const violations = ['violations', 'unconnected_items', 'schematic_parity'].reduce((n, k) => n + (report[k]?.length ?? 0), 0);
  return { name, status: violations || result.data.status === 'violations' ? 'fail' : result.data.status === 'clean' && !report.ignored_checks.length ? 'pass' : 'blocked', detail: { violations, ignoredChecks: report.ignored_checks, report: result.data.report, nativeReport: report } };
}
export async function audit(p, dispatch) {
  const board = inputFile(required(p, 'board'), '.kicad_pcb'), stem = board.slice(0, -'.kicad_pcb'.length), dir = tempDir('kicad-design-audit-');
  const report = { policyVersion: rules.version, createdAt: new Date().toISOString(), board, inputSha256: {}, checks: [], pendingEvidence: [], nativeChecksPassed: false, readyForFabrication: false, note: 'Native checks audit the saved snapshot using project rules. Datasheet, manufacturing, mechanical and application-specific evidence is required separately. No source design is changed.' };
  const add = (name, status, detail) => report.checks.push({ name, status, ...(detail !== undefined ? { detail } : {}) });
  const capture = file => { report.inputSha256[file] = hashFile(file); };
  capture(board);
  for (const f of [stem + '.kicad_pro', stem + '.kicad_dru']) if (fs.existsSync(f)) capture(f);
  let constraints = {};
  try { constraints = readJSON(stem + '.kicad_pro').board?.design_settings?.rules ?? {}; } catch { /* blocked below */ }
  add('project-rules', Object.keys(constraints).length ? 'pass' : 'blocked', constraints);
  let schematic = p.schematic || (fs.existsSync(stem + '.kicad_sch') ? stem + '.kicad_sch' : '');
  if (schematic) { schematic = inputFile(schematic, '.kicad_sch'); capture(schematic); }
  const artifacts = [];
  for (const [name, action, payload] of [
    ['native-drc', 'board.drc.run', { input: board, allTrackErrors: true, refillZones: true, schematicParity: Boolean(schematic) }],
    ...(schematic ? [['native-erc', 'schematic.erc.run', { input: schematic }]] : []),
  ]) {
    const result = await dispatch(action, { ...payload, severityAll: true, full: true, format: 'json', output: path.join(dir, name + '.json') });
    artifacts.push(...(result.artifacts ?? [])); report.checks.push(nativeCheck(name, result));
  }
  if (!schematic) add('native-erc-and-parity', 'blocked', 'Corresponding schematic is missing');
  else if (schematic !== stem + '.kicad_sch') add('schematic-parity', 'blocked', 'Explicit schematic is not the board sibling');
  const profile = p.manufacturingProfile || (fs.existsSync(path.join(path.dirname(board), 'manufacturing.json')) ? path.join(path.dirname(board), 'manufacturing.json') : '');
  if (!profile) add('manufacturing-constraints', 'blocked', 'Manufacturer limits and stackup have not been supplied');
  else {
    const file = path.resolve(profile), limits = readJSON(file); capture(file);
    const pairs = { minClearanceMm: 'min_clearance', minTrackWidthMm: 'min_track_width', minDrillMm: 'min_through_hole_diameter', minAnnularWidthMm: 'min_via_annular_width', minCopperEdgeClearanceMm: 'min_copper_edge_clearance' };
    const details = Object.entries(pairs).map(([name, key]) => ({ name, status: !Number.isFinite(limits[name]) || limits[name] <= 0 || !Number.isFinite(constraints[key]) ? 'blocked' : constraints[key] < limits[name] ? 'fail' : 'pass', detail: { manufacturerMinMm: limits[name], projectMinMm: constraints[key] } }));
    add('manufacturing-constraints', details.some(d => d.status === 'fail') ? 'fail' : details.some(d => d.status === 'blocked') ? 'blocked' : 'pass', details);
    if (fs.existsSync(stem + '.kicad_dru')) report.pendingEvidence.push('Review custom-rule overrides against manufacturer limits; global minima cannot prove every constraint.');
  }
  for (const [file, before] of Object.entries(report.inputSha256)) {
    try { if (hashFile(file) !== before) add('snapshot-stability', 'blocked', file); } catch { add('snapshot-stability', 'blocked', file); }
  }
  report.nativeChecksPassed = Boolean(schematic) && report.checks.every(c => !c.name.startsWith('native-') && !['snapshot-stability', 'schematic-parity'].includes(c.name) || c.status === 'pass');
  for (const c of report.checks) if (c.status !== 'pass') report.pendingEvidence.push(`${c.name}: ${c.status}`);
  report.pendingEvidence.push('Datasheet-based footprint/pin/electrical review and package identity remain unverified.', 'Mechanical/assembly fit and application-specific electrical, thermal, high-speed and safety constraints require separate evidence.');
  const output = path.resolve(p.output ?? path.join(dir, 'audit.json'));
  // Never allow an audit artifact to overwrite the source or an existing report.
  writeJSON(output, report, { exclusive: true }); artifacts.push(output);
  return report.checks.every(c => c.status === 'pass') ? ok('audit.run', report, artifacts) : fail('audit.run', 'AUDIT_NOT_PASSED', 'Violations or incomplete evidence; see checks and artifacts', report, artifacts);
}
