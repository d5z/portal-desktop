import { Fragment, type ComponentProps } from 'react';
import { Markdown } from '../../shared/components/markdown';
import { composerCommands, parseComposerCommands } from '../models/composer-commands';
import { stripClientMessageContext } from '../services/local-file-context';
import { ComposerMenuIcon } from '../../shared/icons/composer-menu';

function commandContent(text: string) {
  const clean = stripClientMessageContext(text);
  const parsed = parseComposerCommands(clean);
  const labels = parsed.commands.length ? parsed.commands.map(id => {
    const command = composerCommands.find(command => command.id === id)!;
    return <Fragment key={id}><span className="composer-command-token message-command-token" data-command={id}
      title={`/${id}`} aria-label={`${command.label} (/${id})`}>
      <ComposerMenuIcon kind={id}/><span>{command.label}</span>
    </span>{' '}</Fragment>;
  }) : undefined;
  return { labels, text: labels ? parsed.rest : clean };
}

export function CommandMessageMarkdown({ content, ...props }: ComponentProps<typeof Markdown>) {
  const message = commandContent(content);
  return <Markdown {...props} content={message.text} leadingContent={message.labels}/>;
}

/** Attachment captions stay plain text, with the same command labels as normal bubbles. */
export function CommandMessageText({ text }: { text: string }) {
  const message = commandContent(text);
  return <>{message.labels}{message.text}</>;
}
