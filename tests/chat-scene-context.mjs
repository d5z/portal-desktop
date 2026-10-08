import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';

const { outputFiles } = await build({
  stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { ChatSceneIndicator } from './desktop/renderer/app/components/chat-scene';
    const scenes = ['方案讨论', '日常交流'].map((name, i) => ({ scene_id: 'scene-' + i, scene_meta: { scene_label: name, client: 'fixture' } }));
    function Fixture() {
      const [scope, setScope] = React.useState('current');
      const [scene, setScene] = React.useState(scenes[0]);
      return <main id="client-main"><div className="workspace-body"><div className="workspace-stage">
        <header className="topbar"><ChatSceneIndicator scene={scene} sessions={scenes} scope={scope} scopeReady connected
          onScope={setScope} onCopy={() => {}} onSession={async (_, id) => { setScene(scenes.find(s => s.scene_id === id)); setScope('current'); }} /></header>
        <section id="chat-view" className="view" />
      </div></div></main>;
    }
    createRoot(document.getElementById('root')).render(<Fixture />);
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
});
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
  await page.setContent('<html><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: await readFile('desktop/renderer/app/styles.css', 'utf8') });
  await page.addScriptTag({ content: outputFiles[0].text });
  const toggle = page.getByRole('checkbox', { name: '显示全部场景上下文' });
  const selected = page.getByRole('button', { name: '切换到场景：方案讨论' });
  assert.equal(await page.getByRole('button', { name: '全部场景', exact: true }).count(), 0);
  await toggle.check();
  assert.equal(await toggle.isChecked(), true);
  assert.equal(await selected.getAttribute('aria-current'), 'true');
  assert.equal(await page.locator('.chat-scene-label').textContent(), '方案讨论');
  assert.equal(await page.locator('.chat-scene-label').isVisible(), true);
  await page.getByRole('button', { name: '场景信息', exact: true }).click();
  await page.locator('#chat-scene-dialog').waitFor();
  assert.equal(await page.locator('#chat-scene-id').innerText(), 'scene-0');
  await page.getByRole('button', { name: '关闭场景信息' }).click();
  await toggle.uncheck();
  assert.equal(await selected.getAttribute('aria-current'), 'true');
  await toggle.check();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/chat-scene-context.png' });
  await page.getByRole('button', { name: '切换到场景：日常交流' }).click();
  assert.equal(await page.locator('.chat-scene-label').textContent(), '日常交流');
  assert.equal(await toggle.isChecked(), false);
  console.log('PASS: context toggle preserves selected scene, label and details; no standalone all-scenes item.');
} finally { await browser.close(); }
