/** Keep preview requests bounded even when their chat card has been unmounted. */
export function attachmentPreviewRequest(target:HTMLIFrameElement, file:{id:string;endpoint:string}, input:RequestInfo|URL, init?:RequestInit):Promise<Response> {
  if(!target.contentWindow)return Promise.reject(new Error('对话已关闭'));
  if(init?.signal?.aborted)return Promise.reject(new DOMException('Cancelled','AbortError'));
  const channel=new MessageChannel();
  const action=new URL(String(input),'https://local').searchParams.get('action') || 'check';
  return new Promise((resolve,reject)=>{
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
    let body:ReadableStreamDefaultController<Uint8Array>|undefined;
    let finished=false;
    const cleanup=()=>{finished=true;clearTimeout(timer);init?.signal?.removeEventListener('abort',abort);channel.port1.close();channel.port2.close();};
    const fail=(error:Error)=>{if(finished)return;channel.port1.postMessage('abort');void reader?.cancel().catch(()=>{});body?.error(error);cleanup();reject(error);};
    const abort=()=>fail(new DOMException('Cancelled','AbortError'));
    // A download may be waiting for the native save dialog; allow time to choose a path.
    const timer=setTimeout(()=>fail(new Error('附件操作超时，请关闭预览后重试')),action==='download'?120000:15000);
    init?.signal?.addEventListener('abort',abort,{once:true});
    channel.port1.onmessage=event=>{
      if(finished)return;
      clearTimeout(timer);
      const data=event.data;
      if(data.error){fail(new Error(data.error));return;}
      try {
        reader=data.body?.getReader();
        const stream=reader ? new ReadableStream<Uint8Array>({
          start(controller){body=controller;},
          async pull(controller){try{const chunk=await reader!.read();if(finished)return;if(chunk.done){controller.close();cleanup();}else controller.enqueue(chunk.value);}catch(error){fail(error instanceof Error?error:new Error(String(error)));}},
          cancel(){channel.port1.postMessage('abort');const pending=reader!.cancel();cleanup();return pending;},
        }) : null;
        resolve(new Response(stream,{status:data.status,headers:data.headers}));
        if(!reader)cleanup();
      }catch(error){fail(error instanceof Error?error:new Error(String(error)));}
    };
    channel.port1.onmessageerror=()=>fail(new Error('无法读取附件响应，请重试'));
    try{target.contentWindow!.postMessage({type:'beings:image-download',revision:new URL(target.src).searchParams.get('revision'),id:file.id,endpoint:file.endpoint,action},'beings://chat',[channel.port2]);}catch(error){fail(error instanceof Error?error:new Error(String(error)));}
  });
}
