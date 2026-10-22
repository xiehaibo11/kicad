<template>
  <ol class="exec-steps" :class="{nested}">
    <li v-for="step in steps" :key="step.key" class="exec-step" :class="['exec-step-'+step.kind,step.kind==='tool'?'is-'+step.status:'']">
      <span class="exec-dot" aria-hidden="true" />
      <template v-if="step.kind==='thought'">
        <button class="exec-thought" :aria-expanded="open.has(step.key)" :disabled="!step.text.trim()" @click="toggle(step.key)">
          <span>{{ step.seconds ? '思考了 '+duration(step.seconds) : '思考' }}</span>
          <span v-if="step.text.trim()" class="codicon" :class="open.has(step.key)?'codicon-chevron-up':'codicon-chevron-down'" aria-hidden="true" />
        </button>
        <div v-if="open.has(step.key)" class="exec-thought-text">{{ step.text }}</div>
      </template>
      <template v-else-if="step.kind==='tool'">
        <div v-if="step.rich" class="exec-rich">
          <ContentBlock :block="step.wrapper.content" :wrapper="step.wrapper" :context="context" />
        </div>
        <template v-else>
          <div class="exec-tool-head" :title="step.summary">
            <span class="exec-tool-name">{{ step.label }}</span>
            <span v-if="step.summary" class="exec-tool-summary">{{ step.summary }}</span>
            <span v-if="step.status==='running'" class="exec-tool-state">执行中</span>
            <span v-else-if="step.status==='stopped'" class="exec-tool-state">未完成</span>
          </div>
          <ExecutionIO v-if="step.input||step.output" :input="step.input" :output="step.output" :error="step.status==='error'" />
        </template>
        <template v-if="step.children.length">
          <button class="exec-children-toggle" :aria-expanded="!closed.has(step.key)" @click="toggleChildren(step.key)">
            <span>子代理 · {{ countTools(step.children) }} 次工具调用</span>
            <span class="codicon" :class="closed.has(step.key)?'codicon-chevron-down':'codicon-chevron-up'" aria-hidden="true" />
          </button>
          <ExecutionSteps v-if="!closed.has(step.key)" :steps="step.children" :context="context" nested />
        </template>
      </template>
      <div v-else-if="step.kind==='text'" class="exec-text">
        <ContentBlock :block="step.wrapper.content" :context="context" />
      </div>
      <div v-else class="exec-other">
        <MessageRenderer :message="step.message" :context="context" />
      </div>
    </li>
    <li v-if="live" class="exec-step exec-step-live" role="status">
      <span class="exec-dot" aria-hidden="true" />
      <span class="exec-live">{{ live }}</span>
    </li>
    <li v-if="collapsible" class="exec-step exec-step-collapse">
      <span class="exec-dot" aria-hidden="true" />
      <button class="execution-collapse" @click="emit('collapse')">
        <span>收起</span>
        <span class="codicon codicon-chevron-up" aria-hidden="true" />
      </button>
    </li>
  </ol>
