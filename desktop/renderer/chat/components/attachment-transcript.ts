import {displayTranscript} from '../services/audio-transcript';
import {useEffect,useState} from 'react';
import type {AttachmentPart} from '../services/attachment-messages';
import {parsedPage} from '../services/attachment-view';
export function useAttachmentTranscript(part: AttachmentPart, endpoint: string) {
  const [text,setText]=useState(''),[error,setError]=useState(false),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    if(!part.parse_result_id || part.parse_status!=='ready')return;
    const controller=new AbortController();setText('');setError(false);
    void (async()=>{
      let cursor:string|null=null;const seen=new Set<string>();const segments:string[]=[];
      do {
        const page=await parsedPage(endpoint,part.attachment_id,part.parse_result_id!,cursor,controller.signal);
        segments.push(...page.segments.map((segment:{text:string})=>segment.text));
        cursor=page.next_cursor || null;
        if(cursor && seen.has(cursor))throw new Error('重复分页');
        if(cursor)seen.add(cursor);
        if(seen.size>200)throw new Error('转写过长');
      }while(cursor);
      if(!controller.signal.aborted)setText(displayTranscript(segments.join('\n')));
    })().catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[endpoint,part.attachment_id,part.parse_result_id,part.parse_status,attempt]);
  return { text, error, retry: () => setAttempt(attempt + 1) };
}
