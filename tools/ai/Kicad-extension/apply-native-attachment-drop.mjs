import fs from 'node:fs';
import path from 'node:path';

export function applyNativeAttachmentDrop(root,overlay) {
  const read = file => fs.readFileSync(path.join(root,file),'utf8');
  function patch(file,before,after) {
    const source = read(file);
    if (source.split(before).length !== 2) throw Error('Native attachment anchor missing/ambiguous: '+file+' '+before.slice(0,80));
    fs.writeFileSync(path.join(root,file),source.replace(before,() => after));
  }
  for (const file of ['kicadAttachmentDrop.ts','composerFileInbox.ts'])
    fs.copyFileSync(path.join(overlay,file),path.join(root,'src',file));
  const manifest = JSON.parse(read('package.json'));
  const views = manifest.contributes.views['kicad-sidebar'];
  if (!views?.some(view => view.id === 'kicad.chatView')) throw Error('Kicad view container missing');
  views.find(view => view.id === 'kicad.chatView').initialSize = 100;
  views.push({id:'kicad.attachmentDrop',name:'附件',initialSize:8});
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(manifest,null,2)+'\n');
  patch('src/extension.ts',"import { registerKiCadIntegration } from './kicadIntegration';","import { registerKiCadIntegration } from './kicadIntegration';\nimport {registerNativeAttachmentDrop} from './kicadAttachmentDrop';");
  patch('src/extension.ts','const webViewService = accessor.get(IWebViewService);','const webViewService = accessor.get(IWebViewService);\n    registerNativeAttachmentDrop(context,paths => webViewService.enqueueComposerFiles(paths));');

  const service = 'src/services/webViewService.ts';
  patch(service,"import * as path from 'path';","import * as path from 'path';\nimport {ComposerFileInbox} from '../composerFileInbox';");
  patch(service,'\tpostMessage(message: any): void;','\tpostMessage(message: any): void;\n\tenqueueComposerFiles(paths:string[]): void;');
  patch(service,'\tprivate readonly readyWebviews = new Set<vscode.Webview>();',`\tprivate readonly readyWebviews = new Set<vscode.Webview>();
  private readonly composerFiles = new ComposerFileInbox(message => {
    if (this.webviewIdMap.has('sidebar:chat:')) this.postMessage(message);
  });
  enqueueComposerFiles(paths:string[]) { this.composerFiles.enqueue(paths); }`);
  patch(service,"                    this.readyWebviews.add(webview);","                    this.readyWebviews.add(webview);\n                    if (bootstrap.host === 'sidebar' && bootstrap.page === 'chat') this.composerFiles.notify();");
  patch(service,"                if (message?.type === 'kicad_webview_error') {",`                if (bootstrap.host === 'sidebar' && bootstrap.page === 'chat') {
                    if (message?.type === 'kicad_composer_ready') { this.composerFiles.attached(); return; }
                    if (message?.type === 'kicad_composer_detached') { this.composerFiles.detached(); return; }
                    if (message?.type === 'kicad_composer_files_applied') { this.composerFiles.applied(message.id); return; }
                }
                if (message?.type === 'kicad_webview_error') {`);
  patch(service,'\t\tthis.readyWebviews.delete(webview);',"\t\tthis.readyWebviews.delete(webview);\n    if (this.webviewConfigs.get(webview)?.host === 'sidebar') this.composerFiles.detached();");

  patch('src/webview/src/transport/VSCodeTransport.ts',"        // 🔍 调试日志：打印从 Extension 接收到的原始消息",`        // Native attachments go to the composer, never to the model protocol or logs.
        if (['kicad_composer_files','kicad_composer_files_available'].includes((data.message as any)?.type)) return;
        // 🔍 调试日志：打印从 Extension 接收到的原始消息`);
  const app = 'src/webview/src/App.vue';
  patch(app,"import { ref, onMounted, provide } from 'vue';","import { ref, onMounted, onUnmounted, provide } from 'vue';");
  patch(app,"function handleSwitchToChat(sessionId?: string) {",`function revealComposerForFiles(event:MessageEvent) {
  if (needsRuntime && event.data?.type === 'from-extension' && event.data.message?.type === 'kicad_composer_files_available' && currentPage.value !== 'chat') switchToPage('chat');
}
window.addEventListener('message',revealComposerForFiles);
onUnmounted(() => window.removeEventListener('message',revealComposerForFiles));

function handleSwitchToChat(sessionId?: string) {`);
  const chat = 'src/webview/src/pages/ChatPage.vue';
  patch(chat,'          <ChatInputBox v-else','          <ChatInputBox v-else ref="nativeInput"');
  patch(chat,'        <div class="inputContainer">','        <div class="inputContainer">\n          <div v-if="nativeDropNotice" role="status">{{ nativeDropNotice }}</div>');
  patch(chat,'  onMounted(async () => {',fs.readFileSync(path.join(overlay,'nativeComposerInbox.txt'),'utf8')+'\n  onMounted(async () => {');
  patch('src/webview/src/components/ChatInputBox.vue','defineExpose({','defineExpose({\n  addDroppedPaths,');
}
