'use client';
import { useSyncExternalStore } from 'react';
export type GenerationPhase = 'submitting' | 'queued' | 'running' | 'reconnecting' | 'completed' | 'failed' | 'cancelled';
export type GenerationPresentation = { phase: GenerationPhase; started: number };
const states = new Map<string, GenerationPresentation>();
const listeners = new Map<string, Set<() => void>>();
export function publishGeneration(id: string, phase: GenerationPhase) {
  const previous = states.get(id);
  if (previous?.phase === phase) return;
  states.set(id, { phase, started: previous?.started ?? Date.now() });
  listeners.get(id)?.forEach(fn => fn());
  // Bound terminal snapshots; active requests and subscribers are never evicted.
  if (states.size > 256) for (const [key, item] of states) {
    if (!listeners.has(key) && ['completed','failed','cancelled'].includes(item.phase)) { states.delete(key); if (states.size <= 256) break; }
  }
}
export function useGenerationPresentation(id: string) {
  return useSyncExternalStore(fn => { const set = listeners.get(id) ?? new Set(); set.add(fn); listeners.set(id,set); return () => { set.delete(fn); if (!set.size) listeners.delete(id); }; }, () => states.get(id) ?? null, () => null);
}
