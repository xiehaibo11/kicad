import json
import os
from pathlib import Path
import subprocess
import tempfile

out=Path(__file__).resolve().parent
installed=Path.home()/'.vscode/extensions/kicad-agent.kicad-0.4.23'
profile=tempfile.mkdtemp(prefix='Kicad-engineering-profile-')
workspace=tempfile.mkdtemp(prefix='Kicad-engineering-workspace-')
command=['/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code','--wait','--user-data-dir',profile,'--disable-extensions','--disable-workspace-trust','--skip-welcome','--extensionDevelopmentPath='+str(installed),'--extensionTestsPath='+str(out/'test-extension-natural.cjs'),workspace]
with (out/'extension-host.log').open('w') as log:
 result=subprocess.run(command,stdout=log,stderr=log,timeout=210)
print(json.dumps({'exitCode':result.returncode,'profile':profile,'report':str(out/'extension-natural.json')}))
assert result.returncode==0
assert json.loads((out/'extension-natural.json').read_text())['ok']
