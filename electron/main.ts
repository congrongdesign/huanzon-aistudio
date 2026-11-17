import { app, BrowserWindow, dialog, ipcMain, screen, shell, utilityProcess } from 'electron';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import { ImageExporter, type ImageExportRequest } from './image-export';
import { IllustratorTracer } from './illustrator-trace';
import { readSettings, updateSettings } from './settings-store';
import { applyLibraryFileIcon } from './library-file-icon';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

let mainWindow: BrowserWindow | null = null;
let nextServer: Electron.UtilityProcess | null = null;
let serverPort = 5000;
let updateDownloaded = false;
let updateCheckInProgress = false;
let desktopAutoUpdater: AppUpdater | null = null;
let autoUpdateDisabledReason: string | null = null;

const DEFAULT_SERVER_STARTUP_TIMEOUT_MS = 60_000;
const SERVER_LOG_TAIL_LIMIT = 200;
let serverLogTail: string[] = [];

const desktopProductName = '环中AIStudio';
const legacyUserDataName = 'projects';

app.setName(desktopProductName);
configureStableUserDataPath();

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (process.platform === 'win32') {
  app.setAppUserModelId('com.huanzon.aistudio');
}

// ─── UI auto-scaling ─────────────────────────────────────────────────────────
// The UI is designed on a 1440x900 "design resolution" (CSS px at 100% zoom).
// On any window size we compute a zoom factor that keeps the whole design
// visible without scrolling: zoom = min(winW/1440, winH/900). To avoid the UI
// feeling oversized on large monitors (2K/4K/5K...), the auto zoom is capped at
// 1.0 (exact design size) and only shrinks on smaller windows. Users can still
// fine-tune with Cmd/Ctrl +/- (persisted) for personal preference.
const UI_DESIGN_WIDTH = 1440;
const UI_DESIGN_HEIGHT = 900;
const UI_AUTO_ZOOM_MIN = 0.7;
const UI_AUTO_ZOOM_MAX = 1.0;
const UI_USER_ZOOM_MIN = 0.7;
const UI_USER_ZOOM_MAX = 1.25;
const UI_USER_ZOOM_STEP = 0.05;

let userZoomMultiplier = 1.0;

function getUiSettingsPath(): string {
  return path.join(app.getPath('userData'), 'ui-settings.json');
}

function loadUserZoomMultiplier(): number {
  try {
    if (!existsSync(getUiSettingsPath())) return 1.0;
    const data = JSON.parse(readFileSync(getUiSettingsPath(), 'utf8')) as {
      zoomMultiplier?: unknown;
    };
    const value = Number(data.zoomMultiplier);
    if (Number.isFinite(value) && value >= 0.5 && value <= 2) return value;
  } catch {
    // Corrupt settings fall back to the default scale.
  }
  return 1.0;
}

function saveUserZoomMultiplier(value: number): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(getUiSettingsPath(), JSON.stringify({ zoomMultiplier: value }, null, 2));
  } catch {
    // Persisting the preference must never crash the app.
  }
}

function computeUiZoomFactor(): number {
  if (!mainWindow || mainWindow.isDestroyed()) return 1;
  const [winW, winH] = mainWindow.getContentSize();
  if (!winW || !winH) return 1;
  const fit = Math.min(winW / UI_DESIGN_WIDTH, winH / UI_DESIGN_HEIGHT);
  const autoZoom = Math.min(UI_AUTO_ZOOM_MAX, Math.max(UI_AUTO_ZOOM_MIN, fit));
  return Math.min(UI_USER_ZOOM_MAX, Math.max(UI_USER_ZOOM_MIN, autoZoom * userZoomMultiplier));
}

function applyUiZoom(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const zoom = computeUiZoomFactor();
    void mainWindow.webContents.setZoomFactor(zoom);
    writeDesktopLog(`UI zoom applied: ${zoom.toFixed(3)} (user multiplier ${userZoomMultiplier.toFixed(2)})`);
  } catch {
    // Ignore zoom failures (e.g. during shutdown).
  }
}

