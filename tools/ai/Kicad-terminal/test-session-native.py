#!/usr/bin/env python3
"""Actual full native runtime + local model + local backend plugin."""
from pathlib import Path
import http.server,json,os,socket,subprocess,tempfile,threading,time,urllib.request,urllib.error,sys
binary=Path(sys.argv[1]).resolve(); plugin=Path(__file__).with_name('dist')/'session-runtime.mjs'; requests=[]
with tempfile.TemporaryDirectory(prefix='Kicad-native-continuity-') as name:
 root=Path(name)
 class Model(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_POST(self):
   body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
   messages=body.get('messages',[]); last=messages[-1] if messages else {}; text=json.dumps(messages,ensure_ascii=False)
   summarize='Output exactly the Markdown structure' in text
   case='clear' if 'KICAD_CLEAR' in text else 'ambiguous'
   already=any(m.get('role')=='tool' for m in messages)
   requests.append({'case':case,'summary':summarize,'afterTool':already,'checkpoint':'Task checkpoint' in text,'model':body.get('model')})
   tool=not already and not summarize
   delta={'role':'assistant'}
   if tool:delta['tool_calls']=[{'index':0,'id':'write-'+case,'type':'function','function':{'name':'write','arguments':json.dumps({'filePath':str(root/(case+'.txt')),'content':'NATIVE_OK'})}}]
   else:delta['content']='Summary: KICAD_CLEAR 创建 clear.txt 已完成。保留不要布线的限制，继续验证。' if summarize else '请说明具体任务。'
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
   for d,finish in [(delta,None),({},'tool_calls' if tool else 'stop')]:
    chunk={'id':'fixture','object':'chat.completion.chunk','created':int(time.time()),'model':'fixture','choices':[{'index':0,'delta':d,'finish_reason':finish}]}
    self.wfile.write(('data: '+json.dumps(chunk)+'\n\n').encode());self.wfile.flush()
   self.wfile.write(b'data: [DONE]\n\n')
 model=http.server.ThreadingHTTPServer(('127.0.0.1',0),Model);threading.Thread(target=model.serve_forever,daemon=True).start()
 env={k:v for k,v in os.environ.items() if not k.startswith(('OPENCODE_','XDG_'))}
 for variable,directory in [('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_CACHE_HOME','cache'),('XDG_STATE_HOME','state')]:
  (root/directory).mkdir();env[variable]=str(root/directory)
 config={'model':'fixture/fixture','plugin':[plugin.resolve().as_uri()],'provider':{'fixture':{'npm':'@ai-sdk/openai-compatible','options':{'apiKey':'fixture-only','baseURL':f'http://127.0.0.1:{model.server_port}/v1'},'models':{'fixture':{'name':'fixture','limit':{'context':32000,'output':2000}}}}},'permission':{'*':'allow'}}
 env.update({'OPENCODE_DISABLE_MODELS_FETCH':'1','OPENCODE_DISABLE_AUTOUPDATE':'1','OPENCODE_DISABLE_PROJECT_CONFIG':'1','OPENCODE_CONFIG_CONTENT':json.dumps(config)})
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 log=open('/tmp/Kicad-native-continuity.log','w');child=subprocess.Popen([str(binary),'serve','--hostname','127.0.0.1','--port',str(port)],cwd=root,env=env,stdout=log,stderr=log)
 def call(url,body=None):
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+url,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=35) as response:return json.load(response)
 try:
  for _ in range(100):
   try:
    if call('/global/health').get('healthy'):break
   except (OSError,ValueError):time.sleep(.1)
  else:raise RuntimeError('native server did not start')
  assert not requests,'starting runtime must not call the model'
  ids=[]
  for case,text in [('ambiguous','1'),('clear','KICAD_CLEAR 创建 clear.txt 写入 NATIVE_OK，然后验证；不要布线。')]:
   session=call('/session',{});sid=session['id'];ids.append(sid)
   result=call('/session/'+sid+'/message',{'model':{'providerID':'fixture','modelID':'fixture'},'parts':[{'type':'text','text':text}]})
   if case=='ambiguous':assert not (root/'ambiguous.txt').exists(),result
   else:assert (root/'clear.txt').read_text()=='NATIVE_OK',result
  sid=ids[-1];before=call('/session/'+sid+'/message')
  assert call('/session/'+sid+'/summarize',{'providerID':'fixture','modelID':'fixture','auto':False}) is True
  statepath=root/'state/opencode/kicad-task-state'/sid/'checkpoint.json';state=json.loads(statepath.read_text())
  archive=json.loads(Path(state['archive']).read_text());assert any(m['info']['id']==before[0]['info']['id'] for m in archive)
  assert any(a['tool']=='write' and a['status']=='completed' for a in state['actions'])
  assert '不要布线' in state['requests'][-1]['text']
  call('/session/'+sid+'/message',{'model':{'providerID':'fixture','modelID':'fixture'},'parts':[{'type':'text','text':'继续验证刚才的任务'}]})
  assert any(r['checkpoint'] and not r['summary'] for r in requests),'checkpoint not injected after compaction'
  output=Path(__file__).with_name('audit')/'continuity-native.json';output.parent.mkdir(exist_ok=True)
  output.write_text(json.dumps({'ok':True,'fixture':'shipped native binary + localhost model + actual installed plugin API','startupNoModelCalls':True,'ambiguousWriteBlocked':True,'explicitWriteWorks':True,'nativeCompactionArchivesFullHistory':True,'continuedTaskContextRestored':True,'requests':requests},ensure_ascii=False,indent=2))
  print('Real native intent/compaction passed: '+str(output))
 finally:child.terminate();child.wait(timeout=10);log.close();model.shutdown()
