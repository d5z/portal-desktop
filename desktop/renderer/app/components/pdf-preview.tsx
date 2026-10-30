import {useEffect,useRef,useState} from 'react';
import type {getDocument,PDFDocumentProxy} from 'pdfjs-dist';
function PdfPage({pdf,page}:{pdf:PDFDocumentProxy;page:number}) {
  const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const [visible,setVisible]=useState(false),[ratio,setRatio]=useState(.707),[error,setError]=useState('');
  useEffect(()=>{const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting),{root:host.current?.closest('.pdf-pages'),rootMargin:'600px'});if(host.current)observer.observe(host.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{
    if(!visible)return;
    let disposed=false,render:ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']>|undefined;
    void pdf.getPage(page).then(p=>{
      if(disposed||!canvas.current)return;
      const native=p.getViewport({scale:1});setRatio(native.width/native.height);
      const viewport=p.getViewport({scale:Math.min(3,1500/native.width)}),target=canvas.current;
      target.width=viewport.width;target.height=viewport.height;
      render=p.render({canvas:target,viewport});return render.promise;
    }).catch(()=>{if(!disposed)setError('此页无法显示，请打开原文件查看。');});
    return()=>{disposed=true;render?.cancel();if(canvas.current){canvas.current.width=0;canvas.current.height=0;}};
  },[pdf,page,visible]);
  return <div ref={host} className="pdf-page" style={{aspectRatio:ratio}}>{error?<p role="alert">{error}</p>:<canvas ref={canvas} aria-label={`PDF 第 ${page} 页`}/>}</div>;
}
export function PdfPreview({blob}:{blob:Blob}) {
  const [pdf,setPdf]=useState<PDFDocumentProxy|null>(null),[error,setError]=useState('');
  useEffect(()=>{
    let disposed=false,task:ReturnType<typeof getDocument>|undefined;
    setPdf(null);setError('');
    void Promise.all([import('pdfjs-dist'),blob.arrayBuffer()]).then(([{getDocument,GlobalWorkerOptions},data])=>{
      if(disposed)return;
      GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.js',location.href).href;
      task=getDocument({data:new Uint8Array(data),useWasm:false,cMapUrl:new URL('pdf-cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('pdf-fonts/',location.href).href});
      return task.promise.then(doc=>{if(!disposed)setPdf(doc);});
    }).catch(()=>{if(!disposed)setError('PDF 无法预览（文件可能加密或损坏），请打开原文件。');});
    return()=>{disposed=true;void task?.destroy();};
  },[blob]);
  return <div className="pdf-pages" aria-label="PDF 连续页面">{error?<p role="alert">{error}</p>:!pdf?<p role="status">正在加载页面…</p>:Array.from({length:pdf.numPages},(_,i)=><PdfPage key={i} pdf={pdf} page={i+1}/>)}</div>;
}
