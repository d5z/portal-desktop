export interface StreamEvent { event: string; data: string }

/** Decode SSE frames, independently of network chunk and UTF-8 boundaries. */
export class ChatEventDecoder {
  private readonly decoder = new TextDecoder();
  private line = '';
  private afterCR = false;
  private event = '';
  private data: string[] = [];

  push(bytes: Uint8Array): StreamEvent[] {
    const events: StreamEvent[] = [];
    const text = this.decoder.decode(bytes, { stream: true });
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (this.afterCR) {
        this.afterCR = false;
        if (char === '\n') { start = i + 1; continue; }
      }
      if (char !== '\r' && char !== '\n') continue;
      this.line += text.slice(start, i);
      this.consumeLine(events);
      this.line = '';
      this.afterCR = char === '\r';
      start = i + 1;
    }
    this.line += text.slice(start);
    return events;
  }

  private consumeLine(events: StreamEvent[]) {
    if (this.line === '') {
      if (this.data.length) events.push({ event: this.event || 'message', data: this.data.join('\n') });
      this.event = '';
      this.data = [];
      return;
    }
    if (this.line.startsWith(':')) return;
    const colon = this.line.indexOf(':');
    const field = colon < 0 ? this.line : this.line.slice(0, colon);
    let value = colon < 0 ? '' : this.line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    if (field === 'data') this.data.push(value);
  }
  // An unterminated frame at EOF is deliberately discarded. It must not
  // advance the replay cursor or apply a partially received acknowledgement.
}
