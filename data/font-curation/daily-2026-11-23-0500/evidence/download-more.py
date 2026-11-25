# coding:utf-8
import json,pathlib,urllib.request
from PIL import Image,ImageOps
root=pathlib.Path('/tmp/font-daily-1123');x=json.loads((root/'discovery.json').read_text())
ids=['663937','652819','652525','673518','661360','659107']
for p in x['pages']:
 if p['id'] not in ids:continue
 pdir=root/p['id'];pdir.mkdir(exist_ok=True);arr=[]
 for i,im in enumerate(p['images']):
  f=pdir/f'{i}.webp'
  if not f.exists():
   req=urllib.request.Request(im['url'],headers={'User-Agent':'Mozilla/5.0','Referer':p['url']});f.write_bytes(urllib.request.urlopen(req,timeout=60).read())
  with Image.open(f) as z:size=list(ImageOps.exif_transpose(z).size)
  arr.append({**im,'file':str(f),'size':size,'index':i});print(p['id'],i,size,flush=True)
 (pdir/'images.json').write_text(json.dumps(arr,ensure_ascii=False,indent=2))
