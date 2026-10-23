// Exercise cancellation, tool isolation and model routing without calling an API.
import assert from 'node:assert/strict';
import {resolveSettings,assertModelAllowed,capEffort} from '../composer/settings.ts';
import * as reasoning from './overlay/kicadReasoning.ts';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const root = process.argv[2];
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const source = fs.readFileSync(path.join(root, 'src/kicadPromptOptimizer.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
const predictionModule = {exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/kicadPrediction.ts'),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {module:predictionModule,exports:predictionModule.exports});
const journalEvents=[];const diagnostics={RuntimeJournal:class{async record(event){journalEvents.push(event)}}};
const module = { exports: {} };
vm.runInNewContext(compiled.outputText, { module, exports: module.exports, AbortController, setTimeout, clearTimeout, require:name=>{if(name==='vscode')return {workspace:{workspaceFolders:[]}};if(name==='./kicadSettings')return {agentSettings:()=>({settings:resolveSettings([])})};if(name==='./shared/kicadSettings')return {assertModelAllowed,capEffort};if(name==='./shared/kicadReasoning')return reasoning;if(name==='./shared/kicadMembership')return {codexText:async()=> 'codex-text-fixture'};if(name==='./shared/kicadDiagnostics')return diagnostics;assert.equal(name,'./kicadPrediction');return predictionModule.exports;} });
const { optimizePrompt } = module.exports;
const config = { cwd: '/isolated/optimizer', cliPath: '/cli.js', env: { ANTHROPIC_AUTH_TOKEN: 'fixture-only' } };
const request = { type: 'optimize_prompt', text: '只检查 PCB，不修改 @board.kicad_pcb', model: 'deepseek-flash' };
let calls = 0;
let returned = false;
const run = ({ prompt, options }) => {
  calls++;
  assert.equal(prompt, request.text);
  assert.equal(options.model, request.model);
  assert.equal(options.persistSession, false);
  assert.equal(options.tools.length, 0);
  assert.equal(Object.keys(options.mcpServers).length, 0);
  assert.equal(options.strictMcpConfig, true);
  assert.equal(options.settingSources.length, 0);
  assert.equal(options.resume, undefined);
  assert.equal(options.extraArgs['disable-slash-commands'], null);
  assert.equal(options.env.ANTHROPIC_AUTH_TOKEN, 'fixture-only');
  return {
    async *[Symbol.asyncIterator]() { yield { type: 'result', subtype: 'success', is_error: false, result: '请只检查 @board.kicad_pcb 并报告问题，不做修改。' }; },
    async return() { returned = true; }
  };
};
const result = await optimizePrompt(request, config, new AbortController().signal, run);
assert.match(result.text, /不做修改/);
assert.equal(result.model, request.model);
assert.equal(returned, true);
await assert.rejects(optimizePrompt({ ...request, text: '' }, config, new AbortController().signal, run), /先输入/);
assert.equal(calls, 1);
const cancel = new AbortController();
let stopped = false;
const hanging = ({ options }) => {
  options.abortController.signal.addEventListener('abort', () => { stopped = true; });
  return { [Symbol.asyncIterator]() { return this; }, next() { return new Promise(() => {}); }, async return() {} };
};
const pending = optimizePrompt(request, config, cancel.signal, hanging);
cancel.abort();
await assert.rejects(pending, /已取消/);
assert.equal(stopped, true);
await assert.rejects(optimizePrompt(request, config, new AbortController().signal, hanging, 10), /超时/);
const stream = messages => () => ({ async *[Symbol.asyncIterator]() { yield* messages; }, async return() {} });
const longText = '保留明确要求。'.repeat(6000);
const longResult = await optimizePrompt({ ...request, text: longText }, config, new AbortController().signal,
  stream([{ type: 'result', subtype: 'success', is_error: false, result: longText }]));
assert.equal(longResult.text, longText, 'No application length cap or output truncation');
await assert.rejects(optimizePrompt(request, config, new AbortController().signal, stream([])), /未返回/);
await assert.rejects(optimizePrompt(request, config, new AbortController().signal, stream([{ type: 'result', subtype: 'error_during_execution', errors: ['401 fixture error'] }])), /401/);
await assert.rejects(optimizePrompt(request, config, new AbortController().signal, stream([{ type: 'assistant', message: { content: [{ type: 'tool_use' }] } }])), /调用工具/);
console.log('Prompt optimizer checks passed: selected model, text-only isolation, cancel, timeout, errors, empty output, tool rejection.');

assert.ok(journalEvents.some(e=>e.phase==='error'));assert.ok(journalEvents.some(e=>e.phase==='result'));assert.ok(journalEvents.every(e=>!('text' in e)&&!('env' in e)));

const codexResult=await optimizePrompt({...request,model:"codex:gpt-fixture"},config,new AbortController().signal,()=>{throw Error("Codex must never call Claude SDK")});assert.equal(codexResult.text,"codex-text-fixture");
