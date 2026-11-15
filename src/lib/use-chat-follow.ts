'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Keep the reader's place; only follow updates while they remain at the tail. */
export function useChatFollow(revision: unknown, scope: string | null) {
  const containerRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const previousScope = useRef(scope);
  const [following, setFollowing] = useState(true);
  const jumpToLatest = useCallback(() => {
    followRef.current = true; setFollowing(true);
    const el = containerRef.current; if (el) el.scrollTop = el.scrollHeight;
  },[]);
  const onScroll = useCallback(() => {
    const el = containerRef.current; if (!el) return;
    const next = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    followRef.current = next; setFollowing(next);
  },[]);
  useLayoutEffect(() => {
    if (previousScope.current !== scope) { previousScope.current = scope; followRef.current = true; }
    if (followRef.current) jumpToLatest();
  },[revision,scope,jumpToLatest]);
  const onMediaLoad = useCallback(() => { if (followRef.current) jumpToLatest(); },[jumpToLatest]);
  return { containerRef, following, onScroll, jumpToLatest, onMediaLoad };
}
