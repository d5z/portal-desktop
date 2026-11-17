import { CopySuccessText } from './copy-feedback';
import { hideMenuPopover, dropdownMenuPopover } from './animate-ui/dropdown-menu-motion';
import { Icon } from '../icons/icon';
import { clearMenuGlide, moveMenuGlide } from './react-bits/GlideSelectMotion';
import { ErrorIndicator } from './error-indicator';
import styles from './message-menu.module.scss';
import { useMenuDismiss } from '../hooks/use-menu-dismiss';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type KeyboardEvent,type MouseEvent} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {messageTimeLabel,fullMessageTime} from '../lib/message-time';
import { positionActionMenu } from '../lib/action-menu-position';

export type MessageInfo = {text:string; time?:number; fallbackTime?:string; hasExtraActions?: boolean};
export function useMessageMenu(copy:(text:string)=>Promise<void>,scope:string) {
  const [context,setContext]=useState<(MessageInfo & {x:number;y:number;portal:HTMLElement;opener:HTMLElement;anchorLeft:number;anchorTop:number;copyText:string;more:boolean})|null>(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState<{text:string;portal:HTMLElement}|null>(null);
  const menu=useRef<HTMLDivElement>(null),revision=useRef(0),current=useRef(context);
  const [closing,setClosing]=useState(false);
  const [attachmentTarget, setAttachmentTarget] = useState<HTMLDivElement | null>(null);
  current.current=context;
  const close=useCallback((restore=false)=>{
    ++revision.current;
    const opener=current.current?.opener;
    const exit = hideMenuPopover(menu.current);
    if(restore&&opener?.isConnected) opener.focus({preventScroll:true});
    if (exit) {
      setClosing(true);
      const closed = revision.current;
      void exit.finished.catch(() => {}).then(() => {
        if (revision.current === closed) { setClosing(false); setContext(null); }
      });
    } else {
      setClosing(false);
      setContext(null);
    }
  },[]);
  const showMenu=useCallback((opener:HTMLElement,info:MessageInfo,
    { point, more = false }: { point?: { x:number; y:number }; more?: boolean } = {})=>{
    if (more && current.current?.opener === opener && menu.current?.matches(':popover-open')) {
      close(true);
      return true;
    }
    const rect=opener.getBoundingClientRect(),selection=window.getSelection();
    const selected=selection?.anchorNode && selection.focusNode && opener.contains(selection.anchorNode) && opener.contains(selection.focusNode) ? selection.toString() : '';
    const copyText = more ? '' : selected || info.text;
    if (!copyText && !info.hasExtraActions) return false;
    ++revision.current;setError('');setNotice(null);setBusy(false);setClosing(false);
    setContext({...info,opener,anchorLeft:rect.left,anchorTop:rect.top,portal:opener.closest<HTMLElement>('dialog[open]')||document.body,copyText,more,
      x:point?.x??rect.left+Math.min(24,rect.width),y:point?.y??rect.top+Math.min(24,rect.height)});
    return true;
  },[close]);
  const openMenu=useCallback((event:MouseEvent<HTMLElement>|KeyboardEvent<HTMLElement>,info:MessageInfo)=>{
    if ('key' in event && !(event.key==='ContextMenu'||event.key==='F10'&&event.shiftKey)) return;
    if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('input,textarea,button,a,summary,select,[role=button],[data-local-file],[contenteditable=true]'))) return;
    if (showMenu(event.currentTarget, info, { point: 'clientX' in event ? {x:event.clientX,y:event.clientY} : undefined })) {
      event.preventDefault();event.stopPropagation();
    }
  },[showMenu]);
  useEffect(()=>{close();},[scope,close]);
  useMenuDismiss(!!context && !closing, menu, close, () => {
    if (!context) return;
    const rect = context.opener.getBoundingClientRect();
    if (!context.opener.isConnected || Math.abs(rect.left - context.anchorLeft) > 1 || Math.abs(rect.top - context.anchorTop) > 1) close();
  }, context?.more ? context.opener : undefined);
  useLayoutEffect(()=>{
    const node=menu.current;if(!node||!context)return;
    node.showPopover();
    const place = () => {
      if (context.more) { positionActionMenu(context.opener, node); return; }
      const left = Math.max(8,Math.min(context.x,innerWidth-node.offsetWidth-8));
      const top = Math.max(8,Math.min(context.y,innerHeight-node.offsetHeight-8));
      node.style.left = `${left}px`;
      node.style.top = `${top}px`;
      node.style.transformOrigin = `${context.x - left}px ${context.y - top}px`;
    };
    place();
    (node.querySelector<HTMLButtonElement>('button:not(:disabled)')||node).focus({preventScroll:true});
    // Attachment groups render through portals. Handle keys on the shared DOM menu.
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    const dismissEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !node.matches(':popover-open') || !(event.target instanceof Node) ||
          (event.target !== document.body && !node.contains(event.target))) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    const navigate = (event: globalThis.KeyboardEvent) => {
      if (!['Tab', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.stopPropagation();
      if (event.key === 'Tab') { flushSync(() => close(true)); return; }
      event.preventDefault();
      const items = [...node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowUp' && index < 0 ? items.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    };
    // Disabling a focused file action can return focus to the document while the menu remains open.
    document.addEventListener('keydown', dismissEscape, { ...options, capture: true });
    node.addEventListener('keydown', navigate, options);
    node.addEventListener('pointerover', event => {
      if (event.pointerType === 'mouse') moveMenuGlide(node, event.target);
    }, options);
    node.addEventListener('pointerleave', () => clearMenuGlide(node), options);
    node.addEventListener('focusin', event => {
      if (event.target instanceof Element && event.target.matches(':focus-visible')) clearMenuGlide(node);
    }, options);
    node.addEventListener('focusout', event => {
      if (!(event.relatedTarget instanceof Node) || !node.contains(event.relatedTarget)) clearMenuGlide(node);
    }, options);
    const resize = context.hasExtraActions ? new ResizeObserver(() => {
      if (!node.matches(':popover-open')) return;
      if (!context.opener.isConnected) { close(); return; }
      place();
      if (document.activeElement === node) node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
    }) : undefined;
    resize?.observe(node);
    return () => {
      listeners.abort();
      resize?.disconnect();
      if (node.matches(':popover-open')) node.hidePopover();
    };
  },[context,close]);
  useLayoutEffect(()=>{if(error)menu.current?.querySelector<HTMLButtonElement>('button')?.focus({preventScroll:true});},[error]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(null),2200);return()=>clearTimeout(timer);},[notice]);
  const copyValue=async(text:string)=>{
    if(busy)return;const request=revision.current;setBusy(true);setError('');
    try{await copy(text);if(request===revision.current){setBusy(false);setNotice({text:'已复制',portal:current.current?.portal||document.body});close(true);}}catch{if(request===revision.current)setError('复制失败，请重试。');}finally{if(request===revision.current)setBusy(false);}
  };
  const timestamp=context && !context.more ? fullMessageTime(context.time,context.fallbackTime) : '';
  const shortTime=context?.time!==undefined&&Number.isFinite(new Date(context.time).getTime())?messageTimeLabel(context.time):timestamp;
  const content=context&&createPortal(<div ref={menu} popover="manual" {...dropdownMenuPopover} className={styles.menu} role="menu" tabIndex={-1} aria-label="消息操作" aria-busy={busy||undefined} style={{left:context.x,top:context.y}}
    inert={closing} aria-hidden={closing || undefined} data-extra-actions={context.more || undefined} data-attachment-glide>
    <span className="glide-select__pill" aria-hidden="true" />
    {timestamp&&<div className={styles.info}><time title={timestamp} dateTime={context.time!==undefined&&Number.isFinite(new Date(context.time).getTime())?new Date(context.time).toISOString():undefined}>{shortTime}</time></div>}
    {error ? <ErrorIndicator description={error} retry={{ label: '重新复制', disabled: busy, run: () => void copyValue(context.copyText) }} />
      : context.copyText && <button role="menuitem" type="button" disabled={busy} onClick={()=>void copyValue(context.copyText)}><Icon name="chat-copy"/>复制</button>}
    {context.hasExtraActions && <div ref={setAttachmentTarget} className={styles.attachments} />}
  </div>,context.portal);
  return {openMenu,showMenu,opener:closing ? undefined : context?.opener,attachmentOpener:context?.opener,attachmentTarget,closeMenu:close,isOpen:!!context && !closing,menu:<>{content}{notice&&createPortal(<div className={styles.notice} role="status"><CopySuccessText>{notice.text}</CopySuccessText></div>,notice.portal)}</>};
}
