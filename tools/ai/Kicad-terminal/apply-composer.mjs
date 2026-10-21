// Reproducible composer overlay for pinned OpenCode, leaving upstream features intact.
import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2], dir=path.dirname(new URL(import.meta.url).pathname);
const marker=path.join(root,'kicad-composer.json');
function patch(file,before,after){const target=path.join(root,file),source=fs.readFileSync(target,'utf8');if(source.split(before).length!==2)throw new Error('Composer anchor missing/ambiguous: '+file+' '+before);fs.writeFileSync(target,source.replace(before,after));}
for(const [source,target] of [
 ['../composer/prediction.ts','packages/opencode/src/kicad-prediction.ts'],
 ['../composer/prediction.ts','packages/tui/src/kicad-prediction.ts'],
 ['overlay/composer-group.ts','packages/opencode/src/server/routes/instance/httpapi/groups/kicad-composer.ts'],
 ['overlay/composer-handlers.ts','packages/opencode/src/server/routes/instance/httpapi/handlers/kicad-composer.ts'],
 ['overlay/composer.tsx','packages/tui/src/component/prompt/kicad-composer.tsx'],
])fs.copyFileSync(path.join(dir,source),path.join(root,target));
fs.copyFileSync(path.join(dir,'overlay/composer.test.tsx'),path.join(root,'packages/tui/test/kicad-composer.test.tsx'));
function refreshPrompt() {
  const file=path.join(root,'packages/tui/src/component/prompt/index.tsx');
  let source=fs.readFileSync(file,'utf8');
  source=source.replace(/history:\(\)=> \(sync\.data\.message\[props.sessionID\?\?""\]\?\?\[\]\)\.flatMap/, 'history:()=> (sync.data.message[props.sessionID??""]??[]).filter(message=>message.role==="user"||message.role==="assistant").slice(-8).flatMap');
  source=source.replace('.join("\\n")}]', '.join("\\n").slice(-6000)}]');
  source=source.replace('setStore("prompt",{input:text,parts:[]})','setStore("prompt","input",text)');
  if(!source.includes('name:"kicad.health"')) source=source.replace('title: "下一句建议：开启 / 关闭",', 'title:"KiCad 连接状态",name:"kicad.health",category:"KiCad",slashName:"kicad-health",run:()=>{dialog.clear();void composer.health(dialog)},\n      },\n      {\n        title: "下一句建议：开启 / 关闭",');
  fs.writeFileSync(file,source);
}
if(fs.existsSync(marker)) {
  const file='packages/tui/src/component/prompt/index.tsx';
  const source=fs.readFileSync(path.join(root,file),'utf8');
  const oldInsert='insert={text=>{const value=store.prompt.input+(store.prompt.input?"\\n":"")+text;input.insertText((store.prompt.input?"\\n":"")+text);setStore("prompt","input",value);input.gotoBufferEnd()}}';
  if(source.includes(oldInsert)) {
    patch(file,oldInsert,'insert={text=>insertKiCadToolReference(input,text,value=>setStore("prompt","input",value))}');
    patch(file,'useKiCadComposer,KiCadToolDialog,useKiCadPredictionKeys}', 'useKiCadComposer,KiCadToolDialog,useKiCadPredictionKeys,insertKiCadToolReference}');
  }
  // Upgrade an existing overlay to the same minimal composer as a clean build.
  let updated=fs.readFileSync(path.join(root,file),'utf8');
  updated=updated.replace('    if (composer.accept()) return true\n','');
  updated=updated.replace('            <Show when={composer.suggestion()}><text fg={theme.textMuted}>下一句建议 · Tab 接受，编辑后手动发送 · Esc 忽略</text></Show>\n','');
  fs.writeFileSync(path.join(root,file),updated);
  const metadata=JSON.parse(fs.readFileSync(marker,'utf8'));metadata.revision=4;fs.writeFileSync(marker,JSON.stringify(metadata));
  refreshPrompt();
  console.log('Composer source files refreshed; structural overlay already applied');process.exit(0);
}
patch('packages/opencode/src/server/routes/instance/httpapi/api.ts','import { McpApi }','import { KiCadComposerApi } from "./groups/kicad-composer"\nimport { McpApi }');
patch('packages/opencode/src/server/routes/instance/httpapi/api.ts','  .addHttpApi(McpApi)','  .addHttpApi(McpApi)\n  .addHttpApi(KiCadComposerApi)');
patch('packages/opencode/src/server/routes/instance/httpapi/server.ts','import { mcpHandlers }','import { kicadComposerHandlers } from "./handlers/kicad-composer"\nimport { mcpHandlers }');
patch('packages/opencode/src/server/routes/instance/httpapi/server.ts','    mcpHandlers,','    mcpHandlers,\n    kicadComposerHandlers,');
patch('packages/tui/src/context/sdk.tsx','      fetch: props.fetch ?? fetch,','      headers: props.headers,\n      fetch: props.fetch ?? fetch,');
const prompt='packages/tui/src/component/prompt/index.tsx';
patch(prompt,'registerOpencodeSpinner()','import {useKiCadComposer,KiCadToolDialog,useKiCadPredictionKeys,insertKiCadToolReference} from "./kicad-composer"\n\nregisterOpencodeSpinner()');
patch(prompt,'  const promptCommands = createMemo(() =>',`  const composer = useKiCadComposer({
    model:()=>{const model=local.model.current();return model ? model.providerID+"/"+model.modelID : undefined},
    session:()=>props.sessionID,busy:()=>status().type!=="idle",draft:()=>store.prompt.input,
    blocked:()=>!!props.disabled || store.mode!=="normal" || store.prompt.parts.length>0 || dialog.stack.length>0,
    enabled:()=>kv.get("kicad_draft_suggestions",true),setEnabled:value=>kv.set("kicad_draft_suggestions",value),
    history:()=> (sync.data.message[props.sessionID??""]??[]).flatMap(message=>message.role==="user"||message.role==="assistant" ? [{role:message.role,text:(sync.data.part[message.id]??[]).flatMap(part=>part.type==="text"?[part.text]:[]).join("\\n")}] : []),
    setDraft:text=>{input.setText(text);setStore("prompt",{input:text,parts:[]});input.gotoBufferEnd()},
  })
  useKiCadPredictionKeys(composer,inputTarget,()=>!!props.disabled,()=>!!auto()?.visible)
  const promptCommands = createMemo(() =>`);
