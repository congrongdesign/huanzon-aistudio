'use client';

import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

type ChangeEvent = { target: { value: string }; currentTarget: { value: string } };
type Option = { value: string; label: React.ReactNode; text: string; disabled: boolean; group: string };
type Props = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange' | 'size' | 'multiple'> & { onChange?: (event: ChangeEvent) => void };
function textOf(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return React.isValidElement<{ children?: React.ReactNode }>(node) ? textOf(node.props.children) : '';
}
function optionsOf(children: React.ReactNode, group = ''): Option[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement<{ value?: string | number; children?: React.ReactNode; label?: string; disabled?: boolean }>(child)) return [];
    if (child.type === React.Fragment) return optionsOf(child.props.children, group);
    if (child.type === 'optgroup') return optionsOf(child.props.children, child.props.label || '');
    if (child.type !== 'option') return [];
    const text = textOf(child.props.children);
    return [{ value: String(child.props.value ?? text), label: child.props.children, text, disabled: !!child.props.disabled, group }];
  });
}

/** Motif model-menu layout, with Radix focus/portal management and cmdk keyboard search. */
export default function NeutralSelect({ value, defaultValue, onChange, className, children, disabled, title, name, id, 'aria-label': label }: Props) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const items = React.useMemo(() => optionsOf(children), [children]);
  const [internal, setInternal] = React.useState(String(defaultValue ?? items[0]?.value ?? ''));
  const commandRef = React.useRef<HTMLDivElement>(null);
  const current = String(value ?? internal);
  const selected = items.find(item => item.value === current);
  const matches = React.useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? items.filter(item => words.every(word => `${item.text} ${item.group} ${item.value}`.toLowerCase().includes(word))) : items;
  }, [items, query]);
  const visibleItems = matches.slice(0, 100);
  if (!query.trim() && selected && !visibleItems.includes(selected)) visibleItems.splice(0, 1, selected);
  const groups = [...new Set(visibleItems.map(item => item.group))];
  const searchable = items.length > 7;
  const listId = React.useId();
  const choose = (next: string) => {
    onChange?.({ target: { value: next }, currentTarget: { value: next } });
    if (value === undefined) setInternal(next);
    setOpen(false);
  };
  return <Popover.Root open={open} onOpenChange={next => { setOpen(next); if (next) setQuery(''); }}>
    {name && <input type="hidden" name={name} value={current} />}
    <Popover.Trigger asChild>
      <button type="button" id={id} disabled={disabled} role="combobox" aria-label={label || title} aria-controls={open ? listId : undefined} aria-expanded={open} title={title || selected?.text || current} className={cn('motif-select', className)}>
        <span className="min-w-0 flex-1 truncate">{selected?.label ?? (current || '请选择')}</span><ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content align="start" sideOffset={6} collisionPadding={10} className="motif-menu" onOpenAutoFocus={event => {
      event.preventDefault();
      (commandRef.current?.querySelector('input') || commandRef.current)?.focus();
    }}>
      <Command ref={commandRef} tabIndex={0} defaultValue={current} shouldFilter={false} label={label || title || '选择选项'} loop>
        {searchable && <div className="motif-menu-search"><Search size={14}/><Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="搜索名称或服务商…" aria-label="搜索选项" aria-labelledby={undefined} /></div>}
        <Command.List id={listId} className="motif-menu-list">
          {!matches.length && <div className="p-5 text-center text-xs text-muted-foreground" role="status">没有匹配的选项</div>}
          {groups.map(group => <Command.Group key={group} heading={group || undefined}>
            {visibleItems.filter(item => item.group === group).map(item => <Command.Item key={item.value} value={item.value} keywords={[item.text, item.group]} disabled={item.disabled} onSelect={() => choose(item.value)} className="motif-menu-item">
              <span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span>{group && <span className="block truncate text-[11px] text-muted-foreground">{group}</span>}</span>
              {item.value === current && <Check size={14} className="shrink-0"/>}
            </Command.Item>)}
          </Command.Group>)}
        </Command.List>
        {matches.length > 100 && <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">共 {matches.length} 项，搜索可定位全部选项</p>}
      </Command>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
