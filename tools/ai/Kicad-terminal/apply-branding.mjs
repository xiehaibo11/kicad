// Presentation-only overlay. Protocol IDs, providers, config paths, auth,
// permissions, agents, plugins, sessions and model execution stay upstream.
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
if (!root) throw new Error('usage: node apply-branding.mjs <opencode-source-directory>');
const marker = path.join(root, 'kicad-branding.json');
const changes = fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker,'utf8')).changes : [];
function patch(file, before, after) {
  const target = path.join(root, file);
  const source = fs.readFileSync(target, 'utf8');
  if (!source.includes(before)) throw new Error(`Missing branding anchor in ${file}: ${before}`);
  fs.writeFileSync(target, source.replaceAll(before, after));
  if (!changes.includes(file)) changes.push(file);
}

if (!fs.existsSync(marker)) {
patch('packages/tui/src/logo.ts',
  '  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],\n  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],',
  '  left: ["█     ▄ ", "█ ▄▀  ▄ ", "██    █ ", "█ ▀▄  █ "],\n  right: ["             █", "█▀▀▀ ▀▀▀█ █▀▀█", "█___ █▀▀█ █__█", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],');
patch('packages/tui/src/util/presentation.ts',
  'const logo = {\n  left: ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"],\n  right: ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"],\n}',
  'import { logo } from "../logo"');
patch('packages/opencode/src/cli/ui.ts',
  'const wordmark = [\n  `⠀                                ▄     `,\n  `█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█`,\n  `█  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀`,\n  `▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`,\n]',
  'const wordmark = glyphs.left.map((row, index) =>\n  (row + " " + glyphs.right[index]).replaceAll("_", " ").replaceAll("^", "▀").replaceAll("~", "▀"),\n)');
patch('packages/opencode/src/index.ts', '.scriptName("opencode")', '.scriptName("kicad-terminal")');
patch('packages/opencode/src/index.ts', 'text.startsWith("opencode ")', 'text.startsWith("kicad-terminal ")');
patch('packages/opencode/src/cli/cmd/tui.ts', 'describe: "start opencode tui"', 'describe: "start kicad terminal"');
patch('packages/opencode/src/cli/cmd/tui.ts', 'describe: "path to start opencode in"', 'describe: "path to start kicad in"');
for (const [file, before, after] of [
  ['attach.ts', 'attach to a running opencode server', 'attach to a running kicad server'],
  ['run.ts', 'run opencode with a message', 'run kicad with a message'],
  ['run.ts', 'attach to a running opencode server', 'attach to a running kicad server'],
  ['upgrade.ts', 'upgrade opencode to the latest or a specific version', 'upgrade the kicad runtime to the latest or a specific version'],
  ['uninstall.ts', 'uninstall opencode and remove all related files', 'uninstall the kicad runtime and remove all related files'],
  ['serve.ts', 'starts a headless opencode server', 'starts a headless kicad server'],
  ['web.ts', 'start opencode server and open web interface', 'start kicad server and open web interface'],
  ['pr.ts', 'then run opencode', 'then run kicad'],
  ['pr.ts', 'Starting opencode...', 'Starting kicad...'],
]) patch('packages/opencode/src/cli/cmd/' + file, before, after);

patch('packages/tui/src/app.tsx', 'renderer.setTerminalTitle("OpenCode")', 'renderer.setTerminalTitle("kicad")');
patch('packages/tui/src/app.tsx', 'renderer.setTerminalTitle(`OC | ', 'renderer.setTerminalTitle(`kicad | ');
patch('packages/tui/src/attention.ts', 'const DEFAULT_TITLE = "opencode"', 'const DEFAULT_TITLE = "kicad"');
patch('packages/tui/src/attention.ts', 'name: "OpenCode Default"', 'name: "kicad Default"');

for (const file of [
  'packages/tui/src/routes/session/sidebar.tsx',
  'packages/tui/src/feature-plugins/sidebar/footer.tsx',
]) {
  patch(file, '<b>Open</b>', '<b>ki</b>');
  patch(file, '<b>Code</b>', '<b>cad</b>');
}
patch('packages/tui/src/feature-plugins/home/footer.tsx',
  '<text fg={theme().textMuted}>{props.api.app.version}</text>',
  '<text fg={theme().textMuted}>kicad {props.api.app.version}</text>');
patch('packages/tui/src/feature-plugins/sidebar/footer.tsx',
  'OpenCode includes free models so you can start immediately.',
  'kicad includes free models so you can start immediately.');
patch('packages/tui/src/routes/session/permission.tsx', 'until OpenCode is restarted', 'until kicad is restarted');
patch('packages/tui/src/routes/session/permission.tsx', 'Tell OpenCode what to do differently', 'Tell kicad what to do differently');
patch('packages/tui/src/component/error-component.tsx', 'opencode crashed', 'kicad crashed');
patch('packages/tui/src/component/error-component.tsx', '>opencode {InstallationVersion}', '>kicad {InstallationVersion}');
patch('packages/tui/src/app.tsx', 'title: "Update OpenCode"', 'title: "Update kicad"');
patch('packages/tui/src/component/dialog-update.tsx', '"Updating OpenCode"', '"Updating kicad"');
patch('packages/tui/src/component/dialog-update.tsx', "restart OpenCode.", "restart kicad.");
patch('packages/tui/src/component/dialog-update.tsx', '`Installing OpenCode ${installing.target.version}…`', '`Installing kicad runtime ${installing.target.version}…`');
patch('packages/tui/src/routes/home.tsx', ' to upgrade to OpenCode 2.0', ' to upgrade the runtime to 2.0');
patch('packages/tui/src/routes/home.tsx', ' restart to use OpenCode 2.0', ' restart to use runtime 2.0');
patch('packages/tui/src/component/dialog-update.tsx', 'Installing OpenCode 2.0…', 'Installing upstream runtime 2.0…');
patch('packages/tui/src/component/dialog-update.tsx', 'to start OpenCode 2.0.', 'to start upstream runtime 2.0.');
patch('packages/tui/src/component/dialog-update.tsx', 'OpenCode 2.0 is the next major release.', 'Runtime 2.0 is the next major release.');
patch('packages/tui/src/context/update-notification.tsx', 'To install OpenCode 2.0 manually', 'To install upstream runtime 2.0 manually');
patch('packages/tui/src/util/error.ts', 'opencode does not support MCP authentication yet.', 'kicad does not support MCP authentication yet.');
patch('packages/tui/src/feature-plugins/home/tips-view.tsx', 'prevent OpenCode from reading sensitive files', 'prevent kicad from reading sensitive files');

for (const [file, before, after] of [
  ['packages/tui/src/util/error.ts', '`opencode models`', '`kicad-terminal models`'],
  ['packages/tui/src/util/error.ts', 'opencode auth login', 'kicad-terminal auth login'],
  ['packages/tui/src/util/presentation.ts', '${bold}opencode -s ', '${bold}kicad-terminal -s '],
  ['packages/tui/src/component/dialog-status.tsx', 'run: opencode mcp auth', 'run: kicad-terminal mcp auth'],
  ['packages/tui/src/feature-plugins/home/tips-view.tsx', '{highlight}opencode ', '{highlight}kicad-terminal '],
  ['packages/tui/src/feature-plugins/home/tips-view.tsx', 'headless API access to OpenCode', 'headless API access to kicad'],
]) patch(file, before, after);

// Existing behavioral tests keep the same assertions with the branded command.
patch('packages/tui/test/app-lifecycle.test.tsx', 'opencode -s dummy', 'kicad-terminal -s dummy');
patch('packages/tui/test/app-lifecycle.test.tsx', 'opencode auth login', 'kicad-terminal auth login');
patch('packages/tui/test/util/presentation.test.ts', 'opencode -s ses_123', 'kicad-terminal -s ses_123');

// OpenCode Zen/Go are real external services, not the application's brand.
// Keep their labels/URLs and all upstream update machinery and config keys.
}
// Presentation strings only: preserve upstream package, protocol and configuration IDs.
for (const file of changes) {
  const target=path.join(root,file);
  let source=fs.readFileSync(target,'utf8');
  source=source.replace(/(?<![a-zA-Z_.-])kicad(?= |["`])/g,'Kicad');
  source=source.replace('<b>ki</b>','<b>Ki</b>');
  // The public command is Kicad; retain internal filenames/configuration IDs.
  // Runs for both a fresh upstream checkout and an already branded checkout.
  source=source.replaceAll('kicad-terminal ', 'Kicad ')
    .replaceAll('.scriptName("kicad-terminal")', '.scriptName("Kicad")');
  source=source.replace('renderer.setTerminalTitle("Kicad")','renderer.setTerminalTitle("Kicad 终端")');
  fs.writeFileSync(target,source);
}
const logoFile=path.join(root,'packages/tui/src/logo.ts');
let logo=fs.readFileSync(logoFile,'utf8');
logo=logo.replace('left: ["█     ▄ ", "█ ▄▀  ▄ ", "██    █ ", "█ ▀▄  █ "]','left: ["█  ▄▀ ▄ ", "█▄▀   ▄ ", "█▀▄   █ ", "█  ▀▄ █ "]');
fs.writeFileSync(logoFile,logo);
fs.writeFileSync(marker, JSON.stringify({name:'Kicad 终端',command:'Kicad',revision:3,changes},null,2)+'\n');
console.log(`Applied Kicad presentation branding to ${changes.length} source files.`);
