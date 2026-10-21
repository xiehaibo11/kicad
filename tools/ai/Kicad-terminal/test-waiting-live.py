"""Packaged TUI in a real PTY, using an isolated local model fixture and no tools.

Requires pyte (terminal parser); Pillow is only used for the inspection image.
No external model requests or user sessions/configuration are used.
"""
import codecs
import fcntl
import http.server
import json
import os
from pathlib import Path
import re
import select
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
binary = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'dist/kicad-terminal'
output = root / 'audit'
output.mkdir(exist_ok=True)
requests = []


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append({'path': self.path, 'stream': body.get('stream', False), 'status': 429 if not requests else 200})
        if len(requests) == 1:
            self.send_response(429)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Retry-After', '1')
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"Waiting UI retry fixture","type":"rate_limit_error"}}')
            return
        time.sleep(6)
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream' if body.get('stream') else 'application/json')
            self.end_headers()
            if not body.get('stream'):
                self.wfile.write(json.dumps({'id': 'fixture', 'object': 'chat.completion', 'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': 'WAITING_FIXTURE_OK'}, 'finish_reason': 'stop'}], 'usage': {'prompt_tokens': 10, 'completion_tokens': 4, 'total_tokens': 14}}).encode())
                return
            for delta, finish in [({'role': 'assistant', 'content': 'WAITING_FIXTURE_OK'}, None), ({}, 'stop')]:
                chunk = {'id': 'fixture', 'object': 'chat.completion.chunk', 'created': int(time.time()), 'model': 'waiting', 'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
                self.wfile.write(('data: ' + json.dumps(chunk) + '\n\n').encode())
                self.wfile.flush()
                if delta.get('content'):
                    time.sleep(2)
            self.wfile.write(b'data: [DONE]\n\n')
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Model)
threading.Thread(target=server.serve_forever, daemon=True).start()
frames = {}
result = {'fixture': 'Packaged native binary; real PTY; local HTTP model fixture; isolated configuration and sessions', 'externalModelCalls': 0, 'toolsCalled': 0}