function configureStableUserDataPath(): void {
  const appDataDir = app.getPath('appData');
  const stableUserDataDir = path.join(appDataDir, desktopProductName);
  const legacyUserDataDir = path.join(appDataDir, legacyUserDataName);

  // A repeated merge resurrects deliberately deleted media on every launch.
  // An existing primary database is authoritative; never backfill its deleted files.
  const migrationMarker = path.join(stableUserDataDir, '.legacy-data-migrated-v1');
  const hasPrimaryDatabase = existsSync(path.join(stableUserDataDir, 'local-data', 'db.json'));
  if (!existsSync(migrationMarker) && !hasPrimaryDatabase && stableUserDataDir !== legacyUserDataDir && existsSync(legacyUserDataDir)) {
    mergeCopyMissing(legacyUserDataDir, stableUserDataDir);
  }

  mkdirSync(stableUserDataDir, { recursive: true });
  if (!existsSync(migrationMarker)) writeFileSync(migrationMarker, new Date().toISOString(), 'utf8');
  app.setPath('userData', stableUserDataDir);
}

function mergeCopyMissing(source: string, destination: string): void {
  try {
    const stat = statSync(source);
    if (stat.isDirectory()) {
      mkdirSync(destination, { recursive: true });
      for (const entry of readdirSync(source)) {
        if (entry === 'desktop.log') continue;
        mergeCopyMissing(path.join(source, entry), path.join(destination, entry));
      }
      return;
    }

    if (!existsSync(destination)) {
      mkdirSync(path.dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
  } catch {
    // Migration must never block app startup. Runtime config can be recreated.
  }
}

type ResolvedStandalone = {
  root: string;
  serverPath: string;
  source: 'resources' | 'app-path';
};

function resolveStandalone(): ResolvedStandalone {
  const packagedRoot = path.join(process.resourcesPath, 'standalone');
  const packagedServer = path.join(packagedRoot, 'server.js');
  if (existsSync(packagedServer)) {
    return {
      root: packagedRoot,
      serverPath: packagedServer,
      source: 'resources',
    };
  }

  const devRoot = path.join(app.getAppPath(), '.next', 'standalone');
  return {
    root: devRoot,
    serverPath: path.join(devRoot, 'server.js'),
    source: 'app-path',
  };
}

function getDesktopEnvPath(): string {
  const userDataDir = app.getPath('userData');
  return path.join(userDataDir, '.env.local');
}

function getIconPath(): string {
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const packagedIcon = path.join(process.resourcesPath, iconName);
  if (existsSync(packagedIcon)) {
    return packagedIcon;
  }
  return path.join(app.getAppPath(), 'electron', iconName);
}

function getLogPath(): string {
  return path.join(app.getPath('userData'), 'desktop.log');
}

function writeDesktopLog(message: string): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    appendFileSync(getLogPath(), `[${new Date().toISOString()}] ${message}\n`);
  } catch {
    // Logging must never prevent the desktop shell from opening.
  }
}

type DesktopUpdateState =
  | { status: 'idle'; version: string }
  | { status: 'checking'; version: string }
  | { status: 'available'; version: string; nextVersion: string }
  | { status: 'not-available'; version: string }
  | { status: 'downloading'; version: string; nextVersion?: string; percent: number }
  | { status: 'downloaded'; version: string; nextVersion: string }
  | { status: 'error'; version: string; message: string };

function sendUpdateState(state: DesktopUpdateState): void {
  writeDesktopLog(`Update state: ${JSON.stringify(state)}`);
  mainWindow?.webContents.send('desktop:update-state', state);
}

function normalizeUpdateUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function getUpdateFeedUrl(): string {
  return normalizeUpdateUrl(process.env.DESKTOP_UPDATE_URL || '');
}

function isPlaceholderUpdateFeed(value: string): boolean {
  const lower = value.toLowerCase();
  return lower.includes('updates.example.com') || lower.includes('example.com/huanzon-aistudio');
}

function readPackagedUpdateConfig(): string {
  const candidates = [
    path.join(process.resourcesPath, 'app-update.yml'),
    path.join(app.getAppPath(), 'app-update.yml'),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    } catch {
      // Missing or unreadable update config means auto-update is not configured.
    }
  }

  return '';
}

function resolveAutoUpdateDisabledReason(envFeedUrl: string): string | null {
  if (!app.isPackaged) return null;
  if (envFeedUrl) {
    return isPlaceholderUpdateFeed(envFeedUrl)
      ? `Auto update disabled: DESKTOP_UPDATE_URL points to a placeholder (${envFeedUrl}).`
      : null;
  }

  const packagedConfig = readPackagedUpdateConfig();
  if (!packagedConfig.trim()) {
    return 'Auto update disabled: no packaged update feed is configured.';
  }
  if (isPlaceholderUpdateFeed(packagedConfig)) {
    return 'Auto update disabled: packaged update feed points to updates.example.com placeholder.';
  }

  return null;
}

