// SPDX-License-Identifier: GPL-3.0-or-later
// Model-facing views of large native results. Runtime handlers and workflows keep the raw
// protobuf JSON; only tool calls are shaped here. A 155-footprint board is 5.6 MB of raw
// footprint JSON, so large item reads return a compact mm view unless detail:"full" is asked.
import { mappings } from './ipc.mjs';
import { type, snake } from './protobuf.mjs';
import { bad, object, array } from './utils.mjs';

export const RAW_LIMIT = 24 * 1024, DEFAULT_LIMIT = 100, MAX_LIMIT = 1000;
const ITEM_READS = ['board.items.get', 'board.items.by_net', 'board.items.by_netclass', 'board.items.get_by_id', 'board.items.connected', 'schematic.items.get', 'editor.selection.get'];
const VIEW_KEYS = ['detail', 'limit', 'offset', 'refs', 'nets', 'layers'];
// ipc.mjs aliases that are native request inputs, e.g. the nets of board.items.by_net.
const NATIVE_INPUTS = { 'board.items.by_net': ['nets'], 'board.items.get_by_id': ['ids'], 'board.items.connected': ['ids'] };
const viewKeys = new Map(ITEM_READS.map(action => {
  const fields = type(mappings[action].request).fields;
  return [action, VIEW_KEYS.filter(key => !fields[key] && !fields[snake(key)] && !(NATIVE_INPUTS[action] ?? []).includes(key))];
}));
export const VIEW_OPTIONS = {
  detail: 'auto (default: unfiltered results under 24 KB stay raw JSON, others compact) | compact | full (raw protobuf JSON, needed for items.update)',
  limit: `items per page, 1..${MAX_LIMIT}; compact default ${DEFAULT_LIMIT}`, offset: 'first item index (paging)',
  refs: 'reference designators, * and ? wildcards; adds pad/pin lists', nets: 'net names, wildcards allowed', layers: 'layer names such as F.Cu or BL_F_Cu',
};
export const viewOptionsFor = action => viewKeys.has(action) ? Object.fromEntries(viewKeys.get(action).map(key => [key, VIEW_OPTIONS[key]])) : undefined;

/** Separates view options from the native request payload. */
export function splitView(action, payload) {
  const keys = viewKeys.get(action);
  if (!keys || !object(payload)) return { payload };
  const rest = { ...payload }, view = {};
  for (const key of keys) if (rest[key] !== undefined) { view[key] = rest[key]; delete rest[key]; }
  if (view.detail !== undefined && !['auto', 'compact', 'full'].includes(view.detail)) bad('detail must be auto, compact or full');
  if (view.limit !== undefined && (!Number.isInteger(view.limit) || view.limit < 1 || view.limit > MAX_LIMIT)) bad(`limit must be 1..${MAX_LIMIT}`);
  if (view.offset !== undefined && (!Number.isInteger(view.offset) || view.offset < 0)) bad('offset must be a non-negative integer');
  for (const key of ['refs', 'nets', 'layers']) if (view[key] !== undefined) {
    view[key] = array(view[key]);
    if (!view[key].length || view[key].some(v => typeof v !== 'string' || !v)) bad(key + ' must be a non-empty string or array of strings');
  }
  return { payload: rest, view };
}

