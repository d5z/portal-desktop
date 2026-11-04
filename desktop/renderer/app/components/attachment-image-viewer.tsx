import {attachmentPreviewRequest} from '../services/attachment-preview-request';
import {useCallback,useEffect,useState,type RefObject} from 'react';
import {AttachmentDownload} from '../../chat/components/attachment-download';
import { RemoteImagePreview, RemoteImageGalleryPreview } from '../../shared/components/remote-image';
import { MAX_REMOTE_IMAGE_BYTES, REMOTE_IMAGE_MIME, remoteImageURL } from '../../../shared/remote-image';
import { requestRemoteImage } from '../../shared/services/remote-image-bridge';
import { imageGallery, type ImageGallery } from '../../../shared/image-gallery';
import { ImageViewer } from '../../shared/components/image-viewer';

type Preview={src:string;name:string;id:string;endpoint:string};
export function AttachmentImageViewer({frame}:{frame:RefObject<HTMLIFrameElement|null>}) {
  const [preview,setPreview]=useState<Preview|null>(null);
  const [remote,setRemote]=useState<{src:string;name:string;blob?:Blob;gallery?:ImageGallery}|null>(null);
  useEffect(()=>{
    let url='';
    const target=frame.current;
    const reset=()=>{
      setPreview(null);setRemote(null);
      if(url){URL.revokeObjectURL(url);url='';}
    };
    // The shell survives chat navigation. Drop the previous document's images and loaders.
    const navigation=new MutationObserver(reset);
    if(target){target.addEventListener('load',reset);navigation.observe(target,{attributes:true,attributeFilter:['src']});}
    const receive=(event:MessageEvent)=>{
      const target=frame.current, data=event.data;
      if(!target?.src || event.source!==target.contentWindow || event.origin!=='beings://chat' || !['beings:image-preview','beings:remote-image-preview','beings:inline-image-preview','beings:remote-image-gallery-update'].includes(data?.type))return;
      const source=new URL(target.src);
      if(data.revision!==source.searchParams.get('revision'))return;
      if(data.type==='beings:remote-image-gallery-update') {
        const gallery=imageGallery(data.gallery);
        if(gallery) setRemote(current=>current?.gallery?.id===gallery.id ? gallery.items.length ? {...current,gallery} : null : current);
        return;
      }
      if(data.type==='beings:inline-image-preview') {
        if(!(data.blob instanceof Blob) || !REMOTE_IMAGE_MIME.test(data.blob.type) || data.blob.size>MAX_REMOTE_IMAGE_BYTES || typeof data.name!=='string')return;
        if(url){URL.revokeObjectURL(url);url='';}
        setPreview(null);setRemote({src:'inline-image',name:data.name.slice(0,512),blob:data.blob});
        return;
      }
      if(data.type==='beings:remote-image-preview') {
        const src=remoteImageURL(data.src);
        const gallery=data.gallery===undefined ? undefined : imageGallery(data.gallery);
        if(data.gallery!==undefined && (!gallery || !gallery.items.some(item=>item.src===src)))return;
        if(src && typeof data.name==='string') {
          if(url){URL.revokeObjectURL(url);url='';}
          setPreview(null);setRemote({src,name:data.name.slice(0,512),gallery:gallery || undefined});
        }
        return;
      }
      if(data.revision!==source.searchParams.get('revision') || !(data.blob instanceof Blob) || !/^image\/(png|jpeg|gif|webp)$/.test(data.blob.type) || data.blob.size>128*1024*1024 || typeof data.name!=='string' || typeof data.id!=='string' || data.id.length>256)return;
      if(url)URL.revokeObjectURL(url);
      setRemote(null);
      url=URL.createObjectURL(data.blob);
      setPreview({src:url,name:data.name.slice(0,512),id:data.id,endpoint:source.searchParams.get('history_scope') || ''});
    };
    window.addEventListener('message',receive);
    return()=>{window.removeEventListener('message',receive);target?.removeEventListener('load',reset);navigation.disconnect();if(url)URL.revokeObjectURL(url);};
  },[frame]);
  const request=useCallback<typeof fetch>(async (input,init)=>{
    const target=frame.current;
    if(!target?.contentWindow || !preview)throw new Error('对话已关闭');
    return attachmentPreviewRequest(target,preview,input,init);
  },[frame,preview]);
  function close(){if(preview)URL.revokeObjectURL(preview.src);setPreview(null);frame.current?.focus();}
  const loadRemote=useCallback((signal:AbortSignal)=>{
    if(!frame.current || !remote)return Promise.reject(new Error('对话已关闭'));
    if(remote.blob)return Promise.resolve(remote.blob);
    return requestRemoteImage(frame.current,remote.src,signal);
  },[frame,remote]);
  const loadGallery=useCallback((src:string,signal:AbortSignal)=>{
    if(!frame.current)return Promise.reject(new Error('对话已关闭'));
    return requestRemoteImage(frame.current,src,signal);
  },[frame]);
  if(remote?.gallery)return <RemoteImageGalleryPreview key={remote.gallery.id} initialSrc={remote.src} items={remote.gallery.items} load={loadGallery} onClose={()=>{setRemote(null);frame.current?.focus();}}/>;
  if(remote)return <RemoteImagePreview key={remote.src} src={remote.src} name={remote.name} load={loadRemote} onClose={()=>{setRemote(null);frame.current?.focus();}}/>;
  return preview && <ImageViewer key={preview.src} src={preview.src} name={preview.name} onClose={close}
    actions={<AttachmentDownload key={JSON.stringify([preview.endpoint,preview.id])} request={request} endpoint={preview.endpoint} id={preview.id} name={preview.name}>下载原图</AttachmentDownload>} />;
}
