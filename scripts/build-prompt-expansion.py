# -*- coding: utf-8 -*-
"""Build the November expansion from preserved, visually reviewed public prompt/image pairs."""
import json,re,html,hashlib
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]; P=ROOT/'output/prompt-curation/expansion'; OUT=ROOT/'public/prompt-previews'; cards=[]
def clean(t):return html.unescape(re.sub('<[^>]+>','',re.sub(r'<br\s*/?>','\n',t,flags=re.I))).strip()
def add(key,name,text,cat,sub,author,url,file,image,tags,model,collection,original=None,extra=None):
 im=Image.open(P/file).convert('RGB');w,h=im.size;im.thumbnail((1400,1400));fn='audited-'+hashlib.sha256(key.encode()).hexdigest()[:20]+'.webp';im.save(OUT/fn,'WEBP',quality=92)
 shape='横版' if w/h>1.1 else '竖版' if h/w>1.1 else '正方形'
 source=dict(key=key,subcategory=sub,author=author,url=url,collection=collection,collectionUrl=url,previewKind='example',language='zh-CN',batch='design-curation-2026-11-15',collectedAt='2026-11-15',note='来源完整提示词与此张案例图已核对；'+('英文已完整翻译为中文，原始模型参数保留。' if original else '保留来源中文原文。')+f'来源模型：{model}。未在本机重新生图。',model=model,verifiedPair=True,previewOriginalUrl=image)
 if extra:source.update(extra)
 c=dict(key=key,name=name,text=text,category=cat,subcategory=sub,tags=list(dict.fromkeys(tags+[shape,'图文已核对'])),source=source,model=model,previewUrl='/prompt-previews/'+fn,exampleImages=[image],sha256=hashlib.sha256(text.encode()).hexdigest())
 if original:c['originalText']=original
 cards.append(c)
