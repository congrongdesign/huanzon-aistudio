// Verify the running installation exposes batch actions without deleting any work.
const base = process.argv[2];
if (!base) throw new Error('Usage: pnpm exec node scripts/verify-font-batch-runtime.mjs http://127.0.0.1:PORT');
const endpoint = new URL('/api/font-creation/sessions', base);
const list = await fetch(endpoint, { signal: AbortSignal.timeout(30000) });
const data = await list.json();
if (!list.ok || !Array.isArray(data.sessions)) throw new Error('Font sessions unavailable');
const response = await fetch(endpoint, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Origin: endpoint.origin },
  body: JSON.stringify({ action: 'delete-runs', id: data.sessions[0]?.id || '00000000-0000-4000-8000-000000000000', runIds: [] }),
  signal: AbortSignal.timeout(30000),
});
const result = await response.json();
if (response.status !== 400 || result.error !== '请选择要操作的作品') throw new Error(`Installed runtime lacks batch validation: ${response.status} ${result.error}`);
console.log(JSON.stringify({ pass: true, origin: endpoint.origin, sessionsAvailable: true, batchValidationAvailable: true, deletedWorks: 0 }));
