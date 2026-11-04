import type { Token } from 'marked';

/** Keep two unfinished blocks mutable, as in Harness's streaming renderer.
 * Use the lexer’s own raw spans rather than guessing boundaries from blank lines.
 * Definitions and normalized source fall back to a full parse: reference links
 * must keep their document-wide meaning, even before the final settled render.
 */
export class StreamingMarkdown {
  private previous = '';
  private offset = 0;
  private frozen: Token[] = [];
  private result: Token[] = [];

  constructor(private readonly parse: (source: string) => Token[]) {}

  update(source: string): Token[] {
    if (source === this.previous) return this.result;
    if (!source.startsWith(this.previous) || /\r|\]:/.test(source)) {
      this.offset = 0;
      this.frozen = [];
    }
    const tailSource = source.slice(this.offset);
    const tail = this.parse(tailSource);
    this.result = [...this.frozen, ...tail];
    this.previous = source;
    // Some lexer constructs consume source without producing a token (link
    // definitions), or normalize whitespace. Never infer offsets in that case.
    if (tail.map(token => token.raw).join('') !== tailSource) return this.result;
    let remaining = 2, cut = tail.length;
    while (cut > 0 && remaining > 0) {
      cut--;
      if (tail[cut].type !== 'space') remaining--;
    }
    // Preserve the separator before the frontier, including its indentation.
    while (cut > 0 && tail[cut - 1].type === 'space') cut--;
    if (cut > 0) {
      const stable = tail.slice(0, cut);
      this.offset += stable.reduce((length, token) => length + token.raw.length, 0);
      this.frozen = [...this.frozen, ...stable];
    }
    return this.result;
  }
}
