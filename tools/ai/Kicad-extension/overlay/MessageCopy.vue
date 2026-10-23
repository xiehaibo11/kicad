<template>
  <div class="message-actions" :class="{persistent}">
    <button class="message-copy" :title="copied?'已复制':'复制'" :aria-label="copied?'已复制':'复制这段内容'" @click="copy">
      <span class="codicon" :class="copied?'codicon-check':'codicon-copy'" aria-hidden="true" />
    </button>
  </div>
</template>
<script setup lang="ts">
import {ref} from 'vue';
// Copies one block of assistant text as its Markdown source, like the per-message
// action under each reply in Claude Code. Copying never opens an editor or sends a request.
const props=defineProps<{text:string;persistent?:boolean}>();
const copied=ref(false);let timer:ReturnType<typeof setTimeout>|undefined;
async function copy(){
  try{await navigator.clipboard.writeText(props.text);}
  catch{const area=document.createElement('textarea');area.value=props.text;document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}
  copied.value=true;if(timer)clearTimeout(timer);timer=setTimeout(()=>{copied.value=false;},1500);
}
</script>
<style scoped>
.message-actions{display:flex;gap:4px;margin-top:4px;height:22px;opacity:0;transition:opacity .12s;}
.message-actions.persistent{opacity:1;}
.message-copy{width:24px;height:22px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid transparent;border-radius:4px;background:none;color:var(--vscode-descriptionForeground,#8b8b8b);cursor:pointer;}
.message-copy:hover{color:var(--vscode-foreground,#ccc);border-color:var(--vscode-panel-border,#3a3a3a);}
.message-copy:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:1px;}
.message-copy .codicon{font-size:13px;}
</style>
