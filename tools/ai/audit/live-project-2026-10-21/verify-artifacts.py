#!/usr/bin/env python3
"""Verify installed payload identity and absence of retired routing executables."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import tarfile
import zipfile

base = Path(__file__).resolve().parent
root = base.parents[3]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
bundle = root/'tools/ai/direct/dist/kicad-direct.mjs'
digest = sha(bundle)
copies = [
    root/'tools/ai/Kicad-terminal/dist/kicad-direct.mjs',
    root/'tools/ai/vscode-extension/resources/kicad-direct.mjs',
    root/'tools/ai/Kicad-terminal/npm/resources/kicad-direct.mjs',
    Path.home()/'.local/share/kicad-terminal/kicad-direct.mjs',
    Path.home()/'.vscode/extensions/kicad-agent.kicad-0.4.27/resources/kicad/kicad-direct.mjs',
    Path('/opt/homebrew/lib/node_modules/@-kicadai/kicad-code/resources/kicad-direct.mjs'),
    root/'build/kicad/KiCad.app/Contents/MacOS/kicad-direct.mjs',
]
records = []
for p in copies:
    assert sha(p) == digest, f'Stale installed module: {p}'
    records.append({'path': str(p), 'sha256': digest})
artifacts = [
    root/'tools/ai/Kicad-extension/dist/kicad-0.4.27.vsix',
    root/'tools/ai/vscode-extension/kicad-agent-vscode-0.1.2.vsix',
    root/'tools/ai/Kicad-terminal/npm/-kicadai-kicad-code-0.1.2.tgz',
    root/'tools/ai/direct/dist/kicad-native-tools.zip',
    Path('/Users/mosc/Downloads/hardware/tools/easyeda-agent-release/easyeda-agent-connector.eext'),
    Path('/Users/mosc/Downloads/hardware/tools/easyeda-agent-release/kicad-native-tools.zip'),
]
artifact_records = []
for p in artifacts:
    record = {'path': str(p), 'bytes': p.stat().st_size, 'sha256': sha(p)}
    if p.suffix in ('.zip', '.eext', '.vsix'):
        with zipfile.ZipFile(p) as z:
            names = z.namelist()
            relay = [n for n in names if n.endswith(('.go', 'go.mod', 'go.sum', '/kicad-agent', 'easyeda-mcp.mjs'))]
            assert not relay, (str(p), relay)
            module = next(n for n in names if n.endswith('kicad-direct.mjs'))
            assert hashlib.sha256(z.read(module)).hexdigest() == digest
            record.update(entries=len(names), retiredRelayEntries=relay)
    else:
        with tarfile.open(p) as t:
            assert hashlib.sha256(t.extractfile('package/resources/kicad-direct.mjs').read()).hexdigest() == digest
            package = json.load(t.extractfile('package/package.json'))
            assert package['bin'] == {'Kicad': 'bin/Kicad.mjs'}
    artifact_records.append(record)
assert sha(artifacts[-1]) == sha(artifacts[-2]) == sha(artifacts[-3])
for p in [root/'tools/ai/kicad-agent', root/'tools/ai/upstream/easyeda-agent', root/'tools/ai/direct/mcp.mjs', Path.home()/'.local/bin/kicad-agent', Path.home()/'.local/share/kicad-terminal/easyeda-mcp.mjs']:
    assert not p.exists(), str(p)
source_go = [str(p) for p in (root/'tools/ai').rglob('*.go') if not {'node_modules', 'cache', '.git'} & set(p.parts)]
assert not source_go, source_go
native, old = [], []
# Only report executable paths; do not expose model credentials in argv/environment.
for line in subprocess.check_output(['ps', '-axo', 'pid=,ppid=,comm='], text=True).splitlines():
    fields = line.strip().split(None, 2)
    if len(fields) != 3:
        continue
    pid, ppid, command = fields
    if 'kicad' in command.lower():
        native.append({'pid': int(pid), 'ppid': int(ppid), 'command': command})
    if Path(command).name.lower() in ('kicad-agent', 'easyeda-mcp.mjs', 'easyeda-agent'):
        old.append({'pid': int(pid), 'command': command})
for line in subprocess.check_output(['ps', '-axo', 'pid=,args='], text=True).splitlines():
    fields = line.strip().split(None, 1)
    if len(fields) == 2:
        matches = re.findall(r'(?:^|[\s/])((?:easyeda-mcp\.mjs|easyeda-agent-connector\.eext|kicad-agent)(?:\.exe)?)(?=\s|$)', fields[1])
        if matches:
            old.append({'pid': int(fields[0]), 'legacyExecutable': matches})
assert not old, old
report = {
    'ok': True, 'bundleSha256': digest, 'copies': records,
    'artifacts': artifact_records, 'legacyExecutableProcesses': old,
    'nativeProcesses': native, 'sourceGoFiles': source_go,
    'preserved': 'Native C++ EasyEDA importers, original-design migration backups, attribution/licenses and unrelated global EasyEDA tools are not KiCad tool relays.',
}
(base/'artifact-verification.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({'ok': True, 'bundle': digest, 'copies': len(copies), 'artifacts': len(artifacts), 'retiredRelayProcesses': len(old)}))
