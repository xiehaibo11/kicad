// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { bad, ok, fail, hashFile, sha256, readJSON, writeJSON, tempDir } from './utils.mjs';
import { catalog } from './reference.mjs';
const optional = ['analog', 'clock', 'highspeed', 'rf-emc'];
const fabrication = ['requirements', 'schematic', 'parts', 'footprints', 'power', 'analog', 'clock', 'stackup', 'placement', 'routing', 'highspeed', 'rf-emc', 'safety', 'thermal-reliability', 'dfm', 'assembly', 'dft', 'rule-exceptions', 'manufacturing-output'];
const production = ['prototype-functional', 'thermal-validation', 'emc-safety-validation', 'reliability-validation', 'pilot-process', 'release-authorization'];
const designExtensions = new Set(['.kicad_pro', '.kicad_sch', '.kicad_pcb', '.kicad_dru', '.kicad_sym', '.kicad_mod', '.step', '.stp', '.wrl', '.cir', '.spice', '.lib', '.sub']);
const skip = new Set(['.git', '.kicad-agent', '.claude', '.vscode', 'node_modules', 'migration-backups']);
export function snapshot(project = '.') {
  project = path.resolve(project);
  if (fs.statSync(project).isDirectory()) {
    const files = fs.readdirSync(project).filter(f => f.endsWith('.kicad_pro'));
    if (files.length !== 1) bad('Project directory must contain exactly one .kicad_pro; select a full path');
    project = path.join(project, files[0]);
  }
  if (path.extname(project) !== '.kicad_pro') bad('Project must be .kicad_pro or its directory');
  project = fs.realpathSync(project);
  const root = path.dirname(project), files = {};
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) { if (!skip.has(e.name) && !e.name.endsWith('-backups')) walk(file); continue; }
      if (e.isSymbolicLink()) bad('Design dependency is a symlink; vendor/version it inside the project: ' + file);
      if (!designExtensions.has(path.extname(file).toLowerCase()) && !['sym-lib-table', 'fp-lib-table', 'manufacturing.json'].includes(e.name)) continue;
      if (!e.isFile()) bad('Design dependency must be a regular file: ' + file);
      files[path.relative(root, file).split(path.sep).join('/')] = hashFile(file);
    }
  }
  walk(root);
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a < b ? -1 : 1));
  return { project, files: sorted, digest: sha256(JSON.stringify(sorted)) };
}
const meaningful = s => typeof s === 'string' && [...s.trim()].length >= 3 && !['unknown', 'pending', 'todo', 'tbd', '待确认', '待补充'].includes(s.trim().toLowerCase());
function artifact(root, a) {
  if (!a || typeof a.path !== 'string' || !a.path || path.isAbsolute(a.path) || !/^[a-f0-9]{64}$/i.test(a.sha256)) return 'Project-relative artifact and SHA-256 required';
  try {
    const file = fs.realpathSync(path.join(root, a.path)), rel = path.relative(root, file), info = fs.statSync(file);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return 'Artifact escapes project: ' + a.path;
    if (!info.isFile() || !info.size || hashFile(file) !== a.sha256.toLowerCase()) return 'Artifact missing, empty or changed: ' + a.path;
  } catch (err) { return err.message; }
  return '';
}
function review(root, r, snap, product) {
  if (!r) return 'Required review missing';
  if (r.status !== 'pass' && !(r.status === 'not-applicable' && optional.includes(r.category) && product.features?.[r.category] === 'not-applicable' && meaningful(r.applicabilityReason))) return 'Pass or justified optional not-applicable required';
  if (r.status === 'pass' && optional.includes(r.category) && product.features?.[r.category] !== 'applicable') return 'Feature applicability inconsistent';
  if (!meaningful(r.reviewer)) return 'Accountable reviewer required; AI must not impersonate a reviewer';
  if (typeof r.reviewedAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(r.reviewedAt) || !Number.isFinite(Date.parse(r.reviewedAt)) || Date.parse(r.reviewedAt) > Date.now() + 300000) return 'Valid non-future reviewedAt required';
  if (r.snapshotDigest !== snap.digest) return 'Review not bound to current snapshot';
  if (!Array.isArray(r.artifacts) || !r.artifacts.length) return 'Nonempty review/test artifacts required';
  for (const a of r.artifacts) { const error = artifact(root, a); if (error) return error; }
  return '';
}
const keys = (obj, allowed, where) => { if (!obj || typeof obj !== 'object' || Array.isArray(obj)) bad(where + ' must be an object'); for (const key of Object.keys(obj)) if (!allowed.includes(key)) bad(`Unknown ${where}.${key}`); };
function validateManifest(m) {
  keys(m, ['schemaVersion', 'target', 'snapshotDigest', 'product', 'manufacturingProfile', 'reviews'], 'manifest');
  keys(m.product, ['name', 'revision', 'requirements', 'environment', 'standards', 'manufacturerProcess', 'features'], 'product');
  keys(m.manufacturingProfile, ['path', 'sha256'], 'manufacturingProfile');
  if (!Array.isArray(m.reviews)) bad('reviews must be an array');
  for (const r of m.reviews) {
    keys(r, ['category', 'status', 'applicabilityReason', 'reviewer', 'reviewedAt', 'snapshotDigest', 'artifacts'], 'review');
    if (!Array.isArray(r.artifacts)) bad('Review artifacts must be an array');
    for (const a of r.artifacts) keys(a, ['path', 'sha256'], 'artifact');
  }
}
export async function release(action, p, dispatch) {
  const snap = snapshot(p.project), root = path.dirname(snap.project), target = p.target ?? 'fabrication';
  if (action === 'release.snapshot') return ok(action, snap);
  if (!['fabrication', 'production'].includes(target)) bad('target must be fabrication or production');
  const categories = [...fabrication, ...(target === 'production' ? production : [])];
  if (action === 'release.template') return ok(action, { snapshot: snap, manifest: { schemaVersion: 1, target, snapshotDigest: snap.digest, product: { name: '', revision: '', requirements: '', environment: '', standards: [], manufacturerProcess: '', features: Object.fromEntries(optional.map(s => [s, 'unknown'])) }, manufacturingProfile: { path: 'manufacturing.json', sha256: snap.files['manufacturing.json'] ?? '' }, reviews: categories.map(category => ({ category, status: 'pending', artifacts: [] })) }, instructions: 'Resolve project inputs and attach real revision-bound review/test artifacts with hashes. Never invent limits or reviewer identities. This template is deliberately pending.' });
  const report = { policyVersion: catalog.version, createdAt: new Date().toISOString(), target, snapshot: snap, checks: [], pendingEvidence: [], fabricationEvidenceComplete: false, productionEvidenceComplete: false, readyForFabrication: false, readyForProduction: false, scope: 'Evidence completeness only. Does not authenticate reviewers, signatures, report truth, physical hardware or regulatory certification. Accountable external engineering/quality/manufacturer release is required.' };
  const add = (name, error = '', detail) => {
    report.checks.push({ name, status: error ? 'blocked' : 'pass', ...(error || detail ? { detail: error || detail } : {}) });
    if (error) report.pendingEvidence.push(name + ': ' + error);
  };
  let m = { product: {}, reviews: [] }, manifestHash;
  try {
    if (!p.manifest) bad('Missing manifest; use release.template');
    manifestHash = hashFile(p.manifest); m = readJSON(p.manifest); validateManifest(m); add('manifest');
    report.manifestPath = path.resolve(p.manifest); report.manifestSha256 = manifestHash;
  } catch (err) { add('manifest', err.message); m = { product: {}, reviews: [] }; }
  add('schema', m.schemaVersion === 1 ? '' : 'schemaVersion must be 1');
  add('target', m.target === target ? '' : 'Manifest target differs');
  add('snapshot', m.snapshotDigest === snap.digest ? '' : 'Manifest missing or stale');
  for (const k of ['name', 'revision', 'requirements', 'environment', 'manufacturerProcess']) add('product.' + k, meaningful(m.product?.[k]) ? '' : 'Unresolved project input');
  add('standards', Array.isArray(m.product?.standards) && m.product.standards.length && m.product.standards.every(meaningful) ? '' : 'Applicable standards/contract editions and rationale required');
  for (const k of optional) add('feature.' + k, ['applicable', 'not-applicable'].includes(m.product?.features?.[k]) ? '' : 'Unknown applicability');
  add('manufacturing-profile', m.manufacturingProfile?.path === 'manufacturing.json' ? '' : 'Vendor confirmed profile as manufacturing.json');
  add('manufacturing-profile-artifact', artifact(root, m.manufacturingProfile));
  try {
    const cfg = readJSON(path.join(root, 'manufacturing.json'));
    for (const k of ['supplier', 'process', 'source', 'revision', 'confirmedAt', 'stackup', 'orderApplicability']) add('manufacturing-provenance.' + k, meaningful(cfg[k]) ? '' : 'Manufacturer-confirmed provenance required');
  } catch (err) { add('manufacturing-provenance', err.message); }
  const reviews = new Map();
  for (const r of m.reviews ?? []) {
    if (reviews.has(r.category)) add('duplicate-review', r.category);
    if (![...fabrication, ...production].includes(r.category)) add('review-category', 'Unknown category: ' + r.category);
    reviews.set(r.category, r);
  }
  for (const c of categories) add('review.' + c, review(root, reviews.get(c), snap, m.product ?? {}));
  const result = await dispatch('audit.run', { board: snap.project.replace(/\.kicad_pro$/, '.kicad_pcb'), ...(fs.existsSync(path.join(root, 'manufacturing.json')) ? { manufacturingProfile: path.join(root, 'manufacturing.json') } : {}) });
  add('native-audit', result?.ok && result.data?.nativeChecksPassed && result.data?.checks?.length ? '' : 'Fresh complete native audit has not passed');
  report.checks.push({ name: 'native-audit-detail', status: 'info', detail: result });
  try { add('snapshot-stability', snapshot(snap.project).digest === snap.digest ? '' : 'Design changed during checking'); } catch (err) { add('snapshot-stability', err.message); }
  for (const r of m.reviews ?? []) for (const a of r.artifacts ?? []) add('artifact-stability.' + r.category, artifact(root, a));
  if (p.manifest) { try { add('manifest-stability', manifestHash === hashFile(p.manifest) ? '' : 'Manifest changed during checking'); } catch (err) { add('manifest-stability', err.message); } }
  report.fabricationEvidenceComplete = report.checks.every(c => c.status !== 'blocked' || production.some(s => ["review." + s, 'artifact-stability.' + s].includes(c.name)));
  report.productionEvidenceComplete = target === 'production' && !report.pendingEvidence.length;
  report.pendingEvidence.sort();
  const output = path.join(tempDir('kicad-release-check-'), 'release-check.json'); writeJSON(output, report);
  const artifacts = [...(result?.artifacts ?? []), output];
  return report.pendingEvidence.length ? fail(action, 'RELEASE_EVIDENCE_INCOMPLETE', 'Missing, stale or failing evidence; no fabrication/production approval conferred', report, artifacts) : ok(action, report, artifacts);
}
