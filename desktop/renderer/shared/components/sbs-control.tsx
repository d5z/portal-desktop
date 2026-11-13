import {useDisclosurePresence} from "../hooks/use-disclosure-presence";
import styles from './sbs-control.module.scss';
import {createPortal} from 'react-dom';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';

export function SbsControl({known, enabled, origin, phase, showContent, allScenes, visibilityReady = true, onVisibility, onToggle, name}: {
  name?:string;
  known:boolean; enabled:boolean; origin?:string; phase?:string; showContent:boolean; allScenes:boolean;
  visibilityReady?:boolean; onVisibility:(show:boolean)=>void; onToggle:()=>void;
}) {
  const trigger=useRef<HTMLButtonElement>(null), panel=useRef<HTMLDivElement>(null), id=useId();
  const [open,setOpen]=useState(false), [position,setPosition]=useState({top:0,left:0});
  const present=useDisclosurePresence(open);
  const idle=known && !origin;
  const status=origin ? phase==='working' ? '正在执行工具' : phase==='replying' ? '正在整理回复'
    : phase==='thinking' ? '正在思考' : '正在执行回调'
    : !known ? 'SBS 状态同步中' : enabled ? 'SBS 待命中' : 'SBS 已关闭';
  const close=()=>{setOpen(false);trigger.current?.focus();};
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const rect=trigger.current?.getBoundingClientRect(); if(!rect)return;
      const width=Math.min(320,window.innerWidth-24);
      const height=panel.current?.offsetHeight || 280;
      setPosition({left:Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),
        top:Math.max(12,Math.min(rect.bottom+10,window.innerHeight-height-12))});
    };
    place();panel.current?.focus();
    const observer=new ResizeObserver(place);if(panel.current)observer.observe(panel.current);
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
  },[open]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:Event)=>{
      if(!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node))setOpen(false);
    };
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus();event.stopPropagation();}};
    const blur=()=>setOpen(false);
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    document.addEventListener('focusin',outside);
    window.addEventListener('blur',blur);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);document.removeEventListener('focusin',outside);window.removeEventListener('blur',blur);};
  },[open]);
  return <div className={styles.root}>
    <button ref={trigger} type="button" className={`${styles.trigger}${name ? ` ${styles.identity}` : ""}`} data-idle={idle} aria-label="SBS 状态与显示设置"
      aria-controls={open?id:undefined} aria-expanded={open} aria-haspopup="dialog" title={status} onClick={()=>setOpen(value=>!value)}>
      {name ? <>
        <span className={styles.identityName}>
          <span className={styles.dot} data-enabled={known && enabled} data-active={!!origin} aria-hidden="true" />
          <span id="conversation-name" className={styles.name}>{name}</span>
        </span>
        {!idle && <span className={styles.inlineStatus} role="status" aria-live="polite" aria-label={status}>
          <span>{status.replace(/^SBS /, '')}</span>
        </span>}
      </> : <span className={styles.dot} data-enabled={known && enabled} data-active={!!origin} aria-hidden="true" />}
    </button>
    {!name && origin && <span className={styles.active} role="status" aria-live="polite"><span>{origin==='callback' ? 'SBS 回调' : 'SBS 活动'}</span>{status}</span>}
    {present && createPortal(<div ref={panel} id={id} className={styles.panel} data-open={open} inert={!open} aria-hidden={!open} role="dialog" aria-labelledby={id+'-title'} tabIndex={-1} style={position}
      onBlur={event=>{
        if(!event.currentTarget.contains(event.relatedTarget) && !trigger.current?.contains(event.relatedTarget))setOpen(false);
      }}>
      <div className={styles.heading}><strong id={id+'-title'}>SBS 自主活动</strong><button type="button" aria-label="关闭 SBS 设置" onClick={close}>×</button></div>
      <div className={styles.status} data-active={!!origin}>
        <span className={styles.dot} data-enabled={known && enabled} data-active={!!origin} aria-hidden="true" />
        <div><strong role="status">{status}</strong><small>{origin ? origin==='callback' ? '正在处理自主回调' : '正在处理自主活动' : '运行状态始终显示在对话顶部'}</small></div>
      </div>
      <label className={styles.option}><span>显示 SBS 消息正文<small>仅影响当前场景，思考状态统一在顶部显示</small></span>
        <input type="checkbox" role="switch" checked={allScenes || showContent} disabled={!visibilityReady || allScenes}
          onChange={event=>onVisibility(event.target.checked)} /></label>
      {allScenes && <p className={styles.note}>全部场景包含 SBS 正文；切回当前场景后恢复此场景的显示设置。</p>}
      <label className={styles.option}><span>自主醒来<small>控制 SBS 是否主动开始任务</small></span>
        <input type="checkbox" role="switch" checked={enabled} disabled={!known} onChange={onToggle} /></label>
    </div>,document.body)}
  </div>;
}
