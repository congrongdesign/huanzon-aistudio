'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

const unique = <T extends { id: string }>(values: T[]) => [...new Map(values.map(item => [item.id, item])).values()];

type Page<T> = { items: T[]; total: number; pageSize?: number };
export function useInfiniteFontList<T extends { id: string }>(
  queryKey: string,
  revision: number,
  enabled: boolean,
  fetchPage: (page: number, signal: AbortSignal) => Promise<Page<T>>,
) {
  const [items, setItems] = useState<T[]>([]), [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true), [loadingMore, setLoadingMore] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const [error, setError] = useState(''), [hasMore, setHasMore] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null), sentinelRef = useRef<HTMLDivElement>(null);
  const fetchRef = useRef(fetchPage); fetchRef.current = fetchPage;
  const request = useRef<AbortController | null>(null), busy = useRef(false);
  const scope = useRef(''), pages = useRef(0), retryRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;
    const changed = scope.current !== queryKey;
    scope.current = queryKey;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller; busy.current = true;
    if (changed) { pages.current = 0; setItems([]); setTotal(0); setHasMore(false); rootRef.current?.scrollTo({ top: 0 }); }
    setLoading(true); setLoadingMore(false); setError('');
    const timer = setTimeout(async () => {
      try {
        // Refresh the loaded range in place, so saving a card does not collapse the list.
        const first = await fetchRef.current(1, controller.signal);
        const size = first.pageSize || 24;
        const count = Math.max(1, Math.min(pages.current || 1, Math.ceil(first.total / size)));
        const results = [first];
        for (let page = 2; page <= count; page++) results.push(await fetchRef.current(page, controller.signal));
        if (controller.signal.aborted) return;
        pages.current = count; setItems(unique(results.flatMap(result => result.items))); setTotal(first.total); setHasMore(count * size < first.total);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载失败，请重试'); }
      finally { if (!controller.signal.aborted) { busy.current = false; setLoading(false); } }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); request.current?.abort(); };
  }, [queryKey, revision, enabled, retryVersion]);

  const loadMore = useCallback(async () => {
    if (!enabled || !hasMore || busy.current) return;
    busy.current = true; setLoadingMore(true); setError('');
    const controller = new AbortController(); request.current = controller;
    const next = pages.current + 1;
    try {
      const result = await fetchRef.current(next, controller.signal);
      if (controller.signal.aborted) return;
      pages.current = next; setItems(previous => unique([...previous, ...result.items])); setTotal(result.total); setHasMore(result.items.length > 0 && next * (result.pageSize || 24) < result.total);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '加载失败，请重试'); }
    finally { if (!controller.signal.aborted) { busy.current = false; setLoadingMore(false); } }
  }, [enabled, hasMore]);
  retryRef.current = () => void loadMore();
  useEffect(() => {
    const sentinel = sentinelRef.current, root = rootRef.current;
    if (!enabled || loading || loadingMore || error || !hasMore || !sentinel || !root) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && root.getClientRects().length) retryRef.current();
    }, { root, rootMargin: '0px 0px 320px 0px' });
    observer.observe(sentinel); return () => observer.disconnect();
  }, [enabled, loading, loadingMore, error, hasMore, items.length]);
  useEffect(() => () => request.current?.abort(), []);
  return { items, total, loading, loadingMore, error, hasMore, rootRef, sentinelRef, loadMore, retry: () => pages.current > 0 && hasMore ? void loadMore() : setRetryVersion(v => v + 1) };
}
