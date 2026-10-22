import fs from 'node:fs';
import path from 'node:path';
export function applyLifecycle(root){
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  function patch(file,before,after){const s=read(file);if(s.split(before).length!==2)throw Error('Lifecycle anchor missing/ambiguous: '+file+' '+before.slice(0,80));fs.writeFileSync(path.join(root,file),s.replace(before,()=>after));}
  const session='src/webview/src/core/Session.ts';
  patch(session,'  private lastSentSelection?: SelectionRange;','  private lastSentSelection?: SelectionRange;\n  private sendEpoch=0;');
  const s=read(session),start=s.indexOf('    const connection = await this.getConnection();',s.indexOf('  async send(')),end=s.indexOf('\n  async launchClaude()',start);
  patch(session,s.slice(start,end),`    if(this.busy())throw new Error('当前请求仍在运行，请先暂停。');
    const epoch=++this.sendEpoch;
    this.busy(true);
    this.error(undefined);
    try {
      const connection=await this.getConnection();
      if(epoch!==this.sendEpoch)return;
      const channelId=await this.launchClaude();
      if(epoch!==this.sendEpoch || this.claudeChannelId()!==channelId)return;
      const shouldIncludeSelection=includeSelection&&!this.isSlashCommand(input);
      let selectionPayload:SelectionRange|undefined;
      if(shouldIncludeSelection&&!this.isSameSelection(this.lastSentSelection,this.selection())){
        selectionPayload=this.selection();this.lastSentSelection=selectionPayload;
      }
      const userMessage=this.buildUserMessage(input,attachments,selectionPayload);
      const model=MessageModel.fromRaw(userMessage);
      if(model)this.messages([...this.messages(),model]);
      if(!this.summary())this.summary(input);
      this.isExplicit(false);this.lastModifiedTime(Date.now());
      connection.sendInput(channelId,userMessage,false);
    } catch(error) {
      if(epoch!==this.sendEpoch)return;
      this.error(error instanceof Error?error.message:String(error));
      this.busy(false);
      throw error;
    }
  }
`);
  patch(session,'    const stream = connection.launchClaude(',`    if(this.claudeChannelId()!==channelId)throw new Error('请求已暂停。');
    const stream = connection.launchClaude(`);
  patch(session,'    void this.readMessages(stream);','    void this.readMessages(stream,channelId);');
  const current=read(session),a=current.indexOf('  async interrupt(): Promise<void> {'),b=current.indexOf('\n  async restartClaude()',a);
  patch(session,current.slice(a,b),`  async interrupt(): Promise<void> {
    ++this.sendEpoch;
    const channelId=this.claudeChannelId(),wasBusy=this.busy();
    // Retire the old stream before enabling Send. Late results cannot finish a new turn.
    this.claudeChannelId(undefined);
    this.busy(false);
    this.agentTasks(this.activityIndex.suspend());
    if(wasBusy)this.processIncomingMessage({type:'user',message:{role:'user',content:'[Request interrupted by user]'}});
    if(channelId){const connection=await this.getConnection();connection.interruptClaude(channelId);}
  }
`);
  patch(session,'  private async readMessages(stream: AsyncIterable<any>): Promise<void> {','  private async readMessages(stream: AsyncIterable<any>,channelId:string): Promise<void> {');
  patch(session,'      for await (const event of stream) {\n        this.processIncomingMessage(event);','      for await (const event of stream) {\n        if(this.claudeChannelId()!==channelId)break;\n        this.processIncomingMessage(event);');
  patch(session,`    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
      this.busy(false);
    } finally {
      this.agentTasks(this.activityIndex.suspend());
      this.busy(false);
      this.claudeChannelId(undefined);
    }`,`    } catch (error) {
      if(this.claudeChannelId()===channelId)this.error(error instanceof Error?error.message:String(error));
    } finally {
      if(this.claudeChannelId()===channelId){
        this.agentTasks(this.activityIndex.suspend());
        this.busy(false);
        this.claudeChannelId(undefined);
      }
    }`);
  patch(session,"    } else if (event?.type === 'result' && !event.parent_tool_use_id) {\n      this.busy(false);","    } else if (event?.type === 'result' && !event.parent_tool_use_id) {\n      if(typeof event.session_id==='string')this.sessionId(event.session_id);\n      this.busy(false);");
  const transport='src/webview/src/transport/BaseTransport.ts';
  patch(transport,`    this.send({ type: "interrupt_claude", channelId });`,`    this.send({ type: "interrupt_claude", channelId });
    this.retireChannel(channelId);`);
  const t=read(transport),c=t.indexOf('            const stream = this.streams.get(message.channelId);',t.indexOf('case "close_channel":')),d=t.indexOf('\n            break;',c);
  patch(transport,t.slice(c,d),'            this.retireChannel(message.channelId,message.error);');
  patch(transport,'  private async readMessages(): Promise<void> {',`  private retireChannel(channelId:string,error?:string):void {
    const stream=this.streams.get(channelId);
    this.streams.delete(channelId);
    if(error)stream?.error(new Error(error));
    stream?.done();
    for(const request of this.permissionRequests().filter(r=>r.channelId===channelId))request.reject('请求已暂停。',true);
  }

  private async readMessages(): Promise<void> {`);
  patch(transport,'      case "tool_permission_request": {\n        const response',`      case "tool_permission_request": {
        if(!message.channelId || !this.streams.has(message.channelId)){
          this.send({type:'response',requestId:message.requestId,response:{type:'tool_permission_response',result:{behavior:'deny',message:'请求已结束。',interrupt:true}}});
          break;
        }
        const response`);
  const agent='src/services/claude/ClaudeAgentService.ts';
  patch(agent,`        try {
            await this.sdkService.interrupt(channel.query);
            this.logService.info(\x60[ClaudeAgentService] 已中断 Channel: \x24{channelId}\x60);
        } catch (error) {
            this.logService.error(\x60[ClaudeAgentService] 中断失败:\x60, error);
        }`,`        let timer:ReturnType<typeof setTimeout>|undefined;
        try {
            await Promise.race([this.sdkService.interrupt(channel.query),new Promise<void>(resolve=>{timer=setTimeout(resolve,4000);})]);
            this.logService.info('已暂停请求，下次发送将恢复原会话。');
        } catch(error) {
            this.logService.warn('中断确认失败，正在关闭旧进程：'+String(error));
        } finally {
            if(timer)clearTimeout(timer);
            // The CLI may leave tool/agent abort state after interrupt. Resume with a fresh
            // process on the next explicit send, keeping the persisted session and options.
            if(this.channels.get(channelId)===channel)this.closeChannel(channelId,true);
        }`);
  patch(agent,'            for await (const message of this.fromClientStream) {\n                switch','            for await (const message of this.fromClientStream) {\n              try {\n                switch');
  patch(agent,`                        this.logService.error(\x60Unknown message type: \x24{(message as { type: string }).type}\x60);
                }
            }`,`                        this.logService.error(\x60Unknown message type: \x24{(message as { type: string }).type}\x60);
                }
              } catch(error) {
                this.logService.error('客户端消息处理失败：'+String(error));
                if('channelId' in message && message.channelId)this.closeChannel(message.channelId,true,String(error));
                // One failed launch must not terminate dispatch for subsequent sends.
              }
            }`);
}
