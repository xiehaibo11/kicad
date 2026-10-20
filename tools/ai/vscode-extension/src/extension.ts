import * as vscode from 'vscode';
import { execFile, spawn, ChildProcess } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

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

  const tree = new ActionTreeProvider();

  context.subscriptions.push(
    output,
    diagnostics,
    statusBar,
    vscode.window.registerTreeDataProvider('kicadAgent.actions', tree),
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
    vscode.commands.registerCommand('kicadAgent.aiPrompt', guard(runAiPrompt)),
    vscode.commands.registerCommand('kicadAgent.showMcpConfig', guard(showMcpConfig)),
    vscode.commands.registerCommand('kicadAgent.startServer', guard(startApiServer)),
    vscode.commands.registerCommand('kicadAgent.stopServer', guard(stopApiServer)),
    vscode.commands.registerCommand('kicadAgent.refreshActions', () => tree.refresh())
  );

  // Populate the action tree on activation.
  tree.refresh();
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

function agentPath(): string {
  return config().get<string>('path') || 'kicad-agent';
}

function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const kicadCli = config().get<string>('kicadCli');

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

  const cli = config().get<string>('kicadCli') || 'kicad-cli';
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

async function runAiPrompt(): Promise<void> {
  const prompt = await vscode.window.showInputBox({
    prompt: 'Ask the configured model to design or verify something',
    placeHolder: 'e.g. Generate the schematic and report ERC'
  });

  if (!prompt) {
    return;
  }

  const args = ['ai', '--prompt', prompt];
  const settings = config().get<string>('settings');

  if (settings) {
    args.push('--settings', settings);
  }

  const result = await runCli(args, workspaceRoot());
  showResult(result);
  output.appendLine(JSON.stringify(result, null, 2));
  output.show(true);
}

async function showMcpConfig(): Promise<void> {
  const snippet = {
    mcpServers: {
      kicad: {
        command: agentPath(),
        args: ['mcp'],
        env: {
          KICAD_CLI: config().get<string>('kicadCli') || 'kicad-cli',
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
// Action tree
// ---------------------------------------------------------------------------

type ActionNode = DomainNode | LeafNode;

interface DomainNode {
  kind: 'domain';
  domain: string;
}

interface LeafNode {
  kind: 'action';
  action: ActionSpec;
}

class ActionTreeProvider implements vscode.TreeDataProvider<ActionNode> {
  private readonly emitter = new vscode.EventEmitter<ActionNode | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private actions: ActionSpec[] | undefined;

  refresh(): void {
    this.actions = undefined;
    this.emitter.fire();
  }

  async getChildren(element?: ActionNode): Promise<ActionNode[]> {
    const actions = await this.load();

    if (!element) {
      const domains = Array.from(new Set(actions.map(action => action.domain))).sort();
      return domains.map(domain => ({ kind: 'domain', domain } as DomainNode));
    }

    if (element.kind === 'domain') {
      return actions
        .filter(action => action.domain === element.domain)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(action => ({ kind: 'action', action } as LeafNode));
    }

    return [];
  }

  getTreeItem(element: ActionNode): vscode.TreeItem {
    if (element.kind === 'domain') {
      const item = new vscode.TreeItem(
        DOMAIN_LABELS[element.domain] ?? element.domain,
        vscode.TreeItemCollapsibleState.Collapsed
      );
      item.contextValue = 'kicadAgent.domain';
      return item;
    }

    const item = new vscode.TreeItem(element.action.name, vscode.TreeItemCollapsibleState.None);
    item.description = element.action.mutates ? 'mutates' : '';
    item.tooltip = element.action.description;
    item.contextValue = 'kicadAgent.action';
    item.command = {
      command: 'kicadAgent.runAction',
      title: 'Run action',
      arguments: [element.action.name]
    };
    return item;
  }

  private async load(): Promise<ActionSpec[]> {
    if (this.actions) {
      return this.actions;
    }

    try {
      const result = await runCli(['actions']);
      this.actions = (result.data?.actions ?? []) as ActionSpec[];
    } catch (error) {
      output.appendLine(`Failed to load actions: ${error}`);
      this.actions = [];
    }

    return this.actions;
  }
}