const kindOf = item => String(item?.['@type'] ?? '').split('.').at(-1);
const mm = nm => nm === undefined || nm === null || nm === '' ? undefined : Math.round(Number(nm) / 100) / 1e4;
const pt = p => p ? [mm(p.xNm ?? p.x_nm ?? 0), mm(p.yNm ?? p.y_nm ?? 0)] : undefined;
const len = v => mm(v?.valueNm ?? v?.value_nm);
const textOf = v => { while (v && typeof v === 'object') v = v.text; return typeof v === 'string' ? v : undefined; };
const libId = id => id ? (id.libraryNickname ? id.libraryNickname + ':' : '') + (id.entryName ?? '') : undefined;
const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
const prune = value => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)));
const layerName = value => typeof value === 'string' && !value.startsWith('BL_') ? 'BL_' + value.replaceAll('.', '_') : value;
const padsOf = item => (item.definition?.items ?? []).filter(i => kindOf(i) === 'Pad');
// Library pins of every unit; unit 0 pins are shared by all units.
const pinsOf = item => (item.definition?.items ?? []).filter(d => kindOf(d.item ?? d) === 'SchematicPin').map(d => ({ pin: d.item ?? d, unit: d.unit?.unit ?? 0 }));
function points(polygons = []) {
  const nodes = polygons.flatMap(p => [p.outline, ...(p.holes ?? [])]).flatMap(o => o?.nodes ?? []).map(n => n.point).filter(Boolean);
  if (!nodes.length) return { vertices: 0 };
  const xs = nodes.map(n => mm(n.xNm)), ys = nodes.map(n => mm(n.yNm));
  return { vertices: nodes.length, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}
function geometry(shape = {}) {
  if (shape.segment) return { geometry: 'segment', start: pt(shape.segment.start), end: pt(shape.segment.end) };
  if (shape.rectangle) return { geometry: 'rectangle', start: pt(shape.rectangle.topLeft), end: pt(shape.rectangle.bottomRight) };
  if (shape.arc) return { geometry: 'arc', start: pt(shape.arc.start), mid: pt(shape.arc.mid), end: pt(shape.arc.end) };
  if (shape.circle) return { geometry: 'circle', center: pt(shape.circle.center), radiusPoint: pt(shape.circle.radiusPoint) };
  if (shape.polygon) return { geometry: 'polygon', ...points(shape.polygon.polygons) };
  if (shape.bezier) return { geometry: 'bezier', start: pt(shape.bezier.start), end: pt(shape.bezier.end) };
  return {};
}
// Footprint pad lists omit pad ids (a 355-ball BGA would add 16 KB); Pad items keep them.
const pad = p => prune({ number: p.number, net: p.net?.name, at: pt(p.position), type: p.type, size: pt(p.padStack?.copperLayers?.[0]?.size), drill: mm(p.padStack?.drill?.diameter?.xNm) || undefined });
const flag = value => value || undefined;

/** One line of essentials per item: ids, references, nets, layers and geometry in mm. */
export function compactItem(item, withPads = false) {
  const kind = kindOf(item), id = item.id?.value ?? item.id;
  switch (kind) {
    case 'FootprintInstance': {
      const pads = padsOf(item), attributes = item.attributes ?? item.definition?.attributes;
      return prune({ id, kind: 'Footprint', ref: textOf(item.referenceField), value: textOf(item.valueField), footprint: libId(item.definition?.id), at: pt(item.position), rotation: item.orientation?.valueDegrees || undefined, layer: item.layer, locked: flag(item.locked === 'LS_LOCKED'), dnp: flag(attributes?.doNotPopulate), padCount: pads.length, nets: unique(pads.map(p => p.net?.name)), pads: withPads ? pads.map(pad) : undefined });
    }
    case 'Pad': return prune({ id, kind: 'Pad', ...pad(item), parent: item.parent?.value });
    case 'Track': { const [a, b] = [pt(item.start), pt(item.end)]; return prune({ id, kind: 'Track', net: item.net?.name, layer: item.layer, width: len(item.width), start: a, end: b, length: a && b ? Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 1e4) / 1e4 : undefined }); }
    case 'Arc': return prune({ id, kind: 'Arc', net: item.net?.name, layer: item.layer, width: len(item.width), start: pt(item.start), mid: pt(item.mid), end: pt(item.end) });
    case 'Via': return prune({ id, kind: 'Via', net: item.net?.name, at: pt(item.position), type: item.type, diameter: mm(item.padStack?.copperLayers?.[0]?.size?.xNm), drill: mm(item.padStack?.drill?.diameter?.xNm), span: item.padStack?.drill ? [item.padStack.drill.startLayer, item.padStack.drill.endLayer] : undefined, locked: flag(item.locked === 'LS_LOCKED') });
    case 'Zone': {
      const copper = item.copperSettings ?? {};
      return prune({ id, kind: 'Zone', name: item.name, net: copper.net?.name, type: item.type, layers: item.layers, priority: item.priority, filled: item.filled, outline: points(item.outline?.polygons), filledPolygons: (item.filledPolygons ?? []).reduce((n, f) => n + (f.shapes?.polygons?.length ?? 0), 0), clearance: len(copper.clearance), minThickness: len(copper.minThickness), connection: copper.connection?.zoneConnection });
    }
    case 'BoardGraphicShape': case 'SchematicGraphicShape':
      return prune({ id, kind: 'Shape', layer: item.layer, net: item.net?.name, ...geometry(item.shape), width: len(item.shape?.attributes?.stroke?.width) || undefined, filled: flag(item.shape?.attributes?.fill?.fillType && item.shape.attributes.fill.fillType !== 'GFT_UNFILLED') });
    case 'BoardText': case 'SchematicText': return prune({ id, kind: 'Text', text: textOf(item.text), layer: item.layer, at: pt(item.text?.position ?? item.position) });
    case 'BoardTextBox': case 'SchematicTextBox': return prune({ id, kind: 'TextBox', text: textOf(item.textbox ?? item.text), layer: item.layer });
    case 'SchematicSymbolInstance': {
      const unit = item.unit?.unit, pins = pinsOf(item).filter(p => !unit || !p.unit || p.unit === unit).map(p => p.pin);
      return prune({ id, kind: 'Symbol', ref: textOf(item.referenceField), value: textOf(item.valueField), footprint: textOf(item.footprintField), lib: libId(item.definition?.id), at: pt(item.position), orientation: item.transform?.orientation, mirror: item.transform?.mirrorX ? 'x' : item.transform?.mirrorY ? 'y' : undefined, unit, sheet: item.path?.pathHumanReadable, power: flag(/POWER/.test(item.definition?.type ?? '')), dnp: flag(item.attributes?.doNotPopulate), excludeFromBom: flag(item.attributes?.excludeFromBillOfMaterials), excludeFromBoard: flag(item.attributes?.excludeFromBoard), pinCount: pins.length, pins: withPads ? pins.map(p => prune({ number: p.number, name: p.name, type: p.electricalType })) : undefined });
    }
    case 'SchematicLine': return prune({ id, kind: { SLT_WIRE: 'Wire', SLT_BUS: 'Bus' }[item.type] ?? 'Line', start: pt(item.start), end: pt(item.end) });
    case 'Junction': return prune({ id, kind: 'Junction', at: pt(item.position) });
    case 'NoConnectMarker': return prune({ id, kind: 'NoConnect', at: pt(item.position) });
    case 'LocalLabel': case 'GlobalLabel': case 'HierarchicalLabel': case 'DirectiveLabel':
      return prune({ id, kind, text: textOf(item.text), at: pt(item.position), shape: item.shape });
    default: return prune({ id, kind, ...Object.fromEntries(Object.entries(item).filter(([k, v]) => k !== '@type' && k !== 'id' && ['string', 'number', 'boolean'].includes(typeof v))), at: pt(item.position) });
  }
}

