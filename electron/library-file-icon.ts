import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execute = promisify(execFile);
const setIconScript = `ObjC.import('AppKit');
function run(argv) {
  var icon = $.NSImage.alloc.initWithContentsOfFile(argv[0]);
  if (!icon || !$.NSWorkspace.sharedWorkspace.setIconForFileOptions(icon, argv[1], 0)) {
    throw new Error('无法设置资源包图标');
  }
}`;

/** Finder may retain a generic type icon; attach the existing logo to each saved package. */
export async function applyLibraryFileIcon(file: string, resources: string): Promise<void> {
  if (process.platform !== 'darwin' || path.extname(file).toLowerCase() !== '.hzlib') return;
  await execute('/usr/bin/osascript', ['-l', 'JavaScript', '-e', setIconScript, path.join(resources, 'icon.icns'), file], { timeout: 10000 });
}
