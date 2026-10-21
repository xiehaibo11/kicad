import * as vscode from 'vscode';
import { execFile, spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as crypto from 'crypto';

interface AgentError {
  code: string;
  message: string;
}

interface AgentResult {
  ok: boolean;
  action: string;
  data?: any;
  error?: AgentError;
  artifacts?: string[];
}

interface ActionSpec {
  name: string;
  domain: string;
  backend: string;
  mutates: boolean;
  description: string;
  inputs?: string[];
}

const DOMAIN_LABELS: Record<string, string> = {
  system: 'System',
  project: 'Project',
  document: 'Document',
  schematic: 'Schematic',
  board: 'Board',
  library: 'Library',
  external: 'External Tools',
  pipeline: 'Pipeline',
  spec: 'Design Spec',
  workflow: 'Workflow',
  blocks: 'Circuit Blocks'
};

let output: vscode.OutputChannel;
let diagnostics: vscode.DiagnosticCollection;
let statusBar: vscode.StatusBarItem;
let apiServer: ChildProcess | undefined;
let apiServerSocket: string | undefined;

export function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel('KiCad Agent');
  diagnostics = vscode.languages.createDiagnosticCollection('kicad-agent');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'kicadAgent.health';
  statusBar.text = '$(circuit-board) KiCad';
  statusBar.tooltip = 'KiCad Agent: click to check kicad-cli and IPC';
  statusBar.show();

  const chat = new ChatViewProvider(context);

  context.subscriptions.push(
    output,
    diagnostics,
    statusBar,
    chat,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chat, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('kicadAgent.health', guard(health)),
    vscode.commands.registerCommand('kicadAgent.actions', guard(showActions)),
    vscode.commands.registerCommand('kicadAgent.runAction', guard((name?: string) => runActionCommand(name))),
    vscode.commands.registerCommand('kicadAgent.runDrc', guard(runDrc)),
    vscode.commands.registerCommand('kicadAgent.runErc', guard(runErc)),
    vscode.commands.registerCommand('kicadAgent.generateSchematic', guard(generateSchematic)),
    vscode.commands.registerCommand('kicadAgent.fanout', guard(runFanout)),
    vscode.commands.registerCommand('kicadAgent.dfmAnalyze', guard(() => runDfm(false))),
    vscode.commands.registerCommand('kicadAgent.dfmFix', guard(() => runDfm(true))),
    vscode.commands.registerCommand('kicadAgent.impedance', guard(runImpedance)),
    vscode.commands.registerCommand('kicadAgent.autoroute', guard(runAutoroute)),
    vscode.commands.registerCommand('kicadAgent.structuralCheck', guard(runStructuralCheck)),
    vscode.commands.registerCommand('kicadAgent.aiPrompt', guard(async () => {
      await vscode.commands.executeCommand('kicadAgent.chat.focus');
    })),
    vscode.commands.registerCommand('kicadAgent.showMcpConfig', guard(showMcpConfig)),
    vscode.commands.registerCommand('kicadAgent.configure', guard(configureLlm)),
    vscode.commands.registerCommand('kicadAgent.startServer', guard(startApiServer)),
    vscode.commands.registerCommand('kicadAgent.stopServer', guard(stopApiServer))
  );
}

export function deactivate() {
  stopApiServerProcess();
  diagnostics?.dispose();
}

// ---------------------------------------------------------------------------
// Configuration and process helpers
// ---------------------------------------------------------------------------

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('kicadAgent');
}

function which(binary: string): string | undefined {
  const dirs = (process.env.PATH ?? '').split(path.delimiter);

  for (const dir of dirs) {
    if (!dir) {
      continue;
    }

    const candidate = path.join(dir, binary);

    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep looking
    }
  }

  return undefined;
}

// Resolve a binary from the setting, then PATH, then ~/.local/bin.  VS Code
// launched from the Dock does not inherit the login shell's PATH, so the last
// fallback is what makes the installed wrappers work in that case.
function resolveBinary(configured: string | undefined, names: string[]): string {
  if (configured && !names.includes(configured)) {
    return configured;
  }

  for (const name of names) {
    const found = which(name);
    if (found) {
      return found;
    }
  }

  for (const name of names) {
    const fallback = path.join(os.homedir(), '.local', 'bin', name);
    if (fs.existsSync(fallback)) {
      return fallback;
    }
  }

  return configured || names[0];
}

function agentPath(): string {
  return resolveBinary(config().get<string>('path'), ['kicad-agent']);
}

