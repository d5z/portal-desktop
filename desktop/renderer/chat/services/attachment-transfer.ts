import {attachmentJSON, type AttachmentRequest} from './attachment-messages';
import {attachmentError} from '../../../shared/attachment-error';
export interface UploadProgress {phase:string; loaded:number; total:number; error?:string}
export async function uploadAttachment(request: AttachmentRequest, path: string, init: RequestInit, progress: (value: UploadProgress) => void) {
  let latest: UploadProgress = {phase:'preparing',loaded:0,total:0};
  const report = (value: UploadProgress) => { latest = value; progress(value); };
  const confirmed = (value: any) => {
    if (!value || !/^[a-zA-Z0-9_-]{1,160}$/.test(value.attachment_id) || value.status !== 'ready') throw new Error('附件上传尚未确认，请重试');
    return value;
  };
  report(latest);
  try {
    const response = await request(path, {...init, headers:{...init.headers, Accept:'application/x-ndjson'}});
    if (!response.headers.get('Content-Type')?.includes('application/x-ndjson')) return confirmed(await attachmentJSON(async () => response, path));
    const reader = response.body!.getReader(), decoder = new TextDecoder();
    let pending = '', attachment: any;
    try {
      for (;;) {
        const chunk = await reader.read();
        pending += decoder.decode(chunk.value, {stream:!chunk.done});
        let end: number;
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0,end); pending = pending.slice(end + 1);
          if (!line) continue;
          const event = JSON.parse(line);
          if (event.type === 'error') {
            await attachmentJSON(async () => Response.json({error:event.error}, {status:event.status || 502}), path);
          }
          if (event.type === 'progress') report(event);
          if (event.type === 'complete') attachment = event.attachment;
        }
        if (chunk.done) break;
      }
      if (!attachment || pending.trim()) throw new Error('附件上传确认中断，请重试');
      return confirmed(attachment);
    } finally { await reader.cancel().catch(() => {}); }
  } catch (error) {
    const message = attachmentError(error);
    report({...latest, phase:'failed', error:message});
    // Queue notices also display this exception; keep them sanitized like the card.
    throw Object.assign(new Error(message), {status:(error as {status?:number} | null)?.status});
  }
}
