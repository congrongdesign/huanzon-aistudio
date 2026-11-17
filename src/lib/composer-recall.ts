/** Recall only from an empty draft with two distinct, unmodified presses. */
export function consumeDoubleArrowUp(event: {key:string;timeStamp:number;repeat:boolean;isComposing?:boolean;ctrlKey:boolean;metaKey:boolean;altKey:boolean;shiftKey:boolean}, previous: {current:number|null}, enabled = true, draftText = '') {
  if(!enabled||draftText.trim().length>0||event.key!=='ArrowUp'||event.repeat||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey){previous.current=null;return false;}
  const first=previous.current;previous.current=event.timeStamp;
  if(first!==null&&event.timeStamp-first>=0&&event.timeStamp-first<=900){previous.current=null;return true;}
  return false;
}
