#!/usr/bin/env python3
"""Extract only public tool records from our bounded frontend acceptance rounds.

Later prompts entered by the human in those same UIs are deliberately excluded.
No assistant reasoning, provider credentials or unrelated conversations are read.
"""
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3

base = Path(__file__).resolve().parent
root = base.parents[3]
project = root / 'projects/RK3308B_IPC 摄像头模块'


def write(name, data):
    (base / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def decode(content):
    if isinstance(content, list):
        content = '\n'.join(x.get('text', '') for x in content if x.get('type') == 'text')
    try:
        return json.loads(content)
    except (TypeError, ValueError):
        return content


chat_source = Path.home() / '.claude/projects/-Users-mosc-Downloads-Kicad/892deab8-7e87-4e7f-954c-cb3fa660e6cf.jsonl'
chat_tools, by_id, chat_users, chat_end = [], {}, 0, None
for line in chat_source.read_text().splitlines():
    record = json.loads(line)
    content = record.get('message', {}).get('content', [])
    text = content if isinstance(content, str) else '\n'.join(
        x.get('text', '') for x in content if x.get('type') == 'text')
    if record.get('type') == 'user' and text:
        chat_users += 1
        if chat_users > 1:
            chat_end = record.get('timestamp')
            break
    if not isinstance(content, list):
        continue
    for item in content:
        if item.get('type') == 'tool_use':
            tool_record = {
                'id': item['id'], 'timestamp': record.get('timestamp'),
                'tool': item['name'], 'input': item.get('input', {}),
            }
            chat_tools.append(tool_record)
            by_id[item['id']] = tool_record
        elif item.get('type') == 'tool_result' and item.get('tool_use_id') in by_id:
            by_id[item['tool_use_id']].update(
                result=decode(item.get('content')), transportError=item.get('is_error', False))
write('chat-final/tool-trace.json', {
    'sessionId': chat_source.stem, 'source': str(chat_source),
    'boundary': 'First acceptance prompt only; subsequent human prompts excluded.',
    'exclusiveEnd': chat_end, 'tools': chat_tools,
})

session_id = 'ses_ea0434eeeffen6xkzkNecJiMh8'
con = sqlite3.connect(f'file:{Path.home()}/.local/share/opencode/opencode.db?mode=ro', uri=True)
users = [(mid, tm) for mid, tm, raw in con.execute(
    'SELECT id,time_created,data FROM message WHERE session_id=? ORDER BY time_created', (session_id,))
    if json.loads(raw).get('role') == 'user']
cutoff = users[1][1] if len(users) > 1 else 2**63-1
terminal_tools = []
for tm, raw in con.execute(
        'SELECT time_created,data FROM part WHERE session_id=? AND time_created<? ORDER BY time_created',
        (session_id, cutoff)):
    item = json.loads(raw)
    if item.get('type') != 'tool':
        continue
    state = item.get('state', {})
    terminal_tools.append({
        'timestamp': datetime.fromtimestamp(tm / 1000, timezone.utc).isoformat(),
        'tool': item.get('tool'), 'input': state.get('input', {}),
        'status': state.get('status'), 'result': decode(state.get('output')),
    })
con.close()
write('terminal-final/tool-trace.json', {
    'sessionId': session_id, 'boundary': 'First acceptance prompt only; subsequent human prompts excluded.',
    'exclusiveEndUnixMs': cutoff, 'tools': terminal_tools,
})


def find(tools, action):
    candidates = [r['result'] for r in tools if isinstance(r.get('result'), dict)
                  and r['result'].get('action') == action]
    return candidates[-1] if candidates else None


def connectivity(tools):
    row = next(t for t in tools if t.get('input', {}).get('action') == 'board.connectivity.prove')
    result = row['result']
    source = 'frontend tool result'
    if isinstance(result, str) and 'Full output saved to:' in result:
        filename = re.search(r'Full output saved to: (\S+)', result).group(1)
        result = json.loads(Path(filename).read_text())
        source = filename
    if isinstance(result, dict):
        detail = result['error']['detail']
        summary = {'code': result['error']['code'], 'unconnectedNetCount': len(detail['unconnectedNets']),
                   'unconnectedItemCount': detail['unconnectedCount'], 'danglingItemCount': len(detail['danglingItems'])}
    else:
        # The SDK retained the report tail but truncated the endpoint list in the
        # middle. Extract only retained facts, without pretending it is full JSON.
        nets = json.loads(re.search(r'"unconnectedNets":(\[[^\]]*\])', result).group(1))
        summary = {'code': 'CONNECTIVITY_UNPROVEN', 'unconnectedNetCount': len(nets),
                   'unconnectedItemCount': int(re.search(r'"unconnectedCount":(\d+)', result).group(1)),
                   'danglingItemCount': len(json.loads(re.search(r'"danglingItems":(\[[^\]]*\])', result).group(1)))}
    return {**summary, 'summarySource': source, 'frontendOutputTruncated': isinstance(row['result'], str)}


def erc_summary(relative):
    report = json.loads((base / relative).read_text())
    violations = [v for s in report['sheets'] for v in s.get('violations', [])]
    return {'total': len(violations), 'bySeverity': dict(Counter(v['severity'] for v in violations)),
            'sheets': len(report['sheets'])}


def frontend(tools, native_prefix):
    health = find(tools, 'system.health')
    return {
        'totalToolCalls': len(tools),
        'nativeToolCalls': sum(t['tool'].startswith(native_prefix) for t in tools),
        'allReturned': all('result' in t and t.get('status', 'completed') == 'completed' for t in tools),
        'ipc': health['data']['ipc'],
        'documents': [t['result'] for t in tools if isinstance(t.get('result'), dict)
                      and t['result'].get('action') == 'document.list'],
        'actions': [t['input']['action'] for t in tools if 'action' in t.get('input', {})],
        'drc': find(tools, 'board.drc.live')['data']['summary'],
        'erc': find(tools, 'schematic.erc.live')['data']['summary'],
        'checkedPcbCopy': find(tools, 'board.drc.live')['data']['checkedCopy'],
        'connectivity': connectivity(tools),
        'retryErrors': [t['result'].get('error') for t in tools if isinstance(t.get('result'), dict)
                        and not t['result'].get('ok') and
                        t['result'].get('error', {}).get('code') != 'CONNECTIVITY_UNPROVEN'],
    }


chat = frontend(chat_tools, 'mcp__kicad__')
terminal = frontend(terminal_tools, 'kicad_')
assert chat['ipc']['available'] and terminal['ipc']['available']
assert chat['allReturned'] and terminal['allReturned']
assert len(chat['documents']) == len(terminal['documents']) == 2

drcs = [json.loads((base / f'drc-complete-{n}-result.json').read_text()) for n in (1, 2)]
summaries = [{k: v for k, v in d['data']['summary'].items() if k != 'reportPath'} for d in drcs]
assert summaries[0] == summaries[1]


def drc_canonical(filename):
    report = json.loads((base / filename).read_text())
    rows = []
    for category in ('violations', 'unconnected_items', 'schematic_parity'):
        for item in report.get(category, []):
            rows.append(json.dumps({
                'category': category, 'type': item['type'], 'severity': item['severity'],
                'description': item['description'],
                'items': sorted((json.dumps(x, sort_keys=True) for x in item.get('items', []))),
            }, sort_keys=True))
    return sorted(rows)


original = json.loads((base / 'final-validation-before.json').read_text())
after = json.loads((base / 'final-validation-after.json').read_text())
now = {name: hashlib.sha256((project / name).read_bytes()).hexdigest() for name in original}
write('final-validation-current.json', now)
design_unchanged = original == after == now
coverage = json.loads((base / 'coverage-matrix.json').read_text())
for action in ('audit.run', 'release.check'):
    filename = f'{action}-result.json'
    gate = json.loads((base / filename).read_text())
    assert not gate['ok']
    entry = next(x for x in coverage['actions'] if x['action'] == action)
    if not any(o.get('file') == filename for o in entry['observations']):
        entry['observations'].append({'file': filename, 'ok': gate['ok'], 'error': gate['error'],
                                      'scope': 'Actual RK3308B project, read-only gate check.'})
write('coverage-matrix.json', coverage)

report = {
    'createdAt': datetime.now(timezone.utc).isoformat(),
    'project': str(project), 'chat': chat, 'terminal': terminal,
    'onlineModels': 'Actual configured DeepSeek Flash in both visible frontends; not fixture-model responses.',
    'frontendsNote': 'Default per-track first-error DRC counts may vary with native traversal order. Both runs inspected identical native PCB snapshot content.',
    'allTrackErrorsDrc': {'options': {'severityAll': True, 'schematicParity': True, 'allTrackErrors': True},
                    'summary': summaries[0], 'twoRunSummaryIdentical': True,
                    'twoRunItemRecordsIdenticalIgnoringOrder': drc_canonical('drc-complete-1.json') == drc_canonical('drc-complete-2.json'),
                    'limitation': 'Native DRC has per-type report limits (199/499). Clearance=499, track_width=199 and net_conflict=199 reach those limits. Concurrent native traversal can retain different item pairs; 1572 is a bounded report count, not an exhaustive count of all unique violations.',
                    'limitSource': 'pcbnew/drc/drc_engine.cpp:57-58, 906-929, 2308-2317'},
    'erc': {'chat': erc_summary('chat-final/erc.json'), 'terminal': erc_summary('terminal-final/erc.json')},
    'designFiles': {'count': len(original), 'finalAcceptanceHashesUnchanged': design_unchanged,
                    'note': 'Initial opening/restoration had earlier file changes with unresolved provenance. Both original/opened snapshots are preserved. This hash assertion covers only the later final acceptance round.'},
    'coverage': coverage['summary'],
    'routing': {'chat': 'Extension host -> in-process SDK binding -> shared JavaScript -> native KiCad IPC/CLI/files',
                'terminal': 'Native terminal process -> in-process plugin -> same shared JavaScript -> native KiCad IPC/CLI/files',
                'nativeIpcSocket': '/tmp/kicad/api.sock',
                'externalUtilities': 'Directly executed external utilities are explicitly identified; these are not all KiCad algorithms.'},
}
write('acceptance.json', report)
print(json.dumps({'chatCalls': len(chat_tools), 'terminalCalls': len(terminal_tools),
                  'ipcConnectedBoth': True, 'allTrackErrorsDrcReportedCount': summaries[0]['total'],
                  'erc': report['erc'], 'designFilesUnchangedFinalRound': design_unchanged,
                  'drcItemRecordsIdentical': report['allTrackErrorsDrc']['twoRunItemRecordsIdenticalIgnoringOrder']}, ensure_ascii=False))
