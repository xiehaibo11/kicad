import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readSettings,resolveSettings,assertModelAllowed,capEffort} from '../settings.ts';
import {autoDecision} from '../permission-gates.ts';
import {promptAudit} from '../prompt-audit.ts';
test('settings cannot remove managed denials or raise effort caps; Auto is capped too',()=>{
  const settings=resolveSettings([{source:'user',value:{maxEffortLevel:'max',deniedModels:['deepseek-*']}},
    {source:'project',value:{maxEffortLevel:'ultra',deniedModels:[],autoMode:true,modelSettings:{'gpt-*':{maxEffortLevel:'high'}}}},
    {source:'admin',managed:true,value:{maxEffortLevel:'xhigh',autoMode:false}}]);
  assert.equal(settings.autoMode,false);
  assert.equal(settings.maxEffortLevel,'xhigh');
  assert.throws(()=>assertModelAllowed(settings,'deepseek-flash'),/blocked/);
  assert.throws(()=>assertModelAllowed(settings,'default'),/concrete/);
  assertModelAllowed(settings,'codex:gpt-6.1-sol');
  for(const level of ['ultra','max','default_on'])assert.equal(capEffort(settings,'codex:gpt-6.1-sol',level,['low','high','max','ultra']),'high');
  assert.throws(()=>capEffort({...settings,maxEffortLevel:'low'},'claude-fixture','default_on',['high']),/No supported/);
  assert.equal(capEffort(resolveSettings([]),'unknown','default_on',['default_on']),'default_on');
});
test('malformed settings fail closed; audit stays read-only and reports missing refs',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-policy-'));
  try{
    fs.mkdirSync(path.join(tmp,'.kicad'));const file=path.join(tmp,'.kicad/settings.json');
    fs.writeFileSync(file,'{"deniedModels":"bad"}');
    assert.throws(()=>readSettings(tmp,{}, {home:tmp,managedPath:path.join(tmp,'absent')}),/Invalid/);
    fs.writeFileSync(file,'{"maxProseWidth":80}');
    assert.equal(readSettings(tmp,{}, {home:tmp,managedPath:path.join(tmp,'absent')}).settings.maxProseWidth,80);
    fs.writeFileSync(path.join(tmp,'AGENTS.md'),'[missing](does-not-exist.md)\nOnly use Claude\n');
    const before=fs.readdirSync(tmp),report=promptAudit(tmp);
    assert.deepEqual(report.findings.map(f=>f.code),['missing-reference','model-constraint']);
    assert.ok(report.sections.some(s=>s.name==='boundaries'));assert.deepEqual(fs.readdirSync(tmp),before);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('auto allows local edits and simple reads, asks for unknown commands and symlink escapes',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kicad-auto-'));
  try{
    fs.mkdirSync(path.join(tmp,'project'));fs.mkdirSync(path.join(tmp,'other'));
    const cwd=path.join(tmp,'project');fs.symlinkSync(path.join(tmp,'other'),path.join(cwd,'linked'));
    assert.equal(autoDecision('Write',{file_path:path.join(cwd,'new.ts')},cwd).decision,'allow');
    assert.equal(autoDecision('Write',{file_path:path.join(cwd,'linked/new.ts')},cwd).decision,'ask');
    assert.equal(autoDecision('Bash',{command:'ls -la'},cwd).decision,'allow');
    for(const command of ['ls; rm a','cat $(curl example.com)','rg --pre=./run x','git diff','npm test','python3 -c "x"','curl example.com'])assert.equal(autoDecision('Bash',{command},cwd).decision,'ask',command);
    assert.equal(autoDecision('Bash',{command:'sudo ls'},cwd).decision,'deny');
    assert.equal(autoDecision('Agent',{},cwd).decision,'ask');
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
