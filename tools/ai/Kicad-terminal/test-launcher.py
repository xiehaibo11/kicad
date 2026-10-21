#!/usr/bin/env python3
import json,os,subprocess,tempfile,shutil
from pathlib import Path
with tempfile.TemporaryDirectory(prefix='Kicad-launcher-test-') as directory:
 root=Path(directory);shutil.copyfile(Path(__file__).with_name('launcher.sh'),root/'kicad')
 stub=root/'kicad-terminal';stub.write_text('#!/usr/bin/env python3\nimport os\nprint(os.environ["OPENCODE_CONFIG_CONTENT"])\n');stub.chmod(0o755)
 env={**os.environ,'HOME':directory,'DEEPSEEK_API_KEY':'fixture-only'}
 cases=[('',{}),('{"model":"existing/model","permission":{"*":"ask"}}',{'model':'existing/model'}),('{ // keep inherited\n "mcp":{"other":{"enabled":false}}, /* comment */ "note":"https://docs.example/a,}", //x\n}',{'note':'https://docs.example/a,}'}),('{"mcp":{"kicad":{"enabled":false}},"provider":{"kicad-deepseek":{"name":"custom"}}}',{'custom':True})]
 for text,expected in cases:
  env['OPENCODE_CONFIG_CONTENT']=text
  result=json.loads(subprocess.check_output(['sh',str(root/'kicad')],env=env,text=True))
  assert 'kicad' in result['mcp']
  for k,v in expected.items():
   if k!='custom':assert result[k]==v
  if expected.get('custom'):assert result['mcp']['kicad']=={'enabled':False} and result['provider']['kicad-deepseek']=={'name':'custom'}
  else:assert result['provider']['kicad-deepseek']['options']['baseURL'].endswith('/anthropic/v1')
 env['OPENCODE_CONFIG_CONTENT']='{"mcp":[],}'
 result=subprocess.run(['sh',str(root/'kicad')],env=env,text=True,capture_output=True)
 assert result.returncode!=0 and 'cannot merge' in result.stderr
# Installed layout: <prefix>/bin/{kicad,kicad-terminal,easyeda} + <prefix>/share/kicad-terminal.
 prefix=root/'prefix';bindir=prefix/'bin';share=prefix/'share/kicad-terminal';bindir.mkdir(parents=True);share.mkdir(parents=True)
 for name in ('kicad','kicad-terminal'):shutil.copy2(root/name,bindir/name)
 easyeda=bindir/'easyeda';easyeda.write_text('#!/bin/sh\n');easyeda.chmod(0o755)
 (share/'eda-agent-instructions.md').write_text('fixture');(share/'easyeda-mcp.mjs').write_text('')
 (share/'session-runtime.mjs').write_text('')
 env['OPENCODE_CONFIG_CONTENT']='{"instructions":["AGENTS.md"]}'
 result=json.loads(subprocess.check_output(['sh',str(bindir/'kicad')],env=env,text=True))
 assert result['instructions']==['AGENTS.md',str(share/'eda-agent-instructions.md')],result['instructions']
 assert result['plugin']==[(share/'session-runtime.mjs').as_uri()]
 assert 'compaction' not in result  # defaults are applied after all user/project config merges
 if shutil.which('node'):
  assert result['mcp']['easyeda']['command'][1]==str(share/'easyeda-mcp.mjs') and result['mcp']['easyeda']['enabled'] is True
  assert result['mcp']['easyeda']['environment']['EASYEDA_BIN'] in (str(easyeda),shutil.which('easyeda'))
 env['OPENCODE_CONFIG_CONTENT']='{"mcp":{"easyeda":{"enabled":false}}}'
 result=json.loads(subprocess.check_output(['sh',str(bindir/'kicad')],env=env,text=True))
 assert result['mcp']['easyeda']=={'enabled':False},'an explicit inherited easyeda entry wins'
 (share/'easyeda-mcp.mjs').unlink()
 env['OPENCODE_CONFIG_CONTENT']=''
 result=json.loads(subprocess.check_output(['sh',str(bindir/'kicad')],env=env,text=True))
 assert 'easyeda' not in result['mcp'] and 'kicad' in result['mcp'],'missing connector bundle degrades to KiCad only'
print('Launcher passed: inherited JSON/JSONC, strings, explicit MCP/providers, empty config, invalid config, auto-use instructions and EasyEDA connector.')
