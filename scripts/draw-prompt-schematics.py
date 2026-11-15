import json,pathlib,math,random,hashlib
from PIL import Image,ImageDraw,ImageFont,ImageFilter,ImageChops
R=pathlib.Path(__file__).resolve().parents[1];f=R/'data/prompt-curation/design-prompts-2026-11-15.json';j=json.loads(f.read_text());dest=R/'public/prompt-previews'
font='/System/Library/Fonts/STHeiti Medium.ttc';thin='/System/Library/Fonts/STHeiti Light.ttc';song='/System/Library/Fonts/Supplemental/Songti.ttc'
W,H=1200,675

def textmask(text,size=160,path=font,stroke=0):
 ft=ImageFont.truetype(path,size);b=ft.getbbox(text);m=Image.new('L',(b[2]-b[0]+20,b[3]-b[1]+20));ImageDraw.Draw(m).text((10-b[0],10-b[1]),text,font=ft,fill=255,stroke_width=stroke);return m

def paste(im,m,x=None,y=None):
 x=(W-m.width)//2 if x is None else x;y=(H-m.height)//2 if y is None else y
 im.paste('white',(x,y),m)

def typ(x):
 n=int(x['key'].split('-')[-1]);name=x['name'];im=Image.new('RGB',(W,H),'black');d=ImageDraw.Draw(im)
 m=textmask('向新而生',190,path=song if n in [6,7,29,30,46] else thin if n==5 else font,stroke=2 if n==1 else 0)
 if n in [2]:m=m.resize((500,310))
 if n in [3,29]:m=m.resize((940,130))
 if n==4:m=m.filter(ImageFilter.GaussianBlur(3)).point(lambda a:255 if a>120 else 0)
 if n in [8,25,28,31,45]:m=m.transform((m.width+120,m.height),Image.Transform.AFFINE,(1,-.19,55,0,1,0),Image.Resampling.BICUBIC)
 if n in [9,10,14]:
  q=ImageDraw.Draw(m)
  if n==9:
   for yy in [m.height*.38,m.height*.65]:q.polygon([(0,yy),(m.width,yy-35),(m.width,yy-23),(0,yy+12)],fill=0)
  elif n==10:
   for xx in range(40,m.width,85):q.line([(xx,0),(xx,m.height)],fill=0,width=6)
  else:
   for yy in range(30,m.height,45):q.line([(0,yy),(m.width,yy)],fill=0,width=3)
 if n==11:m=ImageChops.subtract(m,m.filter(ImageFilter.MinFilter(7)))
 if n==12:
  a=textmask('向新',190);b=textmask('而生',190);b=ImageChops.subtract(b,b.filter(ImageFilter.MinFilter(5)));m=Image.new('L',(a.width+b.width,a.height));m.paste(a,(0,0));m.paste(b,(a.width,0))
 if n==15:
  q=ImageDraw.Draw(m)
  for yy in range(0,m.height,7):q.rectangle((0,yy,m.width,yy+3),fill=0)
 if n in [16,18,19,20,21,22,23,24,51,17]:
  if n==17:
   a=textmask('向新',190,stroke=2);b=textmask('而生',190,stroke=2);paste(im,a,400,105);paste(im,b,400,345)
  elif n in [16,18,51]:
   paste(im,textmask('向新',150),130,115);paste(im,textmask('而生',200),130 if n==16 else 430,295);d.text((144,555),'2026 / NEW POSSIBILITIES',font=ImageFont.truetype(thin,21),fill='white')
  elif n==19:paste(im,m.resize((1260,245)),-30,200)
  elif n==20:
   for k,t in enumerate('向新'):paste(im,textmask(t,185),425,110+230*k)
   for k,t in enumerate('而生'):paste(im,textmask(t,95),690,110+135*k)
  elif n==21:paste(im,m);d.text((260,480),'B E Y O N D   P O S S I B I L I T I E S',font=ImageFont.truetype(thin,23),fill='white')
  elif n==22:
   paste(im,textmask('01',300),130,180);paste(im,textmask('向新而生',95),570,330);d.text((585,445),'NEW CHAPTER',font=ImageFont.truetype(thin,20),fill='white')
  elif n==23:
   small=m.resize((660,140));out=ImageChops.subtract(small,small.filter(ImageFilter.MinFilter(5)));paste(im,out,270,100);paste(im,small,270,270);paste(im,out,270,440)
  else:paste(im,m,140,170);d.line((150,430,1050,430),fill='white',width=2);d.text((150,480),'2026',font=ImageFont.truetype(thin,30),fill='white');d.text((810,480),'NEW ERA',font=ImageFont.truetype(thin,30),fill='white')
 elif n==49:
  m=Image.new('L',(830,210));q=ImageDraw.Draw(m)
  for k,t in enumerate('向新而生'):
   a=textmask(t,175,font if k%2==0 else thin);m.paste(a,(k*205,0))
  paste(im,m)
 elif n==48:
  for k,t in enumerate('向新而生'):
   a=textmask(t,170);paste(im,a,210+k*195,230+int(38*math.sin(k*1.3)))
 elif n in range(25,33):
  if n in [25,26,27,28,31,32]:
   random.seed(n);q=ImageDraw.Draw(m)
   for k in range(150 if n==25 else 40):
    xx=random.randrange(m.width);yy=random.randrange(m.height);q.line((xx,yy,xx+random.randrange(3,30),yy+random.randrange(0,3)),fill=0,width=1)
  paste(im,m)
 elif n in [33,34,35,36,37,38,39,40,41,42,43,44,50]:
  # This subset remains source material reference rather than simulating generated texture.
  return None
 elif n==52:
  paste(im,textmask('NOON',190,path=song));d.line((310,490,890,490),fill='white',width=1);d.text((460,525),'180° / STUDY',font=ImageFont.truetype(thin,22),fill='white')
 else:paste(im,m)
 return im

