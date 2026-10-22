// Reproducible composer overlay for pinned OpenCode, leaving upstream features intact.
import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2], dir=path.dirname(new URL(import.meta.url).pathname);
const marker=path.join(root,'kicad-composer.json');
function patch(file,before,after){const target=path.join(root,file),source=fs.readFileSync(target,'utf8');if(source.split(before).length!==2)throw new Error('Composer anchor missing/ambiguous: '+file+' '+before);fs.writeFileSync(target,source.replace(before,after));}
for(const [source,target] of [
 ['../composer/prediction.ts','packages/opencode/src/kicad-prediction.ts'],
 ['../composer/prediction.ts','packages/tui/src/kicad-prediction.ts'],
 ...['packages/opencode/src/server/routes/instance/httpapi/groups/kicad-composer.ts','packages/opencode/src/server/routes/instance/httpapi/handlers/kicad-composer.ts','packages/tui/src/component/prompt/kicad-composer.tsx','packages/tui/test/kicad-composer.test.tsx'].map(file=>['overlay/'+file,file]),
])fs.copyFileSync(path.join(dir,source),path.join(root,target));
function refreshPrompt() {
  const file=path.join(root,'packages/tui/src/component/prompt/index.tsx');
  let source=fs.readFileSync(file,'utf8');
  source=source.replace(/history:\(\)=> \(sync\.data\.message\[props.sessionID\?\?""\]\?\?\[\]\)\.flatMap/, 'history:()=> (sync.data.message[props.sessionID??""]??[]).filter(message=>message.role==="user"||message.role==="assistant").slice(-8).flatMap');
  source=source.replace('.join("\\n")}]', '.join("\\n").slice(-6000)}]');
  source=source.replace('setStore("prompt",{input:text,parts:[]})','setStore("prompt","input",text)');
  if(!source.includes('name:"kicad.health"')) source=source.replace('title: "Toggle next-message suggestions",', 'title:"KiCad connection status",name:"kicad.health",category:"KiCad",slashName:"kicad-health",run:()=>{dialog.clear();void composer.health(dialog)},\n      },\n      {\n        title: "Toggle next-message suggestions",');
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
  const metadata=JSON.parse(fs.readFileSync(marker,'utf8'));metadata.revision=5;metadata.features=[...new Set([...(metadata.features??[]),"native-tool-references","in-process-health"])];fs.writeFileSync(marker,JSON.stringify(metadata));
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
patch(prompt,'        title: "Skills",',`        title: "Toggle next-message suggestions",name:"kicad.suggestions",category:"KiCad",slashName:"suggestions",run:()=>{dialog.clear();composer.toggle()},
      },
      {
        title: "Suggest a next message (current model)",name:"kicad.suggest",category:"KiCad",slashName:"suggest",run:()=>{dialog.clear();void composer.generate()},
      },
      {
        title: "Optimize prompt (current model, not sent)",name:"kicad.optimize",category:"KiCad",run:()=>{dialog.clear();void composer.optimize()},
      },
      {
        title: "Undo prompt optimization",name:"kicad.undo",category:"KiCad",run:()=>{dialog.clear();composer.undo()},
      },
      {
        title: "Cancel prompt optimization",name:"kicad.cancel",category:"KiCad",run:()=>{dialog.clear();composer.cancel()},
      },
      {
        title: "Tool reference (insert into draft)",name:"kicad.tools",category:"KiCad",slashName:"tools",
        run:()=>dialog.replace(()=> <KiCadToolDialog load={composer.tools} insert={text=>insertKiCadToolReference(input,text,value=>setStore("prompt","input",value))}/>),
      },
      {
        title: "Skills",`);
patch(prompt,'              placeholder={placeholderText()}','              placeholder={composer.suggestion() || placeholderText()}');
patch(prompt,'    if (!store.prompt.input) return false','    if (composer.optimizing()) return false\n    if (!store.prompt.input) return false');
patch(prompt,'            <textarea',`            <Show when={composer.notice()}><text fg={theme.textMuted}>{composer.notice()}</text></Show>
            <textarea`);
refreshPrompt();
fs.writeFileSync(marker,JSON.stringify({revision:5,features:['editable-next-message-suggestion','current-model-optimization','native-and-mcp-tool-references','in-process-health']}));
console.log('Applied KiCad composer overlay.');
