// SPDX-License-Identifier: GPL-3.0-or-later
// Recognize retired EDA relays even when users renamed their configuration key.
export function isLegacyKiCadServer(name, value) {
  if (/^(?:kicad|easyeda)(?:[-_]agent)?$/i.test(name)) return true;
  if (!value || typeof value !== 'object') return false;
  const argv = [value.command, ...(Array.isArray(value.args) ? value.args : [])].flat();
  return argv.some(arg => typeof arg === 'string' &&
    /(?:^|[/\\\s])(?:kicad-agent(?:\.exe)?|easyeda-mcp\.mjs|easyeda-agent(?:-connector)?(?:\.eext)?)(?:$|\s)/i.test(arg)) ||
    argv.some(arg => typeof arg === 'string' && /(?:^|[/\\])kicad-direct\.mjs$/.test(arg)) && argv.includes('mcp');
}
export function withoutLegacyKiCadServers(servers = {}) {
  return Object.fromEntries(Object.entries(servers).filter(([name, value]) => !isLegacyKiCadServer(name, value)));
}
