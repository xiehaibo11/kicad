#!/usr/bin/env python3
"""The packaged runtime's KiCad tool wrappers, end to end through a local model fixture.

Checks what the model is given (the shared runtime's schemas) and how calls behave: argument
errors, paths relative to the session, write prompts per action (read-only operations never ask),
and a refused write ending the turn like OpenCode's own tools. No real model, keys or user data.
"""
from pathlib import Path
import http.server, json, os, socket, subprocess, sys, tempfile, threading, time, urllib.request

root = Path(__file__).resolve().parent
binary = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'dist/kicad-terminal'
bundle = root.parent / 'direct/dist/kicad-direct.mjs'
expected = {tool['name']: tool for tool in json.loads(subprocess.check_output(
    ['node', '--input-type=module', '-e', 'const m=await import(process.argv[1]);console.log(JSON.stringify(m.toolsList()))', bundle.as_uri()], text=True))}
PLAN = [
    ('kicad_health', {}),
    ('kicad_board', {'action': 'library.list'}),
    ('kicad_spec_validate', {'file': 'missing-spec.json'}),
    ('kicad_workflow', {'operation': 'status', 'project': '.'}),
    ('kicad_board', {'action': 'board.items.delete', 'payload': {'document': 'x.kicad_pcb', 'ids': ['a']}}),
]
requests, asks = [], []


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        tools = {item['function']['name']: item['function'] for item in body.get('tools') or []}
        step = sum(1 for message in body.get('messages', []) if message.get('role') == 'tool')
        if tools:
            requests.append(tools)
        if tools and step < len(PLAN):
            name, args = PLAN[step]
            delta, finish = {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': f'call_{step}', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(args)}}]}, 'tool_calls'
        else:
            delta, finish = {'role': 'assistant', 'content': 'done' if tools else 'Tools'}, 'stop'
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        for part, reason in [(delta, None), ({}, finish)]:
            chunk = {'id': 'fixture', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': 'fixture', 'choices': [{'index': 0, 'delta': part, 'finish_reason': reason}]}
            self.wfile.write(('data: ' + json.dumps(chunk) + '\n\n').encode()); self.wfile.flush()
        self.wfile.write(b'data: [DONE]\n\n')


def same_schema(want, got, at):
    """The JSON Schema the model sees means the same as the shared definition."""
    if 'enum' in want:
        assert got.get('enum') == want['enum'], at + ' enum'
    if 'type' in want:
        assert got.get('type') == want['type'], (at, got.get('type'), want['type'])
    if 'minimum' in want:
        assert got.get('minimum') == want['minimum'], at + ' minimum'
    if want.get('type') == 'array':
        same_schema(want['items'], got.get('items', {}), at + '[]')
    if want.get('type') == 'object':
        assert set(got.get('required', [])) == set(want.get('required', [])), (at, got.get('required'), want.get('required'))
        assert set(got.get('properties', {})) == set(want.get('properties', {})), at + ' properties'
        for key, sub in want.get('properties', {}).items():
            same_schema(sub, got['properties'][key], at + '.' + key)
        if want.get('additionalProperties') is True:
            assert got.get('additionalProperties', True) is not False, at + ' must accept any payload field'


model = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Model)
threading.Thread(target=model.serve_forever, daemon=True).start()
with tempfile.TemporaryDirectory(prefix='Kicad-tools-native-') as name:
    directory = Path(name)
    env = {key: value for key, value in os.environ.items() if not key.startswith(('OPENCODE_', 'XDG_'))}
    for variable, folder in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'), ('XDG_CACHE_HOME', 'cache'), ('XDG_STATE_HOME', 'state')]:
        (directory / folder).mkdir(); env[variable] = str(directory / folder)
    config = {'model': 'fixture/fixture', 'plugin': [(binary.parent / 'session-runtime.mjs').as_uri()],
              'provider': {'fixture': {'npm': '@ai-sdk/openai-compatible', 'options': {'apiKey': 'fixture-only', 'baseURL': f'http://127.0.0.1:{model.server_port}/v1'},
                                       'models': {'fixture': {'name': 'fixture', 'limit': {'context': 64000, 'output': 2000}}}}},
              'permission': {'*': 'allow', 'kicad_write': 'ask'}}
    env.update({'OPENCODE_DISABLE_MODELS_FETCH': '1', 'OPENCODE_DISABLE_AUTOUPDATE': '1', 'OPENCODE_DISABLE_PROJECT_CONFIG': '1', 'OPENCODE_CONFIG_CONTENT': json.dumps(config)})
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    log = open(directory / 'server.log', 'w')
    child = subprocess.Popen([str(binary), 'serve', '--hostname', '127.0.0.1', '--port', str(port)], cwd=directory, env=env, stdout=log, stderr=log)

    def call(path, body=None, timeout=60):
        request = urllib.request.Request(f'http://127.0.0.1:{port}' + path, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)

    try:
        for _ in range(150):
            try:
                if call('/global/health').get('healthy'):
                    break
            except (OSError, ValueError):
                time.sleep(.1)
        else:
            raise RuntimeError('native server did not start')
        session = call('/session', {})['id']
        sent = {}
        def send():
            try:
                sent['result'] = call(f'/session/{session}/message', {'model': {'providerID': 'fixture', 'modelID': 'fixture'},
                                      'parts': [{'type': 'text', 'text': 'Check the KiCad PCB tools.'}]}, timeout=300)
            except Exception as error:
                sent['error'] = repr(error)
        worker = threading.Thread(target=send); worker.start()
        while worker.is_alive():
            for pending in call('/permission'):
                asks.append(pending.get('patterns'))
                call(f"/permission/{pending['id']}/reply", {'reply': 'reject'})
            time.sleep(.1)
        assert 'error' not in sent, sent
        parts = [part for message in call(f'/session/{session}/message') for part in message['parts'] if part['type'] == 'tool']
        output = lambda part: json.loads(part['state']['output'])

        # The model sees the shared runtime's tools with the same schemas and descriptions.
        offered = requests[0]
        assert {name for name in offered if name.startswith('kicad_')} == set(expected) | {'kicad_load'}, sorted(offered)
        for tool_name, tool in expected.items():
            assert offered[tool_name]['description'] == tool['description'], tool_name
            same_schema(tool['inputSchema'], offered[tool_name]['parameters'], tool_name)
        assert output(parts[0])['ok'] is True and parts[0]['tool'] == 'kicad_health'
        wrong = output(parts[1])['error']
        assert wrong['code'] == 'INVALID_ARGUMENTS' and 'kicad_library' in wrong['message'] and len(wrong['message']) < 200, wrong
        missing = output(parts[2])['error']['message']
        assert str(directory.resolve() / 'missing-spec.json') in missing or str(directory / 'missing-spec.json') in missing, missing
        assert output(parts[3])['ok'] is True, 'a read-only operation runs without a write prompt'
        # One prompt, for the action itself; refusing it ends the turn like OpenCode's own tools.
        assert asks == [['board.items.delete']], asks
        assert parts[4]['state']['status'] == 'error' and 'rejected' in parts[4]['state']['error'], parts[4]['state']
        assert len(requests) == len(PLAN), f'the model was asked again after the refusal: {len(requests)} requests'

        access = {item['name']: item['access'] for item in call('/kicad/tool-references')['tools']}
        assert access['kicad_reference'] == access['kicad_load'] == 'read-only' and access['kicad_board'] != 'read-only', access
        print('KiCad tool wrappers passed: shared schemas and descriptions, short argument errors, session-relative paths, '
              'per-action write prompts (none for read-only operations), refusal ends the turn, catalog access from the shared definitions.')
    finally:
        child.terminate(); child.wait(timeout=10); log.close(); model.shutdown()
