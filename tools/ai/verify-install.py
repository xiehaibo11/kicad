#!/usr/bin/env python3
"""Verify the installed CLI, in-process tool inventory, terminal and VSIX files."""
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


manifest = json.loads(run(bin_dir/'kicad-direct','manifest'))['data']
actions = json.loads(run(bin_dir/'kicad-direct','actions'))['data']['actions']
names = {item['name'] for item in actions}
required = {'editor.run_action','editor.commit.begin','editor.commit.end','board.nets.get','audit.rules','audit.run','audit.footprint','web.search','web.fetch','kicad.cli.run','reference.search','reference.get','reference.plan','reference.examples','release.snapshot','release.template','release.check'}
assert required <= names, sorted(required - names)
assert len(actions) == manifest['actionCount']
module = root/'direct/dist/kicad-direct.mjs'
source = 'const m = await import(process.argv[1]); console.log(JSON.stringify(m.toolsList()))'
tools = json.loads(run('node','--input-type=module','-e',source,module.as_uri()))
assert len(tools) == manifest['mcpToolCount']
assert {tool['name'] for tool in tools} == set(manifest['mcpTools'])
assert len({tool['name'] for tool in tools}) == len(tools)
assert {'kicad_editor','kicad_audit','kicad_web','kicad_native_tools','kicad_reference'} <= {tool['name'] for tool in tools}
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
# The same shared module and in-process tool plugin are installed in both frontends.
share = Path.home()/'.local/share/kicad-terminal'
for name in ('eda-agent-instructions.md','session-runtime.mjs','kicad-direct.mjs'):
    assert sha((share/name).read_bytes()) == sha((root/'Kicad-terminal/dist'/name).read_bytes()), name
    with zipfile.ZipFile(root/'Kicad-extension/dist'/vsix) as archive:
        assert sha(archive.read('extension/resources/kicad/'+name)) == sha((installed/'resources/kicad'/name).read_bytes()), 'vsix '+name
# Engineering references are callable and the implicit skill is installed with
# its supporting evidence schema, not merely a slash-command alias.
reference = json.loads(run(bin_dir/'kicad-direct','call','reference.plan','--payload',json.dumps({'stage':'schematic'})))
assert reference['ok'] and reference['data']['topics']
assert manifest['engineeringReferences']['topicCount'] >= 20
# KiCad tools load on demand: the always-on instructions name the loader, and the tool guidance
# (engineering references included) is built into both frontends and attached with the tools.
assert 'kicad_load' in (share/'eda-agent-instructions.md').read_text(), 'always-on instructions name the loader'
guide = (root/'composer/kicad-tools-guide.md').read_text()
assert 'reference.plan' in guide and 'release.check' in guide
assert b'# KiCad tools are loaded' in terminal.read_bytes(), 'terminal embeds the KiCad tool guidance'
assert '# KiCad tools are loaded' in (installed/'dist/extension.cjs').read_text(), 'chat embeds the KiCad tool guidance'
for base in (Path.home()/'.claude/skills', Path.home()/'.codex/skills'):
    for relative in ('SKILL.md','agents/openai.yaml','references/release-evidence.md'):
        source = root.parents[1]/'.claude/skills/kicad-engineering'/relative
        assert sha(source.read_bytes()) == sha((base/'kicad-engineering'/relative).read_bytes()), str(base/relative)
with tempfile.TemporaryDirectory(prefix='kicad-verify-') as scratch:
    resolved = subprocess.run([str(bin_dir/'Kicad'),'debug','config'], cwd=scratch, text=True, capture_output=True, timeout=120, check=True).stdout
    config = json.loads(resolved[resolved.index('{'):])
    assert str(share/'eda-agent-instructions.md') in config.get('instructions', []), 'terminal auto-use instructions'
    assert 'kicad' not in config.get('mcp', {}) and 'easyeda' not in config.get('mcp', {}), 'built-in tools bypass connector processes'
    assert (share/'session-runtime.mjs').as_uri() in config.get('plugin', []), 'terminal task continuity plugin'
    assert config['compaction']['auto'] is True and config['compaction']['prune'] is False, 'resolved native compaction defaults'
    # Bun's debug command can exit before a large pipe finishes flushing.
    # A regular file preserves the complete skill listing without changing the runtime.
    with tempfile.TemporaryFile(mode='w+') as listing:
        subprocess.run([str(bin_dir/'Kicad'),'debug','skill'], cwd=scratch, text=True, stdout=listing, stderr=subprocess.PIPE, timeout=120, check=True)
        listing.seek(0)
        skills = listing.read()
for name in ('kicad-agent','kicad-environment','kicad-drc-review','kicad-fabrication','kicad-routing','kicad-schematic-generation','kicad-step-collision'):
    assert (Path.home()/'.claude/skills'/name/'SKILL.md').is_file(), name
    assert name in skills, 'terminal skill '+name
report = {'ok':True,'terminalCommand':'Kicad','legacyCommand':'kicad','autoUse':{'instructions':str(share/'eda-agent-instructions.md'),'skills':'~/.claude/skills/kicad-*','toolTransport':'in-process','toolLoading':'on demand (kicad_load)'},'agent':manifest,'mcpToolCount':len(tools),'terminalVersion':terminal_version,'terminalSha256':sha(terminal.read_bytes()),'extensionVersion':version,'extensionPath':str(installed),'checkedFiles':['extension.cjs','main.js','bundled CLI','eda-agent-instructions.md','session-runtime.mjs'],'note':'Installation and capability verification; this does not assert a connected KiCad document or fabricate engineering validation.'}
(root/'audit/install-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
