# coding:utf-8
import urllib.request,re,concurrent.futures,pathlib,json,html
from urllib.parse import quote
p=pathlib.Path('/tmp/font-daily-1122')
def work(i):
 u=quote(f'https://www.uisdc.com/tag/字体设计/page/{i}',safe=':/')
 try:
  s=urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=20).read().decode();p.joinpath(f'tag{i}.html').write_text(s);links=[]
  for h,t in re.findall(r'<a\b[^>]*href=["\x27]([^"\x27]+)["\x27][^>]*>([\s\S]*?)</a>',s):
   text=html.unescape(re.sub('<[^>]+>','',t)).strip()
   if 'uisdc.com/group/' in h and len(text)>10:links.append({'url':h,'title':text})
  return {'url':u,'links':links}
 except Exception as e:return {'url':u,'error':str(e)}
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:rows=list(ex.map(work,[1,2,3,4]))
json.dump(rows,open(p/'discovery.json','w'),ensure_ascii=False,indent=2)
for r in rows:print(json.dumps(r,ensure_ascii=False))
