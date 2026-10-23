import fs from 'node:fs';
import path from 'node:path';
export function applySlashMenu(root,overlay){
  const read=file=>fs.readFileSync(path.join(root,file),'utf8');
  function patch(file,before,after){const source=read(file);if(source.split(before).length!==2)throw Error('Slash menu anchor missing/ambiguous: '+file+' '+before.slice(0,80));fs.writeFileSync(path.join(root,file),source.replace(before,()=>after));}
  for(const [source,target] of [['kicadSlash.ts','src/shared/kicadSlash.ts'],['kicadSlashHost.ts','src/kicadSlashHost.ts'],['slashCommandProvider.ts','src/webview/src/providers/slashCommandProvider.ts']])fs.copyFileSync(path.join(overlay,source),path.join(root,target));
  const messages='src/shared/messages.ts';
  patch(messages,'export type WebViewRequest =',"import type {SlashCatalogRequest,SlashCatalogResponse,LocalSlashRequest,LocalSlashResponse} from './kicadSlash';\nexport type WebViewRequest =\n    | SlashCatalogRequest\n    | LocalSlashRequest");
  patch(messages,'export type WebViewRequestResponse =','export type WebViewRequestResponse =\n    | SlashCatalogResponse\n    | LocalSlashResponse');
  const transport='src/webview/src/transport/BaseTransport.ts';
  patch(transport,'  sdkProbe(capabilities:',`  slashCatalog(kind:'tool'|'skill',query:string,offset:number,signal?:AbortSignal):Promise<import('../../../shared/kicadSlash').SlashCatalogResponse>{
    return this.sendRequest({type:'slash_catalog',kind,query,offset},undefined,signal);
  }
  localSlash(action:'settings'|'doctor'|'mcp'):Promise<import('../../../shared/kicadSlash').LocalSlashResponse>{return this.sendRequest({type:'local_slash',action});}
  sdkProbe(capabilities:`);
  const agent='src/services/claude/ClaudeAgentService.ts';
  patch(agent,'            case "tool_references":',`            case 'slash_catalog':
                return (await import('../../kicadSlashHost')).slashCatalog(request,this.handlerContext.workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath||process.cwd(),signal);
            case 'local_slash':
                return (await import('../../kicadSlashHost')).localSlash(request,this.handlerContext.workspaceService.getDefaultWorkspaceFolder()?.uri.fsPath||process.cwd(),(await this.handlerContext.configService.getAllSettings()).mcpServers||{});
            case "tool_references":`);
  // The host owns the slash menu. Do not start a Claude process just to list it.
  const handlers='src/services/claude/handlers/handlers.ts';
  patch(handlers,"sdkService.probe({cwd,capabilities:['supportedCommands']}),","Promise.resolve({data:{supportedCommands:[]}}),");

  for(const file of ['ModelSelect.vue','ReasoningSelect.vue','ModeSelect.vue']){
    const target='src/webview/src/components/'+file;
    if(file==='ModelSelect.vue')patch(target,"let disposed=false,probed=false;","defineExpose({open:()=>{if(!props.disabled)dropdown.value?.open();}});\nlet disposed=false,probed=false;");
    else {
      patch(target,'<DropdownTrigger','<DropdownTrigger ref="dropdown"');
      if(file==='ModeSelect.vue')patch(target,"import { computed } from 'vue'","import { computed,ref } from 'vue'");
      const anchor=file==='ModeSelect.vue'?'const props =':'const props=';
      patch(target,anchor,"const dropdown=ref<any>();\ndefineExpose({open:()=>{if(!props.disabled)dropdown.value?.open();}});\n"+anchor);
    }
  }
  const buttons='src/webview/src/components/ButtonArea.vue';
  for(const [component,ref] of [['ModeSelect','permissionsMenu'],['ModelSelect','modelMenu'],['ReasoningSelect','effortMenu']])patch(buttons,'<'+component,'<'+component+' ref="'+ref+'"');
  patch(buttons,"const emit = defineEmits<Emits>()",`const emit = defineEmits<Emits>()
const permissionsMenu=ref<any>(),modelMenu=ref<any>(),effortMenu=ref<any>();
defineExpose({openMenu:(name:'model'|'effort'|'permissions')=>({model:modelMenu,effort:effortMenu,permissions:permissionsMenu}[name]?.value?.open())});`);
  const input='src/webview/src/components/ChatInputBox.vue';
  patch(input,'<ButtonArea','<ButtonArea ref="buttonArea"');
  patch(input,"import ButtonArea from './ButtonArea.vue'",`import ButtonArea from './ButtonArea.vue'
import {localSlashAction,type LocalSlashAction} from '../../../shared/kicadSlash'
import {setSlashPage} from '../providers/slashCommandProvider'`);
  patch(input,"  (e: 'modelSelect', modelId: string): void","  (e: 'modelSelect', modelId: string): void\n  (e: 'localCommand', action:LocalSlashAction):void");
  const source=read(input),start=source.indexOf('  onSelect: (command, query) => {'),end=source.indexOf('  anchorElement: textareaRef',start);
  if(start<0||end<0)throw Error('Slash selection anchor missing');
  patch(input,source.slice(start,end),`  onSelect: (command, query) => {
    if(command.page!==undefined){setSlashPage(query?.query||'',command.page);void nextTick(()=>slashCompletion.evaluateQuery(content.value,content.value.length));return;}
    if(command.action && /^\\/[^\\s]*$/.test(content.value.trim())){runLocalCommand(command.action);return;}
    updateSlashDraft(slashCompletion.replaceText(content.value,command.draft ?? command.label+' '));
  },
`);
  patch(input,'// @ 文件引用补全',`const buttonArea=ref<any>();
function updateSlashDraft(text:string){
  content.value=text;
  if(textareaRef.value){textareaRef.value.textContent=text;placeCaretAtEnd(textareaRef.value);}
  emit('input',text);autoResizeTextarea();
}
function runLocalCommand(action:LocalSlashAction){
  if(action==='tools'||action==='skills'){
    updateSlashDraft(action==='tools'?'/tool:':'/skill:');
    void nextTick(()=>slashCompletion.evaluateQuery(content.value,content.value.length));return;
  }
  updateSlashDraft('');
  if(['model','effort','permissions'].includes(action))void nextTick(()=>buttonArea.value?.openMenu(action));
  else emit('localCommand',action);
}
// @ 文件引用补全`);
  patch(input,'  // 优先处理补全菜单的键盘事件','  if(event.isComposing)return;\n  // 优先处理补全菜单的键盘事件');
  patch(input,'  if (slashCompletion.isOpen.value) {\n    slashCompletion.handleKeydown(event)',"  if (slashCompletion.isOpen.value && (slashCompletion.loading.value || slashCompletion.items.value.length)) {\n    if(['Enter','ArrowDown','ArrowUp','Escape'].includes(event.key))event.stopPropagation();\n    if(event.key==='Enter')event.preventDefault();\n    slashCompletion.handleKeydown(event)");
  patch('src/webview/src/types/completion.ts','export interface CompletionDropdown {','export interface CompletionDropdown {\n  loading: Ref<boolean>');
  patch('src/webview/src/composables/useCompletionDropdown.ts','    // @ts-expect-error: 额外暴露状态，向后兼容\n','');
  patch('src/webview/src/composables/useKeyboardNavigation.ts','    onSelect(activeIndex.value)','    onSelect(Math.max(0,activeIndex.value))');
  patch('src/webview/src/composables/useCompletionDropdown.ts','      loadItemsDebounced(foundQuery.query)',`      if(trigger==='/'){
        currentAbortController?.abort();currentAbortController=new AbortController();
        rawItems.value=[];
        void loadItems(foundQuery.query,currentAbortController.signal);
      }else loadItemsDebounced(foundQuery.query)`);
  patch(input,'  if (props.conversationWorking) {\n    // 对话工作中，添加到队列',`  const local=localSlashAction(content.value);
  if(content.value.trim().startsWith('/')&&local){runLocalCommand(local);return;}
  if (props.conversationWorking) {
    // 对话工作中，添加到队列`);
  const page='src/webview/src/pages/ChatPage.vue';
  patch(page,'            @submit="handleSubmit"','            @submit="handleSubmit"\n            @local-command="handleLocalCommand"');
  patch(page,"  import ChatInputBox from '../components/ChatInputBox.vue';",`  import ChatInputBox from '../components/ChatInputBox.vue';
  import type {LocalSlashAction} from '../../../shared/kicadSlash';
  import {transport} from '../core/runtimeTransport';`);
  patch(page,'  const runtime = inject(RuntimeKey);',"  const emit=defineEmits<{(event:'switchToSessions'):void}>();\n  const runtime = inject(RuntimeKey);");
  patch(page,'  // ChatInput 事件处理',`  async function handleLocalCommand(action:LocalSlashAction){
    try{
      if(action==='new'){await createNew();return;}
      if(action==='history'){emit('switchToSessions');return;}
      if(action==='status'){
        const current=session.value;
        const report={sessionId:current?.sessionId.value,model:current?.modelSelection.value,effort:current?.thinkingLevel.value,permissionMode:current?.permissionMode.value,busy:isBusy.value,context:contextTooltip.value};
        await transport.openContent(JSON.stringify(report,null,2),'KiCad session status.json',false);return;
      }
      if(action==='mcp'||action==='settings'||action==='doctor')await transport.localSlash(action);
    }catch(error){reasoningError.value=error instanceof Error?error.message:String(error);}
  }
  // ChatInput 事件处理`);
}
