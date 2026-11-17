import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { collectPromptHistory, listPromptHistory, PromptHistoryError } from '@/lib/prompt-history';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function owner(request: NextRequest) { const id = getCurrentUserId(request); if (!id) throw new PromptHistoryError('请先登录', 401); if (!isLocalBackendEnabled()) throw new PromptHistoryError('历史收录目前支持本机模式', 501); return id; }
function fail(error: unknown) { return NextResponse.json({ error: error instanceof Error ? error.message : '读取历史失败' }, { status: error instanceof PromptHistoryError ? error.status : 500 }); }
export async function GET(request: NextRequest) { try { return NextResponse.json(listPromptHistory(owner(request), request.nextUrl.searchParams), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return fail(e); } }
export async function POST(request: NextRequest) { try { const id = owner(request), body = await request.json(); return NextResponse.json(await collectPromptHistory(id, body.ids, body.groupId)); } catch (e) { return fail(e); } }
