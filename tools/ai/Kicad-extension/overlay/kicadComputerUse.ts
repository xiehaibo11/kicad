import * as vscode from 'vscode';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {CuaService,KICAD_APPS,COMPUTER_READ,COMPUTER_ACTION,assertComputerEnabled,appAllowed,driverData,type ComputerConfig} from './shared/kicadComputerUse';
import type {Capability} from './shared/kicadDemand';

// Application-scope settings cannot be enabled by a repository's settings.json.
export function computerConfig():ComputerConfig {
  const cfg=vscode.workspace.getConfiguration('kicadAgent');
  return {enabled:cfg.get('computer.enabled',false),driverPath:cfg.get('computer.driverPath',''),anyApp:cfg.get('computer.anyApp',false),allowedApps:cfg.get('computer.allowedApps',KICAD_APPS)};
}
export const computerService=new CuaService(computerConfig);
const sessions=new Set<ComputerSession>();
const unsupported=['screenshot_out_file','debug_image_out','additional_arguments','webkit_inspector_port','target','session'];
let actionQueue:Promise<unknown>=Promise.resolve();
function serial<T>(fn:()=>Promise<T>){const next=actionQueue.then(fn,fn);actionQueue=next.catch(()=>{});return next;}
async function disconnect(){await Promise.allSettled([...sessions].map(session=>session.revoke()));}

