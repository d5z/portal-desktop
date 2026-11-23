import {uploadAttachment, type UploadProgress} from './attachment-transfer';
import type { Attachment } from '../models/chat';
import { attachmentContextHeading, attachmentJSON, AttachmentMessages, messageMarker, type AttachmentMessage, type AttachmentRequest } from './attachment-messages';
export interface AttachmentTransfer {
  messageId?: string;
  delivery?: 'pending' | 'sending' | 'accepted' | 'unknown' | 'failed' | 'cancelled';
}
export async function readParsed(request: AttachmentRequest, attachmentId: string, resultId: string, budget = 100000) {
  let cursor: string | null = null, count = 0, total: number | undefined, text = '', truncated = false;
  const seen = new Set<string>();
  do {
    const page = await attachmentJSON(request, `/api/attachments/${encodeURIComponent(attachmentId)}/parsed?limit=100&parse_result_id=${encodeURIComponent(resultId)}` + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
    if (page.attachment_id !== attachmentId || page.parse_result_id !== resultId || page.complete !== true || page.coverage?.complete === false || !Array.isArray(page.segments) ||
      !Number.isSafeInteger(page.total_segments) || page.total_segments < 0 || (total !== undefined && total !== page.total_segments)) throw new Error('附件解析结果不完整或版本已变化');
    total = page.total_segments;
    for (const segment of page.segments) {
      if (typeof segment.text !== 'string') throw new Error('无效解析片段');
      const part = `\n${JSON.stringify(segment.location || {})}\n${segment.text}\n`;
      const remaining = Math.max(0, budget - text.length);
      text += part.slice(0, remaining); if (part.length > remaining) truncated = true;
      count++;
    }
    cursor = page.next_cursor;
    if (cursor) { if (typeof cursor !== 'string' || seen.has(cursor) || !page.segments.length) throw new Error('附件分页无效'); seen.add(cursor); }
    if (count > total!) throw new Error('附件分段数不一致');
  } while (cursor);
  if (count !== total) throw new Error('附件解析分段缺失');
  return {text, truncated};
}
function delay(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1500);
    signal.addEventListener('abort', abort, {once:true});
  });
}
export async function prepareAttachments(input: {
  key: string; text: string; files: Attachment[]; sceneId: string; sceneLabel?: string; transfer: AttachmentTransfer;
  request: AttachmentRequest; signal: AbortSignal; save: () => Promise<void>; show: (view: AttachmentMessage) => void; progress?: (file: Attachment, value: UploadProgress) => void;
}) {
  const {files, request, signal, transfer, save, show} = input;
  const views = new AttachmentMessages(request);
  for (const file of files) {
    signal.throwIfAborted();
    if (!file.uploadKey) { file.uploadKey = crypto.randomUUID(); await save(); }
    if (!file.attachmentId) {
      // Decode only pre-migration persisted rows; new desktop files stay binary.
      const bytes = file.blob || Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
      const attachment = await uploadAttachment(request, '/api/attachments?filename=' + encodeURIComponent(file.name), {
        method:'POST', headers:{'Content-Type':file.type || 'application/octet-stream','Idempotency-Key':file.uploadKey,...(file.sourceToken ? {'X-Portal-Attachment-Source':file.sourceToken} : {})}, body:bytes,
      }, value => { file.uploadProgress = value; input.progress?.(file, value); });
      file.attachmentId = attachment.attachment_id;
      file.uploadProgress = {phase:'complete',loaded:file.size,total:file.size};
      input.progress?.(file, file.uploadProgress);
      file.base64 = ''; delete file.blob; delete file.previewUrl; await save();
    }
  }
  let view = transfer.messageId ? await views.get(transfer.messageId, true) : await views.create(input.key, {
    text:input.text, scene_id:input.sceneId, scene_label:input.sceneLabel, attachment_ids:files.map(file => file.attachmentId),
  });
  transfer.messageId = view.message_id; transfer.delivery = view.delivery_status as AttachmentTransfer['delivery']; await save(); show(view);
  if (['accepted','sending','unknown','cancelled'].includes(view.delivery_status)) throw new Error('此附件消息已发送或发送状态待确认，不会自动重发');
  for (const file of files) {
    if (!file.jobId) {
      const part = view.parts.find(p => p.type === 'attachment' && p.attachment_id === file.attachmentId);
      if (!file.forceParse && part?.type === 'attachment' && part.job_id) file.jobId = part.job_id;
      else {
        const force = file.forceParse === true;
        if (force) { file.forceParse = false; await save(); }
        const job = await attachmentJSON(request, `/api/attachments/${file.attachmentId}/parse`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({options:{}, force})});
        if (!/^[a-zA-Z0-9_-]{1,160}$/.test(job.job_id) || job.attachment_id !== file.attachmentId) throw new Error('无效解析任务');
        file.jobId = job.job_id; file.forceParse = false;
      }
      await save();
    }
  }
  view = await views.update(view.message_id, {jobs:files.map(f => ({attachment_id:f.attachmentId, job_id:f.jobId})), delivery_status:'pending'}); show(view);
  const contexts: string[] = [];
  for (const file of files) {
    for (;;) {
      signal.throwIfAborted();
      const job = await attachmentJSON(request, `/api/media-jobs/${file.jobId}`);
      if (job.attachment_id !== file.attachmentId || job.job_id !== file.jobId) throw new Error('解析任务不匹配');
      const part = view.parts.find(p => p.type === 'attachment' && p.attachment_id === file.attachmentId);
      if (part?.type === 'attachment') { part.progress = job.progress; part.parse_status = job.status === 'succeeded' ? 'ready' : job.status === 'failed' ? 'failed' : 'parsing'; part.parse_result_id = job.result_id; show({...view}); }
      if (job.status === 'failed') { file.parseFailed = true; await save(); throw new Error(`附件解析失败：${file.name} (${job.error_code || 'FAILED'})`); }
      if (job.status === 'succeeded') {
        if (typeof job.result_id !== 'string' || !job.result_id) throw new Error('解析结果版本缺失');
        file.resultId = job.result_id; await save();
        const parsed = await readParsed(request, file.attachmentId!, file.resultId!, Math.floor(100000 / files.length));
        contexts.push(`附件：${JSON.stringify(file.name)}\n${parsed.truncated ? '以下为节选，非全文；完整内容可在附件详情下载。' : '以下为完整解析内容。'}\n${parsed.text}`); break;
      }
      if (!['pending','retry','running'].includes(job.status)) throw new Error('未知解析状态');
      await delay(signal);
    }
  }
  show(await views.get(view.message_id, true));
  return `${input.text}\n\n${attachmentContextHeading}\n${contexts.join('\n\n')}\n\n${messageMarker(view.message_id)}`;
}
