#!/usr/bin/env python3
"""Record and verify the exact sources and deliverables of a local KiCad build."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sources(component):
    paths = [p for p in component.iterdir() if p.is_file() and p.suffix in ('.sh', '.mjs', '.py', '.yaml', '.md', '.txt')]
    paths += [p for p in (component / 'overlay').rglob('*') if p.is_file()]
    paths += [p for p in (component.parent / 'composer').rglob('*') if p.is_file()]
    paths += [Path(__file__).resolve()]
    entries = [(str(p.relative_to(component.parent)), digest(p)) for p in paths]
    return hashlib.sha256(json.dumps(sorted(entries), separators=(',', ':')).encode()).hexdigest()


def main():
    mode, raw, *extra = sys.argv[1:]
    component = Path(raw).resolve()
    manifest_path = component / 'dist/build-manifest.json'
    if mode == 'verify':
        manifest = json.loads(manifest_path.read_text())
        if manifest['sourceSha256'] != sources(component):
            raise SystemExit(f'Stale build sources: rebuild {component}')
        for relative, expected in manifest['files'].items():
            if digest(component / 'dist' / relative) != expected:
                raise SystemExit(f'Build artifact mismatch: {relative}')
        print(json.dumps({'verified': True, 'kind': manifest['kind'], 'version': manifest['version']}))
        return
    upstream = Path(extra[0])
    if mode == 'extension':
        artifact = max((component / 'dist').glob('*.vsix'), key=lambda p: p.stat().st_mtime_ns)
        version = artifact.stem.removeprefix('kicad-')
        artifacts = [artifact]
    elif mode == 'terminal':
        version = json.loads((component / 'upstream.json').read_text()).get('version', '1.19.3')
        artifacts = [component / 'dist' / name for name in ('kicad-terminal', 'upstream.json', 'composer.json', 'waiting.json', 'branding.json', 'LICENSE-OpenCode.txt', 'eda-agent-instructions.md', 'easyeda-mcp.mjs', 'session-runtime.mjs')]
    else:
        raise SystemExit('usage: build-manifest.py extension|terminal|verify COMPONENT [UPSTREAM]')
    manifest = {
        'schemaVersion': 1, 'kind': mode, 'version': version,
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'upstreamCommit': subprocess.check_output(['git', '-C', str(upstream), 'rev-parse', 'HEAD'], text=True).strip(),
        'sourceSha256': sources(component),
        'files': {p.name: digest(p) for p in artifacts},
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Build manifest: {manifest_path}')


if __name__ == '__main__':
    main()
