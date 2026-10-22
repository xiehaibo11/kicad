"""Packaged Kicad workbench in a real PTY against an isolated KiCad API server.

A local model fixture calls the real in-process KiCad tools; a local registry fixture
announces a newer Kicad release. No external model, registry or user configuration is used.
Requires pyte; Pillow renders the inspection images.
"""
import codecs
import fcntl
import hashlib
import base64
import http.server
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time

import pyte

root = Path(__file__).resolve().parent
repo = root.parents[2]
binary = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist/kicad-terminal'
cli = Path(os.environ.get('KICAD_TEST_CLI', repo / 'build/kicad/KiCad.app/Contents/MacOS/kicad-cli'))
output = root / 'audit/workbench'
# The registry fixture offers the next patch after the version being built (npm/package.json).
CURRENT = json.loads((root / 'npm/package.json').read_text())['version']
NEXT = '.'.join(CURRENT.split('.')[:2] + [str(int(CURRENT.split('.')[2]) + 1)])
output.mkdir(parents=True, exist_ok=True)
COLUMNS, LINES = 160, 46
requests = []
board_path = {}


def stream(handler, chunks):
    handler.send_response(200)
    handler.send_header('Content-Type', 'text/event-stream')
    handler.end_headers()
    for delta, finish in chunks:
        chunk = {'id': 'fixture', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': 'workbench',
                 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
        handler.wfile.write(('data: ' + json.dumps(chunk) + '\n\n').encode())
        handler.wfile.flush()
    handler.wfile.write(b'data: [DONE]\n\n')
    handler.wfile.flush()


def tool_call(name, arguments):
    return [({'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'call_' + name, 'type': 'function',
              'function': {'name': name, 'arguments': json.dumps(arguments)}}]}, None), ({}, 'tool_calls')]


