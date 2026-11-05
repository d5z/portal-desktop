import { parseImageGenerationReceipt, type ImageGenerationReceipt } from './image-generation';

export type ImageGenerationBlock =
  | {kind:'text'; id:string; text:string}
  | {kind:'receipt'; id:string; text:string; receipt:ImageGenerationReceipt | null};
const marker = /"type"\s*:\s*"being\.image-generation"/;

/** Scan one JSON object, respecting braces inside strings and escaped quotes. */
function objectEnd(text:string, start:number) {
  let depth=0, quoted=false, escaped=false;
  for (let i=start;i<text.length;i++) {
    const char=text[i];
    if (quoted) {
      if (escaped) escaped=false;
      else if (char==='\\') escaped=true;
      else if (char==='"') quoted=false;
    } else if (char==='"') quoted=true;
    else if (char==='{') depth++;
    else if (char==='}' && --depth===0) return i+1;
  }
  return text.length;
}
function isReceipt(source:string) {
  if (!marker.test(source)) return false;
  try { return JSON.parse(source)?.type === 'being.image-generation'; }
  catch { return /^\s*\{/.test(source); }
}
/** Only standalone objects and json/being-image-generation fences are executable receipts.
 * Inline code, quoted examples, ordinary JSON, and other code languages stay text.
 * Exact receipt validation remains separate from this presentation-only extraction.
 */
export function imageGenerationBlocks(text:string): ImageGenerationBlock[] {
  if (!text.includes('being.image-generation')) return text ? [{kind:'text',id:'text-0',text}] : [];
  const blocks:ImageGenerationBlock[]=[];
  let cursor=0, plainStart=0;
  function receipt(start:number,end:number,source:string) {
    if(start>plainStart) blocks.push({kind:'text',id:`text-${plainStart}`,text:text.slice(plainStart,start)});
    blocks.push({kind:'receipt',id:`receipt-${start}`,text:source,receipt:parseImageGenerationReceipt(source)});
    plainStart=end;
  }
  while(cursor<text.length) {
    const lineEnd=text.indexOf('\n',cursor), next=lineEnd<0?text.length:lineEnd+1;
    const line=text.slice(cursor,lineEnd<0?text.length:lineEnd);
    const fence=/^ {0,3}(`{3,}|~{3,})\s*([^\r]*)\r?$/.exec(line);
    if(fence) {
      const markerChar=fence[1][0],length=fence[1].length,language=fence[2].trim().toLowerCase();
      let close=next,end=text.length;
      while(close<text.length) {
        const endLine=text.indexOf('\n',close),after=endLine<0?text.length:endLine+1;
        const candidate=text.slice(close,endLine<0?text.length:endLine).trim();
        if(candidate.length>=length && [...candidate].every(char=>char===markerChar)) {end=after;break;}
        close=after;
      }
      const source=text.slice(next,close);
      if(['json','being-image-generation',''].includes(language) && isReceipt(source)) receipt(cursor,end,source);
      cursor=end;continue;
    }
    const object=/^ {0,3}\{/.exec(line);
    if(object) {
      const start=cursor+object[0].length-1,end=objectEnd(text,start),source=text.slice(start,end);
      if(isReceipt(source)) receipt(cursor,end,source);
      // Skip entire ordinary objects, including nested receipt-shaped examples.
      cursor=end;
      if(cursor<text.length && text[cursor]==='\n') cursor++;
      continue;
    }
    cursor=next;
  }
  if(plainStart<text.length) blocks.push({kind:'text',id:`text-${plainStart}`,text:text.slice(plainStart)});
  return blocks;
}
