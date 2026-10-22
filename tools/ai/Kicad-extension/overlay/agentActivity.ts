/** Incremental SDK activity index. Usage comes only from SDK task events. */
export type ActivityStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'unknown';
export interface AgentActivity {
  id: string; toolId?: string; taskId?: string; parentId?: string;
  kind: 'agent' | 'background'; title: string; prompt?: string; model?: string; agentType?: string;
  status: ActivityStatus; startedAt?: number; endedAt?: number;
  tokens?: number; toolUses?: number; durationMs?: number; latest?: string; outputFile?: string;
  background?: boolean;
}
const text = (v: unknown): string => typeof v === 'string' ? v.slice(0, 16000) : '';
const number = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
export class AgentActivityIndex {
  private tasks = new Map<string, AgentActivity>();
  private aliases = new Map<string, string>();
  private seen = new Set<string>();
  snapshot(): AgentActivity[] { return Array.from(this.tasks.values(), t => ({...t})); }
  private find(id?: string) { return id ? this.tasks.get(this.aliases.get(id) || id) : undefined; }
  private remember(t: AgentActivity, ...ids: Array<string | undefined>) {
    this.tasks.set(t.id, t);
    for (const id of ids) if (id) this.aliases.set(id, t.id);
  }
  private usage(t: AgentActivity, usage: any) {
    if (!usage) return;
    t.tokens = number(usage.total_tokens) ?? t.tokens;
    t.toolUses = number(usage.tool_uses) ?? t.toolUses;
    t.durationMs = number(usage.duration_ms) ?? t.durationMs;
  }
  private finish(t: AgentActivity, status: ActivityStatus, now: number, history: boolean) {
    t.status = status;
    if (!history && !t.endedAt) t.endedAt = now;
  }
  suspend(): AgentActivity[] {
    for (const t of this.tasks.values()) if (t.status === 'running') t.status = 'unknown';
    return this.snapshot();
  }
  consume(event: any, history = false, now = Date.now()): AgentActivity[] | undefined {
    if (!event || typeof event !== 'object') return;
    if (event.uuid) {
      if (this.seen.has(event.uuid)) return;
      this.seen.add(event.uuid);
      if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    }
    let changed = false;
    const timestamp = event.timestamp ? Date.parse(event.timestamp) : NaN;
    const startedAt = Number.isFinite(timestamp) ? timestamp : history ? undefined : now;
    if (event.type === 'system' && ['task_started','task_progress','task_notification'].includes(event.subtype) && event.task_id) {
      let t = this.find(event.task_id) || this.find(event.tool_use_id);
      // If the tool record and system record arrived in reverse order, merge them.
      const toolRecord = this.find(event.tool_use_id);
      if (t && toolRecord && t !== toolRecord) {
        const orphan = t;
        Object.assign(toolRecord, Object.fromEntries(Object.entries(orphan).filter(([k,v]) => v !== undefined && k !== 'id')));
        this.tasks.delete(orphan.id);
        for (const [alias,id] of this.aliases) if (id === orphan.id) this.aliases.set(alias,toolRecord.id);
        t = toolRecord;
      }
      if (!t) t = {id:event.tool_use_id || event.task_id,kind:event.task_type === 'local_bash' || event.task_type === 'bash' ? 'background' : 'agent',title:text(event.description) || '子代理任务',status:'running',startedAt};
      t.taskId = event.task_id; t.toolId = event.tool_use_id || t.toolId;
      t.parentId = event.parent_task_id || t.parentId;
      t.agentType = event.subagent_type || t.agentType;
      t.background = event.is_backgrounded ?? t.background;
      if (event.description) t.title = text(event.description);
      if (event.prompt) t.prompt = text(event.prompt);
      this.usage(t,event.usage);
      if (event.summary || event.last_tool_name) t.latest = text(event.summary || event.last_tool_name);
      if (event.subtype === 'task_notification') {
        this.finish(t, event.status === 'completed' ? 'completed' : event.status === 'stopped' ? 'stopped' : 'failed',now,history);
        t.outputFile = text(event.output_file) || t.outputFile;
      } else if (!t.endedAt && !['completed','failed','stopped'].includes(t.status)) t.status = 'running';
      this.remember(t,event.task_id,event.tool_use_id); changed = true;
    }
    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    for (const block of blocks) {
      if (block.type === 'tool_use' && (['Task','Agent'].includes(block.name) || block.name === 'Bash' && block.input?.run_in_background)) {
        const input = block.input || {};
        let t = this.find(block.id);
        if (!t) t = {id:block.id,kind:block.name === 'Bash' ? 'background' : 'agent',title:text(input.description) || text(input.command) || '子代理任务',status:'running',startedAt};
        t.toolId = block.id; t.parentId = event.parent_tool_use_id || t.parentId;
        t.prompt = text(input.prompt || input.command) || t.prompt;
        t.model = text(input.model) || t.model;
        t.agentType = text(input.subagent_type) || t.agentType;
        t.background = Boolean(input.run_in_background) || t.background;
        this.remember(t,block.id); changed = true;
      }
      if (block.type === 'tool_result') {
        const t = this.find(block.tool_use_id);
        if (!t) continue;
        const result = event.tool_use_result || event.toolUseResult || {};
        const body = typeof block.content === 'string' ? block.content : Array.isArray(block.content) ? block.content.map((b:any)=>b.text || '').join('\n') : '';
        t.latest = text(body) || t.latest;
        const taskId = result.agentId || result.task_id || result.backgroundTaskId || body.match(/(?:agentId|task_id):\s*([\w-]+)/)?.[1];
        if (taskId) {t.taskId = taskId; this.remember(t,taskId);}
        const asyncResult = result.isAsync || result.status === 'async_launched' || result.backgroundTaskId && !result.interrupted || /(?:running|launched).*background/i.test(body);
        if (block.is_error) this.finish(t,'failed',now,history);
        else if (asyncResult) t.background = true;
        else this.finish(t,'completed',now,history);
        this.usage(t,{total_tokens:result.totalTokens,tool_uses:result.totalToolUseCount,duration_ms:result.totalDurationMs});
        changed = true;
      }
    }
    // CLI 2.1.x sends task completion as a structured notification in a user
    // message rather than the newer system task_notification event.
    if(event.type === 'user') {
      const content=typeof event.message?.content==='string'?event.message.content:blocks.filter((b:any)=>b.type==='text').map((b:any)=>b.text||'').join('\n');
      for(const match of content.matchAll(/<(task|agent|bash)-notification>([\s\S]*?)<\/\1-notification>/g)){
        const value=(tag:string)=>match[2].match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))?.[1]?.trim();
        const id=value('task-id')||value('agent-id')||value('shell-id'),status=value('status');
        if(!id||!status||!['completed','failed','killed','stopped'].includes(status))continue;
        let t=this.find(id);
        if(!t)t={id,taskId:id,kind:match[1]==='bash'||value('task-type')==='local_bash'?'background':'agent',title:value('summary')||'后台任务',status:'unknown'};
        this.finish(t,status==='completed'?'completed':status==='failed'?'failed':'stopped',now,history);
        t.latest=text(value('summary')||value('result')||content);t.outputFile=value('output-file')||t.outputFile;
        this.remember(t,id);changed=true;
      }
    }
    if (event.parent_tool_use_id) {
      const parent = this.find(event.parent_tool_use_id);
      if (parent && event.type === 'assistant') {
        const latest = blocks.filter((b:any)=>b.type === 'text' || b.type === 'tool_use').map((b:any)=>b.text || b.name).join('\n');
        if (latest) {parent.latest = text(latest); changed = true;}
      }
    }
    if (!changed) return;
    // Keep all active tasks, but bound retained history and alias memory.
    const settled = [...this.tasks.values()].filter(t=>t.status !== 'running');
    for (const t of settled.slice(0,Math.max(0,settled.length-200))) {
      this.tasks.delete(t.id);
      for (const [alias,id] of this.aliases) if (id === t.id) this.aliases.delete(alias);
    }
    return this.snapshot();
  }
}
