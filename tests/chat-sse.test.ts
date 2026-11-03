import { describe, expect, it } from 'vitest';
import { ChatEventDecoder } from '../desktop/renderer/chat/services/sse';

describe('chat SSE framing', () => {
  const wire = '\ufeff: heartbeat\r\nevent:content_block_delta\r\ndata:{"delta":\r\ndata: {"text":"你好🌱"}}\r\n\r\nevent: message_stop\rdata: {}\r\r';
  const expected = [
    { event: 'content_block_delta', data: '{"delta":\n{"text":"你好🌱"}}' },
    { event: 'message_stop', data: '{}' },
  ];
  it('preserves complete events for every byte boundary, including UTF-8 and CRLF', () => {
    const bytes = new TextEncoder().encode(wire);
    for (let cut = 0; cut <= bytes.length; cut++) {
      const parser = new ChatEventDecoder();
      expect([...parser.push(bytes.slice(0, cut)), ...parser.push(bytes.slice(cut))]).toEqual(expected);
    }
    const parser = new ChatEventDecoder();
    expect([...bytes].flatMap(byte => parser.push(new Uint8Array([byte])))).toEqual(expected);
  });
  it('waits for a complete frame and resets the event type after empty frames', () => {
    const parser = new ChatEventDecoder();
    const push = (text: string) => parser.push(new TextEncoder().encode(text));
    expect(push('event: tool_use\n\ndata:{"ignored":true}\n')).toEqual([]);
    expect(push('\n')).toEqual([{event:'message',data:'{"ignored":true}'}]);
    expect(push(':keepalive\n\nevent: meta\ndata:{"persisted":')).toEqual([]);
    expect(push('{}}\n')).toEqual([]);
    expect(push('\n')).toEqual([{event:'meta',data:'{"persisted":{}}'}]);
  });
});
