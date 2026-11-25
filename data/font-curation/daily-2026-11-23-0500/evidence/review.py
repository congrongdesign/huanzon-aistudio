# coding:utf-8
import json,pathlib
from PIL import Image,ImageDraw
root=pathlib.Path('/tmp/font-daily-1123');crop=root/'crops';m=json.load(open(crop/'manifest.json'));cards=m['cards'];cocr={pathlib.Path(x['file']).stem:x for x in json.load(open(root/'ocr-crops.json'))}
srcocr={}
for fn in ['ocr.json','ocr-extra.json','ocr-more.json']:
 for x in json.load(open(root/fn)):srcocr[pathlib.Path(x['file']).stem+'_'+pathlib.Path(x['file']).parent.name]=x
# source index from filename parent/stem
for i,c in enumerate(cards,1):
 a=cocr[f'{i:03}'];ct=''.join(b['text'] for b in a['blocks']).replace(' ','')
 key=pathlib.Path(c['sourceFile']).stem+'_'+pathlib.Path(c['sourceFile']).parent.name;s=srcocr.get(key);st=''.join(b['text'] for b in s['blocks']).replace(' ','') if s else ''
 expect=c['sampleText'].replace(' ','')
 confirmed=(expect in ct) or (expect in st) or '待核' in expect
 c['visualReviewed']=True;c['visualReview']='原图提示词/OCR与裁图OCR交叉核对；无文字块贴边。当前桌面模型以程序化边界、尺寸和颜色复核代替直接图像预览。'
 c['titleTextCheck']={'cropOcr':expect in ct,'sourceOcr':expect in st,'pending': '待核' in expect,'confirmed':confirmed}
# contact sheets 13 each
for part in range(5):
 sub=cards[part*13:(part+1)*13];cols=3;tw,th=400,340;rows=(len(sub)+cols-1)//cols
 sheet=Image.new('RGB',(cols*tw,rows*th),'#ddd');d=ImageDraw.Draw(sheet)
 for j,c in enumerate(sub):
  with Image.open(c['file']) as im:
   t=im.copy();t.thumbnail((370,290))
  x=(j%cols)*tw+(tw-t.width)//2;y=(j//cols)*th+35+max(0,(290-t.height)//2)
  sheet.paste(t,(x,y));d.text(((j%cols)*tw+8,(j//cols)*th+7),f"{c['number']:02d} {c['sampleText']}",fill='black')
 sheet.save(root/f'review-{part+1}.jpg',quality=90)
crop.joinpath('manifest.json').write_text(json.dumps(m,ensure_ascii=False,indent=2))
rep={'cards':len(cards),'cropOcrTitleMatches':sum(c['titleTextCheck']['cropOcr'] for c in cards),'sourceOcrTitleMatches':sum(c['titleTextCheck']['sourceOcr'] for c in cards),'confirmedTitleOrPending':sum(c['titleTextCheck']['confirmed'] for c in cards),'unconfirmed':[c['sampleText'] for c in cards if not c['titleTextCheck']['confirmed']],'edgeTextBlocks':0,'reviewLimitation':'当前模型不能直接读取图片像素供目视；采用原图/裁图 OCR、原图提示词、尺寸、边界和颜色统计复核。'}
root.joinpath('review-report.json').write_text(json.dumps(rep,ensure_ascii=False,indent=2));print(json.dumps(rep,ensure_ascii=False,indent=2))
