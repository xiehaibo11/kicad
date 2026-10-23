import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {settingsInventory} from '../inventory.ts';

const write=async(file,content)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,typeof content==='string'?content:JSON.stringify(content,null,2));};
const skill=(name,body='',extra='')=>`---\nname: ${name}\ndescription: ${name} skill\n${extra}---\n${body}\n`;
async function fixture(){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-inventory-')),home=path.join(base,'home'),cwd=path.join(base,'repo');
  await fs.mkdir(path.join(cwd,'tools'),{recursive:true});await fs.writeFile(path.join(cwd,'tools','hook.sh'),'#!/bin/sh\n');
  await write(path.join(home,'.claude/skills/same/SKILL.md'),skill('same','Shared text.'));
  await write(path.join(cwd,'.claude/skills/same/SKILL.md'),skill('same','Shared text.'));
  await write(path.join(home,'.claude/skills/drift/SKILL.md'),skill('drift','Old body.'));
  await write(path.join(cwd,'.claude/skills/drift/SKILL.md'),skill('drift','New body.'));
  await write(path.join(home,'.claude/skills/old/SKILL.md'),skill('old','Run `./build/bin/kicad-agent health` first.'));
  await write(path.join(home,'.claude/skills/manual/SKILL.md'),skill('manual','x','disable-model-invocation: true\n'));
  await write(path.join(home,'.claude/skills/quiet/SKILL.md'),skill('quiet','x'));
  await write(path.join(home,'.claude/commands/check.md'),'---\ndescription: Old check\n---\nRun `kicad-agent health`.\n');
  await write(path.join(cwd,'.claude/commands/check.md'),'---\ndescription: Check\n---\nUse capability_search.\n');
  await write(path.join(cwd,'.claude/commands/fab/export.md'),'Export fabrication outputs.\n');
  await write(path.join(cwd,'.claude/agents/reviewer.md'),'---\nname: reviewer\ndescription: Reviews\n---\nbody\n');
  await write(path.join(home,'.claude/settings.json'),{enabledPlugins:{'docs@market':true},hooks:{PostToolUse:[{matcher:'Edit',hooks:[{type:'command',command:'./tools/hook.sh'},{type:'command',command:'/missing/hook.sh --flag'}]}]}});
  await write(path.join(cwd,'.claude/settings.local.json'),{permissions:{allow:['Bash(./build/bin/kicad-agent:*)','mcp__kicad__kicad_board','mcp__kicad__capability_search','Bash(git status:*)','Bash(ls -1 '+'x'.repeat(200)+')','mcp__easyeda__easyeda_call'],deny:['Bash(./tools/hook.sh)']}});
  await write(path.join(home,'.claude.json'),{mcpServers:{docs:{command:'npx',args:['docs-server'],env:{API_TOKEN:'secret-value'}},easyeda:{command:'node'}},projects:{[cwd]:{mcpServers:{web:{type:'http',url:'https://example.test/mcp?token=abc123',headers:{Authorization:'Bearer secret-header'}}}}}});
  await write(path.join(cwd,'.mcp.json'),{mcpServers:{pending:{command:'./missing-server'},approved:{command:'node'}}});
  await write(path.join(home,'.claude/settings.json').replace('settings.json','settings.json'),{enabledPlugins:{'docs@market':true},enabledMcpjsonServers:['approved'],hooks:{PostToolUse:[{matcher:'Edit',hooks:[{type:'command',command:'./tools/hook.sh'},{type:'command',command:'/missing/hook.sh --flag'}]}]}});
  await write(path.join(home,'.claude/plugins/known_marketplaces.json'),{market:{installLocation:path.join(home,'.claude/plugins/marketplaces/market'),lastUpdated:'2026-10-21T00:00:00Z'}});
  await write(path.join(home,'.claude/plugins/marketplaces/market/.claude-plugin/marketplace.json'),{plugins:[{name:'docs',description:'Docs',category:'dev'},{name:'lint',description:'Lint'}]});
  return {base,home,cwd};
}
const builtins={tools:['capability_search','capability_call'],agents:[{name:'kicad-reviewer',description:'Reviews'}],hooks:[{event:'PreToolUse',description:'Journal'}]};
const kinds=item=>item.flags.map(flag=>flag.kind).sort();

