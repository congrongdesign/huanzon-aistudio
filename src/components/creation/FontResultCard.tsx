'use client';

import { Check, Download, FolderPlus, ImagePlus, Info, LibraryBig, MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-react';
import CanvasPreviewImage from '@/components/CanvasPreviewImage';
import { GenerationOverlay } from '@/components/ui/motif/generation-overlay';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { FontCreationRun } from '@/lib/font-creation-types';
import type { MouseEvent } from 'react';

type Props = {
  run: FontCreationRun;
  selected: boolean;
  selectionMode: boolean;
  busy: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLElement>) => void;
  onOpen: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onExport: () => void;
  onReference: () => void;
  onCollect: () => void;
  collecting: boolean;
  onReuse: () => void;
};

export default function FontResultCard({ run, selected, selectionMode, busy, onSelect, onOpen, onDelete, onCancel, onExport, onReference, onCollect, collecting, onReuse }: Props) {
  const pending = ['queued', 'running'].includes(run.status);
  const title = run.userPrompt.split(/[，,\n]/)[0].trim().slice(0, 40) || '字体作品';
  return (
    <article tabIndex={0} aria-label={pending ? '生成中的字体图片' : `字体作品：${title}`} aria-busy={busy} data-selected={selected} data-selection-mode={selectionMode} className="font-result-card" onKeyDown={event => {
      if (event.target !== event.currentTarget || event.nativeEvent.isComposing) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault(); event.stopPropagation();
        if (!busy && !pending) {
          if (event.key === ' ' || selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) onSelect(event);
          else onOpen();
        }
      }
      if (!selectionMode && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat && !busy) (pending ? onCancel : onDelete)();
      }
    }}>
      <div className="font-result-media">
        {!pending && <button type="button" role="checkbox" aria-checked={selected} aria-label={`${selected ? '取消选择' : '选择'}字体作品：${title}`} title="选择作品（Shift 连选）" className="font-result-checkbox" disabled={busy} onClick={onSelect}>{selected && <Check size={16} aria-hidden="true"/>}</button>}
        <GenerationOverlay id={run.id} pending={pending && !run.result} mediaSrc={run.result?.url} className="motif-canvas-generation-surface">
          {run.result ? (
            <button type="button" className="font-result-preview" aria-label={`${selectionMode ? '选择' : '查看'}字体作品：${title}`} disabled={busy && selectionMode} onClick={event => {
              if (!pending && (selectionMode || event.metaKey || event.ctrlKey || event.shiftKey)) onSelect(event);
              else onOpen();
            }}>
              <CanvasPreviewImage src={run.result.url} pixels={768} alt={title} className="h-full w-full object-contain"/>
            </button>
          ) : (
            <div className="font-result-placeholder">
              {!pending && <><span>{run.status === 'cancelled' ? '已取消' : '生成失败'}</span>{run.error && <p className="line-clamp-2 text-xs text-muted-foreground" title={run.error}>{run.error}</p>}</>}
            </div>
          )}
        </GenerationOverlay>
      </div>
      <div className="font-result-footer">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={title}>{pending ? '正在生成' : title}</span>
        {pending ? (
          <button type="button" className="font-result-action" disabled={busy || !run.jobId} onClick={onCancel} aria-label="取消字体生成" title="取消生成"><X size={15}/></button>
        ) : (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" className="font-result-action" disabled={busy} aria-label="字体作品更多操作" title="更多操作"><MoreHorizontal size={17}/></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {run.result && <>
                  <DropdownMenuItem onSelect={onOpen}><Info/>查看详情</DropdownMenuItem>
                  <DropdownMenuItem disabled={collecting || run.status !== 'completed'} onSelect={onCollect}><LibraryBig/>{collecting ? '正在添加…' : '添加到字体库'}</DropdownMenuItem>
                  <DropdownMenuItem asChild><a href={run.result.url + '?download=1'} download><Download/>下载原图</a></DropdownMenuItem>
                  <DropdownMenuItem onSelect={onReference}><ImagePlus/>用作参考图</DropdownMenuItem>
                  <DropdownMenuItem onSelect={onExport}><FolderPlus/>添加到项目</DropdownMenuItem>
                  <DropdownMenuSeparator/>
                </>}
                <DropdownMenuItem onSelect={onReuse}><RotateCcw/>复用生成要求</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" className="font-result-action font-result-delete" disabled={busy} onClick={onDelete} aria-label="删除字体作品" title="删除作品"><Trash2 size={15}/></button>
          </>
        )}
      </div>
    </article>
  );
}
