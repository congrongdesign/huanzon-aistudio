import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type sharp from 'sharp';

export type IllustratorTraceRequest = { url: string; title: string; mode: 'black-white' | 'color'; threshold: number; ignoreWhite: boolean; keepEditableTrace?: boolean };
type Options = {
  tempDirectory: string;
  dataDirectory: string;
  downloadsDirectory: string;
  stageImage: (url: string, directory: string) => Promise<string>;
  loadSharp: () => typeof sharp;
};
const execute = promisify(execFile);
const literal = (value: string) => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Resolve the registered app without assuming a year, install directory, or UI language. */
export function windowsIllustratorRunner(): string {
  return `param([Parameter(Mandatory=$true)][string]$ScriptPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$code = [System.IO.File]::ReadAllText($ScriptPath, [System.Text.Encoding]::UTF8)
$illustrator = $null
try { $illustrator = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Illustrator.Application') } catch {}
if ($null -eq $illustrator) {
  $progIds = @('Illustrator.Application')
  $registered = Get-ChildItem Registry::HKEY_CLASSES_ROOT -ErrorAction SilentlyContinue |
    Where-Object { $_.PSChildName -match '^Illustrator\\.Application\\.[0-9]+$' } |
    Sort-Object { [int]($_.PSChildName.Split('.')[-1]) } -Descending
  foreach ($entry in $registered) { $progIds += $entry.PSChildName }
  foreach ($progId in $progIds) {
    try { $illustrator = New-Object -ComObject $progId; break } catch {}
  }
}
if ($null -eq $illustrator) { throw 'AISTUDIO_NOT_INSTALLED: Illustrator automation unavailable' }
$illustrator.Visible = $true
$result = $illustrator.DoJavaScript($code)
[Console]::WriteLine([string]$result)
`;
}

/** Runs exclusively in a NEW document; no commands target the user's existing art. */
export function illustratorTraceScript(source: string, output: string, title: string, request: IllustratorTraceRequest, panelAlreadyOpen = false): string {
  return `(function () {
    var doc = null;
    try {
      doc = app.documents.add(DocumentColorSpace.RGB);
      var originalLayer = doc.layers[0]; originalLayer.name = "原图（对照）";
      var original = originalLayer.placedItems.add(); original.file = new File(${literal(source)});
      app.redraw();
      var width = original.width, height = original.height;
      if (width <= 0 || height <= 0) throw new Error("无法读取图片尺寸");
      var scale = Math.min(1, 16000 / Math.max(width, height));
      original.width = width * scale; original.height = height * scale;
      width = original.width; height = original.height;
      doc.artboards[0].artboardRect = [0, height, width, 0]; original.position = [0, height];
      // Embed before deleting staging files, including the hidden comparison image.
      original.embed();
      var vectorLayer = doc.layers.add(); vectorLayer.name = "矢量描摹 · " + ${literal(title)};
      var placed = vectorLayer.placedItems.add(); placed.file = new File(${literal(source)});
      app.redraw();
      placed.width = width; placed.height = height; placed.position = [0, height];
      placed.embed();
      var plugin = vectorLayer.rasterItems[0].trace();
      // Finish Illustrator's initial asynchronous trace before applying our options.
      app.redraw();
      var tracing = plugin.tracing; var options = tracing.tracingOptions;
      ${request.mode === 'color' ? `var presets = app.tracingPresetsList;
      for (var pi = 0; pi < presets.length; pi++) {
        if (/16/.test(presets[pi])) { options.loadFromPreset(presets[pi]); break; }
      }
      app.redraw();` : ''}
      options.tracingMode = ${request.mode === 'color' ? 'TracingModeType.TRACINGMODECOLOR' : 'TracingModeType.TRACINGMODEBLACKANDWHITE'};
      app.redraw();
      options.tracingMethod = TracingMethodType.TRACINGMETHODABUTTING;
      options.fills = true; options.strokes = false;
      options.pathFidelity = 90; options.cornerFidelity = 75; options.noiseFidelity = 4;
      ${request.mode === 'color' ? 'options.tracingColorTypeValue = TracingColorType.TRACINGLIMITEDCOLOR; app.redraw(); options.maxColors = 16;' : `options.threshold = ${request.threshold}; options.ignoreWhite = ${request.ignoreWhite};`}
      app.redraw();
      var paths = tracing.pathCount, anchors = tracing.anchorCount;
      if (paths < 1) throw new Error("没有描摹到轮廓，请调整黑白阈值或改用彩色图稿");
      var selectedArt;
      ${request.keepEditableTrace !== false ? `selectedArt = plugin;
      plugin.name = "实时描摹（可在图像描摹面板调整）";` : `
      var group = tracing.expandTracing(); group.name = "可编辑矢量轮廓";
      ${request.mode === 'black-white' && request.ignoreWhite ? `// Some Illustrator versions retain white fills despite ignoreWhite.
      function isWhite(color) {
        return (color.typename === 'GrayColor' && color.gray === 0) ||
          (color.typename === 'RGBColor' && color.red >= 254 && color.green >= 254 && color.blue >= 254) ||
          (color.typename === 'CMYKColor' && color.cyan === 0 && color.magenta === 0 && color.yellow === 0 && color.black === 0);
      }
      function removeWhite(container) {
        for (var i = container.pageItems.length - 1; i >= 0; i--) {
          var item = container.pageItems[i];
          if (item.typename === 'GroupItem') removeWhite(item);
          else if (item.typename === 'CompoundPathItem') {
            if (item.pathItems.length && item.pathItems[0].filled && isWhite(item.pathItems[0].fillColor)) item.remove();
          } else if (item.typename === 'PathItem' && item.filled && isWhite(item.fillColor)) item.remove();
        }
      }
      removeWhite(group);` : ''}
      function countPaths(container) {
        var count = 0;
        for (var i = 0; i < container.pageItems.length; i++) {
          var item = container.pageItems[i];
          if (item.typename === 'GroupItem') count += countPaths(item);
          else if (item.typename === 'CompoundPathItem') count += item.pathItems.length;
          else if (item.typename === 'PathItem') count++;
        }
        return count;
      }
      paths = countPaths(group);
      if (!paths) throw new Error("没有描摹到轮廓，请调整黑白阈值或改用彩色图稿");
      selectedArt = group;`}
      originalLayer.visible = false;
      doc.activeLayer = vectorLayer; doc.selection = null; selectedArt.selected = true;
      app.executeMenuCommand('fitin');
      var panelOpened = true;
      doc.selection = null; selectedArt.selected = true; app.redraw();
      var saveOptions = new IllustratorSaveOptions(); saveOptions.pdfCompatible = true;
      doc.saveAs(new File(${literal(output)}), saveOptions);
      app.redraw();
      ${panelAlreadyOpen ? '' : "try { app.executeMenuCommand('Adobe Vectorize Panel'); } catch (panelError) { panelOpened = false; }"}
      doc.selection = null; selectedArt.selected = true; app.redraw();
      return "AISTUDIO_OK|" + paths + "|" + anchors + "|" + (panelOpened ? "1" : "0");
    } catch (e) {
      // Leave the newly created document open for recovery when tracing/saving fails.
      return "AISTUDIO_ERROR|" + String(e.message || e);
    }
  })();`;
}

