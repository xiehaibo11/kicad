// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { bad, required, readJSON, number, ok, fail, DirectError } from './utils.mjs';
import { call, idOf, itemsOf } from './board-common.mjs';
import { discover } from './project.mjs';
export function validateCircuit(spec) {
  if (!Array.isArray(spec.components) || !spec.components.length || !Array.isArray(spec.nets ?? [])) bad('Circuit spec requires components[] and nets[]');
  const keys = new Set(), refs = new Map(), nets = new Set(), pinNets = new Map();
  for (const c of spec.components) {
    if (typeof c.reference !== 'string' || !/^[A-Za-z][\w?]*$/.test(c.reference) || typeof c.libId !== 'string' || !c.libId.includes(':')) bad('Each component requires a reference and Library:Symbol');
    const unit = c.unit ?? 1; if (!Number.isInteger(unit) || unit < 1) bad('unit must be a positive integer');
    const key = c.reference + '.' + unit; if (keys.has(key)) bad('Duplicate component/unit: ' + key); keys.add(key);
    refs.set(c.reference, [...(refs.get(c.reference) ?? []), unit]);
    if (c.position) { number(required(c.position, 'xMm')); number(required(c.position, 'yMm')); }
  }
  for (const n of spec.nets ?? []) {
    if (typeof n.name !== 'string' || !n.name.trim() || nets.has(n.name) || !Array.isArray(n.pins)) bad('Net names must be nonempty and unique, with pins[]'); nets.add(n.name);
    for (const pin of n.pins) {
      const parts = String(pin).split('.'), ref = parts[0], number = parts.at(-1), units = refs.get(ref);
      if (![2, 3].includes(parts.length) || !number || !units || parts.length === 3 && !units.includes(Number(parts[1])) || parts.length === 2 && units.length !== 1) bad('Pin reference is missing or ambiguous: ' + pin);
      const key = ref + '.' + (parts.length === 3 ? parts[1] : units[0]) + '.' + number;
      if (pinNets.has(key)) bad('Pin assigned more than once: ' + pin); pinNets.set(key, n.name);
    }
  }
  return { refs, pinNets };
}
export async function generateSchematic(p, dispatch) {
  const action = 'schematic.generate', spec = typeof p.spec === 'string' ? readJSON(p.spec) : required(p, 'spec'), validated = validateCircuit(spec), project = path.resolve(p.project ?? '.');
  let file = p.document && path.resolve(typeof p.document === 'string' ? p.document : p.document.path);
  if (!file) {
    const candidates = fs.existsSync(project) ? discover(project, 0).filter(e => e.schematic) : [];
    if (candidates.length > 1) bad('Select an explicit schematic document');
    file = p.new || !candidates.length ? path.join(project, path.basename(project) + '.kicad_sch') : candidates[0].schematic;
  }
  if (!file.endsWith('.kicad_sch')) bad('document must be a .kicad_sch');
  if (p.new && fs.existsSync(file)) bad('new:true refuses to overwrite an existing schematic');
  const components = spec.components.map((c, i) => ({ ...c, unit: c.unit ?? 1, position: { xMm: Math.round(number(c.position?.xMm, 50 + i % 6 * 30) / 1.27) * 1.27, yMm: Math.round(number(c.position?.yMm, 50 + Math.floor(i / 6) * 30) / 1.27) * 1.27 } }));
  const data = { project, schematic: file, dryRun: p.dryRun ?? false, components: [], nets: [], createdIds: [], saved: false, ercRan: false, ercOk: false };
  if (p.dryRun) return ok(action, { ...data, applied: false, components, nets: spec.nets, plannedLabels: spec.generateLabels === false ? 0 : validated.pinNets.size });
  let document = { type: 'schematic', path: file };
  try {
    // Native symbol-library serialization needs an open schematic context.
    // Create/open the document first, then resolve all libraries before placing items.
    if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); document = (await call(dispatch, 'schematic.create', { path: file })).document ?? document; data.documentCreated = true; }
    else await call(dispatch, 'project.open', { document:file });
    for (const libId of new Set(components.map(c => c.libId))) await call(dispatch, 'library.get.symbol', { libId });
    const pins = new Map();
    for (const c of components) {
      const result = await call(dispatch, 'schematic.place.symbol', { document, ...c });
      const id = idOf({ id: result.item ?? result.symbol?.id }); if (id) data.createdIds.push(id);
      if (!result.pins?.length) throw new DirectError('SYMBOL_PINS_MISSING', c.reference + ' was placed but returned no pins');
      for (const pin of result.pins) {
        if (!pin.position || pin.position.xNm === undefined || pin.position.yNm === undefined) bad('Native symbol pin position is missing');
        pins.set(c.reference + '.' + c.unit + '.' + pin.number, pin.position);
      }
      data.components.push({ reference: c.reference, libId: c.libId, unit: c.unit, id, status: 'placed' });
    }
    if (spec.generateLabels !== false) {
      const labels = [];
      for (const [key, name] of validated.pinNets) {
        const position = pins.get(key); if (!position) bad('Native symbol has no pin ' + key);
        labels.push({ type: 'label', json: { position, text: { text: name } } });
      }
      for (let i = 0; i < labels.length; i += 50) {
        const result = await call(dispatch, 'schematic.items.create', { document, items: labels.slice(i, i + 50) }), created = itemsOf(result);
        data.createdIds.push(...created.map(idOf).filter(Boolean));
        if (created.length !== Math.min(50, labels.length - i)) throw new DirectError('LABEL_CREATE_INCOMPLETE', 'Native creation returned fewer labels than requested');
      }
      data.nets = (spec.nets ?? []).map(n => ({ name: n.name, labels: n.pins.length, status: 'labeled' }));
    }
    if (spec.annotate || components.some(c => c.reference.endsWith('?'))) { data.annotation = await call(dispatch, 'schematic.annotate', { document, reset: true, start: 1 }); data.annotated = true; }
    await call(dispatch, 'document.save', { document, type: 'schematic' }); data.saved = true;
    if (!p.noErc) { data.ercRan = true; data.erc = await dispatch('schematic.erc.live', { document, full: true, severityAll: true }); data.ercOk = data.erc.ok && data.erc.data?.summary?.total === 0; if (!data.ercOk) return fail(action, 'SCHEMATIC_ERC_NOT_CLEAN', 'Schematic created; ERC failed or found violations', data); }
    return ok(action, data, [file]);
  } catch (err) { return fail(action, err.code ?? 'SCHEMATIC_GENERATION_FAILED', err.message, { ...data, partial: data.createdIds.length > 0, cause: err.detail }); }
}