def bg(x):
 # Vector composition studies; all clearly labeled as schematics in the app.
 n=int(x['key'].split('-')[-1]);im=Image.new('RGB',(W,H));pix=im.load();light=n in [3,5,7,10,14,21,26,31,32];base=(237,239,240) if light else (4,7,13)
 for yy in range(H):
  for xx in range(W):
   g=max(0,1-math.hypot((xx-940)/1100,(yy-450)/800));pix[xx,yy]=tuple(min(255,int(v+g*(10 if light else 13))) for v in base)
 d=ImageDraw.Draw(im,'RGBA')
 if n<=8:
  if n in [1,7]:
   for k in range(3 if n==7 else 1):
    cx,cy=920-k*105,390+k*55;rx,ry=(170-k*24,215-k*30)
    for z in range(20,-1,-1):
     col=(190,222,255,10+int((20-z)*2));d.ellipse((cx-rx-z,cy-ry-z,cx+rx+z,cy+ry+z),outline=col,width=2)
    d.arc((cx-rx,cy-ry,cx+rx,cy+ry),210,340,fill=(245,252,255,230),width=3);d.arc((cx-rx+22,cy-ry+22,cx+rx-22,cy+ry-22),20,175,fill=(180,219,247,150),width=2)
  elif n==4:
   pts=[(830,170),(1100,510),(760,510)];d.polygon(pts,fill=(188,224,255,18),outline=(210,232,255,180),width=3);d.line((830,170,850,510),fill=(235,247,255,130),width=2)
   for k,c in enumerate([(120,205,255,100),(190,160,255,100),(255,170,190,100)]):d.polygon([(850,390),(1200,430+k*22),(1200,450+k*22)],fill=c)
  elif n==5:
   for z in range(20,-1,-1):d.ellipse((820-z,350-z,1270+z,800+z),outline=(160,190,210,15+z*3),width=2)
   d.arc((830,360,1260,790),200,310,fill=(255,255,255,240),width=6)
  else:
   for k in range(3 if n==3 else 1):
    pts=[(W*.65+100*math.sin(t/80)+k*35,t) for t in range(-30,H+40,4)];q=[(a+120,b) for a,b in reversed(pts)];d.polygon(pts+q,fill=(160,200,245,23),outline=(218,239,255,120),width=2)
    d.line(pts,fill=(245,250,255,200),width=3)
 elif n in [9,10,11,12,13,14,29,30,32]:
  colors=[(20,90,240,160),(240,30,160,170),(120,230,100,180)] if n==12 else [(190,203,218,90),(240,245,255,125),(80,110,170,120)]
  for k,c in enumerate(colors):
   pts=[(xx,H*.8+70*math.sin(xx/180+k)+k*20) for xx in range(0,W+10,8)];d.polygon(pts+[(W,H),(0,H)],fill=c);d.line(pts,fill=(255,255,255,130),width=2)
  if n in [11,14]:d.ellipse((830,210,1080,460),fill=(205,214,226,160),outline=(255,255,255,210),width=4)
 elif n in [15,16,17,18,19,20]:
  if n==18:
   for z in range(24,0,-1):d.ellipse((820-z,165-z,1160+z,505+z),outline=(180,220,255,2+int((24-z)*2)),width=2)
   d.ellipse((820,165,1160,505),outline=(236,249,255,230),width=3)
  elif n in [17,20]:
   for k in range(7):d.polygon([(1000,700),(380+k*55,-20),(405+k*55,-20)],fill=(70+k*20,160,240,35));d.line((1000,670,580+k*30,0),fill=(160,225,255,130),width=1)
  else:
   glow=Image.new('RGB',(W,H),'black');gd=ImageDraw.Draw(glow)
   gd.ellipse((740,90,1250,600),fill=(50,60,125) if n!=16 else (30,115,105));glow=glow.filter(ImageFilter.GaussianBlur(100));im=ImageChops.add(im,glow);d=ImageDraw.Draw(im,'RGBA')
 elif n in [21,22,23,24,25,26,27,28]:
  if n in [21,22,25,26]:
   for k in range(4):
    a=730+k*60;b=90+k*40;c=1160-k*25;e=650-k*15
    d.rounded_rectangle((a,b,c,e),radius=90 if n==21 else 1,outline=(190,207,222,160),width=7 if light else 2)
   d.line((660,H,1000,410,W,500),fill=(190,210,230,90),width=2)
  elif n==23:
   for z in range(25,0,-1):d.ellipse((760-z,470-z,1180+z,575+z),outline=(170,200,230,50),width=1)
   d.ellipse((760,470,1180,575),fill=(28,38,52,220),outline=(200,225,250,180),width=2)
  elif n==27:d.ellipse((750,400,1620,1270),outline=(120,190,255,190),width=5)
  else:
   for k in range(3):
    pts=[(xx,540+k*50+25*math.sin(xx/130+k)) for xx in range(0,W+10,10)];d.polygon(pts+[(W,H),(0,H)],fill=(25+k*10,40+k*10,60+k*10,170))
   d.line((0,510,W,510),fill=(190,215,240,80),width=1)
 else:
  for k in range(4):
   pts=[(xx,510+k*35+22*math.sin(xx/160+k)) for xx in range(0,W+10,10)];d.polygon(pts+[(W,H),(0,H)],fill=(130+k*12,145+k*10,145+k*10,40))
 return im
changed=0
for x in j['prompts']:
 im=typ(x) if x['key'].startswith('cn-type-') else bg(x) if x['key'].startswith('cn-bg-') else None
 if im:
  p=dest/(x['key']+'-layout.webp');im.save(p,'WEBP',quality=90);x['source'].setdefault('referencePreviewUrl',x.get('previewUrl'));x['previewUrl']='/prompt-previews/'+p.name;x['source']['previewKind']='schematic';x['source']['note']='中文整理改编；卡面为程序绘制的排版/构图示意，非AI生成实测效果。详情保留关联案例的风格参考与原始出处。';changed+=1
f.write_text(json.dumps(j,ensure_ascii=False,indent=2));print('schematics',changed)
