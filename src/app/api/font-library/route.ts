import { after, NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { collectFontCreation, listFonts, getFont, fontHistory, uploadFont, collectFont, updateFont, attachFontReference, FontStoreError } from '@/lib/font-library-store';
export const runtime = 'nodejs';
export const maxDuration = 3600;
function autoOrganize(id: string, cardId: string) { after(async () => { try { const { prepareFontOrganization, runFontOrganization } = await import('@/lib/font-library-organizer'); await prepareFontOrganization(id, cardId); await runFontOrganization(id); } catch (e) { const { setFontAnalysis } = await import('@/lib/font-library-store'); await setFontAnalysis(id, cardId, { status: 'failed', model: '', error: e instanceof FontStoreError ? e.message : '自动整理未完成，请重试' }).catch(() => {}); } }); }
function owner(request: NextRequest) { const id = getCurrentUserId(request); if (!id) throw new FontStoreError('未登录', 401); if (!isLocalBackendEnabled()) throw new FontStoreError('字体库当前支持本机模式', 501); return id; }
function failure(e: unknown) { return NextResponse.json({ error: e instanceof FontStoreError ? e.message : '操作失败，请重试' }, { status: e instanceof FontStoreError ? e.status : 500 }); }
export async function GET(request: NextRequest) { try { const id = owner(request), q = request.nextUrl.searchParams; return NextResponse.json(q.get('id') ? await getFont(id, q.get('id')!) : q.has('history') ? fontHistory(id, q) : await listFonts(id, q), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return failure(e); } }
export async function POST(request: NextRequest) {
  try { const id = owner(request);
    if (request.headers.get('content-type')?.includes('multipart/form-data')) { const data = await request.formData(); const file = data.get('file'); if (!(file instanceof File) || file.size > 25 * 1024 * 1024) throw new FontStoreError('请选择小于25MB的图片'); const cardId = String(data.get('id') || ''); const position = data.has('position') ? Number(data.get('position')) : undefined; const card = cardId ? await attachFontReference(id, cardId, file, position) : await uploadFont(id, file, String(data.get('groupId') || '')); if (!cardId) autoOrganize(id, card.id); return NextResponse.json({ card }); }
    const body = await request.json(); if (body.action === 'collect-font') { const result = await collectFontCreation(id, body.sessionId, body.runId); if (!result.duplicate) autoOrganize(id, result.card.id); return NextResponse.json(result); } if (body.action !== 'collect' || typeof body.imageId !== 'string') throw new FontStoreError('请选择要收录的作品'); const result = await collectFont(id, body.imageId, body.groupId); if (!result.duplicate) autoOrganize(id, result.card.id); return NextResponse.json(result);
  } catch (e) { return failure(e); }
}
export async function PATCH(request: NextRequest) { try { const id = owner(request); const body = await request.json(); if (typeof body.id !== 'string') throw new FontStoreError('缺少卡片ID'); return NextResponse.json({ card: await updateFont(id, body.id, body) }); } catch (e) { return failure(e); } }
