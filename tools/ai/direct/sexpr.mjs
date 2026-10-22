// SPDX-License-Identifier: GPL-3.0-or-later
import { bad } from './utils.mjs';
// Nodes retain byte spans for surgical edits without reformatting the design.
export function parse(text) {
  let i = 0, count = 0;
  const skip = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  function node(depth = 0) {
    if (depth > 256 || ++count > 5000000) bad('S-expression complexity limit');
    skip(); const start = i;
    if (text[i] === '(') {
      i++; const children = [];
      for (;;) {
        skip();
        if (i >= text.length) bad('Unterminated S-expression');
        if (text[i] === ')') { i++; return { children, start, end: i }; }
        children.push(node(depth + 1));
      }
    }
    if (text[i] === '"') {
      i++; let value = '';
      while (i < text.length) {
        const c = text[i++];
        if (c === '"') return { value, start, end: i };
        if (c === '\\') { if (i >= text.length) bad('Invalid escape'); const e = text[i++]; value += ({ n: '\n', r: '\r', t: '\t' })[e] ?? e; } else value += c;
      }
      bad('Unterminated quoted string');
    }
    while (i < text.length && !/[\s()]/.test(text[i])) i++;
    if (start === i) bad('Unexpected S-expression token');
    return { value: text.slice(start, i), start, end: i };
  }
  const result = node(); skip(); if (i !== text.length) bad('Trailing S-expression data'); return result;
}
export const head = node => node?.children?.[0]?.value;
export const children = (node, name) => (node?.children ?? []).filter(n => head(n) === name);
export const child = (node, name) => children(node, name)[0];
export const values = node => node?.children?.slice(1).map(n => n.value) ?? [];
export const value = (node, name, fallback = '') => values(child(node, name))[0] ?? fallback;
export const quote = s => JSON.stringify(String(s));
export const print = node => node.children ? '(' + node.children.map(print).join(' ') + ')' : quote(node.value);
export function replace(text, edits) {
  let previous = text.length;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    if (e.end > previous || e.start > e.end) bad('Overlapping S-expression edits');
    text = text.slice(0, e.start) + e.text + text.slice(e.end); previous = e.start;
  }
  return text;
}
