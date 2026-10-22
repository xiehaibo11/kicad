import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {RuntimeJournal,DiagnosticRecorder,diagnosticReport,redact,diagnose,toolFailure,archiveCommandAdvice} from '../diagnostics.ts';

test('journal captures both clients, isolates workspaces, redacts secrets and correlates calls',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-diagnostics-')),old=process.env.KICAD_DIAGNOSTICS_DIR;process.env.KICAD_DIAGNOSTICS_DIR=path.join(tmp,'logs');
 try{
 const terminal=new RuntimeJournal('terminal',tmp),extension=new RuntimeJournal('extension',tmp),recorder=new DiagnosticRecorder(terminal);
 await recorder.start('s1','call1','bash');await recorder.end('s1','call1','bash','normal output',undefined,7);
 await recorder.terminalEvent({type:'message.part.updated',properties:{part:{type:'tool',sessionID:'s1',callID:'call1',tool:'bash',state:{status:'completed',metadata:{exit:7}}}}});
 await extension.record({category:'ai',phase:'error',status:'error',sessionId:'s2',error:'401 api_key=VERY_SECRET Bearer OTHER_SECRET https://user:pass@host/path?token=QUERY_SECRET'});
 await new RuntimeJournal('extension',path.join(tmp,'other')).record({category:'ai',phase:'error',error:'429'});
 const report=await diagnosticReport(tmp);assert.equal(report.events,3);assert.equal(report.issues.length,2);assert.equal(report.issues.find(x=>x.category==='terminal').count,1);
 assert.equal((await diagnosticReport(tmp,'s2')).events,1);assert.equal(report.issues.find(x=>x.category==='ai').kind,'authentication');
 for(const file of await fs.readdir(report.directory)){const text=await fs.readFile(path.join(report.directory,file),'utf8');assert.doesNotMatch(text,/VERY_SECRET|OTHER_SECRET|QUERY_SECRET|user:pass/);assert.equal((await fs.stat(path.join(report.directory,file))).mode&0o777,0o600);}
 }finally{if(old===undefined)delete process.env.KICAD_DIAGNOSTICS_DIR;else process.env.KICAD_DIAGNOSTICS_DIR=old;await fs.rm(tmp,{recursive:true,force:true});}
});
test('terminal bus records final thrown errors even with no next tool, AI errors and retry status',async()=>{
 const events=[],r=new DiagnosticRecorder({record:async event=>events.push(event)});
 await r.terminalEvent({type:'message.part.updated',properties:{part:{type:'tool',sessionID:'s',callID:'c',tool:'read',state:{status:'error',error:'ENOENT'}}}});
 await r.terminalEvent({type:'session.status',properties:{sessionID:'s',status:{type:'retry',message:'429 rate limit'}}});
 await r.terminalEvent({type:'session.error',properties:{sessionID:'s',error:{data:{message:'timeout'}}}});
 await r.terminalEvent({type:'message.part.updated',properties:{part:{type:'step-finish',sessionID:'s',messageID:'m',tokens:{total:18}}}});
 assert.deepEqual(events.map(e=>e.phase),['end','retry','error','step-finish']);assert.equal(events[0].error,'ENOENT');assert.equal(events[3].tokens,18);
});
test('diagnosis distinguishes cancellations, permissions, design violations and runtime failures',()=>{
 for(const [text,kind] of [['AbortError','cancelled'],['permission denied','permission'],['429 rate limit','rate_limit'],['context length exceeded','context_limit'],['IPC_UNAVAILABLE','connection'],['INVALID_ARGUMENTS','invalid_arguments'],['CONNECTIVITY_UNPROVEN','design_check'],['ETIMEDOUT timeout','timeout']])assert.equal(diagnose(text).kind,kind);
 assert.equal(toolFailure('{"ok":false,"error":{"code":"BAD_INPUT"}}').code,'BAD_INPUT');
 assert.equal(toolFailure({content:[{type:'text',text:'{"ok":false,"error":{"code":"NOT_READY"}}'}]}).code,'NOT_READY');
 assert.equal(toolFailure('ordinary text containing error'),undefined);
 assert.equal(toolFailure('ok',0),undefined);assert.match(toolFailure('ok',1),/code 1/);
 const hidden=redact('password="secret with spaces" token=hello sk-secret123 Authorization: Bearer abc https://host/x?foo=private');assert.doesNotMatch(hidden,/secret with spaces|hello|sk-secret123|Bearer abc|foo=private/);
});
test('concurrent writes stay parseable, malformed tails are visible and retention ignores unrelated files',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-journal-')),old=process.env.KICAD_DIAGNOSTICS_DIR;process.env.KICAD_DIAGNOSTICS_DIR=path.join(tmp,'logs');
 try{
 const journals=[new RuntimeJournal('terminal',tmp),new RuntimeJournal('extension',tmp)];
 await Promise.all(Array.from({length:80},(_,i)=>journals[i%2].record({category:'tool',phase:'end',status:'returned',callId:String(i)})));
 const report=await diagnosticReport(tmp);assert.equal(report.events,80);assert.equal(report.invalidLines,0);
 await new RuntimeJournal('terminal',tmp).record({category:'runtime',phase:'start'});assert.equal((await fs.readdir(report.directory)).length,2,'queries share process writers instead of rotating every session');
 const file=path.join(report.directory,(await fs.readdir(report.directory))[0]);await fs.appendFile(file,'{"partial":');assert.equal((await diagnosticReport(tmp)).invalidLines,1);
 const expired=path.join(report.directory,'2000-01-01-terminal-aaaa-1.jsonl'),unrelated=path.join(report.directory,'keep.txt');await fs.writeFile(expired,'{}');await fs.utimes(expired,1,1);await fs.writeFile(unrelated,'keep');
 await new RuntimeJournal('extension',tmp+'/retention').record({category:'runtime',phase:'start'});
 // A new process/module would prune on first write; advance the clock to the next periodic cleanup.
 const now=Date.now;Date.now=()=>now()+61000;try{await journals[0].record({category:'runtime',phase:'start'});}finally{Date.now=now;}await assert.rejects(fs.access(expired));assert.equal(await fs.readFile(unrelated,'utf8'),'keep');
 }finally{if(old===undefined)delete process.env.KICAD_DIAGNOSTICS_DIR;else process.env.KICAD_DIAGNOSTICS_DIR=old;await fs.rm(tmp,{recursive:true,force:true});}
});
test('logging failures never throw into the tool execution and report failure once',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-log-fail-')),old=process.env.KICAD_DIAGNOSTICS_DIR,warn=console.warn;let warnings=0;
 try{await fs.writeFile(path.join(tmp,'file'),'blocked');process.env.KICAD_DIAGNOSTICS_DIR=path.join(tmp,'file');console.warn=()=>warnings++;
 const j=new RuntimeJournal('terminal',tmp);await j.record({category:'tool',phase:'start'});await j.record({category:'tool',phase:'end'});assert.equal(warnings,1);
 }finally{console.warn=warn;if(old===undefined)delete process.env.KICAD_DIAGNOSTICS_DIR;else process.env.KICAD_DIAGNOSTICS_DIR=old;await fs.rm(tmp,{recursive:true,force:true});}
});

