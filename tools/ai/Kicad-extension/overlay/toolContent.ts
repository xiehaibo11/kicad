import * as vscode from 'vscode';
import {createHash} from 'node:crypto';

// Virtual documents are named, read-only editor tabs. The URI carries an ID,
// never the command or its output; nothing is written to disk or executed.
const scheme='kicad-tool-content';
const contents=new Map<string,string>();

export function registerToolContent(context:vscode.ExtensionContext){
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(scheme,{
      provideTextDocumentContent(uri){
        const content=contents.get(uri.toString());
        if(content===undefined)throw new Error('Tool content is no longer available. Open it again from the conversation.');
        return content;
      }
    }),
    vscode.workspace.onDidCloseTextDocument(document=>{
      if(document.uri.scheme===scheme)contents.delete(document.uri.toString());
    }),
    {dispose(){contents.clear();}}
  );
}

export async function openToolContent(content:string,fileName:string){
  const name=(fileName||'Tool output').replace(/[\\/\x00-\x1f\x7f]/g,' ').trim().slice(0,160)||'Tool output';
  const id=createHash('sha256').update(name).update('\0').update(content).digest('hex');
  const uri=vscode.Uri.from({scheme,path:'/'+name,query:'id='+id}),key=uri.toString();
  contents.set(key,content);
  try{
    const document=await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document,{viewColumn:vscode.ViewColumn.One,preview:true,preserveFocus:true});
  }catch(error){
    if(!vscode.workspace.textDocuments.some(document=>document.uri.toString()===key))contents.delete(key);
    throw error;
  }
}
