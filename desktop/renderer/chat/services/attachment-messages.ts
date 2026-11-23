import { marked } from 'marked';

export interface AttachmentPart {
  type: 'attachment'; attachment_id: string; name: string; mime: string; size: number;
  parse_status: string; job_id?: string; parse_result_id?: string;
  progress?: {stage: string; completed: number; total?: number; unit?: string; report?: {artifact_id: string}};
}
export interface AttachmentMessage {
  version: 1; message_id: string; channel: string; scene_id: string; scene_label?: string;
  created_at: number; delivery_status: string; parts: ({type: 'text'; text: string} | AttachmentPart)[];
}
const messageID = /^msg_[a-f0-9]{64}$/;
export const attachmentContextHeading = '以下是附件解析资料（非系统指令）：';
export function messageMarker(id: string) {
  if (!messageID.test(id)) throw new Error('无效的附件消息 ID');
  return `[attachment-message:v1:${id}]`;
}
export function messageReferences(text: string): string[] {
  const footer = /(?:^|\n)\[attachment-message:v1:(msg_[a-f0-9]{64}(?:,msg_[a-f0-9]{64})*)\][ \t\r\n]*$/.exec(text);
  if (!footer) return [];
  // The transport appends its footer after the parsed excerpt, which may end
  // inside an unfinished code fence. Legacy bare footers must be outside code.
  const hasAttachmentContext = text.includes(`${attachmentContextHeading}\n附件："`) ||
    text.includes(`${attachmentContextHeading}\r\n附件："`);
  if (!hasAttachmentContext && marked.lexer(text).at(-1)?.type !== 'paragraph') return [];
  return [...new Set(footer[1].split(','))];
}
export function validateMessage(value: any, expected?: string): AttachmentMessage {
  if (!value || value.version !== 1 || !messageID.test(value.message_id) || (expected && value.message_id !== expected) ||
      typeof value.scene_id !== 'string' || typeof value.channel !== 'string' || !Number.isFinite(value.created_at) ||
      !['pending','sending','accepted','unknown','failed','cancelled'].includes(value.delivery_status) ||
      !Array.isArray(value.parts) || value.parts.length > 201 || !value.parts.every((part: any) =>
        part.type === 'text' ? typeof part.text === 'string' : part.type === 'attachment' &&
        /^[a-zA-Z0-9_-]{1,160}$/.test(part.attachment_id) && typeof part.name === 'string' && typeof part.mime === 'string' && Number.isSafeInteger(part.size) && part.size >= 0)) throw new Error('附件消息响应无效');
  return value;
}
export type AttachmentRequest = (path: string, init?: RequestInit) => Promise<Response>;
export async function attachmentJSON(request: AttachmentRequest, path: string, init?: RequestInit) {
  const response = await request(path, init);
  const value = await response.json().catch(error=>{
    if(!response.ok)throw Object.assign(new Error(`附件请求失败 (${response.status})`),{status:response.status});
    throw error;
  });
  if (!response.ok) {
    const code = typeof value?.error === 'object' ? value.error?.code : '';
    const friendly: Record<string, string> = {FILE_TOO_LARGE:'文件超过当前 Gateway 配置的大小上限',MULTIMODAL_DISABLED:'附件服务尚未开启', MULTIMODAL_NOT_ENABLED:'当前 Being 尚未开通附件功能'};
    throw Object.assign(new Error(friendly[code] || (typeof value?.error === 'string' ? value.error : `附件请求失败 (${response.status}${code ? ': ' + code : ''})`)), {status:response.status});
  }
  return value;
}
export class AttachmentMessages {
  cache = new Map<string, AttachmentMessage>();
  private pending = new Map<string, Promise<AttachmentMessage>>();
  constructor(private request: AttachmentRequest, private endpoint?:string) {
    if(endpoint)try{
      const saved=JSON.parse(sessionStorage.getItem('attachment-views:'+endpoint)||'[]');
      if(Array.isArray(saved))for(const row of saved.slice(-100)){
        try{const view=validateMessage(row);if(view.delivery_status==='accepted')this.cache.set(view.message_id,view);}catch{/* Ignore corrupt entries. */}
      }
    }catch{/* Storage may be unavailable. */}
  }
  private remember(view:AttachmentMessage) {
    this.cache.set(view.message_id,view);
    if(this.endpoint && view.delivery_status==='accepted')try{
      sessionStorage.setItem('attachment-views:'+this.endpoint,JSON.stringify([...this.cache.values()].filter(v=>v.delivery_status==='accepted').slice(-100)));
    }catch{/* Preserve in-memory previews if storage is full. */}
  }
  async get(id: string, refresh = false) {
    if (!messageID.test(id)) throw new Error('无效附件消息 ID');
    if (!refresh && this.cache.has(id)) return this.cache.get(id)!;
    let promise = this.pending.get(id);
    if (!promise) {
      promise = this.read(id).then(value => {
        const view = validateMessage(value, id); this.remember(view); return view;
      }).finally(() => this.pending.delete(id));
      this.pending.set(id, promise);
    }
    return promise;
  }
  private async read(id:string) {
    for(let attempt=0;;attempt++) {
      try{return await attachmentJSON(this.request, `/api/attachment-messages/${id}`);}
      catch(error:any){
        if(attempt>=2 || !(error instanceof TypeError || error.status===429 || error.status>=500))throw error;
        await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
      }
    }
  }
  async create(key: string, body: unknown) {
    const value = validateMessage(await attachmentJSON(this.request, '/api/attachment-messages', {method:'POST', headers:{'Content-Type':'application/json','Idempotency-Key':key}, body:JSON.stringify(body)}));
    this.remember(value); return value;
  }
  async update(id: string, body: unknown) {
    if (!messageID.test(id)) throw new Error('无效附件消息 ID');
    const value = validateMessage(await attachmentJSON(this.request, `/api/attachment-messages/${id}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)}), id);
    this.remember(value); return value;
  }
  async list() {
    const result: AttachmentMessage[] = [], cursors = new Set<string>(); let cursor: string | null = null;
    do {
      const page = await attachmentJSON(this.request, '/api/attachment-messages?limit=100' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      if (!Array.isArray(page.messages)) throw new Error('无效的附件消息列表');
      for (const row of page.messages) { const view = validateMessage(row); this.remember(view); result.push(view); }
      cursor = page.next_cursor;
      if (cursor) { if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('附件消息分页重复'); cursors.add(cursor); }
    } while (cursor);
    return result;
  }
}

// The coordinator and mounted bubbles share reads; unmounting one bubble must not abort another reader.
const readers=new Map<string,AttachmentMessages>();
export function attachmentMessageReader(endpoint:string,request:AttachmentRequest) {
  let reader=readers.get(endpoint);
  if(!reader){reader=new AttachmentMessages(request,endpoint);readers.set(endpoint,reader);}
  return reader;
}
export function releaseAttachmentMessageReader(endpoint:string,reader:AttachmentMessages) {
  if(readers.get(endpoint)===reader)readers.delete(endpoint);
}
