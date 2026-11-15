"""Sync only this collection's own records; preserve unrelated or user-edited prompts."""
import json, hashlib, re, argparse
from pathlib import Path
from urllib.request import Request, urlopen
ROOT = Path(__file__).resolve().parents[1]

def digest(text):
    return hashlib.sha256(re.sub(r'\s+', '', text).lower().encode()).hexdigest()

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base-url', default='http://127.0.0.1:5001')
    args = p.parse_args()
    if not args.base_url.startswith(('http://127.0.0.1:', 'http://localhost:')):
        raise ValueError('Local service required')
    def api(route, body=None, method=None):
        req = Request(args.base_url+route, data=None if body is None else json.dumps(body,ensure_ascii=False).encode(), headers={'Content-Type':'application/json'},method=method)
        with urlopen(req,timeout=60) as r:return json.load(r)
    collection=json.loads((ROOT/'data/prompt-curation/design-prompts-2026-11-15.json').read_text())
    for item in collection['prompts']:
        if item.get('source',{}).get('verifiedPair') is not True or not item.get('previewUrl'):
            raise ValueError('Unreviewed prompt/image pair: '+item.get('key','unknown'))
    first=json.loads((ROOT/'output/prompt-curation/import-report.json').read_text())
    known={x['key']:x['id'] for x in first['imported']}
    records=api('/api/prompts')['prompts']; byid={x['id']:x for x in records}
    for x in records:
        try:s=json.loads(x.get('source') or '{}')
        except ValueError:continue
        if s.get('batch')==collection['batch'] and s.get('key'):known[s['key']]=x['id']
    groups={x['name']:x['id'] for x in api('/api/prompt-libraries')['data'] if not x.get('is_default')}
    report={'updated':[],'created':[],'unchanged':[],'preservedUserEdits':[]}
    reportpath=ROOT/'output/prompt-curation/chinese-cards-sync-report.json'
    def save():reportpath.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    for item in collection['prompts']:
        old=byid.get(known.get(item['key']))
        if old and old['text'] not in (item['text'],item.get('originalText','')):
            report['preservedUserEdits'].append(old['id']);continue
        if item['category'] not in groups:
            groups[item['category']]=api('/api/prompt-libraries',{'name':item['category'],'description':'中文设计提示词与案例参考卡片'})['data']['id']
        data={'name':item['name'],'text':item['text'],'tags':json.dumps(item['tags'],ensure_ascii=False),'source':json.dumps(item['source'],ensure_ascii=False),'imageUrl':item.get('previewUrl'),'groupId':groups[item['category']]}
        if old and all(old.get(k)==v for k,v in [('name',data['name']),('text',data['text']),('tags',data['tags']),('source',data['source']),('image_url',data['imageUrl']),('library_id',data['groupId'])]):report['unchanged'].append(item['key']);continue
        if old:
            result=api('/api/prompts',dict(data,id=old['id']),method='PATCH')['prompt'];report['updated'].append({'id':result['id'],'key':item['key']})
        else:
            result=api('/api/prompts',dict(data,projectId=first['projectId']))['prompt'];report['created'].append({'id':result['id'],'key':item['key']})
        assert result.get('image_url')==data['imageUrl'] and result['text']==data['text']
        save()
    final=api('/api/prompts')['prompts'];assert all(x['id'] in {r['id'] for r in final} for x in records)
    report['total']=len(final);report['verified']=True;save()
    print(json.dumps({k:len(v) if isinstance(v,list) else v for k,v in report.items()},ensure_ascii=False))
if __name__=='__main__':main()
