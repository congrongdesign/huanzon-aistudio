# coding:utf-8
import json,pathlib
root=pathlib.Path('/tmp/font-daily-1123');x=json.load(open(root/'candidates-final.json'));pages={p['id']:p for p in json.load(open(root/'discovery.json'))['pages']};cards=[c for c in x['cards'] if c['sampleText'] not in {'薄雾晨松','萌力全开'}]
def add(pid,idx,title,group,style,form,color,use):
 p=pages[pid];im=p['images'][idx];mi=next(q for q in json.load(open(root/pid/'images.json')) if q['index']==idx);w,h=mi['size'];b=[0,250,1440,1500] if pid=='659107' else [0,120,1440,1500]
 c={'number':0,'sourceFile':mi['file'],'originalSize':[w,h],'crop':b,'title':f'{title} · {style}','sampleText':title,'group':group,'style':style,'author':p['author'],'sourceTitle':p['title'],'sourceUrl':p['url'],'originalImageUrl':im['url'],'tags':['每日扩充1123','优设精选',p['author'],group],'visualReviewed':False}
 c['description']=f'【字形与构成】{form}\n【配色与材质】{color}\n【适用场景】{use}。\n【作者】{p["author"]}；依据作品正文和图内署名核对。\n【原作品】{p["title"]}\n【来源】{p["url"]}\n【原图】{im["url"]}\n【原图尺寸与裁切】{w}×{h}像素；[left,top,right,bottom]={b}。\n【收录说明】单款完整标题裁图；教程步骤、同款换色与正文提示词排除。个人本地参考，非安装字体；商业使用另获授权。结构分析由整理归纳，非作者原始提示词。\n【收录日期】2026-11-23'
 c['prompt']=f'为【新标题文字】重新组织{style}。{form}{color}适用于{use}，保持完整笔画、清晰可读、字组重心和必要留白。'
 cards.append(c)
add('659107',5,'春游','圆体趣味','春日元素圆润连接字','两字以弧形连笔连接，草叶、花芽和春季节点嵌入笔画，字形轻盈活泼。','黑底白字、绿色春芽与圆润高光。','春季节气、亲子活动与文旅海报')
add('652525',7,'萌宠','圆体趣味','猫狗双声萌宠字','MEOW与WOOF围绕中英文萌宠主标题分区，弧形英文和动物音效形成对称层级。','软化糖果色、圆鼓立体字与柔和阴影。','宠物品牌、儿童活动与社交媒体')
for i,c in enumerate(cards,1):c['number']=i
out={'batch':'每日扩充1123','sourceDate':'2026-11-23','cards':cards};root.joinpath('candidates-final.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
from collections import Counter
print('cards',len(cards));print('groups',Counter(c['group'] for c in cards));print('authors',Counter(c['author'] for c in cards))
