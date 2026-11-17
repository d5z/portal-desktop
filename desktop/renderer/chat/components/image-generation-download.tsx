import { ChatStatusRow } from './status-row';
import { Icon } from '../../shared/icons/icon';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_REMOTE_IMAGE_BYTES, REMOTE_IMAGE_MIME, remoteImageName, remoteImageSource } from '../../../shared/remote-image';
import { ChatActionTooltip } from '../../shared/components/chat-action-tooltip';
import { MessageAction, MessageActionSlot } from '../../shared/components/message-action-slot';

export function ImageGenerationDownload({src, name, inMenu}: {src:string; name:string; inMenu:boolean}) {
  const slot = useContext(MessageActionSlot);
  const register = slot?.registerExtraActions;
  const pending = useRef<AbortController | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => inMenu && !failed ? register?.() : undefined, [failed, inMenu, register]);
  useEffect(() => () => { pending.current?.abort(); }, [src]);
  async function download() {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    setSaving(true); setFailed(false);
    try {
      const response = await fetch(remoteImageSource(src, location.protocol === 'beings:'), {
        signal:AbortSignal.any([controller.signal, AbortSignal.timeout(65000)]), credentials:'omit',
      });
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_REMOTE_IMAGE_BYTES) throw new Error('Download unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (!blob.size || !REMOTE_IMAGE_MIME.test(blob.type) || blob.size > MAX_REMOTE_IMAGE_BYTES) throw new Error('Invalid image');
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = remoteImageName(name, blob.type);
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  }
  if (failed) return <ChatStatusRow title="原图下载失败" detail={name} tone="error" inActions
    retry={{ label: `重新下载 ${name}`, run: () => void download() }} />;
  const label = `下载原图 ${name}`;
  const menuItem = inMenu && !!slot;
  const button = <button type="button" role={menuItem ? 'menuitem' : undefined}
    aria-label={label} aria-busy={saving} disabled={saving} onClick={() => void download()}>
    <Icon name={saving ? 'chat-busy' : 'chat-download'} />
    {menuItem && label}
  </button>;
  if (menuItem) return slot.menu ? createPortal(button, slot.menu) : null;
  return <MessageAction><ChatActionTooltip content="下载原图" disabled={saving}>{button}</ChatActionTooltip></MessageAction>;
}
