// Test hosts must never consult the real macOS keychain or reuse installed extensions.
// Launch Electron itself so cleanup owns the app, rather than a detached CLI client.
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const EDITOR = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';

function launchOptions(args, options = {}) {
  const profile = args[args.indexOf('--user-data-dir') + 1];
  if (!args.includes('--user-data-dir') || !path.isAbsolute(profile)) {
    throw new Error('An absolute isolated --user-data-dir is required');
  }
  const home = path.join(profile, 'home');
  const extensions = path.join(profile, 'extensions');
  fs.mkdirSync(home, {recursive: true});
  fs.mkdirSync(extensions, {recursive: true});
  const env = Object.fromEntries(Object.entries(options.env || process.env).filter(([key]) =>
    !/^(ANTHROPIC_|OPENAI_|DEEPSEEK_|VSCODE_|ELECTRON_|OPENCODE_|XDG_|NODE_OPTIONS$)/.test(key)));
  Object.assign(env, {
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(profile, 'claude'),
    OPENCODE_DISABLE_MODELS_FETCH: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1'
  });
  return {args: [
    ...args.filter(arg => arg !== '--wait'),
    '--extensions-dir', extensions,
    '--use-inmemory-secretstorage', '--skip-release-notes'
  ], options: {...options, env, detached: true}};
}

function spawn(_cli, args, options) {
  const launch = launchOptions(args, options);
  const child = childProcess.spawn(EDITOR, launch.args, launch.options);
  const killRoot = child.kill.bind(child);
  child.kill = (signal = 'SIGTERM') => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return false;
    try {process.kill(-child.pid, signal); return true;}
    catch (error) {
      if (error.code === 'EPERM') return killRoot(signal);
      if (error.code !== 'ESRCH') throw error;
      return false;
    }
  };
  const cleanup = () => child.kill();
  process.once('exit', cleanup);
  child.once('exit', () => process.removeListener('exit', cleanup));
  return child;
}

module.exports = {spawn, launchOptions};
