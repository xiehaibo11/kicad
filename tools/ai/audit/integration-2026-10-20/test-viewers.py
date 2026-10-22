import json, subprocess, time
from pathlib import Path
out=Path(__file__).parent
records=[]
def call(name,editor):
    payload={"action":name,"editor":editor}
    for attempt in range(60):
        p=subprocess.run(["/Users/mosc/.local/bin/kicad-agent","--timeout","90s","call","editor.run_action","--payload",json.dumps(payload)],capture_output=True,text=True,timeout=100)
        j=json.loads(p.stdout)
        if j.get("error",{}).get("code") not in ("BUSY","IPC_UNAVAILABLE"): break
        time.sleep(.25)
    records.append({"payload":payload,"result":j})
    (out/"viewers.json").write_text(json.dumps({"ok":False,"calls":records},indent=2))
    print(name,editor,j,flush=True)
    assert j["ok"]
for action,target in [("kicad.Control.viewGerbers","gerbview"),("kicad.Control.editDrawingSheet","pl_editor"),("kicad.Control.editSymbols","symbol_editor"),("kicad.Control.editFootprints","footprint_editor")]:
    call(action,"kicad")
    call("common.Control.zoomFitScreen",target)
call("common.Control.show3DViewer","pcbnew")
call("3DViewer.Control.viewFront","3d-viewer")
(out/"viewers.json").write_text(json.dumps({"ok":True,"fixture":"live native viewer and library frames, no design modifications","calls":records},indent=2))
