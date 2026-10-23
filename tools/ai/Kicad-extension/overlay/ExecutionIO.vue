<template>
  <div class="exec-io" :class="{error}">
    <div v-for="row in rows" :key="row.label" class="exec-io-row" :class="'exec-io-'+row.label.toLowerCase()">
      <span class="exec-io-label">{{ row.label }}</span>
      <div class="exec-io-text" role="button" tabindex="0" :aria-label="'在编辑器中查看 '+row.label" title="在编辑器中查看完整内容"
        @click="view(row)" @keydown.enter.prevent="view(row,true)" @keydown.space.prevent="view(row,true)">{{ row.text }}</div>
      <button class="exec-io-copy" :title="copied===row.label?'已复制':'复制'" :aria-label="'复制 '+row.label" @click.stop="copy(row)">
        <span class="codicon" :class="copied===row.label?'codicon-check':'codicon-copy'" aria-hidden="true" />
      </button>
    </div>
    <div v-if="image" class="exec-io-row exec-io-image">
      <span class="exec-io-label">OUT</span>
      <button class="exec-image-link" :title="image.filePath" :aria-label="'查看图片 '+image.name+'（在编辑器中打开）'" @click="$emit('open-image')">
        <span class="codicon codicon-file-media" aria-hidden="true" />
        <span class="exec-image-name">{{ image.name }}</span>
        <span class="exec-image-action">在编辑器中查看</span>
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import {computed,ref} from 'vue';
import type {EditorImage} from '../../../../shared/imageFiles';
// Keep compact previews in chat; explicit activation opens the full text in the editor.
const props=defineProps<{input?:string;output?:string;image?:EditorImage;error?:boolean}>();
const emit=defineEmits<{(event:'open-image'):void;(event:'open-content',row:{label:string;text:string}):void}>();
const copied=ref('');
const rows=computed(()=>[
  ...(props.input?[{label:'IN',text:props.input}]:[]),
  ...(props.output?[{label:props.error?'ERR':'OUT',text:props.output}]:[]),
]);
function view(row:{label:string;text:string},keyboard=false){
  if(!keyboard&&window.getSelection()?.toString())return;
  emit('open-content',row);
}
async function copy(row:{label:string;text:string}){
  try{await navigator.clipboard.writeText(row.text);}
  catch{const area=document.createElement('textarea');area.value=row.text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}
  copied.value=row.label;setTimeout(()=>{if(copied.value===row.label)copied.value='';},1500);
}
</script>
<style scoped>
.exec-io{margin:6px 0 2px;border:1px solid var(--vscode-panel-border,#3a3a3a);border-radius:6px;background:color-mix(in srgb,var(--vscode-editor-background,#1e1e1e) 70%,transparent);overflow:hidden;min-width:0;}
.exec-io-row{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr);align-items:start;min-width:0;}
.exec-io-row+.exec-io-row{border-top:1px solid var(--vscode-panel-border,#3a3a3a);}
.exec-io-label{padding:8px 0 8px 12px;font-family:var(--vscode-editor-font-family,monospace);font-size:11px;letter-spacing:.04em;color:var(--vscode-descriptionForeground,#8b8b8b);user-select:none;}
.exec-io-text{padding:7px 36px 7px 0;font-family:var(--vscode-editor-font-family,monospace);font-size:12px;line-height:1.55;color:var(--vscode-editor-foreground,#d4d4d4);cursor:pointer;min-width:0;outline:none;}
.exec-io-in .exec-io-text{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.exec-io-out .exec-io-text,.exec-io-err .exec-io-text{white-space:pre-wrap;overflow-wrap:anywhere;max-height:5.2em;overflow:hidden;-webkit-mask-image:linear-gradient(to bottom,#000 55%,transparent);mask-image:linear-gradient(to bottom,#000 55%,transparent);}
.exec-io-err .exec-io-text{color:var(--vscode-errorForeground,#f48771);}
.exec-io-text:hover{background:var(--vscode-list-hoverBackground,#252525);}
.exec-io-text:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:-1px;}
.exec-image-link{display:flex;align-items:center;gap:6px;min-width:0;padding:7px 12px 7px 0;border:0;background:none;font:inherit;font-size:12px;text-align:left;color:var(--vscode-textLink-foreground,#3794ff);cursor:pointer;}
.exec-image-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.exec-image-action{flex:none;font-size:11px;color:var(--vscode-descriptionForeground,#999);}
.exec-image-link:hover .exec-image-name{text-decoration:underline;}
.exec-image-link:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:-1px;}
.exec-io-copy{position:absolute;top:4px;right:6px;width:24px;height:22px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:4px;background:var(--vscode-editor-background,#1e1e1e);color:var(--vscode-descriptionForeground,#8b8b8b);cursor:pointer;opacity:0;transition:opacity .12s;}
.exec-io-row:hover .exec-io-copy,.exec-io-copy:focus-visible{opacity:1;}
.exec-io-copy:hover{color:var(--vscode-foreground,#ccc);border-color:var(--vscode-panel-border,#3a3a3a);}
.exec-io-copy .codicon{font-size:13px;}
</style>
