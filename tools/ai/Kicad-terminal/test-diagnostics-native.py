#!/usr/bin/env python3
"""Real terminal event bus with an isolated local model; no live KiCad or provider credentials."""
from pathlib import Path
import http.server,json,os,socket,subprocess,tempfile,threading,time,urllib.request,sys,zipfile,shlex
binary=Path(sys.argv[1]).resolve()
plugin=Path(__file__).with_name('dist')/'session-runtime.mjs'
with tempfile.TemporaryDirectory(prefix='Kicad-diagnostics-native-') as name:
 root=Path(name)
 (root/"report.json").write_text(json.dumps({"note":"x"*200000,"result":"needle"}))
 archive=root/'source.epro2';archive_destination=root/'archive-fixed';blocked_destination=root/'archive-blocked';archive_requests=[]
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('RK3308B_IPC 摄像头模块.epru',b'UTF8_ARCHIVE_BYTES')
 class Model(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_POST(self):
   body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
   messages=body.get('messages',[])
   if 'AUTH_FIXTURE' in json.dumps(messages):
    self.send_response(401);self.send_header('Content-Type','application/json');self.end_headers()
    self.wfile.write(json.dumps({'error':{'message':'authentication failed api_key=FIXTURE_SECRET','type':'authentication_error'}}).encode());return
   already=any(m.get('role')=='tool' for m in messages)
   delta={'role':'assistant','content':'Diagnostic fixture completed.'} if already else {'role':'assistant','tool_calls':[{'index':0,'id':'exit-test','type':'function','function':{'name':'bash','arguments':json.dumps({'command':'exit 7','description':'Verify nonzero exit diagnostics'})}}]}
   if not already and 'GREP_FIXTURE' in json.dumps(messages):delta={'role':'assistant','tool_calls':[{'index':0,'id':'large-json-test','type':'function','function':{'name':'grep','arguments':json.dumps({'pattern':'needle','include':'report.json','path':str(root)})}}]}
   if 'ARCHIVE_FIXTURE' in json.dumps(messages) and body.get('tools'):
    archive_requests.append(body);step=sum(m.get('role')=='tool' for m in messages)
    if step<2:
     command=f'unzip -q {shlex.quote(str(archive))} -d {shlex.quote(str(blocked_destination))}' if step==0 else f'/usr/bin/ditto -x -k {shlex.quote(str(archive))} {shlex.quote(str(archive_destination))}'
     delta={'role':'assistant','tool_calls':[{'index':0,'id':'archive-'+str(step),'type':'function','function':{'name':'bash','arguments':json.dumps({'command':command,'description':'Verify Unicode archive extraction'})}}]}
   if not body.get('tools'):delta={'role':'assistant','content':'Fixture title'}
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
   for d,finish in [(delta,None),({},'stop' if already else 'tool_calls')]:
    chunk={'id':'fixture','object':'chat.completion.chunk','created':int(time.time()),'model':'fixture','choices':[{'index':0,'delta':d,'finish_reason':finish}]}
    self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode())
   self.wfile.write(b'data: [DONE]\n\n')
 model=http.server.ThreadingHTTPServer(('127.0.0.1',0),Model);threading.Thread(target=model.serve_forever,daemon=True).start()
 env={k:v for k,v in os.environ.items() if not k.startswith(('OPENCODE_','XDG_','ANTHROPIC_','CLAUDE_','KICAD_')) and not any(x in k for x in ('API_KEY','AUTH_TOKEN'))}
 for key,folder in [('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_CACHE_HOME','cache'),('XDG_STATE_HOME','state'),('HOME','home')]:
  (root/folder).mkdir();env[key]=str(root/folder)
 config={'model':'fixture/fixture','plugin':[plugin.resolve().as_uri()],'provider':{'fixture':{'npm':'@ai-sdk/openai-compatible','options':{'apiKey':'fixture-only','baseURL':f'http://127.0.0.1:{model.server_port}/v1'},'models':{'fixture':{'name':'fixture','limit':{'context':32000,'output':2000}}}}},'permission':{'*':'allow'}}
 env.update({'KICAD_LOCAL_MEMBERSHIP':'0','KICAD_AUTO_CONNECT':'0','OPENCODE_DISABLE_MODELS_FETCH':'1','OPENCODE_DISABLE_AUTOUPDATE':'1','OPENCODE_DISABLE_PROJECT_CONFIG':'1','OPENCODE_CONFIG_CONTENT':json.dumps(config)})
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 log=open('/tmp/Kicad-diagnostics-native.log','w');child=subprocess.Popen([str(binary),'serve','--hostname','127.0.0.1','--port',str(port)],cwd=root,env=env,stdout=log,stderr=log)
 def call(url,body=None):
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+url,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  # A fresh isolated HOME can need a cold dependency install before /session.
  with urllib.request.urlopen(req,timeout=180) as response:return json.load(response)
 try:
  for _ in range(200):
   try:
    if call('/global/health').get('healthy'):break
   except (OSError,ValueError):time.sleep(.1)
  else:raise RuntimeError('native server did not start')
  for text in ['Run shell command exit 7 once to verify diagnostics, then summarize.','AUTH_FIXTURE Explain the connection error.','GREP_FIXTURE Search report.json for needle once then summarize.']:
   sid=call('/session',{})['id']
   call('/session/'+sid+'/message',{'model':{'providerID':'fixture','modelID':'fixture'},'parts':[{'type':'text','text':text}]})
  if sys.platform=='darwin':
   sid=call('/session',{})['id'];call('/session/'+sid+'/message',{'model':{'providerID':'fixture','modelID':'fixture'},'parts':[{'type':'text','text':'ARCHIVE_FIXTURE Extract source.epro2 into a fresh temporary directory and verify Unicode member names.'}]})
   assert len(archive_requests)==3,len(archive_requests)
   assert 'ditto' in json.dumps(archive_requests[1]) and 'macOS' in json.dumps(archive_requests[1])
   assert not blocked_destination.exists(),'incompatible unzip must be stopped before execution'
   assert (archive_destination/'RK3308B_IPC 摄像头模块.epru').read_bytes()==b'UTF8_ARCHIVE_BYTES'
  events=[]
  for _ in range(50):
   files=list((root/'state/kicad/diagnostics').rglob('*.jsonl'))
   raw='\n'.join(f.read_text() for f in files)
   events=[json.loads(line) for line in raw.splitlines() if line]
   if any(e.get('diagnosis',{}).get('kind')=='authentication' for e in events):break
   time.sleep(.1)
  assert any(e['category']=='terminal' and e.get('exitCode')==7 for e in events),events
  assert any(e['category']=='ai' and e.get('diagnosis',{}).get('kind')=='authentication' for e in events),events
  assert any(e['category']=='ai' and e['phase']=='request' and e['model']=='fixture' for e in events),events
  assert any(e.get('name')=='grep' and e['phase']=='end' and e['status']=='returned' for e in events),events
  assert not any(e.get('name')=='grep' and e.get('diagnosis') for e in events),events
  assert 'FIXTURE_SECRET' not in raw and 'fixture-only' not in raw
  output=Path(__file__).with_name('audit')/'diagnostics-native.json';output.parent.mkdir(exist_ok=True)
  output.write_text(json.dumps({'ok':True,'fixture':'native terminal + local model + real plugin bus','unicodeArchiveGuardAndRecovery':sys.platform=='darwin','archiveRequests':len(archive_requests),'events':events},ensure_ascii=False,indent=2))
  print('Native diagnostics passed: Unicode archive guard and ditto recovery, large JSON grep, nonzero shell exit, AI authentication error, request metadata, redaction: '+str(output))
 finally:
  child.terminate()
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:child.kill();child.wait()
  log.close();model.shutdown()
