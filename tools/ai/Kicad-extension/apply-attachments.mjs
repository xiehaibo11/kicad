// Image attachments open a preview: composer chips, images in sent messages and image blocks.
import fs from 'node:fs';
import path from 'node:path';
export function applyAttachments(root,overlay){
  function patch(file,before,after){const target=path.join(root,file),s=fs.readFileSync(target,'utf8');if(s.split(before).length!==2)throw Error('Attachment anchor missing/ambiguous: '+file+' '+before.slice(0,90));fs.writeFileSync(target,s.replace(before,()=>after));}
  fs.copyFileSync(path.join(overlay,'imagePreview.ts'),path.join(root,'src/webview/src/utils/imagePreview.ts'));
  fs.copyFileSync(path.join(overlay,'ImagePreview.vue'),path.join(root,'src/webview/src/components/ImagePreview.vue'));

  const page='src/webview/src/pages/ChatPage.vue';
  patch(page,"  import ExecutionTimeline from '../components/Messages/ExecutionTimeline.vue';","  import ExecutionTimeline from '../components/Messages/ExecutionTimeline.vue';\n  import ImagePreview from '../components/ImagePreview.vue';");
  patch(page,'        <div class="inputContainer">','        <ImagePreview />\n        <div class="inputContainer">');

  // Composer chips: image thumbnail, click or Enter previews; the hover close button still removes.
  const input='src/webview/src/components/ChatInputBox.vue';
  patch(input,`        class="attachment-item"
      >
        <div class="icon-wrapper">
          <div class="attachment-icon">
            <FileIcon :file-name="attachment.fileName" :size="16" />
          </div>`,`        class="attachment-item"
        :class="{ previewable: !!attachmentPreview(attachment) }"
        :role="attachmentPreview(attachment) ? 'button' : undefined"
        :tabindex="attachmentPreview(attachment) ? 0 : undefined"
        :title="attachmentPreview(attachment) ? '点击预览 ' + attachment.fileName : attachment.fileName"
        @click="openImagePreview(attachmentPreview(attachment))"
        @keydown.enter.prevent="openImagePreview(attachmentPreview(attachment))"
      >
        <div class="icon-wrapper">
          <div class="attachment-icon">
            <img v-if="attachmentPreview(attachment)" :src="attachmentPreview(attachment)!.src" alt="" class="attachment-thumb" />
            <FileIcon v-else :file-name="attachment.fileName" :size="16" />
          </div>`);
  patch(input,"import type { AttachmentItem } from '../types/attachment'","import type { AttachmentItem } from '../types/attachment'\nimport { attachmentPreview, openImagePreview } from '../utils/imagePreview'");
  patch(input,`.attachment-item:hover {`,`.attachment-item:not(.previewable) {
  cursor: default;
}

.attachment-item:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}

.attachment-thumb {
  width: 16px;
  height: 16px;
  object-fit: cover;
  border-radius: 2px;
  scale: 1.25;
}

.attachment-item:hover {`);

  // Sent messages showed only their text; list their images as clickable thumbnails.
  const user='src/webview/src/components/Messages/UserMessage.vue';
  patch(user,`          <div class="message-text">`,`          <div v-if="imageAttachments.length" class="message-attachments">
            <button
              v-for="attachment in imageAttachments"
              :key="attachment.id"
              class="message-attachment"
              :title="'点击预览 ' + attachment.fileName"
              @click.stop="openImagePreview(attachmentPreview(attachment))"
              @keydown.enter.stop
              @keydown.space.stop
            >
              <img :src="attachmentPreview(attachment)!.src" alt="" class="message-attachment-thumb" />
              <span class="message-attachment-name">{{ attachment.fileName }}</span>
            </button>
          </div>
          <div class="message-text">`);
  patch(user,"import FileIcon from '../FileIcon.vue';","import FileIcon from '../FileIcon.vue';\nimport { attachmentPreview, openImagePreview } from '../../utils/imagePreview';");
  patch(user,'// 从消息内容中提取附件（image 和 document blocks）','const imageAttachments = computed(() => extractAttachments().filter(attachment => !!attachmentPreview(attachment)));\n\n// 从消息内容中提取附件（image 和 document blocks）');
  patch(user,'.edit-error{color:var(--vscode-errorForeground);padding:4px 8px;font-size:12px;}',`.edit-error{color:var(--vscode-errorForeground);padding:4px 8px;font-size:12px;}
.message-attachments{align-self:stretch;display:flex;flex-wrap:wrap;gap:6px;padding:6px 8px 0;}
.message-attachment{display:inline-flex;align-items:center;gap:6px;max-width:220px;height:28px;padding:2px 8px 2px 2px;border:1px solid var(--vscode-editorWidget-border);border-radius:5px;background:var(--vscode-input-background);color:var(--vscode-foreground);font:inherit;font-size:12px;cursor:zoom-in;}
.message-attachment:hover{border-color:var(--vscode-focusBorder);}
.message-attachment:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px;}
.message-attachment-thumb{width:24px;height:22px;object-fit:cover;border-radius:3px;flex:none;}
.message-attachment-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}`);

  // Images in replies and tool results open the same preview.
  const block='src/webview/src/components/Messages/blocks/ImageBlock.vue';
  patch(block,`      class="image-content"
      @error="handleError"`,`      class="image-content"
      role="button"
      tabindex="0"
      title="点击查看大图"
      @click="openImagePreview({ src: imageSrc, name: imageAlt })"
      @keydown.enter.prevent="openImagePreview({ src: imageSrc, name: imageAlt })"
      @error="handleError"`);
  patch(block,"import type { ImageBlock as ImageBlockType } from '../../../models/ContentBlock';","import type { ImageBlock as ImageBlockType } from '../../../models/ContentBlock';\nimport { openImagePreview } from '../../../utils/imagePreview';");
  patch(block,`.image-content {
  max-width: 100%;`,`.image-content {
  cursor: zoom-in;
  max-width: 100%;`);
}
