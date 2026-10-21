// Presentation-only waiting state, kept separate from upstream execution and tools.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=process.argv[2];
if(!root) throw new Error('usage: node apply-waiting.mjs <opencode-source-directory>');
const dir=path.dirname(fileURLToPath(import.meta.url));
fs.copyFileSync(path.join(dir,'overlay/waiting.tsx'),path.join(root,'packages/tui/src/component/kicad-waiting.tsx'));
fs.copyFileSync(path.join(dir,'overlay/waiting.test.tsx'),path.join(root,'packages/tui/test/kicad-waiting.test.tsx'));
const target=path.join(root,'packages/tui/src/component/prompt/index.tsx');
let source=fs.readFileSync(target,'utf8');
if(source.includes('const spinnerDef = createMemo')) {
  const anchor='import { createColors, createFrames } from "../../ui/spinner"';
  if(source.split(anchor).length!==2) throw new Error('Missing/ambiguous waiting import anchor');
  source=source.replace(anchor+'\n','');
  const definition=/  const spinnerDef = createMemo\(\(\) => \{[\s\S]*?\n  \}\)\n/;
  if(!definition.test(source)) throw new Error('Missing waiting scanner definition');
  source=source.replace(definition,'');
  const scanner=`                    <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
                      <spinner color={spinnerDef().color} frames={spinnerDef().frames} interval={40} />
                    </Show>`;
  if(source.split(scanner).length!==2) throw new Error('Missing/ambiguous waiting scanner anchor');
  source=source.replace(scanner,'');
}
// Also upgrade source trees with revision 1, which placed the badge in the toolbar.
source=source.replace('import { KiCadWaitingIndicator } from "../kicad-waiting"\n','');
source=source.replace('                    <KiCadWaitingIndicator animated={kv.get("animations_enabled", true)} compact={status().type === "retry"} color={theme.textMuted} />','');
source=source.replace('                  <box marginLeft={1}>\n\n                  </box>\n','');
if(source.includes('spinnerDef') || source.includes('KiCadWaitingIndicator')) throw new Error('Unexpected toolbar waiting indicator remains');
fs.writeFileSync(target,source);

const sessionTarget=path.join(root,'packages/tui/src/routes/session/index.tsx');
let session=fs.readFileSync(sessionTarget,'utf8');
if(!session.includes('<KiCadWaitingIndicator ')) {
  const importAnchor='import { Spinner } from "../../component/spinner"';
  if(session.split(importAnchor).length!==2) throw new Error('Missing/ambiguous transcript import anchor');
  session=session.replace(importAnchor,importAnchor+'\nimport { KiCadWaitingIndicator } from "../../component/kicad-waiting"');
  const transcriptAnchor='                </For>\n              </scrollbox>';
  if(session.split(transcriptAnchor).length!==2) throw new Error('Missing/ambiguous transcript waiting anchor');
  session=session.replace(transcriptAnchor,`                </For>
                <Show when={(sync.data.session_status[route.sessionID]?.type ?? "idle") !== "idle"}>
                  <box ref={(el: BoxRenderable) => alwaysSeparate.add(el)} paddingLeft={3} marginTop={1} flexShrink={0}>
                    <KiCadWaitingIndicator animated={kv.get("animations_enabled", true)} color={theme.textMuted} />
                  </box>
                </Show>
              </scrollbox>`);
  const start=session.indexOf('function AssistantMessage(');
  const end=session.indexOf('\nconst PART_MAPPING =',start);
  if(start<0 || end<0) throw new Error('Missing assistant message component');
  let assistant=session.slice(start,end);
  const setup=/  const ctx = use\(\)\n  const local = useLocal\(\)\n([\s\S]*?)  const messages = createMemo\([\s\S]*?(?=  const childShortcut =)/;
  if(!setup.test(assistant)) throw new Error('Missing assistant metadata setup');
  assistant=assistant.replace(setup,'$1');
  const metadata=/      <Switch>\n        <Match when=\{props\.last \|\| final\(\)[\s\S]*?      <\/Switch>\n/;
  if(!metadata.test(assistant)) throw new Error('Missing assistant metadata row');
  assistant=assistant.replace(metadata,'');
  session=session.slice(0,start)+assistant+session.slice(end);
  fs.writeFileSync(sessionTarget,session);
}
fs.writeFileSync(path.join(root,'kicad-waiting.json'),JSON.stringify({revision:2,features:['kicad-badge','extension-waiting-text','waiting-in-transcript','assistant-metadata-row-removed','no-toolbar-waiting-duplicate','respects-animations-setting','upstream-interrupt-and-retry-retained']},null,2)+'\n');
console.log('Applied Kicad waiting indicator in transcript; removed assistant metadata row and toolbar duplicate; interrupt/retry retained.');