class ComputerSession {
  private client?:Promise<Client>;
  private snapshots=new Map<string,{pid:number;window:number}>();
  private captures=new Map<string,{pid:number;window:number}>();
  private closed=false;
  private epoch=0;
  private async connection(){
    assertComputerEnabled(computerConfig());
    if(this.closed)throw Error('Computer-control connection was revoked. Search in a new conversation after enabling it.');
    if(!vscode.workspace.isTrusted)throw Error('Trust the workspace before using computer control.');
    if(!this.client){
      const epoch=this.epoch;
      const pending=(async()=>{
        await computerService.start();
        const client=new Client({name:'kicad-computer-control',version:'0.4.65'},{capabilities:{}});
        try{await client.connect(new StdioClientTransport({command:await computerService.binary(),args:['mcp','--socket',computerService.socket],env:Object.fromEntries(Object.entries({...process.env,DO_NOT_TRACK:'1'}).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),stderr:'ignore'}),{timeout:15000});
          if(this.closed||epoch!==this.epoch||!computerConfig().enabled){await client.close();throw Error('Computer-control connection was revoked while connecting. Retry after the setting change.');}return client;
        }catch(error){await client.close().catch(()=>{});throw error;}
      })();
      this.client=pending;
      pending.catch(()=>{if(this.client===pending)this.client=undefined;});
    }
    return this.client;
  }
  async revoke(){this.epoch++;this.snapshots.clear();this.captures.clear();const client=this.client;this.client=undefined;if(client)await (await client.catch(()=>undefined))?.close();}
  async close(){this.closed=true;sessions.delete(this);await this.revoke();}
  async raw(name:string,args:any={},signal?:AbortSignal){
    const client=await this.connection();assertComputerEnabled(computerConfig());
    return client.callTool({name,arguments:args},undefined,{timeout:60000,signal});
  }
  async tools(query=''){
    const client=await this.connection(),tools=[];
    let cursor:string|undefined;
    do{const page=await client.listTools({cursor});tools.push(...page.tools);cursor=page.nextCursor;}while(cursor);
    return {tools:tools.filter(tool=>[...COMPUTER_READ,...COMPUTER_ACTION].includes(tool.name)&&(!query||query.toLowerCase().split(/\s+/).some(term=>(tool.name+' '+tool.description).toLowerCase().includes(term)))).map(tool=>{
      const schema={...tool.inputSchema,properties:{...tool.inputSchema.properties}};
      for(const field of unsupported)delete schema.properties[field];
      if(schema.properties.scope)schema.properties.scope={...(schema.properties.scope as any),enum:['window']};
      return {...tool,inputSchema:schema};
    }),guidance:'Read one exact window, then act using its fresh element_token or capture_id. Re-read after each action. Use computer_read for observations and computer_action for input. Pass an allowed pid and exact window_id for window operations. File output, public session labels and desktop targets are unavailable. Text-only models can use include_screenshot:false. Actions obey normal permission mode and app access controls.'};
  }
  async call(name:string,args:any,readOnly:boolean,signal?:AbortSignal){return serial(async()=>{
    assertComputerEnabled(computerConfig());
    if(!(readOnly?COMPUTER_READ:COMPUTER_ACTION).includes(name))throw Error('This Cua operation is not available through '+(readOnly?'computer_read':'computer_action')+'. Use computer_tools for its schema.');
    if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Computer-control arguments must be an object.');
    const input={...args};
    // Disallow file writes in the observation path, alternate desktop targets,
    // unscoped scripts and arbitrary launch arguments. Cua's own authorization
    // remains active as an additional boundary.
    for(const field of unsupported)if(input[field]!==undefined)throw Error('Unsupported computer-control argument: '+field);
    if(input.scope==='desktop')throw Error('Use an exact app window; full-desktop control is not exposed.');
    const cfg=computerConfig();
    if(['check_permissions','get_guide'].includes(name))return this.raw(name,input,signal);
    const apps=(driverData(await this.raw('list_apps',{},signal)).apps||[]).filter((app:any)=>appAllowed(cfg,app));
    if(name==='list_apps')return {content:[{type:'text',text:JSON.stringify({apps})}],structuredContent:{apps}};
    if(name==='launch_app'){
      const app=apps.find((app:any)=>input.bundle_id?app.bundle_id===input.bundle_id:input.name===app.launch_path||input.name===app.name);
      if(!app)throw Error('App access is disabled or the app is not installed. Enable its bundle ID in Computer Control settings.');
      input.bundle_id=app.bundle_id;delete input.name;
      return this.raw(name,input,signal);
    }
    if(name==='list_windows'){
      if(input.pid&&!apps.some((app:any)=>app.pid===input.pid))throw Error('App access is disabled for this pid.');
      const data=driverData(await this.raw(name,input,signal));
      const windows=(data.windows||[]).filter((window:any)=>apps.some((app:any)=>app.running&&app.pid===window.pid));
      return {content:[{type:'text',text:JSON.stringify({...data,windows})}],structuredContent:{...data,windows}};
    }
    if(!Number.isInteger(input.pid)||!apps.some((app:any)=>app.running&&app.pid===input.pid))throw Error('Pass an allowed app pid from computer_read list_apps/list_windows.');
    if(input.element_token){
      const snapshot=this.snapshots.get(String(input.element_token).split(':')[0]);
      if(!snapshot||snapshot.pid!==input.pid||input.window_id!==undefined&&snapshot.window!==input.window_id)throw Error('Read this exact window first; the element token is not owned by this conversation and pid.');
      input.window_id=snapshot.window;
    }
    if(input.capture_id){
      const capture=this.captures.get(input.capture_id);
      if(!capture||capture.pid!==input.pid||capture.window!==input.window_id)throw Error('Read this exact window first; the capture is not owned by this conversation and window.');
    }
    if(name!=='bring_to_front'&&!Number.isInteger(input.window_id))throw Error('Pass the exact window_id from list_windows or get_window_state.');
    if(!readOnly&&name!=='bring_to_front'&&![...this.snapshots.values(),...this.captures.values()].some(owner=>owner.pid===input.pid&&owner.window===input.window_id))throw Error('Read this exact window before sending input.');
    // check_permissions is read-only and does not request OS dialogs.
    const result=await this.raw(name,input,signal),data=driverData(result);
    if(name==='get_window_state'&&typeof data.snapshot_id==='string'){
      for(const [id,owner] of this.snapshots)if(owner.pid===input.pid&&owner.window===input.window_id)this.snapshots.delete(id);
      this.snapshots.set(data.snapshot_id,{pid:input.pid,window:input.window_id});
    }
    if(name==='get_window_state'&&typeof data.capture_id==='string'){
      for(const [id,owner] of this.captures)if(owner.pid===input.pid&&owner.window===input.window_id)this.captures.delete(id);
      this.captures.set(data.capture_id,{pid:input.pid,window:input.window_id});
    }
    return result;
  });}
}

