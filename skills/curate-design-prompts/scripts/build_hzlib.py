#!/usr/bin/env python3
# coding: utf-8
"""Build a reviewed collection into a Studio .hzlib; never writes to the app."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from datetime import datetime, timezone


def digest(value):
    if not isinstance(value, bytes):
        value = json.dumps(value, ensure_ascii=False, sort_keys=True).encode('utf-8')
    return hashlib.sha256(value).hexdigest()


def build(collection, base):
    kind = collection['kind']
    if kind not in ('prompts', 'fonts'):
        raise ValueError('kind must be prompts or fonts')
    cards = collection['cards']
    if not 1 <= len(cards) <= 1000:
        raise ValueError('Use 1–1000 reviewed cards per batch')
    groups, records, assets, seen = {}, [], {}, set()
    for c in cards:
        for key in ('key', 'title', 'group', 'text', 'author', 'sourceUrl', 'file'):
            if not isinstance(c.get(key), str) or not c[key].strip():
                raise ValueError('Missing ' + key)
        if c.get('visualReviewed') is not True:
            raise ValueError('Inspect each original and preview first')
        from urllib.parse import urlparse
        u = urlparse(c['sourceUrl'])
        if u.scheme not in ('http', 'https') or not u.hostname or u.username or u.password:
            raise ValueError('Public source URL required')
        if c['key'] in seen:
            raise ValueError('Duplicate stable key')
        seen.add(c['key'])
        file = (base / c['file']).resolve()
        data = file.read_bytes()
        if len(data) > 25 * 1024 * 1024:
            raise ValueError('Image exceeds 25 MiB')
        ext = ('png' if data.startswith(b'\x89PNG\r\n\x1a\n') else
               'jpg' if data.startswith(b'\xff\xd8\xff') else
               'webp' if data[:4] == b'RIFF' and data[8:12] == b'WEBP' else None)
        if not ext:
            raise ValueError('Use static PNG/JPG/WebP; app also validates decoding')
        asset = digest(data) + '.' + ext
        assets[asset] = data
        groups.setdefault(c['group'], 'g' + str(len(groups) + 1))
        note = c.get('note', '')
        provenance = '\n'.join(filter(None, [note, '作者：' + c['author'], '来源：' + c['sourceUrl'],
            '原图：' + c.get('originalImageUrl', ''), '收录：' + c.get('collectedAt', ''),
            '原文：' + c.get('originalText', ''), '模型：' + c.get('model', '未注明'),
            '裁切：' + str(c.get('crop', '未裁切'))]))
        if kind == 'prompts' and c.get('verifiedPair') is not True:
            raise ValueError('Prompt and corresponding example must be verified')
        row = dict(origin=digest('curation:' + kind + ':' + c['key']), revision='0' * 64,
            group=groups[c['group']], title=c['title'], text=c['text'], tags=c.get('tags', []),
            metadata=dict(subcategory=c.get('subcategory', ''), author=c['author'], url=c['sourceUrl'],
                previewKind='example', language='zh-CN', note=provenance),
            cover=dict(asset=asset, label=c['title'], missing=False), referencePreview=None,
            references=[], sampleText=c.get('sampleText', ''), style=c.get('style', ''),
            description=provenance if kind == 'fonts' else '', originalPrompt='', parameters={})
        row['revision'] = digest({k: v for k, v in row.items() if k != 'revision'})
        if len(row['title']) > 160 or len(row['text']) > 30000 or len(provenance) > 2000 or len(c['group']) > 50:
            raise ValueError('Shorten title/text/notes/group; keep full evidence separately')
        if len(row['tags']) > 10 or any(not isinstance(t, str) or len(t) > 30 for t in row['tags']):
            raise ValueError('Use at most 10 tags, 30 characters each')
        records.append(row)
    if sum(map(len, assets.values())) > 256 * 1024 * 1024:
        raise ValueError('Split collections exceeding 256 MiB')
    manifest = dict(format='huanzon-library', version=1, kind=kind, name=collection['name'],
        author=collection.get('author', ''), description=collection.get('description', ''),
        createdAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        groups=[dict(id=v, name=k) for k, v in groups.items()], records=records)
    return manifest, assets


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('collection'); ap.add_argument('--output', required=True)
    args = ap.parse_args()
    src = Path(args.collection).resolve(); out = Path(args.output).resolve()
    if out.suffix != '.hzlib':
        raise ValueError('Output must end in .hzlib')
    manifest, assets = build(json.loads(src.read_text(encoding='utf-8-sig')), src.parent)
    with zipfile.ZipFile(out, 'x', compression=zipfile.ZIP_STORED) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False))
        for name, data in assets.items():
            z.writestr('assets/' + name, data)
    print(json.dumps(dict(file=str(out), cards=len(manifest['records']), images=len(assets),
        sha256=digest(out.read_bytes()), next='Preview in the matching Studio library; no import performed'), ensure_ascii=False))


if __name__ == '__main__':
    main()
