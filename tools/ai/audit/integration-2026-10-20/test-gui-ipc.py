#!/usr/bin/env python3
"""Regression against the running native GUI, using only copied demo projects."""
import json, subprocess, time
from pathlib import Path
out=Path(__file__).parent
records=[]
def call(action,payload=None,expect=True):
    for attempt in range(40):
        p=subprocess.run(['/Users/mosc/.local/bin/kicad-agent','--timeout','60s','call',action,'--payload',json.dumps(payload or {})],capture_output=True,text=True,timeout=75)
        result=json.loads(p.stdout)
        if result.get('error',{}).get('code') != 'BUSY': break
        time.sleep(0.25)  # Project restoration briefly disables the manager.

    record={'action':action,'payload':payload or {},'exitCode':p.returncode,'result':result}
    records.append(record)
    (out/'gui-ipc.json').write_text(json.dumps({'ok':False,'calls':records},ensure_ascii=False,indent=2))
    print(action, p.returncode, json.dumps(result,ensure_ascii=False)[:700],flush=True)
    assert bool(result.get('ok')) == expect, record
    return result
root='/tmp/kicad-integration-projects/'
call('project.open',{'project':root+'pic_programmer'})
call('editor.run_action',{'action':'kicad.Control.editPCB','editor':'kicad'})
a=call('document.list',{'type':'pcb'})
assert a['data']['documents']
call('editor.run_action',{'action':'common.Control.zoomFitScreen','editor':'pcbnew'})
call('editor.run_action',{'action':'kicad.Control.editSchematic','editor':'kicad'})
b=call('document.list',{'type':'schematic'})
assert b['data']['documents']
call('editor.run_action',{'action':'common.Control.zoomFitScreen','editor':'eeschema'})
# Reopening the current project must preserve both editors and documents.
call('project.open',{'project':root+'pic_programmer'})
assert call('document.list',{'type':'pcb'})['data']['documents']==a['data']['documents']
assert call('document.list',{'type':'schematic'})['data']['documents']==b['data']['documents']
ambiguous=call('project.resolve',{'project':root+'ecc83'},expect=False)
assert ambiguous['error']['code']=='PROJECT_AMBIGUOUS'
# An explicit whole-project path switches the manager; do not pick a random PCB.
call('project.switch',{'project':root+'ecc83/ecc83-pp.kicad_pro'})
call('editor.run_action',{'action':'kicad.Control.editPCB','editor':'kicad'})
c=call('document.list',{'type':'pcb'})
assert c['data']['documents'][0]['project']['name']=='ecc83-pp'
call('editor.run_action',{'action':'common.Control.zoomFitScreen','editor':'pcbnew'})
call('project.switch',{'project':root+'pic_programmer'})
call('editor.run_action',{'action':'kicad.Control.editPCB','editor':'kicad'})
call('editor.run_action',{'action':'common.Control.zoomFitScreen','editor':'pcbnew'})
(out/'gui-ipc.json').write_text(json.dumps({'ok':True,'fixture':'real native GUI, copied demo projects, whole-project switches and editor readbacks','calls':records},ensure_ascii=False,indent=2))
