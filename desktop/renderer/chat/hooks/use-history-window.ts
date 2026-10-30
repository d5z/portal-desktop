import {useLayoutEffect,useRef,useState} from 'react';
import type {ChatItem} from '../models/chat';
export const HISTORY_WINDOW_PAGE=40;
export function historyWindowStart(items:ChatItem[],firstId?:string) {
  const found=firstId?items.findIndex(item=>item.id===firstId):-1;
  const pageStart=Math.max(0,items.length-HISTORY_WINDOW_PAGE);
  // The global cache may paint just one row from this scene before its own
  // cache arrives. Fill at least a page instead of pinning that partial seed.
  return found>=0?Math.min(found,pageStart):pageStart;
}
export function historyRevealStart(items:ChatItem[],firstId:string|undefined,id:string) {
  const index=items.findIndex(item=>item.id===id);
  return index<0?historyWindowStart(items,firstId):Math.min(historyWindowStart(items,firstId),Math.max(0,index-10));
}
/** Once exposed, the first row stays fixed as new live messages arrive. */
export function useHistoryWindow(items:ChatItem[],scope:string,loadOlder:(before?:number)=>Promise<number>) {
  const [windows,setWindows]=useState<Record<string,string>>({});
  const [exhausted,setExhausted]=useState<Record<string,boolean>>({});
  const [loading,setLoading]=useState(false),pending=useRef(false);
  const boundary=useRef<{scope:string;id?:string}|null>(null);
  const latest=useRef(items);latest.current=items;
  const currentScope=useRef(scope);currentScope.current=scope;
  const start=historyWindowStart(items,windows[scope]);
  // Save a stable boundary without dropping the user's reading position as messages arrive.
  if(items.length && windows[scope]!==items[start].id)setWindows(old=>({...old,[scope]:items[start].id}));
  async function more() {
    if(pending.current || (start===0 && exhausted[scope]))return;
    if (start > 0) {
      // Commit an in-memory page directly; toggling loading true/false in one
      // event is batched away by React and would leave the page unrevealed.
      setWindows(old=>({...old,[scope]:items[Math.max(0,start-HISTORY_WINDOW_PAGE)].id}));
      return;
    }
    pending.current=true;setLoading(true);
    try {
      // Rows already in memory can be exposed before the next paint. Waiting
      // two frames here leaves fast upward scrolling at an empty boundary.
      if(currentScope.current!==scope)return;
      const previous=items[start]?.id;
      boundary.current={scope,id:previous};
      if(start===0){
        const first=items.find(item=>item.kind==='message' && item.historySeq);
        const count=await loadOlder(first?.kind==='message'?first.historySeq:undefined);
        if(count===0)setExhausted(old=>({...old,[scope]:true}));
      }

    }finally{pending.current=false;setLoading(false);}
  }
  useLayoutEffect(()=>{
    if(loading || !boundary.current)return;
    const saved=boundary.current;boundary.current=null;
    if(saved.scope!==scope)return;
    const oldIndex=items.findIndex(item=>item.id===saved.id);
    const next=items[Math.max(0,oldIndex-HISTORY_WINDOW_PAGE)];
    if(next)setWindows(old=>({...old,[scope]:next.id}));
  },[items,loading,scope]);
  function reveal(id:string) {
    const index=latest.current.findIndex(item=>item.id===id);
    if(index>=0)setWindows(old=>({...old,[scope]:latest.current[historyRevealStart(latest.current,old[scope],id)].id}));
  }
  function toLatest() {
    // A late older-page result must not reopen history after explicit navigation to the latest messages.
    boundary.current=null;
    const first=latest.current[Math.max(0,latest.current.length-HISTORY_WINDOW_PAGE)];
    if(first)setWindows(old=>old[scope]===first.id?old:{...old,[scope]:first.id});
  }
  return {items:items.slice(start),more,reveal,toLatest,loading,hasMore:start>0 || !exhausted[scope]};
}
