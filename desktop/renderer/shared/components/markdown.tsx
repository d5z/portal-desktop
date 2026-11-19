import { CopyFeedbackIcon } from './copy-feedback';
import { ChatActionTooltip } from './chat-action-tooltip';
import { CopyMessage } from './copy-message';
import { Dialog } from './dialog';
import { homeFileReference, beingFileBlocks } from '../../../shared/being-files';
import { BeingFilesMessage, HomeFileLink } from './being-files';
import { StreamingMarkdown } from '../lib/streaming-markdown';
import { LocalFileAction, LocalFileLink } from './local-file-link';
import { RemoteImage, RemoteImageGroup } from './remote-image';
import { MessageImageGroup } from './message-image-group';
import { MessageCaptionAnchor, MessageCaptionSlot } from './message-action-slot';
import { Icon } from '../icons/icon';
import codeStyles from './markdown-code-copy.module.scss';
import { remoteImageURL } from '../../../shared/remote-image';
import { MarkdownReferences, MarkdownReferenceScope } from './markdown-references';
import { localFileReference } from '../../../shared/local-file';
import { IntelligentUI } from "../intelligent-ui/view";
import hljs from "highlight.js/lib/common";
import type { Emitter } from "highlight.js";
import { Fragment, memo, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { detectStructuredText, formatJSON } from '../lib/structured-text';
import { marked, type Token, type Tokens } from "marked";
import {
  placeFromURL,
  placeNames,
  type PlaceTarget,
  type PlaceView,
} from "../lib/navigation";

const terms: Record<string, PlaceView> = {
  镇公所公告: "announcements",
  公告板: "announcements",
  镇通讯录: "contacts",
  镇民通讯录: "contacts",
  通讯录: "contacts",
  announcements: "announcements",
  contacts: "contacts",
  篝火: "bonfire",
  围炉: "firesides",
  私信: "mail",
  邮局: "mail",
  收件箱: "mail",
  书架: "embers",
  卷轴: "scrolls",
  工具库: "kits",
  本机连接: "portal",
  种子花园: "seeds",
  "seed garden": "seeds",
  seeds: "seeds",
  bonfire: "bonfire",
  fireside: "firesides",
  embers: "embers",
  scrolls: "scrolls",
  kit: "kits",
  kits: "kits",
  portal: "portal",
};
const termPattern =
  /镇公所公告|公告板|镇民通讯录|镇通讯录|通讯录|篝火|围炉|私信|邮局|收件箱|书架|卷轴|工具库|本机连接|种子花园|\b(?:announcements|contacts|seed garden|seeds|bonfire|fireside|embers|scrolls|kits?|portal)\b/gi;
const markdownLanguages = new Set(["markdown", "md", "mkdown", "mkd"]);
export { CodeClipboard } from './clipboard';
import { CodeClipboard } from './clipboard';
export function safeLink(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
// Decode Markdown's text entities without parsing or mutating a DOM tree.
function unescapeText(text: string) {
  return text.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (raw, entity: string) => {
      const names: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: "\u00a0",
      };
      if (!entity.startsWith("#")) return names[entity.toLowerCase()] ?? raw;
      const value =
        entity[1].toLowerCase() === "x"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return value > 0 &&
        value <= 0x10ffff &&
        !(value >= 0xd800 && value <= 0xdfff)
        ? String.fromCodePoint(value)
        : "\ufffd";
    },
  );
}
export function markdownText(content: string, transformText: (text: string) => string = text => text): string {
  function text(tokens: Token[], decorate = true): string {
    return tokens
      .map((token) => {
        if (token.type === "image")
          return unescapeText((token as Tokens.Image).text);
        if (token.type === "list")
          return (token as Tokens.List).items
            .map((item) => text(item.tokens, decorate))
            .join(" ");
        if (token.type === "table") {
          const table = token as Tokens.Table;
          return [table.header, ...table.rows]
            .map((row) => row.map((cell) => text(cell.tokens, decorate)).join(" "))
            .join(" ");
        }
        if ("tokens" in token && Array.isArray(token.tokens))
          return text(token.tokens, decorate && token.type !== 'link');
        if (token.type === "html") return "";
        const value = unescapeText(
          ("text" in token ? String(token.text) : token.raw).replace(
            /\n+/g,
            " ",
          ),
        );
        return decorate && !['code', 'codespan'].includes(token.type) ? transformText(value) : value;
      })
      .join(" ");
  }
  return text(marked.lexer(content, { gfm: true, breaks: true }))
    .replace(/\s+/g, " ")
    .trim();
}

