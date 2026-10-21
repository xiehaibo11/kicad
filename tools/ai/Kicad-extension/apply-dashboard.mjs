import fs from 'node:fs';
import path from 'node:path';
export function applyDashboard(root,overlay){
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  const write=(file,s)=>fs.writeFileSync(path.join(root,file),s);
  function patch(file,before,after){const s=read(file);if(s.split(before).length!==2)throw Error('Dashboard anchor missing/ambiguous: '+file+' '+before.slice(0,100));write(file,s.replace(before,()=>after));}
  for(const file of ['agentActivity.ts'])fs.copyFileSync(path.join(overlay,file),path.join(root,'src/shared',file));
  fs.copyFileSync(path.join(overlay,'AgentDashboard.vue'),path.join(root,'src/webview/src/components/AgentDashboard.vue'));
  const model='src/webview/src/components/ModelSelect.vue';
  patch(model,'    align="left"',`    ref="dropdown"
    align="left" :width="280" :popover-style="{maxWidth:'calc(100vw - 24px)'}"
    :disabled="disabled" :show-search="true" search-placeholder="搜索模型…"
    :trigger-props="{'aria-label':'选择模型',role:'button',tabindex:disabled?-1:0,'aria-disabled':disabled,onKeydown:openWithKeyboard}"
    :selected-index="activeIndex"
    @open="loadSdkModels" @search="query=$event;activeIndex=-1" @close="query='';activeIndex=-1"`);
  patch(model,'v-for="(model, idx) in availableModels"','v-for="(model, idx) in filteredModels"');
  patch(model,':is-selected="selectedModel === model.id"',':is-selected="activeIndex >= 0 ? idx === activeIndex : selectedModel === model.id"');
  patch(model,'    <template #content="{ close }">','    <template #content="{ close }">\n      <div class="model-menu-heading">选择模型 <span v-if="probing">· 正在更新列表</span></div>\n      <div v-if="!filteredModels.length" class="model-menu-heading">没有匹配的模型</div>');
  patch(model,'  selectedModel?: string','  selectedModel?: string\n  disabled?: boolean');
  patch(model,"  selectedModel: 'default'","  selectedModel: 'default', disabled:false");
  const s=read(model),start=s.indexOf('onMounted(async () => {'),end=s.indexOf('// ── Listen for config changes');
  patch(model,s.slice(start,end),`const query=ref(''),probing=ref(false),dropdown=ref<any>(),activeIndex=ref(-1);
let disposed=false,probed=false;
function openWithKeyboard(event:KeyboardEvent){if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();dropdown.value?.toggle();}}
function menuKey(event:KeyboardEvent){
  if(!dropdown.value?.isOpen || props.disabled)return;
  if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();const n=filteredModels.value.length;if(n)activeIndex.value=(activeIndex.value+(event.key==='ArrowDown'?1:-1)+n)%n;}
  else if(event.key==='Enter'){const item=filteredModels.value[activeIndex.value<0?0:activeIndex.value];if(item){event.preventDefault();dropdown.value.close();emit('modelSelect',item.id);}}
}
function applyConfig(config:any){customModels.value=config?.customModels??[];disabledModels.value=config?.disabledModels??[];}
onMounted(()=>{document.addEventListener('keydown',menuKey);void transport.getExtensionConfig().then(res=>{if(!disposed)applyConfig(res?.config);}).catch(console.error);});
// A slow SDK process never blocks opening or choosing from the local list.
async function loadSdkModels(){
  if(probed||probing.value)return;
  probing.value=true;
  try{const res=await transport.sdkProbe(['supportedModels'],10000);
    if(!disposed&&res?.data?.supportedModels){sdkModels.value=res.data.supportedModels.filter((m:SdkModel)=>m.description!=='Custom model');probed=true;}
  }catch(error){console.debug('Model discovery unavailable; local models remain usable',error);}
  finally{if(!disposed)probing.value=false;}
}

`);
  patch(model,'  unsubConfigChanged()','  disposed=true;\n  document.removeEventListener(\'keydown\',menuKey);\n  unsubConfigChanged()');
  patch(model,'// ── Label for trigger display ──',`const filteredModels=computed(()=>availableModels.value.filter(m=>(m.label+' '+m.id).toLocaleLowerCase().includes(query.value.toLocaleLowerCase())));
// ── Label for trigger display ──`);
  patch(model,"  close()\n  emit('modelSelect', item.id)","  close()\n  if(!props.disabled)emit('modelSelect', item.id)");
  patch(model,'<style scoped>','<style scoped>\n.model-menu-heading{padding:7px 9px;font-size:11px;color:var(--vscode-descriptionForeground);}\n[aria-disabled="true"]{opacity:.55;cursor:wait;}');

  // Retain the SDK channel and conversation. Stage cheap configuration changes;
  // only restart when the user explicitly sends the next message.
  const agent='src/services/claude/ClaudeAgentService.ts';
  patch(agent,'    query: Query;', '    needsRestart?: boolean;\n    query: Query;');
  patch(agent,'    private transportMessage(', '    private preparingChannels = new Map<string,{cancelled:boolean}>();\n\n    private async transportMessage(');
  patch(agent,'        done: boolean\n    ): void {\n        const channel = this.channels.get(channelId);', '        done: boolean\n    ): Promise<void> {\n        let channel = this.channels.get(channelId);');
  patch(agent,'        // 用户消息加入输入流',`        if(message.type === 'user' && channel.needsRestart){
            if(channel.busy || this.preparingChannels.has(channelId))throw new Error('当前会话正在处理消息。');
            const previous=channel;
            this.closeChannel(channelId,false);
            const preparation={cancelled:false};
            this.preparingChannels.set(channelId,preparation);
            try{
                await this.launchClaude(channelId,previous.sessionId,previous.cwd,previous.model,previous.permissionMode,previous.thinkingLevel);
                if(preparation.cancelled){this.closeChannel(channelId,true);return;}
                channel=this.channels.get(channelId);
                if(!channel)throw new Error('会话启动失败，请重试。');
            }finally{this.preparingChannels.delete(channelId);}
        }
        // 用户消息加入输入流`);
  patch(agent,'                        this.transportMessage(\n', '                        void this.transportMessage(\n');
  patch(agent,'                            message.done\n                        );','                            message.done\n                        ).catch(error => this.closeChannel(message.channelId,true,String(error)));');
  patch(agent,'    async interruptClaude(channelId: string): Promise<void> {',`    async interruptClaude(channelId: string): Promise<void> {
        const preparing=this.preparingChannels.get(channelId);
        if(preparing){preparing.cancelled=true;return;}`);
  patch(agent,'    closeChannel(channelId: string, sendNotification: boolean, error?: string): void {',`    closeChannel(channelId: string, sendNotification: boolean, error?: string): void {
        const preparing=this.preparingChannels.get(channelId);
        if(preparing)preparing.cancelled=true;`);
  patch(agent,`        this.closeChannel(channelId, false);
        await this.launchClaude(channelId, channel.sessionId, channel.cwd, model, channel.permissionMode, channel.thinkingLevel);`,`        if(channel.model===model)return;
        channel.model=model;
        channel.thinkingLevel=normalizeReasoning(model,channel.thinkingLevel);
        channel.needsRestart=true;`);
  const a=read(agent),begin=a.indexOf('        // Effort is a process option.'),finish=a.indexOf('\n    }',begin);
  patch(agent,a.slice(begin,finish),`        channel.thinkingLevel=level;
        channel.needsRestart=true;`);
  patch(agent,"if (message.type === 'result') active.busy = false;","if (message.type === 'result' && !(message as any).parent_tool_use_id) active.busy = false;");
  patch(agent,"if ('session_id' in message && typeof message.session_id === 'string') active.sessionId = message.session_id;","if ('session_id' in message && typeof message.session_id === 'string' && !(message as any).parent_tool_use_id) active.sessionId = message.session_id;");
  const sdk='src/services/claude/ClaudeSdkService.ts';
  patch(sdk,'        // 构建 SDK Options\n        const options: Options = {','        // SDK iterator.return() alone does not terminate its child process.\n        const channelAbort=new AbortController();\n        // 构建 SDK Options\n        const options: Options = {\n            abortController:channelAbort,');
  patch(sdk,'            const result = query({ prompt: inputStream, options });\n            return result;',`            const result = query({ prompt: inputStream, options });
            const finish=result.return.bind(result);
            result.return=async value=>{channelAbort.abort();return finish(value);};
            return result;`);
  patch(agent,'                channel.query.return?.();',`                void Promise.resolve(channel.query.return?.()).catch(error=>this.logService.warn('SDK cleanup: '+String(error)));`);

  const session='src/webview/src/core/Session.ts';
  patch(session,"import { signal, computed, effect } from 'alien-signals';","import { signal, computed, effect } from 'alien-signals';\nimport {AgentActivityIndex,type AgentActivity} from '../../../shared/agentActivity';");
  patch(session,'  private reasoningChanging = false;','  private reasoningChanging = false;\n  private activityIndex=new AgentActivityIndex();\n  readonly agentTasks=signal<AgentActivity[]>([]);');
  patch(session,'    await this.getConnection();\n    await this.launchClaude();',`    const connection=await this.getConnection();
    if(!this.modelSelection())this.modelSelection(connection.config()?.modelSetting || 'default');`);
  patch(session,'        this.processMessage(raw);','        const tasks=this.activityIndex.consume(raw,true);\n        if(tasks)this.agentTasks(tasks);\n        this.processMessage(raw,true);');
  patch(session,'      this.messages(accumulator);\n      await this.launchClaude();','      this.messages(accumulator);\n      this.agentTasks(this.activityIndex.suspend());');
  patch(session,'  private processMessage(event: any): void {',`  private processMessage(event: any, history=false): void {
    if(!history){const tasks=this.activityIndex.consume(event);if(tasks)this.agentTasks(tasks);}
    if(event.parent_tool_use_id)return;`);
  patch(session,'      this.sessionId(event.session_id);',"      if(!event.parent_tool_use_id && typeof event.session_id==='string')this.sessionId(event.session_id);");
  patch(session,"    } else if (event?.type === 'result') {","    } else if (event?.type === 'result' && !event.parent_tool_use_id) {");
  patch(session,'    } finally {\n      this.claudeChannelId(undefined);','    } finally {\n      this.agentTasks(this.activityIndex.suspend());\n      this.busy(false);\n      this.claudeChannelId(undefined);');
  // Prevent concurrent model/effort RPCs and give immediate visible feedback.
  patch(session,'  private reasoningChanging = false;','  private reasoningChanging = false;\n  readonly configurationChanging=signal(false);');
  let src=read(session);src=src.replaceAll('this.reasoningChanging=true;','this.reasoningChanging=true;this.configurationChanging(true);').replaceAll('finally {this.reasoningChanging=false;}','finally {this.reasoningChanging=false;this.configurationChanging(false);}');write(session,src);
  const use='src/webview/src/composables/useSession.ts';
  patch(use,"import { computed } from 'vue';","import { computed } from 'vue';\nimport type {AgentActivity} from '../../../shared/agentActivity';");
  patch(use,'  thinkingLevel: Ref<string>;','  thinkingLevel: Ref<string>;\n  agentTasks: Ref<AgentActivity[]>;\n  configurationChanging: Ref<boolean>;');
  patch(use,'  const thinkingLevel = useSignal(session.thinkingLevel);','  const thinkingLevel = useSignal(session.thinkingLevel);\n  const agentTasks=useSignal(session.agentTasks);\n  const configurationChanging=useSignal(session.configurationChanging);');
  patch(use,'    thinkingLevel,','    thinkingLevel,\n    agentTasks,\n    configurationChanging,');
  const page='src/webview/src/pages/ChatPage.vue';
  patch(page,"import ChatInputBox from '../components/ChatInputBox.vue';","import ChatInputBox from '../components/ChatInputBox.vue';\n  import AgentDashboard from '../components/AgentDashboard.vue';");
  patch(page,'<ChatInputBox',`<div v-if="session?.agentTasks.value.some(task => task.kind === 'agent')" class="conversation-agent-activity">
            <AgentDashboard :key="session?.sessionId.value" :tasks="session?.agentTasks.value" :title="title" :model="session?.modelSelection.value" :busy="isBusy" />
          </div>
          <ChatInputBox
            :configuration-changing="session?.configurationChanging.value"`);
  patch(page,'  .inputContainer {','  .conversation-agent-activity { display:flex;align-items:center;min-width:0;margin:0 0 8px; }\n  .inputContainer {');
  patch(page,'    await s.setModel({ value: modelId });',`    reasoningError.value='';
    try{if(!await s.setModel({value:modelId}))reasoningError.value='模型切换失败，请重试。';}
    catch(error){reasoningError.value=error instanceof Error?error.message:String(error);}`);
  const input='src/webview/src/components/ChatInputBox.vue',buttons='src/webview/src/components/ButtonArea.vue';
  for(const file of [input,buttons]){
    patch(file,'  selectedModel?: string','  configurationChanging?: boolean\n  selectedModel?: string');
  }
  patch(input,'    <ButtonArea','    <ButtonArea\n      :configuration-changing="configurationChanging"');
  patch(buttons,'        <!-- Model Select -->','        <!-- Model Select -->');
  patch(buttons,'          :selected-model="selectedModel"','          :selected-model="selectedModel" :disabled="conversationWorking || loading || configurationChanging"');
  patch(buttons,':disabled="conversationWorking || loading"',':disabled="conversationWorking || loading || configurationChanging"');
  patch(buttons,'      <!-- Right Section: Token Indicator + Action Buttons -->',`      <span v-if="configurationChanging" role="status" class="model-switching">切换中…</span>
      <!-- Right Section: Token Indicator + Action Buttons -->`);
  patch(buttons,'<style scoped>',`<style scoped>
.model-switching{grid-column:1/-1;grid-row:3;font-size:11px;color:var(--vscode-descriptionForeground);}
.controls-section :deep(.dropdown-trigger-container){min-width:0;max-width:100%;}
.button-area-container{container-type:inline-size;}
.button-row{column-gap:6px;}
@container(max-width:360px){.controls-section{grid-column:1/-1;grid-row:1;}.actions-section{grid-column:1/-1;grid-row:2;}}
`);
  patch(buttons,'  grid-template-columns: 4fr 1fr;','  grid-template-columns: minmax(0,1fr) auto;\n  row-gap:5px;');
  patch(buttons,'  height: 28px;','  min-height:28px;\n  height:auto;');
  patch('src/webview/src/utils/KeybindingManager.ts','    const stroke = normalizeKeystroke(e)',`    if(e.target instanceof Element && e.target.closest('[aria-modal="true"]'))return;
    const stroke = normalizeKeystroke(e)`);
}
