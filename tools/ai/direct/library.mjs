// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DirectError, bad } from './utils.mjs';
import { parse, children, value } from './sexpr.mjs';
export function projectFootprints(p = {}) {
  const selected = p.directory ?? p.project ?? p.document;
  if (!selected) return [];
  let directory = typeof selected === 'string' ? selected : selected.path ?? selected.project?.path;
  if (!directory) return [];
  directory = path.resolve(directory);
  if (!fs.statSync(directory).isDirectory()) directory = path.dirname(directory);
  const table = path.join(directory, 'fp-lib-table');
  if (!fs.existsSync(table)) return [];
  return children(parse(fs.readFileSync(table, 'utf8')), 'lib').filter(n => value(n, 'type') === 'KiCad').map(n => ({
    name: value(n, 'name'), directory: path.resolve(directory, value(n, 'uri').replaceAll('${KIPRJMOD}', directory))
  }));
}
export function footprintRoots() {
  const configured = ['KICAD10_FOOTPRINT_DIR', 'KICAD9_FOOTPRINT_DIR', 'KICAD8_FOOTPRINT_DIR', 'KICAD_FOOTPRINT_DIR'].flatMap(k => (process.env[k] ?? '').split(path.delimiter).filter(Boolean));
  const candidates = [path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../build/kicad/KiCad.app/Contents/SharedSupport/footprints'), path.resolve(path.dirname(process.execPath), '../SharedSupport/footprints'), '/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints', '/Library/Application Support/kicad/footprints', '/usr/share/kicad/footprints', '/usr/local/share/kicad/footprints', path.join(os.homedir(), 'Documents/KiCad')];
  return [...new Set((configured.length ? configured : candidates.filter(p => fs.existsSync(p)).slice(0, 1)).filter(p => fs.existsSync(p)).map(p => fs.realpathSync(p)))];
}
export function searchFootprints(p) {
  const limit = p.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) bad('limit must be 1..1000');
  const local = projectFootprints(p), roots = [...new Set([...local.map(l => l.directory), ...footprintRoots()])], results = []; let seen = 0;
  if (!roots.length) throw new DirectError('NO_FOOTPRINT_LIBRARIES', 'Set KICAD10_FOOTPRINT_DIR or KICAD_FOOTPRINT_DIR');
  const visit = (dir, depth = 0) => {
    if (depth > 16 || results.length >= limit || seen >= 50000) return;
    const library = local.find(l => l.directory === dir)?.name ?? path.basename(dir, '.pretty');
    if (!fs.existsSync(dir)) return;
    if (dir.endsWith('.pretty') && p.library && p.library.toLowerCase() !== library.toLowerCase()) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (results.length >= limit || seen >= 50000) return;
      if (e.isDirectory()) { visit(file, depth + 1); continue; }
      if (!e.isFile() || !e.name.endsWith('.kicad_mod')) continue;
      seen++; const name = path.basename(e.name, '.kicad_mod');
      if (p.query && !`${library} ${name}`.toLowerCase().includes(p.query.toLowerCase())) continue;
      let padCount;
      try { padCount = children(parse(fs.readFileSync(file, 'utf8')), 'pad').length; } catch { continue; }
      if (p.minPads && padCount < p.minPads || p.maxPads && padCount > p.maxPads) continue;
      results.push({ libId: `${library}:${name}`, name, library, path: file, padCount });
    }
  };
  for (const root of roots) visit(root);
  return results.sort((a, b) => a.libId.toLowerCase().localeCompare(b.libId.toLowerCase()));
}
