import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ArchiveConfig } from './project-archive-store';
import type { BackupConnection, BackupRemoteLocation } from './project-archive-types';

const execute = promisify(execFile);
export type SmbMount = { url: string; directory: string };
export function parseSmbMounts(output: string): SmbMount[] {
  return output.split('\n').flatMap(line => {
    const match = line.match(/^(\/\/.*?) on (.*?) \(smbfs[,)]/);
    return match ? [{ url: `smb:${match[1]}`, directory: match[2] }] : [];
  });
}
export function safeSmbUrl(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'smb:' || !url.hostname || !url.pathname.slice(1) || url.password || url.search || url.hash) throw new Error('NAS 地址应为不含密码的 SMB 共享地址');
  return url.href;
}
function shareKey(raw: string) {
  const url = new URL(safeSmbUrl(raw));
  return `${url.hostname.toLowerCase()}/${decodeURIComponent(url.pathname).replace(/\/$/, '')}`;
}
export function remoteForDirectory(directory: string, mounts: SmbMount[]): BackupRemoteLocation | undefined {
  const mount = mounts.filter(item => directory === item.directory || directory.startsWith(`${item.directory}${path.sep}`)).sort((a, b) => b.directory.length - a.directory.length)[0];
  return mount ? { url: safeSmbUrl(mount.url), mountPath: mount.directory, relativePath: path.relative(mount.directory, directory) } : undefined;
}
export function retryDelay(attempt: number) { return Math.min(300000, 5000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6)); }
export function connectionFailure(error: unknown): BackupConnection['state'] {
  const e = error as { code?: string; message?: string };
  const message = e.message || String(error);
  if (/身份不匹配/.test(message)) return 'identity-mismatch';
  if (e.code === 'EAUTH' || /登录|认证|凭据/.test(message)) return 'authentication-required';
  if (['EACCES', 'EPERM', 'EROFS'].includes(e.code || '')) return 'permission-denied';
  if (['ENETDOWN', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTCONN', 'EPIPE', 'ESTALE', 'EIO'].includes(e.code || '') || /超时|网络不可达/.test(message)) return 'network-unavailable';
  if (/目录不可用|尚未挂载/.test(message)) return 'unmounted';
  return 'unavailable';
}
export const retryableConnection = (state: BackupConnection['state']) => ['unmounted', 'network-unavailable', 'unavailable'].includes(state);

// NetFS delegates authentication to macOS Keychain; NoUI prevents background
// retries from opening password dialogs. No password ever enters app settings.
export async function smbMounts(): Promise<SmbMount[]> {
  if (process.platform !== 'darwin') return [];
  return parseSmbMounts((await execute('/sbin/mount', [], { timeout: 3000 })).stdout);
}
async function reachable(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const done = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(3000); socket.once('connect', () => done(true)); socket.once('error', () => done(false)); socket.once('timeout', () => done(false));
  });
}
export function assertRepository(directory: string, repositoryId?: string, writable = false) {
  try { if (!fs.statSync(directory).isDirectory()) throw new Error('备份目录不可用，请检查 NAS 是否连接'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('备份目录不可用，请检查 NAS 是否连接'); throw error; }
  if (repositoryId) {
    const marker = path.join(directory, '.huanzon-aistudio-repository.json');
    if (!fs.existsSync(marker) || JSON.parse(fs.readFileSync(marker, 'utf8')).id !== repositoryId) throw new Error('备份磁盘身份不匹配，请连接原 NAS');
  }
  fs.accessSync(directory, fs.constants.R_OK | (writable ? fs.constants.W_OK : 0));
}
export async function checkBackupConnection(config: ArchiveConfig, reconnect = false): Promise<BackupConnection> {
  const result = (state: BackupConnection['state'], message: string, actualDirectory?: string): BackupConnection => ({ state, message, actualDirectory, checkedAt: new Date().toISOString() });
  if (!config.syncDir) return result('unconfigured', '请选择备份文件夹');
  try {
    let directory = config.syncDir;
    const discovered = !config.remote && process.platform === 'darwin' ? remoteForDirectory(directory, await smbMounts()) : undefined;
    if (config.remote && process.platform === 'darwin') {
      const remote = config.remote;
      const key = shareKey(remote.url);
      let mounts = await smbMounts();
      let mount = mounts.find(item => shareKey(item.url) === key);
      if (!mount && reconnect) {
        const url = new URL(safeSmbUrl(remote.url));
        if (!await reachable(url.hostname, Number(url.port || 445))) return result('network-unavailable', '当前网络无法访问 NAS，将自动重试');
        const packaged = path.join(process.cwd(), 'workers/nas-mount-macos');
        const helper = fs.existsSync(packaged) ? packaged : path.join(process.cwd(), '.desktop-runtime/backup-worker/nas-mount-macos');
        const { stdout } = await execute(helper, [remote.url], { timeout: 12000, maxBuffer: 4096 });
        const { code } = JSON.parse(stdout);
        if ([-128, -25293, -6004, -5999, -5045, -5046, -6600, 80, 13].includes(code)) return result('authentication-required', 'NAS 需要重新登录，请在 Finder 中连接并保存到钥匙串，然后立即重连');
        mounts = await smbMounts(); mount = mounts.find(item => shareKey(item.url) === key);
        if (!mount && code) return result('unmounted', `NAS 共享尚未连接（系统代码 ${code}），将自动重试`);
      }
      if (!mount) return result('unmounted', 'NAS 共享尚未挂载，将自动重试');
      const relative = path.normalize(remote.relativePath || '.');
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('备份目录配置无效');
      directory = path.join(mount.directory, relative);
    }
    assertRepository(directory, config.repositoryId, true);
    return { ...result('connected', '备份位置已连接', directory), remote: config.remote || discovered };
  } catch (error) {
    const state = connectionFailure(error);
    return result(state, state === 'permission-denied' ? '备份目录没有读写权限，请检查 NAS 权限或系统网络宗卷授权' : error instanceof Error ? error.message : '备份位置暂不可用');
  }
}