interface MarkdownProps {
  content: string;
  className?: string;
  onPlace?: (target: PlaceTarget) => void;
  chat?: boolean;
  richCode?: boolean;
  renderText?: (text: string) => ReactNode;
  leadingContent?: ReactNode;
  previewMarkdownCode?: boolean;
  intelligentUI?: boolean;
  streaming?: boolean;
}

/** File receipts replace their complete JSON range while surrounding prose stays Markdown. */
export const Markdown = memo(function Markdown(props: MarkdownProps) {
  const blocks = useMemo(() => beingFileBlocks(props.content), [props.content]);
  if (!blocks.length) return <MarkdownText {...props} />;
  const filesOnly = !props.streaming && blocks.every(block => block.kind === 'files' ? !!block.receipt.files : !block.text.trim());
  return <MarkdownReferenceScope text={props.content}><div className={props.className ?? 'reading-text'} data-delivered-files-only={filesOnly || undefined}>
    {blocks.map((block, index) => block.kind === 'files'
      ? <BeingFilesMessage key={block.start} receipt={block.receipt} streaming={props.streaming ?? false} source={block.text} />
      : <MarkdownText {...props} key={block.start} content={block.text} className="" withinFileReceipt leadingContent={index === 0 ? props.leadingContent : undefined} />)}
  </div></MarkdownReferenceScope>;
});

