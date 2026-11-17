import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUserId } from '@/lib/auth';
import { isLocalBackendEnabled, listPrompts } from '@/lib/local-backend';
import { listLocalLibraries } from '@/lib/prompt-library-store';
import { sharedFontSnapshot } from '@/lib/font-library-store';
import { sharedCaseSnapshot } from '@/lib/case-library-store';
import { exportLibrary, importLibrary, previewLibrary, readLibrary, TransferError } from '@/lib/library-transfer';
import { promptMetadata } from '@/lib/prompt-metadata';
export const runtime = 'nodejs';
export const maxDuration = 3600;
const kindSchema = z.enum(['prompts','fonts','cases']);
const exportSchema = z.object({ kind: kindSchema, scope: z.object({ mode: z.enum(['all','group','selected']), groupId: z.string().max(100).optional(), ids: z.array(z.string().max(100)).max(10000).optional() }), name: z.string().trim().min(1).max(100), author: z.string().max(160).default(''), description: z.string().max(2000).default(''), allowMissing: z.boolean().default(false) });
function owner(request: NextRequest) { const id = getCurrentUserId(request); if (!id) throw new TransferError('请先登录',401); if (!isLocalBackendEnabled()) throw new TransferError('资源包共享需要本机或局域网主机模式',501); return id; }
function failure(e: unknown) { if (e instanceof TransferError) return NextResponse.json({ error:e.message },{status:e.status}); if (e instanceof z.ZodError) return NextResponse.json({error:'资源包参数不正确，请检查填写内容'},{status:400}); console.error('Library transfer failed:',e); return NextResponse.json({ error:'资源包操作未完成，原有条目已保留。请检查磁盘空间后重试。' },{status:500}); }
export async function GET(request: NextRequest) { try {
  const id=owner(request), kind=kindSchema.parse(request.nextUrl.searchParams.get('kind'));
  if(kind==='cases'){const data=await sharedCaseSnapshot(id);return NextResponse.json({groups:data.groups,items:data.cards.map(c=>({id:c.id,title:c.title,groupId:c.folderIds[0]||'none',groupIds:c.folderIds.length?c.folderIds:['none'],images:1+(c.attachments?.length||0)}))},{headers:{'Cache-Control':'no-store'}});}
  if (kind==='fonts') { const data=await sharedFontSnapshot(id); return NextResponse.json({groups:data.groups,items:data.cards.map(c=>({id:c.id,title:c.title,groupId:c.groupId||'none',images:1+c.references.length}))},{headers:{'Cache-Control':'no-store'}}); }
  return NextResponse.json({groups:listLocalLibraries(id).filter(g=>!g.is_default).map(g=>({id:String(g.id),name:g.name})),items:listPrompts(id).map(p=>({id:p.id,title:p.name||p.text.slice(0,40),groupId:String(p.library_id??p.category.match(/^group:(\d+)$/)?.[1]??'none'),images:Number(!!p.image_url)+Number(!!promptMetadata(p.source).referencePreviewUrl)}))},{headers:{'Cache-Control':'no-store'}});
} catch(e) { return failure(e); } }
export async function POST(request: NextRequest) { try {
  const id=owner(request);
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
    const form=await request.formData(), kind=kindSchema.parse(form.get('kind')), action=form.get('action');
    if (!['preview','import'].includes(String(action))) throw new TransferError('不支持的资源包操作');
    const file=form.get('file'); if (!(file instanceof File) || file.size>264*1024*1024) throw new TransferError('请选择小于264MB的 .hzlib 共享包');
    const archive=await readLibrary(Buffer.from(await file.arrayBuffer()),kind);
    if (action==='preview') return NextResponse.json(await previewLibrary(id,archive),{headers:{'Cache-Control':'no-store'}});
    const destination=z.object({ mode:z.enum(['new','existing','preserve']),name:z.string().trim().min(1).max(50).optional(),id:z.string().max(100).optional() }).parse(JSON.parse(String(form.get('destination')||'{}')));
    return NextResponse.json(await importLibrary(id,archive,destination),{headers:{'Cache-Control':'no-store'}});
  }
  const body=exportSchema.parse(await request.json());
  const result=await exportLibrary(id,body.kind,body.scope,body,body.allowMissing);
  const filename=body.name.replace(/[\\/:*?"<>|\r\n]/g,'-').slice(0,80)+'.hzlib';
  let offset=0;
  const stream=new ReadableStream<Uint8Array>({pull(controller){if(offset>=result.bytes.length){controller.close();return;}const end=Math.min(offset+64*1024,result.bytes.length);controller.enqueue(new Uint8Array(result.bytes.subarray(offset,end)));offset=end;}});
  return new NextResponse(stream,{headers:{'Content-Type':'application/zip','Content-Length':String(result.bytes.length),'Content-Disposition':`attachment; filename="library.hzlib"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Cache-Control':'no-store','X-Library-Count':String(result.count),'X-Library-Missing':String(result.missing)}});
} catch(e) { return failure(e); } }