function kicadCliPath(): string {
  return resolveBinary(config().get<string>('kicadCli'), ['kicad', 'kicad-cli']);
}

function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const kicadCli = kicadCliPath();

  if (kicadCli) {
    env.KICAD_CLI = kicadCli;
  }

  const socket = config().get<string>('socket');
  if (socket) {
    env.KICAD_API_SOCKET = socket;
  }

  const symbolDir = config().get<string>('symbolDir');
  if (symbolDir) {
    env.KICAD10_SYMBOL_DIR = symbolDir;
  }

  const footprintDir = config().get<string>('footprintDir');
  if (footprintDir) {
    env.KICAD10_FOOTPRINT_DIR = footprintDir;
  }

  // A build-tree kicad-cli needs this to locate its kifaces.
  if (kicadCli && kicadCli.includes(`${path.sep}build${path.sep}`)) {
    env.KICAD_RUN_FROM_BUILD_DIR = '1';
  }

  return env;
}

function execCapture(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const timeout = config().get<number>('timeoutMs') || 1800000;

  return new Promise(resolve => {
    execFile(
      agentPath(),
      args,
      { cwd, env: environment(), timeout, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let code = 0;

        if (error) {
          const raw = (error as NodeJS.ErrnoException & { code?: number | string }).code;
          code = typeof raw === 'number' ? raw : 1;
        }

        resolve({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          code
        });
      }
    );
  });
}

async function runCli(args: string[], cwd?: string): Promise<AgentResult> {
  const { stdout, stderr, code } = await execCapture(args, cwd);
  const text = stdout.trim();

  if (!text) {
    throw new Error(stderr.trim() || `kicad-agent exited with ${code}`);
  }

  let parsed: AgentResult;

  try {
    parsed = JSON.parse(text) as AgentResult;
  } catch {
    throw new Error(`kicad-agent returned non-JSON output: ${text.slice(0, 400)}`);
  }

  if (stderr.trim()) {
    output.appendLine(stderr.trim());
  }

  return parsed;
}

async function runAction(action: string, payload: any, cwd?: string): Promise<AgentResult> {
  output.appendLine(`> ${action} ${JSON.stringify(payload)}`);
  return runCli(['call', action, '--payload', JSON.stringify(payload)], cwd);
}

function guard(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`ERROR: ${message}`);
      output.show(true);
      vscode.window.showErrorMessage(`KiCad Agent: ${message}`);
    }
  };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function health(): Promise<void> {
  const result = await runCli(['health']);
  const data = result.data ?? {};
  const cli = data.kicadCli ?? {};
  const ipc = data.ipc ?? {};

  output.appendLine(JSON.stringify(result, null, 2));

  if (cli.available) {
    statusBar.text = `$(circuit-board) KiCad ${cli.version ?? ''}`.trim();
  } else {
    statusBar.text = '$(warning) KiCad CLI missing';
  }

  const message = [
    `kicad-cli: ${cli.available ? cli.version ?? 'available' : 'not found'}`,
    `IPC: ${ipc.available ? 'connected' : 'unavailable'}`
  ].join(' | ');

  vscode.window.showInformationMessage(`KiCad Agent — ${message}`);
}

async function showActions(): Promise<void> {
  const result = await runCli(['actions']);
  const actions: ActionSpec[] = result.data?.actions ?? [];

  const picked = await vscode.window.showQuickPick(
    actions.map(action => ({
      label: `${DOMAIN_LABELS[action.domain] ?? action.domain}: ${action.name}`,
      description: action.mutates ? 'mutates' : 'read-only',
      detail: action.description,
      action
    })),
    { matchOnDescription: true, matchOnDetail: true, placeHolder: 'Select a KiCad action' }
  );

  if (!picked) {
    return;
  }

  const payload = await promptPayload(picked.action);
  if (payload === undefined) {
    return;
  }

  const res = await runAction(picked.action.name, payload, workspaceRoot());
  showResult(res);
  await maybePublishDiagnostics(res);
}

async function runActionCommand(name?: string): Promise<void> {
  if (!name) {
    await showActions();
    return;
  }

  const result = await runCli(['actions']);
  const action = (result.data?.actions ?? []).find((a: ActionSpec) => a.name === name) as ActionSpec | undefined;
  const payload = await promptPayload(action);
  if (payload === undefined) {
    return;
  }

  const res = await runAction(name, payload, workspaceRoot());
  showResult(res);
  await maybePublishDiagnostics(res);
}

