<template>
  <section class="execution-turn">
    <div v-if="view.notices.length || view.failures.length || view.resultError" class="execution-important">
      <MessageRenderer v-for="(message,index) in view.notices" :key="index" :message="message" :context="context" />
      <div v-if="view.resultError" class="execution-result-error" role="alert">{{ view.resultError }}</div>
      <div v-if="view.failures.length" class="execution-failures" role="status">
        <button v-for="failure in view.failures.slice(0,3)" :key="failure.id" class="execution-failure" @click="expanded=true">
          <span class="codicon codicon-warning" aria-hidden="true" />
          <span>{{ failure.name }}：{{ failure.summary }}</span>
        </button>
        <button v-if="view.failures.length>3" class="execution-failure" @click="expanded=true">另有 {{ view.failures.length-3 }} 项异常，点击查看详情</button>
      </div>
    </div>
    <div v-if="view.details.length" class="execution-record">
      <button class="execution-toggle" :class="{running:view.status==='running'}" :aria-expanded="expanded" :aria-controls="detailsId" @click="expanded=!expanded">
        <span class="execution-status" aria-hidden="true" />
        <span>{{ awaitingPermission && busy ? '等待确认' : statusLabels[view.status] }}</span>
        <span v-if="view.toolCount" class="execution-count">· {{ view.toolCount }} 次工具调用</span>
        <span class="execution-toggle-label">{{ expanded?'收起':'点击查看' }}</span>
        <span class="codicon" :class="expanded?'codicon-chevron-up':'codicon-chevron-down'" aria-hidden="true" />
      </button>
      <div v-if="expanded" :id="detailsId" class="execution-details" role="region" aria-label="执行详情">
        <MessageRenderer v-for="(message,index) in view.details" :key="index" :message="message" :context="context" />
      </div>
    </div>
    <div v-if="view.answers.length" class="execution-answer">
      <MessageRenderer v-for="(message,index) in view.answers" :key="index" :message="message" :context="context" />
    </div>
  </section>
</template>
<script setup lang="ts">
import {computed,ref,useId} from 'vue';
import type {Message} from '../../models/Message';
import type {ToolContext} from '../../types/tool';
import {executionView} from '../../utils/executionTimeline';
import MessageRenderer from './MessageRenderer.vue';
const props=defineProps<{messages:Message[];context:ToolContext;busy?:boolean;disconnected?:boolean;awaitingPermission?:boolean}>();
const expanded=ref(false),detailsId='execution-'+useId();
const view=computed(()=>executionView(props.messages,!!props.busy,!!props.disconnected));
const statusLabels={running:'运行中',completed:'已完成',failed:'执行失败',stopped:'已停止',ended:'已结束'};
</script>
<style scoped>
.execution-turn{min-width:0;margin-bottom:6px;}
.execution-record{margin:4px 12px 8px;min-width:0;}
.execution-toggle{border:0;background:transparent;color:var(--vscode-descriptionForeground,#999);display:flex;align-items:center;flex-wrap:wrap;gap:6px;padding:6px 4px;font:inherit;font-size:12px;cursor:pointer;text-align:left;max-width:100%;border-radius:4px;}
.execution-toggle:hover{background:var(--vscode-list-hoverBackground,#292929);color:var(--vscode-foreground,#ccc);}
.execution-toggle:focus-visible,.execution-failure:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:2px;}
.execution-status{width:6px;height:6px;background:#888;border-radius:50%;flex:none;}
.running .execution-status{background:#9ad58b;box-shadow:0 0 0 2px #9ad58b18;}
.execution-count,.execution-toggle-label{color:var(--vscode-descriptionForeground,#999);}
.execution-toggle .codicon{font-size:12px;}
.execution-details{border-left:1px solid var(--vscode-panel-border,#333);padding:6px 0;margin:4px 0 0 7px;overflow-wrap:anywhere;min-width:0;}
.execution-result-error{margin:6px 16px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--vscode-errorForeground,#f48771);font-size:12px;max-height:200px;overflow:auto;}
.execution-failures{margin:4px 16px 6px;display:grid;gap:4px;}
.execution-failure{display:flex;align-items:baseline;gap:6px;background:none;border:0;padding:3px 0;color:var(--vscode-errorForeground,#f48771);font:inherit;font-size:12px;text-align:left;cursor:pointer;overflow-wrap:anywhere;min-width:0;}
.execution-failure span:last-child{min-width:0;}
</style>
