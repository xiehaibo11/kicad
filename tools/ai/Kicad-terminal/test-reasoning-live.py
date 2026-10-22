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
binary=binary.resolve()
output = root / 'audit/reasoning'
output.mkdir(exist_ok=True,parents=True)
requests = []


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        request={'title': 'title generator' in json.dumps(body.get('system',[])) or 'Generate a title for this conversation:' in json.dumps(body.get('messages',[])), 'model':body.get('model'),'effort':body.get('output_config',{}).get('effort'),'thinking':body.get('thinking'),'path':self.path}
        requests.append(request)
        time.sleep(.4)
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        def send(kind,**data):
            self.wfile.write(('event: '+kind+'\ndata: '+json.dumps({'type':kind,**data})+'\n\n').encode());self.wfile.flush()
        send('message_start',message={'id':'msg_fixture_'+str(len(requests)),'type':'message','role':'assistant','model':body.get('model'),'content':[],'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':10,'output_tokens':1}})
        send('content_block_start',index=0,content_block={'type':'text','text':''})
        level='off' if body.get('thinking',{}).get('type')=='disabled' else body.get('output_config',{}).get('effort','default')
        reply='TITLE_FIXTURE_OK' if request['title'] else 'EFFORT_FIXTURE_'+level.upper()+'_OK'
        send('content_block_delta',index=0,delta={'type':'text_delta','text':reply})
        send('content_block_stop',index=0)
        send('message_delta',delta={'stop_reason':'end_turn','stop_sequence':None},usage={'output_tokens':3})
        send('message_stop')


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Model)
threading.Thread(target=server.serve_forever, daemon=True).start()
frames = {}
result = {'fixture': 'Packaged native binary; real PTY; local HTTP model fixture; isolated configuration and sessions', 'externalModelCalls': 0, 'toolsCalled': 0}

with tempfile.TemporaryDirectory(prefix='Kicad-effort-') as temporary:
    temporary = Path(temporary)
    env = {key: value for key, value in os.environ.items() if not key.startswith(('OPENCODE_', 'XDG_'))}
    for key, name in [('XDG_CONFIG_HOME', 'config'), ('XDG_DATA_HOME', 'data'), ('XDG_CACHE_HOME', 'cache'), ('XDG_STATE_HOME', 'state')]:
        env[key] = str(temporary / name)
        (temporary / name).mkdir()
    (temporary / 'state/opencode').mkdir()
    (temporary / 'state/opencode/kv.json').write_text(json.dumps({'kicad_draft_suggestions': False}))
    env.update({'TERM': 'xterm-256color', 'COLORTERM': 'truecolor', 'OPENCODE_DISABLE_MODELS_FETCH': '1', 'OPENCODE_DISABLE_AUTOUPDATE': '1', 'OPENCODE_DISABLE_PROJECT_CONFIG': '1', 'OPENCODE_DISABLE_TERMINAL_TITLE': '1'})
    variants={'off':{'thinking':{'type':'disabled'}},**{level:{'thinking':{'type':'enabled','budgetTokens':1024},'effort':level} for level in ['low','high','max']}}
    env['OPENCODE_CONFIG_CONTENT']=json.dumps({'model':'effort-fixture/deepseek-flash','small_model':'effort-fixture/deepseek-flash','provider':{'effort-fixture':{'npm':'@ai-sdk/anthropic','name':'Local effort fixture','options':{'baseURL':f'http://127.0.0.1:{server.server_port}/v1','apiKey':'fixture-only'},'models':{'deepseek-flash':{'name':'DeepSeek effort fixture','reasoning':True,'limit':{'context':32000,'output':2000},'variants':variants}}}},'permission':{'*':'deny'},'tools':{'*':False}})

    master, slave = os.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 32, 120, 0, 0))
    process = subprocess.Popen([str(binary)], cwd=temporary, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    screen = pyte.Screen(120, 32)
    stream = pyte.Stream(screen)
    decoder = codecs.getincrementaldecoder('utf-8')('replace')

    def frame():
        return '\n'.join(''.join(screen.buffer[y][x].data for x in range(screen.columns)) for y in range(screen.lines))

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

    def wait(predicate, seconds=60):
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

    def command(text):
        os.write(master,text.encode())
        until=time.monotonic()+.3
        while time.monotonic()<until:pump()
        os.write(master,b'\r')
        if text.startswith('/'):
            until=time.monotonic()+2
            while time.monotonic()<until:pump()

    def main_requests():
        return [request for request in requests if not request['title']]

    def choose(label):
        command('/effort')
        wait(lambda:'Reasoning effort · current model' in frame())
        wait(lambda:'Auto · model default' in frame() and 'Max' in frame())
        until=time.monotonic()+.6
        while time.monotonic()<until:pump()
        snapshot('menu')
        assert len(main_requests())==len(expected), 'selection may not send a message'
        os.write(master,label.encode())
        # Let filtering and the native selection index settle before Return.
        until=time.monotonic()+.5
        while time.monotonic()<until:pump()
        snapshot('filtered-'+label)
        wait(lambda:label in frame())
        os.write(master,b'\r')
        wait(lambda:'Reasoning effort · current model' not in frame())
        assert len(main_requests())==len(expected)

    expected=[]
    try:
        wait(lambda:'Describe a KiCad task' in frame())
        choose('Max')
        command('KICAD_TERMINAL_EFFORT max. Reply with a short acknowledgement without tools.')
        expected.append('max')
        wait(lambda:len(main_requests())>=1 and 'EFFORT_FIXTURE_MAX_OK' in frame() and 'esc interrupt' not in frame())
        assert main_requests()[0]['effort']=='max', requests
        snapshot('max')
        choose('Low')
        command('KICAD_TERMINAL_EFFORT low. Reply with a short acknowledgement without tools.')
        expected.append('low')
        wait(lambda:len(main_requests())>=2 and 'EFFORT_FIXTURE_LOW_OK' in frame() and 'esc interrupt' not in frame())
        assert main_requests()[1]['effort']=='low',requests
        choose('Thinking off')
        command('KICAD_TERMINAL_EFFORT off. Reply with a short acknowledgement without tools.')
        expected.append('off')
        wait(lambda:len(main_requests())>=3 and 'EFFORT_FIXTURE_OFF_OK' in frame() and 'esc interrupt' not in frame())
        assert not main_requests()[2].get('thinking') or main_requests()[2]['thinking'].get('type')=='disabled',requests
        snapshot('completed')
        command('/variants');wait(lambda:'Reasoning effort · current model' in frame());os.write(master,b'\x1b')
        assert len(main_requests())==3
        result.update({'ok':True,'requests':requests,'chatRequests':main_requests(),'checks':['real PTY /effort menu','selection never sends','max and low reach actual Anthropic HTTP','off disables thinking','native /variants retained'],'externalModelCalls':0})
        (output/'native-pty.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
        print(json.dumps(result,ensure_ascii=False))
    finally:
        if process.poll() is None: os.killpg(process.pid,signal.SIGTERM)
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=5)
        os.close(master);server.shutdown()
