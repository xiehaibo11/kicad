#!/usr/bin/env python3
"""Run the shipped native server against an isolated local model, without real keys."""
from pathlib import Path
import http.server,json,os,socket,subprocess,tempfile,threading,time,urllib.request,urllib.error,sys
binary = Path(sys.argv[1]).resolve()
agent = Path(sys.argv[2]).resolve()
requests=[]
finish='stop'
class Model(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args): pass
 def do_POST(self):
  body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
  requests.append({'model':body.get('model'),'tools':len(body.get('tools',[])),'toolChoice':body.get('tool_choice')})
  self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
  for delta,reason in [({'role':'assistant','content':'只读检查 U1 和 R1（10 kΩ），不修改文件、不布线，并解释检查结果。'},None),({},finish)]:
   part={'id':'fixture','object':'chat.completion.chunk','created':int(time.time()),'model':'fixture','choices':[{'index':0,'delta':delta,'finish_reason':reason}]}
   self.wfile.write(('data: '+json.dumps(part)+'\n\n').encode());self.wfile.flush()
  self.wfile.write(b'data: [DONE]\n\n');self.wfile.flush()
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Model)
threading.Thread(target=server.serve_forever,daemon=True).start()
with tempfile.TemporaryDirectory(prefix='Kicad-native-regression-') as name:
 root=Path(name);env={k:v for k,v in os.environ.items() if not k.startswith(('OPENCODE_','XDG_'))}
 for variable,directory in [('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_CACHE_HOME','cache'),('XDG_STATE_HOME','state')]:
  (root/directory).mkdir();env[variable]=str(root/directory)
 env.update({'OPENCODE_DISABLE_MODELS_FETCH':'1','OPENCODE_DISABLE_AUTOUPDATE':'1','OPENCODE_DISABLE_PROJECT_CONFIG':'1','OPENCODE_CONFIG_CONTENT':json.dumps({'model':'regression/fixture','provider':{'regression':{'npm':'@ai-sdk/openai-compatible','options':{'apiKey':'local-fixture-only','baseURL':f'http://127.0.0.1:{server.server_port}/v1'},'models':{'fixture':{'name':'Regression fixture','limit':{'context':32000,'output':2000}}}}},'permission':{'*':'deny'},'tools':{'*':False},'mcp':{'kicad':{'type':'local','command':[str(agent),'mcp'],'enabled':True}}})})
 with socket.socket() as sock: sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 log=open('/tmp/Kicad-fix-native-server.log','w')
 child=subprocess.Popen([str(binary),'serve','--hostname','127.0.0.1','--port',str(port)],cwd=root,env=env,stdout=log,stderr=log)
 def request(path,body=None):
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=25) as response: return response.status,json.load(response)
  except urllib.error.HTTPError as error: return error.code,json.load(error)
 try:
  for _ in range(100):
   try:
    if request('/global/health')[0]==200: break
   except (OSError,ValueError): time.sleep(.1)
  else: raise RuntimeError('native server did not start')
  before=request('/session')[1]
  cases=[]
  for reason in ['stop','length','content_filter']:
   finish=reason
   status,result=request('/kicad/composer',{'mode':'optimize','model':'regression/fixture','text':'只检查 U1 和 R1（10 kΩ），不修改、不布线，解释检查结果。','history':[]})
   assert status==(200 if reason=='stop' else 400),(reason,status,result)
   if reason=='stop': assert 'U1' in result['text'] and '10 kΩ' in result['text']
   else: assert '未完整' in result['message']
   cases.append({'finishReason':reason,'httpStatus':status,'response':result})
  after=request('/session')[1]
  assert before==after,'Composer must not create saved chats'
  assert all(item['model']=='fixture' and item['tools']==0 for item in requests),requests
  status,tools=request('/kicad/tool-references');assert status==200
  names={item['name'] for item in tools['tools']}
  assert any('kicad_audit' in item for item in names) and any('kicad_web' in item for item in names),names
  status,health=request('/kicad/health');assert status==200 and 'KiCad CLI:' in health['text'],health
  report={'ok':True,'fixture':'real native binary + local streaming model + real MCP agent','cases':cases,'requests':requests,'savedChatsUnchanged':True,'actualMcpTools':len(names),'health':health}
  print(json.dumps(report,ensure_ascii=False,indent=2))
 finally:
  child.terminate();child.wait(timeout=10);log.close();server.shutdown()
