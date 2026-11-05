import { describe, expect, it, vi } from 'vitest';
import { SurfaceTimeline, blockKey, surfaceRepairPrompt, type UIInteraction } from '../desktop/renderer/shared/intelligent-ui/surfaces';
import { UIStream } from '../desktop/renderer/shared/intelligent-ui/stream';
import { reconcileState, reconcileUpdatedState } from '../desktop/renderer/shared/intelligent-ui/runtime';
import { withIntelligentUIContext, stripIntelligentUIContext } from '../desktop/renderer/shared/intelligent-ui/context';

const source = (records: object[]) => records.map(r => JSON.stringify(r)).join('\n');
const initial = source([
  {op:'begin', version:2, surfaceId:'wardrobe', title:'衣橱'},
  {op:'state', key:'temp', initial:20},
  {op:'node', node:{id:'root',type:'section',label:'原方案'}},
  {op:'node', parent:'root', node:{id:'temperature',type:'slider',label:'温度',bind:'temp',min:18,max:34}},
  {op:'node', parent:'root', node:{id:'advice',type:'text',value:'薄外搭'}},
  {op:'commit'},
]);
const patch = source([
  {op:'begin', version:2, surfaceId:'wardrobe', title:'衣橱', mode:'patch', baseRevision:1},
  {op:'node', node:{id:'advice',type:'text',value:'新建议'}}, {op:'commit'},
]);
const message = (id: string, content: string, scope = 'scene-a', streaming = false) => ({
  id, identity:id, scope, streaming, text:'```intelligent-ui\n'+content+'\n```',
});