# Explicit reviewed naming and grouping; never use a search thumbnail as the paired image.
spec={
3:('磨砂流金｜金刻·时光','立体金属标题'),5:('银色充气｜ZCOOL','圆体与趣味字组'),6:('黑底哥特｜夜的第七章','哥特与尖锐标题'),7:('渐变水晶｜梦','液体与玻璃字效'),8:('玻璃霓虹｜赛博朋克','霓虹与发光字效'),9:('漫画立体｜Chilly','圆体与趣味字组'),10:('黑底白字·圆角黑体｜初柔','圆体与趣味字组'),11:('篆书重构｜夜雨','几何与构成字组'),12:('金属浮雕｜英雄对决','立体金属标题'),14:('流体泡泡｜童趣','圆体与趣味字组'),16:('黑底白字·现代中式｜京喜','几何与构成字组'),17:('新年泡泡字组｜心想事成','圆体与趣味字组'),18:('马卡龙气球｜生日快乐','材质与特殊字效'),21:('雾霾蓝缎带｜M','材质与特殊字效'),25:('黑底白字·几何标题｜月球植物','几何与构成字组'),27:('青绿液态金属｜ORVIN','液体与玻璃字效'),28:('鎏金纱丝｜sea','材质与特殊字效'),30:('黑底白字·手写标题｜のCoffeeChat','书法与手写标题'),31:('冰剑字组｜冰爽一整夏','材质与特殊字效'),34:('机械霓虹液体｜字体设计','霓虹与发光字效'),35:('赛博故障流光｜字体设计','霓虹与发光字效'),37:('多彩街头涂鸦｜开心快乐','涂鸦与创意字组'),41:('国风飞白｜小暑','书法与手写标题'),43:('云朵字标｜乘云俱乐部','圆体与趣味字组'),45:('破碎棱镜｜X','液体与玻璃字效'),46:('金石飞白｜山海','书法与手写标题'),47:('黑底白字·像素标题｜字体设计','科技与像素标题'),48:('暗黑哥特｜黑玫瑰','哥特与尖锐标题'),49:('黑底白字·圆润隶变｜邻巷私饭堂','圆体与趣味字组'),50:('纤细几何｜松涧','极简与精细字形'),52:('马卡龙橡皮筋｜Q','材质与特殊字效'),53:('粉色霓虹灯管｜字体设计','霓虹与发光字效'),54:('炫彩金属链条｜字体设计','立体金属标题'),55:('森系白字品牌标题｜森野','极简与精细字形'),56:('几何粗黑｜江河','几何与构成字组'),57:('潮流弧形连字｜站酷','几何与构成字组'),58:('黑底白字·切割字组｜站酷','几何与构成字组'),59:('银色铁丝网｜M','材质与特殊字效'),61:('国潮泼墨金字｜字体设计','书法与手写标题'),63:('曲线装饰字组｜踏青','几何与构成字组'),64:('Y2K充气标题｜快乐发生','圆体与趣味字组'),65:('复古招牌粗宋｜松風堂','极简与精细字形'),66:('油画颜料字｜ZCOOL','材质与特殊字效'),67:('微缩海洋字｜TIDE','材质与特殊字效'),69:('卡通手写蓝字｜字体设计','圆体与趣味字组'),73:('萌系液态金属｜新品首发','液体与玻璃字效'),75:('黄金喇叭字组｜618狂欢','立体金属标题'),76:('明亮玻璃科技｜FUTURE','液体与玻璃字效'),78:('黑底白字·街头标题｜六月欢乐亲子游','涂鸦与创意字组'),79:('冰晶机甲标题｜夏日狂欢','材质与特殊字效'),81:('欧式轻奢金字｜宠粉计划','哥特与尖锐标题'),82:('赛博像素字组｜宠粉计划','科技与像素标题'),83:('机械徽章字组｜运营盛典','立体金属标题'),84:('漫画促销字组｜大促狂欢','圆体与趣味字组'),87:('金红倒计时｜倒计时3天','立体金属标题'),90:('蓝色霓虹连笔｜618尖货榜','霓虹与发光字效'),92:('明亮科技标题｜SPARK','科技与像素标题'),93:('新中式装饰宋｜家慈堂','极简与精细字形'),95:('激光雕刻银字｜618年中大促','立体金属标题'),97:('金色机甲字组｜全球好货','立体金属标题'),100:('黑底白字·笔刷标题｜字体设计','书法与手写标题'),102:('黑底白字·狂草字组｜新年新肌会','书法与手写标题'),103:('暗黑叙事白字｜遗失的华服','极简与精细字形'),106:('赛博机甲｜未来战士','立体金属标题'),107:('机械环字组｜星际迷雾','立体金属标题'),110:('昭和复古粗字｜灰度','极简与精细字形'),111:('极简解构｜池中物','极简与精细字形'),112:('青铜纹样｜诗绝','材质与特殊字效'),113:('纤细解构宋｜资深','极简与精细字形'),114:('新中式细线｜喜燕集','极简与精细字形'),117:('奶油字效｜花田里','圆体与趣味字组'),119:('全息水晶｜霓虹','液体与玻璃字效'),120:('镀铬工业字｜钢铁','立体金属标题'),121:('纤细流动字组｜情绪流','极简与精细字形'),122:('昭和装饰字组｜結绳','极简与精细字形'),123:('蓬松云朵字｜暖羊绒','材质与特殊字效'),124:('绿色琉璃竹节字｜竹','液体与玻璃字效'),127:('充气玻璃字组｜相约七夕','液体与玻璃字效'),128:('冰饮液态标题｜避暑神器','液体与玻璃字效'),130:('动感流体数字｜6.18','液体与玻璃字效')}
for r in json.load(open(P/'font-shortlist.json')):
 i=r['index']
 if i not in spec:continue
 d=json.load(open(P/f'z-detail-{i}.json'));p=d['contentList'][0];im=p['introduceList'][0];assert d['subscriptionStatus']==0 and p['prompt']==r['content']['prompt'] and im['id']==r['image']['id'] and im['url'].split('?')[0]==r['image']['url'].split('?')[0];name,sub=spec[i];text=clean(p['prompt']);tags=['中文字体','标题设计','字组设计','站酷','国内创作者',sub]
 if i in [6,10,16,25,30,47,49,58,78,100,102]:tags+=['黑底白字']
 if i in [76,92]:tags+=['发布会标题']
 add('zcool-'+d['id'],name,text,'字体设计',sub,d['memberObj']['username'],d['pageUrl'],r['file'],im['url'],tags,p['llmName'],'站酷AI资产 · 公开字体案例',extra={'sourceContentId':p['id'],'sourceImageId':im['id']})
