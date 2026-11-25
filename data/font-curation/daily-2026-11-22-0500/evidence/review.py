from PIL import Image,ImageDraw
import pathlib,json
p=pathlib.Path('/tmp/font-daily-1122/crops');r=pathlib.Path('data/font-curation/daily-2026-11-22-0500');m=json.load(open(p/'manifest.json'))
for off in range(0,len(m['cards']),16):
 cs=m['cards'][off:off+16];sheet=Image.new('RGB',(1600,1480),'#ddd');d=ImageDraw.Draw(sheet)
 for j,c in enumerate(cs):
  i=Image.open(c['file']);i.thumbnail((385,340));x=j%4*400;y=j//4*370;sheet.paste(i,(x+(400-i.width)//2,y));d.text((x+5,y+345),str(c['number']),fill='black')
 sheet.save(r/f'review-{off//16+1}.jpg')
r.joinpath('manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2))
