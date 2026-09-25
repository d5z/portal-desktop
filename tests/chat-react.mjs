// Exercise the actual bundled React chat against a local protocol fixture.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const assets = new Map(await Promise.all(['loom.html', 'chat.js', 'chat.css', 'highlight.css'].map(async file => ['/' + file, await readFile('desktop/generated/' + file)])));
// DOM textContent normalizes line endings; keep the fixture expectation stable
// when the checkout preserves CRLF on Windows.
const markdownSource = (await readFile(new URL('./fixtures/markdown-code.md', import.meta.url), 'utf8')).replace(/\r\n?/g, '\n').trimEnd();
const markdownPrefix = markdownSource.split('\n')[0];
const markdownFence = language => `\`\`\`\`${language}\n${markdownSource}\n\`\`\`\``;
let seq = 1;
const history = [];
const append = (role, content, scene_id = 'desktop-fixture') => history.push({ seq: seq++, role, content, scene_id, at: new Date().toISOString() });
for (let i = 1; i <= 12; i++) { append('user', `历史问题 ${i}`); append('being', Array.from({ length: 6 }, (_, j) => `第 ${i} 轮回复，第 ${j + 1} 段。`).join('\n\n')); }
history[0].at = '2024-01-02T03:04:05.000Z';
append('being', '打开篝火，然后看 `seeds`。\n\n```javascript\nconst safe = "<script>never()</script>";\n```\n\n`https://example.com/manual`\n\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n\n[恶意链接](javascript:alert(1))\n\n<img src=x onerror=alert(1)>');
history.at(-1).content += '\n\n' + markdownFence('markdown');
history.at(-1).content += '\n\n```md\n## 第二个文档\n\n独立切换。\n```';
const presets = [{ id: 'a', label: 'Claude Alpha', provider: 'anthropic', model: 'alpha', has_key: true }, { id: 'b', label: 'DeepSeek Beta', provider: 'deepseek', model: 'beta', has_key: false },
  { id: 'local', label: 'Qwen Local', provider: 'self-hosted', model: 'local/qwen-fixture', has_key: false }];
