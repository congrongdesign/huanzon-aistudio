'use client';
import { type ReactNode } from 'react';
import { Dialog,DialogContent,DialogTitle,DialogDescription } from '@/components/ui/dialog';

export function SettingsDialog({ open,onOpenChange,section,onSectionChange,sections,children,footer }: { open:boolean;onOpenChange:(open:boolean)=>void;section:string;onSectionChange:(section:string)=>void;sections:{id:string;label:string;icon?:ReactNode}[];children:ReactNode;footer?:ReactNode }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="motif-settings-dialog"><aside className="motif-settings-nav"><DialogTitle>设置</DialogTitle><DialogDescription className="sr-only">通用与下载配置点击保存后写入本机；储存管理中的应用与清理操作立即生效。</DialogDescription><div>{sections.map(item=><button type="button" key={item.id} aria-pressed={item.id===section} onClick={()=>onSectionChange(item.id)} className="motif-navigation-row justify-start">{item.icon}<span>{item.label}</span></button>)}</div></aside><div className="motif-settings-body">{children}{footer&&<footer className="motif-settings-footer">{footer}</footer>}</div></DialogContent></Dialog>;
}
