# -*- coding: utf-8 -*-
"""Reconcile only known untouched imported cards; archive withdrawals and protect user edits."""
import json
from pathlib import Path
from urllib.request import Request,urlopen
ROOT=Path(__file__).resolve().parents[1];P=ROOT/'output/prompt-curation/reaudit';BASE='http://127.0.0.1:5001'
def api(path,body=None,method=None):
 with urlopen(Request(BASE+path,data=None if body is None else json.dumps(body,ensure_ascii=False).encode(),headers={'Content-Type':'application/json'},method=method),timeout=60) as r:return json.load(r)
def meta(r):
 try:return json.loads(r.get('source') or '{}')
 except ValueError:return {}
collection=json.loads((ROOT/'data/prompt-curation/design-prompts-2026-11-15.json').read_text());before=json.loads((P/'before-recuration-records.json').read_text());snapshot={r['id']:r for r in before};current=api('/api/prompts')['prompts'];known={meta(r).get('key'):r for r in current if meta(r).get('batch')==collection['batch']};want={r['key']:r for r in collection['prompts']};groups={r['name']:r['id'] for r in api('/api/prompt-libraries')['data']};project=json.loads((ROOT/'output/prompt-curation/import-report.json').read_text())['projectId'];report={'updated':[],'created':[],'withdrawn':[],'preservedUserEdits':[]};compare=['text','name','tags','source','image_url','library_id']
# Snapshot identifies the import, while complete field comparison protects edits made during research.
def untouched(r):
 s=snapshot.get(r['id']);return s is not None and all(r.get(k)==s.get(k) for k in compare)
for k,item in want.items():
 old=known.get(k)
 if old and not untouched(old):report['preservedUserEdits'].append(old['id']);continue
 if item['category'] not in groups:groups[item['category']]=api('/api/prompt-libraries',{'name':item['category']})['data']['id']
 body={'name':item['name'],'text':item['text'],'tags':json.dumps(item['tags'],ensure_ascii=False),'source':json.dumps(item['source'],ensure_ascii=False),'imageUrl':item['previewUrl'],'groupId':groups[item['category']]}
 if old:api('/api/prompts',dict(body,id=old['id']),'PATCH');report['updated'].append(old['id'])
 else:report['created'].append(api('/api/prompts',dict(body,projectId=project))['prompt']['id'])
withdraw=[r for k,r in known.items() if k not in want and untouched(r)]
(P/'withdrawn-records.json').write_text(json.dumps(withdraw,ensure_ascii=False,indent=2))
for r in withdraw:api('/api/prompts?id='+r['id'],method='DELETE');report['withdrawn'].append(r['id'])
for k,r in known.items():
 if k not in want and not untouched(r):report['preservedUserEdits'].append(r['id'])
final=api('/api/prompts')['prompts'];bykey={meta(r).get('key'):r for r in final};verified=0
for key,item in want.items():
 r=bykey.get(key)
 if r and r['id'] not in report['preservedUserEdits']:
  assert r['text']==item['text'] and r['image_url']==item['previewUrl'];verified+=1
for r in current:
 if meta(r).get('batch')!=collection['batch']:assert r in final
report.update(total=len(final),verified=verified);(P/'recuration-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2));print({k:len(v) if isinstance(v,list) else v for k,v in report.items()})
