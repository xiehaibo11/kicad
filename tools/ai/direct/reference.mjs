// SPDX-License-Identifier: GPL-3.0-or-later
import catalog from './data/catalog.json' with { type: 'json' };
import examples from './data/examples.json' with { type: 'json' };
import { bad, ok, sha256 } from './utils.mjs';
export { catalog };
export function referenceInventory() {
  return { version: catalog.version, topicCount: catalog.topics.length, ruleCount: catalog.topics.reduce((n, t) => n + t.rules.length, 0), sourceCount: catalog.sources.length, exampleProjectCount: examples.examples.length, contentSha256: sha256(JSON.stringify([catalog, examples])) };
}
function selected(query = '', stage = '') {
  query = query.trim().toLowerCase();
  if (stage && stage !== 'all' && !catalog.topics.some(t => [t.stage, t.id].includes(stage))) bad('Unknown stage/topic; use reference.search');
  return catalog.topics.filter(t => !stage || stage === 'all' || [t.stage, t.id].includes(stage)).map(t => {
    const words = [t.id, t.title, ...t.aliases].map(s => s.toLowerCase()), text = words.join(' ');
    const score = !query ? 1 : words.reduce((n, s) => n + (query.includes(s) ? 10 : 0), 0) + query.split(/\s+/).filter(w => w.length >= 2 && text.includes(w)).length;
    return { t, score };
  }).filter(x => x.score).sort((a, b) => b.score - a.score).map(x => x.t);
}
const sourcesFor = topics => catalog.sources.filter(s => topics.some(t => t.sourceIds.includes(s.id)));
export function reference(action, p) {
  if (action === 'reference.examples') {
    const matches = examples.examples.filter(e => !p.query || `${e.id} ${e.name} ${e.project}`.toLowerCase().includes(p.query.toLowerCase()));
    return ok(action, { count: matches.length, total: examples.examples.length, generatedAt: examples.generatedAt, examples: matches.map(e => p.includeFiles ? e : { id: e.id, name: e.name, project: e.project, reviewStatus: 'indexed-not-electrically-qualified' }), warning: 'Local demos inventory, not production approval; hashes are the indexed source snapshot. Verify current files before reuse; never modify original demos.' });
  }
  if (action === 'reference.get') {
    const topic = catalog.topics.find(t => t.id === p.id);
    if (!topic) bad('Unknown reference id; use reference.search');
    return ok(action, { version: catalog.version, topic, sources: sourcesFor([topic]) });
  }
  const plan = action === 'reference.plan', limit = p.limit ?? (plan ? catalog.topics.length : 6);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) bad('limit must be 1..20');
  let topics = selected(p.query, p.stage), matchKind = 'topic-match';
  if (plan && !topics.length && !p.stage) {
    topics = [...selected('', 'requirements'), ...selected('', 'verification')];
    matchKind = 'baseline-only; refine query or use reference.search to select task-specific cards';
  }
  const count = topics.length; topics = topics.slice(0, limit);
  return ok(action, plan ? { version: catalog.version, matchKind, policy: catalog.policy, authorityOrder: catalog.authorityOrder, count, topics, sources: sourcesFor(topics), unknownInputPolicy: 'Do independent work first; list unresolved design decisions. Never invent safety/manufacturing/interface constraints or mark unknown evidence passed.', releasePolicy: 'Use release.template/snapshot/check; workflow flags are task tracking only. Fabrication evidence and production qualification are separate.' } : { version: catalog.version, count, topics: topics.map(t => ({ id: t.id, title: t.title, stage: t.stage, ruleCount: t.rules.length, requiredInputs: t.requiredInputs })), next: 'reference.get with a returned id; reference.plan for stage constraints' });
}
