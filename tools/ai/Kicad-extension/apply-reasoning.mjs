import fs from 'node:fs';
import path from 'node:path';
export function applyReasoning(root, overlay) {
  function patch(file,before,after){const target=path.join(root,file),s=fs.readFileSync(target,'utf8');if(s.split(before).length!==2)throw Error('Reasoning anchor missing/ambiguous: '+file+' '+before.slice(0,90));fs.writeFileSync(target,s.replace(before,()=>after))}
  const shared='src/shared/kicadReasoning.ts';
  fs.copyFileSync(path.join(overlay,'kicadReasoning.ts'),path.join(root,shared));
  fs.copyFileSync(path.join(overlay,'ReasoningSelect.vue'),path.join(root,'src/webview/src/components/ReasoningSelect.vue'));
  const buttons='src/webview/src/components/ButtonArea.vue';
  const source=fs.readFileSync(path.join(root,buttons),'utf8');
  const thinking=source.slice(source.indexOf('        <!-- Thinking Toggle Button -->'),source.indexOf('        <!-- Sparkle Button -->'));
  patch(buttons,thinking,`        <ReasoningSelect :model="selectedModel" :level="thinkingLevel" :disabled="conversationWorking || loading"
          @select="level => emit('thinkingSelect',level)" />\n\n`);
  patch(buttons,"const isThinkingOn = computed(() => props.thinkingLevel !== 'off')",'');
  patch(buttons,"function handleThinkingToggle() {\n  emit('thinkingToggle')\n}\n",'');
  patch(buttons,"import ModelSelect from './ModelSelect.vue'","import ModelSelect from './ModelSelect.vue'\nimport ReasoningSelect from './ReasoningSelect.vue'");
  for(const file of [buttons,'src/webview/src/components/ChatInputBox.vue'])patch(file,"  (e: 'thinkingToggle'): void","  (e: 'thinkingSelect',level:string): void");
  patch('src/webview/src/components/ChatInputBox.vue',`      @thinking-toggle="() => emit('thinkingToggle')"`,`      @thinking-select="level => emit('thinkingSelect',level)"`);
  const page='src/webview/src/pages/ChatPage.vue';
  patch(page,'@thinking-toggle="handleToggleThinking"','@thinking-select="handleSelectThinking"');
  patch(page,`  async function handleToggleThinking() {\n    const s = session.value;\n    if (!s) return;\n\n    const currentLevel = s.thinkingLevel.value;\n    const newLevel = currentLevel === 'off' ? 'default_on' : 'off';\n\n    await s.setThinkingLevel(newLevel);\n  }`,`  const reasoningError=ref('');\n  async function handleSelectThinking(level:string) {\n    const s=session.value;if(!s)return;\n    reasoningError.value='';\n    try { await s.setThinkingLevel(level); } catch(error) {\n      reasoningError.value=error instanceof Error ? error.message : String(error);\n    }\n  }`);
  patch(page,'        <div class="inputContainer">',`        <div class="inputContainer">
          <div v-if="reasoningError" class="reasoning-error" role="alert">{{ reasoningError }}</div>`);
  patch(page,'  .inputContainer {',`  .reasoning-error { color:var(--vscode-errorForeground);font-size:12px;padding:4px 8px; }
  .inputContainer {`);
  const session='src/webview/src/core/Session.ts';
  patch(session,"import { signal, computed, effect } from 'alien-signals';","import { signal, computed, effect } from 'alien-signals';\nimport {normalizeReasoning} from '../../../shared/kicadReasoning';");
  patch(session,"  readonly thinkingLevel = signal<string>('default_on');","  readonly thinkingLevel = signal<string>('default_on');\n  private reasoningByModel = new Map<string,string>();\n  private reasoningChanging = false;");
  const sessionSource=fs.readFileSync(path.join(root,session),'utf8');
  const setters=sessionSource.slice(sessionSource.indexOf('  async setModel(model: ModelOption)'),sessionSource.indexOf('  async getMcpServers()'));
  patch(session,setters,`  async setModel(model: ModelOption): Promise<boolean> {
    if(this.reasoningChanging) throw new Error('正在切换模型或推理强度，请稍候。');
    const previousThinking=this.thinkingLevel();
    const nextThinking=normalizeReasoning(model.value,this.reasoningByModel.get(model.value) ?? previousThinking);
    this.reasoningChanging=true;
    try {
      const channelId=this.claudeChannelId();
      if(channelId) {
        const connection=await this.getConnection();
        const response=await connection.setModel(channelId,model);
        if(!response?.success)return false;
      }
      this.modelSelection(model.value);
      // The host normalizes the previous effort when it resumes the new model.
      this.thinkingLevel(normalizeReasoning(model.value,previousThinking));
    } finally {this.reasoningChanging=false;}
    if(nextThinking!==this.thinkingLevel()) await this.setThinkingLevel(nextThinking);
    return true;
  }

  async setThinkingLevel(level: string): Promise<void> {
    if(this.reasoningChanging) throw new Error('正在切换模型或推理强度，请稍候。');
    if(normalizeReasoning(this.modelSelection(),level)!==level) throw new Error('当前模型不支持该推理强度。');
    this.reasoningChanging=true;
    try {
      const channelId=this.claudeChannelId();
      if(channelId){const connection=await this.getConnection();await connection.setThinkingLevel(channelId,level);}
      this.thinkingLevel(level);
      this.reasoningByModel.set(this.modelSelection() || 'default',level);
    } finally {this.reasoningChanging=false;}
  }

`);
  const agent='src/services/claude/ClaudeAgentService.ts';
  patch(agent,"import { createDecorator } from '../../di/instantiation';","import { createDecorator } from '../../di/instantiation';\nimport {normalizeReasoning,reasoningEnvironment} from '../../shared/kicadReasoning';");
  patch(agent,'        // 计算 maxThinkingTokens','        const selectedThinkingLevel = normalizeReasoning(model, thinkingLevel || this.thinkingLevel);\n        this.thinkingLevel = selectedThinkingLevel;\n        // 计算 maxThinkingTokens');
  patch(agent,'thinkingLevel: this.thinkingLevel, busy: false','thinkingLevel: selectedThinkingLevel, busy: false');
  patch(agent,'            onStderrError\n','            onStderrError,\n            reasoningLevel: this.thinkingLevel\n');
  const s=fs.readFileSync(path.join(root,agent),'utf8');
  const method=s.slice(s.indexOf('    async setThinkingLevel(channelId: string, level: string): Promise<void> {',s.indexOf('private getMaxThinkingTokens')),s.indexOf('    /**\n     * 设置权限模式',s.indexOf('private getMaxThinkingTokens')));
  patch(agent,method,`    async setThinkingLevel(channelId: string, level: string): Promise<void> {\n        const channel=this.channels.get(channelId);\n        if(!channel) throw new Error('会话尚未启动，请重试。');\n        if(channel.busy) throw new Error('请等待当前回复完成或先停止，再切换推理强度。');\n        reasoningEnvironment(channel.model,level);\n        if(channel.thinkingLevel===level)return;\n        // Effort is a process option. Resume the same conversation with fresh options.\n        this.closeChannel(channelId,false);\n        try {\n            await this.launchClaude(channelId,channel.sessionId,channel.cwd,channel.model,channel.permissionMode,level);\n        } catch(error) {\n            this.closeChannel(channelId,false);\n            await this.launchClaude(channelId,channel.sessionId,channel.cwd,channel.model,channel.permissionMode,channel.thinkingLevel);\n            throw error;\n        }\n    }\n\n`);
  // Model changes also need fresh effort/model capabilities, even on the same provider.
  patch(agent,`        const usesProviderEnvironment = (value: string | null) => !!value && value.toLowerCase().startsWith('deepseek');\n        if (usesProviderEnvironment(channel.model) || usesProviderEnvironment(model)) {\n            this.closeChannel(channelId, false);\n            await this.launchClaude(channelId, channel.sessionId, channel.cwd, model, channel.permissionMode, channel.thinkingLevel);\n        } else {\n            await channel.query.setModel(model);\n            channel.model = model;\n        }`,`        this.closeChannel(channelId, false);\n        await this.launchClaude(channelId, channel.sessionId, channel.cwd, model, channel.permissionMode, channel.thinkingLevel);`);
  const sdk='src/services/claude/ClaudeSdkService.ts';
  patch(sdk,"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {applyReasoningEnvironment} from '../../shared/kicadReasoning';");
  patch(sdk,'    maxThinkingTokens?: number;','    reasoningLevel?: string;\n    maxThinkingTokens?: number;');
  patch(sdk,'        // 记录环境变量',`        applyReasoningEnvironment(model,params.reasoningLevel || 'default_on',env);\n        // 记录环境变量`);
}
