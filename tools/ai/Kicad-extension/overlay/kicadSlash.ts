// Local commands belong to the host, independently of the selected model or CLI.
export const LOCAL_SLASH_COMMANDS = [
  ['model', '模型', '选择当前会话的模型'],
  ['effort', '推理强度', '选择当前模型支持的推理级别'],
  ['permissions', '权限模式', 'Agent、Default、Plan 和最高权限'],
  ['tools', '工具', '按需搜索工具目录；选择后插入草稿'],
  ['skills', '技能', '按需搜索技能元数据；选择后插入草稿'],
  ['mcp', 'MCP', '查看配置和加载方式，不连接服务器'],
  ['status', '状态', '查看当前会话、模型、权限和上下文'],
  ['doctor', '提示词审计', '只读检查提示词模块及引用文件'],
  ['settings', '设置', '打开扩展设置'],
  ['history', '会话历史', '查看当前工作区的会话'],
  ['new', '新建会话', '打开新的对话'],
] as const;
export type LocalSlashAction = typeof LOCAL_SLASH_COMMANDS[number][0];
export interface SlashEntry {
  id:string; label:string; description?:string;
  action?:LocalSlashAction; draft?:string; page?:number;
}
export const localSlashEntries:SlashEntry[]=LOCAL_SLASH_COMMANDS.map(([action,title,description])=>({id:'local:'+action,label:'/'+action,description:title+' · '+description,action}));
export function localSlashAction(text:string):LocalSlashAction|undefined {
  const name=text.trim().toLowerCase().replace(/^\//,'');
  if(name==='doctor prompt-audit')return 'doctor';
  return LOCAL_SLASH_COMMANDS.find(([action])=>name===action)?.[0];
}
export interface SlashCatalogRequest {type:'slash_catalog';kind:'tool'|'skill';query:string;offset?:number}
export interface SlashCatalogResponse {type:'slash_catalog_response';results:{id:string;name:string;description:string}[];nextOffset:number|null;total:number;error?:string}
export interface LocalSlashRequest {type:'local_slash';action:'settings'|'doctor'|'mcp'}
export interface LocalSlashResponse {type:'local_slash_response'}
