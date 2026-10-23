import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeLimits,resultLimitForContext,searchPageForContext,reportedContextWindow,DEFAULT_CONTEXT_WINDOW} from '../model-profile.ts';
import {PROMPT_VERSION,promptSections,renderPromptSections,clearPromptCache,promptManifest} from '../prompt-sections.ts';

const MODELS=['claude-opus-5-5','deepseek-v4-pro','codex:gpt-6.1-sol','qwen-max','gemini-2.5-pro','ollama/llama3','unknown',undefined];

test('budgets depend only on the reported context window',()=>{
  assert.equal(runtimeLimits().contextWindow,DEFAULT_CONTEXT_WINDOW);
  assert.deepEqual(runtimeLimits(1000000),{contextWindow:1000000,resultChars:50000,searchPage:5});
  assert.deepEqual(runtimeLimits(128000),{contextWindow:128000,resultChars:30000,searchPage:5});
  assert.deepEqual(runtimeLimits(32000),{contextWindow:32000,resultChars:12000,searchPage:3});
  assert.equal(resultLimitForContext(Number.NaN),30000);assert.equal(searchPageForContext(-1),5);
  assert.equal(reportedContextWindow({modelUsage:{a:{contextWindow:200000},b:{contextWindow:1000000}}}),1000000);
  assert.equal(reportedContextWindow({modelUsage:{}}),undefined);assert.equal(reportedContextWindow(undefined),undefined);
});

test('every model receives the same components; no vendor, model or wire format appears',()=>{
  const base={cwd:'/work/board',platform:'darwin',shell:'/bin/zsh',mode:'plan',language:'Chinese',kicadCli:'/opt/kicad-cli',socket:'/tmp/kicad/api.sock',date:'2026-10-22'};
  clearPromptCache();
  const texts=MODELS.map(model=>renderPromptSections({...base,model},{cache:false}));
  for(const text of texts)assert.equal(text,texts[0],'the selected model must not change the prompt');
  const text=texts[0];
  assert.match(text,/Working directory: \/work\/board/);assert.match(text,/Current date: 2026-10-22/);
  assert.match(text,/KiCad CLI: \/opt\/kicad-cli/);assert.match(text,/Current mode: plan/);assert.match(text,/Reply in Chinese/);
  assert.match(text,/Call tools only through the runtime's tool interface/);assert.match(text,/256 KiB/);
  for(const forbidden of ['Claude','Anthropic','Opus','Sonnet','Haiku','DeepSeek','GPT','Qwen','Gemini','Llama','function_calls','<invoke','Call one tool at a time'])
    assert.doesNotMatch(text,new RegExp(forbidden,'i'),forbidden);
  assert.equal(promptSections({includeDomain:false}).some(s=>s.name==='domain'),false);
  assert.equal(promptSections({includeDomain:true}).some(s=>s.name==='domain'),true);
});

test('feature flags select components; protected sections cannot be disabled',()=>{
  const names=ctx=>promptManifest(ctx).sections;
  assert.deepEqual(names({}),['identity','task_protocol','tool_policy','tool_calls','large_files','capability_discovery','skills','mcp','delegation','memory','verification','domain','environment','mode','output_style','continuity','boundaries']);
  assert.match(renderPromptSections({},{cache:false}),/Do not start a sub-agent on your own initiative/);
  const native=renderPromptSections({features:{mcp:'direct',skills:'native'}},{cache:false});
  assert.match(native,/mcp__<server>__<tool>/);assert.match(native,/load it with the skill tool/);assert.doesNotMatch(native,/Capability discovery/);
  const off=names({features:{mcp:'off',skills:'off',subagents:false,memory:false}});
  for(const name of ['capability_discovery','skills','mcp','delegation','memory'])assert.ok(!off.includes(name),name);
  assert.match(renderPromptSections({features:{agents:['kicad-reviewer','kicad-verifier']}},{cache:false}),/Domain sub-agents available when requested: kicad-reviewer, kicad-verifier/);
  const trimmed=names({disabledSections:['memory','continuity','identity','tool_calls','mode','boundaries']});
  assert.ok(!trimmed.includes('memory')&&!trimmed.includes('continuity'));
  for(const name of ['identity','tool_calls','mode','boundaries'])assert.ok(trimmed.includes(name),name);
});

test('sections are stable, versioned and invalidated explicitly',()=>{
  clearPromptCache();
  const ctx={cwd:'/work',platform:'linux',shell:'/bin/bash',mode:'bypass',date:'2026-10-22'};
  const first=renderPromptSections({...ctx,model:'a'}),second=renderPromptSections({...ctx,model:'b'});
  assert.equal(first,second);
  assert.match(first,/Current mode: full access/);
  assert.equal(promptManifest().version,PROMPT_VERSION);
  clearPromptCache();
  assert.doesNotMatch(renderPromptSections({...ctx,mode:'plan'}),/Current mode: full access/);
  assert.notEqual(renderPromptSections({...ctx,features:{skills:'off'}}),renderPromptSections(ctx),'settings changes are not served from a stale cache');
});
