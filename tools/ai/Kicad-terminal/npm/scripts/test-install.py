#!/usr/bin/env python3
"""Install the real tarball into an isolated prefix and exercise its shipped code."""
import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from urllib.parse import urlparse, unquote

package = Path(sys.argv[1]).resolve() if not sys.argv[1].startswith(('https://', '@')) else sys.argv[1]
source = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='Kicad npm acceptance ') as directory:
    root = Path(directory)
    home = root/'isolated home'
    home.mkdir()
    env = {k:v for k,v in os.environ.items() if not k.startswith(('OPENCODE_', 'XDG_', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'DEEPSEEK_'))}
    env.update(HOME=str(home), npm_config_cache=str(root/'empty npm cache'), npm_config_userconfig=str(root/'no credentials.npmrc'), npm_config_update_notifier='false', OPENCODE_DISABLE_MODELS_FETCH='1', OPENCODE_DISABLE_AUTOUPDATE='1', OPENCODE_DISABLE_PROJECT_CONFIG='1')
    for variable, folder in [('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_STATE_HOME','state'),('XDG_CACHE_HOME','cache')]:
        env[variable] = str(root/folder)
        (root/folder).mkdir()
    settings = root/'config/opencode/opencode.json'
    settings.parent.mkdir()
    original = '{"model":"fixture/preferred","compaction":{"auto":true,"prune":false}}\n'
    settings.write_text(original)
    def run(args, timeout=180):
        result = subprocess.run(list(map(str,args)),cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout)
        assert result.returncode == 0, str(args) + '\n' + result.stdout[-4000:]
        return result.stdout
    invocation = ['npx','--yes',str(package)] if str(package).startswith('@') else ['npx','--yes','--package='+str(package),'Kicad']
    output = run(invocation+['--version'])
    assert '1.19.3' in output.splitlines(), output[-1000:]
    prefix = root/'global prefix'
    run(['npm','install','--global','--prefix',prefix,'--no-audit','--no-fund',package])
    command = prefix/'bin/Kicad'
    identity = json.loads((source/'package.json').read_text())['name']
    installed = (prefix/'lib/node_modules'/identity).resolve()
    aliases = [''.join(case) for case in itertools.product(*[(letter,letter.upper()) for letter in 'kicad'])]
    for alias in aliases:
        assert run([prefix/'bin'/alias,'--version']).strip() == '1.19.3', alias
    installed_package = json.loads((installed/'package.json').read_text())
    assert installed_package['name'] == identity
    assert set(installed_package['bin']) == set(aliases)
    assert set(installed_package['bin'].values()) == {'bin/Kicad.mjs'}
    assert command.is_file()
    assert run([command,'--version']).strip() == '1.19.3'
    help_text = run([command,'--help'])
    commands = re.findall(r'^  Kicad (\S+)',help_text,re.M)
    expected = ['completion','acp','mcp','[project]','attach','run','debug','providers','agent','upgrade','uninstall','serve','web','models','stats','export','import','github','pr','session','plugin','db']
    assert commands == expected, commands
    manifest = json.loads((installed/'manifest.json').read_text())
    for file, sha in manifest['files'].items():
        assert hashlib.sha256((installed/file).read_bytes()).hexdigest() == sha, file
    config_output = run([command,'debug','config'])
    config = json.loads(config_output[config_output.index('{'):])
    assert config['model'] == 'fixture/preferred'
    assert config['mcp']['kicad']['command'][0] == str(installed/'vendor/darwin-arm64/kicad-agent')
    plugins = [item[0] if isinstance(item,list) else item for item in config['plugin']]
    assert installed/'resources/session-runtime.mjs' in [Path(unquote(urlparse(item).path)).resolve() for item in plugins if item.startswith('file:')], plugins
    assert config['compaction']['auto'] is True and config['compaction']['prune'] is False
    with tempfile.TemporaryFile(mode='w+') as listing:
        subprocess.run([str(command),'debug','skill'],cwd=root,env=env,stdout=listing,stderr=subprocess.PIPE,text=True,timeout=120,check=True)
        listing.seek(0)
        skills = json.load(listing)
    assert sum(str(item['location']).startswith(str(installed/'resources/skills')) for item in skills) == 7, skills
    agent = installed/'vendor/darwin-arm64/kicad-agent'
    inventory = json.loads(run([agent,'manifest']))['data']
    requests = [{'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2024-11-05','capabilities':{},'clientInfo':{'name':'npm-acceptance','version':'1'}}},{'jsonrpc':'2.0','id':2,'method':'tools/list'}]
    response = subprocess.run([str(agent),'mcp'],input='\n'.join(map(json.dumps,requests))+'\n',text=True,capture_output=True,env=env,cwd=root,timeout=30,check=True)
    replies = [json.loads(line) for line in response.stdout.splitlines()]
    tools = next(item['result']['tools'] for item in replies if item.get('id')==2)
    assert {tool['name'] for tool in tools} == set(inventory['mcpTools'])
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0))
        port = sock.getsockname()[1]
    with (root/'server.log').open('w') as log:
        server = subprocess.Popen([str(command),'serve','--hostname','127.0.0.1','--port',str(port)],cwd=root,env=env,stdout=log,stderr=log)
        def fetch(url):
            with urllib.request.urlopen(f'http://127.0.0.1:{port}'+url, timeout=10) as response:
                return response.read(),response.headers.get('Content-Type','')
        try:
            for _ in range(200):
                try:
                    if json.loads(fetch('/global/health')[0])['healthy']: break
                except (OSError,ValueError): time.sleep(.1)
            else: raise AssertionError((root/'server.log').read_text()[-2000:])
            assert json.loads(fetch('/session')[0]) == [], 'startup must not create a task'
            assert json.loads(fetch('/mcp')[0])['kicad']['status'] == 'connected', 'bundled backend did not connect'
            html,kind = fetch('/')
            assert 'text/html' in kind
            asset = re.search(rb'<script[^>]+src="([^"]+)"',html).group(1).decode()
            data,kind = fetch(asset)
            assert len(data)>1000 and 'javascript' in kind
        finally:
            server.terminate()
            server.wait(timeout=15)
    saved = json.loads(settings.read_text())
    assert all(saved.get(key) == value for key,value in json.loads(original).items()), 'existing preferences changed: '+json.dumps(saved)
    report = {'ok':True,'package':str(package),'platform':'darwin-arm64','runtimeVersion':'1.19.3','cleanCacheNpx':True,'globalCommand':'Kicad','packageName':identity,'caseVariantCommandsVerified':aliases,'installationWithoutForce':True,'all22CommandsPreserved':True,'packageFilesVerified':len(manifest['files']),'bundledSkills':7,'mcpTools':len(tools),'actionCount':inventory['actionCount'],'NNGBackendBundled':True,'bundledMcpConnected':True,'nativeApiHealth':True,'embeddedWebAndJavaScript':True,'startupCreatesNoTask':True,'existingModelAndSettingsPreserved':True,'prefixWithSpaces':True}
    report_path = Path(os.environ.get('KICAD_NPM_TEST_REPORT','/tmp/Kicad-npm-acceptance.json'))
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
