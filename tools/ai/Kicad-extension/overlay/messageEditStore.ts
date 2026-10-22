import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {randomUUID} from 'crypto';
import {applyMessageRevisions,type MessageRevision} from '../../shared/messageRevisions';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pending=new Map<string,Promise<void>>();
function editFile(sessionId:string):string {
  if(!uuid.test(sessionId))throw new Error('无效的会话标识。');
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(),'.claude'),'kicad-message-edits',sessionId+'.json');
}
async function read(file:string):Promise<MessageRevision[]> {
  try {
    const data=JSON.parse(await fs.readFile(file,'utf8'));
    if(!Array.isArray(data) || data.some(r=>!uuid.test(r?.originalId) || !uuid.test(r?.replacementId)))throw new Error('消息修改记录格式错误。');
    return data;
  } catch(error) {
    if((error as NodeJS.ErrnoException).code==='ENOENT')return [];
    throw error;
  }
}
export async function recordMessageEdit(sessionId:string,revision:MessageRevision):Promise<void> {
  if(!uuid.test(revision.originalId) || !uuid.test(revision.replacementId) || revision.originalId===revision.replacementId)throw new Error('无效的消息标识。');
  const file=editFile(sessionId);
  const operation=(pending.get(file) || Promise.resolve()).catch(()=>{}).then(async()=>{
    const revisions=await read(file);
    if(revisions.some(r=>r.originalId===revision.originalId && r.replacementId===revision.replacementId))return;
    revisions.push(revision);
    await fs.mkdir(path.dirname(file),{recursive:true});
    const temporary=file+'.'+randomUUID()+'.tmp';
    try {await fs.writeFile(temporary,JSON.stringify(revisions),{mode:0o600});await fs.rename(temporary,file);}
    finally {await fs.rm(temporary,{force:true});}
  });
  pending.set(file,operation);
  try {await operation;}finally{if(pending.get(file)===operation)pending.delete(file);}
}
export async function revisedSessionMessages(sessionId:string,messages:any[]):Promise<any[]> {
  // File-path session imports do not have a Kicad revision index.
  if(!uuid.test(sessionId))return messages;
  return applyMessageRevisions(messages,await read(editFile(sessionId)));
}