async function runDrc(): Promise<void> {
  const document = activeDocument('.kicad_pcb');
  if (!document) {
    throw new Error('open a .kicad_pcb file first');
  }

  const outputPath = artifactPath('drc.json');
  const result = await runAction('board.drc.run', {
    input: document.fileName,
    output: outputPath,
    format: 'json',
    timeoutMs: 600000,
    refillZones: true
  }, workspaceRoot());

  showResult(result);
  await publishReport(document.uri, result, 'KiCad DRC');
}

async function runErc(): Promise<void> {
  const document = activeDocument('.kicad_sch');
  if (!document) {
    throw new Error('open a .kicad_sch file first');
  }

  const outputPath = artifactPath('schematic-erc.json');
  const result = await runAction('schematic.erc.run', {
    input: document.fileName,
    output: outputPath,
    format: 'json',
    timeoutMs: 300000
  }, workspaceRoot());

  showResult(result);
  await publishReport(document.uri, result, 'KiCad ERC');
}

async function generateSchematic(): Promise<void> {
  const root = workspaceRoot();
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Circuit spec': ['json'] },
    openLabel: 'Generate schematic'
  });

  if (!picked || picked.length === 0) {
    return;
  }

  const result = await runCli([
    'sch', 'generate',
    '--spec', picked[0].fsPath,
    '--project', root,
    '--new'
  ], root);

  showResult(result);
}

async function runFanout(): Promise<void> {
  const document = activeDocument('.kicad_pcb');
  if (!document) {
    throw new Error('open a .kicad_pcb file first');
  }

  const style = await vscode.window.showQuickPick(
    [
      { label: 'via-in-pad', description: 'place a through via at each ball center' },
      { label: 'dogbone', description: 'offset via + short escape track' }
    ],
    { placeHolder: 'Fanout style' }
  );

  if (!style) {
    return;
  }

  const reference = await vscode.window.showInputBox({
    prompt: 'Footprint reference (blank = largest pad count)',
    value: ''
  });

  if (reference === undefined) {
    return;
  }

  const mode = await vscode.window.showQuickPick(['Dry run', 'Apply'], {
    placeHolder: 'Fanout is mutating; choose a mode'
  });

  if (!mode) {
    return;
  }

  const result = await runAction('board.fanout.run', {
    document: { type: 'pcb', path: document.fileName },
    reference,
    style: style.label,
    drillMm: 0.2,
    diameterMm: 0.45,
    dryRun: mode === 'Dry run'
  }, workspaceRoot());

  showResult(result);
}

function stopApiServerProcess(): void {
  if (apiServer) {
    apiServer.kill();
    apiServer = undefined;
  }
  apiServerSocket = undefined;
}

