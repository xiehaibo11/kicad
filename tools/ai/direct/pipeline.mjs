// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { required, bad, readJSON, writeJSON, ok, fail } from './utils.mjs';
import { projectInfo } from './project.mjs';
export const pipelineStages = ['spec', 'health', 'schematic', 'netlist', 'board', 'place', 'planes', 'fanout', 'route', 'save', 'drc', 'connectivity', 'manufacturing', 'verify'];
export async function pipeline(action, p, dispatch) {
  const info = projectInfo(p.project ?? '.'), project = info.directory, stateFile = path.join(project, '.kicad-agent/pipeline-report.json');
  if (action.endsWith('.status')) return ok(action, fs.existsSync(stateFile) ? readJSON(stateFile) : { project, status: 'not-started' });
  const selected = p.stages ?? pipelineStages;
  if (!Array.isArray(selected) || selected.some(s => !pipelineStages.includes(s)) || new Set(selected).size !== selected.length) bad('stages must be unique pipeline stage names');
  const { board, schematic } = info.documents, artifactDir = path.join(project, '.kicad-agent/artifacts'), netlist = path.join(artifactDir, 'netlist.net'), manufacturing = path.join(artifactDir, 'manufacturing');
  const spec = p.spec ? readJSON(p.spec) : {}, document = board, steps = [];
  const add = (name, action, payload, missing) => { if (selected.includes(name)) steps.push({ name, action, payload, ...(missing ? { unavailable: missing } : {}) }); };
  add('spec', 'spec.validate', { input: p.spec }, !p.spec && 'No spec supplied');
  add('health', 'system.health', {});
  add('schematic', 'schematic.erc.run', { input: schematic, format: 'json', full: true, severityAll: true, output: path.join(artifactDir, 'erc.json') }, !schematic && 'No schematic');
  add('netlist', 'schematic.export.netlist', { input: schematic, output: netlist, format: 'kicadsexpr' }, !schematic && 'No schematic');
  add('board', 'board.netlist.import', { document, netlistPath: netlist, updateFootprints: true }, !board && 'No board');
  add('place', 'board.place.autoplace', { document, placeOffboard: false }, !board && 'No board');
  const planes = spec.stackup?.innerLayers ?? [];
  if (selected.includes('planes')) { if (!planes.length) steps.push({ name: 'planes', unavailable: 'No stackup.innerLayers supplied' }); else for (const layer of planes) steps.push({ name: 'planes', action: 'board.plane.build', payload: { document, net: layer.net, layers: [layer.layer ?? layer.name], name: 'PLANE_' + layer.net }, ...(!board ? { unavailable: 'No board' } : {}) }); }
  add('fanout', 'board.fanout.run', { document, reference: p.fanoutReference, dryRun: false }, (!board || !p.fanoutReference) && 'Board and fanoutReference required');
  add('route', 'board.route.autoroute', { document, dryRun: false }, !board && 'No board');
  add('save', 'document.save', { document }, !board && 'No board');
  add('drc', 'board.drc.run', { input: board, format: 'json', full: true, severityAll: true, refillZones: true, output: path.join(artifactDir, 'drc.json') }, !board && 'No board');
  add('connectivity', 'board.connectivity.prove', { document, requireFilledZones: true }, !board && 'No board');
  if (selected.includes('manufacturing')) for (const [exportType, output, extra] of [['gerbers', 'gerbers', {}], ['drill', 'drill', {}], ['position', 'position.csv', { side: 'both', format: 'csv', units: 'mm' }], ['step', 'board.step', {}]]) add('manufacturing', 'board.export.' + exportType, { input: board, output: path.join(manufacturing, output), ...extra }, !board && 'No board');
  const report = { project, dryRun: Boolean(p.dryRun), startedAt: new Date().toISOString(), stages: [], complete: false, readyForFabrication: false, readyForProduction: false };
  if (!p.dryRun) fs.mkdirSync(artifactDir, { recursive: true });
  for (const step of steps) {
    if (p.dryRun) { report.stages.push({ ...step, status: step.unavailable ? 'skipped' : 'planned' }); continue; }
    if (step.unavailable) { report.stages.push({ name: step.name, status: 'skipped', message: step.unavailable }); continue; }
    const started = Date.now(), result = await dispatch(step.action, step.payload);
    const violations = ['drc', 'schematic'].includes(step.name) && result.data?.summary?.total > 0;
    report.stages.push({ name: step.name, action: step.action, status: result.ok && !violations ? 'ok' : 'failed', result, elapsedMs: Date.now() - started });
    if (!result.ok || violations) break;
  }
  report.ok = report.stages.every(s => !['failed'].includes(s.status));
  report.complete = !p.dryRun && selected.length === pipelineStages.length && steps.length > 0 && report.stages.length === steps.length && report.stages.every(s => s.status === 'ok');
  if (selected.includes('verify')) report.stages.push({ name: 'verify', status: p.dryRun ? 'planned' : 'blocked', message: 'Use audit.run and release.check for revision-bound engineering evidence' });
  report.complete = false; report.finishedAt = new Date().toISOString();
  if (!p.dryRun) writeJSON(stateFile, report);
  return report.ok ? ok(action, report) : fail(action, 'PIPELINE_FAILED', 'Pipeline stopped at a failed stage', report);
}
