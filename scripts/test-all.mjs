import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import { backgroundCoverage } from '../tests/support/desktop.mjs';
import { portalSource, requirePortalSource } from './portal-source.mjs';

const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !['--reuse-package', '--help'].includes(flag))) throw new Error('支持的参数：--reuse-package、--help');
if (flags.has('--help')) {
  console.log('npm run test:all [-- --reuse-package]\n默认验证 TypeScript、JS 单元测试、Rust 测试，构建 Portal/客户端，再执行桌面与 Town E2E。--reuse-package 跳过构建，测试现有安装包。');
  process.exit(0);
}
const directory = path.resolve('test-results');
await mkdir(directory, { recursive: true });
const source = portalSource;
const report = { startedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  portalSource: source, reusedPackage: flags.has('--reuse-package'), background: backgroundCoverage(), status: 'running', steps: [] };
async function persist() {
  await writeFile(path.join(directory, 'summary.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(directory, 'summary.md'), `# Desktop test results\n\nStatus: **${report.status}** · ${report.platform}/${report.arch}\n\n` +
    (report.error ? `${report.error}\n\n` : '') +
    `Background lifecycle: ${report.background.enabled ? 'included in desktop E2E (see step outcome)' : 'SKIPPED — ' + report.background.reason}\n\n` +
    '| Step | Result | Seconds |\n| --- | --- | ---: |\n' + report.steps.map(step => `| ${step.name} | ${step.status} | ${step.seconds} |`).join('\n') + '\n');
}
async function step(name, file, args, cwd = process.cwd()) {
  console.log(`\n[${name}]`);
  const start = Date.now();
  const log = createWriteStream(path.join(directory, name + '.log'));
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { log.write(data); process.stdout.write(data); });
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
  } catch (error) { log.write(String(error) + '\n'); result = { code: 1, error: String(error) }; }
  finally { log.end(); await finished(log); }
  const status = result.code === 0 ? 'passed' : 'failed';
  report.steps.push({ name, status, seconds: Number(((Date.now() - start) / 1000).toFixed(2)), ...result });
  await persist();
  if (status === 'failed') throw new Error(`${name} 失败，详见 test-results/${name}.log`);
}
const npm = (name, args = []) => {
  if (!process.env.npm_execpath) throw new Error('请通过 npm run test:all 启动。');
  return step(name, process.execPath, [process.env.npm_execpath, ...args]);
};
try {
  await persist();
  await requirePortalSource();
  await npm('typecheck', ['run', 'typecheck']);
  // Native Windows unit tests exercise the bundled Portal from resources/.
  // Build it before Vitest; a clean CI checkout has no generated binary yet.
  if (!flags.has('--reuse-package')) await npm('build-portal', ['run', 'build:portal']);
  await npm('unit', ['test', '--', '--reporter=default', '--reporter=junit', '--outputFile.junit=test-results/unit.xml']);
  await npm('menu-keyboard', ['run', 'test:menu-keyboard']);
  await npm('update-progress', ['run', 'test:update-progress']);
  await npm('town-names', ['run', 'test:town-names']);
  await npm('seed-garden', ['run', 'test:seed-garden']);
  await npm('sbs-refresh', ['run', 'test:sbs-refresh']);
  // Some engine tests share process-level environment variables; serialize Rust tests.
  await step('portal-rust', 'cargo', ['test', '--locked', '-p', 'heart-portal', '--', '--test-threads=1'], source);
  if (!flags.has('--reuse-package')) {
    await npm('package', ['run', 'package']);
  }
  await npm('chat-react', ['run', 'test:chat-react']);
  await npm('chat-context-menu', ['run', 'test:chat-context-menu']);
  await npm('chat-history', ['run', 'test:chat-history']);
  await npm('client-lifecycle', ['run', 'test:client-lifecycle']);
  await npm('portal-runtime', ['run', 'test:portal-e2e']);
  await npm('town-sdk', ['run', 'test:town-sdk']);
  await npm('desktop-e2e', ['run', 'test:e2e']);
  await npm('town-e2e', ['run', 'test:town-ui']);
  await npm('browser-e2e', ['run', 'test:browser']);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = String(error); console.error(String(error)); process.exitCode = 1; }
finally { report.finishedAt = new Date().toISOString(); await persist(); console.log('\n测试报告：test-results/summary.md（结构化结果：summary.json）'); }
