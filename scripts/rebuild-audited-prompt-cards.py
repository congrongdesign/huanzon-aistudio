# -*- coding: utf-8 -*-
"""Build visually reviewed cards from preserved public source evidence (no generated filler)."""
import json,re,hashlib,html
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];P=ROOT/'output/prompt-curation/reaudit';OUT=ROOT/'public/prompt-previews';OUT.mkdir(exist_ok=True)
old=json.loads((P/'previous-collection.json').read_text());oldmap={r['key']:r for r in old['prompts']};candidates={r['id']:r for r in json.loads((ROOT/'output/prompt-curation/candidates.json').read_text())};cards=[]
def add(key,name,text,category,sub,author,url,imagefile,tags,model='即梦 / Seedream 3.0',crop=None,originalurl=None,note=None):
 im=Image.open(imagefile).convert('RGB')
 if crop:im=im.crop(crop)
 im.thumbnail((1400,1400));file='audited-'+hashlib.sha256(key.encode()).hexdigest()[:20]+'.webp';im.save(OUT/file,'WEBP',quality=92)
 source={'key':key,'subcategory':sub,'author':author,'url':url,'collection':'优设网 · 中文设计案例' if 'uisdc.com' in url else '公开设计案例','collectionUrl':url,'previewKind':'example','language':'zh-CN','batch':old['batch'],'collectedAt':'2026-11-15','note':note or f'原文与此张来源效果图已人工核对；来源标注模型：{model}。未在本机重新生图。','model':model,'verifiedPair':True}
 if originalurl:source['previewOriginalUrl']=originalurl
 if crop:source['previewCrop']=list(crop)
 cards.append({'key':key,'name':name,'category':category,'subcategory':sub,'text':text.strip(),'tags':list(dict.fromkeys(tags)),'source':source,'model':model,'previewUrl':'/prompt-previews/'+file,'exampleImages':[originalurl] if originalurl else [],'sha256':hashlib.sha256(text.strip().encode()).hexdigest()})
fonts=json.loads((P/'font-pairs.json').read_text())
# Only the matching-text image is used. Exclude examples whose actual material contradicts the prompt.
for i in list(range(0,7))+list(range(8,15))+[16,19,20,21,22,23,24,25,26,27,29]+list(range(31,40))+[41,43,44,45,46,52,53,54,56,57,58,59,60]:
 r=fonts[i];text=re.sub(r'^(完整提示词|提示词示例|提示词)：','',r['text']);word=re.search('“([^”]+)”',text)[1].strip();style=text.split('，')[1].strip() if '，' in text else '标题字'
 if i==0:sub='哥特与尖锐标题'
 elif i<=6:sub='极简与精细字形'
 elif i in [8,9,10,11,13]:sub='涂鸦与创意字组'
 elif i==12 or i==14:sub='科技与像素标题'
 elif i==16:sub='哥特与尖锐标题'
 elif 19<=i<=25:sub='圆体与趣味字组'
 elif i in [26,27,29,53,57,59]:sub='书法与手写标题'
 elif i in [32,35,54]:sub='立体金属标题'
 elif i in [34,45]:sub='液体与玻璃字效'
 elif i in [33,46,60]:sub='霓虹与发光字效'
 elif i in [36,37,38,39,41,43]:sub='材质与特殊字效'
 elif i in [31,44,52,56,58]:sub='彩色主题字组'
 else:sub='创意标题字组'
 chosen=1 if i==57 else 0
 tags=['中文字体','标题设计',style,'黑底白字' if '黑底白字' in text else '彩色字效','优设网','即梦案例']
 add(f'uisdc-font-{i:02}',f'{style}｜{word}',text,'字体设计',sub,'言川 Artie','https://www.uisdc.com/ai-font-master',P/f'font-{i:02}-{chosen}.jpg',tags,originalurl=r['images'][chosen])
