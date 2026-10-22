# Uses existing local credentials for two real model calls; no chat sends or tool calls.
import json,os,re,subprocess,time,urllib.request,urllib.error
from pathlib import Path
credentials=json.loads((Path.home()/'.kicad-agent/deepseek.json').read_text())
config={'provider':{'kicad-deepseek':{'npm':'@ai-sdk/anthropic','name':'DeepSeek','options':{'apiKey':credentials['apiKey'],'baseURL':credentials['baseUrl'].rstrip('/')+'/v1'},'models':{'deepseek-flash':{'name':'DeepSeek Flash','limit':{'context':200000,'output':16000}}}}},'mcp':{'kicad':{'type':'local','command':[str(Path.home()/'.local/bin/kicad-agent'),'mcp'],'enabled':True}}}
env=os.environ.copy();env['OPENCODE_CONFIG_CONTENT']=json.dumps(config)
binary=os.environ.get('KICAD_COMPOSER_BINARY',str(Path(__file__).resolve().parent/'dist/kicad-terminal'))
log=open('/tmp/kicad-composer-deepseek-server.log','w')
p=subprocess.Popen([binary,'serve','--port','18092','--hostname','127.0.0.1'],env=env,stdout=log,stderr=log)
def req(path,data=None):
    request=urllib.request.Request('http://127.0.0.1:18092'+path,data=json.dumps(data).encode() if data else None,headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request,timeout=90) as response:return json.load(response)
try:
    for i in range(80):
        try: req('/global/health');break
        except Exception:time.sleep(.3)
    with urllib.request.urlopen('http://127.0.0.1:18092/',timeout=15) as response: html=response.read().decode()
    assets=re.findall(r'src="([^"]+\.js)"',html)
    assert assets, 'Embedded Web UI script is present'
    with urllib.request.urlopen('http://127.0.0.1:18092'+assets[0],timeout=15) as response: asset_size=len(response.read())
    assert asset_size>10000
    before=req('/session'); tools=req('/kicad/tool-references')
    model='kicad-deepseek/deepseek-flash'
    history=[{'role':'user','text':'请只读检查 U1 和 R1（10 kΩ），不要修改文件，不要布线。检查后解释发现的问题。'},{'role':'assistant','text':'已完成只读检查，没有修改文件或布线。下一步可以分别解释 U1 的供电和 R1 的阻值问题。'}]
    prediction=req('/kicad/composer',{'mode':'predict','model':model,'history':history,'text':''})
    optimized=req('/kicad/composer',{'mode':'optimize','model':model,'history':[],'text':'帮我只读检查 U1 和 R1（10 kΩ），不要修改文件，也不要布线，解释发现的问题。'})
    assert prediction['model']==model and optimized['model']==model
    assert optimized['text'] and 'U1' in optimized['text'] and 'R1' in optimized['text']
    after=req('/session')
    assert sorted(x['id'] for x in before)==sorted(x['id'] for x in after)
    result={'fixture':'Synthetic text conversation; no actual PCB inspection','model':model,'suggestion':prediction['text'],'optimized':optimized['text'],'mcpToolCount':len(tools['tools']),'embeddedWebUi':True,'embeddedAssetBytes':asset_size,'sessionsUnchanged':True,'toolsCalled':0,'chatMessagesSent':0}
    (Path(__file__).resolve().parent/'composer-live.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False))
except urllib.error.HTTPError as e: print('Request failed',e.code,e.read().decode()[:1200]);raise
finally:p.terminate();p.wait(timeout=15);log.close()
