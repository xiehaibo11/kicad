// SPDX-License-Identifier: GPL-3.0-or-later
// Dependency injection keeps both AI frontends on the exact same action handlers.
import { toolsList, callTool } from './tools.mjs';
import { byName } from './runtime.mjs';
import { errorResult, DirectError, resolvePaths } from './utils.mjs';
export { resolvePaths } from './utils.mjs';
const queues = new WeakMap();
const definitions = new Map(toolsList().map(definition => [definition.name, definition]));
const OPERATIONS = { kicad_blocks: 'blocks', kicad_workflow: 'workflow', kicad_pipeline: 'pipeline', kicad_native_tools: 'editor.native' };
export function zodSchema(schema, z) {
  let value;
  if (schema.enum) value = z.enum(schema.enum);
  else if (schema.type === 'object') {
    const fields = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, sub]) => [key, (schema.required ?? []).includes(key) ? zodSchema(sub, z) : zodSchema(sub, z).optional()]));
    value = z.object(fields); value = schema.additionalProperties === false ? value.strict() : value.passthrough();
  } else if (schema.type === 'array') value = z.array(zodSchema(schema.items, z));
  else if (schema.type === 'boolean') value = z.boolean();
  else if (schema.type === 'integer') value = z.number().int();
  else value = z.string();
  if (schema.minimum !== undefined) value = value.min(schema.minimum);
  return value;
}
/** The runtime action a tool call runs: `action` of domain tools, `operation` of the operation tools. */
export function callAction(name, args = {}) {
  if (typeof args?.action === 'string') return args.action;
  if (OPERATIONS[name] && typeof args?.operation === 'string') return OPERATIONS[name] + '.' + args.operation;
  return undefined;
}
/** Whether a call may change the design; unknown tools and actions count as changes. */
export function callMutates(name, args = {}) {
  const action = callAction(name, args);
  if (action) return byName.get(action)?.mutates !== false;
  return !definitions.get(name)?.annotations.readOnlyHint;
}
// Short argument errors: Zod's own text lists every allowed value (up to 333 actions).
function invalidArguments(name, issues, args) {
  const details = issues.slice(0, 3).map(issue => {
    const at = issue.path?.length ? issue.path.join('.') : 'arguments';
    if (issue.code === 'unrecognized_keys') return 'unknown argument ' + issue.keys.join(', ');
    if (issue.code !== 'invalid_value' && issue.code !== 'invalid_enum_value') return at + ': ' + issue.message;
    const value = issue.path?.reduce((current, key) => current?.[key], args);
    const owner = at === 'action' ? byName.get(value)?.domain : undefined;
    return at + ' ' + JSON.stringify(value) + ' is not allowed here' + (owner ? '; it belongs to kicad_' + owner : at === 'action' ? '; list valid actions with kicad_actions' : '');
  });
  return new DirectError('INVALID_ARGUMENTS', name + ': ' + details.join('; '));
}
export function bindTools(runtime, z, permission) {
  return toolsList().map(definition => {
    const schema = zodSchema(definition.inputSchema, z);
    return { ...definition, schema, args: schema.shape, async execute(args, context = {}) {
      const signal = context.abort ?? context.signal;
      const run = async () => {
        let resolved;
        try {
          const parsed = schema.safeParse(args);
          if (!parsed.success) throw invalidArguments(definition.name, parsed.error.issues, args);
          if (signal?.aborted) throw new DirectError('CANCELLED','Operation cancelled');
          resolved = resolvePaths(args, context.directory);
        } catch (err) { return errorResult(definition.name, err); }
        // A refused permission is the host's decision, not a tool failure: let it reach the host,
        // which ends the call as rejected (OpenCode then stops the turn instead of letting the model retry).
        if (permission && callMutates(definition.name, resolved)) await permission(definition.name, resolved, context);
        try {
          return await callTool(runtime, definition.name, resolved, { signal, directory:context.directory });
        } catch (err) { return errorResult(definition.name, err); }
      };
      const task = (queues.get(runtime) ?? Promise.resolve()).then(run);
      queues.set(runtime, task.catch(() => {}));
      return task;
    } };
  });
}
