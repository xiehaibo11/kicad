// Model-specific effort support. Unknown compatible endpoints retain their defaults.
// Sources: OpenAI reasoning guide; Claude effort; DeepSeek thinking_mode.
export interface ReasoningOption { value: string; label: string; description: string }
const labels: Record<string, [string, string]> = {
  default_on: ['自动', '使用模型默认推理强度'],
  off: ['关闭思考', '关闭当前模型的扩展思考'],
  low: ['轻度', '更快，适合简单任务'],
  medium: ['中等', '平衡速度与推理深度'],
  high: ['高', '适合复杂分析与设计任务'],
  xhigh: ['超高', '更深入的复杂任务推理'],
  max: ['最高', '使用模型支持的最高推理强度'],
};
export function reasoningOptions(model?: string | null): ReasoningOption[] {
  const id = (model || 'default').toLowerCase();
  let levels = ['default_on', 'off'];
  if (/^deepseek-(flash|v4-(pro|flash))/.test(id)) levels.push('low', 'high', 'max');
  else if (/^(opus|sonnet)$/.test(id) || /claude-(opus|sonnet)-4[.-]6/.test(id)) {
    // The pinned CLI advertises max for Opus 4.6, low/medium/high for Sonnet.
    levels.push('low', 'medium', 'high');
    if(id==='opus' || /claude-opus-4[.-]6/.test(id)) levels.push('max');
  }
  return levels.map(value => ({value, label: labels[value][0], description: labels[value][1]}));
}
export function normalizeReasoning(model: string | null | undefined, level?: string | null): string {
  return reasoningOptions(model).some(option => option.value === level) ? level! : 'default_on';
}
export function reasoningEnvironment(model: string | null | undefined, level: string) {
  const selected = normalizeReasoning(model, level);
  if (selected !== level) throw new Error('当前模型不支持该推理强度，请重新选择。');
  return {CLAUDE_CODE_EFFORT_LEVEL: selected === 'off' || selected === 'default_on' ? 'unset' : selected};
}
export function applyReasoningEnvironment(model: string | null | undefined, level: string, env: Record<string,string>) {
  Object.assign(env,reasoningEnvironment(model,level));
  if (!/^deepseek-(flash|v4-(pro|flash))/.test((model || '').toLowerCase())) return;
  // CLI 2.1.83 otherwise clamps custom models' max to high. Use its documented
  // extra-body transport to send the provider's actual output_config.effort.
  const body=env.CLAUDE_CODE_EXTRA_BODY ? JSON.parse(env.CLAUDE_CODE_EXTRA_BODY) : {};
  if(!body || typeof body!=='object' || Array.isArray(body)) throw new Error('CLAUDE_CODE_EXTRA_BODY 必须是 JSON 对象。');
  if(level==='off')body.thinking={type:'disabled'};
  else if(level!=='default_on') {
    body.thinking={type:'enabled',budget_tokens:1024};
    body.output_config={...body.output_config,effort:level};
  }
  env.CLAUDE_CODE_EXTRA_BODY=JSON.stringify(body);
}