async function startApiServer(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const fileName = editor?.document.fileName ?? '';

  if (!/\.kicad_(pcb|sch)$/i.test(fileName)) {
    throw new Error('open a .kicad_pcb or .kicad_sch file first');
  }

  stopApiServerProcess();

  const cli = kicadCliPath();
  let socket = config().get<string>('socket') || '';

  // Never reuse a socket that another server may still own.
  if (!socket || fs.existsSync(socket)) {
    socket = path.join(os.tmpdir(), `kicad-agent-${process.pid}-${Date.now()}.sock`);
  }

  output.appendLine(`[server] ${cli} api-server ${fileName} --socket ${socket}`);

  const child = spawn(cli, ['api-server', fileName, '--socket', socket], {
    env: environment(),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout?.on('data', (data: Buffer) => output.append(data.toString()));
  child.stderr?.on('data', (data: Buffer) => output.append(data.toString()));
  child.on('exit', code => {
    output.appendLine(`[server] exited with ${code}`);
    apiServer = undefined;
    statusBar.text = '$(circuit-board) KiCad';
  });

  apiServer = child;
  apiServerSocket = socket;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Starting KiCad API server', cancellable: false },
    async () => {
      for (let i = 0; i < 120; i++) {
        if (fs.existsSync(socket)) {
          return;
        }
        if (child.exitCode !== null) {
          throw new Error(`kicad-cli api-server exited with ${child.exitCode}; see the KiCad Agent output`);
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('timed out waiting for the API socket');
    }
  );

  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config().update('socket', socket, target);
  statusBar.text = '$(circuit-board) KiCad: server';
  statusBar.tooltip = `KiCad API server: ${socket}`;
  vscode.window.showInformationMessage(`KiCad API server ready: ${socket}`);
}

async function stopApiServer(): Promise<void> {
  stopApiServerProcess();
  statusBar.text = '$(circuit-board) KiCad';
  statusBar.tooltip = 'KiCad Agent: click to check kicad-cli and IPC';
  vscode.window.showInformationMessage('KiCad API server stopped.');
}

async function runDfm(apply: boolean): Promise<void> {
  const document = activeDocument('.kicad_pcb');
  if (!document) {
    throw new Error('open a .kicad_pcb file first');
  }

  const result = await runAction(apply ? 'board.dfm.fix' : 'board.dfm.analyze', {
    document: { type: 'pcb', path: document.fileName },
    minWidthMm: 0.15,
    dryRun: !apply
  }, workspaceRoot());

  showResult(result);
}

async function runImpedance(): Promise<void> {
  const document = activeDocument('.kicad_pcb');
  if (!document) {
    throw new Error('open a .kicad_pcb file first');
  }

  const layer = await vscode.window.showInputBox({ prompt: 'Copper layer', value: 'F.Cu' });
  if (layer === undefined) {
    return;
  }

  const targetText = await vscode.window.showInputBox({ prompt: 'Target impedance (ohm)', value: '50' });
  if (targetText === undefined) {
    return;
  }

  const result = await runAction('board.impedance.calculate', {
    document: { type: 'pcb', path: document.fileName },
    layer,
    targetOhm: Number(targetText)
  }, workspaceRoot());

  showResult(result);
}

async function runAutoroute(): Promise<void> {
  const document = activeDocument('.kicad_pcb');
  if (!document) {
    throw new Error('open a .kicad_pcb file first');
  }

  const planner = await vscode.window.showQuickPick(
    [
      { label: 'Obstacle-aware grid (slower, avoids pads/tracks/vias)', value: 'grid' },
      { label: 'L-router baseline (fast, no obstacle checks)', value: '' }
    ],
    { placeHolder: 'Routing planner' }
  );

  if (!planner) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    planner.value === 'grid'
      ? 'The grid router avoids existing copper but routes a single layer. Run DRC and connectivity afterwards. Continue?'
      : 'The L-router baseline does not avoid obstacles or shove tracks. Run DRC afterwards. Continue?',
    { modal: true },
    'Run'
  );

  if (confirm !== 'Run') {
    return;
  }

  const nets = await vscode.window.showInputBox({
    prompt: 'Comma-separated nets (blank = all)',
    value: ''
  });

  if (nets === undefined) {
    return;
  }

  const result = await runAction('board.route.autoroute', {
    document: { type: 'pcb', path: document.fileName },
    nets: nets ? nets.split(',').map(n => n.trim()).filter(Boolean) : [],
    planner: planner.value,
    clearanceMm: 0.2,
    gridMm: 0.25,
    dryRun: false
  }, workspaceRoot());

  showResult(result);
}

async function runStructuralCheck(): Promise<void> {
  const document = activeDocument('.kicad_pcb');
  if (!document) {
    throw new Error('open a .kicad_pcb file first');
  }

  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Heights JSON': ['json'] },
    openLabel: 'Use heights (optional)'
  });

  let heights: Record<string, number> = {};

  if (picked && picked.length > 0) {
    heights = JSON.parse(fs.readFileSync(picked[0].fsPath, 'utf8'));
  }

  const exact = await vscode.window.showQuickPick(
    [
      { label: 'Exact STEP solid intersection (OpenCASCADE)', value: true },
      { label: '2.5D bounding-box check only', value: false }
    ],
    { placeHolder: 'Collision check mode' }
  );

  if (!exact) {
    return;
  }

  const result = await runAction('board.check.3d', {
    document: { type: 'pcb', path: document.fileName },
    heights,
    exportStep: true,
    exactStep: exact.value
  }, workspaceRoot());

  showResult(result);
}

async function configureLlm(): Promise<void> {
  const settingsPath = config().get<string>('settings')
    || path.join(os.homedir(), '.config', 'kicad-agent', 'settings.json');

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });

  if (!fs.existsSync(settingsPath)) {
    const template = {
      default: 'anthropic',
      providers: {
        anthropic: {
          type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKeyEnv: 'ANTHROPIC_API_KEY',
          model: 'claude-sonnet-5-5',
          maxTokens: 8192
        },
        openai: {
          type: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKeyEnv: 'OPENAI_API_KEY',
          model: 'gpt-4o'
        }
      }
    };

    fs.writeFileSync(settingsPath, `${JSON.stringify(template, null, 2)}\n`, { mode: 0o600 });
  }

  const document = await vscode.workspace.openTextDocument(settingsPath);
  await vscode.window.showTextDocument(document);
  vscode.window.showInformationMessage(
    'KiCad Agent: 配置已打开。填好 provider 与对应的环境变量后，回到对话框重新发送即可。'
  );
}

