import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionOutput,terminalText} from '../execution-output.ts';
test('terminal prints complete tool stages once, including failures and children',()=>{
 const chunks=[],sink=new ExecutionOutput(s=>chunks.push(s));
 const use={session_id:'s',type:'assistant',message:{content:[{type:'tool_use',id:'a',name:'Bash',input:{command:'ls'}}]}};
 sink.observe(use);sink.observe(use);
 sink.observe({session_id:'s',type:'user',message:{content:[{type:'tool_result',tool_use_id:'a',is_error:true,content:'Exit code 1\nJSONDecodeError: Extra data'}]}});
 sink.observe({session_id:'s',type:'assistant',parent_tool_use_id:'a',message:{content:[{type:'tool_use',id:'b',name:'Read',input:{path:'fixture'}}]}});
 sink.observe({session_id:'s',type:'assistant',message:{content:[{type:'text',text:'ordinary answer'}]}});
 assert.equal(chunks.length,3);assert.match(chunks.join(''),/FAILED\nExit code 1\nJSONDecodeError/);assert.doesNotMatch(chunks.join(''),/ordinary answer/);
});
test('terminal strips active controls, redacts secrets and preserves useful long output',()=>{
 const value='\x1b]52;c;clipboard\x07\x1b[31mapi_key=fixture-secret\x1b[0m\n'+('line\n'.repeat(1000));
 const text=terminalText(value);assert.doesNotMatch(text,/\x1b|fixture-secret|clipboard/);assert.match(text,/REDACTED/);assert.ok(text.length>1200);
});
