// SPDX-License-Identifier: AGPL-3.0-only
import * as vscode from 'vscode';
import {diagnosticReport} from './shared/kicadDiagnostics';
import {listHistory,readHistory} from './shared/kicadHistory';
import { resolveDeepSeekCredentials } from './kicadProviders';
import { closeKiCadRuntimes, findExecutable, getAgentInstructionsPath, getKiCadRuntimeConfig, openCodeConfig } from './kicadRuntime';

async function selectWorkspace(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders[0];
  if (folders.length > 1) return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Kicad 工作目录' });
  void vscode.window.showErrorMessage('Open a project folder before starting kicad.');
  return undefined;
}

export function registerKiCadIntegration(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    { dispose:closeKiCadRuntimes },
    vscode.commands.registerCommand('kicadAgent.diagnostics',async()=>{
      const folder=await selectWorkspace();if(!folder)return;
      try {const report=await diagnosticReport(folder.uri.fsPath);const doc=await vscode.workspace.openTextDocument({language:'json',content:JSON.stringify(report,null,2)});await vscode.window.showTextDocument(doc,{preview:true});}
      catch(error){void vscode.window.showErrorMessage('读取运行诊断失败：'+String(error));}
    }),
    vscode.commands.registerCommand('kicadAgent.history',async()=>{
      const folder=await selectWorkspace();if(!folder)return;
      try{
        const records=await listHistory(folder.uri.fsPath);
        const selected=await vscode.window.showQuickPick(records.map(entry=>({label:entry.summary,
          description:entry.source==='terminal'?'终端':'扩展',detail:new Date(entry.lastModified).toLocaleString()+' · '+entry.messageCount+' 条消息',entry})),
          {title:'共享会话历史',placeHolder:records.length?'选择要读取的会话':'当前工作区暂无历史会话',matchOnDescription:true});
        if(!selected)return;
        const action=selected.entry.source==='terminal'?await vscode.window.showQuickPick(['查看完整记录','在终端继续'],{title:selected.entry.summary}):'查看完整记录';
        if(action==='在终端继续'){
          await vscode.commands.executeCommand('kicadAgent.startOpenCode',{id:selected.entry.nativeId,cwd:folder.uri.fsPath});return;
        }
        if(action!=='查看完整记录')return;
        const messages=await readHistory(selected.entry.id,folder.uri.fsPath);
        const content=JSON.stringify({source:selected.entry.source,sessionId:selected.entry.nativeId,workspace:folder.uri.fsPath,messages},null,2);
        const document=await vscode.workspace.openTextDocument({language:'json',content});
        await vscode.window.showTextDocument(document,{preview:true});
      }catch(error){void vscode.window.showErrorMessage('读取会话历史失败：'+(error instanceof Error?error.message:String(error)));}
    }),
    vscode.window.registerUriHandler({
      handleUri: async uri => {
        if (uri.path === '/terminal') {
          await vscode.commands.executeCommand('kicadAgent.startOpenCode');
        } else if (uri.path === '/chat') {
          await vscode.commands.executeCommand('kicad.showChat');
        }
      }
    }),
    vscode.commands.registerCommand('kicadAgent.startOpenCode', async (resume?:{id:string;cwd:string}) => {
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showErrorMessage('请先信任此工作区，再启动 Kicad 终端。');
        return;
      }
      const folder = await selectWorkspace();
      if (!folder) return;
      if(resume && (!/^ses_[a-zA-Z0-9]+$/.test(resume.id)||resume.cwd!==folder.uri.fsPath))throw new Error('终端会话不属于当前工作区。');
      const cfg = vscode.workspace.getConfiguration('kicadAgent', folder.uri);
      const configured = cfg.get<string>('openCode.path', 'kicad-terminal');
      const executable = findExecutable(configured);
      if (!executable) {
        void vscode.window.showErrorMessage(
          `Kicad terminal executable not found: ${configured}. Build/install tools/ai/Kicad-terminal, or set kicadAgent.openCode.path.`
        );
        return;
      }
      try {
        // Keep the software's terminal name when the underlying runtime starts
        // or switches sessions. This only controls the title, not its features.
        const env: Record<string, string> = { OPENCODE_DISABLE_TERMINAL_TITLE: 'true', KICAD_CLI: cfg.get<string>('kicadCli', '') || 'kicad-cli' };
        const socket = cfg.get<string>('socket', '') || process.env.KICAD_API_SOCKET;
        if (socket) env.KICAD_API_SOCKET = socket;
        if (cfg.get<boolean>('openCode.injectMcp', true)) {
          // The terminal owns its provider authentication. Reuse explicitly
          // configured file/env/settings credentials without querying the
          // extension's OS SecretStorage during terminal startup.
          env.OPENCODE_CONFIG_CONTENT = openCodeConfig(process.env.OPENCODE_CONFIG_CONTENT, await resolveDeepSeekCredentials(),
            { instructions: getAgentInstructionsPath() });
        }
        // Launch the real executable as the terminal process: PTY input,
        // streaming, session management and all OpenCode commands stay native.
        // No shell command strings, noninteractive run mode, or prompt replay.
        const terminal = vscode.window.createTerminal({
          name: 'Kicad 终端',
          cwd: folder.uri,
          shellPath: executable,
          shellArgs: resume ? [...cfg.get<string[]>('openCode.args', []).filter((arg,index,args)=>!['--continue','-c','--session','-s'].includes(arg)&&!['--session','-s'].includes(args[index-1])), '--session',resume.id] : cfg.get<string[]>('openCode.args', []),
          env
        });
        // A user's terminal session outlives extension hot reloads normally.
        terminal.show();
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }),
    vscode.commands.registerCommand('kicadClaudix.showMcpConfig', async () => {
      const folder = await selectWorkspace();
      if (!folder) return;
      const server = getKiCadRuntimeConfig(folder.uri.fsPath);
      const instructions = getAgentInstructionsPath();
      const content = JSON.stringify({
        claude: { mcpServers: { kicad: {transport: 'in-process', module:server.entry, tools: 'shared JavaScript runtime'} }, appendSystemPrompt: instructions },
        opencode: JSON.parse(openCodeConfig(undefined, undefined, { instructions }))
      }, null, 2);
      const document = await vscode.workspace.openTextDocument({ language: 'json', content });
      await vscode.window.showTextDocument(document);
    })
  );
}
