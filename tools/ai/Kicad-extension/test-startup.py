#!/usr/bin/env python3
# Isolated real VS Code acceptance; never uses OS keychain or user credentials.
from pathlib import Path
import json,zipfile,tempfile,subprocess,os,signal
repo=Path(__file__).resolve().parents[3];root=Path(tempfile.mkdtemp(prefix='kn-vs-',dir='/tmp'))
packages=list((repo/'tools/ai/Kicad-extension/dist').glob('kicad-*.vsix'))
assert packages, 'Build the extension first'
package=max(packages,key=lambda p:tuple(map(int,p.stem.removeprefix('kicad-').split('.'))))
with zipfile.ZipFile(package) as z:z.extractall(root/'package')
workspace=root/'workspace';(workspace/'.vscode').mkdir(parents=True)
settings={'kicadAgent.openCode.path':str(repo/'tools/ai/Kicad-terminal/dist/kicad-terminal'),'kicadAgent.nodePath':'/nonexistent/native-tools-do-not-use-node','kicadAgent.kicadCli':str(repo/'build/kicad/KiCad.app/Contents/MacOS/kicad-cli'),'kicadAgent.socket':str(root/'unopened.sock'),'security.workspace.trust.enabled':False,'workbench.startupEditor':'none','update.mode':'none','extensions.autoCheckUpdates':False,'extensions.autoUpdate':False}
(root/'profile/User').mkdir(parents=True);(root/'profile/User/settings.json').write_text(json.dumps(settings));(root/'extensions').mkdir();(root/'home').mkdir()
Path('/tmp/kicad-native-vscode-path').write_text(str(root))
env={k:v for k,v in os.environ.items() if not k.startswith(('ANTHROPIC_','OPENAI_','DEEPSEEK_','OPENCODE_','XDG_','KICAD_','CURSOR_','VSCODE_','ELECTRON_','NODE_OPTIONS'))}
env.update(HOME=str(root/'home'),OPENCODE_DISABLE_MODELS_FETCH='1',OPENCODE_DISABLE_AUTOUPDATE='1',KICAD_HOST_TEST_RESULT=str(root/'host-result.json'),KICAD_RUN_FROM_BUILD_DIR='1')
args=['/Applications/Visual Studio Code.app/Contents/MacOS/Code','--user-data-dir',str(root/'profile'),'--extensions-dir',str(root/'extensions'),'--disable-extensions','--use-inmemory-secretstorage','--disable-renderer-backgrounding','--disable-background-timer-throttling','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--extensionDevelopmentPath='+str(root/'package/extension'),'--extensionTestsPath='+str(repo/'tools/ai/Kicad-extension/test-vscode-host.cjs'),str(workspace)]
print(json.dumps({'isolatedEditorRoot':str(root),'editor':'Visual Studio Code extension test host'}),flush=True)
with open('/tmp/kicad-native-editor-cli.log','w') as log:
 process=subprocess.Popen(args,cwd=workspace,env=env,stdout=log,stderr=log,start_new_session=True)
 try:
  import time
  for i in range(160):
   if (root/'host-result.json').exists(): break
   if process.poll() is not None: break
   time.sleep(.5)
  assert (root/'host-result.json').exists(),str(root)
  report=json.loads((root/'host-result.json').read_text())
  Path(os.environ.get('KICAD_STARTUP_TEST_RESULT','/tmp/kicad-vscode-full-verification.json')).write_text(json.dumps(report,indent=2)+'\n')
  print(json.dumps(report,indent=2),flush=True)
  assert report['ok'],report
 finally:
  if process.poll() is None:
   try: os.killpg(process.pid, signal.SIGTERM)
   except ProcessLookupError: pass
   except PermissionError: process.terminate()
  try: process.wait(timeout=8)
  except subprocess.TimeoutExpired:
   try: os.killpg(process.pid, signal.SIGKILL)
   except ProcessLookupError: pass
   except PermissionError: process.kill()
   process.wait(timeout=8)
