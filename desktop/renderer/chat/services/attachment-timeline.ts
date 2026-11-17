import type {ChatItem,Message} from '../models/chat';
/** Supplemental Gateway rows have no Heart sequence; merge them without reordering Heart history or live runs. */
export function attachmentTimeline(items:ChatItem[]):ChatItem[] {
  const supplemental=(item:ChatItem):item is Message=>item.kind==='message' && !item.historySeq && !item.queued && String(item.id || '').startsWith('attachment-') && Number.isFinite(item.createdAt);
  const pending=items.filter(supplemental).sort((a,b)=>a.createdAt!-b.createdAt!);
  if(!pending.length)return items;
  const ordered=items.filter((item):boolean=>!supplemental(item));
  for(const message of pending){
    let index=ordered.findIndex(item=>item.kind==='message' && Number.isFinite(item.createdAt) && item.createdAt!>message.createdAt!);
    if(index<0)index=ordered.length;
    // Keep the next history message's separator with that message.
    while(index>0 && ordered[index-1].kind==='separator')index--;
    ordered.splice(index,0,message);
  }
  return ordered;
}
