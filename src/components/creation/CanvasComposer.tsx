'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { PromptQuickPicker } from '@/components/PromptManager';
import { BookmarkPlus, Plus } from 'lucide-react';
import { ResizableComposerDock } from './ResizableComposerDock';

// Motif's generation canvas anchors a 40rem composer to the canvas, outside its
// transformed content. Measuring it also keeps selection controls above long drafts.
export function CanvasComposer({ children }: { children: ReactNode }) {
  const dock = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = dock.current;
    const workspace = element?.parentElement;
    if (!element || !workspace) return;
    const measure = () => workspace.style.setProperty('--composer-height', `${element.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); workspace.style.removeProperty('--composer-height'); };
  }, []);
  return <ResizableComposerDock dockRef={dock} scope="canvas" canvas className="motif-canvas-composer-dock">{children}</ResizableComposerDock>;
}

export function ComposerTools({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button type="button" className="motif-composer-icon" aria-label="输入工具" title="上传、提示词和语音"><Plus size={19}/></button></Popover.Trigger>
    <Popover.Portal><Popover.Content side="top" align="start" sideOffset={10} collisionPadding={12} className="motif-menu motif-composer-tools" onOpenAutoFocus={e => e.preventDefault()}>
      <div onClick={() => setOpen(false)}>{children}</div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

export function PromptPickerPopover({open,onOpenChange,authHeaders,onSelect,onManage}:{open:boolean;onOpenChange:(open:boolean)=>void;authHeaders:Record<string,string>;onSelect:(text:string)=>void;onManage:()=>void}) {
  return <Popover.Root open={open} onOpenChange={onOpenChange}>
    <Popover.Trigger asChild><button type="button" className="motif-composer-prompt-picker" aria-label="选择提示词" title="选择提示词"><BookmarkPlus size={14}/><span>提示词</span></button></Popover.Trigger>
    <Popover.Portal><Popover.Content side="top" align="end" sideOffset={12} collisionPadding={16} className="motif-menu motif-composer-prompt-menu" onCloseAutoFocus={e=>e.preventDefault()}>
      <PromptQuickPicker authHeaders={authHeaders} onSelect={onSelect} onOpenFullManager={onManage} onClose={()=>onOpenChange(false)}/>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
