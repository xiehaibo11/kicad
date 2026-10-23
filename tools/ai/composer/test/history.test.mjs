import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {saveExtensionEvent,listHistory,readHistory,terminalMessages} from '../history.ts';

test('shared history persists extension messages and reads native terminal sessions without crossing workspaces',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-history-')),saved={...process.env};
 try{
  const cwd=path.join(root,'project'),other=path.join(root,'other');await fs.mkdir(cwd);await fs.mkdir(other);
  process.env.KICAD_HISTORY_DIR=path.join(root,'history');process.env.CLAUDE_CONFIG_DIR=path.join(root,'claude');process.env.KICAD_HISTORY_DB=path.join(root,'terminal.db');
  const id='11111111-1111-4111-8111-111111111111';
  const user={type:'user',uuid:'user1',message:{role:'user',content:'保存我的设计检查会话'}};
  const assistant={type:'assistant',uuid:'assistant1',message:{role:'assistant',content:[{type:'text',text:'已读取，尚未修改。'}]}};
  await Promise.all([saveExtensionEvent(id,cwd,user),saveExtensionEvent(id,cwd,assistant)]);
  // CLI-generated turns (image scale notes) are not the user's messages.
  await saveExtensionEvent(id,cwd,{type:'user',uuid:'synthetic1',isSynthetic:true,message:{role:'user',content:[{type:'text',text:'[Image: original 2362x1672, displayed at 2000x1416.]'}]}});
  assert.equal((await listHistory(cwd,'extension')).length,1);
  assert.equal((await readHistory('extension:'+id,cwd)).length,2);
  assert.equal((await readHistory('extension:'+id,other)).length,0);
  assert.equal((await fs.stat(path.join(root,'history/extension',id+'.jsonl'))).mode&0o777,0o600);
  const real=await fs.realpath(cwd),native=path.join(root,'claude/projects',real.replace(/[^a-zA-Z0-9]/g,'-'));
  await fs.mkdir(native,{recursive:true});await fs.writeFile(path.join(native,id+'.jsonl'),JSON.stringify({...user,sessionId:id,timestamp:new Date().toISOString()})+'\n{"partial":');
  assert.equal((await readHistory('extension:'+id,cwd)).length,2,'native and unflushed backup deduplicate');
  const q=s=>"'"+s.replaceAll("'","''")+"'";
  execFileSync('/usr/bin/sqlite3',[process.env.KICAD_HISTORY_DB,`CREATE TABLE session(id,directory,title,time_updated,parent_id,time_archived);CREATE TABLE message(id,session_id,time_created,data);CREATE TABLE part(id,message_id,data);INSERT INTO session VALUES('ses_fixture',${q(real)},'终端检查',123,NULL,NULL);INSERT INTO message VALUES('msg1','ses_fixture',1,'{"role":"user"}');INSERT INTO part VALUES('p1','msg1','{"type":"text","text":"请检查 PCB"}');`]);
  const all=await listHistory(cwd);assert.equal(all.length,2);assert.ok(all.some(x=>x.id==='terminal:ses_fixture'));
  const terminal=await readHistory('terminal:ses_fixture',cwd);assert.equal(terminal[0].parts[0].text,'请检查 PCB');
  assert.equal(terminalMessages(terminal,'terminal:ses_fixture')[0].message.content[0].text,'请检查 PCB');
  await assert.rejects(readHistory('terminal:ses_fixture',other),/workspace/);
  await assert.rejects(readHistory('extension:../../secret',cwd),/Invalid/);
  await assert.rejects(readHistory("terminal:ses_x';DROP TABLE session;--",cwd),/Invalid/);
 }finally{
  for(const key of ['KICAD_HISTORY_DIR','CLAUDE_CONFIG_DIR','KICAD_HISTORY_DB'])if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];
  await fs.rm(root,{recursive:true,force:true});
 }
});
