import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled } from '@/lib/local-backend';
import { listCaseLibrary, uploadCaseImage, updateCaseAssets, changeCaseFolder, migrateCase, CaseLibraryError, exportCaseIndex, analyzeCaseAsset } from '@/lib/case-library-store';
import { AnalysisWait } from '@/lib/library-import-analysis';
export const runtime = 'nodejs';
export const maxDuration = 300;
function owner(req: NextRequest) { const id=getCurrentUserId(req); if(!id)throw new CaseLibraryError('未登录',401); if(!isLocalBackendEnabled())throw new CaseLibraryError('参考图库目前支持本机与局域网模式',501); return id; }
function failure(e: unknown) { console.error('Case library:',e); return NextResponse.json({error:e instanceof CaseLibraryError||e instanceof AnalysisWait?e.message:'图库操作失败，请检查看图模型配置后重试'}, {status:e instanceof CaseLibraryError?e.status:e instanceof AnalysisWait?409:500}); }
export async function GET(req: NextRequest) { try { const id=owner(req); return NextResponse.json(req.nextUrl.searchParams.has('export')?await exportCaseIndex(id):await listCaseLibrary(id,req.nextUrl.searchParams),{headers:{'Cache-Control':'no-store'}}); } catch(e){return failure(e);} }
export async function POST(req: NextRequest) { try { const id=owner(req);
  if(req.headers.get('content-type')?.includes('multipart/form-data')) { const data=await req.formData(); const file=data.get('file'); if(!(file instanceof File))throw new CaseLibraryError('请选择图片'); return NextResponse.json(await uploadCaseImage(id,file,data.getAll('folderId').map(String))); }
  const body=await req.json();
  if(body.action==='analyze')return NextResponse.json({item:await analyzeCaseAsset(id,String(body.id||''))});
  if(body.action==='migrate')return NextResponse.json(await migrateCase(id,String(body.migrationId||''),body.case));
  if(['create-folder','rename-folder','delete-folder'].includes(body.action))return NextResponse.json({folders:await changeCaseFolder(id,body.action,body.id,body.name)});
  throw new CaseLibraryError('未知操作');
} catch(e){return failure(e);} }
export async function PATCH(req: NextRequest) { try {const id=owner(req),body=await req.json(); return NextResponse.json({items:await updateCaseAssets(id,body.ids,body.patch||{})});}catch(e){return failure(e);} }