let config = { model: 'alpha', presets, thinking: 'medium', temperature: 0.7, sbs_enabled: false };
const requests = [], patches = [];
let active = null, heldResponse = null, rejectConfig = false, requireKey = false, stopCount = 0, oauthRequests = 0;
let markdownResponse = null;
let rollbackSelfHosted = false;
const event = (response, name, data) => response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
async function waitUntil(check, description) {
  const deadline = Date.now() + 10000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(check(), description);
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const json = (data, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
  if (url.pathname === '/api/history') return json({ messages: history });
  if (url.pathname === '/api/status') return json({ being_name: 'Willow', description: '本地 React 测试', tools: 7, memory: { nodes: 12 } });
  if (url.pathname === '/health') { response.end('OK fixture'); return; }
  if (url.pathname === '/api/llm/config') {
    if (request.method !== 'PATCH') return json(config);
    let body = ''; for await (const chunk of request) body += chunk;
    const patch = JSON.parse(body); patches.push(patch);
    if (rejectConfig) return json({ error: 'fixture rejected config' }, 500);
    if (requireKey && !patch.api_key) return json({ needs_key: true, error: 'fixture needs key' });
    if (rollbackSelfHosted && patch.provider === 'self-hosted') return json({ ok: true, rolled_back: true, config });
    config = { ...config, ...patch, sbs_enabled: patch.sbs_enabled ? patch.sbs_enabled === 'on' : config.sbs_enabled };
    return json({ ok: true, config });
  }
  if (url.pathname.startsWith('/api/llm/oauth')) { oauthRequests++; return json({ status: 'portal_required' }, 503); }
  if (url.pathname === '/api/stop') { stopCount++; heldResponse?.end(); heldResponse = null; return json({ ok: true }); }
  if (url.pathname === '/api/stream/active') {
    if (!active) { response.writeHead(204); response.end(); return; }
    if (url.searchParams.has('after')) {
      const after = Number(url.searchParams.get('after'));
      const events = active.events.filter(item => item.seq > after);
      const result = { ...active, events, finished: true };
      append('being', active.reply); active = null; return json(result);
    }
    return json({ ...active, events: active.events.slice(0, 1), finished: false });
  }
  if (url.pathname === '/api/chat/stream') {
    let body = ''; for await (const chunk of request) body += chunk;
    const input = JSON.parse(body); requests.push(input); append('user', input.message, input.scene_id);
    if (heldResponse) return json({ spliced: true }, 202);
    if (input.message === 'http-error') return json({ error: 'fixture request failed' }, 400);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    event(response, 'meta', { stream_id: 'stream-' + requests.length });
    if (input.message === 'markdown-stream') {
      markdownResponse = response;
      event(response, 'content_block_delta', { delta: { text: '````md\n' + markdownPrefix } });
      return;
    }
    event(response, 'thinking', { text: '检查 React 状态与协议' });
    event(response, 'content_block_delta', { delta: { text: '开始回复。' } });
    if (input.message === 'hold') { heldResponse = response; return; }
    const continuation = input.message === 'continuation';
    if (continuation) {
      event(response, 'message_stop', {});
      append('being', '开始回复。', input.scene_id);
    }
    setTimeout(() => {
      event(response, 'tool_use', { name: 'read_file', input: { path: '/tmp/fixture.txt' } });
      event(response, 'tool_result', { name: 'read_file', summary: 'fixture file read', is_error: false });
      event(response, 'content_block_delta', { delta: { text: '\n\n**React 回复完成**。查看花园与篝火。' } });
      append('being', continuation ? '**React 回复完成**。查看花园与篝火。' : '开始回复。\n\n**React 回复完成**。查看花园与篝火。', input.scene_id);
      event(response, 'message_stop', { session_id: 'session-fixture' }); response.end();
    }, 150);
    return;
  }
  if (assets.has(url.pathname)) {
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    response.end(assets.get(url.pathname)); return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(`<!doctype html><html><meta charset="utf-8"><style>body{margin:0}iframe{border:0;width:100vw;height:100vh}</style><iframe id="chat" src="/loom.html?revision=fixture&scene_id=desktop-fixture&scene_label=Desktop"></iframe><script>
    window.received=[];
    window.addEventListener('message', event => {
      if(event.source!==document.querySelector('iframe').contentWindow) return;
      window.received.push(event.data);
      if(event.data.type==='beings:scene-capture') event.source.postMessage({type:'beings:scene-captured',id:event.data.id},location.origin);
    });
  </script></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: 'chrome' }) });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const origin = 'http://127.0.0.1:' + server.address().port;
  await page.goto(origin);
  const frame = page.frameLocator('#chat');
  const input = frame.locator('#input .cm-content');
  const child = () => page.frames().find(frame => frame.url().includes('/loom.html'));
  const post = data => page.evaluate(data => document.querySelector('iframe').contentWindow.postMessage(data, location.origin), data);
  await frame.locator('.chat-index-tick').nth(11).waitFor();
  await child().evaluate(() => {
    document.querySelector('#input').addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') event.stopPropagation();
    });
  });
  await input.focus();
  await page.keyboard.press('Control+f');
  await page.waitForFunction(() => window.received.some(item => item.type === 'beings:chat-search'));
  assert.equal(await frame.locator('#messages .message').count(), 25);
  const messageFor = text => frame.getByText(text, { exact: true }).locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " message ")][1]');
  const oldMessageTime = await messageFor('历史问题 1').locator('.meta').textContent();
  const todayMessageTime = await messageFor('历史问题 2').locator('.meta').textContent();
  assert.match(oldMessageTime, /2024年\d{2}月\d{2}日 \d{2}:\d{2}:\d{2}/, 'Messages from another day show year, month and day');
  assert.doesNotMatch(todayMessageTime, /年\d{2}月\d{2}日/, 'Messages from today only show the time');
  assert.equal(await frame.locator('#messages img').count(), 0);
  assert.equal(await frame.locator('#messages a[href^="javascript:"]').count(), 0);
  assert.ok(await frame.locator('.hljs-keyword').count());
  assert.equal(await frame.locator('code.lang-javascript').first().textContent(), 'const safe = "<script>never()</script>";');
  const historyMarkdown = frame.locator('.markdown-code-block').first();
  const otherMarkdown = frame.locator('.markdown-code-block').nth(1);
  assert.equal(await historyMarkdown.getByRole('button', { name: '预览', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await historyMarkdown.getByRole('heading', { name: '客户端 Markdown 验证', exact: true }).count(), 1);
  assert.equal(await historyMarkdown.locator('table').count(), 1);
  assert.equal(await historyMarkdown.locator('.markdown-preview strong').first().textContent(), '完整显示');
  assert.equal(await historyMarkdown.locator('.markdown-preview script, .markdown-preview img').count(), 0);
  await historyMarkdown.getByRole('button', { name: '源码', exact: true }).click();
  assert.equal(await historyMarkdown.locator('code.lang-markdown').textContent(), markdownSource, 'History retains the entire fenced Markdown source');
  assert.equal(await frame.locator('code.lang-markdown script, code.lang-markdown a, code.lang-markdown table').count(), 0);
  assert.equal(await otherMarkdown.getByRole('button', { name: '预览', exact: true }).getAttribute('aria-pressed'), 'true', 'Each Markdown block keeps its own mode');
  await mkdir('test-results', { recursive: true });
  await historyMarkdown.screenshot({ path: 'test-results/chat-markdown-source-light.png' });
  await historyMarkdown.getByRole('button', { name: '预览', exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.equal(await historyMarkdown.getByRole('heading', { name: '客户端 Markdown 验证', exact: true }).count(), 1);
  await historyMarkdown.screenshot({ path: 'test-results/chat-markdown-preview-light.png' });
  assert.equal(await frame.locator('.chat-code-link').getAttribute('href'), 'https://example.com/manual');
  await frame.getByRole('button', { name: '打开篝火', exact: true }).click();
  await page.waitForFunction(() => window.received.some(item => item.type === 'beings:open-place' && item.view === 'bonfire'));
  await input.fill('保留草稿');
  await frame.locator('.chat-index-tick').first().hover();
  await frame.locator('#chat-index-preview').waitFor();
  assert.match(await frame.locator('#chat-index-preview').textContent(), /第 1 轮回复/);
  await frame.locator('.chat-index-tick').first().click();
  assert.equal(await input.textContent(), '保留草稿');
  const initialScroll = await frame.locator('#messages').evaluate(el => el.scrollTop);
  await post({ type: 'beings:town-activity', channels: ['mail'] });
  assert.equal(await frame.locator('#messages').evaluate(el => el.scrollTop), initialScroll);
  await post({ type: 'beings:chat-action', action: 'model' });
  await frame.locator('#settings-panel.active').waitFor();
  await frame.locator('#llm-current').getByText('Claude Alpha', { exact: true }).waitFor();
  assert.equal(await frame.locator('#oauth-section').count(), 0);
  assert.equal(await frame.locator('.provider-group-label').first().textContent(), '自部署');
  await frame.getByRole('searchbox', { name: '搜索模型' }).fill('自部署');
  assert.equal(await frame.locator('.llm-item').count(), 1);
  assert.match(await frame.locator('.llm-item').textContent(), /Qwen Local.*无需密钥/);
  await frame.getByRole('searchbox', { name: '搜索模型' }).fill('');
  await frame.locator('#settings-panel').screenshot({ path: 'test-results/chat-self-hosted-light.png', animations: 'disabled' });
  await post({ type: 'beings:appearance', theme: 'dark' });
  await child().waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await frame.locator('#settings-panel').screenshot({ path: 'test-results/chat-self-hosted-dark.png', animations: 'disabled' });
  await post({ type: 'beings:appearance', theme: 'light' });
  await frame.getByRole('searchbox', { name: '搜索模型' }).fill('missing-provider');
  await frame.getByText('没有匹配的模型，试试其他名称。').waitFor();
  await frame.getByRole('searchbox', { name: '搜索模型' }).fill('deepseek');
  assert.equal(await frame.locator('.llm-item').count(), 1);
  await frame.getByRole('searchbox', { name: '搜索模型' }).fill('');
  await frame.locator('.llm-custom-link').click();
  await frame.locator('#s2-model').fill('custom-test'); await frame.locator('#s2-provider').fill('custom'); await frame.locator('#s2-base-url').fill('https://example.com/v1');
  rejectConfig = true; await frame.locator('#s2-apply').click(); await frame.locator('#s2-error').getByText(/fixture rejected/).waitFor();
  assert.equal(await frame.locator('#s2-model').inputValue(), 'custom-test');
  rejectConfig = false; await frame.locator('.step2-back').click(); await frame.getByRole('button', { name: /^DeepSeek Beta/ }).click();
  assert.equal(await frame.locator('#s2-provider').evaluate(el => el.readOnly), true);
  await frame.locator('#s2-api-key').fill('official-provider-key');
  await frame.locator('#s2-route [data-val="openrouter"]').click();
  assert.equal(await frame.locator('#s2-api-key').inputValue(), '', 'Changing providers must not reuse the previous provider key');
  assert.equal(await frame.locator('#s2-base-url').inputValue(), 'https://openrouter.ai/api/v1');
  await frame.locator('#s2-route [data-val="official"]').click();
  requireKey = true; await frame.locator('#s2-apply').click(); await frame.locator('#s2-error').getByText('fixture needs key').waitFor();
  await frame.locator('#s2-api-key').fill('fixture-key'); await frame.locator('#s2-apply').click();
  await frame.locator('#llm-current').getByText('DeepSeek Beta', { exact: true }).waitFor();
  assert.equal(patches.at(-1).api_key, 'fixture-key'); requireKey = false;
  const selfHosted = frame.getByRole('button', { name: /^Qwen Local/ });
  rejectConfig = true;
  await selfHosted.click(); await frame.locator('#cfg-status').getByText(/fixture rejected/).waitFor();
  assert.match(await frame.locator('#llm-current').textContent(), /DeepSeek Beta/);
  assert.equal(await frame.locator('#llm-step2').count(), 0, 'Self-hosted selection skips the provider/key form');
  rejectConfig = false; rollbackSelfHosted = true;
  await selfHosted.click(); await frame.locator('#cfg-status').getByText('已恢复上次可用配置').waitFor();
  assert.match(await frame.locator('#llm-current').textContent(), /DeepSeek Beta/);
  rollbackSelfHosted = false; requireKey = true;
  await selfHosted.click(); await frame.locator('#cfg-status').getByText('fixture needs key').waitFor();
  assert.match(await frame.locator('#llm-current').textContent(), /DeepSeek Beta/);
  requireKey = false;
  await selfHosted.click(); await frame.locator('#llm-current').getByText('Qwen Local', { exact: true }).waitFor();
  assert.deepEqual(patches.at(-1), { model: 'local/qwen-fixture', provider: 'self-hosted', base_url: 'http://115.190.110.33:7860/v1' });
  assert.match(await frame.locator('#llm-current .model-detail').textContent(), /自部署/);
  assert.equal(await selfHosted.count(), 0, 'The confirmed current model is removed from alternatives');
  await frame.locator('.model-parameters summary').click();
  await frame.locator('#cfg-thinking [data-val="high"]').click(); await frame.locator('#cfg-thinking [data-val="high"].active').waitFor();
  await frame.locator('#cfg-temperature').focus(); await page.keyboard.press('Home');
  await frame.locator('#cfg-temperature-val').getByText('0.0', { exact: true }).waitFor();
  assert.equal(patches.at(-1).temperature, 0);
  await frame.getByRole('button', { name: '恢复上次可用配置' }).click();
  await frame.locator('#cfg-status').getByText('设置已更新').waitFor();
  assert.equal(patches.at(-1).rollback, 'true');
  assert.equal(oauthRequests, 0, 'Unsupported account authorization must never be requested');
  await frame.getByRole('button', { name: '关闭模型设置' }).click();
  await post({ type: 'beings:chat-action', action: 'being' }); await frame.locator('#soul-card.active').waitFor();
  assert.match(await frame.locator('#soul-stats').innerText(), /7/);
  await frame.getByRole('button', { name: '关闭 Being 信息' }).click();
  await post({ type: 'beings:chat-action', action: 'privacy' }); await frame.locator('#privacy-panel.active').waitFor(); await frame.getByRole('button', { name: '关闭隐私说明' }).click();
  assert.equal(await input.textContent(), '保留草稿');
  await child().evaluate(() => {
    const readAsDataURL = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function (file) {
      setTimeout(() => readAsDataURL.call(this, file), 500);
    };
  });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await frame.locator('#file-input').setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: image });
  await frame.locator('#pending-files.active').waitFor();
  await frame.getByText(/pixel\.png.*正在读取/).waitFor();
  await input.fill('send-test'); await frame.locator('#send-btn').click();
  await frame.getByText('React 回复完成', { exact: true }).waitFor();
  await frame.locator('.run-activity[data-outcome="done"]').waitFor();
  assert.equal(requests.length, 1); assert.equal(requests[0].attachments[0].media_type, 'image/png'); assert.equal(requests[0].attachments[0].data, image.toString('base64'));
  assert.equal(await frame.locator('.run-activity').count(), 1, 'One process record per completed turn');
  assert.equal(await frame.locator('.run-activity.running').count(), 0);
  await frame.locator('.run-activity summary').click(); assert.match(await frame.locator('.run-list').innerText(), /fixture file read/);
  const repliesBeforeContinuation = await frame.locator('.message.being:not(.thinking-indicator)').count();
  await input.fill('continuation'); await frame.locator('#send-btn').click();
  await page.waitForFunction(() => window.received.some(item => item.type === 'beings:scene-result' && item.ok));
  await frame.locator('.message.being:not(.thinking-indicator)').nth(repliesBeforeContinuation + 1).waitFor();
  await frame.locator('.run-activity.running').waitFor({ state: 'hidden' });
  const continuationReplies = await frame.locator('.message.being:not(.thinking-indicator)').allTextContents();
  assert.equal(continuationReplies.length, repliesBeforeContinuation + 2,
    `A reply boundary must split continuation bubbles: ${JSON.stringify(continuationReplies.slice(-4))}`);
  await input.fill('hold'); await frame.locator('#send-btn').click(); await frame.locator('.run-activity.running .run-stop').waitFor();
  await frame.locator('#file-input').setInputFiles({ name: 'splice.txt', mimeType: 'text/plain', buffer: Buffer.from('splice attachment') });
  await frame.locator('#pending-files.active').waitFor(); await input.fill('additional input'); await frame.locator('#send-btn').click();
  await waitUntil(() => requests.at(-1)?.message === 'additional input', 'The interrupting message reaches the server');
  assert.equal(requests.at(-1).attachments[0].data, Buffer.from('splice attachment').toString('base64'));
  assert.equal(await frame.getByText(/消息已送达/).count(), 0, 'Interrupting a reply does not add a system bubble to the conversation');
  await frame.locator('.run-activity.running .run-stop').click(); await frame.locator('.run-activity[data-outcome="stopped"]').waitFor(); assert.equal(stopCount, 1);
  await input.fill('http-error'); await frame.locator('#send-btn').click(); await frame.getByText(/fixture request failed/).waitFor();
  assert.equal(await frame.locator('.run-activity.running').count(), 0);
  assert.equal(await frame.locator('.run-activity').last().getAttribute('data-outcome'), 'error');
  await input.fill('');
  const draft = { type: 'beings:scene-draft', id: 'draft1', text: '一起看：以下是引用内容：fixture', expiresAt: Date.now() + 10000 };
  await post(draft); await child().waitForFunction(() => document.querySelector('#input .cm-content').textContent.includes('fixture'));
  await input.press('ControlOrMeta+z');
  assert.equal(await input.textContent(), draft.text, 'Undo cannot revive the previous draft after an external insertion');
  await post({ ...draft, id: 'draft2', text: '不得覆盖已有草稿' });
  await page.waitForFunction(() => window.received.some(item => item.type === 'beings:scene-draft-result' && item.id === 'draft2' && item.ok === false));
  await frame.locator('#send-btn').click();
  await page.waitForFunction(() => window.received.some(item => item.type === 'beings:scene-result' && item.hasSceneDraft && item.ok));
  await frame.locator('.run-activity.running').waitFor({ state: 'hidden' });
  // A fresh React root catches up using replay sequence numbers without duplicating deltas.
  active = { stream_id: 'replay-fixture', origin: 'human', next_seq: 4, reply: 'replay-once-complete', events: [
    { seq: 1, event: 'content_block_delta', data: { delta: { text: 'replay-once-' } } },
    { seq: 2, event: 'content_block_delta', data: { delta: { text: 'complete' } } },
    { seq: 3, event: 'message_stop', data: {} },
  ] };
  await page.reload(); await frame.getByText('replay-once-complete', { exact: true }).waitFor();
  assert.equal(await frame.getByText('replay-once-complete', { exact: true }).count(), 1);
  await frame.locator('#chat-index-latest').click();
  await mkdir('test-results', { recursive: true }); await page.screenshot({ path: 'test-results/chat-react-light.png' });
  await post({ type: 'beings:appearance', theme: 'dark' }); await post({ type: 'beings:reading', size: 19 });
  await child().waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.setViewportSize({ width: 420, height: 740 });
  assert.equal(await child().evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/chat-react-dark-mobile.png' });
  // Keep a Markdown fence open across actual streamed React updates, then reload it from history.
  await input.fill('markdown-stream'); await frame.locator('#send-btn').click();
  const streamedMarkdown = frame.locator('.markdown-code-block').last();
  await streamedMarkdown.locator('.markdown-preview h1').waitFor();
  assert.equal(await streamedMarkdown.locator('h1').textContent(), markdownPrefix.slice(2), 'An unfinished Markdown fence is previewed during streaming');
  await post({ type: 'beings:history-scope', scope: 'all', revision: 'fixture' });
  await page.waitForFunction(() => window.received.some(item => item.type === 'beings:history-scope-state' && item.scope === 'all'));
  await streamedMarkdown.getByRole('button', { name: '源码', exact: true }).click();
  assert.equal(await streamedMarkdown.locator('code.lang-md').textContent(), markdownPrefix);
  const markdownSplit = markdownSource.indexOf('## 验收标准');
  event(markdownResponse, 'content_block_delta', { delta: { text: markdownSource.slice(markdownPrefix.length, markdownSplit) } });
  await child().waitForFunction(() => document.querySelector('code.lang-md')?.textContent.includes('console.log(message)'));
  assert.equal(await streamedMarkdown.getByRole('button', { name: '源码', exact: true }).getAttribute('aria-pressed'), 'true', 'Streaming updates preserve the selected mode');
  await post({ type: 'beings:history-scope', scope: 'current', revision: 'fixture' });
  await child().waitForFunction(() => !document.querySelector('.message-scene'));
  assert.equal(await streamedMarkdown.getByRole('button', { name: '源码', exact: true }).getAttribute('aria-pressed'), 'true', 'Returning to the current scene preserves the active stream and Markdown mode');
  await streamedMarkdown.getByRole('button', { name: '预览', exact: true }).click();
  assert.equal(await streamedMarkdown.locator('table').count(), 1);
  event(markdownResponse, 'content_block_delta', { delta: { text: markdownSource.slice(markdownSplit) + '\n````' } });
  append('being', markdownFence('md'));
  event(markdownResponse, 'message_stop', { session_id: 'session-fixture' });
  markdownResponse.end(); markdownResponse = null;
  await frame.locator('.run-activity.running').waitFor({ state: 'hidden' });
  assert.equal(await streamedMarkdown.locator('.markdown-preview').getByText('末尾校验：全文结束。', { exact: true }).count(), 1);
  assert.equal(await child().evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  // A taller viewport lets the entire block fit inside the scrolling message pane for visual QA.
  await page.setViewportSize({ width: 420, height: 1400 });
  await streamedMarkdown.screenshot({ path: 'test-results/chat-markdown-preview-dark-mobile.png' });
  await streamedMarkdown.getByRole('button', { name: '源码', exact: true }).click();
  assert.equal(await streamedMarkdown.locator('code.lang-md').textContent(), markdownSource, 'Finishing the fence retains all source text');
  await streamedMarkdown.screenshot({ path: 'test-results/chat-markdown-source-dark-mobile.png' });
  await page.setViewportSize({ width: 420, height: 740 });
  await page.reload();
  await streamedMarkdown.locator('.markdown-preview h1').waitFor();
  await streamedMarkdown.getByRole('button', { name: '源码', exact: true }).click();
  assert.equal(await streamedMarkdown.locator('code.lang-md').textContent(), markdownSource, 'History reload preserves the streamed Markdown');
  await input.fill('- first');
  await input.press('Shift+Enter');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['• first', '• '], 'Shift+Enter continues a bullet list in the editor');
  await input.fill('1. first');
  await input.press('Shift+Enter');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. first', '2. '], 'Ordered list continuation increments the number');
  await input.fill('1. a\n2. b\n3. c\n4. d');
  await input.press('ControlOrMeta+Home');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Home');
  await input.press('Shift+ArrowDown');
  await input.press('Backspace');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '2. b', '3. d'], 'Deleting item 3 immediately renumbers item 4');
  await input.press('ControlOrMeta+z');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '2. b', '3. c', '4. d'], 'One undo restores the deleted item and its original numbering');
  await input.press('ControlOrMeta+Shift+z');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '2. b', '3. d'], 'Redo reapplies the deletion and numbering together');
  await input.pressSequentially('X');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '2. b', 'X3. d'], 'Typing after deletion stays at the beginning of the surviving item');
  await input.fill('7. separate\n\nplain\n\n1. a\n2. b\n3. c');
  await input.press('ControlOrMeta+Home');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await input.press('Home');
  await input.press('Shift+ArrowDown');
  await input.press('Backspace');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['7. separate', '', 'plain', '', '1. a', '2. c'], 'Deleting in one list leaves a separate list unchanged');
  await input.fill('```\n1. code\n2. code\n```');
  await input.press('ControlOrMeta+Home');
  await input.press('ArrowDown');
  await input.press('Home');
  await input.press('Shift+ArrowDown');
  await input.press('Backspace');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['```', '2. code', '```'], 'Deleting a code line does not renumber code');
  await input.fill('1. a\n2. b');
  await input.press('ControlOrMeta+Home');
  await input.press('Shift+Enter');
  await input.press('Shift+Enter');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['', '1. a', '2. b'], 'Exiting an empty prepended item leaves a plain first line');
  await input.pressSequentially('intro');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['intro', '1. a', '2. b'], 'Typing after exit stays on the plain first line');
  await input.fill('- item');
  await input.press('End');
  await input.press('Tab');
  assert.equal(await input.locator('.cm-line').first().textContent(), '• item', 'Tab leaves a list without a parent at the root');
  assert.equal(await input.evaluate(element => element.contains(document.activeElement)), true, 'Tab keeps focus in the composer');
  await input.press('Shift+Tab');
  assert.equal(await input.locator('.cm-line').first().textContent(), '• item', 'Shift+Tab outdents from the text cursor');
  assert.equal(await input.evaluate(element => element.contains(document.activeElement)), true, 'Shift+Tab keeps focus in the composer');
  await input.fill('1. a\n2. b\n3. c');
  await input.press('ArrowUp');
  await input.press('Tab');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '1. b', '2. c'], 'Indenting a middle item preserves sibling numbering');
  await input.press('Shift+Tab');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '2. b', '3. c'], 'Outdenting restores sibling numbering');
  await input.fill('first\nsecond');
  await input.press('ControlOrMeta+a');
  await input.press('Tab');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['  first', '  second'], 'Tab indents a selected block');
  assert.equal(await input.evaluate(element => element.contains(document.activeElement)), true, 'Tab on a selection keeps composer focus');
  await input.press('Shift+Tab');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['first', 'second'], 'Shift+Tab outdents a selected block');
  await input.fill('intro\n1. a\n2. b\n3. c');
  await input.press('ControlOrMeta+Home');
  await input.press('Shift+ArrowDown');
  await input.press('Shift+ArrowDown');
  await input.press('Shift+ArrowDown');
  await input.press('Tab');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['  intro', '1. a', '1. b', '2. c'], 'Tab keeps the list root and nests the next selected item');
  await input.press('Shift+Tab');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['intro', '1. a', '2. b', '3. c'], 'Shift+Tab restores a selected list after a plain line');
  await input.fill('1. a\n2. b\n\n1. c\n2. d');
  await input.press('ControlOrMeta+Home');
  await input.press('ArrowDown');
  await input.press('Home');
  await input.press('Shift+ArrowDown');
  await input.press('Shift+ArrowDown');
  await input.press('Shift+ArrowDown');
  await input.press('Tab');
  assert.deepEqual((await input.locator('.cm-line').allTextContents()).filter(line => line.trim()), ['1. a', '1. b', '2. c', '2. d'], 'Tab keeps a list continuous across a blank line');
  await input.fill('1. a\n2. b\n3. c');
  await input.press('ArrowUp');
  await input.press('Home');
  await input.press('Shift+End');
  await input.press('Tab');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '1. b', '2. c'], 'Tab on a selected numbered item keeps parent numbers in order');
  await input.fill('1. a\n2. b\n3. c');
  await input.press('ControlOrMeta+a');
  await input.press('ArrowLeft');
  await input.press('ArrowDown');
  await input.press('Shift+ArrowDown');
  assert.equal(await input.evaluate(() => getSelection()?.toString().trim()), '2. b');
  await input.press('Tab');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '1. b', '2. c'], 'Tab on a line selection keeps sibling numbering');
  await input.press('ControlOrMeta+z');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '2. b', '3. c'], 'One undo reverses the complete selected-line indent');
  await input.press('Tab');
  await input.press('Shift+Tab');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. a', '2. b', '3. c'], 'Shift+Tab on a line selection restores sibling numbering');
  await input.fill('7. item');
  await input.press('Shift+Tab');
  assert.equal(await input.locator('.cm-line').first().textContent(), '7. item', 'Shift+Tab at the root level leaves the number alone');
  assert.equal(await input.evaluate(element => element.contains(document.activeElement)), true, 'Root-level Shift+Tab keeps composer focus');
  await input.press('Escape');
  await page.keyboard.press('Tab');
  assert.equal(await input.evaluate(element => element.contains(document.activeElement)), false, 'Escape then Tab can leave the composer');
  await input.fill('1. item');
  await input.press('Home');
  await input.press('ArrowRight');
  await input.press('Shift+Enter');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['1. ', '2. item'], 'Shift+Enter inside the marker does not split the marker');
  await input.fill('```js\n- literal');
  await input.press('Shift+Enter');
  assert.deepEqual(await input.locator('.cm-line').allTextContents(), ['```js', '- literal', ''], 'Code fence content stays literal');
  await input.fill('# Heading');
  assert.equal(await input.locator('.cm-line').first().textContent(), 'Heading', 'Heading marker does not occupy visible width');
  await frame.locator('#send-btn').click();
  await waitUntil(() => requests.at(-1)?.message === '# Heading', 'Sending preserves the Markdown heading source');
  await frame.locator('.run-activity.running').waitFor({ state: 'hidden' });
  await input.fill('enter-send');
  await input.press('Enter');
  await waitUntil(() => requests.at(-1)?.message === 'enter-send', 'Enter sends the current editor source');
  // The standalone browser build exposes its own React settings controls.
  await page.goto(origin + '/loom.html');
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.locator('#settings-panel.active').waitFor();
  await page.locator('.llm-item').first().waitFor();
  assert.equal(await page.locator('.llm-item').first().evaluate(button => {
    const name = button.querySelector('.model-option-name').getBoundingClientRect();
    const detail = button.querySelector('.model-option-detail').getBoundingClientRect();
    return detail.top >= name.bottom && button.scrollWidth <= button.clientWidth;
  }), true, 'Narrow model cards keep names and hints on separate rows');
  assert.equal(await page.locator('#settings-panel').evaluate(panel => panel.scrollWidth <= panel.clientWidth), true);
  await page.getByRole('button', { name: '关闭模型设置' }).click();
  assert.deepEqual(errors, []);
  console.log('PASS: React history/index/Markdown, searchable model settings without unsupported OAuth, API keys and parameters, attachments, live and spliced streams, stop/error cleanup, scene drafts, replay, dark/narrow layout.');
} finally {
  heldResponse?.end(); markdownResponse?.end(); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
