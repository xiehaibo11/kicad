import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2];
function patch(file,before,after){const target=path.join(root,file),source=fs.readFileSync(target,'utf8');if(source.split(before).length!==2)throw Error('Terminal settings anchor missing/ambiguous: '+file+' '+before.slice(0,80));fs.writeFileSync(target,source.replace(before,()=>after));}
const here=path.dirname(new URL(import.meta.url).pathname);
fs.copyFileSync(path.join(here,'../composer/settings.ts'),path.join(root,'packages/core/src/kicad/settings.ts'));
const session='packages/tui/src/routes/session/index.tsx';
patch(session,'import path from "node:path"','import path from "node:path"\nimport {readSettings} from "@opencode-ai/core/kicad/settings"');
patch(session,'function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {\n  const ctx = use()',`function TextPart(props: { last: boolean; part: TextPart; message: AssistantMessage }) {
  const ctx = use()
  const paths = useTuiPaths()
  const setting = readSettings(paths.cwd).settings.maxProseWidth
  const override = Number(process.env.KICAD_MAX_PROSE_WIDTH)
  const proseWidth = Number.isInteger(override) && override >= 0 ? override : setting`);
patch(session,'<box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={3} marginTop={1} flexShrink={0}>\n        <markdown','<box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={3} marginTop={1} flexShrink={0} maxWidth={proseWidth > 0 ? proseWidth + 3 : undefined}>\n        <markdown');
const prompt='packages/tui/src/component/prompt/index.tsx';
patch(prompt,'import {useKiCadComposer,','import {readSettings} from "@opencode-ai/core/kicad/settings"\nimport {useKiCadComposer,');
patch(prompt,'enabled:()=>kv.get("kicad_draft_suggestions",true),','enabled:()=>readSettings(paths.cwd).settings.autoModeSuggestions&&kv.get("kicad_draft_suggestions",true),');
const composer='packages/opencode/src/server/routes/instance/httpapi/handlers/kicad-composer.ts';
patch(composer,'import { Effect }','import {readSettings} from "@opencode-ai/core/kicad/settings";\nimport { Effect }');
patch(composer,'    const parsed = Provider.parseModel(payload.model);',`    const context = yield* InstanceState.context;
    if(payload.mode==='predict'&&!readSettings(context.directory).settings.autoModeSuggestions)return {text:'',model:payload.model};
    const parsed = Provider.parseModel(payload.model);`);
const web='packages/opencode/src/tool/webfetch.ts';
patch(web,'const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds','const DEFAULT_TIMEOUT = 300 * 1000 // five-minute download deadline');
patch(web,'const MAX_TIMEOUT = 120 * 1000 // 2 minutes','const MAX_TIMEOUT = 300 * 1000 // includes the response body');
patch(web,'Optional timeout in seconds (max 120)','Optional timeout in seconds (max 300)');
patch(web,'          // Build Accept header based on requested format with q parameters for fallbacks','          const deadline = Date.now() + timeout\n          // Build Accept header based on requested format with q parameters for fallbacks');
patch(web,'          const arrayBuffer = yield* response.arrayBuffer',`          const arrayBuffer = yield* response.arrayBuffer.pipe(
            Effect.timeoutOrElse({duration:Math.max(1,deadline-Date.now()),orElse:()=>Effect.die(new Error("WebFetch body exceeded its deadline"))}),
          )`);
// v1.19.3's app imports the promise client through a subpath omitted from its
// package exports. It is the existing generated promise implementation, not a
// replacement client. Keep the embedded Web UI in the distributable.
const clientPackage=path.join(root,'packages/client/package.json');
const client=JSON.parse(fs.readFileSync(clientPackage,'utf8'));
if(client.exports['.']!=='./src/index.ts'||client.exports['./promise'])throw Error('Unexpected upstream client exports');
client.exports['./promise']=client.exports['.'];
fs.writeFileSync(clientPackage,JSON.stringify(client,null,2)+'\n');
