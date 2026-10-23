// Cua Driver core is an external MIT-licensed dependency. The signed app owns
// macOS TCC permissions; the extension owns only its private launchd service.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const CUA_VERSION='0.38.0';
export const KICAD_APPS=['org.kicad.kicad','org.kicad.pcbnew','org.kicad.eeschema'];
export const COMPUTER_READ=['list_apps','list_windows','get_window_state','zoom','check_permissions','get_guide','verify_state'];
export const COMPUTER_ACTION=['click','double_click','right_click','drag','hotkey','press_key','scroll','set_value','type_text','set_window_frame','bring_to_front','invoke_menu','launch_app'];
export type ComputerConfig={enabled:boolean;driverPath:string;anyApp:boolean;allowedApps:string[]};
export function assertComputerEnabled(config:ComputerConfig){if(!config.enabled)throw Error('Computer control is off. Enable kicadAgent.computer.enabled in Computer Control settings.');}
export function appAllowed(config:ComputerConfig,app:any){return config.anyApp||typeof app?.bundle_id==='string'&&config.allowedApps.includes(app.bundle_id);}
export function driverData(result:any):any{
  if(result?.structuredContent)return result.structuredContent;
  for(const block of result?.content||[])if(block.type==='text'){try{return JSON.parse(block.text);}catch{}}
  return {};
}
export const xml=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function launchAgentPlist(app:string,socket:string,pidFile:string,log:string){
  const args=['/usr/bin/open','-W','-g','-n',app,'--args','serve','--socket',socket,'--pid-file',pidFile,'--no-overlay','--no-permissions-gate'];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>org.kicad.agent.cua-driver</string><key>ProgramArguments</key><array>${args.map(s=>'<string>'+xml(s)+'</string>').join('')}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>EnvironmentVariables</key><dict><key>DO_NOT_TRACK</key><string>1</string></dict><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>\n`;
}
export type Runner=(file:string,args:string[])=>Promise<string>;
const run:Runner=async(file,args)=>(await exec(file,args,{timeout:20000,maxBuffer:2*1024*1024,env:{...process.env,DO_NOT_TRACK:'1'}})).stdout;
export class CuaService {
  readonly uid=process.getuid?.()??0;
  readonly root=path.join(os.tmpdir(),'kicad-cua-'+this.uid);
  readonly socket=path.join(this.root,'driver.sock');
  readonly pidFile=path.join(this.root,'driver.pid');
  readonly label='org.kicad.agent.cua-driver';
  readonly plist=path.join(os.homedir(),'Library/LaunchAgents',this.label+'.plist');
  readonly log=path.join(os.homedir(),'Library/Logs/Kicad/cua-driver.log');
  private chain:Promise<unknown>=Promise.resolve();
  private config:()=>ComputerConfig;
  private runner:Runner;
  constructor(config:()=>ComputerConfig,runner:Runner=run){this.config=config;this.runner=runner;}
  private exclusive<T>(fn:()=>Promise<T>):Promise<T>{const next=this.chain.then(fn,fn);this.chain=next.catch(()=>{});return next;}
  async binary(){
    const configured=this.config().driverPath||'cua-driver';
    const expanded=configured.replace(/^~(?=\/|$)/,os.homedir());
    const candidates=path.isAbsolute(expanded)?[expanded]:[...String(process.env.PATH||'').split(path.delimiter),path.join(os.homedir(),'.local/bin'),'/opt/homebrew/bin','/usr/local/bin'].filter(Boolean).map(dir=>path.join(dir,expanded));
    for(const candidate of candidates){try{await fs.access(candidate,1);if((await fs.stat(candidate)).isFile())return candidate;}catch{}}
    throw Error('Cua Driver is not installed. Install the signed Cua Driver '+CUA_VERSION+' app, or set kicadAgent.computer.driverPath.');
  }
  private platform(){if(process.platform!=='darwin')throw Error('The managed persistent Cua service currently supports macOS.');}
  async running(){try{const text=await this.runner(await this.binary(),['status','--socket',this.socket,'--pid-file',this.pidFile]);return /daemon is running/.test(text);}catch{return false;}}
  async start(){return this.exclusive(async()=>{
    this.platform();assertComputerEnabled(this.config());const binary=await this.binary();
    const real=await fs.realpath(binary),suffix='/Contents/MacOS/cua-driver';
    if(!real.endsWith('/CuaDriver.app'+suffix))throw Error('Use the signed CuaDriver.app executable on macOS; a bare binary has a different permission identity.');
    const app=real.slice(0,-suffix.length);
    await this.runner('/usr/bin/codesign',['--verify','--deep','--strict',app]);
    await fs.mkdir(this.root,{recursive:true,mode:0o700});
    const st=await fs.lstat(this.root);
    if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==this.uid)throw Error('The private Cua service directory is not owned by this user.');
    await fs.chmod(this.root,0o700);
    await fs.mkdir(path.dirname(this.log),{recursive:true,mode:0o700});
    await fs.mkdir(path.dirname(this.plist),{recursive:true});
    const next=launchAgentPlist(app,this.socket,this.pidFile,this.log);
    const previous=await fs.readFile(this.plist,'utf8').catch(()=>'');
    if(previous!==next){
      await this.runner('/bin/launchctl',['bootout','gui/'+this.uid+'/'+this.label]).catch(()=>{});
      await this.runner(binary,['stop','--socket',this.socket]).catch(()=>{});
      await fs.writeFile(this.plist,next,{mode:0o600});
    }
    const loaded=await this.runner('/bin/launchctl',['print','gui/'+this.uid+'/'+this.label]).then(()=>true,()=>false);
    if(!loaded)await this.runner('/bin/launchctl',['bootstrap','gui/'+this.uid,this.plist]);
    // launchd supervises open -W, which waits on the signed app's daemon. No
    // terminal/preview panel is created, and the service survives editor exit.
    for(let attempt=0;attempt<30;attempt++){
      assertComputerEnabled(this.config());
      if(await this.running())return {running:true,socket:this.socket};
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    throw Error('Cua service did not become ready. See '+this.log);
  });}
  async stop(){return this.exclusive(async()=>{
    this.platform();
    // Remove supervision first, then stop ONLY the extension's private endpoint.
    await this.runner('/bin/launchctl',['bootout','gui/'+this.uid+'/'+this.label]).catch(()=>{});
    const binary=await this.binary().catch(()=>undefined);
    if(binary)await this.runner(binary,['stop','--socket',this.socket]).catch(()=>{});
    await fs.rm(this.plist,{force:true});
    const running=await this.running();
    if(running)throw Error('The private Cua service is still running. See '+this.log);
    return {running};
  });}
}
