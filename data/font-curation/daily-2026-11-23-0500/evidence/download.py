# coding: utf-8
import json,pathlib,urllib.request,re
from PIL import Image,ImageDraw,ImageOps
root=pathlib.Path('/tmp/font-daily-1123');x=json.loads((root/'discovery.json').read_text())
ids=['678826','675654','669590','669570','669244','665083','652658','652279','650202']
for p in x['pages']:
 if p['id'] not in ids:continue
 pdir=root/p['id'];pdir.mkdir(exist_ok=True)
 pagejson=[]
 for i,im in enumerate(p['images']):
  ext=pathlib.Path(im['url'].split('?')[0]).suffix or '.webp';f=pdir/f'{i}{ext}'
  if not f.exists():
   req=urllib.request.Request(im['url'],headers={'User-Agent':'Mozilla/5.0','Referer':p['url']})
   f.write_bytes(urllib.request.urlopen(req,timeout=60).read())
  with Image.open(f) as raw:
   size=list(ImageOps.exif_transpose(raw).size)
  pagejson.append({**im,'file':str(f),'size':size,'index':i})
  print(p['id'],i,size,flush=True)
 (pdir/'images.json').write_text(json.dumps(pagejson,ensure_ascii=False,indent=2))
 # contact sheet thumbnails with readable number
 cols=4;tw,th=300,260;rows=(len(pagejson)+cols-1)//cols
 sheet=Image.new('RGB',(cols*tw,rows*th),'#ddd');d=ImageDraw.Draw(sheet)
 for i,im in enumerate(pagejson):
  with Image.open(im['file']) as z:
   t=ImageOps.exif_transpose(z).convert('RGB');t.thumbnail((280,225))
  px=(i%cols)*tw+(tw-t.width)//2;py=(i//cols)*th+28+max(0,(225-t.height)//2)
  sheet.paste(t,(px,py));d.text(((i%cols)*tw+8,(i//cols)*th+7),f'{i}  {im["size"][0]}x{im["size"][1]}',fill='black')
 sheet.save(root/f'{p["id"]}-sheet.jpg',quality=90)
