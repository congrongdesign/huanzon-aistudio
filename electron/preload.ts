import { contextBridge, ipcRenderer } from 'electron';

// Restore before React reads localStorage. The snapshot lives outside the install
// directory and survives a different localhost port after an upgrade.
try {
  if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
    const selected = (key: string) => /^(hz_(grs_|ds_|chat_|codia_|provider_|active_provider_|capability_bindings|operation_routes|image_models_cache|image_favorite_models|model_category_overrides)|hz_theme$|theme$)/.test(key);
    const saved = ipcRenderer.sendSync('desktop:settings-read') as Record<string, string>;
    const set = Storage.prototype.setItem;
    for (const [key, value] of Object.entries(saved)) {
      if (selected(key) && typeof value === 'string' && localStorage.getItem(key) === null) set.call(localStorage, key, value);
    }
    const snapshot: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (selected(key)) snapshot[key] = localStorage.getItem(key)!;
    }
    ipcRenderer.sendSync('desktop:settings-write', snapshot);
    // The page runs in the main world; storage events cross the isolated worlds.
    // Polling also captures same-window writes, which do not emit storage events.
    const persist = () => {
      const changes: Record<string, string | null> = {};
      for (const key of new Set([...Object.keys(snapshot), ...Object.keys(localStorage)])) {
        if (!selected(key)) continue;
        const value = localStorage.getItem(key);
        if (value !== (snapshot[key] ?? null)) {
          changes[key] = value;
          if (value === null) delete snapshot[key]; else snapshot[key] = value;
        }
      }
      if (Object.keys(changes).length) ipcRenderer.sendSync('desktop:settings-write', changes);
    };
    window.addEventListener('storage', persist);
    window.addEventListener('beforeunload', persist);
    setInterval(persist, 1000);
  }
} catch { /* Existing origin storage remains authoritative if disk is unavailable. */ }

type DesktopUpdateState =
  | { status: 'idle'; version: string }
  | { status: 'checking'; version: string }
  | { status: 'available'; version: string; nextVersion: string }
  | { status: 'not-available'; version: string }
  | { status: 'downloading'; version: string; nextVersion?: string; percent: number }
  | { status: 'downloaded'; version: string; nextVersion: string }
  | { status: 'error'; version: string; message: string };

contextBridge.exposeInMainWorld('electronAPI', {
  isDesktop: true,
  platform: process.platform,
  exportImages: (request: import('./image-export').ImageExportRequest) => ipcRenderer.invoke('desktop:export-images', request),
  revealExport: (filePath: string) => ipcRenderer.invoke('desktop:reveal-export', filePath),
  onImageExportProgress: (callback: (value: import('./image-export').ImageExportProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, value: import('./image-export').ImageExportProgress) => callback(value);
    ipcRenderer.on('desktop:image-export-progress', listener);
    return () => ipcRenderer.removeListener('desktop:image-export-progress', listener);
  },
  selectStorageDirectory: (defaultPath?: string) => ipcRenderer.invoke('desktop:select-storage-directory', defaultPath),
  checkForUpdates: () => ipcRenderer.invoke('desktop:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:update-download'),
  installUpdate: () => ipcRenderer.invoke('desktop:update-install'),
  onUpdateState: (callback: (state: DesktopUpdateState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => {
      callback(state);
    };
    ipcRenderer.on('desktop:update-state', listener);
    return () => ipcRenderer.removeListener('desktop:update-state', listener);
  },
});
