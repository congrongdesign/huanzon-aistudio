'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { CoverFan } from '@/components/ui/motif/cover-fan';
import CanvasPreviewImage from '@/components/CanvasPreviewImage';
import { previewImageUrl } from '@/lib/image-preview';
import { LoadingState } from './GenerationState';

type ImageItem = { id: string; url?: string | null; prompt: string };

/** The fan is a compact entry; the grid keeps every result accessible in large batches. */
export function ConversationImageFan({ items, total = items.length, label, onOpen }: {
  items: ImageItem[]; total?: number; label?: string;
  onOpen: (url: string, prompt: string, images: { url: string; prompt: string }[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const completed = items.filter((item): item is ImageItem & { url: string } => Boolean(item.url));
  const all = completed.map(item => ({ url: item.url, prompt: item.prompt }));
  const title = label || (completed.length >= total ? `已生成 ${completed.length} 张图片` : `正在生成 ${completed.length}/${total} 张`);
  const drag = (event: React.DragEvent, url: string) => {
    event.dataTransfer.setData('text/plain', url);
    event.dataTransfer.setData('application/image-url', url);
    event.dataTransfer.effectAllowed = 'copy';
  };
  return <div className="motif-conversation-fan" data-expanded={expanded}>
    <div className="mb-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span role="status">{title}</span>
      {total > 2 && <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 hover:bg-accent hover:text-foreground" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>{expanded ? '收起' : `查看全部 ${total} 张`}{expanded ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}</button>}
    </div>
    {total <= 2 ? <div className="conversation-small-results" data-count={total}>{items.map((item,index)=>item.url ? <button type="button" key={item.id} draggable onDragStart={event=>drag(event,item.url!)} onClick={()=>onOpen(item.url!,item.prompt,all)} aria-label={`查看图片 ${index+1}`} title="查看原图；可拖到画布"><CanvasPreviewImage src={item.url} pixels={512} alt={item.prompt}/></button> : <div key={item.id} className="grid min-h-20 place-items-center rounded-lg bg-muted/40 text-xs text-muted-foreground">等待结果</div>)}</div> : expanded ? <div className="grid grid-cols-2 gap-2">{items.map((item, index) => item.url ? <button type="button" key={item.id} draggable onDragStart={event => drag(event, item.url!)} onClick={() => onOpen(item.url!, item.prompt, all)} className="group relative aspect-[3/4] overflow-hidden rounded-lg bg-muted" aria-label={`查看图片 ${index + 1}`} title="查看原图；可拖到画布"><CanvasPreviewImage src={item.url} pixels={512} alt={item.prompt} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"/><span className="absolute bottom-2 left-2 rounded bg-black/50 px-1.5 text-[11px] text-white">{index+1}</span></button> : <div key={item.id} className="grid aspect-[3/4] place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">等待结果</div>)}</div> : completed.length ? <CoverFan label={label || '生成图片预览'} items={completed.slice(0,4).map((item,index) => ({ id: item.id, src: previewImageUrl(item.url,512), title: `图片 ${index+1}`, alt: item.prompt }))} onSelect={item => { const image = completed.find(image=>image.id===item.id)!; onOpen(image.url, image.prompt, all); }}/> : <div className="grid min-h-28 place-items-center rounded-xl bg-muted/40"><LoadingState label="等待图片结果"/></div>}
  </div>;
}
