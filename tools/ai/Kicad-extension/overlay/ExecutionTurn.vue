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
      <button ref="toggleButton" class="execution-toggle" :class="{running:view.status==='running',expanded}" :aria-expanded="expanded" :aria-controls="detailsId" :title="expanded?'收起执行记录':'展开执行记录'" @click="expanded=!expanded">
        <span class="execution-status" aria-hidden="true" />
        <span class="execution-label">{{ awaitingPermission && busy ? '等待确认' : statusLabels[view.status] }}</span>
        <span v-if="view.toolCount" class="execution-count">{{ view.toolCount }} 次工具调用</span>
        <span v-if="progress" class="execution-progress" :title="progress">· {{ progress }}</span>
        <span class="codicon" :class="expanded?'codicon-chevron-up':'codicon-chevron-down'" aria-hidden="true" />
      </button>
      <div v-if="expanded" :id="detailsId" class="execution-details" role="region" aria-label="执行详情">
        <ExecutionSteps :steps="steps" :context="context" :live="live" collapsible @collapse="collapseDetails" />
      </div>
    </div>
    <div v-if="view.answers.length" class="execution-answer">
      <MessageRenderer v-for="(message,index) in view.answers" :key="index" :message="message" :context="context" />
    </div>
  </section>
</template>
<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref,useId,watch} from 'vue';
import type {Message} from '../../models/Message';
import type {ToolContext} from '../../types/tool';
import {executionView} from '../../utils/executionTimeline';
import {executionSteps} from '../../utils/executionSteps';
import MessageRenderer from './MessageRenderer.vue';
import ExecutionSteps from './ExecutionSteps.vue';
const props=defineProps<{messages:Message[];context:ToolContext;busy?:boolean;disconnected?:boolean;awaitingPermission?:boolean;startedAt?:number}>();
const expanded=ref(false),detailsId='execution-'+useId();
const toggleButton=ref<HTMLButtonElement>();
const view=computed(()=>executionView(props.messages,!!props.busy,!!props.disconnected));
// Tick only while running so long tools show live elapsed time instead of a static spinner.
const now=ref(Date.now());let timer:ReturnType<typeof setInterval>|undefined;
watch(()=>view.value.status==='running',running=>{if(timer)clearInterval(timer);timer=running?setInterval(()=>{now.value=Date.now();},1000):undefined;now.value=Date.now();},{immediate:true});
onBeforeUnmount(()=>{if(timer)clearInterval(timer);});
const elapsed=(since:number)=>{const s=Math.max(0,Math.floor((now.value-since)/1000));return s<60?s+' 秒':Math.floor(s/60)+' 分 '+(s%60)+' 秒';};
const progress=computed(()=>{
  if(view.value.status!=='running'||(props.awaitingPermission&&props.busy))return '';
  const tool=view.value.running;
  if(tool)return '正在执行 '+tool.name+(tool.detail?'：'+tool.detail:'')+(tool.parent?'':'（子代理）')+' · '+elapsed(tool.since);
  return '等待模型回复 · '+elapsed(view.value.lastActivity);
});
const statusLabels={running:'运行中',completed:'已完成',failed:'执行失败',stopped:'已停止',ended:'已结束'};
// Timeline rows only while expanded; a running turn without a running tool is waiting on the model.
const steps=computed(()=>expanded.value?executionSteps(view.value.details,view.value.status==='running',props.startedAt):[]);
const live=computed(()=>view.value.status==='running'&&!view.value.running&&!(props.awaitingPermission&&props.busy)?'思考中… · '+elapsed(view.value.lastActivity):'');
async function collapseDetails(){
  expanded.value=false;
  await nextTick();
  toggleButton.value?.focus({preventScroll:true});
  toggleButton.value?.scrollIntoView({block:'nearest',inline:'nearest'});
}
</script>
<style scoped>
.execution-turn{min-width:0;margin-bottom:6px;}
.execution-record{margin:4px 16px 8px;min-width:0;}
.execution-toggle{border:0;background:transparent;color:var(--vscode-descriptionForeground,#999);display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:3px 0;font:inherit;font-size:13px;cursor:pointer;text-align:left;max-width:100%;border-radius:4px;}
.execution-toggle:hover .execution-label,.execution-toggle:hover .codicon{color:var(--vscode-foreground,#e0e0e0);}
.execution-toggle:focus-visible,.execution-failure:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:2px;}
/* Header dot sits on the same rail as the timeline dots below it. */
.execution-status{width:9px;height:9px;margin-right:5px;background:color-mix(in srgb,var(--vscode-descriptionForeground,#8b8b8b) 55%,var(--vscode-sideBar-background,#181818));border-radius:50%;flex:none;}
.running .execution-status{background:#d97757;animation:execution-pulse 1.4s ease-in-out infinite;}
@keyframes execution-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.execution-label{color:var(--vscode-foreground,#d4d4d4);}
.execution-progress{color:var(--vscode-descriptionForeground,#999);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}
.execution-count{color:var(--vscode-descriptionForeground,#999);}
.execution-toggle .codicon{font-size:12px;}
.execution-details{position:relative;padding:10px 0 0;overflow-wrap:anywhere;min-width:0;}
/* Rail from the header dot into the first row. */
.execution-details::before{content:'';position:absolute;left:4px;top:-4px;height:20px;width:1px;background:var(--vscode-panel-border,#3a3a3a);}
.execution-result-error{margin:6px 16px;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--vscode-errorForeground,#f48771);font-size:12px;max-height:200px;overflow:auto;}
.execution-failures{margin:4px 16px 6px;display:grid;gap:4px;}
.execution-failure{display:flex;align-items:baseline;gap:6px;background:none;border:0;padding:3px 0;color:var(--vscode-errorForeground,#f48771);font:inherit;font-size:12px;text-align:left;cursor:pointer;overflow-wrap:anywhere;min-width:0;}
.execution-failure span:last-child{min-width:0;}
</style>
