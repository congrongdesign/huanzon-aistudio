import { app, BrowserWindow, dialog, ipcMain, screen, shell, utilityProcess } from 'electron';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import http from 'http';
import net from 'net';
import path from 'path';
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';

let mainWindow: BrowserWindow | null = null;
let nextServer: Electron.UtilityProcess | null = null;
let serverPort = 5000;
let updateDownloaded = false;
let updateCheckInProgress = false;
let desktopAutoUpdater: AppUpdater | null = null;
let autoUpdateDisabledReason: string | null = null;

const desktopProductName = '环中AIStudio';
const legacyUserDataName = 'projects';

app.setName(desktopProductName);
configureStableUserDataPath();

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

  if (stableUserDataDir !== legacyUserDataDir && existsSync(legacyUserDataDir)) {
    mergeCopyMissing(legacyUserDataDir, stableUserDataDir);
  }

  mkdirSync(stableUserDataDir, { recursive: true });
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
  const packagedIcon = path.join(process.resourcesPath, 'icon.png');
  if (existsSync(packagedIcon)) {
    return packagedIcon;
  }
  return path.join(app.getAppPath(), 'electron', 'icon.png');
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

function waitForServerReady(port: number, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let settled = false;

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

    const retry = () => {
      if (settled) return;
      if (Date.now() - startedAt >= timeoutMs) {
        rejectOnce(new Error(`Local service did not respond within ${timeoutMs / 1000} seconds.`));
        return;
      }
      setTimeout(check, 250);
    };

    const check = () => {
      const request = http.get(
        {
          hostname: '127.0.0.1',
          port,
          path: '/',
          timeout: 1000,
        },
        (response) => {
          response.resume();
          if (response.statusCode && response.statusCode < 500) {
            resolveOnce();
            return;
          }
          retry();
        }
      );

      request.on('timeout', () => request.destroy());
      request.on('error', retry);
    };

    check();
  });
}

async function startNextServer(): Promise<void> {
  serverPort = await findAvailablePort(5000, 10);
  const standalone = resolveStandalone();
  const serverPath = standalone.serverPath;
  const standaloneRoot = standalone.root;

  writeDesktopLog(
    `Resolve standalone: source=${standalone.source}, app.isPackaged=${String(app.isPackaged)}, appPath=${app.getAppPath()}, resourcesPath=${process.resourcesPath}`
  );
  writeDesktopLog(`Starting Next.js server from ${serverPath}`);

  if (!existsSync(serverPath)) {
    throw new Error(
      `Next.js standalone server not found at: ${serverPath}. Run "pnpm next build" first.`
    );
  }

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
    });

    nextServer.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString();
      console.error('[Next.js err]', msg);
      writeDesktopLog(`[Next.js err] ${msg.trim()}`);
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
      rejectOnce(new Error(`Local service exited before startup completed (code ${code ?? 'unknown'}).`));
    });

    void waitForServerReady(serverPort)
      .then(() => {
        writeDesktopLog(`Next.js server is ready at http://127.0.0.1:${serverPort}`);
        resolveOnce();
      })
      .catch(rejectOnce);
  });
}

function createErrorHtml(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const escapedMessage = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const escapedLogPath = getLogPath()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

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
  </style>
</head>
<body>
  <main>
    <h1>应用启动失败</h1>
    <p>内置服务没有正常启动，所以之前会显示黑色空白界面。</p>
    <p>请把下面日志路径发给开发者，或重新安装最新安装包。</p>
    <code>错误：${escapedMessage}\n日志：${escapedLogPath}</code>
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

  if (serverError) {
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createErrorHtml(serverError))}`);
  } else {
    mainWindow.loadURL(`http://localhost:${serverPort}`);
  }

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || !validatedURL.startsWith(`http://localhost:${serverPort}`)) {
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
    if (
      url.startsWith('http://localhost') ||
      url.startsWith('https://localhost')
    ) {
      return { action: 'allow' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (
      url.startsWith('http://localhost') ||
      url.startsWith('https://localhost')
    ) {
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
