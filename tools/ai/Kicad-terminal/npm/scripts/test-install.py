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
    env.update(HOME=str(home), npm_config_cache=str(root/'empty npm cache'), npm_config_userconfig=str(root/'no credentials.npmrc'), npm_config_update_notifier='false', OPENCODE_DISABLE_MODELS_FETCH='1', OPENCODE_DISABLE_AUTOUPDATE='1', OPENCODE_DISABLE_PROJECT_CONFIG='1', KICAD_LOCAL_MEMBERSHIP='0', KICAD_AUTO_CONNECT='0')
    for variable, folder in [('XDG_CONFIG_HOME','config'),('XDG_DATA_HOME','data'),('XDG_STATE_HOME','state'),('XDG_CACHE_HOME','cache')]:
        env[variable] = str(root/folder)
        (root/folder).mkdir()
    settings = root/'config/opencode/opencode.json'
    settings.parent.mkdir()
    original = json.dumps({'model':'fixture/preferred','compaction':{'auto':True,'prune':False},'mcp':{name:{'type':'local','command':['fixture-removed-connector-must-not-start'],'enabled':True} for name in ['kicad','easyeda']}})+'\n'
    settings.write_text(original)
    def run(args, timeout=180):
        result = subprocess.run(list(map(str,args)),cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout)
        assert result.returncode == 0, str(args) + '\n' + result.stdout[-4000:]
        return result.stdout
    invocation = ['npx','--yes',str(package)] if str(package).startswith('@') else ['npx','--yes','--package='+str(package),'Kicad']
    output = run(invocation+['--version'])
    expected_version = json.loads((source/'package.json').read_text())['version']
    assert expected_version in output.splitlines(), output[-1000:]
    prefix = root/'global prefix'
    run(['npm','install','--global','--prefix',prefix,'--no-audit','--no-fund',package])
    command = prefix/'bin/Kicad'
    identity = json.loads((source/'package.json').read_text())['name']
    installed = (prefix/'lib/node_modules'/identity).resolve()
    aliases = [''.join(case) for case in itertools.product(*[(letter,letter.upper()) for letter in 'kicad'])]
    if not (prefix/'bin/kicad').exists(): aliases = ['Kicad']
    for alias in aliases:
        assert run([prefix/'bin'/alias,'--version']).strip() == expected_version, alias
    installed_package = json.loads((installed/'package.json').read_text())
    assert installed_package['name'] == identity
    assert installed_package['bin'] == {'Kicad':'bin/Kicad.mjs'}
    # Repeat installation verifies case-insensitive upgrades without --force.
    run(['npm','install','--global','--prefix',prefix,'--no-audit','--no-fund',package])
    assert run([command,'--version']).strip() == expected_version
    assert set(installed_package['bin'].values()) == {'bin/Kicad.mjs'}
    assert command.is_file()
    assert run([command,'--version']).strip() == expected_version
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
    assert 'kicad' not in config.get('mcp', {}) and 'easyeda' not in config.get('mcp', {})
    plugins = [item[0] if isinstance(item,list) else item for item in config['plugin']]
    assert installed/'resources/session-runtime.mjs' in [Path(unquote(urlparse(item).path)).resolve() for item in plugins if item.startswith('file:')], plugins
    assert config['compaction']['auto'] is True and config['compaction']['prune'] is False
    with tempfile.TemporaryFile(mode='w+') as listing:
        subprocess.run([str(command),'debug','skill'],cwd=root,env=env,stdout=listing,stderr=subprocess.PIPE,text=True,timeout=120,check=True)
        listing.seek(0)
        skills = json.load(listing)
    expected_skills = sorted(p.name for p in (source.parents[3]/'.claude/skills').glob('kicad-*') if (p/'SKILL.md').is_file())
    assert skills == [], 'Startup must not preload skill bodies'
    assert sorted(p.name for p in (installed/'resources/skills').iterdir() if (p/'SKILL.md').is_file()) == expected_skills
    # Exercise the shipped plugin: page metadata, then load only the selected skill.
    skill_probe = "import {KicadSessionRuntime} from " + json.dumps((installed/'resources/session-runtime.mjs').as_uri()) + ";\n"
    skill_probe += "const root=" + json.dumps(str(installed)) + ";\n" + """
const hooks=await KicadSessionRuntime({directory:process.cwd(),client:{}});
try {
  await hooks.config({skills:{paths:[root+'/resources/skills']}});
  const skills=[];let offset=0;
  do {
    const page=JSON.parse(await hooks.tool.capability_search.execute({kind:'skill',query:'',offset},{}));
    if(page.results.some(item=>Object.hasOwn(item,'content')))throw Error('Discovery exposed a skill body');
    skills.push(...page.results);offset=page.nextOffset;
  } while(offset!==null && offset!==undefined);
  const permissions=[];
  const loaded=JSON.parse(await hooks.tool.capability_call.execute({id:'skill:kicad-engineering',arguments:{}},{ask:async request=>permissions.push(request.permission)}));
  console.log(JSON.stringify({names:skills.map(item=>item.name).sort(),loaded,permissions}));
} finally {await hooks.event({event:{type:'server.instance.disposed'}});}
"""
    skill_result = json.loads(run(['node','--input-type=module','--eval',skill_probe]))
    assert skill_result['names'] == expected_skills, skill_result['names']
    assert skill_result['loaded']['name'] == 'kicad-engineering'
    assert skill_result['loaded']['content'] == (installed/'resources/skills/kicad-engineering/SKILL.md').read_text()
    assert skill_result['permissions'] == ['skill']
    bundled_skills = skill_result['names']
    assert 'kicad-engineering' in expected_skills
    assert (installed/'resources/skills/kicad-engineering/references/release-evidence.md').is_file()
    agent = installed/'resources/kicad-direct.mjs'
    inventory = json.loads(run([agent,'manifest']))['data']
    assert inventory == manifest['capabilities'], 'payload capabilities differ from release manifest'
    assert inventory['engineeringReferences']['ruleCount'] == 86
    assert inventory['engineeringReferences']['exampleProjectCount'] == 37
    # The package exposes the tool registry by import; no stdio routing server.
    native_import = "import {toolsList,Runtime,callTool} from " + json.dumps(agent.as_uri()) + ";"
    tools = json.loads(run(['node','--input-type=module','--eval',native_import+"console.log(JSON.stringify(toolsList()))"]))
    assert {tool['name'] for tool in tools} == set(inventory['mcpTools'])
    assert 'kicad_reference' in inventory['mcpTools']
    for action, payload in [('reference.plan', {'query':'电源原理图设计'}), ('reference.get', {'id':'power'}), ('reference.examples', {})]:
        data = json.loads(run([agent,'call',action,'--payload',json.dumps(payload)]))
        assert data['ok'] and data['data'], (action,data)
    script = native_import + "const runtime=new Runtime();try{console.log(JSON.stringify(await callTool(runtime,'kicad_reference',{action:'reference.plan',payload:{query:'PCB'}})))}finally{runtime.close()}"
    assert json.loads(run(['node','--input-type=module','--eval',script]))['ok']
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
            assert not {'kicad','easyeda'} & set(json.loads(fetch('/mcp')[0])), 'built-in tools must not spawn old global MCP connectors'
            tool_ids = json.loads(fetch('/experimental/tool/ids')[0])
            assert 'capability_search' in tool_ids and 'capability_call' in tool_ids, tool_ids
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
    report = {'ok':True,'package':str(package),'version':installed_package['version'],'platform':'darwin-arm64','runtimeVersion':'1.19.3','cleanCacheNpx':True,'globalCommand':'Kicad','packageName':identity,'caseVariantCommandsVerified':aliases,'installationWithoutForce':True,'reinstallationWithoutForce':True,'all22CommandsPreserved':True,'packageFilesVerified':len(manifest['files']),'bundledSkills':len(bundled_skills),'frontendTools':len(tools),'actionCount':inventory['actionCount'],'engineeringReferences':inventory['engineeringReferences'],'referenceActionsExecuted':True,'referenceInProcessToolExecuted':True,'nativeTransportBundled':True,'builtInToolsRegistered':True,'oldGlobalConnectorsRemovedAfterMerge':True,'terminalServerHealthy':True,'embeddedWebAndJavaScript':True,'startupCreatesNoTask':True,'existingModelAndSettingsPreserved':True,'prefixWithSpaces':True}
    report_path = Path(os.environ.get('KICAD_NPM_TEST_REPORT','/tmp/Kicad-npm-acceptance.json'))
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False,indent=2))
