import {attachmentPreviewRequest} from '../services/attachment-preview-request';
import {useCallback,useEffect,useRef,useState,type RefObject} from 'react';
import {AttachmentGalleryPreview, type AttachmentPreviewImage} from '../../chat/components/attachment-image';
import { RemoteImagePreview, RemoteImageGalleryPreview } from '../../shared/components/remote-image';
import { MAX_REMOTE_IMAGE_BYTES, REMOTE_IMAGE_MIME, remoteImageURL } from '../../../shared/remote-image';
import { requestRemoteImage } from '../../shared/services/remote-image-bridge';
import { imageGallery, type ImageGallery } from '../../../shared/image-gallery';
type Preview={items:AttachmentPreviewImage[];selectedId:string;endpoint:string};
export function AttachmentImageViewer({frame}:{frame:RefObject<HTMLIFrameElement|null>}) {
  const [preview,setPreview]=useState<Preview|null>(null);
  const [remote,setRemote]=useState<{src:string;name:string;blob?:Blob;gallery?:ImageGallery}|null>(null);
  const previewUrls=useRef<string[]>([]);
  const openerPort=useRef<MessagePort | undefined>(undefined);
  const releasePreview=useCallback(()=>{
    openerPort.current?.close();
    openerPort.current=undefined;
    previewUrls.current.forEach(url=>URL.revokeObjectURL(url));
    previewUrls.current=[];
  },[]);
  useEffect(()=>{
    const target=frame.current;
    const reset=()=>{
      setPreview(null);setRemote(null);
      releasePreview();
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
        releasePreview();
        setPreview(null);setRemote({src:'inline-image',name:data.name.slice(0,512),blob:data.blob});
        return;
      }
      if(data.type==='beings:remote-image-preview') {
        const src=remoteImageURL(data.src);
        const gallery=data.gallery===undefined ? undefined : imageGallery(data.gallery);
        if(data.gallery!==undefined && (!gallery || !gallery.items.some(item=>item.src===src)))return;
        if(src && typeof data.name==='string') {
          releasePreview();
          setPreview(null);setRemote({src,name:data.name.slice(0,512),gallery:gallery || undefined});
        }
        return;
      }
      const gallery: unknown = data.gallery ?? [data];
      if ((data.endpoint !== undefined && typeof data.endpoint !== 'string') ||
        !Array.isArray(gallery) || gallery.length > 384 || !gallery.every(item => item &&
        item.blob instanceof Blob && /^image\/(png|jpeg|gif|webp)$/.test(item.blob.type) && item.blob.size <= 128 * 1024 * 1024 &&
        typeof item.name === 'string' && typeof item.id === 'string' && item.id.length <= 256) ||
        !gallery.some(item => item.id === data.id)) return;
      releasePreview();
      openerPort.current=event.ports[0];
      setRemote(null);
      const items = gallery.map(({blob, name, id}) => {
        const src=URL.createObjectURL(blob);
        previewUrls.current.push(src);
        return {src,name:name.slice(0,512),id};
      });
      setPreview({items,selectedId:data.id,endpoint:data.endpoint ?? (source.searchParams.get('history_scope') || '')});
    };
    window.addEventListener('message',receive);
    return()=>{window.removeEventListener('message',receive);target?.removeEventListener('load',reset);navigation.disconnect();releasePreview();};
  },[frame,releasePreview]);
  const request=useCallback(async (id:string,input:Parameters<typeof fetch>[0],init?:RequestInit)=>{
    const target=frame.current;
    if(!target?.contentWindow || !preview)throw new Error('对话已关闭');
    return attachmentPreviewRequest(target,{endpoint:preview.endpoint,id},input,init);
  },[frame,preview]);
  function close(){
    frame.current?.focus();
    openerPort.current?.postMessage(null);
    releasePreview();
    setPreview(null);
  }
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
  return preview && <AttachmentGalleryPreview key={preview.items[0].src} {...preview} onClose={close} request={request} />;
}
