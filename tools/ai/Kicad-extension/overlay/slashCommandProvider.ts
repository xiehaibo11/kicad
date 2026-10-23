import {localSlashEntries,type SlashEntry} from '../../../shared/kicadSlash';
import {transport} from '../core/runtimeTransport';
import type {RuntimeInstance} from '../composables/useRuntime';
import type {DropdownItemType} from '../types/dropdown';

let pageQuery='',offset=0;
export function setSlashPage(query:string,page:number){pageQuery=query;offset=page;}
/** Opening / is synchronous and never depends on Claude discovery or authentication. */
export function getSlashCommands(query:string,_runtime?:RuntimeInstance,signal?:AbortSignal):SlashEntry[]|Promise<SlashEntry[]> {
  const filter=query.trim().toLowerCase();
  const browse=/^(tool|skill):(.*)$/i.exec(query);
  if(!browse){pageQuery='';offset=0;return localSlashEntries.filter(cmd=>(cmd.label+' '+cmd.description).toLowerCase().includes(filter));}
  if(pageQuery!==query){pageQuery=query;offset=0;}
  const currentOffset=offset;
  return transport.slashCatalog(browse[1].toLowerCase() as 'tool'|'skill',browse[2],currentOffset,signal).then(result=>{
    const entries:SlashEntry[]=result.results.map(item=>({id:item.id,label:item.name,description:item.description,
      draft:`Use the ${browse[1].toLowerCase()} ${JSON.stringify(item.name)} (capability id ${JSON.stringify(item.id)}) for this task: `}));
    if(currentOffset>0)entries.unshift({id:'previous',label:'← 上一页',description:'只浏览目录，不执行工具',page:Math.max(0,currentOffset-10)});
    if(result.nextOffset!==null)entries.push({id:'next',label:'下一页 →',description:'继续浏览；也可输入名称筛选',page:result.nextOffset});
    if(!entries.length)entries.push({id:'empty',label:result.error||'没有匹配项',description:'可检查技能开关、目录配置或继续输入名称',page:0});
    return entries;
  }).catch(error=>{if(signal?.aborted)throw error;return [{id:'catalog-error',label:'目录暂不可用',description:error instanceof Error?error.message:String(error),page:0}];});
}
export function getSlashCommandsWithSection(query:string,_runtime?:RuntimeInstance){return localSlashEntries.filter(cmd=>(cmd.label+' '+cmd.description).toLowerCase().includes(query.toLowerCase())).map(cmd=>({...cmd,section:'Slash Commands'}));}
export function commandToDropdownItem(command:SlashEntry):DropdownItemType{return {id:command.id,label:command.label,detail:command.description,icon:command.draft?'codicon-symbol-method':'codicon-terminal',type:'command',data:{commandId:command.id,command}};}
export function getCommandIcon(){return 'codicon-terminal';}
