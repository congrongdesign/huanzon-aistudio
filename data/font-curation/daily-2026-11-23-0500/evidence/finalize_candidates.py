# coding: utf-8
import json,pathlib
root=pathlib.Path('/tmp/font-daily-1123');x=json.load(open(root/'candidates.json'));pages={p['id']:p for p in json.load(open(root/'discovery.json'))['pages']}
drop={'https://www.uisdc.com/group/678826.html','https://www.uisdc.com/group/675654.html','https://www.uisdc.com/group/669570.html'}
cards=[c for c in x['cards'] if c['sourceUrl'] not in drop]
def add(pid,idx,title,group,style,form,color,use):
 p=pages[pid];im=p['images'][idx];mi=next(q for q in json.load(open(root/pid/'images.json')) if q['index']==idx);w,h=mi['size']
 crops={'652819':[0,0,1440,700],'652525':[0,120,1440,1500],'673518':[0,0,1440,1600],'659107':[0,250,1440,1500]};b=crops[pid]
 c={'number':len(cards)+1,'sourceFile':mi['file'],'originalSize':[w,h],'crop':b,'title':f'{title} · {style}','sampleText':title,'group':group,'style':style,'author':p['author'],'sourceTitle':p['title'],'sourceUrl':p['url'],'originalImageUrl':im['url'],'tags':['每日扩充1123','优设精选',p['author'],group],'visualReviewed':False}
 c['description']=f'【字形与构成】{form}\n【配色与材质】{color}\n【适用场景】{use}。\n【作者】{p["author"]}；依据作品正文和图内署名核对。\n【原作品】{p["title"]}\n【来源】{p["url"]}\n【原图】{im["url"]}\n【原图尺寸与裁切】{w}×{h}像素；[left,top,right,bottom]={b}。\n【收录说明】单款完整标题裁图；教程步骤、同款重排与正文提示词排除。个人本地参考，非安装字体；商业使用另获授权。结构分析由整理归纳，非作者原始提示词。\n【收录日期】2026-11-23'
 c['prompt']=f'为【新标题文字】重新组织{style}。{form}{color}适用于{use}，保持完整笔画、清晰可读、字组重心和必要留白。'
 cards.append(c)
# 12款未收录来源补充
add('652819',9,'薄雾晨松','细线优雅','晨雾层叠自然字','四字竖排主标题配NATURAL、BOTANICAL AROMA上下英文，留白和层级模拟雾气缓慢上升。','黑底浅灰白字、低对比雾感与林木气息。','自然品牌、节气海报与文艺版式')
add('652525',1,'未来重构','立体字效','荧光故障科幻字','四字打破常规框架，笔画加入电路延伸、机械碎片和高密度英文代码层。','荧光绿主体、电光紫和极夜黑立体描边、太空灰背景。','电竞潮牌、科技活动与未来主题海报')
add('652525',6,'街头节奏','运动力量','喷漆嘻哈街头字','主标题粗重错落，巨大半透明的Rhythm作背景，前景叠加喷漆Yo!和贴纸。','高饱和街头撞色、粗描边和喷漆颗粒。','音乐节、潮流品牌与街头活动')
add('673518',9,'青云志','立体字效','刀锋金效书法字','三字以书法走势重构，笔锋锐利外挑，完成稿叠加厚度、暗部、高光和背景装饰。','金属高光、深色暗部与国风奇幻氛围。','国风游戏、玄幻海报与活动主标题')
add('659107',1,'青花瓷','书法手写','青花书法品牌字','书法笔画稳重延展，青花瓷纹样和留白围绕三字主体形成传统徽标结构。','青花蓝与瓷白、东方纹样和渐变高光。','文化品牌、国风海报与文创标识')
add('659107',2,'春游','细线优雅','抽象流动春游字','圆润线条连续交错，字形被抽象成迎风草叶般的节奏，整体保持轻盈。','黑底白字、极简线条与少量春意绿。','春季节气、文旅与文艺海报')
add('659107',3,'五一出游季','运动力量','黄白手绘潮流字','主标题横排跳动，May Day Travel Season沿字组错位排布，周边加入手绘标记。','黑底白字、黄色英文和涂鸦点缀。','假期活动、旅行宣传与社交媒体')
add('659107',4,'春日出游踏青','圆体趣味','春日抽象连笔字','文字被拆成连续弧线和草叶曲线，大小错落，形成从左上到右下的游走路径。','黑底白字、绿色植物点缀。','春日文旅、户外活动与节气海报')
add('659107',6,'萌力全开','圆体趣味','荧光卡通萌字','圆润手写笔画带俏皮卷曲和表情装饰，字组向中心膨胀。','荧光绿色、纯黑背景、卡通高光。','儿童活动、社媒贴纸与趣味品牌')
add('659107',7,'美好的时光在路上','书法手写','细圆行书旅途字','三行文字均匀连写，收笔略带拖尾，行书骨架与几何留白结合。','黑底白字、纤细圆润线质。','旅行手账、文艺海报与生活品牌')
add('659107',8,'字体传说','复古装饰','现代装饰书法字','现代化书法骨架带夸张装饰笔画，整体倾斜形成动态叙事。','黑白高反差、局部金属或墨色渐变。','字体专题、品牌故事与国潮视觉')
add('659107',9,'创意字体设计','几何构成','机甲流线标题字','机械边缘与流线笔画咬合，转角锐利，字组重心居中并保持紧凑冲击。','白字、机甲金属高光、纯黑背景。','科技品牌、游戏活动与未来海报')
for i,c in enumerate(cards,1):c['number']=i
out={'batch':'每日扩充1123','sourceDate':'2026-11-23','cards':cards};root.joinpath('candidates-final.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
from collections import Counter
print('cards',len(cards));print('groups',Counter(c['group'] for c in cards));print('authors',Counter(c['author'] for c in cards));print('pages',Counter(c['sourceUrl'] for c in cards))
