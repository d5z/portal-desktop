import { AnimatePresence } from 'motion/react';
import { DropdownMenuMotion, dropdownMenuPopover } from '../../shared/components/animate-ui/dropdown-menu-motion';
import { NavigationMenuMotion } from '../../shared/components/animate-ui/navigation-menu-motion';
import { clearMenuGlide, menuGlide } from '../../shared/components/react-bits/GlideSelectMotion';
import { Icon } from '../../shared/icons/icon';
import { useDismissAttachmentMenu } from './use-dismiss-attachment-menu';
import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { audioMenuPosition } from '../services/audio-menu-position';
import { MessageAction } from '../../shared/components/message-action-slot';

export type AudioMenuControls = {
  volume: number;
  speed: string;
  onVolumeChange(value: number): void;
  onSpeedChange(value: string): void;
};

/** A top-layer popover tracks its own trigger, independently of the message scroller. */
export function AttachmentAudioMenu({ name, children, controls }: { name: string; children: ReactNode; controls: AudioMenuControls }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const stackedRef = useRef(false);
  const pendingLayoutFocus = useRef<string | null>(null);
  const closeSpeed = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false), [position, setPosition] = useState<CSSProperties>({});
  const [stacked, setStacked] = useState(false), [speedOpen, setSpeedOpen] = useState(false);
  const keepSpeed = () => clearTimeout(closeSpeed.current);
  useEffect(() => keepSpeed, []);
  useDismissAttachmentMenu(open, [trigger, popup], () => {
    if (popup.current?.matches(':popover-open')) popup.current.hidePopover();
    setOpen(false);
  });
  const place = useCallback(() => {
    const button = trigger.current;
    if (!button) return;
    const menu = popup.current;
    const submenu = menu?.querySelector<HTMLElement>('.audio-speed-options:not([inert], [inert] *)');
    const bounds = button.getBoundingClientRect();
    const p = audioMenuPosition(bounds, { width: innerWidth, height: innerHeight },
      { height: menu?.offsetHeight || 196, submenuHeight: submenu?.offsetHeight || 236 });
    const nextStacked = p.side === 'stacked';
    if (stackedRef.current !== nextStacked) {
      stackedRef.current = nextStacked;
      pendingLayoutFocus.current = menu?.querySelector(':focus')?.getAttribute('data-audio-menu-focus') ?? null;
      setStacked(nextStacked);
    }
    const next = {
      left: p.left, top: p.top, width: p.width,
      transformOrigin: `${bounds.left + bounds.width / 2 - p.left}px ${p.top < bounds.top ? 'bottom' : 'top'}`,
      '--submenu-origin': p.submenuLeft < 0 ? 'right top' : 'left top',
      '--submenu-left': `${p.submenuLeft}px`, '--submenu-top': `${p.submenuTop}px`, '--submenu-width': `${p.submenuWidth}px`,
    } as CSSProperties;
    setPosition(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    place();
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; place(); }); };
    const messages = trigger.current?.closest('#messages');
    const mutation = new MutationObserver(schedule);
    if (messages) mutation.observe(messages, { subtree: true, childList: true, characterData: true });
    const resize = new ResizeObserver(schedule);
    if (popup.current) resize.observe(popup.current);
    document.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      mutation.disconnect();
      resize.disconnect();
      document.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [open, place]);

  useLayoutEffect(() => {
    const key = pendingLayoutFocus.current;
    pendingLayoutFocus.current = null;
    if (!key) return;
    const menu = popup.current;
    const target = Array.from(menu?.querySelectorAll<HTMLElement>('[data-audio-menu-focus]:not([inert] *)') || [])
      .find(node => node.dataset.audioMenuFocus === key && node.getClientRects().length);
    const fallback = stacked ? '.audio-speed-back' : '.audio-speed-options [aria-pressed="true"]';
    (target ?? menu?.querySelector<HTMLElement>(fallback))?.focus({ preventScroll: true });
  }, [stacked]);

  const returnToSpeed = () => {
    keepSpeed();
    flushSync(() => setSpeedOpen(false));
    // A stacked return can briefly leave two pages in the viewport.
    const button = popup.current?.querySelector<HTMLElement>('.audio-speed-toggle:not([inert] *)');
    button?.focus({ preventScroll: true });
  };
  const closeSpeedOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !speedOpen) return;
    event.preventDefault();
    event.stopPropagation();
    returnToSpeed();
  };
  const speedChoices = <>
    <span className="glide-select__pill" aria-hidden="true" />
    <button className="audio-speed-back" data-audio-menu-focus="back" type="button" onClick={returnToSpeed}>‹ 播放速度</button>
    {['0.5', '0.75', '1', '1.25', '1.5', '2'].map(value => <button key={value} type="button" data-audio-menu-focus={`rate-${value}`} aria-pressed={controls.speed === value} onClick={() => {
      controls.onSpeedChange(value);
      returnToSpeed();
    }}><span>{value}×</span></button>)}
  </>;
  const speedSurface = { className: 'audio-speed-options', role: 'group', 'aria-label': '播放速度', ...menuGlide };
  const main = <>
    <div className="audio-settings" onPointerEnter={keepSpeed} onPointerLeave={event => {
      const settings = event.currentTarget;
      if (event.pointerType !== 'mouse' || stacked) return;
      closeSpeed.current = setTimeout(() => {
        if (!settings.querySelector('.audio-speed-toggle:focus-visible, .audio-speed-options :focus-visible')) setSpeedOpen(false);
      }, 180);
    }} onKeyDown={closeSpeedOnEscape}>
      <label className="audio-volume"><Icon name="volume" /><input aria-label="音量" data-audio-menu-focus="volume" type="range" min="0" max="1" step="0.05"
        value={controls.volume} style={{ '--volume': `${controls.volume * 100}%` } as CSSProperties}
        onChange={event => controls.onVolumeChange(Number(event.target.value))} /></label>
      <button className="audio-speed-toggle" data-audio-menu-focus="speed" type="button" onPointerEnter={event => {
        if (event.pointerType !== 'mouse' || stacked) return;
        keepSpeed();
        setSpeedOpen(true);
      }} aria-expanded={speedOpen} onClick={event => {
        keepSpeed();
        if (event.detail === 0 || stacked) {
          flushSync(() => setSpeedOpen(true));
          const target = stacked ? '.audio-speed-back' : '.audio-speed-options [aria-pressed="true"]';
          popup.current?.querySelector<HTMLElement>(target + ':not([inert] *)')?.focus({ preventScroll: true });
        } else setSpeedOpen(true);
      }}><Icon name="chat-clock" /><span>速度</span><small>{controls.speed}×</small><Icon className="audio-speed-chevron" name="chat-chevron-right" /></button>
      {!stacked && <AnimatePresence>{speedOpen && <DropdownMenuMotion {...speedSurface}>{speedChoices}</DropdownMenuMotion>}</AnimatePresence>}
    </div>
    {children}
  </>;
  return <>
    <MessageAction><button ref={trigger} className="audio-menu-trigger" type="button" aria-label={`${name} 音频操作`} title="音频操作"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={id} onClick={event => {
        const menu: HTMLDivElement & { showPopover(options: { source: HTMLButtonElement }): void } = popup.current!;
        if (menu.matches(':popover-open')) return;
        event.preventDefault();
        // Set width and layout first. The native popover is measurable once shown.
        flushSync(place);
        menu.showPopover({ source: event.currentTarget });
        flushSync(place);
      }}><Icon name="sliders" width="16" height="16" /></button></MessageAction>
    {createPortal(<div ref={popup} id={id} popover="auto" className="audio-floating-menu" data-submenu-stacked={stacked || undefined}
      data-speed-page={stacked && speedOpen || undefined} style={position} {...menuGlide} {...dropdownMenuPopover} onToggle={event => {
        const next = event.currentTarget.matches(':popover-open');
        if (!next) {
          clearMenuGlide(event.currentTarget);
          keepSpeed();
          setSpeedOpen(false);
        }
        setOpen(next);
      }} onMouseDown={event => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('button');
        if (target) { event.preventDefault(); target.focus({ preventScroll: true }); }
      }}>
      <span className="glide-select__pill" aria-hidden="true" />
      {stacked ? <NavigationMenuMotion className="audio-speed-viewport" page={speedOpen ? 'speed' : 'main'} forward={speedOpen}>
        {speedOpen ? <div className="audio-settings" onKeyDown={closeSpeedOnEscape}>
          <div {...speedSurface}>{speedChoices}</div>
        </div> : main}
      </NavigationMenuMotion> : main}
    </div>, document.body)}
  </>;
}
