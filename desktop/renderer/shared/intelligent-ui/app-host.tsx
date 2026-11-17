import { ErrorIndicator } from '../components/error-indicator';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { compileUI, type UIDocument, type Value } from './runtime';
import { loadUIState, saveUIState } from './storage';

/** Only trusted bootstrap code runs in the iframe. Generated code runs in a terminable Worker. */
function workerSource(code: string, initial: Record<string, Value>) {
  const worker = `
const send = self.postMessage.bind(self);
let eventHandler = () => {}, tickHandler = () => {};
const ui = Object.freeze({
 state: ${JSON.stringify(initial)},
 render(doc) { send({type:'render',doc}); },
 save(state) { send({type:'save',state}); },
 onEvent(fn) { if(typeof fn==='function') eventHandler=fn; },
 onTick(fn) { if(typeof fn==='function') { tickHandler=fn; send({type:'capabilities',animated:true}); } }
});
self.onmessage = event => {
 try { if(event.data.type==='event') eventHandler(event.data.event); else if(event.data.type==='tick') tickHandler(event.data.time); }
 catch(error) { send({type:'error',message:String(error.message||error).slice(0,200)}); }
 finally { send({type:'ack'}); }
};
for(const name of ['fetch','XMLHttpRequest','WebSocket','EventSource','importScripts','setInterval','setTimeout','indexedDB','caches','BroadcastChannel','Worker','SharedWorker']) {
 try { Object.defineProperty(self,name,{value:undefined,writable:false,configurable:false}); } catch {}
}
try { (new Function('ui', ${JSON.stringify(code)}))(ui); send({type:'ack'}); }
catch(error) { send({type:'error',message:String(error.message||error).slice(0,200)}); }
`;
  return worker;
}

function hasApp(doc: UIDocument) {
  const pending = [...doc.body];
  while (pending.length) { const n = pending.pop()!; if (n.type === 'app') return true; pending.push(...(n.children || [])); }
  return false;
}
export function LocalApp({ code, storageKey, label, onRepair, render }: { code: string; storageKey?: string; label?: string; onRepair?: (text: string) => void; render: (doc: UIDocument, event: (key: string, value: Value) => void) => ReactNode }) {
  const frame = useRef<HTMLIFrameElement>(null), root = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<UIDocument | null>(null), [error, setError] = useState('');
  const [outputError, setOutputError] = useState(false);
  const [running, setRunning] = useState(true), [revision, setRevision] = useState(0);
  const [source, setSource] = useState('');
  const visible = useRef(true), elapsed = useRef(0);
  const [animated, setAnimated] = useState(false);
  useEffect(() => {
    let alive = true;
    setDoc(null); setError(''); setOutputError(false); setSource(''); setRunning(true); setAnimated(false); elapsed.current = 0;
    const timeout = setTimeout(() => { if (alive) setError('本地计算启动超时，请重新启动'); }, 15000);
    (async () => {
      const saved = storageKey ? await loadUIState(storageKey + ':app').catch(() => undefined) : undefined;
      clearTimeout(timeout);
      if (alive) setSource(workerSource(code, saved || {}));
    })();
    return () => { alive = false; clearTimeout(timeout); };
  }, [code, storageKey, revision]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { visible.current = entries[0]?.isIntersecting ?? false; });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let queued: UIDocument | undefined, raf = 0;
    const startup = source ? setTimeout(() => { setError('本地计算未能启动，请重新启动'); setRunning(false); frame.current?.contentWindow?.postMessage({type:'stop'}, '*'); }, 15000) : undefined;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (['render', 'error'].includes(message?.type)) clearTimeout(startup);
      if (message?.type === 'capabilities' && message.animated === true) { setAnimated(true); return; }
      if (message?.type === 'error') { setError(previous => previous || String(message.message).slice(0, 200)); setRunning(false); return; }
      if (message?.type !== 'render' && message?.type !== 'save') return;
      try {
        const value = message.type === 'render' ? message.doc : { version: 1, title: '', state: message.state, body: [] };
        const compiled = compileUI(JSON.stringify(value));
        if (hasApp(compiled)) throw new Error('应用不能嵌套应用');
        if (message.type === 'save') { if (storageKey) void saveUIState(storageKey + ':app', compiled.state); }
        else { queued = compiled; if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (queued) setDoc(queued); }); }
      } catch (e) { setOutputError(true); setError(e instanceof Error ? e.message : '应用输出无效'); setRunning(false); frame.current?.contentWindow?.postMessage({ type: 'stop' }, '*'); }
    };
    window.addEventListener('message', onMessage);
    return () => { clearTimeout(startup); cancelAnimationFrame(raf); window.removeEventListener('message', onMessage); };
  }, [storageKey, source, revision, code]);
  useEffect(() => {
    if (!running || error || !animated) return;
    const timer = setInterval(() => {
      if (visible.current && document.visibilityState === 'visible') frame.current?.contentWindow?.postMessage({ type: 'tick', time: elapsed.current += .1 }, '*');
    }, 100);
    return () => clearInterval(timer);
  }, [running, error, source, animated]);
  return <div ref={root} className="iui-app">
    <div className="iui-app-actions"><span>{label || '交互工具'}</span>{error
      ? <ErrorIndicator description={outputError ? `生成内容格式不符合要求：${error}` : error} retry={outputError ? onRepair && {
        label: '让 Being 修正', run: () => onRepair(`请修正刚才生成的交互界面。客户端校验错误：${error}。请保留原任务，修正不符合协议的组件；如果需要绘制 SVG，请使用 diagram 图元，而不是 image 中的 SVG 字符串。重新输出完整的 intelligent-ui 界面。`),
      } : { label: '重新启动', run: () => { setRevision(v => v + 1); setRunning(true); } }} />
      : <>{animated && <button type="button" onClick={() => setRunning(v => !v)}>{running ? '暂停' : '播放'}</button>}<button type="button" onClick={() => { setRevision(v => v + 1); setRunning(true); }}>重新启动</button></>}</div>
    {source && <iframe ref={frame} key={revision + code} title="隔离计算运行时" sandbox="allow-scripts" src={new URL('iui-runtime.html', window.location.href).href} onLoad={() => frame.current?.contentWindow?.postMessage({ type: 'init', code: source }, '*')} hidden />}
    {doc ? render(doc, (key, value) => frame.current?.contentWindow?.postMessage({ type: 'event', event: { key, value } }, '*')) : !error && <p className="iui-notice">正在准备交互体验…</p>}
  </div>;
}
