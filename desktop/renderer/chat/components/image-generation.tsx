import { Icon } from '../../shared/icons/icon';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { type GenerationSnapshot, type ImageGenerationJob, type ImageGenerationReceipt } from '../../../shared/image-generation';
import { imageGenerationBlocks } from '../../../shared/image-generation-blocks';
import { Markdown } from '../../shared/components/markdown';
import { MarkdownReferenceScope } from '../../shared/components/markdown-references';
import { MessageAction } from '../../shared/components/message-action-slot';
import { RemoteImage, RemoteImageGroup } from '../../shared/components/remote-image';
import { ImageGenerationDownload } from './image-generation-download';
import { imageGenerationQuery, watchImageGeneration, type GenerationViewState } from '../services/image-generations';
import { useNearViewport } from '../../shared/hooks/use-near-viewport';
import { ChatStatusRow } from './status-row';

const labels: Record<GenerationSnapshot['status'],string> = {queued:'排队中', running:'生成中', uncertain:'结果待核对', succeeded:'生成成功', failed:'生成失败', cancelled:'已取消'};
function PictureIcon() {
  return <Icon name="image-rounded" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />;
}
function GenerationDither({ animated }: { animated: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current!;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    const context: CanvasRenderingContext2D = ctx;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, frame = 0, visible = false;
    let pointer: { x: number; y: number } | null = null;
    let x = 0, y = 0;
    function draw(time: number) {
      const moving = animated && !motion.matches && visible;
      const targetX = moving ? pointer?.x ?? width * (0.5 + Math.sin(time / 1700) * 0.12) : width / 2;
      const targetY = moving ? pointer?.y ?? height * (0.5 + Math.cos(time / 2100) * 0.10) : height / 2;
      x += (targetX - x) * (moving ? 0.12 : 1);
      y += (targetY - y) * (moving ? 0.12 : 1);
      const radius = Math.min(width, height) * 0.38;
      context.clearRect(0, 0, width, height);
      for (let row = (height % 10) / 2; row < height; row += 10) {
        for (let column = (width % 10) / 2; column < width; column += 10) {
          const dx = column - x, dy = row - y;
          const distance = Math.hypot(dx, dy);
          const proximity = Math.max(0, 1 - distance / radius);
          const strength = proximity * proximity * (3 - 2 * proximity);
          const offset = strength * strength * 9 / (distance || 1);
          context.globalAlpha = 0.16 + strength * 0.7;
          context.beginPath();
          context.arc(column + dx * offset, row + dy * offset, 0.65 + strength * 0.85, 0, Math.PI * 2);
          context.fill();
        }
      }
      if (moving) frame = requestAnimationFrame(draw);
    }
    function paint() {
      cancelAnimationFrame(frame);
      context.fillStyle = getComputedStyle(element).color;
      draw(performance.now());
    }
    const resize = new ResizeObserver(([entry]) => {
      ({ width, height } = entry.contentRect);
      const dpr = Math.min(devicePixelRatio, 2);
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      x = width / 2;
      y = height / 2;
      paint();
    });
    const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; paint(); });
    const theme = new MutationObserver(paint);
    const move = (event: PointerEvent) => { pointer = { x: event.offsetX, y: event.offsetY }; };
    const leave = () => { pointer = null; };
    resize.observe(element);
    visibility.observe(element);
    theme.observe(document.documentElement, { attributeFilter: ['data-theme'] });
    motion.addEventListener('change', paint);
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      theme.disconnect();
      motion.removeEventListener('change', paint);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', leave);
    };
  }, [animated]);
  return <canvas ref={canvas} className="image-generation-dither" aria-hidden="true" />;
}

