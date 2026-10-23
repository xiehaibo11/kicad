import fs from 'node:fs';
import path from 'node:path';
export function applyExecution(root,overlay){
  function patch(file,before,after){const target=path.join(root,file),s=fs.readFileSync(target,'utf8');if(s.split(before).length!==2)throw Error('Execution anchor missing/ambiguous: '+file+' '+before.slice(0,90));fs.writeFileSync(target,s.replace(before,()=>after));}
  for(const name of ['executionTimeline.ts','executionSteps.ts'])fs.copyFileSync(path.join(overlay,name),path.join(root,'src/webview/src/utils',name));
  fs.copyFileSync(path.join(overlay,'imageFiles.ts'),path.join(root,'src/shared/imageFiles.ts'));
  fs.copyFileSync(path.join(overlay,'toolContent.ts'),path.join(root,'src/toolContent.ts'));
  patch('src/extension.ts',"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {registerToolContent} from './toolContent';");
  patch('src/extension.ts','export function activate(context: vscode.ExtensionContext) {','export function activate(context: vscode.ExtensionContext) {\n  registerToolContent(context);');
  for(const name of ['ExecutionTimeline.vue','ExecutionTurn.vue','ExecutionSteps.vue','ExecutionIO.vue','MessageCopy.vue'])fs.copyFileSync(path.join(overlay,name),path.join(root,'src/webview/src/components/Messages',name));
  const page='src/webview/src/pages/ChatPage.vue';
  patch('src/webview/src/types/tool.ts','export interface ToolContext {','export interface ToolContext {\n  showToolOutput?: () => void;');
  patch('src/webview/src/types/tool.ts','open: (filePath: string, location?: { startLine?: number; endLine?: number }) => void;','open: (filePath: string, location?: { startLine?: number; endLine?: number }) => void | Promise<unknown>;');
  patch('src/webview/src/types/tool.ts','openContent: (content: string, fileName: string, editable: boolean) => void;','openContent: (content: string, fileName: string, editable: boolean) => void | Promise<unknown>;');
  patch(page,'void runtime.appContext.fileOpener.open(filePath, location);','return runtime.appContext.fileOpener.open(filePath, location);');
  patch(page,'const toolContext = computed<ToolContext>(() => ({','const toolContext = computed<ToolContext>(() => ({\n    showToolOutput: () => runtime.appContext.openURL(\'kicad://tool-output\'),');
  patch('src/services/claude/handlers/handlers.ts','    const { url } = request;',`    const { url } = request;
    if(url==='kicad://tool-output'){await vscode.commands.executeCommand('kicadAgent.showToolOutput');return {type:'open_url_response'};}`);
  const handlers='src/services/claude/handlers/handlers.ts';
  patch(handlers,"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {imageFile} from '../../../shared/imageFiles';\nimport {openToolContent} from '../../../toolContent';");
  patch(handlers,`        const document = await vscode.workspace.openTextDocument({
            content,
            language: detectLanguage(fileName)
        });
        await vscode.window.showTextDocument(document, { preview: true });`,`        await openToolContent(content, fileName);`);
  // An explicit image path must not fall back to a fuzzy match of a different file.
  patch(handlers,'const searchResults = await fileSystemService.findFiles(filePath, cwd);','const searchResults = imageFile(filePath) ? [] : await fileSystemService.findFiles(filePath, cwd);');
  patch(handlers,'        const doc = await vscode.workspace.openTextDocument(uri);',`        if (imageFile(resolvedPath)) {
            await vscode.commands.executeCommand('vscode.openWith', uri, 'imagePreview.previewEditor', {
                viewColumn: vscode.ViewColumn.One, preview: true, preserveFocus: true
            });
            return { type: 'open_file_response' };
        }

        const doc = await vscode.workspace.openTextDocument(uri);`);
  patch(page,`              <MessageRenderer
                v-for="(m, i) in messages"
                :key="m?.id ?? i"
                :message="m"
                :context="toolContext"
              />`,`              <ExecutionTimeline :messages="messages" :context="toolContext" :busy="isBusy" :error="session?.error.value" :awaiting-permission="permissionRequestsLen>0" />`);
  patch(page,"import MessageRenderer from '../components/Messages/MessageRenderer.vue';","import ExecutionTimeline from '../components/Messages/ExecutionTimeline.vue';");
  // The stream owns the live state, including the wait before the first event.
  patch(page,`            <div v-if="isBusy" class="spinnerRow">
              <Spinner :size="16" :permission-mode="permissionMode" />
            </div>`, '');
  const model='src/webview/src/models/Message.ts';
  patch(model,'\n  is_error?: boolean;','\n  is_error?: boolean;\n  parentToolUseId?: string;');
  patch(model,'\n      is_error?: boolean;','\n      is_error?: boolean;\n      parentToolUseId?: string;');
  patch(model,'      this.is_error = extra.is_error;','      this.is_error = extra.is_error;\n      this.parentToolUseId = extra.parentToolUseId;');
  patch(model,'        raw.timestamp || Date.now()','        raw.timestamp || Date.now(),\n        {parentToolUseId:raw.parent_tool_use_id}');
  patch(model,`    // 不渲染 result 消息（仅用于结束标志/用量统计等状态更新）
    if (raw.type === 'result') {
      return null;
    }`,`    // Internal turn boundaries let the UI distinguish the final answer from progress.
    // Child results must never settle the main turn.
    if (raw.type === 'result') {
      if(raw.parent_tool_use_id)return null;
      const output=typeof raw.result==='string'?raw.result:Array.isArray(raw.errors)?raw.errors.join('\\n'):'';
      return new Message('result',{role:'result',content:output},raw.timestamp||Date.now(),{subtype:raw.subtype,is_error:raw.is_error});
    }`);
  // The CLI adds synthetic user turns (image scale notes, skill text, command caveats:
  // isSynthetic live, isMeta in transcripts). They are not the user's messages, must
  // not render as bubbles and must not split a running request into separate turns.
  patch(model,'  static fromRaw(raw: any): Message | null {\n',"  static fromRaw(raw: any): Message | null {\n    if (raw.type === 'user' && (raw.isSynthetic || raw.isMeta)) return null;\n");
  const sdk='src/services/claude/ClaudeSdkService.ts';
  patch(sdk,'append: VS_CODE_APPEND_PROMPT',`append: VS_CODE_APPEND_PROMPT + '\\n\\nExecution communication: The client renders thoughts, tool invocations and results as they arrive in the standard execution stream. Let the current task and tool results determine each next call; do not trigger a startup checklist, load every capability or narrate tool-call counts. Use brief progress text when it explains a finding, blocker or next action. Do not repeat raw commands or logs already shown by the tool step. Never withhold a necessary question, tool failure or verification limitation. On completion, give a concise final answer with outcomes, unresolved issues and relevant verification. If the user explicitly requests detailed plans or logs, provide them. This affects presentation only; retain all tools, permissions and capabilities.'`);
}