function loadAutoUpdater(): AppUpdater | null {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'updater', 'node_modules', 'electron-updater'),
        'electron-updater',
      ]
    : ['electron-updater'];

  for (const candidate of candidates) {
    try {
      // electron-updater is packaged as an external runtime dependency to avoid
      // pnpm symlink resolution issues inside the main app asar.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const updaterModule = require(candidate) as { autoUpdater?: AppUpdater };
      if (updaterModule.autoUpdater) {
        writeDesktopLog(`Auto updater loaded from ${candidate}`);
        return updaterModule.autoUpdater;
      }
    } catch (error) {
      writeDesktopLog(`Auto updater load failed from ${candidate}: ${String(error)}`);
    }
  }

  return null;
}

function showMessageBox(
  options: Electron.MessageBoxOptions
): Promise<Electron.MessageBoxReturnValue> {
  if (mainWindow) {
    return dialog.showMessageBox(mainWindow, options);
  }
  return dialog.showMessageBox(options);
}

function setupAutoUpdater(): void {
  desktopAutoUpdater = loadAutoUpdater();
  if (!desktopAutoUpdater) {
    writeDesktopLog('Auto update disabled: electron-updater runtime was not found.');
    return;
  }

  desktopAutoUpdater.autoDownload = false;
  desktopAutoUpdater.autoInstallOnAppQuit = true;
  desktopAutoUpdater.allowPrerelease = false;
  desktopAutoUpdater.logger = {
    info: (message?: unknown) => writeDesktopLog(`[autoUpdater] ${String(message ?? '')}`),
    warn: (message?: unknown) => writeDesktopLog(`[autoUpdater warn] ${String(message ?? '')}`),
    error: (message?: unknown) => writeDesktopLog(`[autoUpdater error] ${String(message ?? '')}`),
    debug: (message?: string) => writeDesktopLog(`[autoUpdater debug] ${message ?? ''}`),
  };

  const envFeedUrl = getUpdateFeedUrl();
  autoUpdateDisabledReason = resolveAutoUpdateDisabledReason(envFeedUrl);
  if (autoUpdateDisabledReason) {
    writeDesktopLog(autoUpdateDisabledReason);
  } else if (envFeedUrl) {
    desktopAutoUpdater.setFeedURL({ provider: 'generic', url: envFeedUrl });
    writeDesktopLog(`Auto update feed overridden by DESKTOP_UPDATE_URL: ${envFeedUrl}`);
  }

  desktopAutoUpdater.on('checking-for-update', () => {
    updateCheckInProgress = true;
    sendUpdateState({ status: 'checking', version: app.getVersion() });
  });

  desktopAutoUpdater.on('update-available', (info: UpdateInfo) => {
    updateCheckInProgress = false;
    sendUpdateState({ status: 'available', version: app.getVersion(), nextVersion: info.version });
    void showMessageBox({
        type: 'info',
        buttons: ['立即下载', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '发现新版本',
        message: `发现环中AIStudio ${info.version}`,
        detail: '可以现在下载更新，下载完成后重启应用即可安装。用户数据和本地配置会保留。',
      })
      .then(({ response }) => {
        if (response === 0) {
          void downloadUpdate();
        }
      });
  });

  desktopAutoUpdater.on('update-not-available', () => {
    updateCheckInProgress = false;
    sendUpdateState({ status: 'not-available', version: app.getVersion() });
  });

  desktopAutoUpdater.on('download-progress', (progress: ProgressInfo) => {
    sendUpdateState({
      status: 'downloading',
      version: app.getVersion(),
      percent: Math.max(0, Math.min(100, progress.percent || 0)),
    });
  });

  desktopAutoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    updateDownloaded = true;
    sendUpdateState({ status: 'downloaded', version: app.getVersion(), nextVersion: info.version });
    void showMessageBox({
        type: 'info',
        buttons: ['重启并安装', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '更新已下载',
        message: `环中AIStudio ${info.version} 已准备好`,
        detail: '点击“重启并安装”后会关闭当前应用、完成更新并重新打开。用户数据和本地配置会保留。',
      })
      .then(({ response }) => {
        if (response === 0) {
          installDownloadedUpdate();
        }
      });
  });

  desktopAutoUpdater.on('error', (error: Error) => {
    updateCheckInProgress = false;
    sendUpdateState({
      status: 'error',
      version: app.getVersion(),
      message: error.message || String(error),
    });
  });

  ipcMain.handle('desktop:update-check', async () => {
    return checkForUpdates();
  });

  ipcMain.handle('desktop:update-download', async () => {
    return downloadUpdate();
  });

  ipcMain.handle('desktop:update-install', async () => {
    installDownloadedUpdate();
    return { ok: true };
  });

  if (!app.isPackaged) {
    writeDesktopLog('Auto update skipped: app is not packaged.');
    return;
  }
  if (autoUpdateDisabledReason) {
    return;
  }

  setTimeout(() => {
    void checkForUpdates();
  }, 5000);
}

