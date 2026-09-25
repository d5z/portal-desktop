import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = path.join(root, '.dev-profile');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log(`Starting Portal Desktop Dev with isolated profile: ${profile}`);
const child = spawn(npm, ['start'], {
  cwd: root,
  env: { ...process.env, PORTAL_DESKTOP_USER_DATA: profile },
  stdio: 'inherit',
});
child.once('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
