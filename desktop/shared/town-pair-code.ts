import { townPairPrompt } from './town-pairing';

// Only assistant text is inspected. Tool results, thinking and metadata
// are not pairing codes. Wait for the reply to finish before accepting a code
// so a six-character prefix split across SSE chunks cannot be confirmed.
export async function requestTownPairCode(connection: { endpoint: string; token: string }, requestId: string, signal: AbortSignal, fetcher: typeof fetch = fetch, client = 'portal-desktop', prompt = townPairPrompt): Promise<string> {
  const url = new URL(connection.endpoint + '/api/chat/stream');
  url.searchParams.set('token', connection.token);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const abortRead = () => { void reader?.cancel().catch(() => {}); };
  try {
    const response = await fetcher(url.href, {
      method: 'POST', credentials: 'omit', redirect: 'error', signal,
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt, session_id: 'town-pair-' + requestId,
        scene_id: 'town-pair-' + requestId, scene_meta: { client, scene_label: 'Town 配对' } }),
    });
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      await response.body?.cancel();
      throw new Error('无法通过当前 Being 对话取得配对码，请使用手动配对。');
    }
    reader = response.body.getReader();
    signal.addEventListener('abort', abortRead, { once: true });
    signal.throwIfAborted();
    const decoder = new TextDecoder();
    let buffer = '', event = '', lines: string[] = [], text = '', finished = false, bytes = 0;
    const codesInReply = () => [...new Set(text.match(/(?<![A-Za-z0-9])[A-Z0-9]{6}(?![A-Za-z0-9])/g) || [])];
    const dispatch = () => {
      const payload = lines.join('\n'), kind = event || 'message';
      event = ''; lines = [];
      if (!payload) return;
      if (payload === '[DONE]') { finished = true; return; }
      let data: Record<string, any>;
      try { data = JSON.parse(payload); } catch { throw new Error('Being 回复格式无效，请使用手动配对。'); }
      if (!data || typeof data !== 'object') return;
      const type = kind === 'message' && typeof data.type === 'string' ? data.type : kind;
      if (type === 'error') throw new Error('Being 未能完成配对请求，请使用手动配对。');
      if (['done', 'end'].includes(type)) { finished = true; return; }
      if (type === 'message_stop') {
        // Heart can yield one reply and continue on the same stream. A reply
        // without a code is not terminal; never join fragments across replies.
        if (codesInReply().length) finished = true;
        else text = '';
        return;
      }
      const delta = type === 'content_block_delta' && (!data.delta?.type || data.delta.type === 'text_delta')
        ? data.delta?.text
        : ['text', 'message'].includes(type) ? data.text ?? data.content : undefined;
      if (typeof delta === 'string') text += delta;
      if (text.length > 8192) throw new Error('Being 未返回明确的配对码，请使用手动配对。');
    };
    const consume = (final = false) => {
      while (!finished) {
        const position = buffer.search(/[\r\n]/);
        if (position < 0 || !final && buffer[position] === '\r' && position === buffer.length - 1) break;
        const line = buffer.slice(0, position);
        buffer = buffer.slice(position + (buffer[position] === '\r' && buffer[position + 1] === '\n' ? 2 : 1));
        if (!line) { dispatch(); continue; }
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
      }
    };
    while (!finished) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) {
        buffer += decoder.decode() + '\n\n'; consume(true); break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) throw new Error('Being 回复过长，请使用手动配对。');
      buffer += decoder.decode(chunk.value, { stream: true });
      consume();
    }
    const codes = codesInReply();
    if (codes.length !== 1) throw new Error('未收到唯一的 6 位配对码，请使用手动配对。');
    return codes[0];
  } catch (error) {
    signal.throwIfAborted();
    // Fetch errors can contain the authenticated Loom URL. Never forward it.
    if (error instanceof Error && /请使用手动配对。$/.test(error.message)) throw error;
    throw new Error('无法读取 Being 配对回复，请使用手动配对。');
  } finally {
    signal.removeEventListener('abort', abortRead);
    await reader?.cancel().catch(() => {});
  }
}