test('SDK debug messages are not errors and chunked actual failures remain visible',async()=>{
 const {SdkErrorLines,sdkLogLevel}=await import('../diagnostics.ts');const lines=new SdkErrorLines();
 assert.deepEqual(lines.push('[DEBUG] Error log sink initialized\n[DEBUG] Failed to stat optional agents: ENOENT\n[ER'),[]);
 assert.deepEqual(lines.push('ROR] MCP server failed\n[ERROR] HTTP 429'),['[ERROR] MCP server failed']);assert.deepEqual(lines.flush(),['[ERROR] HTTP 429']);
 assert.equal(sdkLogLevel('[WARN] retry after error'),'WARN');assert.equal(sdkLogLevel('Error: spawn ENOENT'),'ERROR');
 assert.equal(diagnose('Exit code 64').kind,'command_exit');assert.equal(diagnose('Cannot read binary file: a.epro2').kind,'binary_file');
 assert.equal(diagnose('Expected query and kind: tool, skill or server').kind,'invalid_arguments');assert.equal(diagnose('failed to load configuration: invalid transport').kind,'configuration');
});

test('EPRO2 archive write errors retain evidence and macOS extraction uses a supported alternative',()=>{
 const failure='Exit code 50\n/tmp/RK3308B_IPC ?????.epru:  write error (disk full?).  Continue? (y/n/^C) fchmod (file attributes) error: Bad file descriptor';
 assert.equal(diagnose(failure).kind,'archive_write');assert.match(diagnose(failure).suggestion,/ditto/);
 assert.equal(diagnose('Exit code 50').kind,'command_exit','an exit code alone does not prove an archive or disk issue');
 const command='dest=$(mktemp -d /tmp/probe.XXXXXX) && echo "$dest" && unzip -q "/path/中文备份.epro2" -d "$dest" && ls "$dest"';
 assert.match(archiveCommandAdvice('Bash',{command},'darwin'),/ditto/);
 assert.match(archiveCommandAdvice('bash',{command:'/usr/bin/unzip "board.epro2"'},'darwin'),/ditto/);
 for(const command of ['unzip -l "board.epro2"','unzip -t "board.epro2"','unzip -v "board.epro2"','unzip -Z1 "board.epro2"','/usr/bin/ditto -x -k "board.epro2" /tmp/new','echo "unzip board.epro2"','unzip source.zip'])assert.equal(archiveCommandAdvice('bash',{command},'darwin'),undefined,command);
 assert.equal(archiveCommandAdvice('Bash',{command},'linux'),undefined);
 assert.equal(archiveCommandAdvice('Read',{command},'darwin'),undefined);
});
