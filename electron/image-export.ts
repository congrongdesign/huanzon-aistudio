import { constants, createReadStream, createWriteStream } from 'node:fs';
import { access, copyFile, link, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type ExportFile = { url: string; filename: string };
export type ImageExportRequest = { id: string; files: ExportFile[]; zipName?: string };
export type ImageExportProgress = { id: string; completed: number; total: number };
export type ImageExportResult = { files: string[]; failures: Array<{ filename: string; error: string }> };
type ExportConfig = { backendMode?: string; lanRole?: string; lanHostUrl?: string; downloadDirectory?: string; mediaDirectory?: string; mediaPreviousDirectories?: string[] };
type ExportOptions = {
  dataDirectory: string;
  downloadsDirectory: string;
  appOrigin: string;
  loadZip: () => typeof import('jszip');
  progress?: (value: ImageExportProgress) => void;
};

function safeName(value: string) {
  return value.replace(/[\\/:*?"<>|\r\n\x00-\x1f]+/g, '_').trim().slice(0, 180) || 'image.png';
}

/** Downloads own their I/O queue, outside the renderer and generation server. */
export class ImageExporter {
  private active = 0;
  private waiting: Array<() => void> = [];
  private pending = new Map<string, Promise<ImageExportResult>>();
  constructor(private options: ExportOptions) {}

  export(request: ImageExportRequest): Promise<ImageExportResult> {
    if (!request || typeof request.id !== 'string' || !request.id || request.id.length > 160 ||
      !Array.isArray(request.files) || !request.files.length || request.files.length > 500 ||
      request.files.some(file => typeof file?.url !== 'string' || typeof file?.filename !== 'string') ||
      (request.zipName !== undefined && typeof request.zipName !== 'string')) {
      return Promise.reject(new Error('无效的下载任务'));
    }
    const existing = this.pending.get(request.id);
    if (existing) return existing;
    const task = this.run(request).finally(() => this.pending.delete(request.id));
    this.pending.set(request.id, task);
    return task;
  }

  private async run(request: ImageExportRequest): Promise<ImageExportResult> {
    if (this.active >= 2) await new Promise<void>(resolve => this.waiting.push(resolve));
    else this.active++;
    try {
      let config: ExportConfig = {};
      try { config = JSON.parse(await readFile(path.join(this.options.dataDirectory, 'runtime-config.json'), 'utf8')); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取下载设置'); }
      const directory = config.downloadDirectory?.trim() || this.options.downloadsDirectory;
      await mkdir(directory, { recursive: true });
      const result: ImageExportResult = { files: [], failures: [] };
      const progress = (completed: number) => this.options.progress?.({ id: request.id, completed, total: request.files.length });
      progress(0);
      if (request.zipName) {
        // Open every source before publishing a ZIP; never report an incomplete archive as successful.
        const sources: Readable[] = [];
        try {
          const Zip = this.options.loadZip();
          const zip = new Zip();
          const names = new Set<string>();
          for (const [index, file] of request.files.entries()) {
            const source = await this.source(file.url, config);
            sources.push(source);
            let name = safeName(file.filename);
            const parsed = path.parse(name);
            let suffix = 1;
            while (names.has(name)) name = `${parsed.name}-${suffix++}${parsed.ext}`;
            names.add(name);
            zip.file(name, source);
            progress(index + 1);
          }
          result.files.push(await this.save(directory, safeName(request.zipName), zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true, compression: 'STORE' }) as Readable));
        } finally { sources.forEach(source => source.destroy()); }
      } else {
        for (const [index, file] of request.files.entries()) {
          try { result.files.push(await this.save(directory, safeName(file.filename), await this.source(file.url, config))); }
          catch (error) { result.failures.push({ filename: file.filename, error: error instanceof Error ? error.message : '下载失败' }); }
          progress(index + 1);
        }
      }
      return result;
    } finally {
      const next = this.waiting.shift();
      if (next) next(); else this.active--;
    }
  }

  private async source(value: string, config: ExportConfig): Promise<Readable> {
    const url = new URL(value, this.options.appOrigin);
    const local = url.origin === this.options.appOrigin || ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (local && url.pathname.startsWith('/api/local-file/') && !(config.backendMode === 'lan' && config.lanRole === 'client')) {
      const key = decodeURIComponent(url.pathname.slice('/api/local-file/'.length));
      if (!key || key === '.' || key === '..' || /[\\/\x00]/.test(key)) throw new Error('无效的原图地址');
      const fallback = path.join(this.options.dataDirectory, 'local-data');
      for (const root of [...new Set([config.mediaDirectory || fallback, ...(config.mediaPreviousDirectories || []), fallback])]) {
        const file = path.join(root, 'files', key);
        try { await access(file); } catch { continue; }
        if (!(await stat(file)).isFile()) continue;
        // Ignore thumbnail query parameters: always export the original bytes.
        return createReadStream(file);
      }
      throw new Error('原图文件不存在，请检查图片储存磁盘是否已连接');
    }
    if (local && config.backendMode === 'lan' && config.lanRole === 'client' && config.lanHostUrl) {
      const host = new URL(config.lanHostUrl);
      url.protocol = host.protocol; url.host = host.host;
    }
    if (!['https:', 'http:', 'data:'].includes(url.protocol)) throw new Error('不支持的图片地址');
    if (url.pathname.startsWith('/api/local-file/')) { url.search = ''; url.searchParams.set('download', '1'); }
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new Error(`图片下载失败（HTTP ${response.status}）`);
    const type = response.headers.get('content-type') || '';
    if (type && !type.startsWith('image/') && !type.includes('octet-stream')) {
      await response.body.cancel();
      throw new Error('服务器没有返回图片，请检查原图地址或登录状态');
    }
    return Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  }

  private async save(directory: string, name: string, source: Readable): Promise<string> {
    const temporary = path.join(directory, `.aistudio-${randomUUID()}.part`);
    try {
      await pipeline(source, createWriteStream(temporary, { flags: 'wx' }));
      if (!(await stat(temporary)).size) throw new Error('原图文件为空');
      const parsed = path.parse(name);
      for (let index = 0; ; index++) {
        const target = path.join(directory, index ? `${parsed.name}-${index}${parsed.ext}` : name);
        try {
          // Atomic no-replace publication also protects concurrent downloads of the same name.
          await link(temporary, target);
          return target;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EEXIST') continue;
          // Removable/NAS destinations may not support hard links.
          if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV'].includes(code || '')) throw error;
          try { await copyFile(temporary, target, constants.COPYFILE_EXCL); return target; }
          catch (copyError) { if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') throw copyError; }
        }
      }
    } finally { source.destroy(); await unlink(temporary).catch(() => {}); }
  }
}