patch(prompt,'        title: "Skills",',`        title: "下一句建议：开启 / 关闭",name:"kicad.suggestions",category:"KiCad",slashName:"suggestions",run:()=>{dialog.clear();composer.toggle()},
      },
      {
        title: "生成下一句建议（当前模型）",name:"kicad.suggest",category:"KiCad",slashName:"suggest",run:()=>{dialog.clear();void composer.generate()},
      },
      {
        title: "优化提示词（当前模型，不发送）",name:"kicad.optimize",category:"KiCad",run:()=>{dialog.clear();void composer.optimize()},
      },
      {
        title: "撤销提示词优化",name:"kicad.undo",category:"KiCad",run:()=>{dialog.clear();composer.undo()},
      },
      {
        title: "取消提示词优化",name:"kicad.cancel",category:"KiCad",run:()=>{dialog.clear();composer.cancel()},
      },
      {
        title: "工具参考（只插入草稿）",name:"kicad.tools",category:"KiCad",slashName:"tools",
        run:()=>dialog.replace(()=> <KiCadToolDialog load={composer.tools} insert={text=>insertKiCadToolReference(input,text,value=>setStore("prompt","input",value))}/>),
      },
      {
        title: "Skills",`);
patch(prompt,'              placeholder={placeholderText()}','              placeholder={composer.suggestion() || placeholderText()}');
patch(prompt,'    if (!store.prompt.input) return false','    if (composer.optimizing()) return false\n    if (!store.prompt.input) return false');
patch(prompt,'            <textarea',`            <Show when={composer.notice()}><text fg={theme.textMuted}>{composer.notice()}</text></Show>
            <textarea`);
refreshPrompt();
fs.writeFileSync(marker,JSON.stringify({revision:4,features:['editable-next-message-suggestion','current-model-optimization','real-mcp-tool-references']}));
console.log('Applied KiCad composer overlay.');
