// SPDX-License-Identifier: AGPL-3.0-only
import * as vscode from 'vscode';
import {RuntimeJournal} from './shared/kicadDiagnostics';
import {getKiCadNativeTools} from './kicadRuntime';

export function registerKiCadHealth(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Kicad 后端状态');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
  status.text = '$(circuit-board) Kicad';
  status.tooltip = '检查内部工具、KiCad IPC、文档与可选工具';
  status.command = 'kicadAgent.health';
  status.show();
  let current: AbortController | undefined;
  const refresh = async (showDetails = true) => {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任工作区，再检查本地后端。');
    current?.abort();
    const controller = new AbortController(); current = controller;
    status.text = '$(sync~spin) Kicad';
    try {
      const directory=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      const bindings=await getKiCadNativeTools(directory);
      const healthTool=bindings.find((binding:any)=>binding.name==='kicad_health');
      if(!healthTool) throw new Error('内部环境检查工具缺失。');
      const result=await healthTool.execute({}, {signal:controller.signal,directory});
      if(!result.ok) throw new Error(result.error?.message || '环境检查失败');
      if (current !== controller || controller.signal.aborted) return;
      const health = result.data;
      await new RuntimeJournal('extension',directory||process.cwd()).record({category:'connection',phase:'health',status:health.ipc?.available?'connected':'error',error:health.ipc?.result?.error});
      status.text = health.ipc?.available ? '$(circuit-board) Kicad · IPC 已连接' : '$(circuit-board) Kicad · IPC 未连接';
      status.tooltip = '点击刷新。内部工具可用与 KiCad 文档可操作是独立状态。';
      output.clear(); output.appendLine(JSON.stringify(result,null,2));
      const optional=(health.tools ?? []).filter((tool:{available:boolean})=>!tool.available).map((tool:{name:string})=>tool.name);
      if (showDetails) await vscode.window.showQuickPick([
        {label:'后端工具目录',description:`${health.compiledCapabilities?.actionCount ?? '未知'} 个动作 · ${bindings.length} 个内部工具`,detail:'工具直接在扩展进程运行；CLI、IPC 和当前文档分别检查。'},
        {label:'KiCad CLI',description:health.cli?.ok ? health.cli.data?.version : '不可用',detail:health.cli?.error?.message},
        {label:'KiCad IPC',description:health.ipc?.available ? '已连接' : '未连接',detail:health.ipc?.result?.error?.message || health.ipc?.socket},
        {label:'当前文档',description:health.documents?.ok ? '已查询，详情见后端状态输出' : 'IPC 未连接，无法查询',detail:JSON.stringify(health.documents ?? {})},
        {label:'可选外部工具',description:optional.length ? '缺少：'+optional.join('、') : '检测到的工具均可用'},
      ], {title:'Kicad 连接状态',placeHolder:'CLI、IPC、文档和外部工具分别检查；详细结果保存在“Kicad 后端状态”输出中。'});
      return result;
    } catch(error) {
      if (!controller.signal.aborted) {status.text='$(warning) Kicad';output.appendLine(String(error));if(showDetails)void vscode.window.showErrorMessage(String(error));}
    } finally {if(current===controller) current=undefined;}
  };
  const command = vscode.commands.registerCommand('kicadAgent.health', () => refresh());
  if (vscode.workspace.isTrusted) void refresh(false);
  const trust = vscode.workspace.onDidGrantWorkspaceTrust(() => { void refresh(false); });
  context.subscriptions.push(output,status,command,trust,{dispose(){current?.abort();}});
}
