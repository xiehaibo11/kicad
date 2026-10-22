// SPDX-License-Identifier: GPL-3.0-or-later
// Start the native GUI itself. No relay, daemon or headless replacement editor.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { executable, DirectError } from './utils.mjs';

export async function startNativeGUI(binary, socket) {
  let cli = executable(binary);
  let buildEnvironment = false;
  if (cli) {
    const header = fs.readFileSync(cli).subarray(0, 4096).toString();
    if (header.startsWith('#!')) {
      // Installer wrappers contain a literal native path. Never evaluate shell text
      // or mistake the adjacent `kicad` AI-terminal launcher for the GUI.
      const target = header.match(/exec "(\/[^"\n]+\/kicad-cli)" "\$@"/);
      buildEnvironment = header.includes('export KICAD_RUN_FROM_BUILD_DIR=1');
      cli = target ? executable(target[1]) : undefined;
    }
  }
  const gui = executable(process.env.KICAD_GUI) ?? (cli && executable(path.join(path.dirname(fs.realpathSync(cli)), process.platform === 'win32' ? 'kicad.exe' : 'kicad')));
  if (!gui) throw new DirectError('GUI_NOT_FOUND', 'Native KiCad GUI was not found beside kicad-cli. Set KICAD_GUI to the native executable.');
  const directory = path.dirname(socket), lock = path.join(directory, 'gui-autostart.lock');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  // A short cross-process lease coalesces simultaneous terminal/extension startup.
  try {
    const stamp = fs.statSync(lock);
    try {
      const pid = Number(fs.readFileSync(lock, 'utf8'));
      if (Number.isInteger(pid) && pid > 0) { process.kill(pid, 0); return; }
    } catch (error) { if (!['ESRCH', 'ENOENT'].includes(error.code)) throw error; }
    if (Date.now() - stamp.mtimeMs < 30000) return;
    fs.unlinkSync(lock);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  fs.closeSync(fd);
  const log = fs.openSync(path.join(directory, 'gui-autostart.log'), 'a', 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(gui, [], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, ...(buildEnvironment ? { KICAD_RUN_FROM_BUILD_DIR: '1' } : {}), KICAD_API_SOCKET: socket } });
      child.once('error', reject);
      child.once('spawn', () => { fs.writeFileSync(lock, String(child.pid), { mode: 0o600 }); child.unref(); resolve(); });
    });
  } catch (error) { fs.rmSync(lock, { force: true }); throw error; }
  finally { fs.closeSync(log); }
}
