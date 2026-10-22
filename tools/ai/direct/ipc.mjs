// SPDX-License-Identifier: GPL-3.0-or-later
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import mappings from './data/ipc-actions.json' with { type: 'json' };
import native from './data/native-enriched.json' with { type: 'json' };
import { NngClient } from './nng.mjs';
import { root, type, requests, normalize, encode, decode, snake } from './protobuf.mjs';
import { bad, object, array, nm, required, ok, DirectError } from './utils.mjs';

export { mappings };
export function documentSpecifier(value) {
  if (typeof value === 'string') value = { path: value };
  if (!object(value)) bad('document is required (path or {type,path})');
  if (value.sheetPath || value.sheet_path || value.board_filename || (value.boardFilename && !value.path)) {
    return normalize(type('kiapi.common.types.DocumentSpecifier'), value);
  }
  const file = value.path ? path.resolve(value.path) : value.boardFilename;
  const kind = String(value.type ?? (file?.endsWith('.kicad_sch') ? 'schematic' : 'pcb')).toLowerCase();
  const docType = { pcb: 'DOCTYPE_PCB', board: 'DOCTYPE_PCB', schematic: 'DOCTYPE_SCHEMATIC', sch: 'DOCTYPE_SCHEMATIC', project: 'DOCTYPE_PROJECT' }[kind] ?? String(value.type);
  let dir = value.projectPath ?? value.project?.path ?? (file ? path.dirname(file) : '');
  const name = value.projectName ?? value.project?.name ?? (file ? path.basename(file, path.extname(file)) : path.basename(dir));
  if (docType === 'DOCTYPE_SCHEMATIC' && dir && !dir.endsWith(path.sep)) dir += path.sep;
  return { type: docType, ...(docType === 'DOCTYPE_PCB' && file ? { board_filename: path.basename(file) } : {}), ...(dir || name ? { project: { name, path: dir } } : {}) };
}
const boardItems = { track: 'Track', trace: 'Track', arc: 'Arc', via: 'Via', pad: 'Pad', zone: 'Zone', footprint: 'FootprintInstance', footprintinstance: 'FootprintInstance', text: 'BoardText', boardtext: 'BoardText', textbox: 'BoardTextBox', boardtextbox: 'BoardTextBox', shape: 'BoardGraphicShape' };
const schematicItems = { symbol: 'SchematicSymbolInstance', wire: 'SchematicLine', line: 'SchematicLine', junction: 'Junction', noconnect: 'NoConnectMarker', label: 'LocalLabel', globallabel: 'GlobalLabel', hierlabel: 'HierarchicalLabel', text: 'SchematicText', schematictext: 'SchematicText', textbox: 'SchematicTextBox', schematictextbox: 'SchematicTextBox', shape: 'SchematicGraphicShape' };
export function itemAny(item, schematic = false) {
  if (item['@type'] || item.typeUrl || item.type_url) return item;
  const name = (schematic ? schematicItems : boardItems)[String(item.type).toLowerCase()];
  if (!name || !object(item.json)) bad('Item requires a known type and json object');
  return { '@type': (schematic ? 'kiapi.schematic.types.' : 'kiapi.board.types.') + name, ...item.json };
}
export const position = p => ({ x_nm: p.xMm !== undefined ? nm(p.xMm) : p.xNm ?? p.x_nm ?? p.x ?? 0, y_nm: p.yMm !== undefined ? nm(p.yMm) : p.yNm ?? p.y_nm ?? p.y ?? 0 });
function libraryId(v) {
  if (object(v)) return v;
  if (typeof v !== 'string' || !v.includes(':')) bad('libId must be Library:Item');
  const index = v.indexOf(':');
  return { library_nickname: v.slice(0, index), entry_name: v.slice(index + 1) };
}
function objectType(value, schematic) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('KOT_')) return value;
  const name = ({ track: 'TRACE', wire: 'LINE', globallabel: 'GLOBAL_LABEL', hierlabel: 'HIER_LABEL', noconnect: 'NO_CONNECT' })[value.toLowerCase()] ?? value.toUpperCase();
  return `KOT_${schematic ? 'SCH' : 'PCB'}_${name}`;
}