</template>
<script setup lang="ts">
import {reactive} from 'vue';
import type {ToolContext} from '../../types/tool';
import {countTools,type Step} from '../../utils/executionSteps';
import ContentBlock from './ContentBlock.vue';
import MessageRenderer from './MessageRenderer.vue';
import ExecutionIO from './ExecutionIO.vue';
defineProps<{steps:Step[];context:ToolContext;nested?:boolean;live?:string;collapsible?:boolean}>();
const emit=defineEmits<{collapse:[]}>();
const open=reactive(new Set<string>()),closed=reactive(new Set<string>());
const toggle=(key:string)=>open.has(key)?open.delete(key):open.add(key);
const toggleChildren=(key:string)=>closed.has(key)?closed.delete(key):closed.add(key);
const duration=(seconds:number)=>seconds<60?seconds+' 秒':Math.floor(seconds/60)+' 分 '+(seconds%60)+' 秒';
</script>
<style scoped>
.exec-steps{list-style:none;margin:0;padding:2px 0 0;min-width:0;}
.exec-steps.nested{margin:4px 0 0;}
.exec-step{position:relative;padding:0 0 12px 22px;min-width:0;font-size:13px;line-height:1.55;}
/* The rail joins the dots: from this dot down to the next one. */
.exec-step::before{content:'';position:absolute;left:4px;top:13px;bottom:-9px;width:1px;background:var(--vscode-panel-border,#3a3a3a);}
.exec-step:last-child::before{display:none;}
.exec-steps.nested>.exec-step:last-child{padding-bottom:0;}
/* Opaque dots so the rail passes behind them. */
.exec-dot{position:absolute;left:0;top:6px;width:9px;height:9px;border-radius:50%;background:color-mix(in srgb,var(--vscode-descriptionForeground,#8b8b8b) 55%,var(--vscode-sideBar-background,#181818));}
.exec-step-tool.is-success>.exec-dot{background:var(--vscode-testing-iconPassed,#73c991);}
.exec-step-tool.is-error>.exec-dot{background:var(--vscode-testing-iconFailed,#f14c4c);}
.exec-step-tool.is-running>.exec-dot,.exec-step-live>.exec-dot{background:#d97757;animation:exec-pulse 1.4s ease-in-out infinite;}
.exec-step-tool.is-stopped>.exec-dot{background:var(--vscode-sideBar-background,#181818);border:1px solid var(--vscode-descriptionForeground,#7a7a7a);box-sizing:border-box;}
@keyframes exec-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.exec-thought,.execution-collapse,.exec-children-toggle{display:inline-flex;align-items:center;gap:6px;border:0;background:none;padding:0;font:inherit;color:var(--vscode-descriptionForeground,#8b8b8b);cursor:pointer;text-align:left;}
.exec-thought:disabled{cursor:default;}
.exec-thought:not(:disabled):hover,.execution-collapse:hover,.exec-children-toggle:hover{color:var(--vscode-foreground,#ccc);}
.exec-thought .codicon,.execution-collapse .codicon,.exec-children-toggle .codicon{font-size:12px;}
.exec-thought:focus-visible,.execution-collapse:focus-visible,.exec-children-toggle:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:2px;border-radius:3px;}
.exec-thought-text{margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--vscode-descriptionForeground,#8b8b8b);font-size:12.5px;max-height:320px;overflow:auto;}
.exec-tool-head{display:flex;align-items:baseline;gap:8px;min-width:0;}
.exec-tool-name{flex:none;font-weight:600;color:var(--vscode-foreground,#e0e0e0);}
.exec-tool-summary{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--vscode-descriptionForeground,#9a9a9a);}
.exec-tool-state{flex:none;font-size:11px;color:var(--vscode-descriptionForeground,#8b8b8b);}
.exec-children-toggle{margin-top:6px;font-size:12px;}
.exec-live{color:var(--vscode-descriptionForeground,#8b8b8b);}
.exec-text :deep(.markdown-content){color:var(--vscode-foreground,#d4d4d4);}
.exec-text :deep(.markdown-content p:first-child){margin-top:0;}
.exec-text :deep(.markdown-content p:last-child){margin-bottom:0;}
.exec-other :deep(.message){margin:0;}
/* Dedicated renderers (diff, todo list) sit in the row; the rail and dot replace their icon. */
.exec-rich :deep(.tool-message-wrapper){padding:0;}
.exec-rich :deep(.main-line){padding:0;gap:8px;}
.exec-rich :deep(.tool-icon-btn){display:none;}
.exec-rich :deep(.status-indicator-trailing){display:none;}
.exec-rich :deep(.tool-label){font-weight:600;font-size:13px;}
.exec-rich :deep(.expandable-content){margin:6px 0 0;padding:0;border-left:0;}
</style>
