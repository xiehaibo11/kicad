import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2];
function replace(file,before,after){const target=path.join(root,file),source=fs.readFileSync(target,'utf8');if(source.includes(after))return;if(source.split(before).length!==2)throw Error('Demand anchor missing: '+file);fs.writeFileSync(target,source.replace(before,after));}
const system='packages/opencode/src/session/system.ts',file=path.join(root,system),source=fs.readFileSync(file,'utf8');
const start=source.indexOf('      skills: Effect.fn("SystemPrompt.skills")'),end=source.indexOf('      mcp: Effect.fn',start);
if(start<0||end<0)throw Error('Skill discovery anchor missing');
fs.writeFileSync(file,source.slice(0,start)+`      skills: Effect.fn("SystemPrompt.skills")(function* (_agent: Agent.Info) {
        return "Skills are loaded on demand. Search relevant skills using capability_search, then capability_call to read one selected skill."
      }),

`+source.slice(end));
replace('packages/opencode/src/session/tools.ts','    if (KicadLazy.isDeferred(item.id) && !KicadLazy.active(input.messages)) continue','    if (item.id === "skill" || KicadLazy.isDeferred(item.id)) continue // shared capability discovery only');
replace('packages/opencode/src/session/prompt.ts','            if (KicadLazy.active(msgs)) system.push(KicadLazy.GUIDE)','            // Detailed capability guidance is returned only when requested.');
// Agent setup, slash-command completion and the TUI /skill request otherwise
// discover/read every SKILL.md before any capability is selected. The shared
// catalog owns discovery and loading; the native compatibility catalog stays empty.
replace('packages/opencode/src/skill/index.ts',`    const all = Effect.fn("Skill.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.skills)
    })`,`    const all = Effect.fn("Skill.all")(function* () {
      return [] as Info[] // shared capability discovery only
    })`);
replace('packages/opencode/src/skill/index.ts',`      return (yield* InstanceState.get(discovered)).dirs`,`      return [] as string[] // no eager discovery during Agent setup`);
