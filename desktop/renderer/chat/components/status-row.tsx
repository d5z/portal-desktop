import { ErrorIndicator } from '../../shared/components/error-indicator';
import type { ReactNode } from 'react';
import { Icon } from '../../shared/icons/icon';
import type { Message } from '../models/chat';
import { MessageAction } from '../../shared/components/message-action-slot';

export function ChatStatusRow({ title, detail, tone = 'neutral', retry, children, inActions, mediaStatus }: {
  title: string;
  detail?: string;
  tone?: 'neutral' | 'error' | 'stopped';
  retry?: { label: string; run(): void; disabled?: boolean };
  children?: ReactNode;
  inActions?: boolean;
  mediaStatus?: boolean;
}) {
  const className = mediaStatus ? 'chat-status-row message-action-status' : 'chat-status-row';
  if (tone === 'error') {
    const description = detail && detail !== title ? `${title} · ${detail}` : title;
    const feedback = <>
      <ErrorIndicator description={description} retry={retry} />
      {children && <div className="chat-status-actions">{children}</div>}
    </>;
    return inActions ? <MessageAction>{feedback}</MessageAction>
      : <div className={className} data-tone="error">
        {!mediaStatus && <span className="chat-status-copy" role="status"><strong>{title}</strong></span>}
        {feedback}
      </div>;
  }
  const icon = tone === 'stopped' ? 'chat-stop' : 'chat-info';
  return <div className={className} data-tone={tone} data-copy-group>
    <Icon name={icon} />
    <div className="chat-status-copy" role="status">
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
    {children && <div className="chat-status-actions">{children}</div>}
  </div>;
}

export function SystemStatusRow({ item, sceneLabel, children, inActions }: { item: Message; sceneLabel?: string; children?: ReactNode; inActions?: boolean }) {
  const warningPrefix = /^⚠\uFE0F?\s*/u;
  const warning = warningPrefix.test(item.text);
  const text = item.text.replace(warningPrefix, '');
  const networkFailure = item.retryLabel === '重试';
  const timeout = item.retryLabel === '检查一下';
  const stopPending = item.notice === 'stop' && !!item.retry;
  const title = networkFailure && warning ? '网络连接失败，消息发送尚未确认'
    : timeout ? '暂未收到新的回复内容'
    : stopPending ? '停止请求尚未确认' : text || '对话遇到问题';
  const error = warning || networkFailure || stopPending || timeout;
  const detail = stopPending ? '仍在接收回复，可再次停止。' : (networkFailure || timeout) && text !== title ? text : undefined;
  const retry = item.retry && { label: networkFailure ? '重新发送' : timeout ? '检查回复状态' : item.retryLabel || '重试', run: () => void item.retry?.() };

  return <ChatStatusRow title={title} detail={[sceneLabel, detail].filter(Boolean).join(' · ')}
    tone={error ? 'error' : item.notice === 'stop' ? 'stopped' : 'neutral'} retry={retry} inActions={inActions}>
    {error ? undefined : children}
  </ChatStatusRow>;
}
