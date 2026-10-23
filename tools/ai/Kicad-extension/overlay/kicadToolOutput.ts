import * as vscode from 'vscode';
import {ExecutionOutput,terminalText} from './shared/kicadExecutionOutput';

const LIMIT=1024*1024;
let buffer='',terminal:vscode.Terminal|undefined;
let writes:vscode.EventEmitter<string>|undefined;
const output=new ExecutionOutput(text=>{
  const safe=terminalText(text).replace(/\n/g,'\r\n');
  buffer+=safe;if(buffer.length>LIMIT)buffer='[Earlier output is available in session_history]\r\n'+buffer.slice(-LIMIT);
  writes?.fire(safe);
});
// Never opens, reveals or focuses a terminal as a side effect of tool execution.
export function recordToolOutput(message:Record<string,any>){output.observe(message);}
export function registerToolOutput(context:vscode.ExtensionContext){
  writes=new vscode.EventEmitter<string>();
  const emitter=writes;
  context.subscriptions.push(emitter,vscode.commands.registerCommand('kicadAgent.showToolOutput',()=>{
    if(!terminal)terminal=vscode.window.createTerminal({name:'Kicad Tools',isTransient:true,pty:{onDidWrite:emitter.event,open(){emitter.fire(buffer||'Tool output appears here when a tool runs.\r\n');},close(){terminal=undefined;}}});
    terminal.show(true);
  }),{dispose(){terminal?.dispose();terminal=undefined;buffer='';writes=undefined;}});
}
