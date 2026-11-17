import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { FontStoreError } from '@/lib/font-library-store';
import { fontImportOrganizationStatus, enqueueFontOrganization } from '@/lib/library-import-service';
export const runtime = 'nodejs';
export const maxDuration = 3600;
function owner(request: NextRequest) { const id = getCurrentUserId(request); if (!id) throw new FontStoreError('未登录', 401); if (!isLocalBackendEnabled()) throw new FontStoreError('请使用本机模式', 501); return id; }
function fail(e: unknown) { return NextResponse.json({ error: e instanceof FontStoreError ? e.message : '整理失败，请重试' }, { status: e instanceof FontStoreError ? e.status : 500 }); }
export async function GET(request: NextRequest) { try { return NextResponse.json(await fontImportOrganizationStatus(owner(request)), { headers: { 'Cache-Control': 'no-store' } }); } catch (e) { return fail(e); } }
export async function POST(request: NextRequest) { try { const id = owner(request), body = await request.json(); if (body.id !== undefined && typeof body.id !== 'string') throw new FontStoreError('无效卡片ID'); const job = await enqueueFontOrganization(id, body.id, body.force === true); return NextResponse.json(job); } catch (e) { return fail(e); } }