function GeneratedPhoto({ src, name, downloadName, multiple, onError }: {
  src: string; name: string; downloadName: string; multiple: boolean; onError(): void;
}) {
  const [loaded, setLoaded] = useState(false);
  return <div className="image-generation-photo" data-loaded={loaded} aria-busy={!loaded}>
    <RemoteImage src={src} name={name} onLoad={() => setLoaded(true)} onError={onError} />
    {!loaded && <div className="image-generation-loading"><GenerationDither animated /></div>}
    {loaded && <ImageGenerationDownload src={src} name={downloadName} inMenu={multiple} />}
  </div>;
}
function ImageGenerationCard({job, endpoint, being, report, statusInActions, multiple}: {
  job:ImageGenerationJob; endpoint:string; being:string;
  report:(key:string, snapshot:GenerationSnapshot | undefined)=>void; statusInActions:boolean; multiple:boolean;
}) {
  const { ref, ready } = useNearViewport<HTMLElement>();
  const [state,setState] = useState<GenerationViewState>({busy:true,canQuery:false});
  const [imageAttempt,setImageAttempt] = useState(0);
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const watcher = useRef<ReturnType<typeof watchImageGeneration> | null>(null);
  useEffect(() => {
    if (!ready) return;
    setFailedImage(null);
    const current = watchImageGeneration(job, imageGenerationQuery(endpoint,being), setState);
    watcher.current = current;
    return () => { current.stop(); watcher.current = null; };
  },[job,endpoint,being,ready]);
  const snapshot = state.snapshot;
  useEffect(() => { report(job.client_request_id, snapshot); },[report,job.client_request_id,snapshot]);
  const outputs = snapshot?.status === 'succeeded' ? snapshot.outputs : [];
  const imageFailed = failedImage !== null && outputs.some(output => output.view_url === failedImage);
  const active = ready && !state.notice && !imageFailed && (!snapshot || snapshot.status === 'queued' || snapshot.status === 'running');
  const label = snapshot ? snapshot.status === 'running' && snapshot.stage === 'validate_convert' ? '正在校验图片' : labels[snapshot.status] : job.submission === 'unknown' ? '正在核对提交结果' : job.submission === 'rejected' ? '提交未受理' : '正在查询';
  const statusTitle = imageFailed ? '图片加载失败'
    : snapshot?.status === 'succeeded' && !outputs.length ? snapshot.availability === 'expired' ? '图片已不可用' : '生成已完成，图片暂不可用'
    : state.notice && (!snapshot || snapshot.status === 'queued' || snapshot.status === 'running') && job.submission !== 'rejected' ? '暂时无法查询'
    : label;
  const failed = imageFailed || !!state.notice || job.submission === 'rejected' || snapshot?.status === 'failed'
    || snapshot?.status === 'succeeded' && !outputs.length;
  const retry = imageFailed
    ? { label: '重新加载图片', run: () => { setImageAttempt(n => n + 1); setFailedImage(null); } }
    : state.canQuery || snapshot?.status === 'succeeded' && !outputs.length
      ? { label: '重新查询状态', disabled: state.busy, run: () => watcher.current?.retry() }
      : undefined;
  const status = !active && (ready && (!outputs.length || imageFailed) || state.notice) &&
    <ChatStatusRow title={statusTitle} detail={state.notice || (snapshot?.status === 'failed' ? snapshot.error_code || undefined : undefined)}
      tone={failed ? 'error' : 'neutral'} retry={retry} mediaStatus />;
  return <section ref={ref} className="image-generation-card" aria-label={job.title} data-generation-id={snapshot?.id || job.generation_id || undefined}>
    {outputs.length > 0 && !imageFailed ? <div className="image-generation-images">{outputs.map((output, index) =>
      <GeneratedPhoto key={`${output.view_url}:${imageAttempt}`} src={output.view_url} name={job.title}
        downloadName={outputs.length > 1 ? `${job.title} ${index + 1}` : job.title}
        multiple={multiple || outputs.length > 1} onError={() => setFailedImage(output.view_url)} />
    )}</div> : active && <div className="image-generation-placeholder" data-active={active} data-status={snapshot?.status}
      data-phase={snapshot?.stage === 'validate_convert' ? 'refining' : snapshot?.status === 'running' ? 'running' : 'queued'} aria-busy="true">
      <GenerationDither animated={snapshot?.status === 'running'} />
      <span className="image-generation-progress" role="progressbar" aria-label={label} />
    </div>}
    {status && <>
      <div className="image-generation-status-frame" aria-hidden="true" />
      {statusInActions ? <MessageAction>{status}</MessageAction> : status}
    </>}
    <div className="image-generation-caption-row">
      {active && <span className="image-generation-state" role="status"><i aria-hidden="true" />{label}</span>}
      {job.title !== label && <p className="image-generation-caption" title={job.title}>{job.title}</p>}
    </div>
  </section>;
}
const ImageGenerationMessage = memo(function ImageGenerationMessage({receipt,endpoint,statusInActions}: {receipt:ImageGenerationReceipt; endpoint:string; statusInActions:boolean}) {
  const [completed,setCompleted] = useState<Record<string,GenerationSnapshot | undefined>>({});
  const report = useCallback((key:string,value:GenerationSnapshot | undefined)=>setCompleted(previous=>previous[key] === value ? previous : {...previous,[key]:value}),[]);
  const count = receipt.jobs.filter(job=>completed[job.client_request_id]?.status === 'succeeded').length;
  const items = useMemo(() => {
    const seen = new Set<string>();
    return receipt.jobs.flatMap(job => {
      const snapshot = completed[job.client_request_id];
      return snapshot?.status === 'succeeded' ? snapshot.outputs.flatMap(output => {
        if (seen.has(output.view_url)) return [];
        seen.add(output.view_url);
        return [{src:output.view_url,name:job.title}];
      }) : [];
    });
  }, [receipt,completed]);
  return <div className="image-generation-message" aria-label="生成图片" data-count={receipt.jobs.length}>
    <div className="image-generation-header"><span className="image-generation-title"><PictureIcon/>生成图片</span><div className="image-generation-summary" role="status"><span className="image-generation-completion" aria-hidden="true">{receipt.jobs.map(job=><i key={job.client_request_id} data-complete={completed[job.client_request_id]?.status === 'succeeded'}/>)}</span><span>已生成 {count} / {receipt.jobs.length} 张</span></div></div>
    <RemoteImageGroup items={items}><div className="image-generation-grid">{receipt.jobs.map(job=><ImageGenerationCard key={job.client_request_id} job={job} endpoint={endpoint} being={receipt.being_id} report={report} statusInActions={statusInActions} multiple={receipt.jobs.length > 1}/>)}</div></RemoteImageGroup>
  </div>;
}, (previous,next)=>previous.endpoint===next.endpoint && previous.statusInActions===next.statusInActions && JSON.stringify(previous.receipt)===JSON.stringify(next.receipt));
/** Match only Being receipt messages, before Markdown or Intelligent UI rendering. */
export function ImageGenerationAnswer({text,streaming,endpoint,scope,enabled,children}: {text:string;streaming:boolean;endpoint:string;scope:string;enabled:boolean;children:ReactNode | ((text:string, blockId:string)=>ReactNode)}) {
  const blocks = useMemo(()=>imageGenerationBlocks(text),[text]);
  if (!blocks.some(block=>block.kind==='receipt')) return <>{typeof children==='function' ? children(text,'') : children}</>;
  const standalone = blocks.filter(block => block.kind === 'receipt' || block.text.trim()).length === 1;
  const seen = new Set<string>();
  return <MarkdownReferenceScope text={text}><div className="image-generation-answer">{blocks.map(block=>{
    if(block.kind==='text') return block.text.trim() ? <div key={block.id} className="image-generation-prose">{typeof children==='function' ? children(block.text,block.id) : <Markdown content={block.text} className="content" chat/>}</div> : null;
    const receipt=block.receipt;
    if(streaming) return <div key={block.id} className="image-generation-message" role="status">正在确认图片任务…</div>;
    if(!receipt) return <div key={block.id} className="image-generation-message"><ChatStatusRow title="图片任务回执格式不正确" detail="请让 Being 仅修正回执，不要重新生成。" tone="error"><details><summary>查看原始回执</summary><pre>{block.text}</pre></details></ChatStatusRow></div>;
    const identity=JSON.stringify([receipt.being_id,receipt.jobs.map(job=>job.client_request_id).sort()]);
    const duplicate=seen.has(identity);
    if(duplicate) return <p key={block.id} className="image-generation-notice">这些图片任务已在前面展示，未重复查询。</p>;
    seen.add(identity);
    if(!enabled) return <div key={block.id} className="image-generation-message" role="status">已收到 {receipt.jobs.length} 张图片的任务回执。请在桌面客户端打开本对话以查询和显示图片。</div>;
    if(!endpoint) return <div key={block.id} className="image-generation-message"><ChatStatusRow title="无法确认此对话的 Being 连接，请重新打开对话。" tone="error" /></div>;
    const statusInActions = standalone && receipt.jobs.length === 1 && document.documentElement.dataset.chatHost === 'desktop';
    return <ImageGenerationMessage key={JSON.stringify([scope,endpoint,block.id,receipt])} receipt={receipt} endpoint={endpoint} statusInActions={statusInActions}/>;
  })}</div></MarkdownReferenceScope>;
}
