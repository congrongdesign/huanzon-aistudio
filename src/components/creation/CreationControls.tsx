'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import * as Popover from '@radix-ui/react-popover';
import { ModelSelect, ModelSelectTrigger, ModelSelectContent, ModelSelectSearch, ModelSelectIndex, ModelSelectList } from '@/components/ui/motif/model-select';

export function ModelPicker({ value, options, onChange, label = '生图模型' }: { value: string; options: { value: string; label: string; group?: string }[]; onChange: (value: string) => void; label?: string }) {
  const { models, providers } = useMemo(() => {
    const groups = [...new Set(options.map(o => o.group || '已启用模型'))];
    const providers = groups.map((name, index) => ({ id: `provider-${index}`, name }));
    const models = options.map(o => ({ id: o.value, name: o.label, provider: providers[groups.indexOf(o.group || '已启用模型')].id, keywords: [o.value, o.group || ''] }));
    if (value && !models.some(o => o.id === value)) {
      providers.push({ id: 'current', name: '当前模型' });
      models.unshift({ id: value, name: value.split('::').at(-1) || value, provider: 'current', keywords: [value] });
    }
    return { models, providers };
  }, [options, value]);
  return <ModelSelect models={models} providers={providers} value={value} onValueChange={onChange} emptyLabel="没有匹配的模型" triggerPlaceholder="选择模型">
    <ModelSelectTrigger aria-label={label} className="motif-model-picker"/>
    <ModelSelectContent className="motif-model-select-panel" side="top" collisionPadding={12}>
      <ModelSelectSearch placeholder="搜索模型或供应商…" aria-label="搜索模型"/>
      <div className="flex min-h-0 flex-1"><ModelSelectIndex/><ModelSelectList aria-label={label}/></div>
    </ModelSelectContent>
  </ModelSelect>;
}
export function ParameterButton({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Popover.Root open={open} onOpenChange={setOpen}><Popover.Trigger asChild><button type="button" className="motif-select motif-parameter-button" aria-label={label}><span className="motif-parameter-label">{label}</span><span className="truncate">{value}</span><ChevronDown size={12}/></button></Popover.Trigger><Popover.Portal><Popover.Content align="start" side="top" sideOffset={8} collisionPadding={10} className="motif-menu motif-parameters" onClick={e=>{if((e.target as HTMLElement).closest("[data-parameter-option]"))setOpen(false);}}><h3 className="mb-3 text-sm font-medium">{label}</h3>{children}</Popover.Content></Popover.Portal></Popover.Root>;
}
export function ParameterChoices({ value, options, onChange, label }: { value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; label: string }) {
  return <div role="radiogroup" aria-label={label} className="grid gap-1">{options.map(option=><button key={option.value} type="button" role="radio" aria-checked={option.value===value} data-parameter-option className="flex items-center justify-between gap-6 rounded-lg px-3 py-2 text-left text-xs hover:bg-accent" onClick={()=>onChange(option.value)}><span>{option.label}</span><span aria-hidden="true">{option.value===value?'✓':''}</span></button>)}</div>;
}
export function RatioPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (value: string) => void }) {
  return <div role="group" aria-label="图像比例" className="motif-ratios">{options.map(ratio => { const [w,h] = ratio.split(':').map(Number); const valid = w > 0 && h > 0; return <button type="button" key={ratio} data-parameter-option aria-pressed={value === ratio} onClick={() => onChange(ratio)}><span className="motif-ratio-art"><i style={{ width: valid ? `${Math.min(22,22*w/h)}px` : 18, height: valid ? `${Math.min(22,22*h/w)}px` : 18 }}/></span><span>{ratio}</span></button>; })}</div>;
}
export function ParameterRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="motif-parameter-row"><span>{label}</span><div>{children}</div></div>;
}
