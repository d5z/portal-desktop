const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, fork } = require('node:child_process');
const { once } = require('node:events');

async function main() {
  const resources = process.argv[2];
  const archive = path.join(resources, 'app.asar');
  const assets = path.join(archive, '.vite/renderer/main_window');
  const manifest = JSON.parse(fs.readFileSync(path.join(archive, 'package.json'), 'utf8'));
  const npm = path.join(resources, 'npm/bin/npm-cli.js');
  assert.equal(execFileSync(process.execPath, [npm, '--version'], { encoding: 'utf8' }).trim(), manifest.dependencies.npm);
  const stage = path.join(process.cwd(), 'offline install');
  fs.mkdirSync(path.join(stage, 'dependency'), { recursive: true });
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'runtime-fixture', private: true, dependencies: { 'runtime-child': 'file:./dependency' } }));
  fs.writeFileSync(path.join(stage, 'dependency/package.json'), JSON.stringify({ name: 'runtime-child', version: '1.0.0', scripts: { install: 'node check.cjs' } }));
  fs.writeFileSync(path.join(stage, 'dependency/check.cjs'), `require('node:fs').writeFileSync('runtime.json', JSON.stringify({ executable: process.execPath, node: process.versions.node }));`);
  const env = { ...process.env, PATH: path.join(resources, 'node-bin') + path.delimiter + process.env.PATH,
    PORTAL_DESKTOP_NODE_EXECUTABLE: process.execPath, ELECTRON_RUN_AS_NODE: '1',
    npm_config_cache: path.join(stage, 'cache'), npm_config_update_notifier: 'false' };
  execFileSync(process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--install-links'], { cwd: stage, env, stdio: 'pipe' });
  const result = path.join(stage, 'node_modules/runtime-child/runtime.json');
  assert.equal(fs.existsSync(result), false);
  execFileSync(process.execPath, [npm, 'rebuild', '--offline', '--foreground-scripts'], { cwd: stage, env, stdio: 'pipe' });
  assert.deepEqual(JSON.parse(fs.readFileSync(result, 'utf8')), { executable: process.execPath, node: process.versions.node });

  // Exercise the actual ASAR worker, with no project packages on its search path.
  const child = fork(path.join(assets, 'dsh-plugin-host.cjs'), [], { env: { ...process.env, DSH_HOME: path.join(stage, 'data'), TOWN_DSH_TOKEN: 'fixture' }, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stderr.pipe(process.stderr);
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    const ready = new Promise((resolve, reject) => {
      child.on('message', message => { if (message.type === 'ready') resolve(message); if (message.type === 'error') reject(new Error(message.error)); });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('Packaged plugin host exited before ready')));
    });
    child.send({ entries: [], services: {} });
    const message = await ready;
    assert(message.port > 0);
    assert.deepEqual(message.state.plugins, []);
    child.send({ type: 'shutdown' });
    assert.deepEqual(await exited, [0, null]);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited; }
  }
  console.log(`PASS relocated package: npm ${manifest.dependencies.npm}, offline install/rebuild without system Node, Electron Node ${process.versions.node}, ASAR plugin host.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
