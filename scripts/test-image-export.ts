import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { ImageExporter } from '../electron/image-export';

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), 'aistudio-image-export-'));
  const data = path.join(root, 'data');
  const downloads = path.join(root, 'downloads');
  const previous = path.join(root, 'previous');
  await mkdir(path.join(data, 'local-data/files'), { recursive: true });
  await mkdir(path.join(previous, 'files'), { recursive: true });
  const bytes = Buffer.from('PNG original image bytes, not the thumbnail');
  await writeFile(path.join(data, 'local-data/files/original.png'), bytes);
  await writeFile(path.join(previous, 'files/old.png'), bytes);
  await writeFile(path.join(data, 'runtime-config.json'), JSON.stringify({ mediaPreviousDirectories: [previous] }));
  let remoteRequests = 0;
  const server = createServer((req, res) => {
    remoteRequests++;
    if (req.url === '/bad') { res.writeHead(503); res.end('Unavailable'); return; }
    if (req.url === '/html') { res.setHeader('content-type', 'text/html'); res.end('<html>login</html>'); return; }
    if (req.url === '/broken') { res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '1000' }); res.write('partial'); setImmediate(() => res.destroy()); return; }
    res.setHeader('content-type', 'image/png'); res.end(bytes);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
  const progress: number[] = [];
  const exporter = new ImageExporter({ dataDirectory: data, downloadsDirectory: downloads, appOrigin: origin, loadZip: () => JSZip, progress: p => progress.push(p.completed) });
  let id = 0;
  const one = (url: string, filename = '同名.png') => ({ id: `test-${id++}`, files: [{ url, filename }] });
  try {
    const local = '/api/local-file/original.png?w=128';
    // The app's HTTP service is completely unavailable: local downloads must still succeed.
    const offlineExporter = new ImageExporter({ dataDirectory: data, downloadsDirectory: downloads, appOrigin: 'http://127.0.0.1:1', loadZip: () => JSZip });
    const offline = await offlineExporter.export(one(local));
    assert.deepEqual(await readFile(offline.files[0]), bytes);
    assert.equal(remoteRequests, 0);
    const simultaneous = await Promise.all(Array.from({ length: 8 }, () => exporter.export(one(local))));
    assert.equal(new Set(simultaneous.flatMap(r => r.files)).size, 8);
    for (const result of simultaneous) assert.deepEqual(await readFile(result.files[0]), bytes);
    const duplicate = one(local);
    assert.equal(exporter.export(duplicate), exporter.export(duplicate));
    await exporter.export(duplicate);
    const old = await exporter.export(one('/api/local-file/old.png'));
    assert.deepEqual(await readFile(old.files[0]), bytes);
    const batch = await exporter.export({ id: 'partial', files: [{ url: '/api/local-file/missing.png', filename: 'missing.png' }, { url: local, filename: 'present.png' }] });
    assert.equal(batch.files.length, 1); assert.equal(batch.failures.length, 1);
    const zip = await exporter.export({ id: 'zip', files: [{ url: local, filename: 'same.png' }, { url: local, filename: 'same.png' }], zipName: 'images.zip' });
    const archive = await JSZip.loadAsync(await readFile(zip.files[0]));
    assert.deepEqual(Object.keys(archive.files).sort(), ['same-1.png', 'same.png']);
    assert.deepEqual(await archive.file('same.png')!.async('nodebuffer'), bytes);
    const remote = await exporter.export(one(`${origin}/remote`));
    assert.deepEqual(await readFile(remote.files[0]), bytes);
    for (const url of ['/bad', '/html', '/broken']) {
      const failure = await exporter.export(one(`${origin}${url}`));
      assert.equal(failure.files.length, 0); assert.equal(failure.failures.length, 1);
    }
    const inline = await exporter.export(one(`data:image/png;base64,${bytes.toString('base64')}`));
    assert.deepEqual(await readFile(inline.files[0]), bytes);
    await assert.rejects(exporter.export({ id: 'bad-zip', files: [{ url: local, filename: 'ok.png' }, { url: '/api/local-file/missing.png', filename: 'missing.png' }], zipName: 'bad.zip' }));
    assert(!(await readdir(downloads)).some(name => name.endsWith('.part') || name === 'bad.zip'));
    assert(progress.includes(0) && progress.includes(2));
    console.log('PASS: HTTP service offline, original bytes, 8 concurrent exports, duplicate clicks, filename collisions, old media roots, batch partial failure, ZIP contents, remote/inline images, HTTP errors, truncated streams, cleanup.');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); }
}
void main();
