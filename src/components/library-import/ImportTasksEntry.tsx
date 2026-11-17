'use client';

import { ListTodo, Loader2 } from 'lucide-react';
import { useLibraryImports } from '@/lib/library-import-client';

export default function ImportTasksEntry() {
  const data = useLibraryImports();
  if (process.env.NEXT_PUBLIC_COZE_CLOUD === '1') return null;
  const active = data.active + data.pending.filter(item => !item.error).length;
  return <button type="button" className="motif-button gap-2" title="查看导入进度、暂停和重试" onClick={() => window.dispatchEvent(new Event('hz-library-import-open'))}>
    {active ? <Loader2 size={14} className="animate-spin"/> : <ListTodo size={14}/>}
    导入任务{active > 0 && <span className="tabular-nums text-muted-foreground">{active}</span>}
  </button>;
}
