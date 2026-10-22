// SPDX-License-Identifier: GPL-3.0-or-later
import path from 'node:path';
import os from 'node:os';
import { readJSON, required, bad, ok, fail, positive } from './utils.mjs';
import { catalog, byName } from './runtime.mjs';
export function checkPolicy(action, p) {
  const spec = byName.get(action);
  if (!spec) bad('Unknown action');
  if (p.readOnly && spec.mutates) bad('Read-only policy prohibits this action');
  if (p.allowExternal === false && ['external', 'web'].includes(spec.domain)) bad('External actions are disabled');
  if (p.allowedActions && !p.allowedActions.split(',').map(s => s.trim()).includes(action)) bad('Action is outside allowed-actions');
}
export async function ai(p, runtime, options = {}, emit = () => {}) {
  const prompt = required(p, 'prompt'), settings = readJSON(p.settings ?? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'kicad-agent/settings.json'));
  const provider = p.provider ?? settings.default ?? (Object.keys(settings.providers ?? {}).length === 1 ? Object.keys(settings.providers)[0] : ''), config = settings.providers?.[provider];
  if (!config) bad('No configured provider selected');
  const base = new URL(required(config, 'baseUrl'));
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) bad('Invalid provider URL; remote providers require HTTPS');
  if (!['', 'openai', 'openai-compatible', 'anthropic', 'deepseek', 'ollama', 'qwen'].includes(config.type ?? '')) bad('Unsupported provider type');
  const model = p.model ?? required(config, 'model'), key = config.apiKeyEnv ? required(process.env, config.apiKeyEnv) : '', maxSteps = positive(p.maxSteps, 20), maxContext = positive(p.maxContextBytes, 512 * 1024);
  if (!Number.isInteger(maxSteps) || maxSteps > 100 || maxContext < 4096) bad('Invalid loop limits');
  const system = 'You operate KiCad through typed actions. Return exactly one JSON object per turn: {"action":"name","payload":{...}} or {"final":"answer"}. Respect scope. Inspect tool evidence and do not declare completed work after failures. Load reference.plan before engineering work. Native DRC and revision-bound audit/release evidence are distinct from heuristic checks. GUI action submission is not completion. Action catalog: ' + JSON.stringify(catalog);
  const messages = [{ role: 'user', content: prompt }], steps = [], failures = new Map();
  emit({ event: 'start', prompt });
  for (let i = 0; i < maxSteps; i++) {
    while (messages.length > 3 && Buffer.byteLength(JSON.stringify(messages)) > maxContext) messages.splice(1, 2);
    const anthropic = config.type === 'anthropic', headers = { 'content-type': 'application/json', ...(anthropic ? { 'x-api-key': key, 'anthropic-version': config.version ?? '2023-06-01' } : key ? { Authorization: 'Bearer ' + key } : {}) };
    const body = { model, messages: anthropic ? messages : [{ role: 'system', content: system }, ...messages], ...(anthropic ? { system, max_tokens: config.maxTokens ?? 8192 } : config.maxTokens ? { max_tokens: config.maxTokens } : {}), ...(config.temperature !== undefined ? { temperature: config.temperature } : {}) };
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout((config.timeoutSeconds ?? 120) * 1000)]) : AbortSignal.timeout((config.timeoutSeconds ?? 120) * 1000);
    const response = await fetch(base.href.replace(/\/$/, '') + (anthropic ? '/v1/messages' : '/chat/completions'), { method: 'POST', headers, body: JSON.stringify(body), signal, redirect: 'error' });
    if (!response.ok) throw new Error('Provider HTTP ' + response.status);
    const raw = await response.text(); if (Buffer.byteLength(raw) > 4 * 1024 * 1024) bad('Provider response exceeds size limit');
    const data = JSON.parse(raw), reply = anthropic ? data.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') : data.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || reply.length > 100000) bad('Invalid model response');
    messages.push({ role: 'assistant', content: reply });
    let decision; try { decision = JSON.parse(reply.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { messages.push({ role: 'user', content: 'Invalid JSON; return one decision object.' }); continue; }
    if (typeof decision.final === 'string' && decision.final.trim()) {
      const report = { provider, model, steps, final: decision.final, ok: failures.size === 0, error: [...failures.values()].join('; ') }; emit({ event: 'final', ...report, steps: steps.length });
      return report.ok ? ok('ai.run', report) : fail('ai.run', 'UNRESOLVED_TOOL_FAILURES', report.error, report);
    }
    let result;
    try { checkPolicy(decision.action, p); if (i === maxSteps - 1) bad('Step limit reached before result could be verified'); emit({ event: 'action', action: decision.action, payload: decision.payload ?? {} }); result = await runtime.dispatch(decision.action, decision.payload ?? {}, options); }
    catch (err) { result = fail(decision.action, err.code ?? 'POLICY_BLOCKED', err.message); }
    const signature = JSON.stringify([decision.action, decision.payload ?? {}]); if (result.ok) failures.delete(signature); else failures.set(signature, decision.action + ': ' + result.error.message);
    const step = { action: decision.action, payload: decision.payload ?? {}, result }; steps.push(step); emit({ event: 'step', step });
    messages.push({ role: 'user', content: JSON.stringify(result).slice(0, Math.floor(maxContext / 2)) });
  }
  const report = fail('ai.run', 'STEP_LIMIT', 'No verified final answer within the step limit', { steps, provider, model }); emit({ event: 'final', ok: false, error: report.error.message, steps: steps.length }); return report;
}
