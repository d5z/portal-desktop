import { RemoteImage } from '../../shared/components/remote-image';

export function AttachmentImageUpload({src,name,blob,status,percent}:{src:string;name:string;blob:Blob;status?:string;percent?:number}) {
  return <section className="attachment-image-card attachment-image-upload" aria-label={name}>
    {src && <RemoteImage src={src} name={name} blob={blob}/>}
    {status && <div>
      <span role="status">{status}</span>
      {percent !== undefined && <progress aria-label={`${name} 上传进度`} max={100} value={percent}/>}
    </div>}
  </section>;
}
