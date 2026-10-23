import fs from 'node:fs';
import path from 'node:path';
import {promptSections,type PromptContext} from './prompt-sections.ts';
// A deterministic, read-only audit; findings are review hints, never new instructions.
export function promptAudit(cwd:string,context:PromptContext={}){
  const sections=promptSections({...context,cwd});
  const files=['AGENTS.md','CLAUDE.md','.claude/CLAUDE.md'].map(file=>path.join(cwd,file)).filter(file=>fs.existsSync(file));
  const findings:{source:string;line:number;code:string;message:string}[]=[];
  for(const source of files){
    const stat=fs.statSync(source);
    if(!stat.isFile()||stat.size>512*1024){findings.push({source,line:1,code:'size',message:'Skipped: instruction file exceeds 512 KiB or is not a regular file.'});continue;}
    const text=fs.readFileSync(source,'utf8'),lines=text.split('\n');
    if(text.length>20000)findings.push({source,line:1,code:'length',message:'Long instruction file; consider focused components.'});
    lines.forEach((line,index)=>{
      if(/(?:only (?:use|supports?) (?:claude|gpt|deepseek)|仅(?:支持|允许).*(?:Claude|GPT|DeepSeek))/i.test(line))findings.push({source,line:index+1,code:'model-constraint',message:'Possible model-specific instruction; review for portability.'});
      for(const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){
        const ref=match[1].split('#')[0];if(!ref||/^(?:[\w+.-]+:|\/|~)/.test(ref))continue;
        let target:string;try{target=path.resolve(path.dirname(source),decodeURIComponent(ref));}catch{continue;}
        if(!fs.existsSync(target))findings.push({source,line:index+1,code:'missing-reference',message:'Local reference does not exist: '+ref});
      }
    });
  }
  return {readOnly:true,scope:'Composed system sections and root project instruction files; does not load skill bodies, MCP servers or models.',
    sections:sections.map(s=>({name:s.name,characters:s.text.length})),files,findings,
    limits:'Static checks identify possible stale references and portability issues; semantic conflicts and arbitrary shell instructions require review.'};
}