async function checkForUpdates(): Promise<{ ok: boolean; skipped?: boolean; message?: string }> {
  if (!app.isPackaged) {
    return { ok: true, skipped: true, message: 'Auto update is available only in packaged builds.' };
  }
  if (autoUpdateDisabledReason) {
    return { ok: true, skipped: true, message: autoUpdateDisabledReason };
  }
  if (updateCheckInProgress) {
    return { ok: true, skipped: true, message: 'Update check already running.' };
  }
  if (!desktopAutoUpdater) {
    return { ok: false, message: 'Auto updater runtime is not available.' };
  }
  try {
    await desktopAutoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendUpdateState({ status: 'error', version: app.getVersion(), message });
    return { ok: false, message };
  }
}

async function downloadUpdate(): Promise<{ ok: boolean; message?: string }> {
  if (autoUpdateDisabledReason) {
    return { ok: false, message: autoUpdateDisabledReason };
  }
  if (!desktopAutoUpdater) {
    return { ok: false, message: 'Auto updater runtime is not available.' };
  }
  try {
    await desktopAutoUpdater.downloadUpdate();
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendUpdateState({ status: 'error', version: app.getVersion(), message });
    return { ok: false, message };
  }
}

function installDownloadedUpdate(): void {
  if (!desktopAutoUpdater) {
    sendUpdateState({
      status: 'error',
      version: app.getVersion(),
      message: 'Auto updater runtime is not available.',
    });
    return;
  }
  if (!updateDownloaded) {
    sendUpdateState({
      status: 'error',
      version: app.getVersion(),
      message: 'Update has not been downloaded yet.',
    });
    return;
  }
  desktopAutoUpdater.quitAndInstall(false, true);
}

function getServerStartupTimeoutMs(): number {
  const raw = Number(process.env.DESKTOP_SERVER_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 5000 && raw <= 300000) {
    return Math.round(raw);
  }
  return DEFAULT_SERVER_STARTUP_TIMEOUT_MS;
}

function pushServerLogTail(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  serverLogTail.push(trimmed);
  if (serverLogTail.length > SERVER_LOG_TAIL_LIMIT) {
    serverLogTail = serverLogTail.slice(-SERVER_LOG_TAIL_LIMIT);
  }
}

function buildServerLogTail(maxLines = 40): string {
  if (serverLogTail.length === 0) return '';
  return `\nRecent server output:\n${serverLogTail.slice(-maxLines).join('\n')}`;
}

const executeFile = promisify(execFile);
async function openWebsiteInBrowser(url: string) {
  if (process.platform === 'darwin') {
    const browser = await app.getApplicationInfoForProtocol(url);
    // LaunchServices can route links to a headless Chromium QA instance. Launch
    // its normal profile explicitly; an existing visible instance will be reused.
    if (/chrome|chromium|edge|brave/i.test(browser.name)) {
      const { stdout } = await executeFile('/bin/ps', ['-axo', 'command=']);
      const headlessBrowser = stdout.split('\n').some(line => line.startsWith(browser.path + '/Contents/MacOS/') && /--headless(?:[=\s]|$)/.test(line));
      if (headlessBrowser) {
        await executeFile('/usr/bin/open', ['-n', '-a', browser.path, '--args', url]);
        return;
      }
    }
  }
  await shell.openExternal(url, { activate: true });
}

function isLocalAppUrl(url: string): boolean {
  try { return new URL(url).origin === `http://127.0.0.1:${serverPort}`; }
  catch { return false; }
}

/**
 * Wait until the forked local service is accepting TCP connections on
 * 127.0.0.1:port. A TCP probe succeeds the moment the Next.js standalone
 * server binds its port, without depending on the (potentially slow) first
 * page compile that an HTTP GET / probe would trigger. On slow Windows
 * machines with antivirus first-run scanning, the first HTTP response can
 * take well over a second; a per-request HTTP timeout of 1s caused the old
 * 15s "Local service did not respond" failure even though the server was
 * starting fine.
 */
