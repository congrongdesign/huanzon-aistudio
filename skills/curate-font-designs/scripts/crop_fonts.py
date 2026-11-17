#!/usr/bin/env python3
"""Create reviewed crop candidates from original-pixel bounds; never guess bounds."""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('manifest')
    ap.add_argument('--output', required=True, help='New directory for crops, contact sheet and manifest')
    args = ap.parse_args()
    source = Path(args.manifest).resolve()
    data = json.loads(source.read_text())
    cards = data.get('cards', [])
    if not cards:
        raise ValueError('manifest.cards must not be empty')
    prepared = []
    for n, card in enumerate(cards, 1):
        original = Path(card['sourceFile'])
        if not original.is_absolute():
            original = source.parent / original
        with Image.open(original) as raw:
            im = ImageOps.exif_transpose(raw).convert('RGB')
        box = card['crop']
        if (len(box) != 4 or any(type(v) is not int for v in box)
                or not 0 <= box[0] < box[2] <= im.width
                or not 0 <= box[1] < box[3] <= im.height):
            raise ValueError(f'Card {n}: invalid original-pixel crop bounds {box}, image {im.size}')
        if card.get('originalSize') and card['originalSize'] != list(im.size):
            raise ValueError(f'Card {n}: originalSize differs from oriented image {im.size}')
        prepared.append((card, im.crop(tuple(box)), list(im.size)))
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=False)
    sheet = Image.new('RGB', (1200, 260 * ((len(cards) + 3) // 4)), '#dddddd')
    draw = ImageDraw.Draw(sheet)
    for n, (card, crop, size) in enumerate(prepared, 1):
        dest = out / f'{n:03}.webp'
        crop.save(dest, 'WEBP', quality=96)
        card.update(file=str(dest), originalSize=size, visualReviewed=False)
        thumb = crop.copy()
        thumb.thumbnail((284, 226))
        x, y = ((n - 1) % 4) * 300, ((n - 1) // 4) * 260
        sheet.paste(thumb, (x + (300 - thumb.width) // 2, y + 25))
        draw.text((x + 8, y + 6), str(n), fill='black')
    sheet.save(out / 'contact.jpg', quality=92)
    (out / 'manifest.json').write_text(json.dumps(data, ensure_ascii=False, indent=2))
    print(json.dumps({'cards': len(cards), 'manifest': str(out / 'manifest.json'),
                      'contact': str(out / 'contact.jpg'), 'reviewRequired': True}))


if __name__ == '__main__':
    main()
