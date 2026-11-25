# coding: utf-8
import urllib.request, json, pathlib, re, sys
from lxml import html
root=pathlib.Path('/tmp/font-daily-1123');root.mkdir(exist_ok=True)
ids=['678826','675654','673518','669590','669570','669244','665083','663937','661360','659107','657194','653946','652819','652658','652525','652279','650202']
out=[]
for id in ids:
 u=f'https://www.uisdc.com/group/{id}.html'
 req=urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'})
 raw=urllib.request.urlopen(req,timeout=30).read();(root/f'{id}.html').write_bytes(raw)
 doc=html.fromstring(raw)
 title=(doc.xpath('string(//h1[contains(@class,"p-title")])') or doc.xpath('string(//h1)')).strip()
 author=(doc.xpath('string(//div[contains(@class,"group-singular-author")]//h2[contains(@class,"author-name")])') or doc.xpath('string(//h2[contains(@class,"author-name")])')).strip()
 entry=doc.xpath('//div[contains(concat(" ",normalize-space(@class)," ")," entry ")]')
 body='\n'.join(x.strip() for x in entry[0].text_content().splitlines() if x.strip()) if entry else ''
 imgs=[];seen=set()
 if entry:
  for im in entry[0].xpath('.//img'):
   src=im.get('data-src') or im.get('data-original') or im.get('src') or ''
   if src.startswith('//'):src='https:'+src
   if not src.startswith('http') or src in seen:continue
   seen.add(src);imgs.append({'url':src,'alt':im.get('alt') or ''})
 out.append({'id':id,'url':u,'title':title,'author':author,'body':body,'images':imgs})
 print(id,author,title,len(imgs),flush=True)
(root/'discovery.json').write_text(json.dumps({'pages':out},ensure_ascii=False,indent=2))
