import { callGenerateApi, type GenerateRequest } from './generate-core';
import { getFontSession, updateFontRun } from './font-creation-store';
import { copyFontImage, saveFontImage } from './font-library-store';

export async function runFontGeneration(owner: string, body: GenerateRequest & { destination?: { kind: string; sessionId?: string }; fontRunId?: string }, signal?: AbortSignal) {
  const sessionId = body.destination?.sessionId, runId = body.fontRunId;
  if (!sessionId || !runId) return { status: 400, payload: { error: '缺少字体设计任务' } };
  try {
    const session = await getFontSession(owner, sessionId); const run = session.runs.find(item => item.id === runId);
    if (!run) return { status: 404, payload: { error: '字体任务不存在' } };
    if (run.status === 'completed') return { status: 200, payload: { id: run.id, image_url: run.result?.url, destination: body.destination } };
    if (run.status === 'cancelled' || run.status === 'failed') return { status: 409, payload: { error: run.error || '任务已结束' } };
    if (!body.apiKey) { let local = false; try { local = ['localhost','127.0.0.1','::1'].includes(new URL(body.baseUrl || '').hostname); } catch {} if (!local) throw new Error('请先在模型配置中设置可用的 API Key'); }
    await updateFontRun(owner, sessionId, runId, { status: 'running' }); signal?.throwIfAborted();
    const request = { ...body, ...run.parameters, prompt: run.prompt, referenceImages: run.references.map(file => file.url), signal, projectId: undefined, userId: owner };
    const generated = await callGenerateApi(request, run.prompt, run.parameters.size || '16:9', request.referenceImages);
    if (generated.error) throw new Error(generated.error); signal?.throwIfAborted();
    const result = generated.imageBuffer ? await saveFontImage(owner, generated.imageBuffer, '字体生成作品') : generated.imageUrl ? await copyFontImage(owner, generated.imageUrl, '字体生成作品', 'sample') : null;
    if (!result) throw new Error('没有返回可用图片'); signal?.throwIfAborted();
    await updateFontRun(owner, sessionId, runId, { status: 'completed', result });
    return { status: 200, payload: { id: run.id, image_url: result.url, destination: body.destination } };
  } catch (error) {
    const cancelled = signal?.aborted; const message = cancelled ? '任务已取消' : error instanceof Error ? error.message : '字体生成失败';
    await updateFontRun(owner, sessionId, runId, { status: cancelled ? 'cancelled' : 'failed', error: message }).catch(() => {});
    return { status: cancelled ? 499 : 500, payload: { error: message } };
  }
}
