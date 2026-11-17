'use client';
import { Images, Upload } from 'lucide-react';
export default function LibraryDropFeedback({ destination, count = 0, attachment = false }: { destination: string; count?: number; attachment?: boolean }) {
  return <div className="library-drop-feedback" role="status" aria-live="polite"><div className="library-drop-feedback-card"><div className="library-drop-feedback-icon"><Upload size={25} strokeWidth={1.6}/></div><p className="text-base font-semibold">{attachment ? '松开，添加到此卡片' : `松开，导入到${destination}`}</p><p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><Images size={14}/>{count > 1 ? `${count} 张图片 · ` : ''}{attachment ? '保留现有封面与资料' : '支持批量拖入 · 每张图片一张卡片'}</p><p className="mt-3 text-[11px] text-muted-foreground">原图先保存，AI 后台命名与整理</p></div></div>;
}
