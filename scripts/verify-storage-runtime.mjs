// Verify the deployed desktop service, not just its source or unit-test handlers.
const base = process.argv[2];
if (!base) throw new Error('Usage: pnpm exec node scripts/verify-storage-runtime.mjs http://127.0.0.1:PORT');
const endpoint = new URL('/api/storage-management', base);
async function request(init) {
  const response = await fetch(endpoint, { ...init, signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  if (!response.ok) throw new Error(`Storage runtime returned ${response.status}: ${value.error || 'unknown error'}`);
  return value;
}
const overview = await request();
if (!overview.supported) throw new Error(overview.reason || 'Storage unavailable');
const browse = await request({ method: 'POST', headers: { 'Content-Type': 'application/json', Origin: endpoint.origin }, body: JSON.stringify({ action: 'browse-directory' }) });
if (!browse.directory || !Array.isArray(browse.folders)) throw new Error('Directory picker is absent in this runtime');
console.log(JSON.stringify({ pass: true, origin: endpoint.origin, storageAvailable: true, directoryPickerAvailable: true }));
