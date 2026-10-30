import { memo, useMemo } from 'react';
import { answerBlocks } from './surfaces';
import { SurfaceArtifact } from './surface-view';
import { Markdown } from '../components/markdown';
import { MarkdownReferenceScope } from '../components/markdown-references';
import { type UIActions } from './view';
import type { PlaceTarget } from '../lib/navigation';

/** Artifacts are siblings of prose, never descendants of a Markdown bubble. */
export const IntelligentAnswer = memo(function IntelligentAnswer({ text, streaming, onPlace, messageId, ...actions }: UIActions & { text: string; streaming: boolean; messageId?: string; onPlace?: (target: PlaceTarget) => void }) {
  // Ordinary replies need only Markdown's lexer. Splitting artifacts and
  // collecting cross-block references would parse the same prose twice more.
  const blocks = useMemo(() => /intelligent-ui/i.test(text) ? answerBlocks(text) : null, [text]);
  if (!blocks) return <div className="intelligent-answer"><Markdown content={text} chat streaming={streaming} onPlace={onPlace} className="content" /></div>;
  return <MarkdownReferenceScope text={text}><div className="intelligent-answer">{blocks.map(block => block.type === 'ui' ? <SurfaceArtifact messageId={messageId} blockId={block.id} key={block.id} source={block.content} streaming={streaming} {...actions} storageKey={actions.storageKey ? `${actions.storageKey}:${block.id}` : undefined} /> : block.content.trim() ? <Markdown key={block.id} content={block.content} chat streaming={streaming} onPlace={onPlace} className="content" /> : null)}</div></MarkdownReferenceScope>;
}, (previous, next) => previous.text === next.text && previous.streaming === next.streaming && previous.messageId === next.messageId && previous.storageKey === next.storageKey && previous.onPlace === next.onPlace && !!previous.onEdit === !!next.onEdit);