# Full Chinese translations, keeping all Midjourney flags verbatim.
pl={
105527:('香槟金曲线｜极简抽象波浪','背景设计','流体与金属缎带','一幅精致的抽象装饰画，由四个宽阔、流动的波浪形色块构成，横向和斜向排列。曲线轻柔交叠，形成平静的有机节奏。使用温暖象牙白、浅沙色、珍珠灰和柔和香槟金。每个波浪都是简单光滑的哑光色面，仅在边缘附近有细微色调变化。少量纤细金线沿曲线延伸，有时平行，有时隐入背景。线条数量少且安排克制。平面绘画表面、干净轮廓、柔和有机流动、克制优雅、手工当代墙面艺术。不要真实水体、泡沫、复杂渐变、层叠雕塑脊线、粗金绳或厚重纹理。'),
103003:('粉绿笔触｜抽象画布背景','背景设计','色域与抽象地景','[画布上的抽象绘画] 抽象画，白色背景上的粉色形状，画笔笔触，粉色与鼠尾草绿色色板，白色元素，当代艺术，情绪感，表现主义，极简风格，创作痕迹。[艺术扫描，1200ppi，高分辨率，8k，ISO 100]'),
100736:('浓粉绒毛｜柔软材质背景','背景设计','材质与柔和光影','审美感绒毛主题背景，采用浓烈的粉色色调，柔和渐变与抽象形状，带有蓬松、奇趣的纹理及细微细节。'),
105761:('暗色胶片颗粒｜青橙漏光','背景设计','材质与柔和光影','深色纹理背景，呈现浓重的多彩胶片颗粒效果。纹理由密集的青绿、青蓝、橙色和白色噪点主导。右边缘出现温暖橙色漏光渐变，左侧处于深阴影。表面散布细微划痕、灰尘点和发丝般纤维。'),
103100:('粉彩烟纱｜轻盈抽象渐变','背景设计','弥散与运动模糊','空灵形状，粉彩色，动态渐变，细微纹理。'),
91268:('金边粉绢｜抽象几何山脉','背景设计','东方流体与水墨','中国刺绣风格的抽象几何山脉景观，包含鎏金与粉色丝绸材质。金镶玉雕刻艺术、水晶玻璃纹理、流动液态金，极简浅蓝色域背景。深邃层次、层叠纤维、闪亮光泽，营造中国朋克美学，以微距摄影和移轴构图、微距镜头捕捉。'),
91871:('浅金丝带｜灰白未来空间','背景设计','流体与金属缎带','浅金色丝绸缎带，灰色渐变背景，高品质纹理，虚拟空间，抽象形状，柔美女性气质，动态，干净背景，未来主义，聚光灯，网格纹理，明亮。'),
96931:('彩色网格波｜等距抽象曲面','背景设计','粒子与数字矩阵','等距波浪的3D渲染，白色背景上的网格。彩色设计、抽象、矢量图形。'),
69966:('黑底白色点阵｜极简抽象波浪','背景设计','粒子与数字矩阵','惊艳的极简抽象波浪，AMOLED纯黑背景，超高品质，高度精细的信息细节。'),
100247:('几何飞鹤｜米色极简构成','图形设计','几何与图形构成','极简海报设计，以几何形状和粗线条塑造优雅飞翔的鹤，搭配米色渐变背景。构图均衡明亮，以简约表达运动与优雅。高分辨率矢量图形插画，Don Blanding风格。'),
92891:('几何沙漠｜暖色太阳与仙人掌','图形设计','几何与图形构成','波希米亚极简几何沙漠景观，包含太阳及暖色调，白色背景，Jon Klassen和Noma Bar风格。'),
102163:('杂志撕纸字组｜Culture','字体设计','涂鸦与创意字组','创作单词“Culture”的图像，让它像从杂志上撕下来的。使用粗体字形和现代杂志设计。'),
97121:('黑白日食｜斜线光环背景','背景设计','几何与轨道光环','这幅图将成为醒目的iPhone壁纸：极简黑白设计，一个类似日食的发光圆环或圆形。一条锐利斜线切过画面中央，将其分割并形成强烈对比。发光白环在深黑背景中呈现柔和亮光，带来空灵、近似宇宙的外观。高对比与简单几何元素形成简洁现代的美学，在手机屏幕上显得精致。构图虽然极简，仍有纵深与立体感，光线仿佛从圆形自身散发。这个抽象设计兼顾简约与视觉趣味，适合作为优雅壁纸。'),
100285:('红色沙丘｜蓝色星空地景','背景设计','色域与抽象地景','用于macOS Big Sur屏幕的壁纸，简单且极其简约，平滑的红色沙丘曲线，低饱和度蓝色星空背景、低饱和度蓝天和渐变。高分辨率、高对比、超现实，具备专业摄影的品质与电影感。'),
104196:('动物纹样｜奶油留白拼贴背景','背景设计','材质与柔和光影','抽象手绘非洲草原壁纸，撕纸拼贴与水粉，浓咖啡棕、焦糖、奶油色和黑色的斑马条纹、豹纹及长颈鹿斑点；密集纹样仅分布在边缘，中央为纯净空白奶油色，哑光、颗粒纸纹、极简。')}
rows=json.load(open(P/'vertical-shortlist.json'))+json.load(open(P/'vertical-extra-shortlist.json'))
for r in rows:
 if r['id'] not in pl:continue
 codes=re.findall(r'<code[^>]*>(.*?)</code>',(P/f"pl-detail-{r['id']}.html").read_text(),re.S);assert any(clean(x)==r['text'] for x in codes)
 name,cat,sub,zh=pl[r['id']];match=re.search(r'\s--(?:chaos|ar|style|raw|sref|v|stylize|profile|personalize|no)\b',r['text']);params=r['text'][match.start():].strip() if match else '';text=zh+('\n\n'+params if params else '');m=re.search(r'--v ([\d.]+)',params);model='Midjourney '+m[1] if m else 'Midjourney（来源未注明版本）'
 add('promptlibrary-'+str(r['id']),name,text,cat,sub,'Prompt Library（页面未署具体创作者）',r['url'],r['file'],r['image'],['Prompt Library','垂直提示词网站','忠实中文翻译',sub],model,'Prompt Library · 公开图像提示词',r['text'])
