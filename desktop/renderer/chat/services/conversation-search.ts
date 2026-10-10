import type { HistoryMessage } from './history-cache';
import { messageScene, stripSceneTransition } from '../models/scenes';
export interface SearchEntry { id: string; text: string; sceneId: string; sceneLabel: string; role: string; at: string }
export function searchEntries(rows: HistoryMessage[], query: string): SearchEntry[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  return rows.filter(row => ['user','being','assistant'].includes(row.role)).flatMap(row => {
    const text = stripSceneTransition(row.content || ''), position = text.toLocaleLowerCase().indexOf(needle);
    if (position < 0) return [];
    const scene = messageScene(row), start = Math.max(0, position - 55);
    return [{id:`history-${row.seq}`, text:(start ? '…' : '') + text.slice(start, start + Math.max(220, needle.length)) + (text.length > start + Math.max(220,needle.length) ? '…' : ''), sceneId:scene.sceneId || '', sceneLabel:scene.sceneLabel || '', role:row.role, at:row.at || ''}];
  }).reverse().slice(0,200);
}
export class ConversationSearch {
  rows: HistoryMessage[] = [];
  private cursor = 0;
  private loading?: Promise<void>;
  constructor(private request: (path:string, init?:RequestInit)=>Promise<Response>) {}
  async sync(signal: AbortSignal, progress: ()=>void) {
    if (this.loading) return this.loading;
    this.loading = (async()=>{
      while (!signal.aborted) {
        const response = await this.request(`/api/history?limit=500&after=${this.cursor}`, {signal:AbortSignal.any([signal,AbortSignal.timeout(15000)]),cache:'no-store'});
        if (!response.ok) throw new Error('历史记录读取失败');
        const data = await response.json();
        const page = (Array.isArray(data.messages) ? data.messages : []).filter((row:HistoryMessage)=>Number.isSafeInteger(row?.seq) && row.seq > this.cursor && typeof row.content === 'string');
        if (!page.length) break;
        this.rows.push(...page);
        this.rows.sort((a,b)=>a.seq-b.seq);
        this.cursor = Math.max(...page.map((row:HistoryMessage)=>row.seq));
        progress();
      }
    })().finally(()=>{this.loading=undefined;});
    return this.loading;
  }
}