function waitForServerListening(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;
    let lastProbeError = '';
    let attempts = 0;

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const attempt = () => {
      if (settled) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= timeoutMs) {
        const suffix = lastProbeError ? ` Last probe error: ${lastProbeError}` : '';
        rejectOnce(
          new Error(`Local service did not respond within ${timeoutMs / 1000} seconds.${suffix}`)
        );
        return;
      }

      let attemptSettled = false;
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.setTimeout(1500);

      const fail = (error: Error) => {
        if (attemptSettled) return;
        attemptSettled = true;
        socket.destroy();
        lastProbeError = error.message || String(error);
        attempts += 1;
        if (attempts === 1 || attempts % 40 === 0) {
          writeDesktopLog(
            `Waiting for local service on 127.0.0.1:${port}... ` +
              `(${(elapsed / 1000).toFixed(1)}s elapsed, ${attempts} attempts, last error: ${lastProbeError})`
          );
        }
        setTimeout(attempt, 250);
      };

      socket.once('connect', () => {
        if (attemptSettled) return;
        attemptSettled = true;
        socket.destroy();
        writeDesktopLog(
          `Local service is listening on 127.0.0.1:${port} after ${(elapsed / 1000).toFixed(1)}s (${attempts} probes).`
        );
        resolveOnce();
      });
      socket.once('timeout', () => fail(new Error('connect timed out')));
      socket.once('error', (error: NodeJS.ErrnoException) => fail(error));
    };

    attempt();
  });
}

/**
 * Optional warm-up request once the server is listening. This is
 * informational only: a timeout here must not fail startup, because the
 * window itself will load and Next.js will render the page when ready.
 */
async function warmUpLocalService(port: number): Promise<void> {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/',
        timeout: 15000,
      },
      (response) => {
        response.resume();
        writeDesktopLog(
          `Local service warm-up: GET / returned ${String(response.statusCode ?? 'no status')}.`
        );
        resolve();
      }
    );
    request.on('timeout', () => {
      writeDesktopLog(
        'Local service warm-up: GET / timed out; server is listening, page may still be compiling.'
      );
      request.destroy();
      resolve();
    });
    request.on('error', (error) => {
      writeDesktopLog(`Local service warm-up: GET / failed (${error.message}).`);
      resolve();
    });
  });
}

