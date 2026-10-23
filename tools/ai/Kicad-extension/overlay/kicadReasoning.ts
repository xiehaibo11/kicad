// Model-specific reasoning effort. The UI exposes only levels the selected
// model can actually use.
//
// Sources, in priority order:
// - Discovered capabilities (registerReasoningModels). The local Claude Code
//   CLI reports supportedEffortLevels/supportsThinkingOff per model; Claude
//   5.x models offer low..max and keep adaptive thinking on, so they have no
//   "None" tier, and the CLI silently falls back to medium for unknown names.
//   Codex app-server model/list reports supportedReasoningEfforts; turn/start
//   only accepts advertised values. Reasoning never grants permission to delegate;
//   Ultracode is a separate Claude workflow feature, not a reasoning tier.
// - Static fallback before discovery has run in this process:
//   - Anthropic 4.6: low/medium/high, plus max on Opus; Claude 5.x: low..max.
//   - OpenAI GPT-5/Codex: minimal..high, 5.1+ replaces minimal with none,
//     codex-max adds xhigh; GPT-5.6/6.x: low..max (ultra is per model).
//   - DeepSeek Anthropic-compatible API: effective tiers low/high/max; medium
//     maps to high, so the UI does not offer a redundant medium tier.
export interface ReasoningOption { value: string; label: string; description: string }
/** Vendor capabilities carried on discovered model entries. */
export interface ReasoningCapability {
  value: string;
  aliases?: string[];
  reasoningEfforts?: string[];
  thinkingOff?: boolean;
}
const labels: Record<string, [string, string]> = {
  default_on: ['Auto', "Model's configured default"],
  off: ['None', 'No deep reasoning; fastest'],
  minimal: ['Minimal', 'Barely any reasoning'],
  low: ['Low', 'Light; simple chats and facts'],
  medium: ['Medium', 'Balanced; good for most tasks'],
  high: ['High', 'Complex work, multi-file debugging'],
  xhigh: ['Extra High', 'Hard multi-step problems'],
  max: ['Max', 'Deepest; big plans and refactors'],
  ultra: ['Ultra', 'Provider ultra reasoning; delegation still needs an explicit request'],
};
const ORDER = ['default_on', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
const discovered = new Map<string, string[]>();
const listeners = new Set<() => void>();

const isDeepSeek = (id: string) => /^deepseek-(flash|v4-(pro|flash))/.test(id);
const isClaude5 = (id: string) => /claude-(opus|sonnet|haiku|fable)-[5-9]/.test(id);
const isClaude46 = (id: string) => /^(opus|sonnet)$/.test(id) || /claude-(opus|sonnet)-4[.-]6/.test(id);
const isClaudeOpus46 = (id: string) => id === 'opus' || /claude-opus-4[.-]6/.test(id);
const isCodexLike = (id: string) => id.startsWith('codex:') || id.includes('gpt') || /^(o[1-9]|codex)/.test(id);
const codexId = (id: string) => id.replace(/^codex:/, '');
const isCodexCurrent = (id: string) => /gpt-(5\.[6-9]|[6-9])/.test(codexId(id));
const codexSupportsNone = (id: string) => /gpt-5\.[1-9]|gpt-[6-9]|codex-max/.test(codexId(id));
const codexSupportsXhigh = (id: string) => /codex-max|gpt-[6-9]/.test(codexId(id));
const isOSeries = (id: string) => /^o[1-9]/.test(codexId(id));

/** Record the levels each discovered model advertises (by id and aliases). */
export function registerReasoningModels(models?: ReasoningCapability[] | null) {
  let changed = false;
  for (const model of models ?? []) {
    if (!model?.value || !Array.isArray(model.reasoningEfforts)) continue;
    const efforts = model.reasoningEfforts.map(String);
    const levels = ORDER.filter(level => level === 'default_on' ||
      (level === 'off' ? model.thinkingOff === true || efforts.includes('none') : efforts.includes(level)));
    for (const id of [model.value, ...(model.aliases ?? [])]) {
      discovered.set(id.toLowerCase(), levels);
      changed = true;
    }
  }
  if (changed) for (const listener of listeners) listener();
}

export function onReasoningModelsChanged(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function fallbackLevels(id: string): string[] {
  if (isDeepSeek(id)) return ['default_on', 'off', 'low', 'high', 'max'];
  if (isClaude5(id)) return ['default_on', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (isClaude46(id)) return ['default_on', 'off', 'low', 'medium', 'high', ...(isClaudeOpus46(id) ? ['max'] : [])];
  // GPT-5 Pro exposes only the high reasoning tier.
  if (id.includes('gpt-5-pro')) return ['default_on', 'high'];
  // o-series accepts low/medium/high; there is no off/minimal tier.
  if (isOSeries(id)) return ['default_on', 'low', 'medium', 'high'];
  if (isCodexLike(id) && isCodexCurrent(id)) return ['default_on', 'low', 'medium', 'high', 'xhigh', 'max'];
  if (isCodexLike(id)) return ['default_on', 'off', 'minimal', 'low', 'medium', 'high', ...(codexSupportsXhigh(id) ? ['xhigh'] : [])];
  // Unknown/custom compatible endpoints keep the safe default/off pair.
  return ['default_on', 'off'];
}

export function reasoningOptions(model?: string | null): ReasoningOption[] {
  const id = (model || 'default').toLowerCase();
  const levels = discovered.get(id) ?? fallbackLevels(id);
  const options = levels.map(value => ({ value, label: labels[value][0], description: labels[value][1] }));
  // Make the actual ceiling explicit when a model tops out at high.
  const high = options.find(option => option.value === 'high');
  if (high && levels[levels.length - 1] === 'high') high.description = 'Highest level this model supports';
  return options;
}

/** Map the UI level to the OpenAI/Codex effort value for the selected model. */
export function codexReasoningEffort(model: string | null | undefined, level?: string | null): string | undefined {
  if (!level || level === 'default_on') return undefined;
  const id = (model || '').toLowerCase();
  const known = discovered.get(id);
  if (known) return known.includes(level) ? (level === 'off' ? 'none' : level) : undefined;
  if (isCodexCurrent(id)) return ['low', 'medium', 'high', 'xhigh', 'max'].includes(level) ? level : undefined;
  const none = codexSupportsNone(id);
  if (level === 'off') return none ? 'none' : (isOSeries(id) ? 'low' : 'minimal');
  if (level === 'minimal') return none ? 'none' : (isOSeries(id) ? 'low' : 'minimal');
  if (level === 'xhigh' || level === 'max') return codexSupportsXhigh(id) ? 'xhigh' : 'high';
  if (level === 'low' || level === 'medium' || level === 'high') return level;
  return undefined;
}

export function normalizeReasoning(model: string | null | undefined, level?: string | null): string {
  return reasoningOptions(model).some(option => option.value === level) ? level! : 'default_on';
}

/**
 * Claude Code environment for the level. Auto leaves the CLI's own default in
 * place (settings modelSettings/effortLevel, then the model default); DeepSeek
 * keeps "unset" so a Claude-only preference never reaches that provider.
 */
export function reasoningEnvironment(model: string | null | undefined, level: string): Record<string, string> {
  const selected = normalizeReasoning(model, level);
  if (selected !== level) throw new Error('The selected model does not support this reasoning level. Choose another one.');
  if (selected === 'default_on' && !isDeepSeek((model || '').toLowerCase())) return {};
  return { CLAUDE_CODE_EFFORT_LEVEL: selected === 'off' || selected === 'default_on' ? 'unset' : selected };
}

export function applyReasoningEnvironment(model: string | null | undefined, level: string, env: Record<string,string>) {
  Object.assign(env, reasoningEnvironment(model, level));
  const id = (model || '').toLowerCase();
  if (!isDeepSeek(id)) return;
  // CLI 2.1.83 otherwise clamps custom models' max to high. Use its documented
  // extra-body transport to send the provider's actual output_config.effort.
  const body = env.CLAUDE_CODE_EXTRA_BODY ? JSON.parse(env.CLAUDE_CODE_EXTRA_BODY) : {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('CLAUDE_CODE_EXTRA_BODY must be a JSON object.');
  if (level === 'off') body.thinking = { type: 'disabled' };
  else if (level !== 'default_on') {
    body.thinking = { type: 'enabled', budget_tokens: 1024 };
    body.output_config = { ...body.output_config, effort: level };
  }
  env.CLAUDE_CODE_EXTRA_BODY = JSON.stringify(body);
}
