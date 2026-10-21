#!/usr/bin/env python3
"""Verify the installed CLI, real MCP inventory, terminal and VSIX files."""
import hashlib
import json
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import zipfile

root = Path(__file__).resolve().parent
bin_dir = Path.home() / '.local/bin'


def run(*args):
    return subprocess.check_output(list(map(str,args)), text=True, timeout=30)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


manifest = json.loads(run(bin_dir/'kicad-agent','manifest'))['data']
actions = json.loads(run(bin_dir/'kicad-agent','actions'))['data']['actions']
names = {item['name'] for item in actions}
required = {'editor.run_action','editor.commit.begin','editor.commit.end','board.nets.get','audit.rules','audit.run','audit.footprint','web.search','web.fetch','kicad.cli.run'}
assert required <= names, sorted(required - names)
assert len(actions) == manifest['actionCount']
requests = [{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'install-verification','version':'1'}}}, {'jsonrpc':'2.0','id':2,'method':'tools/list'}]
result = subprocess.run([str(bin_dir/'kicad-agent'),'mcp'], input='\n'.join(json.dumps(item) for item in requests)+'\n', text=True, capture_output=True, timeout=20, check=True)
responses = [json.loads(line) for line in result.stdout.splitlines()]
tools = next(item['result']['tools'] for item in responses if item['id'] == 2)
assert len(tools) == manifest['mcpToolCount']
assert {tool['name'] for tool in tools} == set(manifest['mcpTools'])
assert len({tool['name'] for tool in tools}) == len(tools)
assert {'kicad_editor','kicad_audit','kicad_web','kicad_native_tools'} <= {tool['name'] for tool in tools}
terminal = root/'Kicad-terminal/dist/kicad-terminal'
assert sha(terminal.read_bytes()) == sha((bin_dir/'kicad-terminal').read_bytes())
terminal_version = run(bin_dir/'kicad-terminal','--version').strip()
assert (bin_dir/'Kicad').read_bytes() == (root/'Kicad-terminal/launcher.sh').read_bytes(), 'public Kicad launcher'
assert 'Kicad' in {entry.name for entry in bin_dir.iterdir()}, 'canonical command filename'
assert run(bin_dir/'Kicad','--version').strip() == terminal_version
assert run(bin_dir/'kicad','--version').strip() == terminal_version
help_text = subprocess.check_output([str(bin_dir/'Kicad'),'--help'], text=True, stderr=subprocess.STDOUT, timeout=30)
assert 'Kicad [project]' in help_text and 'kicad-terminal ' not in help_text, 'branded CLI help'
extension_manifest = json.loads((root/'Kicad-extension/dist/build-manifest.json').read_text())
version = extension_manifest['version']
installed = Path.home()/f'.vscode/extensions/kicad-agent.kicad-{version}'
package = json.loads((installed/'package.json').read_text())
assert package['displayName'] == 'Kicad' and package['version'] == version
vsix = next(name for name in extension_manifest['files'] if name.endswith('.vsix'))
with zipfile.ZipFile(root/'Kicad-extension/dist'/vsix) as archive:
    for name in ('dist/extension.cjs','dist/media/main.js','resources/claude-code/cli.js'):
        assert sha(archive.read('extension/'+name)) == sha((installed/name).read_bytes()), name
# Auto-use routing and the EDA Agent Connector are installed and wired in.
share = Path.home()/'.local/share/kicad-terminal'
for name in ('eda-agent-instructions.md','easyeda-mcp.mjs','session-runtime.mjs'):
    assert sha((share/name).read_bytes()) == sha((root/'Kicad-terminal/dist'/name).read_bytes()), name
    with zipfile.ZipFile(root/'Kicad-extension/dist'/vsix) as archive:
        assert sha(archive.read('extension/resources/kicad/'+name)) == sha((installed/'resources/kicad'/name).read_bytes()), 'vsix '+name
easyeda_tools = []
easyeda_bin = shutil.which('easyeda') or str(bin_dir/'easyeda')
if shutil.which('node') and os.access(easyeda_bin, os.X_OK):
    result = subprocess.run(['node', str(share/'easyeda-mcp.mjs')], input='\n'.join(json.dumps(item) for item in requests)+'\n',
                            text=True, capture_output=True, timeout=60, env={**os.environ, 'EASYEDA_BIN': easyeda_bin})
    replies = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    easyeda_tools = sorted(tool['name'] for item in replies if item.get('id') == 2 for tool in item['result']['tools'])
    assert 'easyeda_health' in easyeda_tools and 'easyeda_pcb' in easyeda_tools, result.stderr[-500:]
with tempfile.TemporaryDirectory(prefix='kicad-verify-') as scratch:
    resolved = subprocess.run([str(bin_dir/'Kicad'),'debug','config'], cwd=scratch, text=True, capture_output=True, timeout=120, check=True).stdout
    config = json.loads(resolved[resolved.index('{'):])
    assert str(share/'eda-agent-instructions.md') in config.get('instructions', []), 'terminal auto-use instructions'
    assert config['mcp']['kicad'].get('enabled', True) is not False, 'terminal kicad MCP enabled'
    assert (share/'session-runtime.mjs').as_uri() in config.get('plugin', []), 'terminal task continuity plugin'
    assert config['compaction']['auto'] is True and config['compaction']['prune'] is False, 'resolved native compaction defaults'
    if easyeda_tools:
        assert config['mcp']['easyeda']['command'][-1] == str(share/'easyeda-mcp.mjs'), 'terminal EDA Agent Connector'
    # Bun's debug command can exit before a large pipe finishes flushing.
    # A regular file preserves the complete skill listing without changing the runtime.
    with tempfile.TemporaryFile(mode='w+') as listing:
        subprocess.run([str(bin_dir/'Kicad'),'debug','skill'], cwd=scratch, text=True, stdout=listing, stderr=subprocess.PIPE, timeout=120, check=True)
        listing.seek(0)
        skills = listing.read()
for name in ('kicad-agent','kicad-environment','kicad-drc-review','kicad-fabrication','kicad-routing','kicad-schematic-generation','kicad-step-collision'):
    assert (Path.home()/'.claude/skills'/name/'SKILL.md').is_file(), name
    assert name in skills, 'terminal skill '+name
report = {'ok':True,'terminalCommand':'Kicad','legacyCommand':'kicad','autoUse':{'instructions':str(share/'eda-agent-instructions.md'),'skills':'~/.claude/skills/kicad-*','easyedaTools':easyeda_tools},'agent':manifest,'mcpToolCount':len(tools),'terminalVersion':terminal_version,'terminalSha256':sha(terminal.read_bytes()),'extensionVersion':version,'extensionPath':str(installed),'checkedFiles':['extension.cjs','main.js','bundled CLI','eda-agent-instructions.md','easyeda-mcp.mjs','session-runtime.mjs'],'note':'Installation and capability verification; this does not assert a connected KiCad document or fabricate engineering validation.'}
(root/'audit/install-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
