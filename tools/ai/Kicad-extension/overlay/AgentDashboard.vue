<template>
  <button v-if="agents.length" ref="trigger" class="agent-dashboard-trigger" aria-haspopup="dialog" :aria-expanded="open" aria-label="打开子代理运行看板" @click="show">
    <span class="status-dot" :class="running ? 'running' : ''" />
    <span>{{ agents.length }} 个子代理</span>
    <span v-if="background.length" class="muted">· {{ background.length }} 后台</span>
  </button>
  <Teleport to="body">
    <div v-if="open && agents.length" class="agent-dashboard-backdrop" @click.self="hide">
      <section ref="dialog" class="agent-dashboard" role="dialog" aria-modal="true" aria-labelledby="agent-dashboard-title" tabindex="-1" @keydown="onKeydown">
        <header><div><h2 id="agent-dashboard-title">子代理运行看板</h2><p>{{ running }} 个运行中 · {{ tasks.length }} 个任务</p></div><button class="close" aria-label="关闭子代理看板" @click="hide">×</button></header>
        <div class="dashboard-scroll">
          <div v-if="!tasks.length" class="empty-state">当前对话还没有子代理或后台任务。<br>模型创建任务后会自动显示在这里。</div>
          <div v-else class="agent-map">
            <div class="parent-card"><span class="status-dot" :class="busy ? 'running' : ''" /><div><strong>{{ title || '当前对话' }}</strong><small>{{ model || '当前模型' }} · 主代理</small></div></div>
            <div class="children"><button v-for="task in agents" :key="task.id" class="task-card" :class="{selected:selected === task.id}" @click="selected=task.id"><span class="status-dot" :class="task.status" /><div><strong>{{ task.title }}</strong><small>{{ statusLabel[task.status] }}<template v-if="elapsed(task)"> · {{ elapsed(task) }}</template><template v-if="task.tokens !== undefined"> · {{ task.tokens.toLocaleString() }} tokens</template></small></div><span class="detail-arrow">›</span></button></div>
          </div>
          <template v-if="background.length"><h3>{{ background.length }} 个后台任务 <span class="muted">· 点击查看详情</span></h3><div class="background-grid"><button v-for="task in background" :key="task.id" class="task-card" :class="{selected:selected === task.id}" @click="selected=task.id"><span class="status-dot" :class="task.status" /><div><strong>{{ task.title }}</strong><small>{{ statusLabel[task.status] }} · {{ elapsed(task) || '耗时未提供' }}</small></div></button></div></template>
          <section v-if="detail" class="task-detail" aria-label="任务详情"><h3>{{ detail.title }}</h3><dl><dt>状态</dt><dd>{{ statusLabel[detail.status] }}</dd><dt>类型</dt><dd>{{ detail.agentType || (detail.kind === 'agent' ? '子代理' : '后台命令') }}</dd><dt>模型</dt><dd>{{ detail.model || 'SDK 未提供' }}</dd><dt>Token</dt><dd>{{ detail.tokens?.toLocaleString() ?? '未提供' }}</dd><dt>任务 ID</dt><dd>{{ detail.taskId || detail.id }}</dd><template v-if="detail.parentId"><dt>父任务</dt><dd>{{ detail.parentId }}</dd></template></dl><template v-if="detail.prompt"><h4>任务要求</h4><pre>{{ detail.prompt }}</pre></template><template v-if="detail.latest"><h4>最新活动 / 结果</h4><pre>{{ detail.latest }}</pre></template><template v-if="detail.outputFile"><h4>输出文件</h4><pre>{{ detail.outputFile }}</pre></template><p v-if="detail.status === 'unknown'" class="muted">历史记录或连接中断，当前运行状态无法确认。</p></section>
        </div>
        <footer>状态来自当前对话的实际任务事件 · Esc 关闭</footer>
      </section>
    </div>
  </Teleport>
