import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, linkSync, symlinkSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

if (process.platform !== 'win32') { console.log('Windows AppContainer test: Windows required'); process.exit(0); }
const fixture = mkdtempSync(path.join(os.tmpdir(), 'portal-sandbox-test-'));
const root = path.join(fixture, 'workspace'); mkdirSync(root);
const privateFile = path.join(fixture, 'private.txt'); writeFileSync(privateFile, 'host-private');
mkdirSync(path.join(root, '.git')); writeFileSync(path.join(root, '.git', 'config'), 'protected');
const binary = path.resolve(process.env.PORTAL_SANDBOX_BINARY || 'heart-portal/target/debug/heart-portal.exe');
const server = net.createServer(socket => socket.destroy());
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.PORTAL_SANDBOX_TEST_SECRET = 'must-not-inherit';
function run(source, powershell = false, protected_paths = []) {
  const payload = Buffer.from(JSON.stringify({ root, cwd: root, source, powershell, protected_paths })).toString('base64');
  const result = spawnSync(binary, ['sandbox-run', payload], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.ifError(result.error);
  assert.doesNotMatch(result.stderr, /Sandbox ACL cleanup failed/, 'Temporary permissions must be cleaned up');
  return result;
}
function readAcls(paths) {
  const aclScript = `$env:PSModulePath="$PSHOME\\Modules"; $ErrorActionPreference='Stop'; @(${paths.map(value => "'" + value.replaceAll("'", "''") + "'").join(',')}) | ForEach-Object { (Get-Acl -LiteralPath $_).Sddl }`;
  const acls = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(aclScript, 'utf16le').toString('base64')], {encoding:'utf8', windowsHide:true});
  assert.equal(acls.status, 0, acls.stderr);
  return acls.stdout;
}
const originalAclPaths = [root, privateFile, path.join(root, '.git'), path.join(root, '.git', 'config')];
const originalAcls = readAcls(originalAclPaths);
try {
  const failedLaunch = run('#'.repeat(12400), true);
  assert.notEqual(failedLaunch.status, 0, 'Overlong encoded command must fail after ACL setup');
  assert.match(failedLaunch.stderr, /Create AppContainer process/);
  assert.equal(readAcls(originalAclPaths), originalAcls, 'Failed process creation must restore ACLs');
  let fresh = run('echo fresh>new.txt & type new.txt');
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /fresh/);
  fresh = run('mkdir fresh & mkdir fresh\\nested & echo nested>fresh\\nested\\file.txt & type fresh\\nested\\file.txt');
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /nested/);
  fresh = run("$ErrorActionPreference='Stop'; New-Item -ItemType Directory psfresh | Out-Null; Set-Content psfresh/file.txt 'created'; Get-Content psfresh/file.txt", true);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /created/);
  fresh = run('echo rename>temp.txt & ren temp.txt renamed.txt & type renamed.txt & mkdir newdir & ren newdir newname');
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /rename/);
  assert.equal(existsSync(path.join(root, 'newname')), true);
  fresh = run("$ErrorActionPreference='Stop'; [IO.File]::WriteAllText((Get-Location).ProviderPath + '\\delete-me.txt', 'x'); [IO.File]::Delete((Get-Location).ProviderPath + '\\delete-me.txt')", true);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(existsSync(path.join(root, 'delete-me.txt')), false);
  const configDirectory = path.join(root, 'config'); mkdirSync(configDirectory);
  const config = path.join(configDirectory, 'active.toml'); writeFileSync(config, 'original');
  fresh = run('echo replaced>config\\active.toml', false, [config]);
  assert.notEqual(fresh.status, 0, 'Active config must remain read-only');
  fresh = run('ren config oldconfig', false, [config]);
  assert.notEqual(fresh.status, 0, 'Protected ancestor must not be movable');
  assert.equal(readFileSync(config, 'utf8'), 'original');
  assert.equal(existsSync(path.join(root, 'oldconfig')), false);
  fresh = run('echo ran>should-not-run.txt', false, [path.join(configDirectory, 'missing.toml')]);
  assert.notEqual(fresh.status, 0, 'Missing protected paths must fail closed');
  assert.equal(existsSync(path.join(root, 'should-not-run.txt')), false);
  mkdirSync(path.join(root, 'ordinary')); writeFileSync(path.join(root, 'ordinary', 'original.txt'), 'original');
  fresh = run('ren ordinary renamed & type renamed\\original.txt & echo child>renamed\\child.txt');
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /original/);
  fresh = run("$ErrorActionPreference='Stop'; [IO.File]::Delete((Get-Location).ProviderPath + '\\renamed\\original.txt')", true);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(existsSync(path.join(root, 'renamed', 'original.txt')), false);
  let result = run('echo sandbox>allowed.txt');
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(path.join(root, 'allowed.txt'), 'utf8'), /sandbox/);
  result = run(`type "${privateFile}"`);
  assert.notEqual(result.status, 0, 'Private host file must be unreadable');
  result = run(`echo escaped>"${path.join(fixture, 'escaped.txt')}"`);
  assert.notEqual(result.status, 0, 'Outside-workspace writes must fail');
  assert.equal(existsSync(path.join(fixture, 'escaped.txt')), false);
  run('echo changed>.git\\config');
  assert.equal(readFileSync(path.join(root, '.git', 'config'), 'utf8'), 'protected');
  result = run("Set-Content -LiteralPath powershell.txt -Value ok -NoNewline", true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(path.join(root, 'powershell.txt'), 'utf8').replace(/^\uFEFF/, ''), 'ok');
  result = run("if ($env:PORTAL_SANDBOX_TEST_SECRET) { exit 17 }; Write-Output 'clean-env'", true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /clean-env/);
  result = run(`$client = $null; try { $client = New-Object Net.Sockets.TcpClient -ErrorAction Stop; $task = $client.ConnectAsync('127.0.0.1', ${server.address().port}); if ($task.Wait(3000) -and $client.Connected) { exit 18 }; Write-Output 'network-blocked' } catch { Write-Output 'network-blocked' } finally { if ($client) { $client.Dispose() } }`, true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /network-blocked/);
  const quote = text => "'" + text.replaceAll("'", "''") + "'";
  const started = path.join(root, 'child-started.txt'), late = path.join(root, 'child-escaped.txt');
  const childSource = `[IO.File]::WriteAllText(${quote(started)}, 'started'); [Threading.Thread]::Sleep(2500); [IO.File]::WriteAllText(${quote(late)}, 'escaped')`;
  const encodedChild = Buffer.from(childSource, 'utf16le').toString('base64');
  result = run(`$info = New-Object Diagnostics.ProcessStartInfo; $info.FileName = $PSHOME + '\\powershell.exe'; $info.Arguments = '-NoProfile -NonInteractive -EncodedCommand ${encodedChild}'; $info.UseShellExecute = $false; $child = [Diagnostics.Process]::Start($info); for ($i=0; $i -lt 40; $i++) { if ([IO.File]::Exists(${quote(started)})) { exit 0 }; [Threading.Thread]::Sleep(50) }; exit 19`, true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(started), true, 'Child must actually start before testing tree termination');
  await new Promise(resolve => setTimeout(resolve, 3000));
  assert.equal(existsSync(late), false, 'Descendants must not survive the command');
  linkSync(privateFile, path.join(root, 'hardlink.txt'));
  result = run('type hardlink.txt');
  assert.equal(readAcls(originalAclPaths), originalAcls, 'Hard-link rejection must not change target ACLs');
  assert.notEqual(result.status, 0, 'A workspace hard link must not grant access to the host file');
  rmSync(path.join(root, 'hardlink.txt'));
  symlinkSync(fixture, path.join(root, 'junction'), 'junction');
  result = run('type junction\\private.txt');
  assert.notEqual(result.status, 0, 'A junction must not grant access outside the workspace');
  // Check ACL restoration on existing objects and no invocation-specific SID
  // left on newly created descendants. Do not traverse the junction fixture.
  const aclPaths = [root, path.join(root, '.git'), path.join(root, '.git', 'config'),
    privateFile, path.join(root, 'fresh'), path.join(root, 'fresh', 'nested', 'file.txt'),
    path.join(root, 'renamed'), path.join(root, 'renamed', 'child.txt')];
  const acls = readAcls(aclPaths);
  assert.equal(readAcls(originalAclPaths), originalAcls, 'Existing ACLs and inheritance must be restored exactly');
  assert.doesNotMatch(acls, /S-1-15-2-\d/, 'No sandbox package grants may survive cleanup');
  console.log('Windows AppContainer: CMD/PowerShell workspace writes pass; private reads/writes, metadata writes, loopback network, hardlinks, junctions and secret environment inheritance blocked; descendants terminated.');
} finally { server.close(); delete process.env.PORTAL_SANDBOX_TEST_SECRET; rmSync(fixture, { recursive: true, force: true }); }
