import fs from 'node:fs';
import path from 'node:path';

// While a turn is running, the permission mode and auxiliary actions are locked;
// the stop button stays available. Model and reasoning stay selectable: a choice
// made during a turn is saved and shown at once, and staged on the channel right
// before the next request, so the running turn keeps its process. Session setters
// enforce the same rules for keyboard shortcuts and any non-UI caller.
export function applyRuntimeLock(root) {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  function patch(file, before, after) {
    const source = read(file);
    if (source.split(before).length !== 2)
      throw Error('Runtime-lock anchor missing/ambiguous: ' + file + ' ' + before.slice(0, 80));
    fs.writeFileSync(path.join(root, file), source.replace(before, () => after));
  }

  const mode = 'src/webview/src/components/ModeSelect.vue';
  patch(mode, 'interface Props {\n  permissionMode?: PermissionMode\n}', 'interface Props {\n  permissionMode?: PermissionMode\n  disabled?: boolean\n}');
  patch(mode, "const props = withDefaults(defineProps<Props>(), {\n  permissionMode: 'acceptEdits'\n})", "const props = withDefaults(defineProps<Props>(), {\n  permissionMode: 'acceptEdits',\n  disabled: false\n})");
  patch(mode, '  <DropdownTrigger\n    align="left"', '  <DropdownTrigger\n    :disabled="disabled"\n    align="left"');
  patch(mode, "function handleModeSelect(item: DropdownItemData, close: () => void) {\n  console.log('Selected mode:', item)\n  close()", "function handleModeSelect(item: DropdownItemData, close: () => void) {\n  if (props.disabled) return\n  console.log('Selected mode:', item)\n  close()");
  patch(mode, '      <div class="mode-dropdown">', '      <div class="mode-dropdown" :class="{ \'is-disabled\': disabled }">');
  patch(mode, '.mode-dropdown:hover {\n  opacity: 1;\n}', '.mode-dropdown:hover {\n  opacity: 1;\n}\n\n.mode-dropdown.is-disabled {\n  opacity: .5;\n  cursor: not-allowed;\n  pointer-events: none;\n}');

  // ModelSelect already gains a disabled prop/trigger from apply-dashboard;
  // this patch only supplies the disabled state from ButtonArea.

  const buttons = 'src/webview/src/components/ButtonArea.vue';
  patch(buttons, '        <ModeSelect\n          :permission-mode="permissionMode"', '        <ModeSelect\n          :disabled="conversationWorking || loading"\n          :permission-mode="permissionMode"');
  // ModelSelect is already disabled by apply-model-selection with a broader expression.
  // Sparkle already has its own disabled expression from apply-dashboard.
  patch(buttons, '          <button\n            class="action-button"\n            @click="handleAttachClick"\n          >', '          <button\n            class="action-button"\n            :disabled="conversationWorking || loading"\n            @click="handleAttachClick"\n          >');
  patch(buttons, 'function handleSparkleClick() {\n  emit(\'sparkle\')\n}', 'function handleSparkleClick() {\n  if (props.conversationWorking || props.loading) return\n  emit(\'sparkle\')\n}');
  patch(buttons, 'function handleAttachClick() {\n  fileInputRef.value?.click()\n}', 'function handleAttachClick() {\n  if (props.conversationWorking || props.loading) return\n  fileInputRef.value?.click()\n}');
  patch(buttons, 'function handleFileUpload(event: Event) {\n  const target = event.target as HTMLInputElement', 'function handleFileUpload(event: Event) {\n  if (props.conversationWorking || props.loading) return\n  const target = event.target as HTMLInputElement');

  const page = 'src/webview/src/pages/ChatPage.vue';
  patch(page, '  async function handleModeSelect(mode: PermissionMode) {\n    const s = session.value;', '  async function handleModeSelect(mode: PermissionMode) {\n    if (isBusy.value) return;\n    const s = session.value;');
  patch(page, '  const togglePermissionMode = () => {\n    const s = session.value;', '  const togglePermissionMode = () => {\n    if (isBusy.value) return;\n    const s = session.value;');

  const session = 'src/webview/src/core/Session.ts';
  patch(session, '  async setPermissionMode(mode: PermissionMode, applyToConnection = true): Promise<boolean> {\n    const previous = this.permissionMode();', '  async setPermissionMode(mode: PermissionMode, applyToConnection = true): Promise<boolean> {\n    if(this.busy())throw new Error(\'当前请求仍在运行，请先暂停。\');\n    const previous = this.permissionMode();');
  patch(buttons, ':selected-model="selectedModel" :disabled="conversationWorking || loading || configurationChanging"', ':selected-model="selectedModel" :disabled="loading || configurationChanging"');
  patch(buttons, '<ReasoningSelect :model="selectedModel" :level="thinkingLevel" :disabled="conversationWorking || loading || configurationChanging"', '<ReasoningSelect :model="selectedModel" :level="thinkingLevel" :disabled="loading || configurationChanging"');
  patch(session, "    if(remember && this.busy())throw new Error('请等待当前回复完成或先暂停，再切换模型。');", '    if(remember && this.busy())return this.queueModel(model);');
  patch(session, '  async setThinkingLevel(level: string): Promise<void> {\n    if(this.reasoningChanging)', `  async setThinkingLevel(level: string): Promise<void> {
    if(this.busy()){
      if(normalizeReasoning(this.modelSelection(),level)!==level)throw new Error('The selected model does not support this reasoning level.');
      this.thinkingLevel(level);this.reasoningByModel.set(this.modelSelection() || 'default',level);this.pendingSettings=true;
      return;
    }
    if(this.reasoningChanging)`);
  patch(session, '  async setModel(model: ModelOption, remember=true): Promise<boolean> {', `  private pendingSettings=false;
  private async queueModel(model:ModelOption):Promise<boolean> {
    if(this.reasoningChanging)throw new Error('正在切换模型或推理强度，请稍候。');
    if(!model.value?.trim())throw new Error('请选择有效的模型。');
    this.reasoningChanging=true;this.configurationChanging(true);
    try {
      const connection=await this.getConnection();
      const saved=await connection.updateExtensionConfig('selectedModel',model.value);
      if(!saved?.success)throw new Error('未能保存模型选择，请重试。');
      const config=connection.config();
      if(config)connection.config({...config,modelSetting:model.value});
      const thinking=normalizeReasoning(model.value,this.reasoningByModel.get(model.value) ?? this.thinkingLevel());
      this.modelSelection(model.value);this.thinkingLevel(thinking);this.pendingSettings=true;
      return true;
    } finally {this.reasoningChanging=false;this.configurationChanging(false);}
  }

  async setModel(model: ModelOption, remember=true): Promise<boolean> {`);
  // Stage queued choices on a live channel before its next request; a new channel
  // launches with them directly.
  patch(session, "    if(preferred && preferred!==this.modelSelection())await this.setModel({value:preferred},false);\n    if(expectedEpoch!==undefined && expectedEpoch!==this.sendEpoch)throw new Error('请求已暂停。');\n", `    if(preferred && preferred!==this.modelSelection())await this.setModel({value:preferred},false);
    if(expectedEpoch!==undefined && expectedEpoch!==this.sendEpoch)throw new Error('请求已暂停。');
    const live=this.claudeChannelId();
    if(this.pendingSettings && live){
      const staged=await ready.setModel(live,{value:this.modelSelection()!});
      if(!staged?.success)throw new Error('未能应用所选模型，请重试。');
      await ready.setThinkingLevel(live,this.thinkingLevel());
    }
    this.pendingSettings=false;
`);
}
