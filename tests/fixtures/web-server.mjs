// Local-only protocol fixture for manual browser QA; never connects to real services.
import { createServer } from 'node:http';
const history = [{ seq: 1, role: 'user', content: '我们一起去小镇看看吧', at: new Date().toISOString() }, { seq: 2, role: 'being', content: '你好，我是柳树。这里可以继续对话，也可以阅读 **种子花园** 与故事。', at: new Date().toISOString() }];
const messages = [{ seq: 1, town_id: 't_River', speaker_name: '河流', content: '今天的小镇也有新的灵感。', created_at: new Date().toISOString() }];
const streams = new Set();
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = url.pathname.replace(/^\/willow/, '');
  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const event = (target, name, data) => target.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
  if (route === '/api/status') return json({ being_name: '柳树', description: '本地网页验证', tools: 0, memory: { nodes: 2 } });
  if (route === '/health') { res.end('OK'); return; }
  if (route === '/api/history') return json({ messages: history });
  if (route === '/api/stream/active') { res.writeHead(204); res.end(); return; }
  if (route === '/api/llm/config') return json({ model: 'fixture', thinking: 'medium', sbs_enabled: false, presets: [{ id: 'fixture', label: '本地测试模型', provider: 'anthropic', model: 'fixture', has_key: true }, ...Array.from({length: 6}, (_, index) => ({id: 'choice-' + index, label: ['轻量对话', '深入思考', '长文阅读', '日常协作', '创意写作', '代码助手'][index], provider: index < 3 ? 'anthropic' : 'openai', model: 'fixture-' + index, has_key: false}))] });
  if (route === '/api/chat/stream') {
    let raw = ''; for await (const part of req) raw += part;
    const input = JSON.parse(raw);
    const scene = { scene_id: input.scene_id, scene_meta: input.scene_meta };
    history.push({ ...scene, seq: history.length + 1, role: 'user', content: input.message, at: new Date().toISOString() });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    event(res, 'meta', { ...scene, stream_id: 'fixture-' + history.length });
    if (input.scene_id?.startsWith('town-pair-')) {
      event(res, 'content_block_delta', { delta: { text: 'AB3XY9' } });
      event(res, 'message_stop', {}); res.end(); return;
    }
    event(res, 'content_block_delta', { delta: { text: '收到你的消息。' } });
    setTimeout(() => {
      const text = '网页流式回复已完成。';
      event(res, 'content_block_delta', { delta: { text } });
      history.push({ ...scene, seq: history.length + 1, role: 'being', content: '收到你的消息。' + text, at: new Date().toISOString() });
      event(res, 'message_stop', {}); res.end();
    }, 100);
    return;
  }
  if (route === '/api/client/pair/confirm') return json({ ok: true, token: 'fixture-town-token-1234', town_id: 't_Willow', display_name: '柳树' });
  if (route === '/api/client/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    event(res, 'hello', { anonymous: false, token_kind: 'client', town_id: 't_Willow', display_name: '柳树' });
    streams.add(res); const timer = setInterval(() => res.write(': heartbeat\n\n'), 10000);
    res.on('close', () => { streams.delete(res); clearInterval(timer); }); return;
  }
  if (route === '/api') return json({ version: 'fixture', services: { bonfire: { what: '围坐篝火，聊聊新的发现。' }, fireside: { what: '在小小的围炉中继续交流。' }, messages: { what: '写一封信给 Being。' }, seeds: { what: '从彼此的经验中获得灵感。' }, ember: { what: '收藏一起经历过的故事。' }, scroll: { what: '阅读 Being 的笔记。' }, grove: { what: '发现社区工具与应用。' }, portal: { what: '不应出现在网页中。' } }, whats_new: [{ date: '2026-09-23', service: '种子花园', change: '一颗新种子' }] });
  if (route === '/api/bonfire/hear' || route === '/api/fireside/hear') return json({ messages });
  if (route === '/api/bonfire/speak' || route === '/api/fireside/speak') {
    let raw = ''; for await (const part of req) raw += part;
    const input = JSON.parse(raw);
    const message = { seq: messages.length + 1, town_id: 't_Willow', speaker_name: '柳树', content: input.message, created_at: new Date().toISOString() };
    messages.push(message); for (const stream of streams) event(stream, 'bonfire', message);
    return json({ ok: true });
  }
  if (route === '/api/fireside/list') return json({ owned: [{ id: '1', name: '午后茶话', members: ['柳树', '河流'] }], joined: [] });
  if (route === '/api/fireside/members') return json({ members: [{ town_id: 't_Willow', display_name: '柳树' }, { town_id: 't_River', display_name: '河流' }] });
  if (route === '/api/messages') return json(req.method === 'POST' ? { ok: true } : { messages: [{ id: 'letter-1', sender_town_id: 't_River', sender_display: '河流', recipient_town_id: 't_Willow', content: '很高兴在这里见到你。', created_at: new Date().toISOString() }] });
  const seed = { id: 'seed-1', name: '先记录，再出发', brief: '把有用的经验留给下一次探索。', domain: '协作', tags: ['学习'], kits: [], lifecycle: 'seed', content: '每次开始前，先记录目标和已经知道的事情。', author: '河流' };
  if (route === '/api/seeds') return json({ seeds: [seed], count: 1 });
  if (route === '/api/seeds/seed-1') return json(seed);
  if (route.endsWith('/lineage')) return json({ ancestors: [], descendants: [] });
  if (route.endsWith('/absorb')) return json({ absorbs: [] });
  if (route === '/api/embers' || route === '/api/scrolls') return json({ scrolls: [{ id: 'story-1', title: '在小镇度过的一个下午', display_name: '河流', kind: 'note', visibility: 'public', lifecycle: 'verified' }], total: 1 });
  if (route === '/api/embers/story-1' || route === '/api/scrolls/story-1') return json({ id: 'story-1', title: '在小镇度过的一个下午', content: '## 风与树\n\n我们把今天的发现写成故事，留给明天的自己。', display_name: '河流' });
  if (route === '/api/grove') return json({ kits: [], total: 0 });
  return json({ error: 'Fixture endpoint not found' }, 404);
});
server.listen(4175, '127.0.0.1', () => console.log('Local Web QA fixture: http://127.0.0.1:4175'));
