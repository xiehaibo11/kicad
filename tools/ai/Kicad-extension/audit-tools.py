#!/usr/bin/env python3
"""Offline source inventory. Counts are not a live capability or coverage proof."""
import argparse
import collections
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
ACTION_FILES = (
    'common/tool/actions.cpp', 'pcbnew/tools/pcb_actions.cpp',
    'eeschema/tools/sch_actions.cpp', 'gerbview/tools/gerbview_actions.cpp',
    'pagelayout_editor/tools/pl_actions.cpp',
    '3d-viewer/3d_viewer/tools/eda_3d_actions.cpp',
    'cvpcb/tools/cvpcb_actions.cpp', 'kicad/tools/kicad_manager_actions.cpp',
)


def inventory(agent=None):
    native = []
    unparsed = []
    pattern = re.compile(r'TOOL_ACTION\s+(\w+::\w+)\s*\(\s*TOOL_ACTION_ARGS\(\)'
                         r'(.*?)(?=\nTOOL_ACTION|\Z)', re.S)
    for filename in ACTION_FILES:
        source = (ROOT / filename).read_text()
        for match in pattern.finditer(source):
            record = {'symbol': match[1], 'source': filename,
                      'line': source.count('\n', 0, match.start()) + 1}
            name = re.search(r'\.Name\(\s*"([^"]+)"', match[2])
            if not name:
                unparsed.append(record)
                continue
            record['name'] = name[1]
            record['interactiveActivation'] = '.Flags( AF_ACTIVATE' in match[2]
            record['coverage'] = 'requires semantic mapping to automation actions'
            native.append(record)

    catalog = ROOT / 'tools/ai/direct/data/actions.json'
    typed = [{**item, 'source': str(catalog.relative_to(ROOT))} for item in json.loads(catalog.read_text())]

    runtime = None
    if agent:
        envelope = json.loads(subprocess.check_output(['node', str(agent), 'actions'], text=True))
        runtime = envelope['data']['actions']
        missing = sorted({item['name'] for item in typed} - {item['name'] for item in runtime})
        if missing:
            raise RuntimeError('Shared runtime is stale; source actions missing: ' + ', '.join(missing))
        positions = {item['name']:item for item in typed}
        typed = [{**item, 'source':positions.get(item['name'], {}).get('source'),
                  'line':positions.get(item['name'], {}).get('line')} for item in runtime]

    handlers = []
    for directory in ('common/api', 'pcbnew/api', 'eeschema/api'):
        for file in sorted((ROOT / directory).glob('*.cpp')):
            source = file.read_text()
            for match in re.finditer(r'registerHandler<\s*([\w:]+)\s*,\s*([\w:]+)\s*>', source):
                handlers.append({'request': match[1], 'response': match[2],
                                 'source': str(file.relative_to(ROOT)),
                                 'line': source.count('\n', 0, match.start()) + 1})

    def revision(directory):
        return subprocess.check_output(['git', '-C', str(directory), 'rev-parse', 'HEAD'], text=True).strip()

    return {
        'warning': 'Static source inventory only. Counts do not measure coverage. '
                   'Constructor registrations may repeat and runtime handlers depend on the active editor. '
                   'Native tools may need selections, mouse input, parameters or dialogs; '
                   'RunAction submission does not prove completion.',
        'automationInventory': 'compiled runtime' if runtime is not None else 'all source action files (offline)',
        'revision': revision(ROOT),
        'claudixRevision': revision(ROOT / 'tools/ai/upstream/Kicad-extension'),
        'summary': {
            'literalNamedNativeActions': len(native),
            'nativeActionsBySource': dict(collections.Counter(x['source'] for x in native)),
            'unparsedNativeDefinitions': len(unparsed),
            'typedAutomationActions': len(typed),
            'automationByBackend': dict(collections.Counter(x['backend'] for x in typed)),
            'apiRegistrationSites': len(handlers),
        },
        'nativeActions': native, 'unparsedNativeDefinitions': unparsed,
        'typedAutomationActions': typed, 'apiRegistrationSites': handlers,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Write the complete source inventory as JSON.')
    parser.add_argument('--agent', type=Path, help='Read actions from this compiled agent and reject a stale catalog.')
    args = parser.parse_args()
    report = inventory(args.agent)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))