# Chinese vertical site: reject double exposure case with absent title; retain matching concrete cases.
p123={5403:('时尚人像｜圆角黑白拼贴','海报设计','时尚与拼贴海报','竖版海报拼贴设计，米色背景，四个上下堆叠的横向圆角矩形，内含同一位年轻女性佩戴太阳镜、摆出不同潮流姿势的黑白电影感人像。前景左侧放置该女性的全彩高质量抠图，身穿粉紫色修身衬衫、黑色长裤，戴太阳镜，姿态自信酷飒。现代时尚编辑风，柔和影棚灯光，超写实，高级杂志美学，景深与阴影效果，干净极简布局，2:3画幅。'),4800:('羽毛编织｜彩色环形标志','LOGO设计','材质标志概念',None),4786:('海滩微缩景观｜字母B','字体设计','材质与特殊字效',None),4995:('夜宵畅饮｜黄色手写标题海报','海报设计','商业活动海报',None)}
for id,(name,cat,sub,zh) in p123.items():
 r=json.load(open(P/f'p123-detail-{id}.json'));raw=r['detail']['content'];s=(P/f'p123-{id}.html').read_text();assert r['image'].replace('&','&amp;') in s or r['image'] in s
 if zh:text=zh
 elif id==4800:text=raw.split('\n\n')[-1].strip()
 elif id==4786:text=raw.split('\n\n')[-1].strip()
 else:text=raw
 add('prompt123-'+str(id),name,text,cat,sub,'Prompt123（页面未署具体创作者）',r['detail']['detail'],f'p123-{id}.img',r['image'],['Prompt123','垂直提示词网站',sub], '来源未注明模型','Prompt123 · 中文AI图片提示词',raw if zh or id in [4800,4786] else None)
# Stable full-text deduplication against the current audited collection.
base=json.load(open(ROOT/'data/prompt-curation/design-prompts-2026-11-15.json'));digest=lambda t:hashlib.sha256(re.sub(r'\s+','',t).lower().encode()).hexdigest();known={digest(c['text']) for c in base['prompts']};unique=[]
for c in cards:
 h=digest(c['text'])
 if h not in known:unique.append(c);known.add(h)
collection=dict(version=1,batch=base['batch'],collectedAt='2026-11-15',selectionMethod='公开详情全文、对应原图与人工视觉核对；拒绝配图不符、缺失必要参考图与质量不足的条目。',prompts=unique)
(ROOT/'data/prompt-curation/expansion-2026-11-15.json').write_text(json.dumps(collection,ensure_ascii=False,indent=2))
from collections import Counter
print('NEW',len(unique),Counter(c['category'] for c in unique),Counter(c['source']['collection'] for c in unique))
