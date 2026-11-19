import {useEffect,type RefObject} from 'react';
/** Keep interaction inside the trigger/menu; dismiss when attention moves outside. */
export function useDismissAttachmentMenu(open:boolean,refs:RefObject<HTMLElement|null>[],close:()=>void) {
  useEffect(()=>{
    if(!open)return;
    const outside=(event:Event)=>{
      if(event.target instanceof Node && !refs.some(ref=>ref.current?.contains(event.target as Node)))close();
    };
    const hidden=()=>{if(document.hidden)close();};
    document.addEventListener('pointerdown',outside,true);
    document.addEventListener('focusin',outside,true);
    window.addEventListener('blur',close);
    document.addEventListener('visibilitychange',hidden);
    return()=>{
      document.removeEventListener('pointerdown',outside,true);
      document.removeEventListener('focusin',outside,true);
      window.removeEventListener('blur',close);
      document.removeEventListener('visibilitychange',hidden);
    };
  },[open,refs,close]);
}
