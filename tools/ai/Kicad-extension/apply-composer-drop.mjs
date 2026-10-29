import fs from 'node:fs';
import path from 'node:path';
import {applyNativeAttachmentDrop} from './apply-native-attachment-drop.mjs';

export function applyComposerDrop(root, overlay) {
  const read = file => fs.readFileSync(path.join(root,file),'utf8');
  function patch(file,before,after) {
    const source = read(file);
    if (source.split(before).length !== 2) throw Error('Composer drop anchor missing/ambiguous: '+file+' '+before.slice(0,80));
    fs.writeFileSync(path.join(root,file),source.replace(before,()=>after));
  }
  fs.copyFileSync(path.join(overlay,'composerDrop.ts'),path.join(root,'src/webview/src/utils/composerDrop.ts'));
  fs.copyFileSync(path.join(overlay,'kicadAttachments.ts'),path.join(root,'src/kicadAttachments.ts'));
  patch('src/services/claude/ClaudeAgentService.ts','            case "open_config_file":',`            case "kicad_drop_files":
                return {type:'kicad_drop_files_response',...await (await import('../../kicadAttachments')).readDroppedFiles((request as any).paths,(request as any).cwd)};
            case "open_config_file":`);
  patch('src/webview/src/transport/BaseTransport.ts','  statPaths(paths: string[]): Promise<any> {',`  kicadDropFiles(paths:string[],cwd?:string):Promise<any> {
    return this.sendRequest({type:'kicad_drop_files',paths,cwd} as any);
  }
  statPaths(paths: string[]): Promise<any> {`);
  const input = 'src/webview/src/components/ChatInputBox.vue';
  patch(input,'  <div class="full-input-box" style="position: relative;">',`  <div class="full-input-box" style="position: relative;"
    :class="{'file-drop-active':fileDragActive}"
    @dragover="handleDragOver" @dragleave="handleDragLeave" @drop="handleDrop">`);
  patch(input,'      @dragover="handleDragOver"\n      @drop="handleDrop"','');
  patch(input,'    <!-- 第一行：输入框区域 -->','    <div v-if="dropError" class="attachment-drop-error" role="alert">{{ dropError }}</div>\n    <!-- 第一行：输入框区域 -->');
  patch(input,"import type { AttachmentItem } from '../types/attachment'","import type { AttachmentItem } from '../types/attachment'\nimport {isFileTransfer,droppedFilePaths,fileMention} from '../utils/composerDrop'");
  patch(input,"  (e: 'addAttachment', files: FileList): void","  (e: 'addAttachment', files: FileList): void\n  (e: 'addAttachmentItems', items: AttachmentItem[]): void");
  let source = read(input), begin = source.indexOf('function isFileDrop('), end = source.indexOf('async function statPaths(',begin);
  patch(input,source.slice(begin,end),'');
  source = read(input); begin = source.indexOf('function handleDragOver('); end = source.indexOf('function handleSubmit()',begin);
  patch(input,source.slice(begin,end),fs.readFileSync(path.join(overlay,'composerDropHandlers.txt'),'utf8')+'\n');
  patch(input,'!content.value.trim() || isLoading.value','(!content.value.trim() && !props.attachments.length) || isLoading.value');
  patch(input,'  if (!content.value.trim()) return','  if (!content.value.trim() && !props.attachments.length) return');
  patch(input,':has-input-content="!!content.trim()"',':has-input-content="!!content.trim() || !!attachments.length"');
  patch(input,'<style scoped>','<style scoped>\n.full-input-box.file-drop-active{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px;}\n.attachment-drop-error{color:var(--vscode-errorForeground);font-size:12px;padding:6px 8px;white-space:pre-wrap;overflow-wrap:anywhere;}');
  for (const file of ['src/webview/src/pages/ChatPage.vue','src/webview/src/components/Messages/UserMessage.vue'])
    patch(file,'@add-attachment="handleAddAttachment"','@add-attachment="handleAddAttachment"\n            @add-attachment-items="attachments.push(...$event)"');
  // Some OS drags provide an empty MIME type. Preserve the existing attachment
  // conversion path, inferring only the formats that the runtime supports.
  patch('src/webview/src/types/attachment.ts',"  const mediaType = (match ? match[1] : 'application/octet-stream').toLowerCase();",`  const inferred:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',pdf:'application/pdf',txt:'text/plain'};
  const detected=(match ? match[1] : '').toLowerCase();
  const mediaType=(!detected || detected==='application/octet-stream') ? (inferred[file.name.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream') : detected;`);
  applyNativeAttachmentDrop(root,overlay);
}
