'use client';

type SaveResult = { success: boolean; files: string[]; failures: { filename: string; error: string }[]; error?: string };
type LibrarySaveBridge = {
  isDesktop?: boolean;
  exportImages?: (request: { id: string; files: { url: string; filename: string }[] }) => Promise<SaveResult>;
  revealExport?: (filePath: string) => Promise<{ success: boolean; error?: string }>;
};
export const librarySaveBridge = () => (window as Window & { electronAPI?: LibrarySaveBridge }).electronAPI;

/** Desktop success is acknowledged only after the main process publishes the file. */
export async function saveLibraryDownload(blob: Blob, filename: string): Promise<string | null> {
  const bridge = librarySaveBridge();
  if (bridge?.isDesktop) {
    if (!bridge.exportImages) throw new Error('桌面保存服务不可用，请重新启动应用后重试');
    // The existing native saver accepts binary data, queues I/O and avoids overwriting files.
    const binary = new Blob([await blob.arrayBuffer()], { type: 'application/octet-stream' });
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('无法读取资源包，请重新导出'));
      reader.readAsDataURL(binary);
    });
    const result = await bridge.exportImages({ id: crypto.randomUUID(), files: [{ url, filename }] });
    if (!result.success || result.failures.length || result.files.length !== 1) throw new Error(result.error || result.failures[0]?.error || '资源包尚未保存，请重试');
    return result.files[0];
  }
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.hidden = true;
  document.body.append(anchor);
  try { anchor.click(); } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
  return null;
}

export async function revealLibraryDownload(filePath: string) {
  const result = await librarySaveBridge()?.revealExport?.(filePath);
  if (!result?.success) throw new Error(result?.error || '无法打开保存位置');
}
