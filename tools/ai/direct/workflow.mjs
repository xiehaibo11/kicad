// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { bad, required, readJSON, writeJSON, ok, DirectError } from './utils.mjs';
export const stages = ['spec', 'schematic', 'netlist', 'board', 'place', 'planes', 'fanout', 'route', 'dfm', 'drc', 'connectivity', 'manufacturing', 'verified'];
const fresh = project => ({ project, stages: Object.fromEntries(stages.map(s => [s, 'pending'])), confirmed: {} });
export function workflow(action, p) {
  const project = path.resolve(p.project ?? '.'), file = path.join(project, '.kicad-agent/workflow.json');
  let state = fs.existsSync(file) ? readJSON(file) : fresh(project);
  state.stages ??= {}; state.confirmed ??= {};
  for (const stage of stages) state.stages[stage] ??= 'pending';
  state.stages.verified = 'pending'; state.project = project;
  if (action === 'workflow.advance') {
    const stage = p.stage || stages.find(s => state.stages[s] !== 'ok'), index = stages.indexOf(stage);
    if (index < 0) bad('Unknown stage');
    if (stage === 'verified') throw new DirectError('EVIDENCE_GATE_REQUIRED', 'Workflow flags cannot confer engineering approval; use release.check');
    const blocked = stages.slice(0, index).find(s => state.stages[s] !== 'ok');
    if (blocked) throw new DirectError('GATE_BLOCKED', blocked + ' is not complete');
    state.stages[stage] = 'ok';
  }
  if (action === 'workflow.confirm') state.confirmed[required(p, 'confirmation')] = true;
  if (action === 'workflow.reset') {
    if (p.resetAll) state = fresh(project);
    else {
      const index = stages.indexOf(p.resetFrom);
      if (index < 0) bad('resetFrom must be a known stage');
      for (const stage of stages.slice(index)) state.stages[stage] = 'pending';
    }
  }
  Object.assign(state, { scope: 'Task tracking only. Confirmations are operator notes, not authenticated approvals. Use release.check for current evidence; final release requires accountable engineering/quality/manufacturer review.', readyForFabrication: false, readyForProduction: false });
  if (action !== 'workflow.status' && !p.dryRun) { state.updatedAt = new Date().toISOString(); writeJSON(file, state); }
  return ok(action, { ...state, ...(p.dryRun ? { dryRun: true, applied: false } : {}) });
}
