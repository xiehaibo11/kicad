<template>
  <span class="kicad-flag" :class="'kicad-flag-' + tone" :title="message">{{ flagLabel(kind) }}</span>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import {flagLabel} from '../kicadInventory';
// Theme colors only: upstream badge variants map "warning" to the git untracked color (green).
const props=defineProps<{kind:string;message?:string}>();
const tone=computed(()=>props.kind==='stale'||props.kind==='conflict'||props.kind==='oneoff'||props.kind==='unusable'?'warn':props.kind==='disabled'||props.kind==='ignored'?'muted':'info');
</script>
<style scoped>
.kicad-flag{display:inline-flex;align-items:center;height:18px;padding:0 6px;border:1px solid currentColor;border-radius:4px;font-size:11px;line-height:1;white-space:nowrap;}
.kicad-flag-warn{color:var(--vscode-editorWarning-foreground,#cca700);}
.kicad-flag-info{color:var(--vscode-textLink-foreground,#3794ff);}
.kicad-flag-muted{color:var(--vscode-descriptionForeground,#999);border-style:dashed;}
</style>
