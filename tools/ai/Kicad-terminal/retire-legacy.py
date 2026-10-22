#!/usr/bin/env python3
"""Retire known obsolete middleware; preserve credentials and unrelated tools."""
from pathlib import Path
import datetime
import hashlib
import json
import shutil
import sys


def retire(prefix):
    prefix = Path(prefix).expanduser().resolve()
    share = prefix / 'share/kicad-terminal'
    candidates = [prefix / 'bin/kicad-agent', share / 'easyeda-mcp.mjs']
    candidates += list(share.glob('Kicad-before-npm-*.sh'))
    existing = [p for p in candidates if p.is_file() or p.is_symlink()]
    if not existing:
        return {'retired': []}
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    backup = prefix / 'state/kicad/retired-middleware' / stamp
    backup.mkdir(parents=True, mode=0o700)
    records = []
    for source in existing:
        destination = backup / source.relative_to(prefix)
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(source.read_bytes()).hexdigest() if source.is_file() else None
        shutil.move(str(source), destination)
        records.append({'path': str(source), 'backup': str(destination), 'sha256': digest})
    report = {'retired': records, 'note': 'Credential files and user model settings are preserved.'}
    (backup / 'manifest.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    print(json.dumps(retire(sys.argv[1]), ensure_ascii=False))