/** Markdown tokens become React elements. Raw HTML has no execution/rendering path. */
const MarkdownText = memo(function MarkdownText({
  content: source,
  className = "reading-text",
  onPlace,
  chat = false,
  richCode = chat,
  renderText,
  leadingContent,
  previewMarkdownCode = true,
  intelligentUI = false,
  streaming: receiving = false,
  withinFileReceipt = false,
}: MarkdownProps & { withinFileReceipt?: boolean }) {
  const captionSlot = useContext(MessageCaptionSlot);
  const [content, setContent] = useState(source);
  const reveal = useRef({ source: '', text: '', position: 0, receiving: false });
  useLayoutEffect(() => {
    const progress = reveal.current;
    // Smooth only live chat prose. History, replacements and nested Markdown
    // previews stay immediate; previews already receive the revealed source.
    const animate = chat && previewMarkdownCode && (receiving || progress.receiving) &&
      source.startsWith(progress.source) && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    progress.source = source;
    progress.receiving = receiving;
    if (!animate) {
      progress.text = source;
      progress.position = source.length;
      setContent(source);
      return;
    }
    // Show the first character before paint, even when the first packet is large.
    if (!progress.text && source) {
      progress.position = source.codePointAt(0)! > 0xffff ? 2 : 1;
      progress.text = source.slice(0, progress.position);
    }
    setContent(progress.text);
    if (progress.text === source) return;
    // Keep fractional progress across packets and use elapsed time so speed is
    // independent of refresh rate. Large bursts catch up within 240 ms, including
    // the final packet, without pushing animation state into the chat store.
    const speed = Math.max(0.06, (source.length - progress.position) / 240);
    let previous = performance.now();
    let frame = requestAnimationFrame(tick);
    function tick(now: number) {
      progress.position = Math.min(source.length, progress.position + (now - previous) * speed);
      previous = now;
      let end = Math.floor(progress.position);
      // Do not expose half of an emoji's UTF-16 surrogate pair.
      const last = source.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff && end < source.length) end--;
      const text = source.slice(0, end);
      if (text !== progress.text) { progress.text = text; setContent(text); }
      if (end < source.length) frame = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(frame);
  }, [source, receiving, chat, previewMarkdownCode]);
  const streaming = receiving || content !== source;
  const previewLocalFile = useContext(LocalFileAction);
  const references = useContext(MarkdownReferences);
  const parser = useMemo(() => new StreamingMarkdown((source) => {
    const lexer = new marked.Lexer({ gfm: true, breaks: chat });
    lexer.tokens.links = { ...references };
    return lexer.lex(source);
  }), [chat, references, streaming]);
  const tokens = useMemo(() => {
    const language = richCode && detectStructuredText(content);
    if (language) return [{ type: 'code', raw: content, text: content, lang: language } as Tokens.Code];
    if (streaming) return parser.update(content);
    const lexer = new marked.Lexer({ gfm: true, breaks: chat });
    lexer.tokens.links = { ...references };
    return lexer.lex(content);
  }, [content, chat, richCode, references, streaming, parser]);
  // Frozen token identities retain their React elements. Include the rendering
  // vocabulary and streaming state so final code highlighting and action changes
  // always invalidate the cache. Weak keys release superseded tail tokens.
  const blockCache = useMemo(() => new WeakMap<Token, { before: string; after: PlaceView[]; node: ReactNode }>(),
    [onPlace, renderText, leadingContent, chat, richCode, previewMarkdownCode, intelligentUI, streaming, previewLocalFile]);
  const linked = new Set<PlaceView>();
  const firstContentToken = tokens.find(token => token.type !== 'space');
  const groupImages = chat && (withinFileReceipt || className?.split(/\s+/).includes('content'));
  const captionToken = captionSlot && groupImages && (captionSlot.mixedMedia || tokens.some(imageParagraph))
    ? tokens.filter(token => token.type !== 'space' && token.type !== 'def' && token.type !== 'hr' && !imageParagraph(token)).at(-1)
    : undefined;
  // Explicit links take precedence over automatic word links throughout the message.
  function collect(list: Token[]) {
    for (const token of list) {
      if (token.type === "link") {
        const target = placeFromURL((token as Tokens.Link).href);
        if (target) linked.add(target.view);
      }
      if ("tokens" in token && Array.isArray(token.tokens))
        collect(token.tokens);
      if (token.type === "list")
        (token as Tokens.List).items.forEach((item) => collect(item.tokens));
      if (token.type === "table") {
        const table = token as Tokens.Table;
        [table.header, ...table.rows].forEach((row) =>
          row.forEach((cell) => collect(cell.tokens)),
        );
      }
    }
  }
  if (onPlace) collect(tokens);
  function words(value: string, decorate: boolean): ReactNode {
    const text = unescapeText(value);
    const plain = (value: string) => decorate && renderText ? renderText(value) : value;
    if (!onPlace || !decorate) return plain(text);
    const parts: ReactNode[] = [];
    let end = 0;
    for (const match of text.matchAll(termPattern)) {
      const view = terms[match[0].toLowerCase()];
      if (linked.has(view)) continue;
      linked.add(view);
      parts.push(plain(text.slice(end, match.index)));
      parts.push(
        <button
          key={match.index}
          type="button"
          className="chat-place-link"
          title={`打开${placeNames[view]}`}
          aria-label={`打开${placeNames[view]}`}
          onClick={() => onPlace({ view })}
        >
          {match[0]}
        </button>,
      );
      end = match.index + match[0].length;
    }
    return parts.length ? (
      <>
        {parts}
        {plain(text.slice(end))}
      </>
    ) : (
      plain(text)
    );
  }
  function code(value: string, language?: string): ReactNode {
    const local = previewLocalFile && language === undefined ? localFileReference(value) : undefined;
    if (local) return <LocalFileLink path={local} inlineCode>{value}</LocalFileLink>;
    const href = safeLink(value.trim());
    return onPlace && href && /^https?:\/\/[^\s<>"'`]+$/i.test(value.trim()) ? (
      <a
        className="chat-code-link"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title="在内置浏览器打开"
      >
        {value}
      </a>
    ) : richCode && language !== undefined ? (
      <HighlightedCode text={value} language={language} />
    ) : (
      value
    );
  }
  function render(list: Token[], decorate = true, topLevel = false): ReactNode {
    return list.flatMap((token, index) => {
      if (topLevel && groupImages) {
        const group = imageParagraph(token);
        const previous = imageParagraph(list[index - (list[index - 1]?.type === 'space' ? 2 : 1)]);
        if (group && previous) return [];
        if (group) {
          for (let end = index + 1; end < list.length; end++) {
            const next = imageParagraph(list[end]);
            if (next) group.push(...next);
            else if (list[end].type !== 'space') break;
          }
          if (group.length > 1) {
            const grid = <MessageImageGroup className="markdown-image-group">
              {group.map(({src,name,title}, imageIndex) => <RemoteImage key={imageIndex} src={src} name={name} title={title} showUnavailable />)}
            </MessageImageGroup>;
            return <Fragment key={index}>
              {token === firstContentToken && leadingContent && <p>{leadingContent}</p>}
              {group.every(({src}) => remoteImageURL(src)) ? <RemoteImageGroup items={group}>{grid}</RemoteImageGroup> : grid}
            </Fragment>;
          }
        }
      }
      const before = topLevel && onPlace ? [...linked].sort().join(',') : '';
      const cached = topLevel ? blockCache.get(token) : undefined;
      if (cached && cached.before === before) {
        cached.after.forEach(view => linked.add(view));
        return token === captionToken
          ? <div key={index} className="markdown-caption">{cached.node}<MessageCaptionAnchor /></div>
          : <Fragment key={index}>{cached.node}</Fragment>;
      }
      const inner = ["link", "code", "codespan", "html", "image"].includes(
        token.type,
      )
        ? null
        : "tokens" in token && Array.isArray(token.tokens)
          ? render(token.tokens, decorate)
          : words("text" in token ? String(token.text) : "", decorate);
      let node: ReactNode;
      switch (token.type) {
        case "space":
          node = null;
          break;
        case "paragraph":
          node = <p className={topLevel && groupImages && !leadingContent && imageParagraph(token)?.length === 1 ? "markdown-image-only" : undefined}>{token === firstContentToken && leadingContent}{inner}</p>;
          break;
        case "text":
        case "escape":
          node = inner;
          break;
        case "strong":
          node = <strong>{inner}</strong>;
          break;
        case "em":
          node = <em>{inner}</em>;
          break;
        case "del":
          node = <del>{inner}</del>;
          break;
        case "br":
          node = <br />;
          break;
        case "hr":
          node = <hr />;
          break;
        case "heading": {
          const Tag = `h${(token as Tokens.Heading).depth}` as
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
          node = <Tag>{inner}</Tag>;
          break;
        }
        case "blockquote":
          node = <blockquote>{inner}</blockquote>;
          break;
        case "codespan":
          node = (
            <code>{code(unescapeText((token as Tokens.Codespan).text))}</code>
          );
          break;
        case "code": {
          const block = token as Tokens.Code;
          const lang = (block.lang || "")
            .split(/\s/)[0]
            .replace(/[^a-z0-9_-]/gi, "");
          node = intelligentUI && lang.toLowerCase() === "intelligent-ui" ? (
            <IntelligentUI source={block.text} streaming={streaming} />
          ) : richCode && previewMarkdownCode && markdownLanguages.has(lang.toLowerCase()) ? (
            <MarkdownCodeBlock text={block.text} language={lang} streaming={streaming} />
          ) : richCode ? (
            <ChatCodeBlock text={block.text} language={lang} streaming={streaming} />
          ) : (
            <div className="code-block">
              {chat && lang && <div className="code-lang">{lang}</div>}
              <pre>
                <code className={lang ? `hljs lang-${lang}` : undefined}>
                  {code(block.text, lang)}
                </code>
              </pre>
            </div>
          );
          break;
        }
        case "link": {
          const link = token as Tokens.Link,
            href = safeLink(unescapeText(link.href)),
            target = onPlace ? placeFromURL(link.href) : null;
          const local = previewLocalFile ? localFileReference(unescapeText(link.href), true) : undefined;
          const homeFile = homeFileReference(unescapeText(link.href));
          node = homeFile ? <HomeFileLink path={homeFile.path}>{render(link.tokens, false)}</HomeFileLink> : local ? <LocalFileLink path={local} card>{render(link.tokens, false)}</LocalFileLink> : (
            <a
              href={href}
              title={
                target
                  ? `在这里打开${placeNames[target.view]}${target.id ? "详情" : ""}`
                  : link.title || undefined
              }
              target="_blank"
              rel="noopener noreferrer"
              className={target ? "chat-place-link" : undefined}
              onClick={(event) => {
                if (
                  !target ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  window.getSelection()?.toString()
                )
                  return;
                event.preventDefault();
                onPlace?.(target);
              }}
            >
              {render(link.tokens, false)}
            </a>
          );
          break;
        }
        case "image": {
          const image = token as Tokens.Image,
            href = safeLink(unescapeText(image.href));
          node =
            chat && href ? (
              <RemoteImage
                showUnavailable
                src={href}
                name={unescapeText(image.text)}
                title={image.title || undefined}
              />
            ) : (
              image.text
            );
          break;
        }
        case "list": {
          const list = token as Tokens.List;
          const items = list.items.map((item, i) => {
            const content = render(item.tokens, decorate);
            if (item.task && groupImages) return (
              <li key={i} className="markdown-task">
                <span className="markdown-task-marker" role="img"
                  aria-label={item.checked ? '已勾选' : '未勾选'} data-checked={!!item.checked} />
                <div>{content}</div>
              </li>
            );

            return <li key={i}>{item.task && <input type="checkbox" checked={!!item.checked} disabled readOnly />}{content}</li>;
          });
          node = list.ordered ? (
            <ol start={list.start || 1}>{items}</ol>
          ) : (
            <ul>{items}</ul>
          );
          break;
        }
        case "table": {
          const table = token as Tokens.Table;
          const body = (
              <table>
                <thead>
                  <tr>
                    {table.header.map((cell, i) => (
                      <th
                        key={i}
                        scope="col"
                        style={{ textAlign: table.align[i] || undefined }}
                      >
                        {render(cell.tokens, decorate)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          style={{ textAlign: table.align[j] || undefined }}
                        >
                          {render(cell.tokens, decorate)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
          );
          node = groupImages ? <MarkdownTableScroll text={table.raw.trim()}>{body}</MarkdownTableScroll>
            : <div className="table-wrap">{body}</div>;
          break;
        }
        case "html":
          node = chat ? token.raw : null;
          break;
        default:
          node = token.raw;
      }
      if (topLevel) blockCache.set(token, { before, after: [...linked], node });
      return token === captionToken
        ? <div key={index} className="markdown-caption">{node}<MessageCaptionAnchor /></div>
        : <Fragment key={index}>{node}</Fragment>;
    });
  }
  return <div className={className}>{leadingContent && firstContentToken?.type !== 'paragraph' && <p>{leadingContent}</p>}{render(tokens, true, true)}</div>;
});

export function isImageOnlyMarkdown(content: string) {
  if (!content.includes('![')) return false;
  const paragraphs = marked.lexer(content, { gfm: true, breaks: true })
    .filter(token => token.type !== 'space' && token.type !== 'def');
  return paragraphs.length > 0 && paragraphs.every(token => imageParagraph(token));
}

function imageParagraph(token: Token | undefined) {
  if (token?.type !== 'paragraph') return;
  const images: {src: string; name: string; title?: string}[] = [];
  for (const child of (token as Tokens.Paragraph).tokens) {
    if (child.type === 'br' || (child.type === 'text' && !(child as Tokens.Text).text.trim())) continue;
    if (child.type !== 'image') return;
    const image = child as Tokens.Image;
    const src = safeLink(unescapeText(image.href));
    if (!src) return;
    images.push({src, name: unescapeText(image.text) || '图片', title: image.title || undefined});
  }
  return images.length ? images : undefined;
}

function MarkdownTableScroll({ children, text }: { children: ReactNode; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const expand = useRef<HTMLButtonElement>(null);
  const copy = useContext(CodeClipboard);
  const [overflow, setOverflow] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const viewport = ref.current!;
    const measure = () => setOverflow(viewport.firstElementChild!.scrollWidth > viewport.clientWidth + 1);
    const resize = new ResizeObserver(measure);
    resize.observe(viewport);
    resize.observe(viewport.firstElementChild!);
    measure();
    return () => resize.disconnect();
  }, []);
  function closePreview() {
    setOpen(false);
    requestAnimationFrame(() => expand.current?.focus({ preventScroll: true }));
  }
  const scroller = <div ref={ref} className="table-wrap" tabIndex={overflow ? 0 : undefined} role="region"
    aria-label={overflow ? '表格，可横向滚动' : '表格'}>
    {children}
  </div>;
  if (typeof document === 'undefined' || document.documentElement.dataset.chatHost !== 'desktop') return scroller;
  return <div className="markdown-table" data-copy-group>
    <div className="markdown-table-actions" data-markdown-copy="exclude">
      <CopyMessage appearance="chat" text={text} copy={copy} label="复制表格" />
      {overflow && <ChatActionTooltip content="展开表格">
        <button ref={expand} type="button" aria-label="展开表格" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
          <Icon name="lucide-maximize-2" />
        </button>
      </ChatActionTooltip>}
    </div>
    {scroller}
    {open && <Dialog className="markdown-table-preview" open onClose={closePreview} aria-label="表格预览" dismissOnBackdrop>
      <header><strong>表格预览</strong>
        <button type="button" aria-label="关闭表格预览" onClick={closePreview}><Icon name="chat-close" /></button>
      </header>
      <div className="table-wrap" role="region" aria-label="表格，可横向滚动" tabIndex={0}>{children}</div>
    </Dialog>}
  </div>;
}

function MarkdownCodeBlock({ text, language, streaming }: { text: string; language: string; streaming: boolean }) {
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const panelId = useId();
  return (
    <div className="code-block markdown-code-block">
      <div className="code-lang markdown-code-toolbar">
        <span>{language}</span>
        <div className="markdown-code-modes" role="group" aria-label="Markdown 显示模式">
          <button
            type="button"
            aria-pressed={mode === "preview"}
            aria-controls={panelId}
            onClick={() => setMode("preview")}
          >
            预览
          </button>
          <button
            type="button"
            aria-pressed={mode === "source"}
            aria-controls={panelId}
            onClick={() => setMode("source")}
          >
            源码
          </button>
          <CopyCode text={text} />
        </div>
      </div>
      <div id={panelId} role="region" aria-label={mode === "preview" ? "Markdown 预览" : "Markdown 源码"}>
        {mode === "preview" ? (
          // Code samples inside the document stay as source rather than opening nested previews.
          <Markdown content={text} chat streaming={streaming} className="markdown-preview" previewMarkdownCode={false} />
        ) : (
          <pre tabIndex={0} aria-label="Markdown 源码"><code className={`hljs lang-${language}`}>{streaming ? text : <HighlightedCode text={text} language={language} />}</code></pre>
        )}
      </div>
    </div>
  );
}

function CopyCode({ text }: { text: string }) {
  const copy = useContext(CodeClipboard);
  const [status, setStatus] = useState('复制代码');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const failed = status.startsWith('复制失败');
  return <ChatActionTooltip content={status} disabled={status === '已复制'}>
    <button type="button" className={codeStyles.copy} data-failed={failed || undefined} aria-label={status} onClick={async () => {
      clearTimeout(timer.current);
      try { await copy(text); setStatus('已复制'); }
      catch { setStatus('复制失败，请重试'); }
      timer.current = setTimeout(() => setStatus('复制代码'), 2000);
    }}>
      <CopyFeedbackIcon copied={status === '已复制'}>
        <Icon name={failed ? 'chat-retry' : status === '已复制' ? 'chat-check' : 'chat-copy'} width="16" height="16" stroke="currentColor" fill="none" />
      </CopyFeedbackIcon>
      <span className={codeStyles.feedback} role="status">{status === '复制代码' ? '' : status}</span>
    </button>
  </ChatActionTooltip>;
}

function ChatCodeBlock({ text, language, streaming }: { text: string; language: string; streaming: boolean }) {
  const inferred = useMemo(() => !language ? detectStructuredText(text) : undefined, [text, language]);
  const lang = (language || inferred || 'text').toLowerCase();
  const json = ['json', 'jsonl', 'ndjson'].includes(lang);
  // Incomplete JSON is normal while streaming; don't parse/format it per delta.
  const formatted = useMemo(() => !streaming && lang === 'json' ? formatJSON(text) : undefined, [text, lang, streaming]);
  const [pretty, setPretty] = useState(false);
  const display = pretty && formatted !== undefined ? formatted : text;
  return <div className="code-block rich-code-block">
    <div className="code-lang markdown-code-toolbar">
      <span>{inferred ? `Auto (${inferred.toUpperCase()})` : language || 'text'}</span>
      <div className="markdown-code-modes" role="group" aria-label="代码显示选项">
        {formatted !== undefined && <button type="button" aria-pressed={pretty} onClick={() => setPretty(value => !value)}>{pretty ? '源码' : '格式化'}</button>}
        <CopyCode text={display} />
      </div>
    </div>
    <pre tabIndex={0} aria-label="代码"><code className={`hljs lang-${language || inferred || 'text'}`}>{streaming ? display : <HighlightedCode text={display} language={json ? 'json' : language || 'plaintext'} />}</code></pre>
  </div>;
}

interface Scope {
  scope?: string;
  children: (Scope | string)[];
}
/** The pinned highlight.js emitter API writes a token tree, consumed by React. */
class ReactEmitter implements Emitter {
  root: Scope = { children: [] };
  stack = [this.root];
  addText(text: string) {
    this.stack.at(-1)!.children.push(text);
  }
  // The parser also calls openNode/closeNode directly for grammar modes.
  // These methods are required even though highlight.js omits them from Emitter.
  startScope(scope: string) {
    this.openNode(scope);
  }
  endScope() {
    this.closeNode();
  }
  openNode(scope: string) {
    const node: Scope = { scope, children: [] };
    this.stack.at(-1)!.children.push(node);
    this.stack.push(node);
  }
  closeNode() {
    if (this.stack.length > 1) this.stack.pop();
  }
  __addSublanguage(emitter: Emitter, language: string) {
    const node = (emitter as ReactEmitter).root;
    if (language) node.scope = `language:${language}`;
    this.stack.at(-1)!.children.push(node);
  }
  finalize() {
    this.stack = [this.root];
  }
  toHTML() {
    return "";
  }
}
const highlighter = hljs;
highlighter.configure({ __emitter: ReactEmitter });
function render(node: Scope | string, key = 0): ReactNode {
  if (typeof node === "string") return node;
  const children = node.children.map((child, i) => render(child, i));
  if (!node.scope) return <Fragment key={key}>{children}</Fragment>;
  const [first, ...rest] = node.scope.split(".");
  const className = node.scope.startsWith("language:")
    ? node.scope.replace("language:", "language-")
    : [
        `hljs-${first}`,
        ...rest.map((part, i) => part + "_".repeat(i + 1)),
      ].join(" ");
  return (
    <span key={key} className={className}>
      {children}
    </span>
  );
}
export function HighlightedCode({
  text,
  language,
}: {
  text: string;
  language: string;
}) {
  const nodes = useMemo(() => {
    try {
      // Unknown languages remain readable without scanning every grammar.
      if (!highlighter.getLanguage(language)) return text;
      const result = highlighter.highlight(text, { language });
      // Safe mode returns errors with a partial emitter instead of throwing.
      // React must fall back to the source, not the incomplete token tree.
      if (result.errorRaised || result.illegal) return text;
      return render((result._emitter as ReactEmitter).root);
    } catch {
      return text;
    }
  }, [text, language]);
  return <>{nodes}</>;
}
