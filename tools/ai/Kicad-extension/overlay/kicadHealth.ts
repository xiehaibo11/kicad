// SPDX-License-Identifier: AGPL-3.0-only
import * as vscode from 'vscode';
import {execFile} from 'node:child_process';
import {getKiCadMcpServer} from './kicadRuntime';

export function registerKiCadHealth(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Kicad 后端状态');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 5);
  status.text = '$(circuit-board) Kicad';
  status.tooltip = '检查 MCP 后端、KiCad IPC、文档与可选工具';
  status.command = 'kicadAgent.health';
  status.show();
  let current: AbortController | undefined;
  const command = vscode.commands.registerCommand('kicadAgent.health', async () => {
    if (!vscode.workspace.isTrusted) throw new Error('请先信任工作区，再检查本地后端。');
    current?.abort();
    const controller = new AbortController(); current = controller;
    status.text = '$(sync~spin) Kicad';
    const server = getKiCadMcpServer();
    try {
      const result = await new Promise<Record<string, any>>((resolve, reject) => {
        execFile(server.command, ['health'], {env:{...process.env,...server.env}, timeout:15000, maxBuffer:2*1024*1024, signal:controller.signal}, (error, stdout, stderr) => {
          try {const data=JSON.parse(stdout); if(data.data) resolve(data); else reject(new Error(data.error?.message || String(error || stderr)));}
          catch {reject(error || new Error(stderr || '后端未返回有效状态'));}
        });
      });
      if (current !== controller || controller.signal.aborted) return;
      const health = result.data;
      status.text = health.ipc?.available ? '$(circuit-board) Kicad · IPC 已连接' : '$(circuit-board) Kicad · IPC 未连接';
      status.tooltip = '点击刷新。MCP 工具可发现与 KiCad 文档可操作是独立状态。';
      output.clear(); output.appendLine(JSON.stringify(result,null,2));
      const optional=(health.externalTools ?? []).filter((tool:{available:boolean})=>!tool.available).map((tool:{name:string})=>tool.name);
      await vscode.window.showQuickPick([
        {label:'后端工具目录',description:`${health.compiledCapabilities?.actionCount ?? '?'} 个动作 · ${health.compiledCapabilities?.mcpToolCount ?? '?'} 个 MCP 工具`,detail:'后端进程已启动；实际会话的 MCP 连接可在 MCP 设置中检查。'},
        {label:'KiCad CLI',description:health.kicadCli?.available ? health.kicadCli.version : '不可用',detail:health.kicadCli?.error},
        {label:'KiCad IPC',description:health.ipc?.available ? '已连接' : '未连接',detail:health.ipc?.error},
        {label:'当前文档',description:health.documents?.available ? '已查询，详情见后端状态输出' : 'IPC 未连接，无法查询',detail:JSON.stringify(health.documents ?? {})},
        {label:'可选外部工具',description:optional.length ? '缺少：'+optional.join('、') : '检测到的工具均可用'},
      ], {title:'Kicad 连接状态',placeHolder:'CLI、IPC、文档和外部工具分别检查；详细结果保存在“Kicad 后端状态”输出中。'});
      return result;
    } catch(error) {
      if (!controller.signal.aborted) {status.text='$(warning) Kicad';output.appendLine(String(error));void vscode.window.showErrorMessage(String(error));}
    } finally {if(current===controller) current=undefined;}
  });
  context.subscriptions.push(output,status,command,{dispose(){current?.abort();}});
}
