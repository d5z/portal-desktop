import { LocalFileAction, LocalFileLink } from './local-file-link';
import { RemoteImage } from './remote-image';
import { MarkdownReferences } from './markdown-references';
import { localFileReference } from '../../../shared/local-file';
import { IntelligentUI } from "../intelligent-ui/view";
import hljs from "highlight.js/lib/common";
import type { Emitter } from "highlight.js";
import { Fragment, memo, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { detectStructuredText, formatJSON } from './structured-text';
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

/** Markdown tokens become React elements. Raw HTML has no execution/rendering path. */
export const Markdown = memo(function Markdown({
  content,
  className = "reading-text",
  onPlace,
  chat = false,
  richCode = chat,
  renderText,
  leadingContent,
  previewMarkdownCode = true,
  intelligentUI = false,
  streaming = false,
}: {
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
}) {
  const previewLocalFile = useContext(LocalFileAction);
  const references = useContext(MarkdownReferences);
  const tokens = useMemo(
    () => {
      const language = richCode && detectStructuredText(content);
      if (language) return [{ type: 'code', raw: content, text: content, lang: language } as Tokens.Code];
      const lexer = new marked.Lexer({gfm:true,breaks:chat});
      lexer.tokens.links = {...references};
      return lexer.lex(content);
    },
    [content, chat, richCode, references],
  );
  const linked = new Set<PlaceView>();
  const firstContentToken = tokens.find(token => token.type !== 'space');
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
  collect(tokens);
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
  function render(list: Token[], decorate = true): ReactNode {
    return list.map((token, index) => {
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
          node = <p>{token === firstContentToken && leadingContent}{inner}</p>;
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
          node = local ? <LocalFileLink path={local} card={/\.html?$/i.test(local)}>{render(link.tokens, false)}</LocalFileLink> : (
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
          const items = list.items.map((item, i) => (
            <li key={i}>
              {item.task && (
                <input
                  type="checkbox"
                  checked={!!item.checked}
                  disabled
                  readOnly
                />
              )}
              {render(item.tokens, decorate)}
            </li>
          ));
          node = list.ordered ? (
            <ol start={list.start || 1}>{items}</ol>
          ) : (
            <ul>{items}</ul>
          );
          break;
        }
        case "table": {
          const table = token as Tokens.Table;
          node = (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {table.header.map((cell, i) => (
                      <th
                        key={i}
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
            </div>
          );
          break;
        }
        case "html":
          node = chat ? token.raw : null;
          break;
        default:
          node = token.raw;
      }
      return <Fragment key={index}>{node}</Fragment>;
    });
  }
  return <div className={className}>{leadingContent && firstContentToken?.type !== 'paragraph' && <p>{leadingContent}</p>}{render(tokens)}</div>;
});

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
          <pre><code className={`hljs lang-${language}`}>{streaming ? text : <HighlightedCode text={text} language={language} />}</code></pre>
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
  return <button type="button" aria-label={status} onClick={async () => {
    clearTimeout(timer.current);
    try { await copy(text); setStatus('已复制'); }
    catch { setStatus('复制失败，请重试'); }
    timer.current = setTimeout(() => setStatus('复制代码'), 2000);
  }}><span role="status">{status}</span></button>;
}

function ChatCodeBlock({ text, language, streaming }: { text: string; language: string; streaming: boolean }) {
  const inferred = useMemo(() => !language ? detectStructuredText(text) : undefined, [text, language]);
  const lang = (language || inferred || 'text').toLowerCase();
  const json = ['json', 'jsonl', 'ndjson'].includes(lang);
  const formatted = useMemo(() => lang === 'json' ? formatJSON(text) : undefined, [text, lang]);
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
    <pre><code className={`hljs lang-${language || inferred || 'text'}`}>{streaming ? display : <HighlightedCode text={display} language={json ? 'json' : language || 'plaintext'} />}</code></pre>
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