# One-to-one output/prompt tutorial panels. Preserve the full original as supporting evidence.
cola=[
(2,'笔刷手写｜灵感永不掉线','黑底手写艺术字，主题“灵感永不掉线”，清新绿色字体，笔触洒脱灵动，部分收笔可略微飞扬拉长，展现创意持续在线的状态。整体自由、高级、富有设计张力。','书法与手写标题'),
(3,'粉橙气泡｜爆款设计公式','黑底活力艺术字，主题“爆款设计公式”，粉橙渐变字体，字形圆润饱满，适合加入星点、流线与轻微高光，整体甜感与能量感并存，适合 AI 爆款设计内容展示。','圆体与趣味字组'),
(4,'淡紫手写｜一键排版计划','黑底柔美艺术字，主题“一键排版计划”，淡紫渐变字体，线条流畅、手写感自然，可加入轻微流光与柔和弧线，整体梦幻、清透、有节奏，适合 AI 排版与版式设计主题。','书法与手写标题'),
(5,'速度斜体｜AI出图加速器','黑底动感艺术字，主题“AI出图加速器”，青绿渐变字体，笔画富有速度感与推进感，可加入流线、弧线和轻微发光效果，突出 AI 设计出图更快、更高效的主题表达。','科技与速度标题'),
(6,'蓝青科技｜电商视觉实验室','黑底未来感艺术字，主题“电商视觉实验室”，蓝青色发光渐变字体，笔画可融入网格、电路或箭头元素，整体结构清晰、科技感强，适合 AI 电商视觉研究与创意展示主题。','科技与速度标题'),
(7,'香槟衬线｜详情页进化论','黑底高级质感艺术字，主题“详情页进化论”，米白到浅金渐变字体，结构优雅、细节精致，可加入少量星芒与柔光，呈现高端、克制、升级感强的 AI 详情页视觉气质。','极简与精细字形'),
(8,'蓝青箭头｜主图灵感舱','黑底清爽科技艺术字，主题“主图灵感舱”，蓝青渐变字体，加入箭头、速度线与流动弧线元素，整体轻盈有节奏，体现 AI 电商主图创作的灵感爆发与效率感。','科技与速度标题'),
(9,'蓝紫赛博｜提示词魔法','黑底霓虹科技感艺术字，主题“提示词魔法”，紫蓝渐变发光字体，笔画融入电路线条与星点光效，整体未来感、高级感、视觉冲击力强，适合 AI 设计类封面与标题展示。','霓虹与发光字效')]
for i,name,text,sub in cola:
 im=Image.open(P/f'type-{i:02}.webp').convert('RGB');w,h=im.size
 # Locate the large black result panel; retain its complete graphic including rounded corners.
 rows=[y for y in range(h) if sum(max(im.getpixel((x,y)))<55 for x in range(0,w,6))>w/6*.55]
 y0=max(0,min(rows)-5);y1=min(h,max(rows)+6)
 xs=[x for x in range(w) if sum(max(im.getpixel((x,y)))<55 for y in range(y0,y1,6))>(y1-y0)/6*.35]
 crop=(max(0,min(xs)-4),y0,min(w,max(xs)+5),y1)
 add(f'uisdc-cola-{i:02}',name,text,'字体设计',sub,'AI电商设计师 Cola（优设转载）','https://www.uisdc.com/group/684192.html',P/f'type-{i:02}.webp',['中文字体','黑底彩字','标题设计','电商','优设网'],model='原教程未注明具体模型',crop=crop,originalurl=f'https://image.uisdc.com/wp-content/uploads/2026/09/Font-20260915-{i:02}.webp')
posters=json.loads((P/'poster-pairs.json').read_text())
for i in [0,1,2,3,4,5,6,7,8,10,11]:
 r=posters[i];name=['春风始万物生','与你有关皆是浪漫','时光隧道十年庆典','山海经水墨标题','我命由我不由天','花束奇怪剧场','新学期让梦想起飞','续势待发工业标题','郁金香梦幻标题','风暴行动','快乐星球毛绒字','燃爆现场液态金属'][i]
 sub='庆典与时空主题' if i==2 else '国风与文化主题' if i in [0,3,4] else '科技与音乐活动' if i in [7,11] else '插画与情绪主题'
 add(f'uisdc-poster-{i:02}',name,r['text'],'海报设计',sub,'yaoyao设计师','https://www.uisdc.com/jimeng',P/f'poster-{i:02}-0.jpg',['中文海报',sub,'优设网','即梦3.0'],originalurl=r['images'][0])
