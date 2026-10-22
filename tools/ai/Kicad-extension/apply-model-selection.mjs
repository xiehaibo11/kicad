import fs from 'node:fs';
import path from 'node:path';

export function applyModelSelection(root) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  function patch(file, before, after) {
    const source = read(file);
    if (source.split(before).length !== 2) throw Error('Model selection anchor missing/ambiguous: ' + file + ' ' + before.slice(0, 90));
    fs.writeFileSync(path.join(root, file), source.replace(before, () => after));
  }
  // This preference belongs to Kicad, independently of CLI profiles or SDK discovery.
  const config = 'src/services/configurationService.ts';
  patch(config, 'export interface ExtensionConfig {', 'export interface ExtensionConfig {\n  selectedModel?: string;');
  patch('src/services/claude/handlers/handlers.ts',
    "    const modelSetting = (await configService.getSetting<string>('model')) || 'default';",
    "    const { selectedModel } = await configService.getExtensionConfig();\n    const modelSetting = selectedModel || (await configService.getSetting<string>('model')) || 'default';");

  const transport = 'src/webview/src/transport/BaseTransport.ts';
  patch(transport, '          modelSetting: req.state.modelSetting,', '          modelSetting: this.config()?.modelSetting ?? req.state.modelSetting,');
  patch(transport, '        this.extensionConfigChanged.emit({ key: req.key, value: req.value });',
    `        if(req.key==='selectedModel' && typeof req.value==='string' && req.value.trim()) {
          const config=this.config();
          if(config)this.config({...config,modelSetting:req.value});
        }
        this.extensionConfigChanged.emit({ key: req.key, value: req.value });`);

  const session = 'src/webview/src/core/Session.ts';
  patch(session, `    const connection=await this.getConnection();
    if(!this.modelSelection())this.modelSelection(connection.config()?.modelSetting || 'default');`,
    `    const connection=await this.getConnection();
    await connection.opened;
    const preferred=connection.config()?.modelSetting;
    if(preferred && !this.busy() && !this.configurationChanging() && preferred!==this.modelSelection())
      await this.setModel({value:preferred},false);`);
  patch(session, '      const channelId=await this.launchClaude();', '      const channelId=await this.launchClaude(epoch);');
  patch(session, '      const response = await connection.getSession(sessionId);', '      await this.preloadConnection();\n      const response = await connection.getSession(sessionId);');
  patch(session, '  async launchClaude(): Promise<string> {', `  async launchClaude(expectedEpoch?:number): Promise<string> {
    const ready=await this.getConnection();
    await ready.opened;
    if(expectedEpoch!==undefined && expectedEpoch!==this.sendEpoch)throw new Error('请求已暂停。');
    const preferred=ready.config()?.modelSetting;
    if(preferred && preferred!==this.modelSelection())await this.setModel({value:preferred},false);
    if(expectedEpoch!==undefined && expectedEpoch!==this.sendEpoch)throw new Error('请求已暂停。');`);
  patch(session, "    if(this.busy())throw new Error('当前请求仍在运行，请先暂停。');", "    if(this.busy())throw new Error('当前请求仍在运行，请先暂停。');\n    if(this.configurationChanging())throw new Error('正在切换模型或推理强度，请稍候。');");
  const source = read(session), begin = source.indexOf('  async setModel(model: ModelOption)'), end = source.indexOf('  async setThinkingLevel(', begin);
  patch(session, source.slice(begin, end), `  async setModel(model: ModelOption, remember=true): Promise<boolean> {
    if(remember && this.busy())throw new Error('请等待当前回复完成或先暂停，再切换模型。');
    if(this.reasoningChanging)throw new Error('正在切换模型或推理强度，请稍候。');
    if(!model.value?.trim())throw new Error('请选择有效的模型。');
    const previous=this.modelSelection(),previousThinking=this.thinkingLevel();
    const nextThinking=normalizeReasoning(model.value,this.reasoningByModel.get(model.value) ?? previousThinking);
    this.reasoningChanging=true;this.configurationChanging(true);
    try {
      const connection=await this.getConnection();
      await connection.opened;
      const channelId=this.claudeChannelId();
      if(channelId && previous!==model.value) {
        const response=await connection.setModel(channelId,model);
        if(!response?.success)return false;
      }
      if(remember) {
        try {
          const saved=await connection.updateExtensionConfig('selectedModel',model.value);
          if(!saved?.success)throw new Error('未能保存模型选择，请重试。');
        } catch(error) {
          if(channelId && previous && previous!==model.value) {
            try {
              const restored=await connection.setModel(channelId,{value:previous});
              if(!restored?.success)throw new Error('模型回退失败。');
              await connection.setThinkingLevel(channelId,previousThinking);
            } catch {
              this.claudeChannelId(undefined);
              connection.interruptClaude(channelId);
            }
          }
          throw error;
        }
        const config=connection.config();
        if(config)connection.config({...config,modelSetting:model.value});
      }
      this.modelSelection(model.value);
      this.thinkingLevel(normalizeReasoning(model.value,previousThinking));
    } finally {this.reasoningChanging=false;this.configurationChanging(false);}
    if(nextThinking!==this.thinkingLevel())await this.setThinkingLevel(nextThinking);
    return true;
  }

`);

  // A historical message uses the same composer configuration and actions as the
  // main input. Editing and sending continues the conversation without erasing it.
  const tool = 'src/webview/src/types/tool.ts';
  patch(tool, 'export interface ToolContext {', `export interface ToolContext {
  conversation?: {
    model?:string;
    thinkingLevel:string;
    permissionMode:import('@anthropic-ai/claude-agent-sdk').PermissionMode;
    busy:boolean;
    configurationChanging:boolean;
    selectModel:(model:string)=>Promise<void>;
    selectThinking:(level:string)=>Promise<void>;
    selectMode:(mode:import('@anthropic-ai/claude-agent-sdk').PermissionMode)=>Promise<void>;
    send:(content:string,attachments:import('../core/Session').AttachmentPayload[])=>Promise<void>;
  };`);
  const page = 'src/webview/src/pages/ChatPage.vue';
  patch(page, '  const toolContext = computed<ToolContext>(() => ({', `  const toolContext = computed<ToolContext>(() => ({
    conversation:session.value ? {
      model:session.value.modelSelection.value,
      thinkingLevel:session.value.thinkingLevel.value,
      permissionMode:session.value.permissionMode.value,
      busy:session.value.busy.value,
      configurationChanging:session.value.configurationChanging.value,
      selectModel:handleModelSelect,
      selectThinking:handleSelectThinking,
      selectMode:handleModeSelect,
      send:async (content,files)=>{if(session.value)await session.value.send(content,files);}
    }:undefined,`);
  const editor = 'src/webview/src/components/Messages/UserMessage.vue';
  patch(editor, '            :conversation-working="false"', `            :conversation-working="context.conversation?.busy || sending"
            :configuration-changing="context.conversation?.configurationChanging"
            :selected-model="context.conversation?.model"
            :thinking-level="context.conversation?.thinkingLevel"
            :permission-mode="context.conversation?.permissionMode"
            @model-select="context.conversation?.selectModel($event)"
            @thinking-select="context.conversation?.selectThinking($event)"
            @mode-select="context.conversation?.selectMode($event)"
            @add-attachment="handleAddAttachment"`);
  patch(editor, '          />\n        </div>', '          />\n          <div v-if="editError" class="edit-error" role="alert">{{ editError }}</div>\n        </div>');
  patch(editor, "import type { AttachmentItem } from '../../types/attachment';", "import { convertFileToAttachment, type AttachmentItem } from '../../types/attachment';");
  patch(editor, 'const isEditing = ref(false);', "const isEditing = ref(false);\nconst editError=ref(''),sending=ref(false);\nasync function handleAddAttachment(files:FileList){try{attachments.value.push(...await Promise.all(Array.from(files).map(convertFileToAttachment)));}catch(error){editError.value=String(error);}}");
  patch(editor, '  isEditing.value = true;', "  isEditing.value = true;\n  editError.value='';");
  const user = read(editor), start = user.indexOf('function handleSaveEdit('), finish = user.indexOf('\nfunction handleRestore()', start);
  patch(editor, user.slice(start, finish), `async function handleSaveEdit(content?:string) {
  const finalContent=(content ?? displayContent.value).trim();
  const conversation=props.context.conversation;
  if(!conversation || sending.value)return;
  if(conversation.busy || conversation.configurationChanging){editError.value='请等待当前任务或模型切换完成。';return;}
  if(!finalContent && !attachments.value.length)return;
  sending.value=true;editError.value='';
  try {
    await conversation.send(finalContent || ' ',attachments.value);
    cancelEdit();
  } catch(error) {
    editError.value=error instanceof Error?error.message:String(error);
    await nextTick();chatInputRef.value?.setContent?.(finalContent);
  } finally {sending.value=false;}
}
`);
  patch(editor, '<style scoped>', '<style scoped>\n.edit-error{color:var(--vscode-errorForeground);padding:4px 8px;font-size:12px;}');
  patch('src/webview/src/components/ChatInputBox.vue', '  if (isOptimizing.value) return', '  if (isOptimizing.value || props.configurationChanging) return');
}