with tempfile.TemporaryDirectory(prefix='Kicad-waiting-') as temporary:
    temporary = Path(temporary)
    env = {key: value for key, value in os.environ.items() if not key.startswith(('OPENCODE_', 'XDG_'))}
    for key, name in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'), ('XDG_CACHE_HOME', 'cache'), ('XDG_STATE_HOME', 'state')]:
        env[key] = str(temporary / name)
        (temporary / name).mkdir()
    (temporary / 'state/opencode').mkdir()
    (temporary / 'state/opencode/kv.json').write_text(json.dumps({'kicad_draft_suggestions': False}))
    env.update({'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'OPENCODE_DISABLE_MODELS_FETCH': '1', 'OPENCODE_DISABLE_AUTOUPDATE': '1', 'OPENCODE_DISABLE_PROJECT_CONFIG': '1', 'OPENCODE_DISABLE_TERMINAL_TITLE': '1'})
    env['OPENCODE_CONFIG_CONTENT'] = json.dumps({'model': 'waiting-fixture/waiting', 'provider': {'waiting-fixture': {'npm': '@ai-sdk/openai-compatible', 'name': 'Local waiting fixture', 'options': {'baseURL': f'http://127.0.0.1:{server.server_port}/v1', 'apiKey': 'local-fixture'}, 'models': {'waiting': {'name': 'Waiting UI fixture', 'limit': {'context': 32000, 'output': 1000}}}}}, 'permission': {'*': 'deny'}, 'tools': {'*': False}})
    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 120, 0, 0))
    process = subprocess.Popen([str(binary)], cwd=temporary, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    screen = pyte.Screen(120, 32)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder('utf-8')('replace')

    def frame():
        return '\n'.join(screen.display)

    def pump():
        if select.select([master], [], [], .1)[0]:
            data = os.read(master, 200000)
            if b'\x1b[6n' in data:
                os.write(master, b'\x1b[1;1R')
            if b'\x1b]10;?' in data:
                os.write(master, b'\x1b]10;rgb:cccc/cccc/cccc\x1b\\')
            if b'\x1b]11;?' in data:
                os.write(master, b'\x1b]11;rgb:1818/1818/1818\x1b\\')
            stream.feed(decoder.decode(data))

    def wait(predicate, seconds=30):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            pump()
            if predicate():
                return
            if process.poll() is not None:
                raise AssertionError('Native terminal exited: ' + frame())
        raise AssertionError('Timed out: ' + frame())

    def snapshot(name):
        frames[name] = frame()
        (output / f'waiting-{name}.txt').write_text(frame())

    def assert_waiting_layout():
        lines = screen.display
        badges = [index for index, line in enumerate(lines) if re.search(r'Ki\s+[A-Za-z]+\.\.\.', line)]
        assert len(badges) == 1, frame()
        user = next(index for index, line in enumerate(lines) if 'UI fixture only.' in line)
        controls = next(index for index, line in enumerate(lines) if 'esc' in line and 'interrupt' in line)
        # The waiting row belongs to the transcript, immediately below the user;
        # the composer and its operation hints remain at the bottom of the screen.
        assert user < badges[0] < controls - 3, frame()
        assert badges[0] <= user + 5, frame()
        assert '▣' not in frame(), frame()
        assert not any(re.search(r'Ki\s+', line) for line in lines[controls:]), frame()

    try:
        wait(lambda: 'Ask anything' in frame())
        snapshot('idle')
        os.write(master, b'UI fixture only. Reply WAITING_FIXTURE_OK. Do not use tools.\r')
        wait(lambda: re.search(r'Ki\s+[A-Za-z]+\.\.\.', frame()) is not None)
        assert 'esc' in frame() and 'interrupt' in frame(), frame()
        assert_waiting_layout()
        snapshot('busy')
        # Render the actual parsed terminal screen, retaining the binary's colors.
        from PIL import Image, ImageDraw, ImageFont
        font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 17)
        image = Image.new('RGB', (1240, 720), '#181818')
        draw = ImageDraw.Draw(image)
        def color(value, fallback):
            return '#' + value if re.fullmatch('[0-9a-fA-F]{6}', value) else fallback
        for row in range(screen.lines):
            for col in range(screen.columns):
                cell = screen.buffer[row][col]
                x, y = 20 + col * 10, 20 + row * 21
                draw.rectangle((x, y, x + 10, y + 21), fill=color(cell.bg, '#181818'))
                draw.text((x, y), cell.data, font=font, fill=color(cell.fg, '#cccccc'))
        image.save(output / 'waiting-native-pty.png')
        wait(lambda: frame().count('WAITING_FIXTURE_OK') >= 2 and 'esc' in frame(), 35)
        assert re.search(r'Ki\s+[A-Za-z]+\.\.\.', frame()) is not None, frame()
        snapshot('streaming')
        wait(lambda: 'WAITING_FIXTURE_OK' in frame() and 'esc' not in frame(), 35)
        snapshot('completed')
        assert re.search(r'Ki\s+[A-Za-z]+\.\.\.', frame()) is None
        assert '▣' not in frame(), frame()
        assert requests[0]['status'] == 429 and any(request['status'] == 200 for request in requests)
        os.write(master, b'Second UI fixture only. Reply OK. Do not use tools.\r')
        wait(lambda: re.search(r'Ki\s+[A-Za-z]+\.\.\.', frame()) is not None)
        os.write(master, b'\x1b')
        wait(lambda: 'again to interrupt' in frame(), 5)
        os.write(master, b'\x1b')
        wait(lambda: 'again to interrupt' not in frame() and 'esc' not in frame(), 10)
        snapshot('interrupted')
        assert re.search(r'Ki\s+[A-Za-z]+\.\.\.', frame()) is None, frame()
        result.update({'checks': ['one blue Ki waiting badge below user message in transcript', 'assistant Build/model metadata row removed', 'no waiting badge in bottom toolbar; Esc controls retained', 'waiting persists during streamed reply', 'provider retries 429 and completes normally', 'completed turn removes busy indicator', 'two Esc keypresses interrupt normally and remove waiting indicator'], 'passed': True, 'localHttpRequests': requests})
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        os.close(master)
        server.shutdown()
        (output / 'waiting-native-pty.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')

print(json.dumps(result, ensure_ascii=False))
