#!/usr/bin/env python3
"""Exercise the real installer with a legacy CLI symlink and paths containing spaces."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


with tempfile.TemporaryDirectory(prefix='Kicad install ') as directory:
    prefix = Path(directory) / 'local tools'
    binary = prefix / 'bin'
    binary.mkdir(parents=True)
    native = binary / 'kicad-cli'
    native.write_text('#!/bin/sh\nprintf "native-cli-preserved\\n"\n')
    native.chmod(0o755)
    (binary / 'kicad').symlink_to('kicad-cli')
    original_cli = native.read_bytes()
    config = Path(directory) / '.config/opencode/opencode.json'
    config.parent.mkdir(parents=True)
    config.write_text('{"model":"user/selected-model","compaction":{"auto":false}}')
    env = {**os.environ, 'HOME': directory, 'XDG_CONFIG_HOME': str(config.parent.parent)}
    # --help and invalid arguments never install anything.
    subprocess.run(['bash', root / 'install.sh', '--help'], env=env, check=True, capture_output=True)
    assert not (binary / 'Kicad').is_file() or (binary / 'Kicad').is_symlink()
    bad = subprocess.run(['bash', root / 'install.sh', '--prefix'], env=env, capture_output=True)
    assert bad.returncode == 2
    for attempt in range(2):
        subprocess.run(['bash', root / 'install.sh', '--prefix', prefix], env=env, check=True, capture_output=True)
        assert native.read_bytes() == original_cli, 'must not write through the old kicad -> kicad-cli symlink'
        assert 'Kicad' in {entry.name for entry in binary.iterdir()}, 'canonical case on APFS'
        assert sha(binary / 'Kicad') == sha(root / 'launcher.sh')
        assert sha(binary / 'kicad-terminal') == sha(root / 'dist/kicad-terminal')
        for command in ('Kicad', 'kicad', 'kicad-terminal'):
            version = subprocess.check_output([binary / command, '--version'], env=env, text=True).strip()
            assert version == '1.19.3', (command, version)
        help_text = subprocess.check_output([binary / 'Kicad', '--help'], env=env, text=True, stderr=subprocess.STDOUT)
        assert 'Kicad [project]' in help_text and 'kicad-terminal ' not in help_text
        assert json.loads(config.read_text()) == {'model': 'user/selected-model', 'compaction': {'auto': False}}
        for name in ('eda-agent-instructions.md', 'easyeda-mcp.mjs', 'session-runtime.mjs', 'LICENSE-OpenCode.txt'):
            assert sha(prefix / 'share/kicad-terminal' / name) == sha(root / 'dist' / name)
    assert not list(binary.glob('.Kicad-install.*')), 'temporary installation directories are removed'
print('Installer passed: real runtime, reinstall, Kicad help/version, lowercase compatibility, native CLI symlink, paths with spaces, existing model/config preserved.')
