import json
import os
from pathlib import Path
import subprocess

out = Path(__file__).resolve().parent
prompt = '请为 KiCad 的原理图设计和封装选型列出必须遵守的工程规范，并查找原生设计示例供后续参考。只读，不修改工程，不调用任何写入工具。请自动查阅已有规范后给出缺失输入和验证证据，不要把参考示例当作可投产设计。'
env = dict(os.environ)
env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'permission': {'*': 'deny', 'skill': 'allow', 'kicad_kicad_reference': 'allow', 'kicad_kicad_actions': 'allow'}})
command = [str(Path.home()/'.local/bin/Kicad'), 'run', '--format', 'json', '--model', 'kicad-deepseek/deepseek-flash', '--variant', 'off', prompt]
result = subprocess.run(command, cwd=out, env=env, capture_output=True, text=True, timeout=180)
(out/'terminal-natural.jsonl').write_text(result.stdout)
(out/'terminal-natural.stderr').write_text(result.stderr)
events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
tools = [e['part'] for e in events if e.get('type')=='tool_use']
actions = [t.get('state',{}).get('input',{}).get('action') for t in tools if t.get('tool')=='kicad_kicad_reference']
completed = [t for t in tools if t.get('tool')=='kicad_kicad_reference' and t.get('state',{}).get('status')=='completed']
texts = [e.get('part',{}).get('text','') for e in events if e.get('type')=='text']
ok = result.returncode==0 and 'reference.plan' in actions and 'reference.examples' in actions and len(completed)>=2 and bool(texts)
(out/'terminal-natural.json').write_text(json.dumps({'ok':ok,'prompt':prompt,'fixture':'Installed terminal + actual configured DeepSeek model + real MCP; only read-only reference/catalog permissions allowed','actions':actions,'tools':tools,'completion':texts,'exitCode':result.returncode},ensure_ascii=False,indent=2)+'\n')
assert ok, {'exitCode':result.returncode,'actions':actions,'completed':len(completed),'stderr':result.stderr[-500:]}
print(json.dumps({'ok':ok,'actions':actions},ensure_ascii=False))