const layerJobs = new Set(['board.jobs.svg', 'board.jobs.dxf', 'board.jobs.pdf', 'board.jobs.ps']);

export class KiCadIPC {
  constructor({ socket, token = process.env.KICAD_API_TOKEN ?? '', transport, startGUI } = {}) {
    this.explicitSocket = Boolean(socket || process.env.KICAD_API_SOCKET);
    socket = socket || process.env.KICAD_API_SOCKET || path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'kicad/api.sock');
    this.transport = transport ?? new NngClient(socket);
    this.socket = socket;
    this.token = token;
    this.managedConnection = !transport;
    this.startGUI = startGUI;
    this.defaultSocket = socket;
  }
  async connect(options = {}) {
    if (!this.managedConnection || (this.transport.ready && !this.transport.socket?.destroyed)) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.discoverConnection(options).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  async discoverConnection(options) {
    const deadline = Date.now() + (options.timeoutMs ?? 15000);
    let notReady = false;
    const probe = async socket => {
      notReady = false;
      this.transport.close();
      this.transport = new NngClient(socket);
      this.socket = socket;
      try {
        await this.callRaw('kiapi.common.commands.Ping', {}, { ...options, timeoutMs: Math.max(1, Math.min(1000, deadline - Date.now())) });
        return true;
      } catch (error) {
        if (error.code === 'NOT_READY') { notReady = true; return false; }
        if (!['IPC_UNAVAILABLE', 'TIMEOUT'].includes(error.code)) throw error;
        return false;
      }
    };
    if (await probe(this.socket)) return;
    if (notReady) {
      const initializingSocket = this.socket;
      while (Date.now() < deadline && !options.signal?.aborted) {
        await new Promise(resolve => setTimeout(resolve, 150));
        if (await probe(initializingSocket)) return;
      }
      throw new DirectError('NOT_READY', 'Native KiCad is still initializing.', initializingSocket);
    }
    if (this.explicitSocket) throw new DirectError('IPC_UNAVAILABLE', 'Explicit KiCad socket is unavailable; it was not redirected.', this.socket);
    const directory = path.dirname(this.defaultSocket);
    let candidates = [];
    try { candidates = fs.readdirSync(directory).filter(name => /^api-\d+\.sock$/.test(name)).map(name => path.join(directory, name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const live = [];
    for (const socket of candidates) if (await probe(socket)) live.push(socket);
    if (live.length > 1) { this.transport.close(); throw new DirectError('AMBIGUOUS_INSTANCE', 'Multiple native KiCad instances are available. Set KICAD_API_SOCKET explicitly.', live); }
    if (live.length === 1) { if (await probe(live[0])) return; }
    this.socket = this.defaultSocket;
    if (this.startGUI && !options.signal?.aborted && Date.now() < deadline) {
      await this.startGUI(this.defaultSocket);
      while (Date.now() < deadline && !options.signal?.aborted) {
        if (await probe(this.defaultSocket)) return;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    throw new DirectError(options.signal?.aborted ? 'CANCELLED' : 'IPC_UNAVAILABLE', 'Native KiCad IPC is unavailable. Check GUI startup and Preferences > API server; no project or edit was replayed.', this.defaultSocket);
  }
  async openDocuments(types, options = {}) {
    const documents = [];

    for (const docType of types) {
      try {
        const result = await this.call('kiapi.common.commands.GetOpenDocuments', { type: docType }, options);
        documents.push(...(result.documents ?? []));
      } catch (err) {
        // A document type without an open editor frame has no registered handler.
        // That means "nothing of this type is open", not a broken connection.
        if (err.code !== 'UNHANDLED') throw err;
      }
    }

    return documents;
  }
  async resolveOpenDocument(action, body, options = {}) {
    const typeHints = array(body.types ?? []).map(String);
    const kinds = action.startsWith('schematic.') || typeHints.some(t => t.includes('_SCH_'))
      ? ['DOCTYPE_SCHEMATIC']
      : action.startsWith('board.') || action.startsWith('pcb.') || typeHints.some(t => t.includes('_PCB_'))
        ? ['DOCTYPE_PCB']
        : ['DOCTYPE_PCB', 'DOCTYPE_SCHEMATIC', 'DOCTYPE_FOOTPRINT'];
    const documents = await this.openDocuments(kinds, options);
    if (!documents.length) {
      const label = kinds.map(t => t.replace('DOCTYPE_', '').toLowerCase()).join('/');
      throw new DirectError('NO_OPEN_DOCUMENT', `No open ${label} editor document. Open it in KiCad or pass an explicit document.`);
    }
    if (documents.length > 1) throw new DirectError('AMBIGUOUS_DOCUMENT', 'Multiple editor documents are open; pass an explicit document.');
    return documents[0];
  }
  async call(request, payload, options = {}) {
    await this.connect(options);
    return this.callRaw(request, payload, options);
  }
  async callRaw(request, payload, options = {}) {
    if (!requests.has(request)) bad('Message is not a registered KiCad request: ' + request);
    const data = encode('kiapi.common.ApiRequest', {
      header: { client_name: `kicad-js-${process.pid}`, kicad_token: this.token },
      message: { ...payload, '@type': request },
    });
    const raw = await this.transport.request(data, options);
    const rep = type('kiapi.common.ApiResponse').decode(raw);
    if (rep.status?.status !== 1) throw new DirectError(root.lookupEnum('kiapi.common.ApiStatusCode').valuesById[rep.status?.status ?? 0]?.replace(/^AS_/, '') ?? 'IPC_ERROR', rep.status?.error_message ?? 'Missing KiCad response status');
    if (this.token && rep.header?.kicad_token !== this.token) throw new DirectError('TOKEN_MISMATCH', 'KiCad instance changed');
    const expected = requests.get(request).response;
    const returned = rep.message?.type_url?.split('/').at(-1);
    if (returned !== expected) throw new DirectError('IPC_BAD_RESPONSE', `Expected ${expected}, received ${returned}`);
    const result = decode(expected, rep.message.value);
    checkResponse(expected, result);
    return result;
  }
  async action(action, input, options = {}) {
    const spec = mappings[action];
    if (!spec) bad('Unknown IPC action ' + action);
    const p = { ...input }, requestType = type(spec.request), body = { ...(p.request ?? {}) };
    const take = (from, to, transform = v => v) => { if (p[from] !== undefined) { body[to] = transform(p[from]); delete p[from]; } };
    // Consume nested containers before adding document/output/timeout aliases.
    // Otherwise the generic field loop replaces the complete job/header with
    // the caller's partial settings and loses the target document.
    for (const [field, alias] of [['header','header'],['job_settings','jobSettings']]) {
      if (!requestType.fields[field]) continue;
      if (p[field] !== undefined && alias !== field && p[alias] !== undefined) bad('Duplicate option ' + alias);
      const key=p[field] !== undefined ? field : alias;
      if (p[key] !== undefined) { if (!object(p[key])) bad(key+' must be an object'); body[field]={...body[field],...p[key]}; delete p[key]; }
    }
    const schematic = action.startsWith('schematic.');
    if (spec.confirm && p.confirm !== true) bad('confirm:true is required');
    if (spec.requireDocument && !p.document && !body.document) bad('Explicit document is required');
    if (action === 'editor.run_action') {
      if (!p.unchecked && !native.tools.some(t => t.name === p.action)) bad('Unknown native action; use editor.native.search, or unchecked:true for a plugin action');
    }
    if (action === 'project.open') { take('document', 'path'); take('project', 'path'); }
    if (['project.open', 'schematic.create'].includes(action)) {
      take('path', 'path');
      if (body.path) body.path = path.resolve(body.path);
      body.type = action === 'schematic.create' ? 'DOCTYPE_SCHEMATIC' : body.path?.endsWith('.kicad_pro') ? 'DOCTYPE_PROJECT' : body.path?.endsWith('.kicad_sch') ? 'DOCTYPE_SCHEMATIC' : 'DOCTYPE_PCB';
    }
    if (action === 'document.list' || action === 'project.info') {
      const aliases = { pcb: 'PCB', board: 'PCB', schematic: 'SCHEMATIC', sch: 'SCHEMATIC', footprint: 'FOOTPRINT', symbol: 'SYMBOL', project: 'PROJECT', drawing_sheet: 'DRAWING_SHEET' };
      if (action === 'document.list' && p.type === undefined && body.type === undefined) {
        const documents = await this.openDocuments(['DOCTYPE_PCB', 'DOCTYPE_SCHEMATIC', 'DOCTYPE_FOOTPRINT'], options);
        return ok(action, { documents });
      }
      body.type = aliases[p.type] ? 'DOCTYPE_' + aliases[p.type] : p.type ?? 'DOCTYPE_PCB';
      const types = root.lookupEnum('kiapi.common.types.DocumentType');
      if (types.values[body.type] === undefined && types.valuesById[body.type] === undefined) bad('Unknown document type: ' + body.type);
      delete p.type;
      if (action === 'document.list') {
        const documents = await this.openDocuments([body.type], options);
        return ok(action, { documents });
      }
    }
    if (action === 'board.origin.get' || action === 'board.origin.set') {
      body.type = ['drill', 'drill_origin', 'BOT_DRILL'].includes(p.type) ? 'BOT_DRILL' : 'BOT_GRID'; delete p.type;
      if (action.endsWith('.set')) { body.origin = position(p); for (const k of ['xMm', 'yMm', 'xNm', 'yNm', 'x_nm', 'y_nm', 'x', 'y']) delete p[k]; }
    }
    if (action === 'board.hittest') { body.position = position(p); for (const k of ['xMm', 'yMm', 'xNm', 'yNm', 'x_nm', 'y_nm', 'x', 'y']) delete p[k]; }
    if (action === 'board.plane.create') {
      take('outline', 'outline', a => a.map(position));
      take('clearanceNm', 'clearance', n => ({ value_nm: n }));
      take('minThicknessNm', 'min_thickness', n => ({ value_nm: n }));
    }
    if (action === 'schematic.place.symbol' || action === 'library.get.symbol') take('libId', 'id', libraryId);
    if (action === 'schematic.place.symbol') take('position', 'position', position);
    if (action.endsWith('.items.get')) take('types', 'types', a => array(a).map(v => objectType(v, schematic)));
    if (action.endsWith('.items.create') || action.endsWith('.items.update')) take('items', 'items', a => required({ a }, 'a').map(v => itemAny(v, schematic)));
    if (action.endsWith('.items.delete')) take('ids', 'item_ids');
    if (requestType.fields.header?.resolvedType?.name === 'ItemHeader') {
      body.header ??= {};
      if (p.container && requestType.fields.container) { body.container = typeof p.container === 'string' ? p.container : p.container.id; delete p.container; }
    }
    if (action === 'editor.commit.end' && p.action) take('action', 'action', a => ['drop', 'cancel', 'discard'].includes(a) ? 'CMA_DROP' : a === 'commit' ? 'CMA_COMMIT' : bad('action must be commit or drop'));
    if (action === 'board.flip') take('direction', 'direction', d => ['y', 'top', 'bottom', 'top_bottom'].includes(d) ? 'BFD_TOP_BOTTOM' : ['x', 'left', 'right', 'left_right'].includes(d) ? 'BFD_LEFT_RIGHT' : bad('Invalid flip direction'));
    if (['board.items.by_net', 'board.netclasses.get'].includes(action)) take('nets', action === 'board.netclasses.get' ? 'net' : 'nets', a => array(a).map(name => typeof name === 'string' ? { name } : name));
    if (['board.items.connected', 'board.items.get_by_id', 'board.bbox.get', 'editor.selection.add', 'editor.selection.remove', 'board.flip'].includes(action)) take('ids', 'items');
    take('netlist', 'netlist_path');
    for (const [alias, key] of Object.entries(spec.aliases ?? {})) take(alias, key);
    const docField = spec.docField ?? (requestType.fields.board?.resolvedType?.name === 'DocumentSpecifier' ? 'board' : requestType.fields.schematic?.resolvedType?.name === 'DocumentSpecifier' ? 'schematic' : requestType.fields.document?.resolvedType?.name === 'DocumentSpecifier' ? 'document' : requestType.fields.header?.resolvedType?.name === 'ItemHeader' ? 'header.document' : requestType.fields.job_settings ? 'job_settings.document' : undefined);
    if (docField) {
      const keys = docField.split('.');
      let parent = body;
      for (const key of keys.slice(0, -1)) parent = parent[key] ??= {};
      const key = keys.at(-1);
      const doc = p.document ?? (typeof p.board === 'string' ? p.board : undefined);
      if (doc) parent[key] = documentSpecifier(doc);
      else if (!parent[key]) {
        parent[key] = await this.resolveOpenDocument(action, { ...body, types: body.types ?? p.types }, options);
      }
      delete p.document;
      if (['schematic', 'sch', 'pcb', 'board'].includes(p.type) && !requestType.fields.type) delete p.type;
      if (typeof p.board === 'string') delete p.board;
    }
    if (requestType.fields.job_settings) {
      const job = body.job_settings ??= {};
      if (p.output) { job.output_path = p.output; delete p.output; }
      if (p.timeoutMs) { job.options = { ...job.options, timeout_ms: p.timeoutMs }; }
    }
    if (layerJobs.has(action)) {
      // Accept the CLI's comma separated form; the native plot job rejects an empty layer list.
      if (typeof p.layers === 'string') p.layers = p.layers.split(',').map(s => s.trim()).filter(Boolean);
      if (!(p.layers ?? p.plotSettings?.layers ?? p.plot_settings?.layers ?? body.plot_settings?.layers)?.length) bad(`layers is required for ${action}: an array of layer names such as ["F.Cu","F.SilkS","Edge.Cuts"]`);
    }
    const ignored = new Set(['request', 'timeoutMs', 'confirm', 'unchecked', 'dryRun']);
    for (const [key, value] of Object.entries(p)) {
      if (value === undefined || (ignored.has(key) && !requestType.fields[snake(key)])) continue;
      const f = requestType.fields[key] ?? requestType.fields[snake(key)];
      if (f) body[f.name] = value;
      else if (requestType.fields.plot_settings?.resolvedType?.fields[snake(key)]) (body.plot_settings ??= {})[snake(key)] = value;
      else bad(`Unknown payload key ${key} for ${action}`);
    }
    if (input.dryRun && !requestType.fields.dry_run) return ok(action, { dryRun: true, applied: false, requestType: spec.request, request: normalize(requestType, body) });
    const result = await this.call(spec.request, body, { ...options, ...(p.timeoutMs ? { timeoutMs: p.timeoutMs } : {}) });
    if (action === 'editor.run_action') Object.assign(result, { completionVerified: false, execution: 'submitted', action: input.action, editor: input.editor ?? '' });
    if (action === 'board.items.from_string' && !result.createdItems?.length) throw new DirectError('KICAD_HANDLER_STUB', 'Native parser created no items');
    return ok(action, result, result.outputPath);
  }
  close() { this.transport.close(); }
}

function checkResponse(name, result) {
  const status = result.status;
  if (status && (/^IRS_/.test(status) && status !== 'IRS_OK' || status === 'CRS_INVALID' || ['RAS_INVALID', 'RAS_FRAME_NOT_OPEN', 'CS_FAILED'].includes(status))) throw new DirectError('NATIVE_ACTION_FAILED', status, result);
  if (name.endsWith('.ConnectivityProof') && !result.ok) throw new DirectError('CONNECTIVITY_UNPROVEN', 'Native connectivity proof failed', result);
  if (name.endsWith('.VerifyPlaneResponse') && (result.unconnectedPads?.length || result.unconnectedVias?.length)) throw new DirectError('PLANE_UNCONNECTED', 'Plane has unconnected pads or vias', result);
  if (name.endsWith('.ImportNetlistResponse') && result.errorCount > 0) throw new DirectError('NETLIST_IMPORT_ERRORS', result.report, result);
  for (const entry of result.createdItems ?? result.updatedItems ?? result.deletedItems ?? []) {
    const code = entry.status?.code ?? entry.status;
    if (!['ISC_OK', 'IDS_OK'].includes(code)) throw new DirectError('ITEM_REQUEST_FAILED', 'One or more items failed', result);
  }
  if (name.endsWith('.RunJobResponse') && !['JS_SUCCESS', 'JS_WARNING'].includes(status)) throw new DirectError(status === 'JS_TIMEOUT' ? 'TIMEOUT' : status === 'JS_CANCELLED' ? 'CANCELLED' : 'JOB_FAILED', result.message || status, result);
}