async function startNextServer(): Promise<void> {
  serverPort = await findAvailablePort(5000, 10);
  const standalone = resolveStandalone();
  const serverPath = standalone.serverPath;
  const standaloneRoot = standalone.root;
  const startupTimeoutMs = getServerStartupTimeoutMs();

  writeDesktopLog(
    `Startup environment: platform=${process.platform} arch=${process.arch} ` +
      `node=${process.versions.node} electron=${process.versions.electron} appVersion=${app.getVersion()}`
  );
  writeDesktopLog(
    `Resolve standalone: source=${standalone.source}, app.isPackaged=${String(app.isPackaged)}, ` +
      `appPath=${app.getAppPath()}, resourcesPath=${process.resourcesPath}`
  );
  writeDesktopLog(`Starting Next.js server from ${serverPath}`);
  writeDesktopLog(`Local service startup timeout: ${startupTimeoutMs}ms, chosen port: ${serverPort}`);

  if (!existsSync(serverPath)) {
    throw new Error(
      `Next.js standalone server not found at: ${serverPath}. Run "pnpm next build" first.`
    );
  }

  // Pre-flight diagnostics so desktop.log can pinpoint packaging mistakes
  // (e.g. a missing sharp native binary on Windows) without a second trip.
  const diagnostics: Array<[string, boolean]> = [
    ['server.js', existsSync(serverPath)],
    ['.next/BUILD_ID', existsSync(path.join(standaloneRoot, '.next', 'BUILD_ID'))],
    ['.next/server', existsSync(path.join(standaloneRoot, '.next', 'server'))],
    ['node_modules/next/package.json', existsSync(path.join(standaloneRoot, 'node_modules', 'next', 'package.json'))],
  ];
  if (process.platform === 'win32') {
    diagnostics.push([
      'node_modules/@img/sharp-win32-x64',
      existsSync(path.join(standaloneRoot, 'node_modules', '@img', 'sharp-win32-x64', 'package.json')),
    ]);
    diagnostics.push([
      'node_modules/@img/sharp-libvips-win32-x64',
      existsSync(path.join(standaloneRoot, 'node_modules', '@img', 'sharp-libvips-win32-x64', 'package.json')),
    ]);
  }
  for (const [label, present] of diagnostics) {
    writeDesktopLog(`  standalone/${label}: ${present ? 'present' : 'MISSING'}`);
  }
  const desktopEnvPath = getDesktopEnvPath();
  writeDesktopLog(`DESKTOP_ENV_PATH=${desktopEnvPath} exists=${String(existsSync(desktopEnvPath))}`);

  return new Promise((resolve, reject) => {
    let finished = false;
    const resolveOnce = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    const rejectOnce = (err: Error) => {
      if (finished) return;
      finished = true;
      if (nextServer?.pid) {
        nextServer.kill();
      }
      reject(err);
    };

    nextServer = utilityProcess.fork(serverPath, [], {
      cwd: standaloneRoot,
      env: {
        ...process.env,
        DESKTOP_GUEST_MODE: '1',
        DESKTOP_ENV_PATH: getDesktopEnvPath(),
        PORT: String(serverPort),
        DEPLOY_RUN_PORT: String(serverPort),
        HOSTNAME: '0.0.0.0',
        NODE_ENV: 'production',
      },
      stdio: 'pipe',
      serviceName: 'AIStudio Local Service',
    });

    nextServer.stdout?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.log('[Next.js]', msg);
      writeDesktopLog(`[Next.js] ${msg.trim()}`);
      for (const line of msg.split(/\r?\n/)) {
        pushServerLogTail(line);
      }
    });

    nextServer.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.error('[Next.js err]', msg);
      writeDesktopLog(`[Next.js err] ${msg.trim()}`);
      for (const line of msg.split(/\r?\n/)) {
        pushServerLogTail(line);
      }
      if (msg.includes('EADDRINUSE')) {
        rejectOnce(new Error(`Port ${serverPort} is already in use.`));
      }
    });

    nextServer.on('error', (type, location, report) => {
      const message = `Utility process failed: ${type} at ${location}`;
      console.error('Failed to start Next.js server:', message, report);
      writeDesktopLog(`Failed to start Next.js server: ${message}`);
      rejectOnce(new Error(message));
    });

    nextServer.on('exit', (code) => {
      console.log(`Next.js server exited with code ${code}`);
      writeDesktopLog(`Next.js server exited with code ${code}`);
      nextServer = null;
      rejectOnce(
        new Error(
          `Local service exited before startup completed (code ${code ?? 'unknown'}).` +
            buildServerLogTail(40)
        )
      );
    });

    void waitForServerListening(serverPort, startupTimeoutMs)
      .then(() => {
        writeDesktopLog(`Next.js server is ready at http://127.0.0.1:${serverPort}`);
        resolveOnce();
        // Fire-and-forget warm-up: never delay the window for the (potentially
        // slow) first page compile; the window loads the same URL itself.
        void warmUpLocalService(serverPort);
      })
      .catch((error: Error) => {
        const enriched = new Error(
          `${error.message}${buildServerLogTail(40)}`
        );
        rejectOnce(enriched);
      });
  });
}

function createErrorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const escapeHtml = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedMessage = escapeHtml(message);
  const escapedLogPath = escapeHtml(getLogPath());
  const tailLines = serverLogTail.slice(-30);
  const escapedTail = tailLines.length > 0 ? escapeHtml(tailLines.join('\n')) : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>环中AIStudio 启动失败</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f3ef; color: #221f1c; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { width: min(720px, calc(100vw - 48px)); border: 1px solid rgba(34,31,28,.12); border-radius: 24px; background: rgba(255,255,255,.86); box-shadow: 0 24px 80px rgba(53,40,22,.16); padding: 28px; }
    h1 { margin: 0 0 12px; font-size: 24px; }
    p { line-height: 1.7; margin: 8px 0; color: #5f574f; }
    code { display: block; margin-top: 12px; padding: 14px; border-radius: 14px; background: #efe9df; color: #2b2520; white-space: pre-wrap; word-break: break-word; }
    details { margin-top: 16px; border-top: 1px solid rgba(34,31,28,.1); padding-top: 12px; }
    summary { cursor: pointer; font-weight: 600; color: #4a4238; }
    pre { max-height: 260px; overflow: auto; margin-top: 10px; padding: 12px; border-radius: 12px; background: #1f1b16; color: #e8e2d8; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <main>
    <h1>应用启动失败</h1>
    <p>内置服务没有正常启动，所以之前会显示黑色空白界面。</p>
    <p>如果是首次启动，可能只是本机较慢（杀毒软件首次扫描也会拖慢启动），请稍等 1 分钟后重新打开；若反复失败，请把下面日志路径发给开发者，或重新安装最新安装包。</p>
    <code>错误：${escapedMessage}\n日志：${escapedLogPath}</code>
    ${escapedTail ? `<details><summary>查看内置服务最近输出</summary><pre>${escapedTail}</pre></details>` : ''}
  </main>
</body>
</html>`;
}

function createWindow(serverError?: unknown) {
  mainWindow = new BrowserWindow({
    width: Math.max(1024, Math.min(1600, Math.round(screen.getPrimaryDisplay().workAreaSize.width * 0.85))),
    height: Math.max(680, Math.min(1000, Math.round(screen.getPrimaryDisplay().workAreaSize.height * 0.85))),
    minWidth: 1024,
    minHeight: 680,
    title: '环中AIStudio',
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
    backgroundColor: '#09090b',
  });

  if (process.platform === 'win32') {
    const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    mainWindow.setAppDetails({
      appId: 'com.huanzon.aistudio',
      appIconPath: getIconPath(), appIconIndex: 0,
      relaunchCommand: `"${executable}"`,
      relaunchDisplayName: desktopProductName,
    });
  }

  if (serverError) {
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createErrorHtml(serverError))}`);
  } else {
    // Use 127.0.0.1 (not "localhost"): on Windows "localhost" can resolve to
    // ::1 (IPv6) while the standalone server binds IPv4 0.0.0.0, which would
    // show a blank/error page even though the local service is healthy.
    mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  }

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || !validatedURL.startsWith(`http://127.0.0.1:${serverPort}`)) {
        return;
      }
      const error = new Error(`Page failed to load (${errorCode}): ${errorDescription}`);
      writeDesktopLog(error.message);
      mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createErrorHtml(error))}`);
    }
  );

  // Re-fit zoom whenever the window changes size/mode/monitor so the whole UI
  // stays visible and proportionally sized across different resolutions/DPIs.
  const zoomRefreshEvents = [
    'resize',
    'maximize',
    'unmaximize',
    'restore',
    'enter-full-screen',
    'leave-full-screen',
  ] as const;
  for (const eventName of zoomRefreshEvents) {
    mainWindow.on(eventName as 'resize', () => applyUiZoom());
  }
  mainWindow.on('focus', () => applyUiZoom());

  // Cmd/Ctrl +/- adjusts the UI scale (persisted); Cmd/Ctrl+0 resets to auto.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
    const zoomIn = input.key === '+' || input.key === '=' || input.key === 'Add';
    const zoomOut = input.key === '-' || input.key === 'Subtract';
    const zoomReset = input.key === '0';
    if (!zoomIn && !zoomOut && !zoomReset) return;
    event.preventDefault();
    if (zoomReset) {
      userZoomMultiplier = 1.0;
    } else {
      const direction = zoomIn ? 1 : -1;
      userZoomMultiplier = Math.min(
        UI_USER_ZOOM_MAX,
        Math.max(
          UI_USER_ZOOM_MIN,
          Math.round((userZoomMultiplier + direction * UI_USER_ZOOM_STEP) * 100) / 100,
        ),
      );
    }
    saveUserZoomMultiplier(userZoomMultiplier);
    applyUiZoom();
  });

  mainWindow.once('ready-to-show', () => {
    applyUiZoom();
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalAppUrl(url)) {
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocalAppUrl(url)) {
      return;
    }
    event.preventDefault();
    void shell.openExternal(url);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  ipcMain.handle('desktop:open-external', async (event, value: unknown) => {
    if (event.sender !== mainWindow?.webContents || !isLocalAppUrl(event.senderFrame?.url || '')) throw new Error('不支持的窗口');
    if (typeof value !== 'string') throw new Error('官网地址无效');
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('官网地址无效');
    try {
      await openWebsiteInBrowser(url.href);
      return { success: true };
    } catch {
      return { success: false, message: '系统浏览器未能打开，请复制官网地址后手动访问。' };
    }
  });
  ipcMain.handle('desktop:prepare-library-import', async (event, files: unknown) => {
    if (event.sender !== mainWindow?.webContents || !isLocalAppUrl(event.senderFrame?.url || '')) throw new Error('不支持的窗口');
    if (!Array.isArray(files) || files.length > 100) throw new Error('请分批选择图片');
    const dir = path.join(process.env.LOCAL_DATA_DIR || app.getPath('userData'), 'import-sources');
    await fsp.mkdir(dir, { recursive: true });
    const result: Array<string | null> = [];
    for (const file of files) {
      if (typeof file !== 'string' || !path.isAbsolute(file)) { result.push(null); continue; }
      try {
        const info = await fsp.stat(file); if (!info.isFile() || !/\.(png|jpe?g|webp)$/i.test(file) || info.size > 25 * 1024 * 1024) { result.push(null); continue; }
        const token = randomUUID();
        await fsp.writeFile(path.join(dir, `${token}.json`), JSON.stringify({ path: file, bytes: info.size, mtimeMs: info.mtimeMs, expiresAt: Date.now() + 7 * 86400_000 }), { mode: 0o600 });
        result.push(token);
      } catch { result.push(null); }
    }
    return result;
  });
  ipcMain.on('desktop:settings-read', (event) => {
    try {
      event.returnValue = isLocalAppUrl(event.senderFrame?.url || '') ? readSettings(app.getPath('userData')) : {};
    } catch { event.returnValue = {}; }
  });
  ipcMain.on('desktop:settings-write', (event, changes: unknown) => {
    try {
      if (isLocalAppUrl(event.senderFrame?.url || '')) updateSettings(app.getPath('userData'), changes);
      event.returnValue = true;
    } catch { event.returnValue = false; }
  });
  const exportedImagePaths = new Set<string>();
  const imageExporter = new ImageExporter({
    dataDirectory: process.env.LOCAL_DATA_DIR || app.getPath('userData'),
    downloadsDirectory: app.getPath('downloads'),
    get appOrigin() { return `http://127.0.0.1:${serverPort}`; },
    // jszip is supplied by the standalone runtime, outside app.asar.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadZip: () => require(require.resolve('jszip', { paths: [resolveStandalone().root, app.getAppPath()] })),
    progress: value => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('desktop:image-export-progress', value); },
  });
  const illustratorTracer = new IllustratorTracer({
    tempDirectory: app.getPath('temp'),
    dataDirectory: process.env.LOCAL_DATA_DIR || app.getPath('userData'),
    downloadsDirectory: app.getPath('downloads'),
    stageImage: (url, directory) => imageExporter.stageImage(url, directory),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loadSharp: () => require(require.resolve('sharp', { paths: [resolveStandalone().root, app.getAppPath()] })),
  });
  ipcMain.handle('desktop:illustrator-trace', async (event, request: unknown) => {
    if (event.sender !== mainWindow?.webContents || !isLocalAppUrl(event.senderFrame?.url || '')) throw new Error('不支持的窗口');
    const result = await illustratorTracer.trace(request);
    if (result.file) exportedImagePaths.add(result.file);
    return result;
  });
  ipcMain.handle('desktop:export-images', async (event, request: ImageExportRequest) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('不支持的窗口');
    try {
      const result = await imageExporter.export(request);
      for (const file of result.files) {
        try { await applyLibraryFileIcon(file, process.resourcesPath); }
        catch (error) { writeDesktopLog(`Resource package icon: ${String(error)}`); }
      }
      for (const file of result.files) exportedImagePaths.add(file);
      while (exportedImagePaths.size > 1000) exportedImagePaths.delete(exportedImagePaths.values().next().value!);
      return { success: true, ...result };
    }
    catch (error) { return { success: false, files: [], failures: [], error: error instanceof Error ? error.message : '下载失败' }; }
  });
  ipcMain.handle('desktop:reveal-export', (event, filePath: unknown) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('不支持的窗口');
    if (typeof filePath !== 'string' || !exportedImagePaths.has(filePath)) return { success: false, error: '请先下载文件' };
    if (!existsSync(filePath)) return { success: false, error: '文件已被移动或删除' };
    shell.showItemInFolder(filePath);
    return { success: true };
  });
  ipcMain.handle('desktop:select-storage-directory', async (event, defaultPath?: string) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('不支持的窗口');
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: '选择图片储存文件夹', properties: ['openDirectory', 'createDirectory'],
      ...(typeof defaultPath === 'string' && path.isAbsolute(defaultPath) && existsSync(defaultPath) ? { defaultPath } : {}),
    });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  userZoomMultiplier = loadUserZoomMultiplier();
  screen.on('display-metrics-changed', () => applyUiZoom());

  let serverError: unknown = null;
  try {
    await startNextServer();
  } catch (err) {
    console.error('Failed to start Next.js server:', err);
    writeDesktopLog(`Server startup failed: ${String(err)}`);
    serverError = err;
  }

  createWindow(serverError);
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (nextServer) {
    nextServer.kill();
    nextServer = null;
  }
});

function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port, '0.0.0.0');
  });
}

async function findAvailablePort(start: number, maxChecks: number): Promise<number> {
  for (let i = 0; i < maxChecks; i += 1) {
    const candidate = start + i;
    // eslint-disable-next-line no-await-in-loop
    if (await checkPortAvailable(candidate)) return candidate;
  }
  return start;
}
