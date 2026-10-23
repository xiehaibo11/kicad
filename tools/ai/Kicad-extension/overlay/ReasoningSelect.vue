<template>
  <DropdownTrigger align="right" :width="360" :disabled="disabled" :trigger-props="{role:'button', tabindex:0, 'aria-label':'Select reasoning effort', 'aria-disabled':disabled, onKeydown: triggerKey}">
    <template #trigger>
      <span class="reasoning-trigger" :class="{'is-disabled':disabled}" :title="'Reasoning effort: ' + selected.label" @click.capture="blockDisabled">
        <span class="codicon codicon-brain" /><span>{{ selected.label }}</span><span class="codicon codicon-chevron-up" />
      </span>
    </template>
    <template #header><div class="reasoning-heading">Reasoning effort<span>Levels supported by the current model</span></div></template>
    <template #content="{close}">
      <DropdownItem v-for="(option,index) in options" :key="option.value" :index="index"
        :item="{id:option.value,label:option.label,detail:option.description,checked:option.value===selected.value,type:'reasoning'}"
        :is-selected="option.value===selected.value" @click="() => choose(option.value,close)" />
    </template>
  </DropdownTrigger>
</template>
<script setup lang="ts">
import {computed,onUnmounted,ref} from 'vue';
import {DropdownTrigger,DropdownItem} from './Dropdown';
import {reasoningOptions,onReasoningModelsChanged} from '../../../shared/kicadReasoning';
const props=defineProps<{model?:string;level?:string;disabled?:boolean}>();
const emit=defineEmits<{(event:'select',level:string):void}>();
// Discovered model capabilities arrive after the first render.
const revision=ref(0);
onUnmounted(onReasoningModelsChanged(()=>revision.value++));
const options=computed(()=>{void revision.value;return reasoningOptions(props.model)});
const selected=computed(()=>options.value.find(option=>option.value===props.level) ?? options.value[0]);
function choose(level:string,close:()=>void){close();if(!props.disabled)emit('select',level)}
function blockDisabled(event:MouseEvent){if(props.disabled){event.preventDefault();event.stopPropagation()}}
function triggerKey(event:KeyboardEvent){if(props.disabled){event.preventDefault();return}if(event.key==='Enter'||event.key===' '){event.preventDefault();(event.currentTarget as HTMLElement).click()}}
</script>
<style scoped>
.reasoning-trigger{display:inline-flex;align-items:center;gap:4px;font-size:12px;white-space:nowrap;cursor:pointer;color:var(--vscode-descriptionForeground);padding:3px;border-radius:4px}
.reasoning-trigger:hover{background:var(--vscode-toolbar-hoverBackground)}
.is-disabled{opacity:.5;cursor:wait}
.reasoning-heading{padding:8px 12px;font-size:13px;font-weight:600}.reasoning-heading span{display:block;font-size:11px;font-weight:normal;color:var(--vscode-descriptionForeground);margin-top:3px}
</style>
