// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { bad, DirectError, readJSON } from './utils.mjs';

export function discover(directory = '.', depth = 2) {
  if (!Number.isInteger(depth) || depth < 0 || depth > 8) bad('depth must be 0..8');
  directory = path.resolve(directory);
  if (!fs.statSync(directory).isDirectory()) directory = path.dirname(directory);
  const entries = new Map();
  function walk(dir, level) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name), ext = path.extname(file).toLowerCase();
      if (entry.isDirectory()) {
        if (level < depth && !entry.name.startsWith('.') && entry.name !== 'node_modules' && !entry.name.endsWith('-backups')) walk(file, level + 1);
      } else if (entry.isFile() && ['.kicad_pro', '.kicad_pcb', '.kicad_sch'].includes(ext)) {
        const stem = file.slice(0, -ext.length), value = entries.get(stem) ?? { name: path.basename(stem), directory: dir };
        value[({ '.kicad_pro': 'project', '.kicad_pcb': 'board', '.kicad_sch': 'schematic' })[ext]] = file;
        entries.set(stem, value);
      }
    }
  }
  walk(directory, 0);
  return [...entries.values()].sort((a, b) => Number(Boolean(b.project)) - Number(Boolean(a.project)) || (a.directory + '/' + a.name).localeCompare(b.directory + '/' + b.name, 'en'));
}
export function resolveProject(file = '.') {
  file = path.resolve(file);
  if (!fs.existsSync(file)) throw new DirectError('PROJECT_NOT_FOUND', file);
  if (!fs.statSync(file).isDirectory()) {
    if (!['.kicad_pro', '.kicad_pcb', '.kicad_sch'].includes(path.extname(file))) bad('Select a KiCad project, board or schematic');
    return file;
  }
  const entries = discover(file, 0), projects = entries.filter(e => e.project);
  if (projects.length === 1) return projects[0].project;
  if (!projects.length && entries.length === 1) return entries[0].board ?? entries[0].schematic;
  throw new DirectError(entries.length ? 'PROJECT_AMBIGUOUS' : 'DOCUMENT_NOT_FOUND', 'Select a full project path from project.list', entries);
}
export function projectInfo(file) {
  const selected = resolveProject(file), stem = selected.slice(0, -path.extname(selected).length);
  const result = { source: 'file', name: path.basename(stem), directory: path.dirname(stem), documents: {} };
  for (const [key, ext] of Object.entries({ project: '.kicad_pro', board: '.kicad_pcb', schematic: '.kicad_sch' })) if (fs.existsSync(stem + ext)) result.documents[key] = stem + ext;
  let cfg;
  try { cfg = readJSON(stem + '.kicad_pro'); } catch (err) { if (err.code === 'ENOENT' || err instanceof SyntaxError) return result; throw err; }
  for (const [key, field] of Object.entries({ meta: 'meta', sheets: 'sheets', textVariables: 'text_variables', netSettings: 'net_settings' })) if (cfg[field] !== undefined) result[key] = cfg[field];
  if (cfg.board?.design_settings?.rules) result.designRules = cfg.board.design_settings.rules;
  return result;
}
