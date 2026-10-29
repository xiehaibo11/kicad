import * as vscode from 'vscode';
import {droppedFilePaths} from './webview/src/utils/composerDrop';

const DROP_TYPES = ['application/vnd.code.uri-list','text/uri-list','codeeditors','resourceurls','codefiles','files'];

export async function nativeDroppedPaths(transfer:vscode.DataTransfer,token:vscode.CancellationToken):Promise<string[]> {
  const data:Record<string,string> = {};
  const files:string[] = [];
  // Snapshot every item before handing off to the webview. Never read file bodies here.
  for (const [type,item] of transfer) {
    if (token.isCancellationRequested) return [];
    if (DROP_TYPES.includes(type.toLowerCase()) && type.toLowerCase() !== 'files') {
      try { data[type] = await item.asString(); } catch { /* try the next representation */ }
    }
    const uri = item.asFile()?.uri;
    if (uri?.scheme === 'file') files.push(uri.fsPath);
  }
  if (token.isCancellationRequested) return [];
  const paths = droppedFilePaths({types:Object.keys(data),getData:type => data[type] || ''});
  return paths.length ? paths : [...new Set(files)];
}

export function registerNativeAttachmentDrop(context:vscode.ExtensionContext,enqueue:(paths:string[]) => void) {
  const item = new vscode.TreeItem('将文件拖到这里添加到对话',vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon('attach');
  item.tooltip = '直接拖入文件或文件夹';
  item.command = {command:'kicad.attachFiles',title:'添加附件'};
  context.subscriptions.push(vscode.commands.registerCommand('kicad.attachFiles',async () => {
    const files = await vscode.window.showOpenDialog({canSelectMany:true,openLabel:'添加到对话'});
    if (files?.length) await accept(files.filter(uri => uri.scheme === 'file').map(uri => uri.fsPath));
  }));
  async function accept(paths:string[]) {
    try {
      enqueue(paths);
      await vscode.commands.executeCommand('kicad.chatView.focus');
    } catch (error) { void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
  }
  const view = vscode.window.createTreeView<vscode.TreeItem>('kicad.attachmentDrop',{
    treeDataProvider:{getTreeItem:element => element,getChildren:element => element ? [] : [item]},
    dragAndDropController:{
      dragMimeTypes:[],dropMimeTypes:DROP_TYPES,
      async handleDrop(_target,transfer,token) {
        const paths = await nativeDroppedPaths(transfer,token);
        if (!token.isCancellationRequested) await accept(paths);
      }
    }
  });
  context.subscriptions.push(view);
}
