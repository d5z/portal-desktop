// Render the real workspace and Town models with isolated, representative message fixtures.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
let fixture, browser;
const baseline = process.env.TOWN_LAYOUT_BASELINE === '1';
let origin = process.env.TOWN_LAYOUT_URL;
try {
  if (!origin) {
    fixture = spawn(process.execPath, ['tests/workspace-layout.mjs'], { env: { ...process.env, PORTAL_LAYOUT_PREVIEW: '1', PORTAL_LAYOUT_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Workspace fixture did not start')), 20000);
      let output = '';
      fixture.stdout.on('data', chunk => { output += chunk; const match = output.match(/Layout preview: (http:\/\/[^\s]+)/); if (match) { clearTimeout(timeout); resolve(match[1]); } });
      fixture.once('exit', code => { clearTimeout(timeout); reject(new Error('Workspace fixture exited: ' + code)); });
    });
  }
  await mkdir('test-results', {recursive:true});
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: {width:1440,height:960}, reducedMotion:'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.fixtureApp);
  await page.evaluate(() => {
    const app = window.fixtureApp, original = app.api.town;
    const quote = '**关于阅读和排版的讨论**\n\n## 把问题拆成具体的小步骤\n\n```text\n分享各自的观察\n记录读过的内容\n```\n\n' + '引用里的长段落应该先收起，需要时再展开。'.repeat(16);
    const rows = Array.from({length:20}, (_,i) => ({
      id:String(i+1), seq:i+1, town_id:i%2?'t_River':'t_Willow', being:i%2?'河流':'Willow',
      sender_town_id:i%2?'t_River':'t_Willow', sender_display:i%2?'河流':'Willow',
      recipient_town_id:i%2?'t_Willow':'t_River', recipient_display:i%2?'Willow':'河流',
      message:i===19?'这段讨论值得慢慢读。'+('我把今天的阅读笔记整理了一下，把观察分成几个可以接着聊的小问题。\n\n').repeat(12):i===18?'我也赞同，先从一个具体的问题开始。':i===17?'https://example.invalid/'+'a'.repeat(160):i===16?'| 观察 | 记录 |\n| --- | --- |\n| 阅读 | 持续记录 |':i===0?quote:'第 '+(i+1)+' 条讨论：先分享一个观察，再一起把想法说清楚。',
      ...(i===19?{reply_to:1,reply_to_preview:quote,reply_to_display:'Willow'}:{}),
      at:new Date(Date.UTC(2026,9,30,7,i)).toISOString(),
      created_at:new Date(Date.UTC(2026,9,30,7,i)).toISOString(), delivery_status:'delivered',
    }));
    app.api.town = async query => ['bonfire','fireside','inbox','sent'].includes(query.kind)
      ? {ok:true,data:{messages:rows.map(row=>({...row, content:row.message}))},fetchedAt:new Date().toISOString()}
      : original(query);
    app.api.copyText = async text => { window.fixtureCopied = text; };
  });
  const navigate = async name => {
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true}).click();
    await page.locator('.social-message').first().waitFor();
  };
  const metrics = async () => page.evaluate(() => {
    const box = selector => document.querySelector(selector)?.getBoundingClientRect();
    const first = box('.social-message'), quote = box('.feed-reply-preview'), controls = box('.feed-controls');
    return { firstHeight:first.height, firstTop:first.top, controlsBottom:controls.bottom, quoteHeight:quote?.height,
      overflow: [...document.querySelectorAll('#town-body,.social-bubble,.fireside-thread')].some(node => node.scrollWidth > node.clientWidth + 1),
      outerOverflow: document.documentElement.scrollWidth > innerWidth };
  });
  let sharedMessageStyles;
  for (const [name, slug] of [['篝火','bonfire'],['围炉','firesides'],['私信','mail']]) {
    await navigate(name);
    const first = page.locator('.social-message').first();
    const reading = page.locator('.feed-reply-preview').first();
    const m = await metrics(); console.log(name, m);
    await page.screenshot({path:`test-results/town-${slug}-${baseline?'before':'after'}-1440.png`});
    if (baseline) continue;
    const styles = await page.evaluate(() => Object.fromEntries([
      '.social-message', '.social-avatar', '.social-meta', '.social-bubble', '.social-mine .social-bubble', '.social-foot',
    ].map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return [selector, Object.fromEntries(['display', 'padding', 'borderRadius', 'backgroundColor', 'fontSize', 'lineHeight'].map(property => [property, style[property]]))];
    })));
    if (sharedMessageStyles) assert.deepEqual(styles, sharedMessageStyles, 'All Town channels share the same message presentation');
    else sharedMessageStyles = styles;
    assert.equal(await page.locator('.town-meta-row').isVisible(), false, 'Healthy Town feeds have no connection or refresh metadata row');
    assert.ok(!m.overflow && !m.outerOverflow, 'Message widths stay inside the reading column');
    assert.ok(m.quoteHeight < 100, 'Collapsed quote must not become a wall of raw Markdown');
    assert.ok(m.firstTop - m.controlsBottom < 60, 'First message follows controls without an empty metadata row');
    const excerpt = await reading.locator('.feed-reply-excerpt').innerText();
    assert.doesNotMatch(excerpt, /```|\*\*|## /, 'Quoted preview displays readable text');
    await reading.locator('summary').click();
    await reading.locator('.feed-reply-full .reading-text').waitFor();
    await reading.getByRole('button',{name:'跳转原文'}).waitFor();
    await reading.locator('summary').click();
    await first.getByRole('button',{name:'展开全文',exact:true}).click();
    const collapse = first.getByRole('button',{name:'收起全文',exact:true});
    await collapse.click();
    await first.scrollIntoViewIfNeeded();
    await first.locator('.social-bubble').click({button:'right'});
    const menu = page.getByRole('menu',{name:'消息操作'});
    await menu.getByRole('menuitem',{name:'复制',exact:true}).click();
    assert.match(await page.evaluate(()=>window.fixtureCopied), /这段讨论/);
    {
      const outgoing = page.locator('.social-message.social-mine').first();
      const a = await outgoing.locator('.social-avatar').boundingBox(), b = await outgoing.locator('.social-bubble').boundingBox();
      assert.ok(Math.abs(a.x - b.x) < 1 && a.y + a.height <= b.y, 'Message avatar stays in the heading, above the flush-left body');
      const incoming = page.locator('.social-message:not(.social-mine)').first();
      const received = await incoming.locator('.social-bubble').boundingBox();
      assert.ok(Math.abs(b.x - received.x) < 1, 'Incoming and outgoing messages share one reading edge');
      assert.equal(await page.locator('.social-messages > .message-time-divider').count(), 0, 'Message timestamps belong in each row');
      assert.equal(await outgoing.locator('.social-meta time').count(), 1);
    }
    await page.locator('.feed-options > summary').click();
    await page.getByLabel('排序',{exact:true}).selectOption('oldest');
    await page.locator('.feed-options').press('Escape');
    await page.locator('.social-message').first().getByRole('button',{name:'展开全文',exact:true}).waitFor();
    await page.locator('.feed-options > summary').click();
    await page.getByLabel('排序',{exact:true}).selectOption('newest');
    await page.locator('.feed-options').press('Escape');
    await page.getByText('已复制',{exact:true}).waitFor({state:'detached'});
    for (const viewport of [{width:1920,height:1080},{width:900,height:650},{width:435,height:746}]) {
      await page.setViewportSize(viewport);
      await first.scrollIntoViewIfNeeded();
      const compact = await metrics();
      const layout = await page.evaluate(() => { const panel=document.querySelector('#place-panel').getBoundingClientRect(), content=document.querySelector('.town-content').getBoundingClientRect(); return {left:content.left-panel.left,right:panel.right-content.right}; });
      assert.ok(layout.left <= 32 && layout.right <= 32, 'Wide workspaces must not center Town in a narrow column');
      assert.ok(!compact.overflow && !compact.outerOverflow, `${name} must fit ${viewport.width}px`);
      {
        const edges = await page.locator('.social-message').evaluateAll(rows => rows.slice(0, 4).map(row => {
          const left = row.closest('.social-messages').getBoundingClientRect().left;
          return ['.social-meta', '.social-bubble', '.social-foot'].map(selector => Math.abs(row.querySelector(selector).getBoundingClientRect().left - left));
        }));
        assert.ok(edges.flat().every(offset => offset < 1), 'Message headings, bodies and actions align with the list edge at every width');
      }
      const toolbar = await page.locator('.town-toolbar').boundingBox(), search = await page.locator('#town-search').boundingBox();
      assert.ok(search.x >= toolbar.x && search.x+search.width <= toolbar.x+toolbar.width+1);
      if (slug==='firesides') {
        const thread = await page.locator('.fireside-thread').boundingBox();
        assert.ok(thread.height >= 220, 'Compact room list leaves usable reading space');
        await page.locator('.fireside-thread').evaluate(node => { node.scrollTop=200; });
        const header = await page.locator('.fireside-thread-heading').boundingBox(), filters = await page.locator('.feed-controls').boundingBox();
        assert.ok(filters.y >= header.y+header.height-1, 'Sticky title and filters must not overlap');
        await page.locator('.fireside-thread').evaluate(node => { node.scrollTop=0; });
      }
      await page.screenshot({path:`test-results/town-${slug}-after-${viewport.width}.png`});
    }
    await page.evaluate(()=>{const app=window.fixtureApp;app.theme='dark';app.changed();});
    await page.screenshot({path:`test-results/town-${slug}-dark-435.png`});
    await page.evaluate(()=>{const app=window.fixtureApp;app.theme='light';app.changed();});
    await page.setViewportSize({width:1440,height:960});
  }
  await page.evaluate(() => {
    const town = window.fixtureApp.town;
    town.live = { ...town.live, versions: { ...town.live.versions, mail: town.live.versions.mail + 1 } };
    town.changed();
  });
  await page.locator('#town-refresh[data-unread]').waitFor();
  assert.equal(await page.locator('.town-meta-row').isVisible(), false, 'Unread content uses the existing refresh control without adding a row');
  await page.getByRole('button', { name: '刷新内容', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#town-refresh').hasAttribute('data-unread'));
  await page.evaluate(() => {
    const town = window.fixtureApp.town;
    town.live = { ...town.live, phase: 'reconnecting', message: '连接中断，正在重连' };
    town.changed();
  });
  await page.getByText('连接中断，正在重连', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '重新连接', exact: true }).isVisible(), true);
  await page.evaluate(() => {
    const town = window.fixtureApp.town;
    town.live = { ...town.live, phase: 'connected' };
    town.refreshError = '刷新失败，仍显示上次内容：网络不可用';
    town.changed();
  });
  await page.getByText('刷新失败，仍显示上次内容：网络不可用', { exact: true }).waitFor();
  assert.equal(await page.locator('.town-live-row').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(baseline ? 'Baseline screenshots captured.' : 'PASS: three Town feeds, quote/expansion/copy/filter, shared bubble alignment and header states, responsive widths and sticky headers.');
} finally { await browser?.close(); fixture?.kill(); }
