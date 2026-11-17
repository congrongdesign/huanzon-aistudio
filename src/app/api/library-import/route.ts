import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { createImportBatch, importSnapshot, importBatchAction, ImportError } from '@/lib/library-import-service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function owner(req: NextRequest) { const id = getCurrentUserId(req); if (!id) throw new ImportError('请先登录', 401); if (!isLocalBackendEnabled()) throw new ImportError('智能导入目前支持本机模式', 501); return id; }
function failure(e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : '导入操作失败' }, { status: e instanceof ImportError ? e.status : 500 }); }
export async function GET(req: NextRequest) { try { return NextResponse.json(await importSnapshot(owner(req)), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return failure(e); } }
export async function POST(req: NextRequest) { try { const id = owner(req), body = await req.json(); return NextResponse.json(body.action ? await importBatchAction(id, body.batchId, body.action) : await createImportBatch(id, body), { status: body.action ? 200 : 202 }); } catch (e) { return failure(e); } }
