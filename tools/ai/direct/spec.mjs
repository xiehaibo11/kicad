// SPDX-License-Identifier: GPL-3.0-or-later
import { object, readJSON, ok, fail, bad } from './utils.mjs';
const kinds = 'POWER MCU RF ANT IO ANALOG SENSOR STORAGE USB DEBUG PROTECTION POWER_MON OTHER'.split(' ');
const zones = 'left center right top bottom left-top left-bottom center-top center-bottom right-top right-bottom left-center center-right any'.split(' ');
export function validateSpec(spec) {
  if (!object(spec)) bad('Spec must be a JSON object');
  const s = structuredClone(spec), issues = [];
  const add = (level, field, message) => issues.push({ level, field, message });
  const check = (value, allowed, field, insensitive = false) => {
    if (value !== undefined && value !== '' && (typeof value !== 'string' || !allowed.includes(insensitive ? value.trim().toLowerCase() : value))) add('ERROR', field, 'Unknown value; expected ' + allowed.join('|'));
  };
  for (const key of ['modules', 'pages', 'interfaces', 'flow']) if (s[key] !== undefined && !Array.isArray(s[key])) bad(`${key} must be an array`);
  const seen = new Set(), kindSeen = new Set();
  if (!s.modules?.length) add('WARN', 'modules', 'No modules declared; zone/flow dimensions have no intent to score against');
  for (const [i, m] of (s.modules ?? []).entries()) {
    if (!object(m)) bad('modules[] must contain objects');
    const field = `modules[${i}]`, name = String(m.name ?? '').trim(), kind = String(m.kind || name).trim().toUpperCase();
    if (!name || seen.has(name.toUpperCase())) add('ERROR', field + '.name', 'Module name is required and must be unique');
    seen.add(name.toUpperCase());
    check(m.zone, zones, field + '.zone');
    if (m.kind && !kinds.includes(String(m.kind).trim().toUpperCase())) add('ERROR', field + '.kind', 'Unknown module kind');
    if (kinds.includes(kind)) kindSeen.add(kind);
    else if (s.flow?.length) add('WARN', field + '.kind', 'Module has no kind and cannot participate in flow-order');
    if (!m.parts?.length && !m.block) add('INFO', field + '.parts', 'Module declares neither parts nor a block');
  }
  const flow = new Set();
  for (const [i, f] of (s.flow ?? []).entries()) {
    const kind = String(f).trim().toUpperCase();
    if (!kinds.includes(kind) || flow.has(kind)) add('ERROR', `flow[${i}]`, 'Flow stages must be valid, nonempty and unique');
    else if (s.modules?.length && !kindSeen.has(kind)) add('WARN', `flow[${i}]`, 'No module of this kind on the board');
    flow.add(kind);
  }
  if (!s.flow?.length) add('INFO', 'flow', 'No signal flow declared; flow-order dimension is skipped');
  else if (flow.size < 2) add('WARN', 'flow', 'Fewer than two stages cannot express an order');
  check(s.flowAxis, ['x', 'y', 'auto'], 'flowAxis', true);
  for (const [i, value] of (s.interfaces ?? []).entries()) {
    if (!object(value)) bad('interfaces[] must contain objects');
    const field = `interfaces[${i}]`;
    if (!value.name && !value.ref) add('ERROR', field, 'Interface needs a name or ref');
    check(value.edge, ['left', 'right', 'top', 'bottom', 'any'], field + '.edge', true);
    check(value.facing, ['user-facing', 'internal', 'any'], field + '.facing', true);
    if (value.internal && value.facing?.toLowerCase() === 'user-facing') add('ERROR', field, 'internal contradicts user-facing');
    if (!value.ref) add('INFO', field + '.ref', 'No ref; connector rules fall back to heuristics');
    if (value.plugWidthMm < 0) add('ERROR', field + '.plugWidthMm', 'Plug width must be positive');
  }
  if (typeof s.board === 'string') s.board = { outline: s.board };
  if (s.stackup) {
    if (!s.stackup.layers) add('INFO', 'stackup.layers', 'Layer count not declared');
    else if (![1, 2, 4, 6, 8, 10].includes(s.stackup.layers)) add('WARN', 'stackup.layers', 'Unusual layer count');
    if (s.stackup.layers > 2 && !(s.stackup.innerLayers?.length || s.stackup.inner1 || s.stackup.inner2)) add('WARN', 'stackup', 'No inner layer roles');
  }
  check(s.assembly?.profile, ['hand-solder', 'reflow'], 'assembly.profile', true);
  issues.sort((a, b) => ['ERROR', 'WARN', 'INFO'].indexOf(a.level) - ['ERROR', 'WARN', 'INFO'].indexOf(b.level) || a.field.localeCompare(b.field));
  return { spec: s, issues };
}
export function specAction(p) {
  const data = validateSpec(p.spec ?? readJSON(p.input));
  return data.issues.some(i => i.level === 'ERROR') ? fail('spec.validate', 'SPEC_INVALID', 'Spec contains errors', data) : ok('spec.validate', data);
}