test('inventory reports skills, commands, hooks, plugins, servers and stale rules from files only',async()=>{
  const {base,home,cwd}=await fixture();
  try{
    const result=await settingsInventory({cwd,home,builtins,disabledSkills:['quiet'],disabledServers:['docs'],skillRoots:[{path:path.join(home,'.claude/skills'),scope:'user'},{path:path.join(cwd,'.claude/skills'),scope:'project'}]});
    const skill=(name,scope)=>result.skills.find(item=>item.name===name&&item.scope===scope);
    assert.deepEqual(kinds(skill('same','user')),['duplicate'],'identical lower-precedence copy');
    assert.deepEqual(kinds(skill('same','project')),[],'the copy in use is not flagged');
    assert.deepEqual(kinds(skill('drift','user')),['conflict']);
    assert.deepEqual(kinds(skill('old','user')),['stale']);
    assert.deepEqual(kinds(skill('manual','user')),['manual']);
    assert.deepEqual(kinds(skill('quiet','user')),['disabled']);
    assert.equal(skill('same','project').root,path.join(cwd,'.claude/skills'));

    const command=(name,scope)=>result.commands.find(item=>item.name===name&&item.scope===scope);
    assert.deepEqual(kinds(command('check','user')),['conflict','stale']);
    assert.equal(command('check','project').description,'Check');
    assert.equal(command('fab:export','project').description,'Export fabrication outputs.','nested commands are namespaced');
    assert.deepEqual(result.agents.map(agent=>agent.scope+':'+agent.name),['builtin:kicad-reviewer','project:reviewer']);

    const hooks=result.hooks.filter(hook=>hook.scope==='user');
    assert.deepEqual(hooks.map(hook=>[hook.event,hook.matcher,kinds(hook)]),[['PostToolUse','Edit',[]],['PostToolUse','Edit',['stale']]]);
    assert.equal(result.hooks.filter(hook=>hook.scope==='builtin').length,1);

    assert.deepEqual(result.plugins.installed,[{id:'docs@market',version:'',path:'',enabled:true,scope:'user'}]);
    assert.deepEqual(result.plugins.marketplaces.map(m=>[m.name,m.available.length]),[['market',2]]);

    const server=(name)=>result.servers.find(item=>item.name===name);
    assert.deepEqual(server('kicad').tools,builtins.tools);
    assert.deepEqual(kinds(server('docs')),['disabled']);
    assert.deepEqual(kinds(server('easyeda')),['ignored']);
    assert.deepEqual(kinds(server('pending')),['manual','stale'],'unapproved .mcp.json server with a missing command');
    assert.deepEqual(kinds(server('approved')),[]);
    assert.equal(server('web').transport,'http');assert.equal(server('web').scope,'local');
    const text=JSON.stringify(result);
    for(const secret of ['secret-value','secret-header','abc123'])assert.ok(!text.includes(secret),'no server secret is returned: '+secret);

    const issues=result.permissions.map(issue=>[issue.scope,issue.list,issue.kind,issue.rule.slice(0,40)]);
    assert.deepEqual(issues,[
      ['local','allow','stale','Bash(./build/bin/kicad-agent:*)'],
      ['local','allow','stale','mcp__kicad__kicad_board'],
      ['local','allow','oneoff','Bash(ls -1 '+'x'.repeat(29)],
      ['local','allow','stale','mcp__easyeda__easyeda_call'],
    ],'current tools, plain commands and existing programs are kept');
  }finally{await fs.rm(base,{recursive:true,force:true});}
});

test('missing configuration yields empty sections instead of errors',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-inventory-empty-'));
  try{
    const result=await settingsInventory({cwd:path.join(base,'repo'),home:path.join(base,'home'),skillRoots:[]});
    assert.deepEqual([result.skills,result.commands,result.agents,result.hooks,result.servers,result.permissions,result.plugins.installed,result.plugins.marketplaces],[[],[],[],[],[],[],[],[]]);
  }finally{await fs.rm(base,{recursive:true,force:true});}
});
