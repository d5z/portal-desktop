// Backport libuv#5181 until the pinned Node release supports AppContainer pipes.
// Build-time only; no host permission changes or runtime injection.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { x as extract } from 'tar';
import lock from './lock.json' with { type: 'json' };

export async function buildWindowsNode(cache, pythonDirectory) {
  const patchFile = fileURLToPath(new URL('./libuv-appcontainer.patch', import.meta.url));
  const patch = await readFile(patchFile);
  const recipe = await readFile(fileURLToPath(new URL('./build-windows-node.mjs', import.meta.url)));
  const buildId = createHash('sha256').update(JSON.stringify(lock.windowsNodeBuild)).update(patch).update(recipe).digest('hex');
  const directory = path.join(path.dirname(cache), `node-${lock.nodeVersion}-${buildId.slice(0,12)}`);
  const binary = path.join(directory, 'node.exe');
  const digestFile = path.join(directory, 'node.sha256');
  const digest = await readFile(digestFile,'utf8').catch(error => {if(error.code==='ENOENT')return null;throw error;});
  if (digest && createHash('sha256').update(await readFile(binary)).digest('hex') === digest) return binary;
  await mkdir(directory,{recursive:true});
  const sourceName = `node-v${lock.nodeVersion}.tar.gz`;
  const nasmName = `nasm-${lock.windowsNodeBuild.nasmVersion}-win64.zip`;
  for (const [name, url, sha] of [
    [sourceName, `https://nodejs.org/dist/v${lock.nodeVersion}/${sourceName}`, lock.windowsNodeBuild.sourceSha256],
    [nasmName, `https://www.nasm.us/pub/nasm/releasebuilds/${lock.windowsNodeBuild.nasmVersion}/win64/${nasmName}`, lock.windowsNodeBuild.nasmSha256],
  ]) {
    const archive = path.join(cache,name);
    let bytes = await readFile(archive).catch(error => {if(error.code==='ENOENT')return null;throw error;});
    if (!bytes) {
      const response = await fetch(url,{signal:AbortSignal.timeout(300000)});
      if (!response.ok) throw new Error(`Node build download failed: ${response.status} ${url}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error(`Node build checksum mismatch: ${name}`);
    await writeFile(archive,bytes);
  }
  // Windows tar.exe rejects UTF-8 names in Node's test fixtures on some locales.
  await extract({file:path.join(cache,sourceName),cwd:directory});
  execFileSync('tar.exe',['-xf',path.join(cache,nasmName),'-C',directory],{stdio:'inherit'});
  const source = path.join(directory,`node-v${lock.nodeVersion}`);
  // Do not let git discover the enclosing client checkout and silently skip
  // paths outside that checkout's current prefix.
  execFileSync('git',['apply',patchFile],{cwd:source,stdio:'inherit',env:{...process.env,GIT_CEILING_DIRECTORIES:directory}});
  const temporary = path.join(directory,'tmp'); await mkdir(temporary,{recursive:true});
  const buildScript = path.join(source,'portal-build.cmd');
  // Keep Release + ThinLTO, but do not pass vcbuild's `release` shorthand:
  // that shorthand also enables cctest and its later target override.
  await writeFile(buildScript,'@echo off\r\ncall vcbuild.bat ltcg x64 clang-cl no-cctest nonpm nocorepack\r\nexit /b %errorlevel%\r\n');
  execFileSync(process.env.ComSpec || 'cmd.exe',['/d','/c','portal-build.cmd'],{
    cwd:source,stdio:'inherit',windowsHide:true,
    env:{...process.env,TEMP:temporary,TMP:temporary,
      PATH:[pythonDirectory,path.join(directory,`nasm-${lock.windowsNodeBuild.nasmVersion}`),process.env.PATH].join(path.delimiter),
    },
  });
  await cp(path.join(source,'Release/node.exe'),binary);
  await writeFile(digestFile,createHash('sha256').update(await readFile(binary)).digest('hex'));
  return binary;
}