export function computerCapabilities(){
  const session=new ComputerSession();sessions.add(session);
  const argsSchema={type:'object',properties:{name:{type:'string'},arguments:{type:'object',additionalProperties:true}},required:['name','arguments'],additionalProperties:false};
  const capabilities:Capability[]=[
    {name:'computer_tools',description:'Discover Cua Driver desktop/screen tools on demand (电脑操控 屏幕 KiCad GUI). Independent Computer Control toggle must be on. Returns matching schemas; does not capture or act.',inputSchema:{type:'object',properties:{query:{type:'string'}},additionalProperties:false},annotations:{readOnlyHint:true},execute:(args:any)=>session.tools(args.query)},
    {name:'computer_read',description:'Read an allowed application window with Cua Driver: list_apps, list_windows, get_window_state (AX tree and image), zoom, verify_state, check_permissions, get_guide. First use computer_tools for the exact schema. Text-only models can omit screenshots.',inputSchema:argsSchema,annotations:{readOnlyHint:true},execute:(args:any,ctx:any)=>session.call(args.name,args.arguments,true,ctx?.signal)},
    {name:'computer_action',description:'Control one allowed app window with Cua Driver: click, keys, text, scroll, drag, menu, window frame, front or launch. Discover schemas with computer_tools; ground actions in a fresh window observation, then read back. Respects app toggles and normal permission mode.',inputSchema:argsSchema,annotations:{readOnlyHint:false,destructiveHint:true},execute:(args:any,ctx:any)=>session.call(args.name,args.arguments,false,ctx?.signal)}
  ];
  return {capabilities,close:()=>session.close()};
}

export async function computerStatus(){
  const config=computerConfig();let binary:string|undefined,error:string|undefined;
  try{binary=await computerService.binary();}catch(e){error=String(e);}
  const running=binary?await computerService.running():false;
  let permissions:any;
  if(running){const session=new ComputerSession();try{permissions=driverData(await session.raw('check_permissions'));}catch(e){error=String(e);}finally{await session.close();}}
  return {...config,binary,running,permissions,error,platform:process.platform,socket:computerService.socket,log:computerService.log,persistent:running,lockedUse:false};
}
export async function computerSetting(action:string,value?:any){
  const cfg=vscode.workspace.getConfiguration('kicadAgent');
  if(action==='enabled'){
    if(typeof value!=='boolean')throw Error('enabled must be boolean');
    await cfg.update('computer.enabled',value,vscode.ConfigurationTarget.Global);
    if(value)await computerService.start();else{await disconnect();await computerService.stop();}
  }else if(action==='anyApp'){
    if(typeof value!=='boolean')throw Error('anyApp must be boolean');
    await cfg.update('computer.anyApp',value,vscode.ConfigurationTarget.Global);await disconnect();
  }else if(action==='allowedApps'){
    if(!Array.isArray(value)||!value.every(id=>typeof id==='string'&&/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(id)))throw Error('Use application bundle IDs.');
    await cfg.update('computer.allowedApps',[...new Set(value)],vscode.ConfigurationTarget.Global);await disconnect();
  }else if(action==='restart'){
    assertComputerEnabled(computerConfig());await disconnect();await computerService.stop();await computerService.start();
  }else if(action==='permissions'){
    assertComputerEnabled(computerConfig());
    // User-clicked only. The standard onboarding process owns its own default
    // daemon; no shell, no background dialog at activation or during a tool read.
    const {spawn}=await import('node:child_process');
    const child=spawn(await computerService.binary(),['permissions','grant'],{stdio:'ignore',detached:true,env:{...process.env,DO_NOT_TRACK:'1'}});child.on('error',()=>{});child.unref();
  }else if(action==='log'){
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(computerService.log)),{preview:true});
  }else throw Error('Unknown computer-control setting action.');
  return computerStatus();
}
export function registerComputerControl(context:vscode.ExtensionContext){
  let timer:ReturnType<typeof setTimeout>|undefined;
  const reconcile=()=>{clearTimeout(timer);timer=setTimeout(()=>{void (async()=>{await disconnect();if(computerConfig().enabled)await computerService.start();else await computerService.stop();})().catch(error=>console.warn('[Kicad Computer Control]',String(error)));},150);};
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event=>{if(event.affectsConfiguration('kicadAgent.computer'))reconcile();}),{dispose(){clearTimeout(timer);void disconnect();}});
  if(computerConfig().enabled)reconcile();
}
