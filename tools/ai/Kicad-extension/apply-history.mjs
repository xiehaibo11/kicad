import fs from 'node:fs';
import path from 'node:path';
export function applyHistory(root) {
  function patch(file,before,after){const target=path.join(root,file),text=fs.readFileSync(target,'utf8');if(text.split(before).length!==2)throw Error('History anchor missing/ambiguous: '+file);fs.writeFileSync(target,text.replace(before,()=>after));}
  const service='src/services/claude/ClaudeSessionService.ts';
  patch(service,"import * as os from 'os';", "import * as os from 'os';\nimport {listHistory,readHistory,terminalMessages} from '../../shared/kicadHistory';");
  patch(service,'            return sessions;',`            const all=new Map(sessions.filter(item=>item.id).map(item=>[item.id,item]));
            const shared=await listHistory(cwd,'extension');
            try{shared.push(...await listHistory(cwd,'terminal'));}catch(error){this.logService.error('Terminal history unavailable',error);}
            for(const entry of shared){
                const id=entry.source==='extension'?entry.nativeId:entry.id;
                const current=all.get(id);
                if(!current || entry.messageCount>current.messageCount)all.set(id,{...entry,id,isSidechain:false,summary:(entry.source==='terminal'?'[终端] ':'')+entry.summary});
            }
            return [...all.values()].sort((a,b)=>b.lastModified-a.lastModified);`);
  patch(service,'            const data = await loadProjectData(cwd);\n\n            const messageUuids',`            if(sessionIdOrPath.startsWith('terminal:'))return terminalMessages(await readHistory(sessionIdOrPath,cwd),sessionIdOrPath);
            const saved=await readHistory('extension:'+sessionIdOrPath,cwd);
            const backup=saved.map(msg=>({...msg,session_id:sessionIdOrPath,parent_tool_use_id:null}));
            const data = await loadProjectData(cwd);

            const messageUuids`);
  patch(service,'            if (!messageUuids) {\n                return [];','            if (!messageUuids) {\n                return backup;');
  patch(service,'            return result;','            return backup.length>result.length ? backup : result;');
  const session='src/webview/src/core/Session.ts';
  patch(session,'  async preloadConnection(): Promise<void> {','  async preloadConnection(): Promise<void> {\n    if(this.sessionId()?.startsWith(\'terminal:\'))return;');
  patch(session,'  async launchClaude(expectedEpoch?:number): Promise<string> {',`  async launchClaude(expectedEpoch?:number): Promise<string> {
    if(this.sessionId()?.startsWith('terminal:'))throw new Error('这是终端历史记录。请使用“Kicad: 共享会话历史”中的“在终端继续”。');`);
  patch('src/webview/src/pages/ChatPage.vue','          <ChatInputBox',`          <div v-if="session?.sessionId.value?.startsWith('terminal:')" role="status" style="padding:12px;color:var(--vscode-descriptionForeground)">终端历史记录（只读）。可在“共享会话历史”中选择“在终端继续”。</div>
          <ChatInputBox v-else`);
  const pkgFile=path.join(root,'package.json'),pkg=JSON.parse(fs.readFileSync(pkgFile,'utf8'));
  pkg.version='0.4.42';
  pkg.contributes.commands.push({command:'kicadAgent.diagnostics',title:'Kicad: 运行日志与问题分析'});
  pkg.contributes.commands.push({command:'kicadAgent.history',title:'Kicad: 共享会话历史',icon:'$(history)'});
  pkg.contributes.menus['view/title'].push({command:'kicadAgent.history',when:'view == kicad.chatView',group:'navigation'});
  fs.writeFileSync(pkgFile,JSON.stringify(pkg,null,2)+'\n');
}
