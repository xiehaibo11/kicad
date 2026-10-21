import fs from 'node:fs';
import path from 'node:path';

export function applyMessageEditing(root,overlay) {
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  function patch(file,before,after){const source=read(file);if(source.split(before).length!==2)throw Error('Message editing anchor missing/ambiguous: '+file+' '+before.slice(0,90));fs.writeFileSync(path.join(root,file),source.replace(before,()=>after));}
  for(const [source,target] of [['messageRevisions.ts','src/shared/messageRevisions.ts'],['messageEditStore.ts','src/services/claude/messageEditStore.ts']])fs.copyFileSync(path.join(overlay,source),path.join(root,target));
  const model='src/webview/src/models/Message.ts';
  patch(model,'  timestamp: number;','  timestamp: number;\n  uuid?:string;');
  patch(model,'      parentToolUseId?: string;','      parentToolUseId?: string;\n      uuid?:string;');
  patch(model,'      this.parentToolUseId = extra.parentToolUseId;','      this.parentToolUseId = extra.parentToolUseId;\n      this.uuid=extra.uuid;');
  patch(model,'{parentToolUseId:raw.parent_tool_use_id}','{parentToolUseId:raw.parent_tool_use_id,uuid:raw.uuid}');
  const utils='src/webview/src/utils/messageUtils.ts';
  patch(utils,'    if (message) {\n        messages.push(message);','    if (message) {\n        if(message.type===\'user\' && message.uuid && messages.some(m=>m.type===\'user\' && m.uuid===message.uuid))return;\n        messages.push(message);');
  const history='src/services/claude/ClaudeSessionService.ts';
  patch(history,"import * as os from 'os';","import * as os from 'os';\nimport {revisedSessionMessages} from './messageEditStore';");
  patch(history,'function getProjectHistoryDir(cwd: string): string {\n    return path.join(getProjectsDir(), cwd.replace(/[^a-zA-Z0-9]/g, "-"));\n}',`async function getProjectHistoryDir(cwd:string):Promise<string> {
    // The CLI persists projects under their real path (not macOS /var aliases).
    let canonical=cwd;try{canonical=await fs.realpath(cwd);}catch{}
    return path.join(getProjectsDir(),canonical.replace(/[^a-zA-Z0-9]/g,'-'));
}`);
  patch(history,'    const projectDir = getProjectHistoryDir(cwd);','    const projectDir = await getProjectHistoryDir(cwd);');
  patch(history,'            toolUseResult: msg.toolUseResult','            uuid:msg.uuid,\n            toolUseResult: msg.toolUseResult');
  patch(history,'            uuid: msg.message?.id','            uuid: msg.uuid');
  patch(history,'            const sessions = transcripts.map(transcript => {','            const sessions = await Promise.all(transcripts.map(async transcript => {');
  patch(history,'                const summary = generateSummary(transcript);','                const displayed=await revisedSessionMessages(lastMessage.sessionId,transcript);\n                const summary = generateSummary(displayed);');
  patch(history,'                    messageCount: transcript.length,','                    messageCount: displayed.length,');
  patch(history,'                    summary: data.summaries.get(lastMessage.uuid) || summary,','                    summary: displayed===transcript ? data.summaries.get(lastMessage.uuid) || summary : summary,');
  patch(history,'            });\n\n            this.logService.info(`[ClaudeSessionService] 找到','            }));\n\n            this.logService.info(`[ClaudeSessionService] 找到');
  const protocol='src/shared/messages.ts';
  patch(protocol,'export interface GetSessionRequest {',`export interface RecordMessageEditRequest {
    type:'record_message_edit'; sessionId:string; originalId:string; replacementId:string;
}
export interface RecordMessageEditResponse {type:'record_message_edit_response';success:boolean}

export interface GetSessionRequest {`);
  patch(protocol,'    | GetSessionRequest','    | RecordMessageEditRequest\n    | GetSessionRequest');
  patch(protocol,'    | GetSessionResponse','    | RecordMessageEditResponse\n    | GetSessionResponse');
  const agent='src/services/claude/ClaudeAgentService.ts';
  patch(agent,"import { ILogService } from '../logService';","import { ILogService } from '../logService';\nimport {recordMessageEdit} from './messageEditStore';");
  patch(agent,'            case "get_session_request":',`            case 'record_message_edit':
                await recordMessageEdit(request.sessionId,{originalId:request.originalId,replacementId:request.replacementId});
                return {type:'record_message_edit_response',success:true};
            case "get_session_request":`);
  const handlers='src/services/claude/handlers/handlers.ts';
  patch(handlers,"import * as vscode from 'vscode';","import * as vscode from 'vscode';\nimport {revisedSessionMessages} from '../messageEditStore';");
  patch(handlers,'        const messages = await sessionService.getSession(request.sessionId, cwd);','        const messages = await revisedSessionMessages(request.sessionId,await sessionService.getSession(request.sessionId, cwd));');
  const transport='src/webview/src/transport/BaseTransport.ts';
  patch(transport,'  sendInput(channelId: string, message: any, done: boolean): void {',`  recordMessageEdit(sessionId:string,originalId:string,replacementId:string):Promise<any> {
    return this.sendRequest({type:'record_message_edit',sessionId,originalId,replacementId});
  }

  sendInput(channelId: string, message: any, done: boolean): void {`);
  const session='src/webview/src/core/Session.ts';
  patch(session,'    includeSelection = false\n  ): Promise<void> {','    includeSelection = false,\n    replaceMessage?:Message\n  ): Promise<void> {');
  patch(session,'    const epoch=++this.sendEpoch;',`    const replaceIndex=replaceMessage?this.messages().findIndex(m=>m.uuid===replaceMessage.uuid):-1;
    if(replaceMessage && (replaceIndex<0 || replaceMessage.type!=='user' || !replaceMessage.uuid))throw new Error('找不到要修改的消息，请重新打开会话后重试。');
    const epoch=++this.sendEpoch;`);
  patch(session,'      const model=MessageModel.fromRaw(userMessage);\n      if(model)this.messages([...this.messages(),model]);',`      if(replaceMessage && this.sessionId()) {
        const saved=await connection.recordMessageEdit(this.sessionId()!,replaceMessage.uuid!,userMessage.uuid!);
        if(!saved?.success)throw new Error('未能保存消息修改，请重试。');
        if(epoch!==this.sendEpoch || this.claudeChannelId()!==channelId)return;
      }
      const model=MessageModel.fromRaw(userMessage);
      const previous=this.messages();
      if(model)this.messages(replaceMessage?[...previous.slice(0,replaceIndex),model]:[...previous,model]);
      if(replaceMessage){this.activityIndex=new AgentActivityIndex();this.agentTasks([]);this.todos([]);}
      try {connection.sendInput(channelId,userMessage,false);}catch(error){this.messages(previous);throw error;}`);
  patch(session,'      connection.sendInput(channelId,userMessage,false);','      // Input was enqueued exactly once above, after the revision was saved.');
  // Persist before starting/resuming a process. A failed save leaves the draft
  // and old answer in place and cannot start a waiting SDK process.
  patch(session,'      const channelId=await this.launchClaude(epoch);\n      if(epoch!==this.sendEpoch || this.claudeChannelId()!==channelId)return;','');
  patch(session,'        if(epoch!==this.sendEpoch || this.claudeChannelId()!==channelId)return;','        if(epoch!==this.sendEpoch)return;');
  patch(session,'      const model=MessageModel.fromRaw(userMessage);','      const channelId=await this.launchClaude(epoch);\n      if(epoch!==this.sendEpoch || this.claudeChannelId()!==channelId)return;\n      const model=MessageModel.fromRaw(userMessage);');
  patch(session,'      if(!this.summary())this.summary(input);',"      if(!this.summary() || (replaceMessage && !this.messages().slice(0,replaceIndex).some(m=>m.type==='user'&&!m.isEmpty)))this.summary(input);");
  patch(session,"      type: 'user',\n      session_id: '',",`      type: 'user',
      uuid:globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3)|8).toString(16);}),
      session_id: '',`);
  patch(session,'  async launchClaude(expectedEpoch?:number): Promise<string> {',`  async resend(message:Message,input:string,attachments:AttachmentPayload[]=[]):Promise<void> {
    await this.send(input,attachments,false,message);
  }

  async launchClaude(expectedEpoch?:number): Promise<string> {`);
  const composable='src/webview/src/composables/useSession.ts';
  patch(composable,'  launchClaude: () => Promise<string>;','  resend:Session[\'resend\'];\n  launchClaude: () => Promise<string>;');
  patch(composable,'  const send = session.send.bind(session);','  const send = session.send.bind(session);\n  const resend=session.resend.bind(session);');
  patch(composable,'    send,\n    launchClaude,','    send,\n    resend,\n    launchClaude,');
  const tool='src/webview/src/types/tool.ts';
  patch(tool,"    send:(content:string,attachments:import('../core/Session').AttachmentPayload[])=>Promise<void>;","    resend:(message:import('../models/Message').Message,content:string,attachments:import('../core/Session').AttachmentPayload[])=>Promise<void>;");
  patch('src/webview/src/pages/ChatPage.vue','      send:async (content,files)=>{if(session.value)await session.value.send(content,files);}','      resend:async (message,content,files)=>{if(!session.value)throw new Error(\'会话已关闭。\');await session.value.resend(message,content,files);}');
  patch('src/webview/src/components/Messages/UserMessage.vue',"    await conversation.send(finalContent || ' ',attachments.value);","    await conversation.resend(props.message,finalContent || ' ',attachments.value);");
}