async function showMcpConfig(): Promise<void> {
  const snippet = {
    mcpServers: {
      kicad: {
        command: agentPath(),
        args: ['mcp'],
        env: {
          KICAD_CLI: kicadCliPath(),
          KICAD_API_SOCKET: config().get<string>('socket') || '/tmp/kicad/api.sock'
        }
      }
    }
  };

  const document = await vscode.workspace.openTextDocument({
    language: 'json',
    content: JSON.stringify(snippet, null, 2)
  });

  await vscode.window.showTextDocument(document);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    return folder.uri.fsPath;
  }

  const active = vscode.window.activeTextEditor?.document;
  return active ? path.dirname(active.fileName) : process.cwd();
}

function artifactPath(name: string): string {
  const dir = path.join(workspaceRoot(), '.kicad-agent');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

function activeDocument(extension: string): vscode.TextDocument | undefined {
  const document = vscode.window.activeTextEditor?.document;
  return document && document.fileName.toLowerCase().endsWith(extension) ? document : undefined;
}

async function promptPayload(action?: ActionSpec): Promise<any> {
  const raw = await vscode.window.showInputBox({
    prompt: action ? `JSON payload for ${action.name}` : 'JSON payload',
    value: '{}',
    validateInput: value => {
      try {
        JSON.parse(value);
        return undefined;
      } catch {
        return 'Invalid JSON';
      }
    }
  });

  if (raw === undefined) {
    return undefined;
  }

  return JSON.parse(raw);
}

function showResult(result: AgentResult): void {
  output.appendLine(JSON.stringify(result, null, 2));

  if (result.ok) {
    const count = Array.isArray(result.artifacts) ? ` (${result.artifacts.length} artifact(s))` : '';
    vscode.window.showInformationMessage(`KiCad Agent: ${result.action} completed${count}`);
  } else {
    const message = result.error ? `${result.error.code}: ${result.error.message}` : 'action failed';
    vscode.window.showWarningMessage(`KiCad Agent: ${message}`);
  }
}

async function maybePublishDiagnostics(result: AgentResult): Promise<void> {
  if (result.action !== 'board.drc.run' && result.action !== 'schematic.erc.run') {
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  await publishReport(editor.document.uri, result, result.action === 'board.drc.run' ? 'KiCad DRC' : 'KiCad ERC');
}

async function publishReport(uri: vscode.Uri, result: AgentResult, source: string): Promise<void> {
  const report = result.data?.reportJson ?? result.data?.report ?? {};
  let violations: any[] = Array.isArray(report.violations) ? report.violations : [];

  if (violations.length === 0 && Array.isArray(report.sheets)) {
    violations = report.sheets.flatMap((sheet: any) => sheet.violations ?? []);
  }

  const textDocument = await vscode.workspace.openTextDocument(uri);
  const text = textDocument.getText();

  const items = violations.map(violation => {
    const uuid: string | undefined = violation.items?.[0]?.uuid;
    const index = uuid ? text.indexOf(uuid) : -1;
    const position = index >= 0 ? textDocument.positionAt(index) : new vscode.Position(0, 0);
    const range = new vscode.Range(position.line, 0, position.line, 240);

    let severity = vscode.DiagnosticSeverity.Information;
    if (violation.severity === 'error') {
      severity = vscode.DiagnosticSeverity.Error;
    } else if (violation.severity === 'warning') {
      severity = vscode.DiagnosticSeverity.Warning;
    }

    const diagnostic = new vscode.Diagnostic(
      range,
      `${violation.type}: ${violation.description ?? ''}`,
      severity
    );
    diagnostic.source = source;
    diagnostic.code = violation.type;
    return diagnostic;
  });

  diagnostics.set(uri, items);
  output.appendLine(`${source}: ${items.length} diagnostic(s)`);

  if (items.length > 0) {
    vscode.window.showWarningMessage(`${source}: ${items.length} finding(s). See the Problems panel.`);
  }
}

// ---------------------------------------------------------------------------
// Chat view
// ---------------------------------------------------------------------------

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool' | 'error' | 'system';
  text: string;
  meta?: { action?: string; ok?: boolean; payload?: any; detail?: string };
}

function buildPrompt(text: string): string {
  const doc = vscode.window.activeTextEditor?.document;
  const lines: string[] = [];

  if (doc && /\.kicad_(pcb|sch)$/i.test(doc.fileName)) {
    lines.push(`当前打开的文件（通过 KiCad API 访问）：${doc.fileName}`);
  }

  lines.push(`工作区：${workspaceRoot()}`);

  if (lines.length > 0) {
    return `${lines.join('\n')}\n\n${text}`;
  }

  return text;
}

async function ensureApiServer(): Promise<string | undefined> {
  const configured = config().get<string>('socket');

  if (configured) {
    return configured;
  }

  if (process.env.KICAD_API_SOCKET) {
    return process.env.KICAD_API_SOCKET;
  }

  const doc = vscode.window.activeTextEditor?.document;

  if (!doc || !/\.kicad_(pcb|sch)$/i.test(doc.fileName)) {
    return undefined;
  }

  try {
    await startApiServer();
  } catch (error) {
    output.appendLine(`[chat] API server: ${error}`);
    return undefined;
  }

  return config().get<string>('socket');
}

class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'kicadAgent.chat';

  private view?: vscode.WebviewView;
  private child?: ChildProcess;
  private history: ChatMessage[];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.history = context.workspaceState.get<ChatMessage[]>('kicadAgent.chatHistory', []);
  }

  dispose(): void {
    this.stop();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = chatHtml(view.webview);
    view.webview.onDidReceiveMessage(message => {
      void this.onMessage(message);
    });
    view.onDidDispose(() => {
      this.view = undefined;
      this.stop();
    });
    this.post({ type: 'history', messages: this.history });
  }

  private post(message: any): void {
    void this.view?.webview.postMessage(message);
  }

  private async onMessage(message: any): Promise<void> {
    switch (message?.type) {
      case 'ready':
        this.post({ type: 'history', messages: this.history });
        break;

      case 'send':
        await this.send(String(message.text ?? ''));
        break;

      case 'stop':
        this.stop();
        break;

      case 'clear':
        this.history = [];
        this.persist();
        this.post({ type: 'clear' });
        break;
    }
  }

  private persist(): void {
    const recent = this.history.slice(-100);
    void this.context.workspaceState.update('kicadAgent.chatHistory', recent);
  }

  private append(message: ChatMessage): void {
    this.history.push(message);
    this.persist();
  }

  private explain(text: string): void {
    if (/settings|provider|environment variable|apiKeyEnv/i.test(text)) {
      this.post({
        type: 'system',
        text: '缺少模型配置：在命令面板运行 “KiCad Agent: Configure Model” 创建 settings.json。'
      });
    }
  }

  private stop(): void {
    if (this.child) {
      this.child.kill();
      this.child = undefined;
      this.post({ type: 'busy', busy: false });
      this.post({ type: 'status', text: '已停止' });
    }
  }

  private async send(text: string): Promise<void> {
    const trimmed = text.trim();

    if (!trimmed || this.child) {
      return;
    }

    this.append({ role: 'user', text: trimmed });
    this.post({ type: 'user', text: trimmed });
    this.post({ type: 'busy', busy: true });
    this.post({ type: 'status', text: '正在连接 KiCad…' });

    const socket = await ensureApiServer();

    if (socket) {
      this.post({ type: 'status', text: '已连接 KiCad API' });
    } else {
      this.post({ type: 'status', text: '未连接 KiCad API（仅可执行离线操作）' });
    }

    const args = [
      'ai', '--stream',
      '--prompt', buildPrompt(trimmed),
      '--max-steps', String(config().get<number>('maxSteps') || 20)
    ];

    const settings = config().get<string>('settings');
    if (settings) {
      args.push('--settings', settings);
    }

    const provider = config().get<string>('llmProvider');
    if (provider) {
      args.push('--provider', provider);
    }

    const model = config().get<string>('llmModel');
    if (model) {
      args.push('--model', model);
    }

    const env = environment();
    if (socket) {
      env.KICAD_API_SOCKET = socket;
    }

    output.appendLine(`[chat] ${agentPath()} ${args.join(' ')}`);

    const child = spawn(agentPath(), args, { cwd: workspaceRoot(), env });
    this.child = child;

    let sawFinal = false;
    let sawError = false;
    let stderrTail = '';

    const rl = readline.createInterface({ input: child.stdout! });

    rl.on('line', line => {
      const event = safeJson(line);

      if (!event) {
        return;
      }

      switch (event.event) {
        case 'start':
          this.post({ type: 'status', text: '模型已开始推理' });
          break;

        case 'action':
          this.post({ type: 'action', action: event.action, payload: event.payload });
          break;

        case 'step': {
          const step = event.step ?? {};

          if (step.final) {
            sawFinal = true;
            this.append({ role: 'assistant', text: String(step.final) });
            this.post({ type: 'assistant', text: String(step.final) });
          } else {
            const tool: ChatMessage = {
              role: 'tool',
              text: String(step.action ?? '动作'),
              meta: {
                action: step.action,
                ok: !step.error,
                detail: step.error ? String(step.error) : JSON.stringify(step.result ?? {}, null, 2)
              }
            };
            this.append(tool);
            this.post({ type: 'tool', message: tool });
          }
          break;
        }

        case 'final':
          sawFinal = true;
          this.post({ type: 'status', text: event.ok ? '完成' : '结束（有错误）' });
          if (!event.ok && event.error) {
            sawError = true;
            this.append({ role: 'error', text: String(event.error) });
            this.post({ type: 'error', text: String(event.error) });
          }
          break;

        case 'error': {
          sawError = true;
          const text = String(event.error ?? '未知错误');
          this.append({ role: 'error', text });
          this.post({ type: 'error', text });
          this.explain(text);
          break;
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      output.append(text);
    });

    child.on('error', error => {
      this.child = undefined;
      this.post({ type: 'busy', busy: false });
      this.append({ role: 'error', text: error.message });
      this.post({ type: 'error', text: error.message });
    });

    child.on('exit', code => {
      this.child = undefined;
      this.post({ type: 'busy', busy: false });

      if (!sawFinal && !sawError) {
        const text = stderrTail.trim() || `kicad-agent 退出码 ${code}`;
        this.append({ role: 'error', text });
        this.post({ type: 'error', text });
        this.explain(text);
      }

      this.post({ type: 'status', text: '准备就绪' });
    });
  }
}

function safeJson(text: string): any | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function chatHtml(webview: vscode.Webview): string {
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; }
  body {
    margin: 0; display: flex; flex-direction: column;
    font-family: var(--vscode-font-family); font-size: var(--vscode-font-size);
    color: var(--vscode-foreground); background: var(--vscode-sideBar-background);
  }
  header {
    display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    border-bottom: 1px solid var(--vscode-panel-border);
    font-size: 12px; color: var(--vscode-descriptionForeground);
  }
  header .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-charts-green, #3fb950); }
  header .dot.busy { background: var(--vscode-charts-yellow, #d29922); animation: pulse 1s infinite alternate; }
  @keyframes pulse { from { opacity: .35 } to { opacity: 1 } }
  header .spacer { flex: 1; }
  header button {
    background: none; color: var(--vscode-textLink-foreground); border: none;
    cursor: pointer; font-size: 12px; padding: 2px 4px;
  }
  #messages { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; }
  .msg { max-width: 92%; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  .msg.user {
    align-self: flex-end; padding: 8px 10px; border-radius: 10px 10px 2px 10px;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  .msg.assistant {
    align-self: flex-start; padding: 8px 10px; border-radius: 10px 10px 10px 2px;
    background: var(--vscode-editorWidget-background, rgba(127,127,127,.12));
  }
  .msg.error { align-self: flex-start; color: var(--vscode-errorForeground); font-size: 12px; }
  .msg.system { align-self: center; color: var(--vscode-descriptionForeground); font-size: 11px; }
  .tool { align-self: flex-start; width: 92%; font-size: 12px; }
  .tool summary {
    cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px;
    color: var(--vscode-descriptionForeground);
  }
  .tool summary::-webkit-details-marker { display: none; }
  .tool .icon { font-weight: 600; }
  .tool .ok { color: var(--vscode-charts-green, #3fb950); }
  .tool .fail { color: var(--vscode-errorForeground); }
  .tool pre {
    margin: 6px 0 0; padding: 8px; overflow-x: auto; font-size: 11px;
    background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.1));
    border-radius: 6px; white-space: pre-wrap; max-height: 240px; overflow-y: auto;
  }
  .empty { align-self: center; margin-top: 24px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.8; }
  footer {
    display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--vscode-panel-border);
    align-items: flex-end;
  }
  #input {
    flex: 1; resize: none; min-height: 34px; max-height: 160px;
    padding: 8px 10px; border-radius: 8px; line-height: 1.4;
    color: var(--vscode-input-foreground); background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent); outline: none;
    font-family: inherit; font-size: inherit;
  }
  #input:focus { border-color: var(--vscode-focusBorder); }
  #send, #stop {
    padding: 8px 14px; border: none; border-radius: 8px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    font-size: 12px;
  }
  #send:disabled { opacity: .5; cursor: default; }
  #stop { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
<header>
  <span class="dot" id="dot"></span>
  <span id="status">准备就绪</span>
  <span class="spacer"></span>
  <button id="clear" title="清空对话">清空</button>
</header>
<main id="messages"></main>
<footer>
  <textarea id="input" rows="1" placeholder="描述你要设计、修改或检查的内容…"></textarea>
  <button id="send" title="发送 (Enter)">发送</button>
  <button id="stop" hidden title="停止">停止</button>
</footer>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const messages = document.getElementById('messages');
  const input = document.getElementById('input');
  const send = document.getElementById('send');
  const stop = document.getElementById('stop');
  const dot = document.getElementById('dot');
  const status = document.getElementById('status');

  function esc(text) {
    return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function scroll() { messages.scrollTop = messages.scrollHeight; }

  function emptyState() {
    if (messages.children.length === 0) {
      const div = document.createElement('div');
      div.className = 'empty';
      div.id = 'empty';
      div.innerHTML = '直接描述你要做什么。<br/>例如：检查当前板子的 DRC 并修复明显问题。';
      messages.appendChild(div);
    }
  }

  function clearEmpty() {
    document.getElementById('empty')?.remove();
  }

  function addUser(text) {
    clearEmpty();
    const div = document.createElement('div');
    div.className = 'msg user';
    div.textContent = text;
    messages.appendChild(div);
    scroll();
  }

  function addAssistant(text) {
    clearEmpty();
    const div = document.createElement('div');
    div.className = 'msg assistant';
    div.textContent = text;
    messages.appendChild(div);
    scroll();
  }

  function addError(text) {
    clearEmpty();
    const div = document.createElement('div');
    div.className = 'msg error';
    div.textContent = text;
    messages.appendChild(div);
    scroll();
  }

  function addTool(action, ok, detail) {
    clearEmpty();
    const el = document.createElement('details');
    el.className = 'tool';
    const summary = document.createElement('summary');
    const icon = document.createElement('span');
    icon.className = 'icon ' + (ok ? 'ok' : 'fail');
    icon.textContent = ok ? '✓' : '✗';
    const name = document.createElement('span');
    name.textContent = action || '动作';
    summary.append(icon, name);
    el.appendChild(summary);
    if (detail) {
      const pre = document.createElement('pre');
      pre.textContent = detail;
      el.appendChild(pre);
    }
    messages.appendChild(el);
    scroll();
  }

  function addSystem(text) {
    const div = document.createElement('div');
    div.className = 'msg system';
    div.textContent = text;
    messages.appendChild(div);
    scroll();
  }

  function renderHistory(history) {
    messages.innerHTML = '';
    for (const m of history || []) {
      if (m.role === 'user') addUser(m.text);
      else if (m.role === 'assistant') addAssistant(m.text);
      else if (m.role === 'error') addError(m.text);
      else if (m.role === 'tool') addTool(m.meta?.action || m.text, m.meta?.ok !== false, m.meta?.detail);
    }
    emptyState();
  }

  window.addEventListener('message', event => {
    const msg = event.data || {};
    switch (msg.type) {
      case 'history': renderHistory(msg.messages); break;
      case 'user': addUser(msg.text); break;
      case 'assistant': addAssistant(msg.text); break;
      case 'error': addError(msg.text); break;
      case 'tool': addTool(msg.message?.meta?.action || msg.message?.text, msg.message?.meta?.ok !== false, msg.message?.meta?.detail); break;
      case 'action': break;
      case 'busy':
        dot.classList.toggle('busy', !!msg.busy);
        send.disabled = !!msg.busy;
        stop.hidden = !msg.busy;
        break;
      case 'system': addSystem(msg.text); break;
      case 'status': status.textContent = msg.text; break;
      case 'clear': messages.innerHTML = ''; emptyState(); break;
    }
  });

  function submit() {
    const text = input.value.trim();
    if (!text || send.disabled) return;
    input.value = '';
    input.style.height = 'auto';
    vscode.postMessage({ type: 'send', text });
  }

  send.addEventListener('click', submit);
  stop.addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
  document.getElementById('clear').addEventListener('click', () => vscode.postMessage({ type: 'clear' }));

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });

  emptyState();
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
