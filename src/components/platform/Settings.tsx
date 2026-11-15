'use client';
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** SettingsSection / Card / Row composition adapted to the existing Radix app. */
export function SettingsSection({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  return <section className={cn('motif-settings-section', className)}><header><h3>{title}</h3>{description && <p>{description}</p>}</header>{children}</section>;
}
export function SettingsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('motif-settings-card', className)}>{children}</div>;
}
export function SettingsRow({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return <div className="motif-settings-row"><div className="min-w-0"><div className="font-medium">{label}</div>{description && <p>{description}</p>}</div><div className="motif-settings-control">{children}</div></div>;
}
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="motif-empty"><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
