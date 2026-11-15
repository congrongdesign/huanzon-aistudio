import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { FontStoreError, saveFontImage } from '@/lib/font-library-store';
import { createFontSession, getFontSession, listFontSessions, saveFontDraft, selectFontStyle, exportFontResult, updateFontRun, setFontRunDeleted, setFontRunsDeleted } from '@/lib/font-creation-store';
import { generationQueue } from '@/lib/generation-job-store';
function owner(request: NextRequest) { const value = getCurrentUserId(request); if (!value) throw new FontStoreError('未登录', 401); if (!isLocalBackendEnabled()) throw new FontStoreError('字体创作目前支持本机模式', 501); return value; }
function fail(error: unknown) { return NextResponse.json({ error: error instanceof FontStoreError ? error.message : '字体设计保存失败，请重试' }, { status: error instanceof FontStoreError ? error.status : 500 }); }
export async function GET(request: NextRequest) {
  try { const user = owner(request), id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ sessions: await listFontSessions(user) }, { headers: { 'Cache-Control': 'no-store' } });
    let session = await getFontSession(user, id);
    for (const run of session.runs.filter(r => ['queued','running'].includes(r.status))) {
      const job = run.jobId ? generationQueue().list(user, [run.jobId])[0] : null;
      if (job?.status === 'failed' || job?.status === 'cancelled' || (!job && Date.now() - Date.parse(run.createdAt) > 60000)) await updateFontRun(user, id, run.id, { status: job?.status === 'cancelled' ? 'cancelled' : 'failed', error: String(job?.result?.payload?.error || '任务已中断，请确认后重新生成') });
    }
    session = await getFontSession(user, id); return NextResponse.json({ session }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
export async function POST(request: NextRequest) {
  try { const user = owner(request);
    if (request.headers.get('content-type')?.includes('multipart/form-data')) { const form = await request.formData(); await getFontSession(user, String(form.get('sessionId'))); const file = form.get('file'); if (!(file instanceof File) || file.size > 25 * 1024 * 1024) throw new FontStoreError('请选择小于25MB的图片'); const saved = await saveFontImage(user, Buffer.from(await file.arrayBuffer()), file.name, 'reference'); return NextResponse.json({ file: { ...saved, referenceId: crypto.randomUUID() } }); }
    const body = await request.json();
    if (body.action === 'export') return NextResponse.json(await exportFontResult(user, body.id, body.runId, body.projectId));
    return NextResponse.json({ session: await createFontSession(user, body.settings) });
  } catch (e) { return fail(e); }
}
export async function PATCH(request: NextRequest) {
  try { const user = owner(request), body = await request.json();
    if (body.action === 'delete-runs' || body.action === 'restore-runs') return NextResponse.json({ session: await setFontRunsDeleted(user, body.id, body.runIds, body.action === 'delete-runs') });
    if (body.action === 'delete-run' || body.action === 'restore-run') return NextResponse.json({ session: await setFontRunDeleted(user, body.id, body.runId, body.action === 'delete-run') });
    if (body.action === 'style') return NextResponse.json({ session: await selectFontStyle(user, body.id, body.revision, { ...body, action: body.styleAction }, String(body.actualModel || 'gpt-image-2')) });
    return NextResponse.json({ session: await saveFontDraft(user, body.id, body.revision, body.draft, body.styleRevision, body.title) });
  } catch (e) { return fail(e); }
}
