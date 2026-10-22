// SPDX-License-Identifier: GPL-3.0-or-later
import protobuf from 'protobufjs/light.js';
import schema from './generated/schema.json' with { type: 'json' };
import commands from './generated/commands.json' with { type: 'json' };
import { bad, object } from './utils.mjs';

export const root = protobuf.Root.fromJSON(schema).resolveAll();
export const requests = new Map(commands.map(item => [item.request, item]));
export const snake = value => value.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
export const camel = value => value.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export function type(name) { try { return root.lookupType(name.replace(/^.*\//, '')); } catch { bad('Unknown protobuf type: ' + name); } }
export function normalize(t, value) {
  if (t.fullName === '.google.protobuf.Any') {
    if (object(value) && value['@type']) {
      const { ['@type']: name, ...body } = value;
      return { type_url: 'type.googleapis.com/' + type(name).fullName.slice(1), value: encode(name, body) };
    }
    if (object(value) && value.typeUrl && value.valueBase64) return { type_url: value.typeUrl, value: Buffer.from(value.valueBase64, 'base64') };
  }
  if (t.name === 'KIID' && typeof value === 'string') value = { value };
  if (!object(value)) bad('Expected object for ' + t.fullName);
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined || raw === null) continue;
    const field = t.fields[key] ?? t.fields[snake(key)];
    if (!field) bad(`Unknown field ${t.fullName}.${key}; valid: ${Object.keys(t.fields).join(', ')}`);
    const convert = v => {
      const nested = field.resolvedType;
      if (nested instanceof protobuf.Type) return normalize(nested, v);
      if (nested instanceof protobuf.Enum) {
        let val = v;
        if (nested.name === 'BoardLayer' && typeof val === 'string' && !val.startsWith('BL_')) val = 'BL_' + val.replaceAll('.', '_');
        if (typeof val === 'string') {
          if (nested.values[val] === undefined) bad(`Unknown ${nested.name}: ${v}`);
          return nested.values[val];
        }
        if (!Number.isInteger(val) || nested.valuesById[val] === undefined) bad(`Invalid ${nested.name}: ${v}`);
        return val;
      }
      if (field.type === 'string' && typeof v !== 'string') bad(`${key} must be a string`);
      if (field.type === 'bool' && typeof v !== 'boolean') bad(`${key} must be boolean`);
      if (field.type === 'bytes') {
        if (typeof v === 'string') return Buffer.from(v, 'base64');
        if (!Buffer.isBuffer(v) && !(v instanceof Uint8Array)) bad(`${key} must be base64 or bytes`);
      }
      if (/^(s?fixed|s?int|uint)\d+$/.test(field.type)) {
        if ((typeof v !== 'number' && typeof v !== 'string') || !/^-?\d+$/.test(String(v))) bad(`${key} must be an integer`);
        if (typeof v === 'number' && !Number.isSafeInteger(v)) bad(`${key} exceeds JS integer precision; pass a decimal string`);
        const n = BigInt(v), unsigned = /^(uint|fixed)/.test(field.type), bits = field.type.endsWith('64') ? 64n : 32n;
        if (n < (unsigned ? 0n : -(1n << (bits - 1n))) || n > (unsigned ? (1n << bits) - 1n : (1n << (bits - 1n)) - 1n)) bad(`${key} is outside ${field.type}`);
      }
      if (/^(float|double)$/.test(field.type) && (typeof v !== 'number' || !Number.isFinite(v))) bad(`${key} must be finite`);
      return v;
    };
    if (field.map) {
      if (!object(raw)) bad(`${key} must be an object`);
      out[field.name] = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, convert(v)]));
    } else if (field.repeated) {
      if (!Array.isArray(raw)) bad(`${key} must be an array`);
      out[field.name] = raw.map(convert);
    } else out[field.name] = convert(raw);
  }
  for (const oneof of t.oneofsArray) {
    if (oneof.oneof.filter(key => out[key] !== undefined).length > 1) bad(`Only one ${t.name}.${oneof.name} field may be set`);
  }
  return out;
}
export function encode(name, value) {
  const t = type(name), normalized = normalize(t, value);
  const msg = t.fromObject(normalized), error = t.verify(msg);
  if (error) bad(`${name}: ${error}`);
  return Buffer.from(t.encode(msg).finish());
}
export function decode(name, bytes) {
  const t = type(name), msg = t.decode(bytes);
  function json(t, m) {
    if (t.fullName === '.google.protobuf.Any' && m.type_url) {
      const n = m.type_url.replace(/^.*\//, '');
      try { return { '@type': m.type_url, ...decode(n, m.value) }; }
      catch { return { typeUrl: m.type_url, valueBase64: Buffer.from(m.value ?? []).toString('base64') }; }
    }
    const out = t.toObject(m, { longs: String, enums: String, bytes: String, defaults: true, arrays: true, objects: true });
    for (const f of t.fieldsArray) {
      let v = out[f.name];
      if (m[f.name] != null && f.resolvedType instanceof protobuf.Type) {
        v = f.repeated ? m[f.name].map(x => json(f.resolvedType, x)) : f.map ? Object.fromEntries(Object.entries(m[f.name]).map(([k, x]) => [k, json(f.resolvedType, x)])) : json(f.resolvedType, m[f.name]);
      }
      if (Object.hasOwn(out, f.name)) { delete out[f.name]; out[camel(f.name)] = v; }
    }
    return out;
  }
  return json(t, msg);
}
export function requestSchema(name) {
  const t = type(name);
  return Object.fromEntries(t.fieldsArray.map(f => [camel(f.name), { type: f.resolvedType?.fullName?.slice(1) ?? f.type, repeated: f.repeated, map: Boolean(f.map), ...(f.resolvedType instanceof protobuf.Enum ? { values: f.resolvedType.values } : {}) }]));
}
