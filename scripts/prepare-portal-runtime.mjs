// Build-time only: locked portable interpreters, no installs or downloads during a task.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import lock from './portal-runtime/lock.json' with { type: 'json' };

export async function preparePortalRuntime(destination = path.resolve('resources/portal-runtime')) {
  const target = lock.targets[`${{darwin:'mac',win32:'win',linux:'linux'}[process.platform]}-${process.arch}`];
  if (!target) throw new Error(`No Portal runtime for ${process.platform}/${process.arch}`);
  const windowsSite = process.platform === 'win32' ? await readFile(new URL('./portal-runtime/windows-sitecustomize.py', import.meta.url), 'utf8') : '';
  const windowsPipePatch = process.platform === 'win32' ? await readFile(new URL('./portal-runtime/libuv-appcontainer.patch', import.meta.url), 'utf8') : '';
  const windowsNodeRecipe = process.platform === 'win32' ? await readFile(new URL('./portal-runtime/build-windows-node.mjs', import.meta.url), 'utf8') : '';
  const id = createHash('sha256').update(JSON.stringify({layout:5,node:lock.nodeVersion,python:lock.pythonVersion,target,windowsSite,windowsPipePatch,windowsNodeRecipe,windowsNodeBuild:process.platform==='win32' ? lock.windowsNodeBuild : undefined})).digest('hex');
  const current = await readFile(path.join(destination,'runtime.json'),'utf8').catch(error => {if(error.code==='ENOENT')return null;throw error;});
  const manifest = current && JSON.parse(current);
  if (manifest && manifest.id === id) {
    await access(path.join(destination,manifest.python.path));
    await access(path.join(destination,manifest.node.path));
    return;
  }
  const cache = path.resolve('output/portal-runtime-downloads');
  await mkdir(cache,{recursive:true});
  const stage = await mkdtemp(path.join(cache,'stage-'));
  const payload = path.join(stage,'portal-runtime');
  await mkdir(payload);
  try {
    const nodeName = `node-v${lock.nodeVersion}-${target.nodeArchive}`;
    const pythonName = `cpython-${lock.pythonVersion}+${lock.pythonRelease}-${target.pythonTarget}-install_only_stripped.tar.gz`;
    for (const [url,sha,name] of [
      [`https://nodejs.org/dist/v${lock.nodeVersion}/${nodeName}`,target.nodeSha256,nodeName],
      [`https://github.com/astral-sh/python-build-standalone/releases/download/${lock.pythonRelease}/${encodeURIComponent(pythonName)}`,target.pythonSha256,pythonName],
    ]) {
      const archive = path.join(cache,name);
      let bytes = await readFile(archive).catch(error => {if(error.code==='ENOENT')return null;throw error;});
      if (!bytes) {
        const response = await fetch(url,{signal:AbortSignal.timeout(300000)});
        if(!response.ok)throw new Error(`Runtime download failed: ${response.status} ${url}`);
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if(createHash('sha256').update(bytes).digest('hex')!==sha)throw new Error(`Runtime checksum mismatch: ${name}`);
      await writeFile(archive,bytes);
      execFileSync(process.platform==='win32'?'tar.exe':'tar',['-xf',archive,'-C',stage],{stdio:'inherit'});
    }
    const nodeRoot = path.join(stage,nodeName.replace(/\.(zip|tar\.gz)$/,''));
    await mkdir(path.join(payload,'node/bin'),{recursive:true});
    const nodeBinary = process.platform === 'win32'
      ? await (await import('./portal-runtime/build-windows-node.mjs')).buildWindowsNode(cache,path.join(stage,'python'))
      : path.join(nodeRoot,'bin/node');
    await cp(nodeBinary,path.join(payload,'node/bin',process.platform==='win32'?'node.exe':'node'));
    await cp(path.join(nodeRoot,'LICENSE'),path.join(payload,'node/LICENSE'));
    // npm/npx belong to the Node distribution and are needed for ordinary projects.
    if (process.platform === 'win32') {
      await cp(path.join(nodeRoot,'node_modules/npm'),path.join(payload,'node/bin/node_modules/npm'),{recursive:true,verbatimSymlinks:true});
      for (const file of ['npm','npm.cmd','npx','npx.cmd']) await cp(path.join(nodeRoot,file),path.join(payload,'node/bin',file));
      // The sandbox has already canonicalized this root. Seed npm's cache so
      // it resolves descendants without inspecting inaccessible host ancestors.
      const realpathFile = path.join(payload,'node/bin/node_modules/npm/node_modules/@npmcli/arborist/lib/realpath.js');
      const realpath = await readFile(realpathFile,'utf8');
      const anchor = 'const realpathCached = (path, rpcache, stcache, depth) => {';
      if (!realpath.includes(anchor)) throw new Error('Bundled npm realpath adapter needs updating');
      await writeFile(realpathFile,realpath.replace(anchor,anchor+`
  if (process.env.HEART_PORTAL_SANDBOX === '1' && process.env.HEART_PORTAL_WORKSPACE) {
    const root = resolve(process.env.HEART_PORTAL_WORKSPACE)
    rpcache.set(root, root)
  }`));
    } else {
      await cp(path.join(nodeRoot,'lib/node_modules/npm'),path.join(payload,'node/lib/node_modules/npm'),{recursive:true,verbatimSymlinks:true});
      for (const file of ['npm','npx']) await cp(path.join(nodeRoot,'bin',file),path.join(payload,'node/bin',file),{verbatimSymlinks:true});
    }
    // Preserve relative Python aliases instead of storing the interpreter three times.
    await cp(path.join(stage,'python'),path.join(payload,'python'),{recursive:true,verbatimSymlinks:true});
    const python = process.platform==='win32'?'python/python.exe':'python/bin/python3';
    const node = `node/bin/${process.platform==='win32'?'node.exe':'node'}`;
    if(process.platform==='win32') {
      await cp(path.join(payload,python),path.join(payload,'python/python3.exe'));
      await writeFile(path.join(payload,'python/Lib/sitecustomize.py'),windowsSite);
    }
    execFileSync(path.join(payload,python),['-I','-B','-c',`import sys; assert sys.version.split()[0] == '${lock.pythonVersion}'`],{stdio:'inherit'});
    execFileSync(path.join(payload,node),['-e',`if(process.versions.node!=='${lock.nodeVersion}')process.exit(1)`],{stdio:'inherit'});
    execFileSync(path.join(payload,node),[path.join(payload,process.platform==='win32'?'node/bin/node_modules/npm/bin/npm-cli.js':'node/lib/node_modules/npm/bin/npm-cli.js'),'--version'],{stdio:'inherit'});
    await writeFile(path.join(payload,'runtime.json'),JSON.stringify({schema:1,id,platform:process.platform,arch:process.arch,python:{version:lock.pythonVersion,path:python},node:{version:lock.nodeVersion,path:node}},null,2)+'\n');
    await mkdir(path.dirname(destination),{recursive:true});
    const candidate = `${destination}.${randomUUID()}.tmp`;
    await cp(payload,candidate,{recursive:true,verbatimSymlinks:true});
    await rm(destination,{recursive:true,force:true});
    await rename(candidate,destination);
    console.log(`Prepared Portal Python ${lock.pythonVersion} + Node ${lock.nodeVersion} (${process.platform}/${process.arch}).`);
  } finally {await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await preparePortalRuntime(process.argv[2] && path.resolve(process.argv[2]));
