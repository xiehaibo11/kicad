"""Real native terminal + local model/MCP fixtures; no account, network or design changes."""
import http.server,json,os,socket,subprocess,sys,tempfile,threading,time,urllib.request
from pathlib import Path
binary=Path(sys.argv[1]).resolve();plugin=Path(__file__).with_name('dist')/'session-runtime.mjs'
with tempfile.TemporaryDirectory(prefix='Kicad-demand-native-') as tmp:
 root=Path(tmp);requests=[];marker=root/'connected';unused=root/'unused';skill=root/'.agents/skills/fixture';skill.mkdir(parents=True);(skill/'SKILL.md').write_text('---\nname: fixture\ndescription: fixture-specialist\n---\nDEFERRED_SKILL_BODY_SENTINEL')
 server=root/'mcp.py';server.write_text('''import json,sys\nfrom pathlib import Path\nPath(sys.argv[1]).write_text('connected')\nfor line in sys.stdin:\n r=json.loads(line);m=r.get('method');i=r.get('id')\n if i is None:continue\n result={'protocolVersion':'2024-11-05','capabilities':{'tools':{}},'serverInfo':{'name':'fixture','version':'1'}} if m=='initialize' else {'tools':[{'name':'echo','description':'fixture echo','inputSchema':{'type':'object','properties':{'text':{'type':'string'}},'required':['text']}}]} if m=='tools/list' else {'content':[{'type':'text','text':'MCP_DEMAND_OK'}]} if m=='tools/call' else {}\n print(json.dumps({'jsonrpc':'2.0','id':i,'result':result}),flush=True)\n''')
 actions=[('capability_search',{'kind':'tool','query':'runtime_diagnostics'}),('capability_call',{'id':'tool:runtime_diagnostics','arguments':{}}),('capability_search',{'kind':'skill','query':'fixture-specialist'}),('capability_call',{'id':'skill:fixture','arguments':{}}),('capability_search',{'kind':'server','query':'selected'}),('capability_search',{'kind':'tool','query':'echo','server':'selected'}),('capability_call',{'id':'mcp:selected:echo','arguments':{'text':'hello'}})]
 class Model(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args):pass
  def do_POST(self):
   body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))))
   if body.get('tools'):requests.append(body);step=len(requests)-1
   else:step=len(actions)
   if step<len(actions):name,args=actions[step];delta={'role':'assistant','tool_calls':[{'index':0,'id':f'call{step}','type':'function','function':{'name':name,'arguments':json.dumps(args)}}]}
   else:delta={'role':'assistant','content':'DEMAND_OK'}
   self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
   for d,finish in [(delta,None),({},'tool_calls' if step<len(actions) else 'stop')]:self.wfile.write(('data: '+json.dumps({'id':'fixture','object':'chat.completion.chunk','created':int(time.time()),'model':'fixture','choices':[{'index':0,'delta':d,'finish_reason':finish}]})+'\n\n').encode())
   self.wfile.write(b'data: [DONE]\n\n')
 model=http.server.ThreadingHTTPServer(('127.0.0.1',0),Model);threading.Thread(target=model.serve_forever,daemon=True).start()
 env={k:v for k,v in os.environ.items() if not k.startswith(('OPENCODE_','XDG_','ANTHROPIC_','CLAUDE_','KICAD_')) and not any(x in k for x in ('API_KEY','AUTH_TOKEN'))}
 for key,folder in [('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_CACHE_HOME','cache'),('XDG_STATE_HOME','state'),('HOME','home')]: (root/folder).mkdir();env[key]=str(root/folder)
 config={'model':'fixture/fixture','plugin':[plugin.resolve().as_uri()],'mcp':{name:{'type':'local','command':[sys.executable,str(server),str(file)]} for name,file in [('selected',marker),('untouched',unused)]},'provider':{'fixture':{'npm':'@ai-sdk/openai-compatible','options':{'apiKey':'fixture-only','baseURL':f'http://127.0.0.1:{model.server_port}/v1'},'models':{'fixture':{'name':'fixture','limit':{'context':32000,'output':2000}}}}},'permission':{'*':'allow'}}
 env.update({'KICAD_LOCAL_MEMBERSHIP':'0','KICAD_AUTO_CONNECT':'0','OPENCODE_DISABLE_MODELS_FETCH':'1','OPENCODE_DISABLE_AUTOUPDATE':'1','OPENCODE_DISABLE_PROJECT_CONFIG':'1','OPENCODE_CONFIG_CONTENT':json.dumps(config)})
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 log=open('/tmp/Kicad-demand-native.log','w');child=subprocess.Popen([str(binary),'serve','--hostname','127.0.0.1','--port',str(port)],cwd=root,env=env,stdout=log,stderr=log)
 def call(url,body=None):
  req=urllib.request.Request(f'http://127.0.0.1:{port}'+url,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=90) as response:return json.load(response)
 try:
  for _ in range(200):
   try:
    if call('/global/health').get('healthy'):break
   except (OSError,ValueError):time.sleep(.1)
  else:raise RuntimeError('native server did not start')
  sid=call('/session',{})['id'];assert not marker.exists() and not unused.exists()
  assert call('/skill')==[], 'Native TUI skill catalog must not load all skills'
  assert not any(c.get('name')=='fixture' for c in call('/command')), 'Slash completion must not preload skill bodies'
  response=call('/session/'+sid+'/message',{'model':{'providerID':'fixture','modelID':'fixture'},'parts':[{'type':'text','text':'Inspect runtime diagnostics, load fixture specialist guidance, and call the selected MCP echo tool. Do not change any design.'}]})
  assert len(requests)==8,(len(requests),response)
  for request in requests:
   names=[t['function']['name'] for t in request.get('tools',[])];assert 'capability_search' in names and 'capability_call' in names,names
   assert not set(names)&{'kicad_board','context7','session_history','runtime_diagnostics','skill','selected_echo'},names
  assert 'fixture-specialist' not in json.dumps(requests[0])
  assert 'DEFERRED_SKILL_BODY_SENTINEL' not in json.dumps(requests[3])
  assert 'DEFERRED_SKILL_BODY_SENTINEL' in json.dumps(requests[4])
  assert 'MCP_DEMAND_OK' in json.dumps(requests[-1])
  assert marker.exists() and not unused.exists()
  evidence={'ok':True,'modelRequests':len(requests),'initialToolNames':[t['function']['name'] for t in requests[0]['tools']],'selectedMcpConnected':True,'unselectedMcpConnected':False,'skillBodyOnlyAfterCall':True,'nativeStartupSkillCatalogEmpty':True,'slashCompletionDoesNotLoadSkills':True}
  # Even if the model proposes tools for conversation, the real host must block them.
  unauthorized=root/'conversation-command-ran'
  actions=[('capability_search',{'kind':'tool','query':'echo','server':'untouched'}),('bash',{'command':'touch '+str(unauthorized),'description':'Must be blocked'})]
  conversational=[]
  for prompt in ['谢谢！','不要调用任何工具，只解释刚才的结果。']:
   requests.clear();sid=call('/session',{})['id']
   response=call('/session/'+sid+'/message',{'model':{'providerID':'fixture','modelID':'fixture'},'parts':[{'type':'text','text':prompt}]})
   assert len(requests)==3,(prompt,len(requests),response)
   assert not unauthorized.exists() and not unused.exists(),prompt
   assert '当前请求只需直接回复' in json.dumps(requests,ensure_ascii=False),prompt
   conversational.append({'prompt':prompt,'modelProposedCalls':2,'shellExecuted':False,'unrelatedMcpConnected':False})
  evidence['conversationAndExplicitNoToolGuard']=conversational
  output=Path(__file__).with_name('audit')/'demand-native.json';output.parent.mkdir(exist_ok=True);output.write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
 finally:
  child.terminate()
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:child.kill();child.wait()
  log.close();model.shutdown()