class Fixture(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        # Registry fixture: /@-kicadai/kicad-code/latest announces the next release.
        if self.path.rstrip('/').endswith('/kicad-code/latest'):
            tarball = b'not used by this test'
            body = {'name': '@-kicadai/kicad-code', 'version': NEXT, 'dist': {
                'tarball': f'http://127.0.0.1:{server.server_port}/kicad-code-{NEXT}.tgz',
                'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(tarball).digest()).decode()}}
            data = json.dumps(body).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        messages = body.get('messages', [])
        tools = [tool['function']['name'] for tool in body.get('tools', [])]
        results = [message for message in messages if message.get('role') == 'tool']
        system = '\n'.join(m['content'] if isinstance(m.get('content'), str) else json.dumps(m.get('content')) for m in messages if m.get('role') == 'system')
        first = next((m['content'] if isinstance(m.get('content'), str) else json.dumps(m.get('content')) for m in messages if m.get('role') == 'user'), '')
        kicad = sorted(name for name in tools if name.startswith('kicad_'))
        requests.append({'prompt': first[:48], 'kicadTools': kicad, 'guide': '# KiCad tools are loaded' in system, 'toolResults': len(results)})
        if not tools:
            return stream(self, [({'role': 'assistant', 'content': 'Workbench fixture'}, None), ({}, 'stop')])
        if 'LAZY_PROBE' in first:
            # No KiCad words: the model must load the tools itself, and they must appear in the same turn.
            if 'kicad_health' not in tools:
                if not results:
                    return stream(self, tool_call('kicad_load', {}))
                return stream(self, [({'role': 'assistant', 'content': 'LAZY_TOOLS_MISSING'}, None), ({}, 'stop')])
            if len(results) == 1:
                return stream(self, tool_call('kicad_health', {}))
            return stream(self, [({'role': 'assistant', 'content': 'LAZY_FIXTURE_OK'}, None), ({}, 'stop')])
        if not results:
            return stream(self, tool_call('kicad_health', {}))
        if len(results) == 1:
            return stream(self, tool_call('kicad_board', {'action': 'board.drc.run', 'payload': {'document': board_path['pcb']}}))
        if len(results) == 2:
            return stream(self, tool_call('kicad_board', {'action': 'board.export.svg', 'payload': {'document': board_path['pcb'], 'output': board_path['svg'], 'layers': 'F.Cu,Edge.Cuts'}}))
        return stream(self, [({'role': 'assistant', 'content': 'WORKBENCH_FIXTURE_OK'}, None), ({}, 'stop')])


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
threading.Thread(target=server.serve_forever, daemon=True).start()
result = {'fixture': 'packaged binary; real PTY; isolated KiCad API server; local model and registry fixtures', 'externalModelCalls': 0}

with tempfile.TemporaryDirectory(prefix='Kicad-workbench-') as temporary:
    temporary = Path(temporary)
    project = temporary / 'ecc83'
    shutil.copytree(repo / 'demos/ecc83', project)
    board_path['pcb'] = str(project / 'ecc83-pp.kicad_pcb')
    board_path['svg'] = str(temporary / 'out/board.svg')
    socket = temporary / 'api.sock'
    kicad_env = {**os.environ, 'KICAD_RUN_FROM_BUILD_DIR': '1', 'KICAD_CONFIG_HOME': str(temporary / 'kicad-config')}
    api = subprocess.Popen([str(cli), 'api-server', '--socket', str(socket), board_path['pcb']], env=kicad_env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    env = {key: value for key, value in os.environ.items() if not key.startswith(('OPENCODE_', 'XDG_', 'KICAD_', 'npm_config_'))}
    for key, name in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'), ('XDG_CACHE_HOME', 'cache'), ('XDG_STATE_HOME', 'state')]:
        env[key] = str(temporary / name)
        (temporary / name).mkdir()
    (temporary / 'state/opencode').mkdir()
    (temporary / 'state/opencode/kv.json').write_text(json.dumps({'kicad_draft_suggestions': False}))
    env.update({'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'OPENCODE_DISABLE_MODELS_FETCH': '1',
                'OPENCODE_DISABLE_PROJECT_CONFIG': '1', 'OPENCODE_DISABLE_TERMINAL_TITLE': '1',
                'KICAD_CLI': str(cli), 'KICAD_API_SOCKET': str(socket),
                'npm_config_registry': f'http://127.0.0.1:{server.server_port}/', 'npm_config_userconfig': str(temporary / 'none.npmrc')})
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps({
        'model': 'workbench-fixture/workbench',
        'provider': {'workbench-fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Local fixture',
                     'options': {'baseURL': f'http://127.0.0.1:{server.server_port}/v1', 'apiKey': 'local-fixture'},
                     'models': {'workbench': {'name': 'Workbench fixture', 'tool_call': True, 'limit': {'context': 64000, 'output': 2000}}}}},
        'plugin': [(root / 'dist/session-runtime.mjs').as_uri()],
        'instructions': [str(root / 'dist/eda-agent-instructions.md')],
    })
    class Terminal:
        def __init__(self, columns, lines, extra_env):
            self.master, slave = os.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', lines, columns, 0, 0))
            self.screen = pyte.Screen(columns, lines)
            self.feed = pyte.Stream(self.screen)
            self.decoder = codecs.getincrementaldecoder('utf-8')('replace')
            self.process = subprocess.Popen([str(binary)], cwd=project, env={**env, **extra_env}, stdin=slave, stdout=slave,
                                            stderr=slave, start_new_session=True)
            os.close(slave)

        def frame(self):
            return '\n'.join(self.screen.display)

        def pump(self):
            if select.select([self.master], [], [], .1)[0]:
                data = os.read(self.master, 400000)
                if b'\x1b[6n' in data:
                    os.write(self.master, b'\x1b[1;1R')
                if b'\x1b]10;?' in data:
                    os.write(self.master, b'\x1b]10;rgb:cccc/cccc/cccc\x1b\\')
                if b'\x1b]11;?' in data:
                    os.write(self.master, b'\x1b]11;rgb:1010/1010/1010\x1b\\')
                self.feed.feed(self.decoder.decode(data))

        def write(self, data):
            os.write(self.master, data)

        def wait(self, predicate, seconds=40):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                self.pump()
                if predicate():
                    return
                if self.process.poll() is not None:
                    raise AssertionError('Kicad exited: ' + self.frame())
            raise AssertionError('Timed out:\n' + self.frame())

        def settle(self, seconds=.6):
            until = time.monotonic() + seconds
            while time.monotonic() < until:
                self.pump()

        def snapshot(self, name):
            (output / f'{name}.txt').write_text(self.frame() + '\n')
            from PIL import Image, ImageDraw, ImageFont
            font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 15)
            cell_w, cell_h = 9, 19
            screen = self.screen
            image = Image.new('RGB', (screen.columns * cell_w + 40, screen.lines * cell_h + 40), '#101010')
            draw = ImageDraw.Draw(image)

            def color(value, fallback):
                return '#' + value if re.fullmatch('[0-9a-fA-F]{6}', value) else fallback
            for row in range(screen.lines):
                for col in range(screen.columns):
                    cell = screen.buffer[row][col]
                    x, y = 20 + col * cell_w, 20 + row * cell_h
                    draw.rectangle((x, y, x + cell_w, y + cell_h), fill=color(cell.bg, '#101010'))
                    if cell.data.strip():
                        draw.text((x, y), cell.data, font=font, fill=color(cell.fg, '#cccccc'))
            image.save(output / f'{name}.png')

        def close(self):
            if self.process.poll() is None:
                os.killpg(self.process.pid, signal.SIGTERM)
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(self.process.pid, signal.SIGKILL)
            os.close(self.master)

    terminals = []

    try:
        deadline = time.monotonic() + 60
        while not socket.exists() and time.monotonic() < deadline:
            time.sleep(.2)
        assert socket.exists(), 'KiCad API server did not start'
        term = Terminal(COLUMNS, LINES, {})
        terminals.append(term)
        frame, wait, settle, snapshot = term.frame, term.wait, term.settle, term.snapshot

        # Home: workbench card with live status, quick tasks, footer and the registry's newer release.
        wait(lambda: 'Describe a KiCad task' in frame() and 'Quick tasks' in frame())
        wait(lambda: 'connected' in frame() and 'ecc83-pp.kicad_pcb' in frame() and '10.99' in frame(), 60)
        wait(lambda: f'Kicad {NEXT}' in frame(), 30)
        settle()
        home = frame()
        for text in ['AI design terminal for KiCad', f'v{CURRENT}', '/kicad-drc', '/kicad-fab', '/kicad-route', '/kicad-step', '/kicad-health', f'↑ Kicad {NEXT}']:
            assert text in home, (text, home)
        assert 'OpenCode' not in home and 'opencode' not in home, home
        snapshot('home')

        # Slash commands: the KiCad quick tasks appear with upstream commands.
        term.write(b'/kicad-')
        wait(lambda: 'kicad-drc' in frame() and 'kicad-step' in frame() and 'kicad-schematic' in frame())
        settle()
        snapshot('slash')
        term.write(b'\x1b')
        settle(.3)
        term.write(b'\x7f' * 10)
        settle(.3)

        # Update dialog from our own channel; a development build gets instructions, not an install button.
        term.write(b'/update')
        wait(lambda: 'Update Kicad' in frame() or 'update' in frame())
        settle(.4)
        term.write(b'\r')
        # The dialog title appears before the check result; wait for the result itself.
        wait(lambda: 'Kicad update available' in frame() and NEXT in frame() and 'development build' in frame(), 30)
        assert 'build.sh' in frame(), frame()
        assert 'OpenCode 2' not in frame() and 'Runtime 2.0' not in frame(), frame()
        settle()
        snapshot('update')
        term.write(b'\x1b')
        wait(lambda: 'Kicad update available' not in frame())

        # Session: the model fixture calls the real KiCad tools; results appear as KiCad tool cards.
        term.write(b'Check the KiCad connection, then run DRC on the board and export an SVG.\r')
        wait(lambda: 'WORKBENCH_FIXTURE_OK' in frame(), 180)
        settle(1.5)
        session = frame()
        for text in ['KiCad system.health', 'KiCad board.drc.run', 'ecc83-pp.kicad_pcb', 'KiCad board.export.svg', 'Checks', 'DRC', 'Outputs', 'board.svg']:
            assert text in session, (text, session)
        assert Path(board_path['svg']).stat().st_size > 0
        snapshot('session')
        kicad_requests = [r for r in requests if 'Check the KiCad connection' in r['prompt']]
        assert kicad_requests and 'kicad_board' in kicad_requests[0]['kicadTools'] and kicad_requests[0]['guide'], kicad_requests[:1]

        # A new session without KiCad words starts with only the loader; kicad_load brings the tools mid-turn.
        term.write(b'/new')
        settle(.6)
        term.write(b'\r')
        wait(lambda: 'WORKBENCH_FIXTURE_OK' not in frame())
        settle(.6)
        term.write(b'LAZY_PROBE: summarize what is in this folder.\r')
        wait(lambda: 'LAZY_FIXTURE_OK' in frame() or 'LAZY_TOOLS_MISSING' in frame(), 120)
        assert 'LAZY_FIXTURE_OK' in frame(), frame()
        settle(1)
        snapshot('lazy')
        lazy = [r for r in requests if 'LAZY_PROBE' in r['prompt'] and r['kicadTools']]
        assert lazy[0]['kicadTools'] == ['kicad_load'] and not lazy[0]['guide'], lazy
        assert 'kicad_health' in lazy[1]['kicadTools'] and lazy[1]['guide'], lazy
        term.close()

        # Narrow terminal without a running KiCad: single column, CLI-only status, quick-task hint.
        narrow = Terminal(60, 24, {'KICAD_API_SOCKET': str(temporary / 'not-running.sock')})
        terminals.append(narrow)
        narrow.wait(lambda: 'Describe a KiCad task' in narrow.frame() and 'not running' in narrow.frame() and '10.99' in narrow.frame(), 60)
        narrow.settle()
        text = narrow.frame()
        assert 'Type /kicad- for quick tasks' in text and 'PRJ' in text and 'ecc83-pp.kicad_pro' in text, text
        narrow.snapshot('home-narrow')
        result.update({'passed': True, 'checks': [
            'home workbench card: brand, version, live IPC/CLI status, open board, quick tasks',
            'home footer shows KiCad status and the newer release from the Kicad registry channel',
            'KiCad quick-task slash commands are listed by autocomplete',
            '/update uses the Kicad channel and gives development builds instructions instead of installing',
            'real in-process KiCad tools (health, DRC, SVG export) rendered as KiCad tool cards',
            'session sidebar shows KiCad connection, latest DRC result and produced files',
            'KiCad request: KiCad tools and guidance present from the first step',
            'unrelated wording: only kicad_load at first; after it runs, KiCad tools and guidance appear in the same turn',
            'narrow 60x24 terminal without KiCad: single-column card, IPC not running, CLI version, project file and quick-task hint'],
            'modelRequests': requests})
    finally:
        for item in terminals:
            try:
                item.close()
            except OSError:
                pass
        os.killpg(api.pid, signal.SIGTERM)
        try:
            api.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(api.pid, signal.SIGKILL)
        server.shutdown()
        (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')

print(json.dumps({key: result[key] for key in ('passed', 'checks') if key in result}, ensure_ascii=False))
