import { Icon } from '../../shared/icons/icon';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { type GenerationSnapshot, type ImageGenerationJob, type ImageGenerationReceipt } from '../../../shared/image-generation';
import { imageGenerationBlocks } from '../../../shared/image-generation-blocks';
import { Markdown } from '../../shared/components/markdown';
import { MarkdownReferenceScope } from '../../shared/components/markdown-references';
import { RemoteImage, RemoteImageGroup } from '../../shared/components/remote-image';
import { ImageGenerationDownload } from './image-generation-download';
import { imageGenerationQuery, watchImageGeneration, type GenerationViewState } from '../services/image-generations';
import { useNearViewport } from '../../shared/hooks/use-near-viewport';

const labels: Record<GenerationSnapshot['status'],string> = {queued:'排队中', running:'生成中', uncertain:'结果待核对', succeeded:'生成成功', failed:'生成失败', cancelled:'已取消'};
function PictureIcon() {
  return <Icon name="image-rounded" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />;
}
function GenerationSkeleton({label, phase}: {label:string;phase:'running'|'queued'}) {
  return <>
    <div className="image-generation-skeleton" aria-hidden="true">
      <div className="generation-aurora"/><div className="generation-aurora generation-aurora-secondary"/>
      <div className="generation-skeleton-frame"><span className="generation-skeleton-tag"/><span className="generation-skeleton-corner"/>
        <div className="generation-skeleton-glyph"><Icon name="sparkles" width="34" height="34" fill="none" /></div>
        <div className="generation-skeleton-lines"><i/><i/></div>
      </div>
      <div className="generation-shimmer"/>
    </div>
    <div className="generation-skeleton-status" role="status"><span className="generation-status-dot" aria-hidden="true"/>{label}</div>
    <span className="generation-skeleton-accessible" role="progressbar" aria-label={`${phase==='running'?'图片生成':'图片排队'}，进度未知`}/>
  </>;
}
function ImageGenerationCard({job, endpoint, being, report}: {job:ImageGenerationJob; endpoint:string; being:string; report:(key:string, snapshot:GenerationSnapshot | undefined)=>void}) {
  const { ref, ready } = useNearViewport<HTMLElement>();
  const [state,setState] = useState<GenerationViewState>({busy:true,canQuery:false});
  const [imageAttempt,setImageAttempt] = useState(0);
  const [imageFailed,setImageFailed] = useState(false);
  const watcher = useRef<ReturnType<typeof watchImageGeneration> | null>(null);
  useEffect(() => {
    if (!ready) return;
    setImageFailed(false);
    const current = watchImageGeneration(job, imageGenerationQuery(endpoint,being), setState);
    watcher.current = current;
    return () => { current.stop(); watcher.current = null; };
  },[job,endpoint,being,ready]);
  const snapshot = state.snapshot;
  useEffect(() => { report(job.client_request_id, snapshot); },[report,job.client_request_id,snapshot]);
  const outputs = snapshot?.status === 'succeeded' ? snapshot.outputs : [];
  const active = ready && !state.notice && (!snapshot || snapshot.status === 'queued' || snapshot.status === 'running');
  const label = snapshot ? snapshot.status === 'running' && snapshot.stage === 'validate_convert' ? '正在校验图片' : labels[snapshot.status] : job.submission === 'unknown' ? '正在核对提交结果' : job.submission === 'rejected' ? '提交未受理' : '正在查询';
  return <section ref={ref} className="image-generation-card" aria-label={job.title} data-generation-id={snapshot?.id || job.generation_id || undefined}>
    {outputs.length > 0 && !imageFailed ? <div className="image-generation-images">{outputs.map(output => <div className="image-generation-photo" key={`${output.id}:${imageAttempt}`}><RemoteImage src={output.view_url} name={job.title} onError={()=>setImageFailed(true)} /><ImageGenerationDownload src={output.view_url} name={job.title}/><span className="image-generation-zoom" aria-hidden="true">查看大图 ↗</span></div>)}</div>
      : <div className="image-generation-placeholder" data-active={active} data-phase={snapshot?.status==='running'?'running':'queued'} aria-busy={active}
        style={{'--generation-offset':`${job.index * -1.3}s`} as CSSProperties}>
        {active ? <GenerationSkeleton label={label} phase={snapshot?.status==='running'?'running':'queued'}/> :
        <span role="status">{imageFailed ? '图片加载失败，生成任务已成功。' : snapshot?.status === 'succeeded' ? snapshot.availability === 'expired' ? '图片已不可用。' : '生成已完成，图片暂不可用。' : label}</span>}
      </div>}
    <div className="image-generation-caption-row"><span className="image-generation-number" aria-hidden="true">{String(job.index).padStart(2,'0')}</span><p className="image-generation-caption" title={job.title}>{job.title}</p></div>
    {snapshot?.status === 'failed' && snapshot.error_code && <p className="image-generation-notice">{snapshot.error_code}</p>}
    {state.notice && <p className="image-generation-notice" role="status">{state.notice}</p>}
    {(state.canQuery || imageFailed || snapshot?.status === 'succeeded' && !outputs.length) && <div className="image-generation-actions">
      {imageFailed && <button type="button" onClick={()=>{setImageAttempt(n=>n+1);setImageFailed(false);}}>重新加载图片</button>}
      <button type="button" disabled={state.busy} onClick={()=>{setImageFailed(false);setImageAttempt(n=>n+1);watcher.current?.retry();}}>{state.busy ? '查询中…' : '重新查询状态'}</button>
    </div>}
  </section>;
}
const ImageGenerationMessage = memo(function ImageGenerationMessage({receipt,endpoint}: {receipt:ImageGenerationReceipt; endpoint:string}) {
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
    <RemoteImageGroup items={items}><div className="image-generation-grid">{receipt.jobs.map(job=><ImageGenerationCard key={job.client_request_id} job={job} endpoint={endpoint} being={receipt.being_id} report={report}/>)}</div></RemoteImageGroup>
  </div>;
}, (previous,next)=>previous.endpoint===next.endpoint && JSON.stringify(previous.receipt)===JSON.stringify(next.receipt));
/** Match only Being receipt messages, before Markdown or Intelligent UI rendering. */
export function ImageGenerationAnswer({text,streaming,endpoint,scope,enabled,children}: {text:string;streaming:boolean;endpoint:string;scope:string;enabled:boolean;children:ReactNode | ((text:string, blockId:string)=>ReactNode)}) {
  const blocks = useMemo(()=>imageGenerationBlocks(text),[text]);
  if (!blocks.some(block=>block.kind==='receipt')) return <>{typeof children==='function' ? children(text,'') : children}</>;
  const seen = new Set<string>();
  return <MarkdownReferenceScope text={text}><div className="image-generation-answer">{blocks.map(block=>{
    if(block.kind==='text') return block.text.trim() ? <div key={block.id} className="image-generation-prose">{typeof children==='function' ? children(block.text,block.id) : <Markdown content={block.text} className="content" chat/>}</div> : null;
    const receipt=block.receipt;
    if(streaming) return <div key={block.id} className="image-generation-message" role="status">正在接收图片任务回执…</div>;
    if(!receipt) return <div key={block.id} className="image-generation-message"><p role="alert">图片任务回执格式不正确，无法自动查询。请让 Being 仅修正回执，不要重新生成。</p><details><summary>查看原始回执</summary><pre>{block.text}</pre></details></div>;
    const identity=JSON.stringify([receipt.being_id,receipt.jobs.map(job=>job.client_request_id).sort()]);
    const duplicate=seen.has(identity);
    if(duplicate) return <p key={block.id} className="image-generation-notice">这些图片任务已在前面展示，未重复查询。</p>;
    seen.add(identity);
    if(!enabled) return <div key={block.id} className="image-generation-message" role="status">已收到 {receipt.jobs.length} 张图片的任务回执。请在桌面客户端打开本对话以查询和显示图片。</div>;
    if(!endpoint) return <div key={block.id} className="image-generation-message" role="alert">无法确认此对话的 Being 连接，请重新打开对话。</div>;
    return <ImageGenerationMessage key={JSON.stringify([scope,endpoint,block.id,receipt])} receipt={receipt} endpoint={endpoint}/>;
  })}</div></MarkdownReferenceScope>;
}
