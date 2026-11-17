import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AttachmentFileMenu } from './attachment-file-menu';

const MessageActionSlot = createContext<{
  actions: HTMLElement | null;
  fileMenu: HTMLElement | null;
  registerFile(name: string): () => void;
} | null>(null);

export function MessageAction({ children }: { children: ReactNode }) {
  const slot = useContext(MessageActionSlot);
  return slot ? slot.actions && createPortal(children, slot.actions) : children;
}

export function MessageFileActions({ name, children }: { name: string; children: ReactNode }) {
  const slot = useContext(MessageActionSlot);
  const register = slot?.registerFile;
  useLayoutEffect(() => register?.(name), [name, register]);
  if (!slot) return <AttachmentFileMenu label={`${name} 文件操作`}>{children}</AttachmentFileMenu>;
  return slot.fileMenu && createPortal(<div role="group" className="attachment-file-menu-group" aria-label={name}>
    <strong>{name}</strong>
    {children}
  </div>, slot.fileMenu);
}

export function MessageActionRow({ children, actions, media }: {
  children: ReactNode;
  actions: ReactNode;
  media: boolean;
}) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [fileMenu, setFileMenu] = useState<HTMLDivElement | null>(null);
  const [files, setFiles] = useState<{ name: string }[]>([]);
  const registerFile = useCallback((name: string) => {
    const file = { name };
    setFiles(files => [...files, file]);
    return () => setFiles(files => files.filter(item => item !== file));
  }, []);
  return <div className="message-bubble-row" data-copy-group>
    <MessageActionSlot.Provider value={media ? { actions: slot, fileMenu, registerFile } : null}>{children}</MessageActionSlot.Provider>
    <div className="message-row-actions">
      {actions}
      {files.length > 0 && <AttachmentFileMenu label={files.length === 1 ? `${files[0].name} 文件操作` : '更多消息操作'}>
        <div className="attachment-file-menu-groups" ref={setFileMenu} />
      </AttachmentFileMenu>}
      {media && <div className="message-media-actions" ref={setSlot} />}
    </div>
  </div>;
}
