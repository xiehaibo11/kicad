// Run with bun: a rejected Claude membership request is reported once, real limits keep retrying.
import assert from 'node:assert/strict';
import {explainClaudeRejection} from './overlay/membership.ts';
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const bare=await explainClaudeRejection(json(429,{type:'error',error:{type:'rate_limit_error',message:'Error'}}));
assert.equal(bare.status,403);assert.match((await bare.json()).error.message,/Claude Code/);
const limited=json(429,{type:'error',error:{type:'rate_limit_error',message:"This request would exceed your account's rate limit."}});
assert.equal(await explainClaudeRejection(limited),limited,'real rate limits keep their retryable status');
const server=new Response('',{status:529});assert.equal(await explainClaudeRejection(server),server);
const ok=new Response('{}',{status:200});assert.equal(await explainClaudeRejection(ok),ok);
console.log('membership rejection mapping ok');
