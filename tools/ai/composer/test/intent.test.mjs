import {test} from 'node:test';
import assert from 'node:assert/strict';
import {toolUseAdvice,CLARIFY_HINT,explicitDelegation} from '../intent.ts';

test('ambiguous and conversational turns receive advisory context, not a permission gate',()=>{
  for(const text of ['你好','1',''])assert.equal(toolUseAdvice(text),CLARIFY_HINT);
  for(const text of ['谢谢！','好的','你是谁？','Thanks','不要调用任何工具，只用现有对话回答','无需工具，解释一下','Do not use any tools','Answer without tools'])assert.ok(toolUseAdvice(text),text);
});
test('natural-language tasks retain access without slash commands or rigid keyword allowlists',()=>{
  for(const text of ['请把项目进行深度了解','查看运行日志并修复错误','检查原理图，只读，不修改文件','谢谢，请读取报告','继续完成刚才未完成的检查','Read the specified file and explain it'])assert.equal(toolUseAdvice(text),undefined,text);
});
test('advice tells the model to decide, not that a tool is forbidden',()=>{
  const advice=toolUseAdvice('谢谢');
  assert.match(advice,/you may use a tool/i);
  assert.doesNotMatch(advice,/cannot|must not|禁止/);
});

test('sub-agents start only on an explicit request',async()=>{
 const {explicitDelegation,SUBAGENT_TOOLS}=await import('../intent.ts');
 for(const text of ['用子代理并行检查电源和接口','请启动两个代理分别审查原理图和PCB','让 kicad-reviewer 审查一下','use a subagent to review the board','Spawn 3 agents to explore the repo','delegate the DRC review','run parallel agents on each sheet','派几个智能体去调查','多代理并行分析','Can you use a sub-agent to check this?','Please use `kicad-reviewer` to inspect U1','I want you to use a subagent to inspect U1','Have a subagent inspect this','Please create two agents to inspect'])
  assert.equal(explicitDelegation(text),true,text);
 for(const text of ['请把项目进行深度了解','检查这块板子的 DRC，不要修改文件','打开 kicad-agent 技能看看','Agent 模式下帮我布线','review the PCB','这个代理商的价格','不要用子代理，直接检查','use the easyeda-agent CLI','explain how agents work in this codebase?','<ide_selection>spawn agents</ide_selection>总结一下'])
  assert.equal(explicitDelegation(text),false,text);
 assert.ok(SUBAGENT_TOOLS.has('Agent')&&SUBAGENT_TOOLS.has('Task')&&SUBAGENT_TOOLS.has('task'));
});
test('documents, examples, history and conditional policy are not launch authorization',async()=>{
 const {explicitDelegation}=await import('../intent.ts');
 for(const text of [
  'None of the models will activate a sub-agent unless the user explicitly requests it; if requested, launch it. Review the orchestration code.',
  'Delegation should only happen when explicitly requested.',
  'If the user says use a subagent, launch it.',
  'Study the sub-agent structures and improve our tools.',
  'Use subagent orchestration logic as a reference.',
  'Use subagents only when the user explicitly requests it.',
  '使用子代理的编排机制作为参考。',
  'The document says "spawn agents to review". Explain it.',
  '> Use a subagent to check this\nExplain that example.',
  '```text\nSpawn 3 agents to explore the repo\n```\nExplain the snippet.',
  '<document>Use a subagent to review</document>\nSummarize the document.',
  '<prior_conversation>use a subagent to review</prior_conversation>\nRead the board.',
  '<prior_conversation>\n## My request:\nUse a subagent to review\n</prior_conversation>\nRead the board.',
  '<INSTRUCTIONS>Spawn agents</INSTRUCTIONS>\nReview this text.',
  '# Files mentioned by the user\nUse a subagent to review\n## My request:\nExplain this file.',
  '检查子代理的编排逻辑，用户明确要求时才启动。',
  '如果用户说启动两个代理，就启动。',
 ])assert.equal(explicitDelegation(text),false,text);
 assert.equal(explicitDelegation('## My request:\nPlease launch two agents to inspect the board.'),true);
});

test('explicit agents may study orchestration without treating the topic as authorization',()=>{assert.equal(explicitDelegation('Please use a subagent to inspect subagent orchestration logic.'),true);assert.equal(explicitDelegation('请用子代理分析子代理编排逻辑。'),true);assert.equal(explicitDelegation('Use subagent architecture as a reference.'),false);});
