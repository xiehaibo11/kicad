// SPDX-License-Identifier: GPL-3.0-or-later
import { bad, number } from './utils.mjs';
import { xy, distance, kindOf, netOf, idOf, padsOf, items, vector } from './board-common.mjs';
export const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function pointSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, d = dx * dx + dy * dy;
  const t = d ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / d)) : 0;
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}
export function segmentDistance(a, b, c, d) {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}
export function inPolygon(p, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (pointSegment(p, a, b) < 1) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
export function arcGeometry(start, mid, end) {
  const a = xy(start), b = xy(mid), c = xy(end), d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1) return { points: [a, c], length: distance(a, c) };
  const aa = a.x ** 2 + a.y ** 2, bb = b.x ** 2 + b.y ** 2, cc = c.x ** 2 + c.y ** 2;
  const center = { x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / d, y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / d };
  const radius = distance(a, center), angle = p => Math.atan2(p.y - center.y, p.x - center.x), norm = x => (x + 2 * Math.PI) % (2 * Math.PI);
  const first = angle(a), final = norm(angle(c) - first), middle = norm(angle(b) - first), sweep = middle <= final ? final : final - 2 * Math.PI;
  const steps = Math.min(4096, Math.max(8, Math.ceil(Math.abs(sweep) * radius / 50000)));
  return { length: Math.abs(sweep) * radius, points: Array.from({ length: steps + 1 }, (_, i) => ({ x: center.x + radius * Math.cos(first + sweep * i / steps), y: center.y + radius * Math.sin(first + sweep * i / steps) })) };
}
export const pairs = points => points.slice(1).map((p, i) => [points[i], p]);
export function shapePaths(shape) {
  if (shape.segment) return [[xy(shape.segment.start), xy(shape.segment.end)]];
  if (shape.arc) return [arcGeometry(shape.arc.start, shape.arc.mid, shape.arc.end).points];
  if (shape.rectangle) {
    const a = xy(shape.rectangle.topLeft), b = xy(shape.rectangle.bottomRight);
    return [[a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a]];
  }
  if (shape.circle) {
    const c = xy(shape.circle.center), r = distance(c, xy(shape.circle.radiusPoint));
    return [Array.from({ length: 97 }, (_, i) => ({ x: c.x + r * Math.cos(i * Math.PI / 48), y: c.y + r * Math.sin(i * Math.PI / 48) }))];
  }
  if (shape.polygon) return shape.polygon.polygons.flatMap(p => [polyLine(p.outline), ...(p.holes ?? []).map(polyLine)]);
  // Unsupported geometry blocks planning instead of being silently ignored.
  bad('Unsupported copper/edge geometry: ' + Object.keys(shape).join(', '));
}
export function polyLine(line) {
  const points = (line?.nodes ?? []).flatMap(n => n.point ? [xy(n.point)] : n.arc ? arcGeometry(n.arc.start, n.arc.mid, n.arc.end).points : []);
  if (line?.closed && points.length && distance(points[0], points.at(-1)) > 1) points.push(points[0]);
  return points;
}
export const trackLength = item => kindOf(item) === 'Arc' ? arcGeometry(item.start, item.mid, item.end).length / 1e6 : distance(xy(item.start), xy(item.end)) / 1e6;
export const trackItem = (a, b, width, layer, net) => ({ type: 'track', json: { start: vector(a), end: vector(b), width: { valueNm: width }, layer, net: { name: net } } });
export async function loadGeometry(dispatch, document) {
  const all = await items(dispatch, document, ['footprint', 'track', 'arc', 'via', 'zone', 'shape']);
  const pads = all.filter(i => kindOf(i) === 'FootprintInstance').flatMap(padsOf), obstacles = [], edges = [];
  for (const pad of pads) {
    const angle = number(pad.item.padStack?.angle?.valueDegrees) * Math.PI / 180;
    // Circumscribed rotated rectangle is conservative for pad clearance.
    const hx = (Math.abs(Math.cos(angle)) * pad.sizeX + Math.abs(Math.sin(angle)) * pad.sizeY) / 2;
    const hy = (Math.abs(Math.sin(angle)) * pad.sizeX + Math.abs(Math.cos(angle)) * pad.sizeY) / 2;
    obstacles.push({ net: pad.net, layers: pad.layers, box: { minX: pad.x - hx, minY: pad.y - hy, maxX: pad.x + hx, maxY: pad.y + hy }, pad });
  }
  for (const item of all) {
    const kind = kindOf(item), net = netOf(item), layers = item.layers ?? [item.layer];
    if (['Track', 'Arc'].includes(kind)) {
      const points = kind === 'Arc' ? arcGeometry(item.start, item.mid, item.end).points : [xy(item.start), xy(item.end)];
      for (const [a, b] of pairs(points)) obstacles.push({ a, b, net, layers, width: number(item.width?.valueNm), id: idOf(item) });
    } else if (kind === 'Via') {
      const center = xy(item.position), diameter = Math.max(...(item.padStack?.copperLayers ?? []).map(l => number(l.size?.xNm)), 0);
      obstacles.push({ a: center, b: center, net, layers: ['*'], width: diameter, id: idOf(item) });
    } else if (kind === 'BoardGraphicShape') {
      if (item.layer === 'BL_Edge_Cuts') for (const [a, b] of shapePaths(item.shape).flatMap(pairs)) edges.push({ a, b });
      else if (item.layer?.endsWith('_Cu')) {
        const paths = shapePaths(item.shape), fill = item.shape.attributes?.fill?.fillType;
        if (fill && !['GFT_UNKNOWN', 'GFT_UNFILLED'].includes(fill)) {
          if (item.shape.polygon) obstacles.push({ polygons: item.shape.polygon.polygons.map(p => ({ outer: polyLine(p.outline), holes: (p.holes ?? []).map(polyLine) })), net, layers });
          else if (item.shape.circle || item.shape.rectangle) obstacles.push({ polygons: paths.map(outer => ({ outer, holes: [] })), net, layers });
          else bad('Unsupported filled copper geometry');
        }
        for (const [a, b] of paths.flatMap(pairs)) obstacles.push({ a, b, net, layers, width: number(item.shape?.attributes?.stroke?.width?.valueNm) });
      }
    } else if (kind === 'Zone') {
      const keepout = item.ruleAreaSettings;
      const polygons = (item.outline?.polygons ?? []).map(p => ({ outer: polyLine(p.outline), holes: (p.holes ?? []).map(polyLine) }));
      if (keepout?.keepoutTracks || keepout?.keepoutVias) obstacles.push({ polygons, net: null, layers, keepout });
      else if (item.copperSettings) {
        const filled = item.filledPolygons ?? [];
        if (filled.length) for (const f of filled) obstacles.push({ polygons: (f.shapes?.polygons ?? f.polygons?.polygons ?? []).map(p => ({ outer: polyLine(p.outline), holes: (p.holes ?? []).map(polyLine) })), net: item.copperSettings.net?.name, layers: [f.layer] });
        else obstacles.push({ polygons, net: item.copperSettings.net?.name, layers });
      }
    }
  }
  return { all, pads, obstacles, edges };
}
function layerMatches(layers, layer) { return layer === '*' || layers.includes('*') || layers.includes(layer) || layers.includes('BL_UNDEFINED'); }
function boxSegments(box) {
  const points = [{ x: box.minX, y: box.minY }, { x: box.maxX, y: box.minY }, { x: box.maxX, y: box.maxY }, { x: box.minX, y: box.maxY }];
  return [...pairs(points), [points[3], points[0]]];
}
export function blocked(a, b, net, layer, width, clearance, geometry, { ignoreId, via = false } = {}) {
  const radius = width / 2 + clearance;
  for (const obstacle of geometry.obstacles) {
    if (obstacle.id && obstacle.id === ignoreId || obstacle.net && obstacle.net === net || !layerMatches(obstacle.layers, layer)) continue;
    if (obstacle.keepout && !(via ? obstacle.keepout.keepoutVias : obstacle.keepout.keepoutTracks)) continue;
    if (obstacle.box) {
      const box = obstacle.box, inside = p => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
      if (inside(a) || inside(b) || boxSegments(box).some(([c, d]) => segmentDistance(a, b, c, d) < radius)) return true;
    } else if (obstacle.polygons) {
      for (const polygon of obstacle.polygons) {
        const inside = p => inPolygon(p, polygon.outer) && !polygon.holes.some(h => inPolygon(p, h));
        if (inside(a) || inside(b) || [polygon.outer, ...polygon.holes].flatMap(pairs).some(([c, d]) => segmentDistance(a, b, c, d) < radius)) return true;
      }
    } else if (segmentDistance(a, b, obstacle.a, obstacle.b) < radius + obstacle.width / 2 - 1) return true;
  }
  for (const edge of geometry.edges) if (segmentDistance(a, b, edge.a, edge.b) < radius) return true;
  if (geometry.edges.length) {
    // Ray parity uses the complete Edge.Cuts graph (including holes).
    const inside = p => geometry.edges.reduce((n, { a, b }) => n + ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x ? 1 : 0), 0) % 2 === 1;
    if (!inside(a) || !inside(b)) return true;
  }
  return false;
}
