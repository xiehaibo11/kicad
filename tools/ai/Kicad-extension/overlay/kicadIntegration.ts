// SPDX-License-Identifier: AGPL-3.0-only
import * as vscode from 'vscode';
import { resolveDeepSeekCredentials } from './kicadProviders';
import { findExecutable, getAgentInstructionsPath, getEasyEdaMcpServer, getKiCadMcpServer, openCodeConfig } from './kicadRuntime';

async function selectWorkspace(): Promise<vscode.WorkspaceFolder | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) return folders[0];
  if (folders.length > 1) return vscode.window.showWorkspaceFolderPick({ placeHolder: 'Kicad 工作目录' });
  void vscode.window.showErrorMessage('Open a project folder before starting kicad.');
  return undefined;
}

export function registerKiCadIntegration(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri: async uri => {
        if (uri.path === '/terminal') {
          await vscode.commands.executeCommand('kicadAgent.startOpenCode');
        } else if (uri.path === '/chat') {
          await vscode.commands.executeCommand('kicad.showChat');
        }
      }
    }),
    vscode.commands.registerCommand('kicadAgent.startOpenCode', async () => {
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showErrorMessage('请先信任此工作区，再启动 Kicad 终端。');
        return;
      }
      const folder = await selectWorkspace();
      if (!folder) return;
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
        const env: Record<string, string> = { OPENCODE_DISABLE_TERMINAL_TITLE: 'true' };
        if (cfg.get<boolean>('openCode.injectMcp', true)) {
          const server = getKiCadMcpServer(folder.uri.fsPath);
          if (!findExecutable(server.command)) {
            throw new Error(`KiCad agent not found: ${server.command}. Set kicadAgent.path.`);
          }
          env.OPENCODE_CONFIG_CONTENT = openCodeConfig(server, process.env.OPENCODE_CONFIG_CONTENT, await resolveDeepSeekCredentials(context),
            { easyeda: getEasyEdaMcpServer(folder.uri.fsPath), instructions: getAgentInstructionsPath() });
        }
        // Launch the real executable as the terminal process: PTY input,
        // streaming, session management and all OpenCode commands stay native.
        // No shell command strings, noninteractive run mode, or prompt replay.
        const terminal = vscode.window.createTerminal({
          name: 'Kicad 终端',
          cwd: folder.uri,
          shellPath: executable,
          shellArgs: cfg.get<string[]>('openCode.args', []),
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
      const server = getKiCadMcpServer(folder.uri.fsPath);
      const easyeda = getEasyEdaMcpServer(folder.uri.fsPath);
      const instructions = getAgentInstructionsPath();
      const content = JSON.stringify({
        claude: { mcpServers: { kicad: server, ...(easyeda ? { easyeda } : {}) }, appendSystemPrompt: instructions },
        opencode: JSON.parse(openCodeConfig(server, undefined, undefined, { easyeda, instructions }))
      }, null, 2);
      const document = await vscode.workspace.openTextDocument({ language: 'json', content });
      await vscode.window.showTextDocument(document);
    })
  );
}
