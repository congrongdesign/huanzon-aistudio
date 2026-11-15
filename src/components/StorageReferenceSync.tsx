'use client';

import { useEffect } from 'react';
let liveKeys: string[] = [];

// Register only local media keys; never send prompts, account settings or API keys.
export async function syncStorageBrowserReferences() {
  let clientId = localStorage.getItem('hz_storage_client_id');
  if (!clientId) { clientId = crypto.randomUUID(); localStorage.setItem('hz_storage_client_id', clientId); }
  const entries: { name: string; keys: string[]; expiresAt?: string }[] = [];
  const projectResponse = await fetch('/api/projects');
  if (!projectResponse.ok) throw new Error('项目列表尚未同步，请稍后重试');
  const projectData = await projectResponse.json();
  const projectList = Array.isArray(projectData) ? projectData : projectData.projects;
  if (!Array.isArray(projectList)) throw new Error('项目列表格式异常，已停止引用同步');
  const projects = new Set<string>(projectList.map((p: { id: string }) => p.id));
  const expired: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const name = localStorage.key(i)!;
    const scope = /^(?:hz_chat_draft_|hz_canvas_reference_layouts_v1:)([a-f0-9-]{36})$/i.exec(name);
    if (scope && !projects.has(scope[1])) { expired.push(name); continue; }
    // Diagnostic request previews are historical metadata, not original-image ownership.
    if (/llm.*preview|message_llm|archive.*job|background_archive/i.test(name)) continue;
    const value = localStorage.getItem(name) || ''; const keys = new Set<string>();
    for (const match of value.matchAll(/\/api\/(?:local|font)-file\/([^\s"'<>?#\\]+)/g)) {
      try { const key = decodeURIComponent(match[1]); if (!/[\\/]/.test(key)) keys.add(key); } catch { /* Invalid URL. */ }
    }
    if (keys.size) entries.push({ name, keys: [...keys] });
  }
  for (const name of expired) localStorage.removeItem(name);
  if (liveKeys.length) entries.push({ name: '当前编辑与撤销记录', keys: liveKeys, expiresAt: new Date(Date.now() + 120_000).toISOString() });
  const response = await fetch('/api/storage-management', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'browser-references', clientId, entries }) });
  if (!response.ok) throw new Error('浏览器资产引用尚未同步，请稍后重试');
}

export default function StorageReferenceSync() {
  useEffect(() => {
    const sync = () => { void syncStorageBrowserReferences().catch(() => {}); };
    const live = (event: Event) => {
      const keys = new Set<string>(); const value = JSON.stringify((event as CustomEvent).detail);
      for (const match of value.matchAll(/\/api\/(?:local|font)-file\/([^\s"'<>?#\\]+)/g)) {
        try { keys.add(decodeURIComponent(match[1])); } catch { /* Invalid URL. */ }
      }
      liveKeys = [...keys]; sync();
    };
    sync(); const timer = setInterval(sync, 30_000);
    window.addEventListener('storage', sync); window.addEventListener('focus', sync);
    window.addEventListener('hz-storage-live-references', live);
    return () => { clearInterval(timer); window.removeEventListener('storage', sync); window.removeEventListener('focus', sync); window.removeEventListener('hz-storage-live-references', live); };
  }, []);
  return null;
}
