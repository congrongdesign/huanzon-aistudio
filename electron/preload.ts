import { contextBridge, ipcRenderer } from 'electron';

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
