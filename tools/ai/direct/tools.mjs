// SPDX-License-Identifier: GPL-3.0-or-later
import { catalog, byName, listActions } from './runtime.mjs';
import { object, bad } from './utils.mjs';
import { splitView, shapeItems } from './views.mjs';
const obj = properties => ({ type: 'object', properties, additionalProperties: false });
const string = { type: 'string' }, bool = { type: 'boolean' };
const general = names => ({ ...obj({ action: { type: 'string', enum: names }, payload: { type: 'object', additionalProperties: true } }), required: ['action'] });
const operations = properties => ({ ...obj(properties), required: ['operation'] });
export function toolsList() {
  const dedicated = [
    ['kicad_health', 'Check CLI, IPC and loaded documents separately', obj({}), ['system.health']],
    ['kicad_actions', 'Discover typed actions, CLI flags and native request fields. Broad lists return summaries; search an exact action name for its inputs', obj({ domain: string, search: string, mutates: bool, detail: bool, limit: { type: 'integer', minimum: 1 }, offset: { type: 'integer', minimum: 0 } }), []],
    ['kicad_call', 'Invoke a typed action in the shared runtime', general(catalog.map(a => a.name)), catalog.map(a => a.name)],
    ['kicad_spec_validate', 'Validate an S0 specification', { ...obj({ file: string }), required: ['file'] }, ['spec.validate']],
    ['kicad_blocks', 'Inspect reusable circuit blocks', operations({ operation: { enum: ['list', 'search', 'show'], type: 'string' }, query: string, id: string }), ['blocks.list', 'blocks.search', 'blocks.show']],
    ['kicad_workflow', 'Manage task workflow gates; gates do not certify engineering approval', operations({ operation: { type: 'string', enum: ['init', 'status', 'advance', 'confirm', 'reset'] }, project: string, stage: string, confirmation: string, note: string, resetAll: bool, resetFrom: string }), catalog.filter(a => a.domain === 'workflow').map(a => a.name)],
    ['kicad_pipeline', 'Run selected pipeline stages or inspect pipeline status', operations({ operation: { type: 'string', enum: ['run', 'status'] }, spec: string, project: string, stages: { type: 'array', items: string }, dryRun: bool, timeoutMs: { type: 'integer', minimum: 1 } }), ['pipeline.run', 'pipeline.status']],
    ['kicad_native_tools', 'Discover native GUI actions; execution uses editor.run_action', operations({ operation: { type: 'string', enum: ['list', 'search', 'show'] }, editor: string, category: string, mutating: bool, query: string, name: string, limit: { type: 'integer', minimum: 1 } }), []],
  ];
  for (const domain of ['system', 'project', 'document', 'schematic', 'board', 'library', 'external', 'editor', 'reference', 'audit', 'web', 'gerber']) { const names = catalog.filter(a => a.domain === domain).map(a => a.name); dedicated.push(['kicad_' + domain, 'Run a typed ' + domain + ' action; inspect kicad_actions for inputs', general(names), names]); }
  return dedicated.map(([name, description, inputSchema, actions]) => {
    const readOnly = actions.every(a => !byName.get(a)?.mutates);
    // Capability search matches task words ("drc", "叠层") against the actions a tool runs; never sent to models.
    // kicad_call runs every action, so its own name and description are its search terms.
    const searchActions = name === 'kicad_call' ? undefined : actions.map(a => byName.get(a)).filter(Boolean).map(a => ({ name: a.name, mutates: a.mutates, inputs: a.inputs, keywords: (a.keywords ?? []).map(k => k.toLowerCase()), text: String(a.description ?? '').toLowerCase() }));
    return { name, description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: actions.some(a => a.startsWith('web.') || a.startsWith('external.')) }, ...(searchActions?.length ? { searchActions } : {}) };
  });
}
const FULL_ACTIONS = 5, DETAIL_PAGE = 10, ACTION_PAGE = 40;
const summary = a => ({ name: a.name, domain: a.domain, backend: a.backend, mutates: a.mutates, description: a.description?.length > 160 ? a.description.slice(0, 159) + '…' : a.description });
/** Full schemas for a few matches; otherwise pages of summaries (or of full entries with detail:true), keeping an exact name match in full. */
export function actionsResult(args = {}) {
  const { detail, limit, offset = 0, ...filter } = args, actions = listActions(filter), search = filter.search?.toLowerCase();
  if (actions.length <= (detail ? DETAIL_PAGE : FULL_ACTIONS) && limit === undefined && !offset) return { ok: true, data: { actions, count: actions.length } };
  const shown = actions.slice(offset, offset + (limit ?? (detail ? DETAIL_PAGE : ACTION_PAGE))), next = offset + shown.length < actions.length ? offset + shown.length : null;
  return { ok: true, data: { count: actions.length, offset, nextOffset: next, actions: shown.map(a => detail || a.name.toLowerCase() === search ? a : summary(a)),
    ...(detail ? {} : { note: 'Summaries only. Search an exact action name (or pass detail:true on a narrower search) for inputs, request fields and CLI flags.' }) } };
}
const tools = toolsList();
export async function callTool(runtime, name, args = {}, options = {}) {
  const tool = tools.find(t => t.name === name); if (!tool) bad('Unknown KiCad tool: ' + name);
  if (!object(args)) bad('arguments must be an object');
  validateInput(tool.inputSchema, args);
  const allowed = tool.inputSchema.properties;
  for (const k of Object.keys(args)) if (!allowed[k]) bad('Unknown tool argument: ' + k);
  for (const k of tool.inputSchema.required ?? []) if (args[k] === undefined) bad(k + ' is required');
  if (name === 'kicad_actions') return actionsResult(args);
  if (name === 'kicad_health') return runtime.dispatch('system.health', {}, options);
  if (name === 'kicad_spec_validate') return runtime.dispatch('spec.validate', { input: args.file }, options);
  if (['kicad_blocks', 'kicad_workflow', 'kicad_pipeline', 'kicad_native_tools'].includes(name)) {
    const { operation, ...payload } = args;
    if (!allowed.operation.enum.includes(operation)) bad('Invalid operation');
    const prefix = { kicad_blocks: 'blocks', kicad_workflow: 'workflow', kicad_pipeline: 'pipeline', kicad_native_tools: 'editor.native' }[name];
    return runtime.dispatch(prefix + '.' + operation, payload, options);
  }
  if (!allowed.action.enum.includes(args.action)) bad('Action is not permitted by this domain tool');
  const { payload, view } = splitView(args.action, args.payload ?? {});
  const result = await runtime.dispatch(args.action, payload, options);
  return view ? shapeItems(result, view) : result;
}
export function validateInput(schema, input, key = 'arguments') {
  if (schema.type === 'object' && !object(input) || schema.type === 'array' && !Array.isArray(input) || schema.type === 'string' && typeof input !== 'string' || schema.type === 'boolean' && typeof input !== 'boolean' || schema.type === 'integer' && !Number.isInteger(input)) bad(key + ' has the wrong type');
  if (schema.enum && !schema.enum.includes(input)) bad(key + ' is not an allowed value');
  if (schema.minimum !== undefined && input < schema.minimum) bad(key + ' is below its minimum');
  if (schema.type === 'object') {
    for (const field of schema.required ?? []) if (input[field] === undefined) bad(key + '.' + field + ' is required');
    for (const [field, value] of Object.entries(input)) { const sub = schema.properties?.[field]; if (sub) validateInput(sub, value, key + '.' + field); else if (schema.additionalProperties === false) bad('Unknown argument: ' + field); }
  }
  if (schema.type === 'array') input.forEach((v, i) => validateInput(schema.items, v, key + '[' + i + ']'));
}
