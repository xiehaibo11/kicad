<template>
  <DropdownTrigger align="right" :width="260" :disabled="disabled" :trigger-props="{role:'button', tabindex:0, 'aria-label':'选择推理强度', 'aria-disabled':disabled, onKeydown: triggerKey}">
    <template #trigger>
      <span class="reasoning-trigger" :class="{'is-disabled':disabled}" :title="'推理强度：' + selected.label" @click.capture="blockDisabled">
        <span class="codicon codicon-brain" /><span>{{ selected.label }}</span><span class="codicon codicon-chevron-up" />
      </span>
    </template>
    <template #header><div class="reasoning-heading">推理强度<span>按当前模型支持的档位选择</span></div></template>
    <template #content="{close}">
      <DropdownItem v-for="(option,index) in options" :key="option.value" :index="index"
        :item="{id:option.value,label:option.label,detail:option.description,checked:option.value===selected.value,type:'reasoning'}"
        :is-selected="option.value===selected.value" @click="() => choose(option.value,close)" />
    </template>
  </DropdownTrigger>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import {DropdownTrigger,DropdownItem} from './Dropdown';
import {reasoningOptions,normalizeReasoning} from '../../../shared/kicadReasoning';
const props=defineProps<{model?:string;level?:string;disabled?:boolean}>();
const emit=defineEmits<{(event:'select',level:string):void}>();
const options=computed(()=>reasoningOptions(props.model));
const selected=computed(()=>options.value.find(option=>option.value===normalizeReasoning(props.model,props.level))!);
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
