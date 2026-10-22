// SPDX-License-Identifier: GPL-3.0-or-later
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nativeWorkflowSchemas } from './native-workflow-schemas.mjs';
import { nativeWorkflows, nativeWorkflow } from './native-workflows.mjs';
import actions from './data/actions.json' with { type: 'json' };
import native from './data/native-enriched.json' with { type: 'json' };
import blocks from './data/blocks.json' with { type: 'json' };
import { KiCadIPC, mappings } from './ipc.mjs';
import { KiCadCLI, cliCommands, commandFor } from './cli.mjs';
import { requests, requestSchema } from './protobuf.mjs';
import { bad, ok, fail, object, errorResult, positive, required, executable, resolvePaths } from './utils.mjs';
import { discover, resolveProject, projectInfo } from './project.mjs';
import { reference, referenceInventory } from './reference.mjs';
import { audit, auditFootprint, auditRules } from './audit.mjs';
import { release } from './release.mjs';
import { specAction } from './spec.mjs';
import { workflow } from './workflow.mjs';
import { searchFootprints } from './library.mjs';
import { impedance } from './impedance.mjs';
import { vias } from './vias.mjs';
import { layers } from './layers.mjs';
import { plane } from './planes.mjs';
import { regionAction } from './regions.mjs';
import { routing } from './routing.mjs';
import { external, detectTools } from './external.mjs';
import { web } from './web.mjs';
import { liveRules } from './live.mjs';
import { fanout } from './fanout.mjs';
import { dfm } from './dfm.mjs';
import { placeFootprint, fiducials } from './footprints.mjs';
import { decap } from './decap.mjs';
import { structural, unified } from './structural.mjs';
import { generateSchematic } from './schematic.mjs';
import { pipeline } from './pipeline.mjs';
export const catalog = actions.filter(a => a.available !== false).map(a => ({ ...a, ...(['kicad.cli.run', 'external.command.run', 'project.switch', 'board.check.unified', 'schematic.generate'].includes(a.name) ? { mutates: true } : {}) }));
export const byName = new Map(catalog.map(a => [a.name, a]));
export function listActions(p = {}) {
  return catalog.filter(a => (!p.domain || a.domain === p.domain) && (p.mutates === undefined || a.mutates === p.mutates) && (!p.search || JSON.stringify(a).toLowerCase().includes(p.search.toLowerCase()))).map(a => ({ ...a, ...(nativeWorkflowSchemas.has(a.name)?{inputSchema:nativeWorkflowSchemas.get(a.name)}:{}), ...(mappings[a.name] ? { request: mappings[a.name].request, inputSchema: requestSchema(mappings[a.name].request) } : {}), ...(commandFor(a.name) ? { cliSchema: commandFor(a.name) } : {}) }));
}
function nativeAction(action, p) {
  const operation = action.split('.').at(-1);
  if (operation === 'categories') return ok(action, [...new Set(native.tools.map(t => t.category))].sort());
  if (operation === 'show') { const tool = native.tools.find(t => t.name === required(p, 'name')); return tool ? ok(action, tool) : fail(action, 'TOOL_NOT_FOUND', 'Unknown native tool'); }
  let tools = native.tools.filter(t => (!p.editor || t.editor === p.editor) && (!p.category || t.category === p.category) && (p.mutating === undefined || (t.mutating ?? t.mutates) === p.mutating));
  if (p.query) tools = tools.filter(t => JSON.stringify(t).toLowerCase().includes(p.query.toLowerCase()));
  const count = tools.length;
  if (p.limit !== undefined) { if (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > 5000) bad('limit must be 1..5000'); tools = tools.slice(0, p.limit); }
  return ok(action, { count, tools });
}
export function findCLI() {
  return executable(process.env.KICAD_CLI) ?? executable('kicad-cli') ?? ['/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli', path.resolve('build/kicad/KiCad.app/Contents/MacOS/kicad-cli')].find(f => executable(f)) ?? 'kicad-cli';
}
export class Runtime {
  constructor({ ipc, cli, ...options } = {}) { this.notify = options.notify; this.ipc = ipc ?? new KiCadIPC(options); this.cli = cli ?? new KiCadCLI({ binary: findCLI(), ...options }); }
  async dispatch(action, p = {}, options = {}) {
    try {
      if (!byName.has(action)) {
        const removed = actions.find(a => a.name === action && a.available === false);
        if (removed) return fail(action, 'CAPABILITY_REMOVED', removed.unavailableReason, {alternatives: action.startsWith('board.') ? ['board.export.svg','board.export.pdf','board.export.dxf','board.export.ps'] : ['schematic.export.svg','schematic.export.pdf','schematic.export.dxf','schematic.export.ps']});
        bad('Unknown action: ' + action);
      }
      if (!object(p)) bad('payload must be an object');
      p = Object.fromEntries(Object.entries(p).filter(([,value]) => value !== undefined));
      if (options.directory) {
        p = resolvePaths({payload:p},options.directory,action).payload;
        if (action === 'project.list') p.directory ??= options.directory;
        if (action === 'project.resolve' || /^(workflow|pipeline|release)\./.test(action) || action === 'schematic.generate') p.project ??= options.directory;
      }
      for (const key of ['dryRun', 'apply', 'fix', 'confirm']) if (p[key] !== undefined && typeof p[key] !== 'boolean') bad(key + ' must be boolean');
      const timeoutMs = positive(p.timeoutMs ?? options.timeoutMs, 1800000), signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const nestedOptions = { ...options, timeoutMs, signal }, dispatch = (name, payload) => this.dispatch(name, payload, nestedOptions);
      if (signal.aborted) return fail(action, 'CANCELLED', 'Operation cancelled');
      if (nativeWorkflows.has(action)) return await nativeWorkflow(action,p,dispatch,{...nestedOptions,notify:this.notify});
      if (action === 'system.health') return await this.health(dispatch);
      if (action === 'system.manifest') return ok(action, { runtime: 'shared-js', version: '0.1.0', actionCount: catalog.length, nativeToolCount: native.tools.length, ipcRequestCount: requests.size, cliCommandCount: cliCommands.length, engineering: referenceInventory(), engineeringReferences: referenceInventory(), mcpToolCount: 20, mcpTools: ['kicad_health', 'kicad_actions', 'kicad_call', 'kicad_spec_validate', 'kicad_blocks', 'kicad_workflow', 'kicad_pipeline', 'kicad_native_tools', ...['system','project','document','schematic','board','library','external','editor','reference','audit','web','gerber'].map(d => 'kicad_' + d)], actions: catalog });
      if (action === 'project.list') return ok(action, { projects: discover(p.directory ?? '.', p.depth ?? 2) });
      if (action === 'project.resolve') return ok(action, { path: resolveProject(p.project ?? p.directory ?? '.') });
      if (action === 'project.switch' || action === 'project.open') return await this.openProject(action, p, nestedOptions);
      if (action === 'project.info' && (p.input || p.project)) return ok(action, projectInfo(p.input ?? p.project));
      if (action.startsWith('editor.native.')) return nativeAction(action, p);
      if (action.startsWith('blocks.')) {
        if (action.endsWith('.show')) { const b = blocks.find(b => b.id === required(p, 'id')); return b ? ok(action, b) : fail(action, 'BLOCK_NOT_FOUND', 'Unknown block'); }
        const found = p.query ? blocks.filter(b => JSON.stringify(b).toLowerCase().includes(p.query.toLowerCase())) : blocks;
        return ok(action, found);
      }
      if (action.startsWith('reference.')) return reference(action, p);
      if (action.startsWith('release.')) return await release(action, p, dispatch);
      if (action === 'audit.rules') return ok(action, auditRules);
      if (action === 'audit.footprint') return auditFootprint(p);
      if (action === 'audit.run') return await audit(p, dispatch);
      if (action === 'spec.validate') return specAction(p);
      if (action.startsWith('workflow.')) return workflow(action, p);
      if (action.startsWith('pipeline.')) return await pipeline(action, p, dispatch);
      if (action === 'library.search.footprints') return ok(action, searchFootprints(p));
      if (action === 'external.tools.list') return ok(action, { tools: detectTools(this.cli.binary) });
      if (action.startsWith('external.')) return await external(action, p, nestedOptions);
      if (action.startsWith('web.')) return await web(action, p, nestedOptions);
      if (action === 'kicad.cli.run' || commandFor(action) || action === 'system.version') return await this.cli.action(action, p, nestedOptions);
      if (mappings[action]) return await this.ipc.action(action, p, nestedOptions);
      if (action.startsWith('board.impedance.')) return await impedance(action, p, dispatch);
      if (action.startsWith('board.via.')) return await vias(action, p, dispatch);
      if (action.startsWith('board.layers.type.')) return await layers(action, p, dispatch);
      if (action === 'board.plane.build') return await plane(p, dispatch);
      if (['board.rule_area.create', 'board.keepout.antenna', 'board.rules.region.set'].includes(action)) return await regionAction(action, p, dispatch);
      if (action.startsWith('board.route.')) return await routing(action, p, dispatch, nestedOptions);
      if (action === 'board.fanout.run') return await fanout(p, dispatch);
      if (action.startsWith('board.dfm.')) return await dfm(action, p, dispatch);
      if (action.startsWith('board.decap.')) return await decap(action, p, dispatch);
      if (action === 'board.footprint.place') return await placeFootprint(p, dispatch);
      if (action === 'board.fiducial.add') return await fiducials(p, dispatch);
      if (['board.drc.live', 'schematic.erc.live'].includes(action)) return await liveRules(action, p, dispatch);
      if (action === 'board.check.3d') return await structural(p, dispatch);
      if (action === 'board.check.unified') return await unified(p, dispatch);
      if (action === 'schematic.generate') return await generateSchematic(p, dispatch);
      return fail(action, 'HANDLER_MISSING', 'Catalog action has no implementation');
    } catch (err) { return errorResult(action, err); }
  }
  async health(dispatch) {
    const version = await dispatch('system.version', {}), ping = await dispatch('system.ping', { timeoutMs: 1500 });
    const documents = ping.ok ? await dispatch('document.list', { timeoutMs: 1500 }) : undefined;
    return ok('system.health', { cli: version, kicadCli: { available: version.ok, version: version.data?.version, error: version.error?.message }, compiledCapabilities: { actionCount: catalog.length, mcpToolCount: 20 }, externalTools: detectTools(this.cli.binary), ipc: { available: ping.ok, socket: this.ipc.socket, result: ping }, documents, tools: detectTools(this.cli.binary), designReady: Boolean(ping.ok && documents?.data?.documents?.length) });
  }
  async openProject(action, p, options) {
    let file = p.document ?? p.path ?? p.project; if (typeof file === 'object') file = file.path;
    file = resolveProject(required({ file }, 'file'));
    if (p.dryRun) return ok(action, { dryRun: true, applied: false, path: file });
    try { return { ...await this.ipc.action('project.open', { path: file }, options), action }; }
    catch (err) { if (err.code !== 'IPC_UNAVAILABLE') throw err; }
    // Only an unavailable socket permits starting a server. A refusal by a live
    // editor must remain a refusal, especially when unsaved changes are present.
    fs.mkdirSync(path.dirname(this.ipc.socket), { recursive: true, mode: 0o700 });
    const logPath = this.ipc.socket + '.log', fd = fs.openSync(logPath, 'a', 0o600);
    let child;
    try { child = spawn(this.cli.binary, ['api-server', '--socket', this.ipc.socket, file], { detached: true, stdio: ['ignore', fd, fd], env: options.env ?? process.env }); }
    finally { fs.closeSync(fd); }
    let startupError; child.on('error', err => { startupError = err; }); child.unref();
    const deadline = Date.now() + Math.min(options.timeoutMs, 60000);
    while (Date.now() < deadline && !options.signal?.aborted) {
      if (startupError || child.exitCode !== null) return fail(action, 'SERVER_START_FAILED', startupError?.message ?? 'Native API server exited', { log: logPath });
      const ping = await this.dispatch('system.ping', { timeoutMs: 1000 }, options);
      if (ping.ok) return ok(action, { document: file, socket: this.ipc.socket, spawned: true, pid: child.pid, log: logPath });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return fail(action, options.signal?.aborted ? 'CANCELLED' : 'TIMEOUT', 'Native API server did not become ready; inspect the log before retrying', { pid: child.pid, log: logPath });
  }

  close() { this.ipc.close(); }
}