extra=json.loads((P/'poster-extra-pairs.json').read_text())
for i in [1,3,4,5,6,7,8,9,10]:
 r=extra[i];name=['爆款封面标题','禁止焦虑几何字组','盛世篇章','亲密接触宠物插画','清明植物造字','追风少年机械字','天府岩石造字','未来电子元件字','繁花似锦金属丝带','儿童节毛绒数字61','幸福刺绣毛线字'][i]
 # Several source files combine two different texts. Select only the left, matching result.
 crop=None
 if i>=3:
  im=Image.open(P/f'extra-{i:02}-0.jpg');crop=(0,0,im.width//2,im.height) if i not in [6] else None
 category='海报设计' if i==3 else '字体设计';sub='插画活动海报' if i==3 else '几何与构成字组' if i==1 else '材质与特殊字效'
 add(f'uisdc-extra-{i:02}',name,r['text'],category,sub,'yaoyao设计师','https://www.uisdc.com/jimeng',P/f'extra-{i:02}-0.jpg',['中文设计',sub,'优设网','即梦3.0'],crop=crop,originalurl=r['images'][0])
# Carefully transcribed source panels from a Chinese creator, also credited on Xiaohongshu.
kv=[(2,'沙漠遗迹｜数独挑战赛','在星空下的广阔沙漠景观中，有一个数独谜题立方体的动态场景。这个立方体由带有数独数字和符号雕刻的古老石头制成，部分埋在沙子里，扬起一团戏剧性的 DUST 云，仿佛刚刚着陆或正在被互动。一个发光的魔法星形物体在立方体上方盘旋，散发出柔和的光芒。背景中，在布满星星的天空中可以看到一颗大行星（如月亮或外星世界），流星划过天空。整体氛围融合了科幻冒险和神秘的解谜元素，色彩鲜艳：沙漠的暖沙色调，太空天空的深蓝色和紫色，以及发光星星上的明亮高光。顶部用 BOLD、未来主义的白色字体突出显示文字“数独挑战赛”。高细节，电影级灯光，史诗般的构图，照片级真实感渲染。','沙漠与星空主视觉'),(3,'棋盘攻防站｜数独棋盘格','画面聚焦于一个数独棋盘，棋盘由带有数字的木质方块构成，质感细腻。两只卡通风格的手，手指正指向棋盘中央堆叠的标有“K1、50”的木质方块，仿佛在进行关键操作。棋盘周围散落着其他木质数字方块与国际象棋棋子，增添了丰富度。上方有“极速攻防·聚·灯尖舞台”的文字，下方则是“极速攻防·指尖对决 数独棋盘格 聚光灯下的舞台”的文字内容。整体以聚光灯打亮核心区域，营造出紧张且富有仪式感的氛围，背景色调偏暗，突出主体的光影效果，风格偏向益智竞技类的场景呈现。','聚光灯与竞技主视觉'),(8,'科技棋盘｜智慧冒险岛','在浩瀚的宇宙空间中，以地球为背景，悬浮着一个带有科技质感的蓝色数独棋盘。棋盘由金属与科技材质打造，边缘有蓝色光效，表面格子里分布着数字，还镶嵌着闪烁的蓝色水晶状元素。周围环绕着各种形态的行星，有的带有星环，还有巨大的蓝色晶体、漂浮的陨石以及闪烁的星星，星与星之间有蓝色的光线连接，营造出神秘且充满未来感的太空氛围。画面下方用醒目、富有力量感的白色字体显示“智慧冒险岛”，整体画面采用科幻风格，色调以深邃的蓝为主，光线效果突出，水晶和行星都散发着璀璨的光泽，细节丰富，仿佛能让人感受到宇宙的浩瀚与智慧冒险的奇妙。','宇宙与科技主视觉')]
for i,name,text,sub in kv:
 im=Image.open(P/f'kv-{i}.webp');w,h=im.size;crop=(round(w*.045),round(h*.250),round(w*.955),round(h*.633))
 add(f'uisdc-duoduo-kv-{i}',name,text,'KV设计',sub,'DuoDuoAi / 小红书：多多AI（优设公开教程）','https://www.uisdc.com/group/643041.html',P/f'kv-{i}.webp',['KV主视觉','即梦3.1','空间设计','优设网','国内创作者'],model='即梦3.1（作者建议）',crop=crop,originalurl=f'https://image.uisdc.com/wp-content/uploads/2025/09/KV-20250927-{i}.webp' if i!=7 else None)
# Restore full Chinese source text for a small reviewed subset; do not retain our earlier shortened rewrites.
keep=['freestylefly-231','freestylefly-232','freestylefly-400','freestylefly-459','freestylefly-206','freestylefly-230','freestylefly-223','freestylefly-279','freestylefly-236','freestylefly-453','freestylefly-222','freestylefly-218','freestylefly-274','awesome-nano-banana-155']
for key in keep:
 r=oldmap[key];c=candidates[key];t=c['text'].split('[English]')[0].replace('[中文]','').strip();t=t.replace('dutch angle','倾斜构图').replace('eight immortals','八仙')
 add(key,r['name'],t,r['category'],r['subcategory'],c['author'],c['gallery'],ROOT/'public'/r['previewUrl'].lstrip('/'),[x for x in r['tags'] if x!='中文精编']+['来源中文','图文已核对'],model=r.get('model','来源未注明'),originalurl=(c.get('images') or [r['source'].get('previewOriginalUrl')])[0],note='保留来源完整中文提示词；预览按主体、构图与文字核对。模板变量需替换；未在本机重新生图。')
 cards[-1]['source']['url']=c['source'];cards[-1]['source']['collectionUrl']=c['gallery']
# Faithful Chinese translations: retain all concrete subjects, framing and source constraints.
translations={
'pixmind-1264':'竖版构图，仰视高耸的加州红杉。金色晨光穿透树干间的薄雾，像教堂中的光束。蕨类植物覆盖林地。远处一位极小的徒步者提供尺度参照。14毫米超广角镜头让树干产生向天空汇聚的放射状透视变形。温暖的绿色与金色色板。超写实4K自然摄影。',
'pixmind-1267':'宽幅风景，凌晨1点的挪威峡湾山谷中，一座极小的木屋透出暖光。壮观的绿色和紫色极光在上空舞动，映入静止漆黑的峡湾水面。薄雪覆盖的松树与群山框住画面。木屋灯光是冷色构图中唯一的暖色。20秒长曝光的观感。超写实4K天文摄影。',
'pixmind-1282':'暗黑幻想场景：夜晚巨大哥特式教堂的内部。描绘战斗场景的巨大彩色玻璃窗透出彩光，在石地板上投下红宝石色与蓝宝石色的光斑。成排石柱退入黑暗。远端一位极小的披风人物提供尺度参照。参考《黑暗之魂》的环境设计。氛围薄雾，光束穿过窗户。超精细4K概念艺术。',
'pixmind-1347':'为名为“MORNING”的咖啡品牌设计极简标志。用一条连续流动的暖棕色线条，在奶油色背景上勾画咖啡杯里的日出。图标下方是“MORNING”，使用干净的现代衬线字体，字母均匀间隔。巧妙运用负空间：杯中蒸汽形成太阳光芒。专业标志设计，可缩放的矢量风格。',
'evolink-380':'以专业应用界面设计师的风格，为音乐播放器首页设计一套完整的12枚分类图标，内容包括：音符、黑胶唱片、均衡器、耳机、喜欢的音乐、音乐文件夹、视频、麦克风、播放列表、扬声器、CD和收音机。每枚图标采用3D拟物风格，搭配鲜艳的彩色点缀，置于白色背景的圆角卡片上。',
'pixmind-1324':'一套6枚游戏道具图标，以网格排列。每枚图标为圆角方形，使用轻微的深色渐变背景。道具包括：发光的蓝色生命药水、带皇冠印记的金币、银色长剑、带铁箍的木盾、带红色封印的卷轴、红宝石戒指。每件道具居中置于单元格，并带柔和投影。图标美术风格类似《暗黑破坏神》或《魔兽世界》的道具图标。细节丰富、色彩鲜明、适合游戏使用。',
'pixmind-1299':'一只直立的棕色牛皮纸咖啡袋的特写。标签完全清晰可读，以粗体黑色复古字体写着“MIDNIGHT ROAST”。袋子底部周围散落少量咖啡豆。真实的纸张纹理。',
'freestylefly-507':'一个手工钩织的【主体】玩偶，柔软毛线纹理，精细针织细节。穿着带鲜明【颜色1】点缀的精致【颜色2】服装，手持小小的【道具】。置于温馨的【场景】中，温暖柔和的氛围，迷人的手工美感，怀旧日式钩织玩偶风格。',
}
for key,text in translations.items():
 r=oldmap[key];c=candidates[key];add(key,r['name'],text,r['category'],r['subcategory'],c['author'],c['gallery'],ROOT/'public'/r['previewUrl'].lstrip('/'),[x for x in r['tags'] if x!='中文精编']+['忠实中文翻译','图文已核对'],model=r.get('model','来源未注明'),originalurl=(c.get('images') or [r['source'].get('previewOriginalUrl')])[0],note='完整中文翻译，保留来源主体、构图与文字；已人工核对配图。未在本机重新生图。');cards[-1]['source']['url']=c['source'];cards[-1]['source']['collectionUrl']=c['gallery'];cards[-1]['originalText']=c['text']
# Public (non-member) full prompts from ZCOOL's Liu Bingke curated tutorial.
# Only use the output attached to this exact contentList entry, never its gallery cover.
zcool_selected={
3:('冷银哥特｜限时秒杀','哥特与尖锐标题',['冷银金属','哥特','黑底金属字']),
9:('磨砂流金｜流金','立体金属标题',['流体金属','磨砂','黑底金字']),
10:('镭射液态金属｜618狂欢盛典','液体与玻璃字效',['液态金属','镭射','促销字组']),
12:('寒冰能量环｜倒计时5天','材质与特殊字效',['倒计时','寒冰材质','标题字组']),
13:('粉色丝绸缎带｜花语','材质与特殊字效',['丝绸','缎带','黑底粉字']),
17:('青柠叠层玻璃｜巅峰钜惠618','液体与玻璃字效',['玻璃字','青柠高光','标题字组']),
18:('微缩夏日标题｜元气夏日','彩色主题字组',['夏日','微缩场景','立体标题']),
21:('磨砂流体金｜周末狂欢','立体金属标题',['流体金属','红底金字','磨砂']),
22:('复古马赛克｜元气夏日','科技与像素标题',['像素字','马赛克','夏日']),
23:('未来工业笔刷｜破界重构','涂鸦与创意字组',['工业风','实验字形','白色主标题','字组设计']),
26:('复古电玩霓虹｜金属狂潮','霓虹与发光字效',['赛博像素','霓虹描边','电玩']),
28:('街头情绪字组｜接受自己的不年轻','涂鸦与创意字组',['街头涂鸦','白字橙色装饰','字组设计'])}
for entry in json.loads((P/'zcool-public-pairs.json').read_text()):
 i=entry['index']
 if i not in zcool_selected:continue
 d=entry['data'];assert d['subscriptionStatus']==0
 p=d['contentList'][0];name,sub,tags=zcool_selected[i]
 text=html.unescape(re.sub(r'<br\s*/?>','\n',p['prompt'],flags=re.I));text=re.sub('<[^>]+>','',text)
 add('zcool-'+d['id'],name,text,'字体设计',sub,d['memberObj']['username'],d['pageUrl'],P/f'zcool-{i}.jpg',['中文字体','标题设计','站酷','国内创作者']+tags,model=p['llmName'],originalurl=p['introduceList'][0]['url'])
 cards[-1]['source'].update({'collection':'站酷AI资产 · 刘兵克精选字体合集','collectionUrl':'https://www.zcool.com.cn/article/ZMTc5NjM1Mg==.html','sourceContentId':p['id'],'sourceImageId':p['introduceList'][0]['id']})
backgrounds=ROOT/'data/prompt-curation/backgrounds-2026-11-15.json'
if backgrounds.exists():
 for card in json.loads(backgrounds.read_text())['prompts']:
  assert card['source'].get('verifiedPair') is True and (ROOT/'public'/card['previewUrl'].lstrip('/')).exists()
  assert card['key'] not in {c['key'] for c in cards}
  cards.append(card)
expansion=ROOT/'data/prompt-curation/expansion-2026-11-15.json'
if expansion.exists():
 for card in json.loads(expansion.read_text())['prompts']:
  assert card['source'].get('verifiedPair') is True and (ROOT/'public'/card['previewUrl'].lstrip('/')).exists()
  assert card['key'] not in {c['key'] for c in cards}
  cards.append(card)
landscapes=ROOT/'data/prompt-curation/landscapes-2026-11-15.json'
if landscapes.exists():
 for card in json.loads(landscapes.read_text())['prompts']:
  assert card['source'].get('verifiedPair') is True and (ROOT/'public'/card['previewUrl'].lstrip('/')).exists()
  assert card['key'] not in {c['key'] for c in cards}
  cards.append(card)
collection={'version':7,'batch':old['batch'],'collectedAt':'2026-11-15','selectionMethod':'逐张人工核对文字、主体、材质与颜色；来源中文原文或忠实完整翻译；移除全部自编改编稿、示意图和未经核对条目。','prompts':cards}
(ROOT/'data/prompt-curation/design-prompts-2026-11-15.json').write_text(json.dumps(collection,ensure_ascii=False,indent=2))
from collections import Counter
print(len(cards),dict(Counter(r['category'] for r in cards)))
