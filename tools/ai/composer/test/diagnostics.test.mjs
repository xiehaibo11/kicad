import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {RuntimeJournal,DiagnosticRecorder,diagnosticReport,redact,diagnose,toolFailure,archiveCommandAdvice,optionalProbeAdvice,shellGuidance} from '../diagnostics.ts';

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

test('shell exits are classified from error lines, not from program output',()=>{
 // Real journal cases: an ls listing that names *schemas.mjs and a Vue template mentioning reject were reported as argument and permission errors.
 const listing='Exit code 1\n/repo/direct:\ntotal 912\n'+Array.from({length:30},(_,i)=>'-rw-r--r--  1 u  staff  100 Oct 22 file'+i+'.mjs').join('\n')+'\n-rw-r--r--  1 u  staff  8497 Oct 22 native-workflow-schemas.mjs';
 assert.equal(diagnose(listing).kind,'command_exit');
 assert.equal(diagnose('Exit code 1\n<template>\n  <div v-if="view.failures.length">rejected or denied</div>\n</template>').kind,'command_exit');
 assert.equal(diagnose('Exit code 1\nugrep: error: error at position 94\n(?:x){0,400}\n     exceeds complexity limits___/\n\n(eval):1: == not found').kind,'search_pattern');
 assert.equal(diagnose('Exit code 1\n(eval):1: no matches found: --include=*.ts').kind,'shell_syntax');
 assert.equal(diagnose('Exit code 1\n(eval):1: ===BASE=== not found').kind,'shell_syntax');
 assert.match(diagnose('Exit code 1\n(eval):1: ===BASE=== not found').suggestion,/===BASE===/);
 assert.equal(diagnose("SyntaxError: Unexpected token '!'").kind,'script_syntax');
 assert.equal(diagnose('File content (291.3KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file.').kind,'large_file');
 assert.match(diagnose('File content (291.3KB) exceeds maximum allowed size (256KB). Use offset and limit parameters to read specific portions of the file.').suggestion,/offset\/limit|256 KiB/);
 assert.match(optionalProbeAdvice('which code cursor 2>/dev/null'),/command -v/);
 assert.equal(optionalProbeAdvice('ls -la'),undefined);
 assert.equal(diagnose('kicad-direct was not found. Build it with -DKICAD_BUILD_AI_AGENT=ON').kind,'kicad_runtime');
 assert.equal(diagnose('Exit code 127\nzsh: command not found: kicad-cli').kind,'dependency');
 assert.equal(diagnose('Exit code 1\nls: /missing: No such file or directory').kind,'dependency');
 assert.equal(diagnose('Exit code 1\ncat: /etc/secret: Permission denied').kind,'permission');
 assert.equal(diagnose('permission denied').kind,'permission','tool errors keep the broad rules');
});
test('report rows locate events without repeating suggestions and list the slowest tools',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-diagnostics-rows-')),old=process.env.KICAD_DIAGNOSTICS_DIR;process.env.KICAD_DIAGNOSTICS_DIR=path.join(tmp,'logs');
 try{
 const recorder=new DiagnosticRecorder(new RuntimeJournal('extension',tmp)),now=Date.now;let clock=1000;Date.now=()=>clock;
 try{await recorder.start('s','a','kicad_board');clock+=900;await recorder.end('s','a','kicad_board','{"ok":false,"error":{"code":"BAD_INPUT"}}');await recorder.start('s','b','Read');clock+=5;await recorder.end('s','b','Read','text');await recorder.start('s','c','Bash');}finally{Date.now=now;}
 const report=await diagnosticReport(tmp);
 assert.deepEqual(report.slowCalls.map(x=>[x.name,x.maxMs]),[['kicad_board',900],['Read',5]]);
 assert.equal(report.pendingCalls.length,1);assert.equal(report.pendingCalls[0].name,'Bash');assert.equal(report.pendingCalls[0].schemaVersion,undefined);
 assert.equal(report.recent[0].kind,'invalid_arguments');assert.equal(report.recent[0].suggestion,undefined);assert.ok(report.issues[0].suggestion);
 }finally{if(old===undefined)delete process.env.KICAD_DIAGNOSTICS_DIR;else process.env.KICAD_DIAGNOSTICS_DIR=old;await fs.rm(tmp,{recursive:true,force:true});}
});

test('queued writes stay in the directory chosen when the journal was created',async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'kicad-journal-root-')),old=process.env.KICAD_DIAGNOSTICS_DIR;
 try{
 process.env.KICAD_DIAGNOSTICS_DIR=path.join(tmp,'fixture');const journal=new RuntimeJournal('extension',tmp);
 const pending=journal.record({category:'tool',phase:'start',status:'running',sessionId:'fixture-session',callId:'c',name:'Bash'});
 // A test restores the real directory before fire-and-forget writes finish; they must not land there.
 process.env.KICAD_DIAGNOSTICS_DIR=path.join(tmp,'real');await pending;
 assert.equal((await fs.readdir(path.join(tmp,'fixture'))).length,1);await assert.rejects(fs.access(path.join(tmp,'real')));
 }finally{if(old===undefined)delete process.env.KICAD_DIAGNOSTICS_DIR;else process.env.KICAD_DIAGNOSTICS_DIR=old;await fs.rm(tmp,{recursive:true,force:true});}
});

test('zsh users get quoting guidance; other shells get none',()=>{
 assert.match(shellGuidance('/bin/zsh'),/--include="\*\.py"/);assert.match(shellGuidance('/opt/homebrew/bin/zsh'),/== inside/);assert.match(shellGuidance('/bin/zsh'),/===BASE===/);assert.match(shellGuidance('/bin/zsh'),/command -v/);
 for(const shell of ['/bin/bash','/usr/bin/fish',''])assert.equal(shellGuidance(shell),'');
});

test('JSON parse failures from merged stderr get a specific diagnosis',async()=>{
 const {diagnose}=await import('../diagnostics.ts');
 const extra='Exit code 1\nTraceback (most recent call last):\n  File "<string>", line 3, in <module>\njson.decoder.JSONDecodeError: Extra data: line 1612 column 1 (char 746803)';
 assert.equal(diagnose(extra).kind,'json_parse');assert.match(diagnose(extra).suggestion,/2>&1/);
 assert.equal(diagnose('Exit code 1\n    raise JSONDecodeError("Expecting value", s, err.value) from None\njson.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)').kind,'json_parse');
 assert.equal(diagnose('json.decoder.JSONDecodeError: Extra data: line 1 column 34 (char 33)').kind,'json_parse');
 assert.match(diagnose('JSONDecodeError: Extra data').suggestion,/\.epru/);
 assert.equal(diagnose('Exit code 1\nSyntaxError: invalid syntax').kind,'script_syntax','other script errors keep their kind');
});
