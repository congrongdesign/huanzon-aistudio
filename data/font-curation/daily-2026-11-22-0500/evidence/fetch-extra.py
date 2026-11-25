# coding:utf-8
import pathlib,urllib.request,concurrent.futures,re,json,html
from PIL import Image,ImageOps,ImageDraw
p=pathlib.Path('/tmp/font-daily-1122');ids=['674828','672780','659394','660015']
def page(id):
 url='https://www.uisdc.com/group/'+id+'.html'
 try:
  s=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=25).read().decode();p.joinpath(id+'.html').write_text(s);title=html.unescape(re.search('property="og:title" content="([^"]+)"',s).group(1));imgs=[]
  for tag in re.findall(r'<img\b[^>]+>',s):
   d=dict(re.findall(r'([\w-]+)=["\x27]([^"\x27]+)["\x27]',tag));src=d.get('data-src')or d.get('src','')
   if html.unescape(d.get('alt',''))==title and src not in [x['url']for x in imgs]:imgs.append({'url':html.unescape(src)})
  clean=re.sub(r'<(script|style)\b[^>]*>[\s\S]*?</\1>','',s);body=html.unescape(re.sub('<[^>]+>',' ',clean));body=re.sub(r'\s+',' ',body)
  return {'id':id,'url':url,'title':title,'body':body,'images':imgs}
 except Exception as e:return {'id':id,'error':str(e),'images':[]}
with concurrent.futures.ThreadPoolExecutor(max_workers=6)as ex:ss=list(ex.map(page,ids))
def get(t):
 s,n,im=t
 try:
  f=p/f'{s["id"]}-{n}.jpg';b=urllib.request.urlopen(urllib.request.Request(im['url'],headers={'User-Agent':'Mozilla/5.0','Referer':s['url']}),timeout=30).read();f.write_bytes(b);i=ImageOps.exif_transpose(Image.open(f));im['file']=str(f);im['size']=list(i.size)
 except Exception as e:im['error']=str(e)
with concurrent.futures.ThreadPoolExecutor(max_workers=8)as ex:list(ex.map(get,[(s,n,i)for s in ss for n,i in enumerate(s['images'])]))
for s in ss:
 print(s['id'],s.get('title'),len(s['images']),sum('file'in x for x in s['images']),flush=True)
 for off in range(0,len(s['images']),12):
  ims=s['images'][off:off+12];sheet=Image.new('RGB',(1600,420*((len(ims)+3)//4)),'#ddd');d=ImageDraw.Draw(sheet)
  for j,im in enumerate(ims):
   if 'file'not in im:continue
   i=Image.open(im['file']).convert('RGB');i.thumbnail((390,385));x=j%4*400;y=j//4*420;sheet.paste(i,(x+(400-i.width)//2,y));d.text((x+5,y+390),str(off+j)+' '+str(im['size']),fill='black')
  sheet.save(p/f'{s["id"]}-sheet{off//12}.jpg')
json.dump(ss,open(p/'extra-sources.json','w'),ensure_ascii=False,indent=2)
