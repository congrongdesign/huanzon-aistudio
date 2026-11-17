import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { createClient, type InArgs } from '@libsql/client';

const root = String(workerData.root);
fs.mkdirSync(root, { recursive: true });
const db = createClient({ url: pathToFileURL(path.join(root, 'queue.db')).href });
sharp.concurrency(1); sharp.cache({ memory: 32, files: 8, items: 32 });
const ready = (async () => { await db.execute('PRAGMA journal_mode=WAL'); await db.execute('PRAGMA busy_timeout=5000'); await db.batch([
  'CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, owner TEXT NOT NULL, batch_id TEXT NOT NULL, stage TEXT NOT NULL, data TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS items_owner ON items(owner, batch_id)',
  'CREATE INDEX IF NOT EXISTS items_stage ON items(stage)',
  'CREATE TABLE IF NOT EXISTS cache(id TEXT PRIMARY KEY, data TEXT NOT NULL)',
], 'write'); })();
type Message = { id: number; op: string; input: Record<string, unknown> };
async function execute(op: string, input: Record<string, unknown>) {
  await ready;
  if (op === 'sql') {
    const result = await db.execute({ sql: String(input.sql), args: (input.args || []) as InArgs });
    return { rows: result.rows.map(row => ({ ...row })), affected: result.rowsAffected };
  }
  if (op === 'batch') return db.batch(input.statements as { sql: string; args: InArgs }[], 'write').then(() => true);
  if (op === 'ingest') {
    const source = String(input.source), destination = String(input.destination), keyPrefix = String(input.keyPrefix);
    const before = await fsp.stat(source);
    if (!before.isFile() || before.size <= 0 || before.size > 25 * 1024 * 1024) throw new Error('请使用 25 MiB 以内的静态图片');
    await fsp.mkdir(destination, { recursive: true });
    const temp = path.join(destination, `.import-${randomUUID()}.tmp`), hash = createHash('sha256');
    try {
      let copied = 0;
      await pipeline(fs.createReadStream(source, { highWaterMark: 128 * 1024 }), new Transform({ transform(chunk, _, callback) { copied += chunk.length; if (copied > 25 * 1024 * 1024) return callback(new Error('图片超过 25 MiB')); hash.update(chunk); callback(null, chunk); } }), fs.createWriteStream(temp, { flags: 'wx' }));
      const after = await fsp.stat(source);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error('原图在复制期间发生变化，请重新导入');
      const meta = await sharp(temp, { limitInputPixels: 80_000_000, failOn: 'error' }).metadata();
      if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || (meta.pages || 1) > 1) throw new Error('请使用静态 JPG、PNG 或 WebP 图片');
      const digest = hash.digest('hex'), key = `${keyPrefix}${digest}.${meta.format === 'jpeg' ? 'jpg' : meta.format}`;
      const target = path.join(destination, key);
      // Decode before committing the original; do not accept a valid header with corrupt pixels.
      const thumbnail = await sharp(temp, { limitInputPixels: 80_000_000, failOn: 'error' }).rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
      const handle = await fsp.open(temp, 'r'); try { await handle.sync(); } finally { await handle.close(); }
      // A journal is visible to the existing media GC before the file becomes reachable.
      const journal = String(input.journal);
      await fsp.mkdir(path.dirname(journal), { recursive: true });
      await fsp.writeFile(journal, JSON.stringify({ key, pending: true }));
      try { await fsp.access(target); } catch { await fsp.rename(temp, target); }
      await fsp.writeFile(target + '.512.webp', thumbnail);
      const swapped = [5, 6, 7, 8].includes(meta.orientation || 0);
      return { key, hash: digest, bytes: before.size, width: (swapped ? meta.height : meta.width) || 1, height: (swapped ? meta.width : meta.height) || 1 };
    } finally { await fsp.unlink(temp).catch(() => {}); }
  }
  if (op === 'analysis-image') return (await sharp(String(input.file), { limitInputPixels: 80_000_000 }).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#fff' }).jpeg({ quality: 88 }).toBuffer()).toString('base64');
  throw new Error('未知后台操作');
}
parentPort!.on('message', (message: Message) => {
  void execute(message.op, message.input).then(result => parentPort!.postMessage({ id: message.id, result }), error => parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : '后台处理失败' }));
});
