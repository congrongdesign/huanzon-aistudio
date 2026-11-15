import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { FontStoreError } from '@/lib/font-library-store';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { createFontRun, getFontSession, updateFontRun } from '@/lib/font-creation-store';
import { getImageQualityOptions, preferredImageQuality } from '@/lib/image-generation-defaults';
import { generationQueue } from '@/lib/generation-job-store';
export async function POST(request: NextRequest) {
  try { const owner = getCurrentUserId(request); if (!owner) throw new FontStoreError('未登录', 401); if (!isLocalBackendEnabled()) throw new FontStoreError('请使用本机模式', 501);
    const body = await request.json(); if (typeof body.requestId !== 'string' || !body.requestId || body.requestId.length > 150) throw new FontStoreError('缺少任务标识');
    const session = await getFontSession(owner, body.sessionId);
    const model = typeof body.model === 'string' ? body.model.slice(0, 200) : 'gpt-image-2';
    const run = await createFontRun(owner, session.id, body.revision, body.requestId, { model, size: /^\d{3,5}x\d{3,5}$/.test(session.draft.settings.imageSize) ? session.draft.settings.imageSize : session.draft.settings.size, imageSize: session.draft.settings.imageSize, quality: preferredImageQuality(getImageQualityOptions(model)), background: session.draft.settings.background, outputFormat: session.draft.settings.outputFormat, moderation: session.draft.settings.moderation });
    if (run.jobId) return NextResponse.json({ runId: run.id, jobId: run.jobId }, { status: 202 });
    try { const job = generationQueue().submit(owner, body.requestId, null, { destination: { kind: 'font', sessionId: session.id }, fontRunId: run.id, prompt: run.prompt, ...run.parameters, apiKey: typeof body.apiKey === 'string' ? body.apiKey : '', baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined }); await updateFontRun(owner, session.id, run.id, { jobId: job.id }); return NextResponse.json({ runId: run.id, jobId: job.id }, { status: 202 }); }
    catch (e) { await updateFontRun(owner, session.id, run.id, { status: 'failed', error: '任务未能提交，请重试' }); throw e; }
  } catch (e) { return NextResponse.json({ error: e instanceof FontStoreError ? e.message : '提交失败，请重试' }, { status: e instanceof FontStoreError ? e.status : 500 }); }
}