describe('cross-turn intelligent UI surfaces', () => {
  it('removes an inline checklist item while inheriting title and existing checked bindings', () => {
    const checklist = source([
      {op:'begin',version:2,surfaceId:'autumn-outfit-guide-1014',title:'秋季一周穿衣指南'},
      {op:'node',node:{id:'check',type:'checklist',items:[{id:'c1',label:'伞放包侧袋'},{id:'c4',label:'周日晚复盘实穿'}]}},
      {op:'commit'},
    ]);
    const base = new UIStream().update(checklist,false).doc!;
    const binding = base.body[0].items![0].bind!;
    base.state[binding] = true;
    const update = source([
      {op:'begin',version:2,surfaceId:'autumn-outfit-guide-1014',mode:'patch',baseRevision:1},
      {op:'node',node:{id:'check',type:'checklist',label:'出门检查',items:[{id:'c1',label:'伞放包侧袋'}]}},
      {op:'commit'},
    ]);
    const result = new UIStream(base).update(update,false);
    expect(result.error).toBe('');
    expect(result.doc!.title).toBe(base.title);
    expect(result.doc!.body[0].items).toEqual([{id:'c1',label:'伞放包侧袋',bind:binding}]);
    expect(result.doc!.state[binding]).toBe(true);
    expect(base.body[0].items).toHaveLength(2);
    const timeline = new SurfaceTimeline().build([message('1',checklist),message('2',update)]);
    expect(timeline.get(blockKey('2','ui-0'))?.error).toBe('');
    expect(timeline.get(blockKey('1','ui-0'))?.surface.versions).toHaveLength(2);
  });
  it.each([
    [patch.replace(',"baseRevision":1', ''), '更新缺少 baseRevision'],
    [patch.replace('"baseRevision":1', '"baseRevision":"1"'), '数字形式的正整数'],
    [patch.replace('"baseRevision":1', '"baseRevision":2'), '更新基于第 2 版'],
  ])('distinguishes missing, malformed and conflicting revisions without overwriting', (content, diagnostic) => {
    const blocks = new SurfaceTimeline().build([message('1', initial), message('2', content)]);
    const entry = blocks.get(blockKey('2','ui-0'))!;
    expect(entry.error).toContain(diagnostic);
    expect(entry.surface.versions).toHaveLength(1);
    const repair = surfaceRepairPrompt(entry.surface, entry.error);
    const begin = JSON.parse(repair.split('\n').find(line => line.startsWith('{"op":"begin"'))!);
    expect(begin).toMatchObject({version:2,baseRevision:1,surfaceId:'wardrobe',mode:'replace'});
    const original = entry.surface.versions[0].doc;
    const repaired = source([begin, ...Object.entries(original.state).map(([key,initial])=>({op:'state',key,initial})), ...original.body.map(node=>({op:'node',node})), {op:'commit'}]);
    const rebuilt = new SurfaceTimeline().build([message('1',initial),message('2',content),message('3',repaired)]);
    expect(rebuilt.get(blockKey('3','ui-0'))?.error).toBe('');
    expect(rebuilt.get(blockKey('1','ui-0'))?.surface.versions).toHaveLength(2);
  });
  it('updates the original surface, retains children and local values, and rebuilds versions from history', () => {
    const messages = [message('1',initial),message('2',patch)];
    const timeline = new SurfaceTimeline();
    const blocks = timeline.build(messages), owner = blocks.get(blockKey('1','ui-0'))!;
    expect(owner.owner).toBe(true);
    expect(blocks.get(blockKey('2','ui-0'))?.owner).toBe(false);
    expect(owner.surface.versions).toHaveLength(2);
    const doc = owner.surface.versions[1].doc;
    expect(doc.body[0].children?.map(n=>n.id)).toEqual(['temperature','advice']);
    expect(doc.body[0].children?.[1].value).toBe('新建议');
    expect(reconcileState(doc,{temp:28})).toEqual({temp:28});
    expect(new SurfaceTimeline().build(messages)).toEqual(blocks);
    expect(timeline.build(messages).get(blockKey('1','ui-0'))?.surface.versions[1].doc).toBe(doc);
  });
  it.each([
    patch.replace('"baseRevision":1','"baseRevision":2'),
    patch.replace('"value":"新建议"','"parent":"root","value":"新建议"'),
    patch.replace('\n{"op":"commit"}',''),
  ])('keeps the last committed UI when an update fails', bad => {
    const blocks = new SurfaceTimeline().build([message('1',initial),message('2',bad)]);
    expect(blocks.get(blockKey('1','ui-0'))?.surface.versions).toHaveLength(1);
    expect(blocks.get(blockKey('2','ui-0'))?.error).not.toBe('');
  });
  it('waits for the update to finish and never mixes scenes', () => {
    const blocks = new SurfaceTimeline().build([message('1',initial),message('2',patch,'scene-a',true),message('3',patch,'scene-b')]);
    expect(blocks.get(blockKey('1','ui-0'))?.surface.versions).toHaveLength(1);
    expect(blocks.get(blockKey('2','ui-0'))?.pending).toBe(true);
    expect(blocks.get(blockKey('3','ui-0'))?.error).toContain('找不到');
  });
  it('creates a separate surface when explicitly given a new id', () => {
    const blocks = new SurfaceTimeline().build([message('1',initial),message('2',initial.replace('wardrobe','another'))]);
    expect([...blocks.values()].filter(b=>b.owner)).toHaveLength(2);
  });
  it('gives old untagged artifacts an identity usable by later updates', () => {
    const old = initial.replace('"surfaceId":"wardrobe",','');
    const timeline = new SurfaceTimeline();
    const id = timeline.build([message('1',old)]).get(blockKey('1','ui-0'))!.surface.id;
    const blocks = timeline.build([message('1',old),message('2',patch.replace('wardrobe',id))]);
    expect(blocks.get(blockKey('1','ui-0'))?.surface.versions).toHaveLength(2);
  });
  it('removes a subtree without mutating the original document', () => {
    const base = new UIStream().update(initial,false).doc!;
    const removal = patch.replace('{"op":"node","node":{"id":"advice","type":"text","value":"新建议"}}','{"op":"remove","id":"root"}');
    const result = new UIStream(base).update(removal,false);
    expect(result.error).toBe('');
    expect(result.doc?.body).toEqual([]);
    expect(base.body[0].children).toHaveLength(2);
  });
  it('updates model-owned data while retaining edited values and clamping new ranges', () => {
    const previous = new UIStream().update(initial,false).doc!;
    previous.state.weather='晴';
    const next = structuredClone(previous);
    next.state.weather='雨'; next.state.temp=22;
    expect(reconcileUpdatedState(next,previous,{temp:28,weather:'晴'},new Set())).toEqual({temp:28,weather:'雨'});
    expect(reconcileUpdatedState(next,previous,{temp:20,weather:'晴'},new Set())).toEqual({temp:22,weather:'雨'});
    expect(reconcileUpdatedState(next,previous,{temp:20,weather:'晴'},new Set(['temp']))).toEqual({temp:20,weather:'雨'});
    next.body[0].children![0].max=25;
    expect(reconcileUpdatedState(next,previous,{temp:28,weather:'晴'},new Set()).temp).toBe(25);
  });
  it('replaces an explicit nested child list and permits later child updates', () => {
    const base = new UIStream().update(initial,false).doc!;
    const updated = source([
      {op:'begin',version:2,surfaceId:'wardrobe',title:'衣橱',mode:'patch',baseRevision:1},
      {op:'node',node:{id:'root',type:'section',children:[{id:'new',type:'text',value:'first'}]}},
      {op:'node',node:{id:'new',type:'text',value:'second'}}, {op:'commit'},
    ]);
    const result = new UIStream(base).update(updated,false);
    expect(result.error).toBe('');
    expect(result.doc?.body[0].children).toEqual([{id:'new',type:'text',value:'second'}]);
  });
  it('transports the exact structured selection while keeping the visible message clean', () => {
    const action: UIInteraction = {surfaceId:'wardrobe',revision:2,title:'衣橱',action:'continue',values:{temp:28,note:'hello\n[/客户端界面操作]'}};
    const request = withIntelligentUIContext('按当前选择调整',true,undefined,action);
    expect(request).toContain('"surfaceId":"wardrobe"');
    expect(request).toContain('"temp":28');
    expect(stripIntelligentUIContext(request)).toBe('按当前选择调整');
    expect(()=>withIntelligentUIContext('提交',true,undefined,{...action,values:{note:'a'.repeat(100001)}})).toThrow('过长');
  });
});