const refOf = item => ['FootprintInstance', 'SchematicSymbolInstance'].includes(kindOf(item)) ? textOf(item.referenceField) : undefined;
function netsOf(item) {
  const kind = kindOf(item);
  if (kind === 'FootprintInstance') return padsOf(item).map(p => p.net?.name);
  if (kind === 'Zone') return [item.copperSettings?.net?.name];
  if (/Label$/.test(kind)) return [textOf(item.text)];
  return [item.net?.name];
}
const layersOf = item => [item.layer, ...(item.layers ?? []), ...(item.padStack?.layers ?? [])].filter(Boolean);
function matcher(patterns, caseless) {
  const expressions = patterns.map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*').replaceAll('?', '.') + '$', caseless ? 'i' : ''));
  return value => typeof value === 'string' && expressions.some(e => e.test(value));
}
function filterItems(items, view) {
  const refs = view.refs && matcher(view.refs, true), nets = view.nets && matcher(view.nets, true), layers = view.layers && new Set(view.layers.map(layerName));
  if (!refs && !nets && !layers) return items;
  return items.filter(item => (!refs || refs(refOf(item))) && (!nets || netsOf(item).some(nets)) && (!layers || layersOf(item).some(l => layers.has(l))));
}
function fits(items, limit) {
  let bytes = 2;
  for (const item of items) { bytes += JSON.stringify(item).length + 1; if (bytes > limit) return false; }
  return true;
}
function counts(items) {
  const byKind = {}, byLayer = {};
  for (const item of items) {
    const kind = compactKind(item); byKind[kind] = (byKind[kind] ?? 0) + 1;
    if (typeof item.layer === 'string') byLayer[item.layer] = (byLayer[item.layer] ?? 0) + 1;
  }
  return { byKind, ...(Object.keys(byLayer).length ? { byLayer } : {}) };
}
const compactKind = item => kindOf(item) === 'SchematicLine' ? ({ SLT_WIRE: 'Wire', SLT_BUS: 'Bus' })[item.type] ?? 'Line' : ({ FootprintInstance: 'Footprint', SchematicSymbolInstance: 'Symbol', BoardGraphicShape: 'Shape', SchematicGraphicShape: 'Shape', BoardText: 'Text', SchematicText: 'Text', BoardTextBox: 'TextBox', SchematicTextBox: 'TextBox', NoConnectMarker: 'NoConnect' })[kindOf(item)] ?? kindOf(item);

/** Applies filters, paging and the compact view to an item-read result. Failures pass through. */
export function shapeItems(result, view = {}) {
  const items = result?.data?.items;
  if (!result?.ok || !Array.isArray(items)) return result;
  const filtered = filterItems(items, view), paged = view.limit !== undefined || view.offset !== undefined, offset = view.offset ?? 0;
  const detail = view.detail ?? 'auto', narrowed = filtered !== items || paged;
  const page = limit => filtered.slice(offset, offset + limit), next = shown => offset + shown < filtered.length ? offset + shown : null;
  // auto keeps a small, unfiltered result exactly as before; filters or paging ask for the view.
  if (detail === 'auto' && !narrowed && fits(items, RAW_LIMIT)) return result;
  if (detail === 'full') {
    if (!narrowed) return result;
    const raw = paged ? page(view.limit ?? MAX_LIMIT) : filtered;
    return { ...result, data: { ...result.data, total: filtered.length, ...(filtered.length === items.length ? {} : { unfiltered: items.length }), offset, nextOffset: next(raw.length), items: raw } };
  }
  const shown = page(view.limit ?? DEFAULT_LIMIT), withPads = Boolean(view.refs);
  return { ...result, data: { ...(result.data.status ? { status: result.data.status } : {}), view: 'compact', units: 'mm', total: filtered.length, ...(filtered.length === items.length ? {} : { unfiltered: items.length }), offset, count: shown.length, nextOffset: next(shown.length), counts: counts(filtered), items: shown.map(item => compactItem(item, withPads)),
    note: 'Compact view; coordinates and sizes in mm. Page with offset/limit, narrow with refs/nets/layers (refs adds pads/pins). Raw item JSON (needed for items.update): detail:"full" on a narrowed request, or board.items.get_by_id with ids.' } };
}
