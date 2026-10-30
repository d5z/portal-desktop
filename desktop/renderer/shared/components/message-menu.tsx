import { useMenuDismiss } from '../hooks/use-menu-dismiss';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent,type MouseEvent} from 'react';
import {createPortal} from 'react-dom';
import {messageTimeLabel} from '../models/message-time';

export type MessageInfo = {text:string; time?:number; fallbackTime?:string};
export function fullMessageTime(time?:number, fallback='') {
  return time !== undefined && Number.isFinite(new Date(time).getTime()) ? new Date(time).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : fallback;
}
export function useMessageMenu(copy:(text:string)=>Promise<void>,scope:string) {
  const [context,setContext]=useState<(MessageInfo & {x:number;y:number;portal:HTMLElement;opener:HTMLElement;anchorLeft:number;anchorTop:number;selected:string})|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState<{text:string;portal:HTMLElement}|null>(null);
  const menu=useRef<HTMLDivElement>(null),revision=useRef(0),current=useRef(context);
  current.current=context;
  const close=useCallback((restore=false)=>{++revision.current;const opener=current.current?.opener;if(restore&&opener?.isConnected)opener.focus({preventScroll:true});setContext(null);},[]);
  const openMenu=useCallback((event:MouseEvent<HTMLElement>|KeyboardEvent<HTMLElement>,info:MessageInfo)=>{
    if ('key' in event && !(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)) return;
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('input,textarea,button,a,summary,select,[role=button],[data-local-file],[contenteditable=true]'))) return;
    event.preventDefault();event.stopPropagation();
    const opener=event.currentTarget,rect=opener.getBoundingClientRect(),selection=window.getSelection();
    const selected=selection?.anchorNode && selection.focusNode && opener.contains(selection.anchorNode) && opener.contains(selection.focusNode) ? selection.toString() : '';
    ++revision.current;setError('');setNotice(null);setBusy(false);
    setContext({...info,opener,anchorLeft:rect.left,anchorTop:rect.top,portal:opener.closest<HTMLElement>('dialog[open]')||document.body,selected,
      x:'clientX' in event?event.clientX:rect.left+Math.min(24,rect.width),y:'clientY' in event?event.clientY:rect.top+Math.min(24,rect.height)});
  },[]);
  useEffect(()=>{close();},[scope,close]);
  useMenuDismiss(!!context, menu, close, () => {
    if (!context) return;
    const rect = context.opener.getBoundingClientRect();
    if (Math.abs(rect.left - context.anchorLeft) > 1 || Math.abs(rect.top - context.anchorTop) > 1) close();
  });
  useLayoutEffect(()=>{
    const node=menu.current;if(!node||!context)return;
    node.showPopover();const rect=node.getBoundingClientRect();
    node.style.left=`${Math.max(8,Math.min(context.x,innerWidth-rect.width-8))}px`;
    node.style.top=`${Math.max(8,Math.min(context.y,innerHeight-rect.height-8))}px`;
    (node.querySelector<HTMLButtonElement>('button:not(:disabled)')||node).focus({preventScroll:true});
    return () => { if (node.matches(':popover-open')) node.hidePopover(); };
  },[context]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),2200);return()=>clearTimeout(timer);},[notice]);
  const copyValue=async(text:string)=>{
    if(busy)return;const request=revision.current;setBusy(true);setError('');
    try{await copy(text);if(request===revision.current){setBusy(false);setNotice({text:'已复制',portal:current.current?.portal||document.body});close(true);}}catch{if(request===revision.current)setError('复制失败，请重试。');}finally{if(request===revision.current)setBusy(false);}
  };
  const timestamp=context?fullMessageTime(context.time,context.fallbackTime):'';
  const shortTime=context?.time!==undefined&&Number.isFinite(new Date(context.time).getTime())?messageTimeLabel(context.time):timestamp;
  const content=context&&createPortal(<div ref={menu} popover="manual" className="message-context-menu" role="menu" tabIndex={-1} aria-label="消息操作" aria-busy={busy||undefined} style={{left:context.x,top:context.y}}
    onKeyDown={event=>{
      event.stopPropagation();
      if(event.key==='Escape'||event.key==='Tab'){event.preventDefault();close(true);return;}
      if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
      event.preventDefault();const items=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index=items.indexOf(document.activeElement as HTMLButtonElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length;
      items[next]?.focus();
    }}>
    {timestamp&&<div className="message-menu-info"><time title={timestamp} dateTime={context.time!==undefined&&Number.isFinite(new Date(context.time).getTime())?new Date(context.time).toISOString():undefined}>{shortTime}</time></div>}
    <button role="menuitem" type="button" disabled={busy||!(context.selected||context.text)} onClick={()=>void copyValue(context.selected||context.text)}><CopyIcon/>复制</button>
    {error&&<p className="message-menu-error" role="alert">{error}</p>}
  </div>,context.portal);
  return {openMenu,closeMenu:close,isOpen:!!context,menu:<>{content}{notice&&createPortal(<div className="message-menu-notice" role="status">{notice.text}</div>,notice.portal)}</>};
}
function CopyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="12" height="13" rx="3"/><path d="M9 8V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-2"/></svg>;
}