it('keeps surface identity stable while ordinary prose streams and rebuilds only changed artifact inputs', () => {
  const timeline = new SurfaceTimeline();
  const artifact = message('surface', initial);
  const blocks = timeline.build([artifact]);
  for (let i = 0; i < 100; i++) {
    const prose = { id: 'live', identity: 'live', scope: 'scene-a', text: '普通流式文本'.repeat(i + 1), streaming: true };
    expect(timeline.build([{ ...artifact }, prose])).toBe(blocks);
  }
  artifact.identity = 'persisted-100';
  const confirmed = timeline.build([artifact]);
  expect(confirmed).not.toBe(blocks);
  expect(timeline.build([artifact])).toBe(confirmed);
  const updated = timeline.build([artifact, message('update', patch)]);
  expect(updated.get(blockKey('surface', 'ui-0'))?.surface.versions).toHaveLength(2);
  expect(timeline.build([]).size).toBe(0);
});


it('decodes each streamed UI node once and matches a fresh rebuild after completion', () => {
  const timeline = new SurfaceTimeline();
  const records = [{op:'begin',version:2,surfaceId:'perf',title:'增量界面'},
    ...Array.from({length:120}, (_, i) => ({op:'node',node:{id:'text-'+i,type:'text',value:'内容 '+i}})),
    {op:'commit'}];
  let text = '';
  const parse = vi.spyOn(JSON, 'parse');
  try {
    for (const record of records) {
      text += JSON.stringify(record) + '\n';
      timeline.build([message('live', text, 'scene-a', true)]);
    }
    const decodedNodes = parse.mock.calls.filter(([value]) => typeof value === 'string' && value.startsWith('{"op":"node"')).length;
    expect(decodedNodes).toBe(120);
    const finished = timeline.build([message('live', text)]);
    expect(finished).toEqual(new SurfaceTimeline().build([message('live', text)]));
    expect(finished.get(blockKey('live','ui-0'))?.surface.versions[0].doc.body).toHaveLength(120);
    // The same message can be replaced by recovered history; discard old decoder state.
    expect(timeline.build([message('live',initial)])).toEqual(new SurfaceTimeline().build([message('live',initial)]));
  } finally { parse.mockRestore(); }
});