export class IllustratorTracer {
  private busy = false;
  constructor(private options: Options) {}

  async trace(value: unknown): Promise<{ success: boolean; file?: string; paths?: number; live?: boolean; panelOpened?: boolean; error?: string }> {
    if (!['darwin', 'win32'].includes(process.platform)) return { success: false, error: '自动描摹支持 Windows 和 macOS 桌面版。' };
    if (this.busy) return { success: false, error: 'Illustrator 正在描摹上一张图片，请等待完成。' };
    const request = value as IllustratorTraceRequest;
    if (!request || typeof request.url !== 'string' || request.url.length > 8192 || typeof request.title !== 'string' || request.title.length > 200 ||
      !['black-white', 'color'].includes(request.mode) || !Number.isInteger(request.threshold) || request.threshold < 1 || request.threshold > 255 || typeof request.ignoreWhite !== 'boolean' || (request.keepEditableTrace !== undefined && typeof request.keepEditableTrace !== 'boolean')) {
      return { success: false, error: '描摹参数无效，请重新选择。' };
    }
    this.busy = true;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(path.join(this.options.tempDirectory, 'aistudio-trace-'));
      const staged = await this.options.stageImage(request.url, directory);
      const source = path.join(directory, 'image.png');
      // Illustrator cannot place every generated web format. Normalize once at original resolution.
      await this.options.loadSharp()(staged, { limitInputPixels: 100_000_000 }).rotate().flatten({ background: '#ffffff' }).png().toFile(source);
      let downloadDirectory = this.options.downloadsDirectory;
      try {
        const config = JSON.parse(await readFile(path.join(this.options.dataDirectory, 'runtime-config.json'), 'utf8'));
        if (typeof config.downloadDirectory === 'string' && config.downloadDirectory.trim()) downloadDirectory = config.downloadDirectory.trim();
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取下载设置'); }
      await mkdir(downloadDirectory, { recursive: true });
      const title = request.title.replace(/[\\/:*?"<>|\r\n\x00-\x1f]+/g, '_').trim().slice(0, 60) || '字体作品';
      const output = path.join(downloadDirectory, `${title}-矢量描摹-${randomUUID()}.ai`);
      let panelAlreadyOpen = false;
      if (process.platform === 'darwin') {
        // The Window command toggles. Read its checked state where available;
        // failure falls back to the Illustrator command.
        try {
          const state = await execute('/usr/bin/osascript', ['-e', `tell application "System Events"
  tell (first application process whose bundle identifier is "com.adobe.illustrator")
    repeat with menuName in {"窗口", "視窗", "Window", "Fenster", "Fenêtre", "ウィンドウ"}
      try
      repeat with entry in menu items of menu 1 of menu bar item (menuName as text) of menu bar 1
        if (name of entry as text) is in {"图像描摹", "影像描圖", "Image Trace", "画像トレース", "Bildnachzeichner", "Vectorisation de l’image"} then
          try
            return value of attribute "AXMenuItemMarkChar" of entry
          end try
        end if
      end repeat
      end try
    end repeat
  end tell
end tell`], { timeout: 3000 });
          panelAlreadyOpen = state.stdout.includes('✓');
        } catch { /* Illustrator may not be running yet; its script opens the panel. */ }
      }
      const script = illustratorTraceScript(source, output, title, request, panelAlreadyOpen);
      const appleScript = `on run argv\nwith timeout of 240 seconds\ntell application id "com.adobe.illustrator"\nactivate\nreturn do javascript (item 1 of argv)\nend tell\nend timeout\nend run`;
      let stdout: string;
      if (process.platform === 'darwin') {
        ({ stdout } = await execute('/usr/bin/osascript', ['-e', appleScript, script], { timeout: 250_000, maxBuffer: 1024 * 1024 }));
        if (stdout.includes('AISTUDIO_OK|')) {
          // Illustrator can restore a different panel layout during saveAs.
          // Ensure the panel is visible AFTER the document has finished saving.
          try {
            await execute('/usr/bin/osascript', ['-e', `tell application "System Events"
tell (first application process whose bundle identifier is "com.adobe.illustrator")
  repeat with menuName in {"窗口", "視窗", "Window", "Fenster", "Fenêtre", "ウィンドウ"}
    try
      repeat with entry in menu items of menu 1 of menu bar item (menuName as text) of menu bar 1
        if (name of entry as text) is in {"图像描摹", "影像描圖", "Image Trace", "画像トレース", "Bildnachzeichner", "Vectorisation de l’image"} then
          set mark to value of attribute "AXMenuItemMarkChar" of entry
          if mark is missing value or mark is "" then click entry
          return "visible"
        end if
      end repeat
    end try
  end repeat
end tell
end tell`], { timeout: 3000 });
          } catch { /* The cross-platform Illustrator command remains the fallback. */ }
        }
      } else {
        const jsx = path.join(directory, 'trace.jsx'), runner = path.join(directory, 'trace.ps1');
        await writeFile(jsx, script, 'utf8');
        await writeFile(runner, '\ufeff' + windowsIllustratorRunner(), 'utf8');
        ({ stdout } = await execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner, '-ScriptPath', jsx],
          { timeout: 250_000, maxBuffer: 1024 * 1024, windowsHide: true }));
      }
      const match = stdout.trim().match(/AISTUDIO_OK\|(\d+)\|(\d+)\|([01])$/);
      if (!match) throw new Error(stdout.trim().replace(/^AISTUDIO_ERROR\|/, '') || 'Illustrator 未返回描摹结果');
      return { success: true, file: output, paths: Number(match[1]), live: request.keepEditableTrace !== false, panelOpened: match[3] === '1' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/-1743|not authorized|not permitted/i.test(message)) return { success: false, error: '请在系统设置 → 隐私与安全性 → 自动化中，允许环中AIStudio 控制 Adobe Illustrator，然后重试。' };
      if (/-10814|can.t get application|无法找到应用程序|AISTUDIO_NOT_INSTALLED|80040154/i.test(message)) return { success: false, error: '未找到可用的 Illustrator 脚本接口。请先安装并打开 Illustrator；Windows 如仍失败，请修复 Illustrator 安装以注册自动化组件。' };
      if (/80010001|8001010A|rejected by callee/i.test(message)) return { success: false, error: 'Illustrator 正忙或有弹窗，请先关闭弹窗，再重试描摹。' };
      if (/-1712|timed out|ETIMEDOUT/i.test(message) || (error as { killed?: boolean }).killed) return { success: false, error: 'Illustrator 响应超时，请切换到 Illustrator 检查弹窗或描摹进度后再试。新文档如已创建会保留。' };
      return { success: false, error: `描摹未完成：${message.slice(0, 500)}` };
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
      this.busy = false;
    }
  }
}
