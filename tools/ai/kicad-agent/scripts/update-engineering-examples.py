#!/usr/bin/env python3
"""Refresh the complete local KiCad demo inventory, never modifying demo files."""
import hashlib
import json
from datetime import date
from pathlib import Path

root = Path(__file__).resolve().parents[4]
extensions = {'.kicad_pro', '.kicad_pcb', '.kicad_sch', '.kicad_sym', '.kicad_mod',
              '.kicad_dru', '.cir', '.spice', '.lib', '.sub', '.step', '.stp', '.wrl'}
examples = []
for project in sorted((root / 'demos').rglob('*.kicad_pro')):
    files = [{'path': str(path.relative_to(root)),
              'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
             for path in sorted(project.parent.rglob('*'))
             if path.is_file() and
             (path.suffix in extensions or path.name in {'fp-lib-table', 'sym-lib-table'})]
    examples.append({'id': str(project.relative_to(root / 'demos')).removesuffix('.kicad_pro').replace('/', '--'),
                     'name': project.stem, 'project': str(project.relative_to(root)),
                     'files': files, 'reviewStatus': 'indexed-not-electrically-qualified'})
destination = root / 'tools/ai/kicad-agent/internal/engineering/examples.json'
destination.write_text(json.dumps({'schemaVersion': 1, 'generatedAt': date.today().isoformat(),
                                  'sourceRoot': 'demos', 'examples': examples},
                                 ensure_ascii=False, indent=2) + '\n')
print(f'Indexed {len(examples)} original KiCad projects: {destination}')