</template>
<script setup lang="ts">
import {computed,ref,nextTick,watch,onUnmounted} from 'vue';
import type {AgentActivity,ActivityStatus} from '../../../shared/agentActivity';
const props=withDefaults(defineProps<{tasks?:AgentActivity[];title?:string;model?:string;busy?:boolean}>(),{tasks:()=>[]});
const open=ref(false),selected=ref(''),now=ref(Date.now()),trigger=ref<HTMLElement>(),dialog=ref<HTMLElement>();
const agents=computed(()=>props.tasks.filter(t=>t.kind==='agent'));
const background=computed(()=>props.tasks.filter(t=>t.kind==='background'));
const running=computed(()=>props.tasks.filter(t=>t.status==='running').length);
const detail=computed(()=>props.tasks.find(t=>t.id===selected.value));
const statusLabel:Record<ActivityStatus,string>={running:'运行中',completed:'已完成',failed:'失败',stopped:'已停止',unknown:'状态待确认'};
let timer:ReturnType<typeof setInterval>|undefined;
watch(()=>open.value && running.value>0,active=>{if(timer)clearInterval(timer);timer=active?setInterval(()=>now.value=Date.now(),1000):undefined;});
watch(()=>props.tasks,()=>{if(selected.value&&!detail.value)selected.value='';if(!agents.value.length)open.value=false;});
async function show(){open.value=true;now.value=Date.now();await nextTick();dialog.value?.querySelector<HTMLButtonElement>('.close')?.focus();}
async function hide(){open.value=false;await nextTick();trigger.value?.focus();}
function onKeydown(event:KeyboardEvent){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();void hide();}
  if(event.key==='Tab'){
    event.stopPropagation();
    const buttons=Array.from(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),[tabindex="0"]')||[]);
    const first=buttons[0],last=buttons.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
}
function elapsed(t:AgentActivity){const ms=t.durationMs??(t.startedAt && (t.endedAt || (t.status==='running'?now.value:undefined)) ? (t.endedAt||now.value)-t.startedAt : undefined);if(ms===undefined)return '';const secs=Math.max(0,Math.floor(ms/1000));return `${Math.floor(secs/60)}m ${secs%60}s`;}
onUnmounted(()=>{if(timer)clearInterval(timer);});
</script>
<style scoped>
.agent-dashboard-trigger{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--vscode-widget-border,#444);border-radius:12px;background:transparent;color:var(--vscode-foreground);font:inherit;font-size:11px;padding:3px 8px;cursor:pointer;white-space:nowrap;max-width:100%;}
.agent-dashboard-trigger{overflow:hidden}.agent-dashboard-trigger span{overflow:hidden;text-overflow:ellipsis;min-width:0}.agent-dashboard-trigger .status-dot{min-width:7px}.agent-dashboard-trigger:hover{background:var(--vscode-list-hoverBackground,#333)}
.status-dot{width:7px;height:7px;border-radius:50%;background:#888;flex:none;display:inline-block}.status-dot.running{background:#9ad58b;box-shadow:0 0 0 2px #9ad58b18}.status-dot.completed{background:#6bafff}.status-dot.failed{background:#f48771}.status-dot.stopped{background:#dbbd77}
.agent-dashboard-backdrop{position:fixed;inset:0;z-index:4000;display:flex;align-items:center;justify-content:center;background:#0009;padding:16px;box-sizing:border-box}
.agent-dashboard{display:flex;flex-direction:column;width:900px;max-width:100%;max-height:88vh;background:var(--vscode-editor-background,#181818);color:var(--vscode-foreground,#ccc);border:1px solid var(--vscode-widget-border,#555);border-radius:10px;box-shadow:0 12px 48px #0007;overflow:hidden;font-family:var(--vscode-font-family)}
header{padding:18px 20px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid var(--vscode-panel-border,#333)}h2{font-size:16px;margin:0;font-weight:600}p{font-size:12px;margin:8px 0 0;color:var(--vscode-descriptionForeground,#999)}button{color:inherit}.close{border:0;background:transparent;font-size:24px;line-height:20px;cursor:pointer;padding:0 2px}.dashboard-scroll{padding:20px;overflow:auto;min-height:120px}.empty-state{text-align:center;font-size:13px;line-height:2;padding:35px 10px;color:var(--vscode-descriptionForeground,#999)}
.agent-map{display:grid;grid-template-columns:minmax(140px,1fr) minmax(0,1.2fr);gap:32px;align-items:center}.parent-card,.task-card{border:1px solid var(--vscode-widget-border,#444);border-radius:5px;padding:12px;display:flex;align-items:baseline;gap:8px;min-width:0;background:var(--vscode-sideBar-background,#202020)}.parent-card div,.task-card div{min-width:0;flex:1}.parent-card strong,.task-card strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;font-weight:500}.parent-card small,.task-card small{display:block;margin-top:5px;color:var(--vscode-descriptionForeground,#999);font-size:11px}.children{display:grid;gap:9px;border-left:1px solid var(--vscode-widget-border,#444);padding-left:18px}.task-card{width:100%;text-align:left;font:inherit;cursor:pointer;position:relative}.children .task-card:before{content:'';position:absolute;width:18px;height:1px;background:var(--vscode-widget-border,#444);left:-19px;top:50%}.task-card:hover,.task-card.selected{border-color:var(--vscode-focusBorder,#3794ff);background:var(--vscode-list-hoverBackground,#292929)}.detail-arrow{color:var(--vscode-descriptionForeground,#999)}h3{font-size:13px;margin:22px 0 10px;font-weight:500}.background-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.muted{font-weight:400;color:var(--vscode-descriptionForeground,#999)}
.task-detail{margin-top:20px;border-top:1px solid var(--vscode-panel-border,#333)}dl{display:grid;grid-template-columns:110px 1fr;gap:7px;font-size:12px}dt{color:var(--vscode-descriptionForeground,#999)}dd{margin:0;overflow-wrap:anywhere}h4{font-size:12px;margin:16px 0 8px}pre{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;max-height:230px;overflow:auto;background:var(--vscode-textCodeBlock-background,#222);padding:10px;border-radius:4px}footer{border-top:1px solid var(--vscode-panel-border,#333);padding:10px 20px;color:var(--vscode-descriptionForeground,#999);font-size:11px}button:focus-visible{outline:1px solid var(--vscode-focusBorder,#3794ff);outline-offset:2px}
@media(max-width:600px){.agent-dashboard-backdrop{padding:8px}.dashboard-scroll{padding:14px}.agent-map{grid-template-columns:1fr;gap:14px}.children{margin-left:12px}.background-grid{grid-template-columns:1fr}header{padding:14px}dl{grid-template-columns:95px 1fr}}
</style>
