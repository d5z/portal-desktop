/** A quiet time label after an idle gap or at a local calendar-day boundary. */
export function startsTimeGroup(current?:number,previous?:number) {
  if(current===undefined||!Number.isFinite(new Date(current).getTime()))return false;
  if(previous===undefined||!Number.isFinite(new Date(previous).getTime()))return true;
  return Math.abs(current-previous)>=5*60*1000 || new Date(current).toDateString()!==new Date(previous).toDateString();
}
export function messageTimeLabel(time:number) {
  return new Date(time).toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
}
/** Append text without replacing the user's existing draft or sending it. */
export function appendChatText(draft:string,text:string) {
  const plain=text.trim();
  return plain ? `${draft.trim() ? draft.trimEnd() + '\n\n' : ''}${plain}` : draft;
}

export function fullMessageTime(time?:number, fallback='') {
  return time !== undefined && Number.isFinite(new Date(time).getTime()) ? new Date(time).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}) : fallback;
}
