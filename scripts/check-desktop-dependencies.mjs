import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJSON = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const manifest = readJSON('package.json');
const lock = readJSON('package-lock.json');
for (const group of ['dependencies', 'devDependencies']) {
  const declared = manifest[group] ?? {};
  const locked = lock.packages[''][group] ?? {};
  for (const name of new Set([...Object.keys(declared), ...Object.keys(locked)])) {
    if (declared[name] !== locked[name]) throw new Error(`${name}: package.json 与锁文件不一致，请更新 package-lock.json。`);
    const installed = readJSON(`node_modules/${name}/package.json`).version;
    const expected = lock.packages[`node_modules/${name}`].version;
    if (installed !== expected) throw new Error(`${name}: 已安装 ${installed}，锁文件要求 ${expected}；请运行 npm ci 后重试。`);
  }
}
console.log('Desktop direct dependencies match package-lock.json.');
