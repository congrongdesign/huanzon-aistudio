# 已核对中文设计提示词卡片库

本轮（2026-11-18）实际新增18张背景卡片：抽象渐变、红蓝弧光、暗金水面、织物柔光、玻璃焦散、热带叶框、梦核海面、森林建筑、航拍冰川与星云锦鲤等。来源PromptLibrary 17、Prompt123 1。22张核对候选中4张已有同文条目，未重复导入。实际本机库253张，背景91张；此前235张全部保留，用户已删除条目未恢复。中文正文、原始模型参数、来源和原图预览均保留；未付费生成。

新增批次：`backgrounds-2026-11-18.json`。使用中的安装应用已同步预览并正常重启；18张通过入库回读和预览字节校验，实际桌面验证横版暗金水域、玻璃焦散、中文星云巨鲤、空搜索和清空恢复。证据：`output/prompt-curation/daily-backgrounds-2026-11-18/verification.json`。每日北京时间05:00不限主题扩充任务已启用（heartbeat，ID automation），每次争取20—40张，质量不足则少收。

本轮新增41张：背景40张、创意摄影1张，包含用户指定的Prompt123 3511与4233。背景覆盖海岸水域航拍、山川河谷、雪山山湖、森林晨雾、茶田稻田、建筑人文、俯拍静物材质、天空云景与创意地景。来源分布：Prompt Library 19、站酷AI资产17、Prompt123 2、Flux1 AI 2、Public Prompts 1。源码累计272张；实际库保留用户自行删减的结果，不恢复旧卡片。

新增垂直来源：[Flux1 AI公开图库](https://flux1.ai/prompts)、[Public Prompts](https://www.publicprompts.art/prompts)。预览使用原案例对应图；Public Prompts选择单独匹配的火山图，不使用多主题拼图封面。Prompt123 4233使用完整竖图，注明来源1:1提示词与实际竖图的比例差异；3511注明仅有512×384来源缩略图。未在本机重新生图，无法保证跨模型复现一致。

新增集合：`landscapes-2026-11-15.json`；可重复构建：`scripts/build-landscape-prompt-cards.py`。本轮仅追加新集合，未重新导入用户已删除的旧卡片。实际本机库验收235张、背景73张，新增41张全部通过HTTP预览字节校验；使用中的应用已更新资源并完成正常重启。验收文件：`output/prompt-curation/landscapes/verification.json`。

源码收录集合共231张；本次新增99张：字体82、背景12、图形2、海报2、LOGO1。新增来源为站酷80、Prompt Library15、Prompt123 4。实际库尊重用户继续删除的条目；本次验收时实际218张、字体149、背景35。

本次检索：按用途（发布会/标题字组/PPT背景）×材质（玻璃/金属/绒毛/颗粒）×构图（极简/网格/留白）拆词，结合中英文站内检索，再回查公开详情全文及对应原图。只保留能核对的提示词和案例，不以聚合摘要代替原文；缺失必要参考图、主体文字不符、底色冲突等案例不入库。

新增垂直来源：[Prompt Library](https://promptlibrary.org/)、[Prompt123中文图片提示词](https://www.prompt123.cn/image-prompts/)。站酷保留创作者与具体案例链接；未署具体创作者的垂直站明确标记，不编造作者身份。

字体列表改为滚动自动加载，每次40张，支持搜索/小类别/标签重新筛选。已更新正在使用的 `/Applications/环中AIStudio.app`，实际桌面滚轮验证40→80→120→149；独立浏览器补充验证末页停止、无结果搜索、清空恢复。新增99张提示词与缩略图全部通过运行时字节校验。用户并行删除的条目不自动恢复。

构建：`nJbzfYIolEEdt2yauqtT8`。验收证据：`output/prompt-curation/expansion/verification.json`。新增集合：`expansion-2026-11-15.json`；构建脚本：`scripts/build-prompt-expansion.py`。

以下为上一阶段132张收录时的历史记录。


当前收录132张，含110张国内公开案例（优设78张、站酷32张）。全部附来源效果图；字体79张、海报16张、KV4张。其余为经核对的插画、图形、LOGO、包装、信息图、IP、品牌与自然/建筑背景案例。

## 收录规则

- 原生中文保留来源原文；英文只做完整中文翻译，不擅自更换主体、构图、颜色或文字。
- 人工查看效果图，核对主体、字面内容、材质、颜色及构图。并列图包含不同标题时只使用匹配的那一幅，裁剪坐标写入JSON。
- 预览是作者公开案例，未在本机重新生图，模型版本差异会影响复现。
- 剔除全部自编改编稿、程序示意图、无图条目及未完成核对的条目。
- 旧集合与撤下条目保存在 output/prompt-curation/reaudit/previous-collection.json 和 withdrawn-records.json，用户内容未被删除。

## 国内来源

- [站酷AI资产：刘兵克精选创意字体合集](https://www.zcool.com.cn/article/ZMTc5NjM1Mg==.html)（仅收录12张公开完整提示词与对应图片，会员专属未收录）

- [言川 Artie：中文字体提示词教程](https://www.uisdc.com/ai-font-master)
- [yaoyao设计师：即梦文字海报案例](https://www.uisdc.com/jimeng)
- [AI电商设计师Cola：标题艺术字教程（优设转载）](https://www.uisdc.com/group/684192.html)
- [DuoDuoAi：KV教程（小红书署名“多多AI”，通过优设公开文章核对）](https://www.uisdc.com/group/643041.html)

## 平台访问与缺口

站酷搜索页有访问验证，已通过公开检索接口、文章及对应详情页核对收录32张；小红书直达内容遇到访问验证/网络限制；花瓣与即梦社区未取得可核对的完整提示词与配图。未将摘要、登录墙后的内容或灵感图冒充成已收录案例。国内110张通过优设及站酷公开案例获得，包含即梦3.0/3.1/4.0/4.5及GPT-image2案例。

已新增20张背景专项案例：磨砂玻璃折射、弥散模糊、粒子矩阵、同心轨道、流体金属、绢丝水墨、柔和光影及发布会空间等。当前背景共23张。新案例中7张横版、5张正方形、8张竖版，按原图画幅标记；未擅自把竖版提示词改成16:9并保留原配图。花瓣链接在当前访问环境返回405异常访问，未收录为已核对案例。

## 分类索引

### 字体设计（79）

**哥特与尖锐标题**

- 哥特风格字体｜暗夜幽灵 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 哥特风格字体｜阴森恐怖 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)

**极简与精细字形**

- 时尚体｜潮流先锋 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 极简无衬线手写｜清风徐来 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 细线体｜纤细流光 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 单线字体｜纤线灵动 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 现代衬线体｜都市韵律 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 极简手写体｜清新手迹 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 香槟衬线｜详情页进化论 · AI电商设计师 Cola（优设转载） · [出处](https://www.uisdc.com/group/684192.html)

**涂鸦与创意字组**

- 手绘字体｜栩栩如生 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 涂鸦字体｜天马行空 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 艺术字体｜浑然天成 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 夸张体｜惊世骇俗 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 趣味变形体｜妙趣横生 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)

**科技与像素标题**

- 未来感字体｜智能驱动 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 像素风格体｜游戏人生 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)

**圆体与趣味字组**

- 可爱体：笔画圆润流畅｜活泼灵动 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 圆体｜圆满如意 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 胖字体｜福态可掬 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 软糖体｜萌趣横生 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 泡泡体｜梦幻泡泡 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 动物形态体｜动物世界 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 卡通手写体｜奇幻冒险 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 粉橙气泡｜爆款设计公式 · AI电商设计师 Cola（优设转载） · [出处](https://www.uisdc.com/group/684192.html)

**书法与手写标题**

- 连笔字｜行云流水 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 草书风格｜凤舞龙飞 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 行书风格｜飘逸潇洒 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 书法风格字体｜悲喜自渡 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 手写风格字体｜奔向旷野 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 鸿运当头”｜春龙抬首，鸿运当头 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 笔刷手写｜灵感永不掉线 · AI电商设计师 Cola（优设转载） · [出处](https://www.uisdc.com/group/684192.html)
- 淡紫手写｜一键排版计划 · AI电商设计师 Cola（优设转载） · [出处](https://www.uisdc.com/group/684192.html)

**彩色主题字组**

- 可爱体｜童言无忌 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 涂鸦字体｜绚丽多姿 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 现代风格字体｜盛夏季肆意派对 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 卡通风格字体｜帮帮龙的奇妙生活 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 街头涂鸦风格字体｜精神团体 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)

**立体金属标题**

- 未来感字体｜瞬息万变 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 未来感字体｜锋芒毕露 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 未来科技风格字体｜未来已来 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)

**霓虹与发光字效**

- 未来感字体｜光彩夺目 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 未来感字体｜超凡脱俗 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 玩乐有范”｜为 Ni 而来，玩乐有范 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 蓝紫赛博｜提示词魔法 · AI电商设计师 Cola（优设转载） · [出处](https://www.uisdc.com/group/684192.html)

**液体与玻璃字效**

- 时尚体｜波光粼粼 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 夸张体｜晶莹剔透 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)

**材质与特殊字效**

- 复古字体｜根深叶茂 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 草书风格｜烈火燎原 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 艺术字体｜雪窖冰天 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 行书风格｜墨染山河 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 复古字体｜古韵悠长 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 现代衬线体｜破镜重圆 · 言川 Artie · [出处](https://www.uisdc.com/ai-font-master)
- 清明植物造字 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 追风少年机械字 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 天府岩石造字 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 未来电子元件字 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 繁花似锦金属丝带 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 儿童节毛绒数字61 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 幸福刺绣毛线字 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)

**科技与速度标题**

- 速度斜体｜AI出图加速器 · AI电商设计师 Cola（优设转载） · [出处](https://www.uisdc.com/group/684192.html)
- 蓝青科技｜电商视觉实验室 · AI电商设计师 Cola（优设转载） · [出处](https://www.uisdc.com/group/684192.html)
- 蓝青箭头｜主图灵感舱 · AI电商设计师 Cola（优设转载） · [出处](https://www.uisdc.com/group/684192.html)

**几何与构成字组**

- 禁止焦虑几何字组 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)

**中文书法**

- 疾风起狂草艺术字体设计 · OpenNana · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-231)
- 兰亭集序书法帖意境图 · @liyue_ai · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-232)

**手写与签名**

- 六种笔势个性签名 · GitHub prompt · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-400)

**语义图形字**

- 文字组成物体轮廓 · @aziz4ai · [出处](https://x.com/IqraSaifiii/status/1969868863522423034)

### 海报设计（16）

**国风与文化主题**

- 春风始万物生 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 山海经水墨标题 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 我命由我不由天 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)

**插画与情绪主题**

- 与你有关皆是浪漫 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 花束奇怪剧场 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 新学期让梦想起飞 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 郁金香梦幻标题 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 快乐星球毛绒字 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)

**庆典与时空主题**

- 时光隧道十年庆典 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)

**科技与音乐活动**

- 续势待发工业标题 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)
- 燃爆现场液态金属 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)

**插画活动海报**

- 亲密接触宠物插画 · yaoyao设计师 · [出处](https://www.uisdc.com/jimeng)

**国风与节气**

- 极简国潮鎏金广州塔 · @liyue_ai · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-230)
- 春日禅意水墨群山 · @liyue_ai · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-223)
- 裂痕水墨东方山水 · @liyue_ai · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-279)

**体育与赛事**

- 国潮联赛邀请函 · @liyue_ai · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-236)

### KV设计（4）

**沙漠与星空主视觉**

- 沙漠遗迹｜数独挑战赛 · DuoDuoAi / 小红书：多多AI（优设公开教程） · [出处](https://www.uisdc.com/group/643041.html)

**聚光灯与竞技主视觉**

- 棋盘攻防站｜数独棋盘格 · DuoDuoAi / 小红书：多多AI（优设公开教程） · [出处](https://www.uisdc.com/group/643041.html)

**宇宙与科技主视觉**

- 科技棋盘｜智慧冒险岛 · DuoDuoAi / 小红书：多多AI（优设公开教程） · [出处](https://www.uisdc.com/group/643041.html)

**饮品与食品**

- 品牌奶茶主视觉概念 · @liyue_ai · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-459)

### 插画设计（1）

**东方工笔与水墨**

- 八仙工笔长卷 · @GeekCatX · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-206)

### 品牌视觉设计（1）

**触点与样机**

- 企业商业画册视觉系统 · @MrLarus · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-453)

### 信息图与数据可视化（3）

**科学与知识图谱**

- 模块化科普百科图鉴 · @MrLarus · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-222)
- 科学百科知识图谱 · @GeekCatX · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-218)

**地图与文旅**

- 成都手绘美食地图 · @Panda20230902 · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-274)

### 背景设计（23）

**自然光景**

- 红杉森林体积光背景 · Pixmind-io · [出处](https://github.com/Pixmind-io/awesome-gpt-image-2-prompts/blob/master/README.md)
- 极光木屋夜景背景 · Pixmind-io · [出处](https://github.com/Pixmind-io/awesome-gpt-image-2-prompts/blob/master/README.md)

**幻想与游戏场景**

- 哥特大厅空间背景 · Pixmind-io · [出处](https://github.com/Pixmind-io/awesome-gpt-image-2-prompts/blob/master/README.md)

### LOGO设计（1）

**标志概念**

- 咖啡杯负形日出标志 · Pixmind-io · [出处](https://github.com/Pixmind-io/awesome-gpt-image-2-prompts/blob/master/README.md)

### 图形设计（2）

**图标系统**

- 立体音乐播放器图标 · @iamaiistudio · [出处](https://github.com/Evolink-AI/awesome-gpt-image-2-API-Prompts/blob/main/README.md)
- 游戏道具图标套装 · Pixmind-io · [出处](https://github.com/Pixmind-io/awesome-gpt-image-2-prompts/blob/master/README.md)

### 包装设计（1）

**食品与饮品**

- 咖啡豆袋包装样机 · Pixmind-io · [出处](https://github.com/Pixmind-io/awesome-gpt-image-2-prompts/blob/master/README.md)

### IP与角色设计（1）

**潮玩与玩偶**

- 暖调钩织角色玩偶 · @azed_ai · [出处](https://github.com/freestylefly/awesome-gpt-image-2/blob/main/docs/gallery-part-2.md#case-507)

## 新增站酷字体卡片（12）

- 冷银哥特｜限时秒杀 · 史提芬Graphic · [原案例](https://www.zcool.com.cn/ai/prompt/ZMjQ4MjQ=.html)
- 磨砂流金｜流金 · Haivy · [原案例](https://www.zcool.com.cn/ai/prompt/ZMjA3NzI=.html)
- 镭射液态金属｜618狂欢盛典 · 张先生ZLF · [原案例](https://www.zcool.com.cn/ai/prompt/ZMzAyNDQ=.html)
- 寒冰能量环｜倒计时5天 · 史提芬Graphic · [原案例](https://www.zcool.com.cn/ai/prompt/ZMjYyMzY=.html)
- 粉色丝绸缎带｜花语 · 星光Vivian · [原案例](https://www.zcool.com.cn/ai/prompt/ZMjk1MjQ=.html)
- 青柠叠层玻璃｜巅峰钜惠618 · 张先生ZLF · [原案例](https://www.zcool.com.cn/ai/prompt/ZMjcxMDQ=.html)
- 微缩夏日标题｜元气夏日 · 史提芬Graphic · [原案例](https://www.zcool.com.cn/ai/prompt/ZMjQ4NjQ=.html)
- 磨砂流体金｜周末狂欢 · 史提芬Graphic · [原案例](https://www.zcool.com.cn/ai/prompt/ZMjQ4NDg=.html)
- 复古马赛克｜元气夏日 · _硕果 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMjcyNzI=.html)
- 未来工业笔刷｜破界重构 · 光还是光 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMzA5MjA=.html)
- 复古电玩霓虹｜金属狂潮 · 唯自渡 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTkxNDg=.html)
- 街头情绪字组｜接受自己的不年轻 · 董沐熹 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMzgzNDg=.html)

## 本机验收

已更新 `/Applications/环中AIStudio.app` 并正常重启，来源与本机运行构建一致。112张预览HTTP检查全部通过；桌面检查了站酷卡片、玻璃标题详情、黑底白字详情、KV详情、搜索无结果与清空恢复，未发现破图或内容裁切。原有画布草稿重启后仍可恢复。

本轮撤下旧条目344条，保留并纠正22条，新增优设78条及站酷12条。来源效果图未经本机再次生成，不承诺跨模型完全复现。

## 新增背景专项（20）

### 玻璃与折射（2）

- 竖纹磨砂玻璃｜柔和彩色折射 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTEwNDQw.html)
- 玻璃气泡｜浅绿水滴与金色微光 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTIyMDE2.html)

### 发布会与未来空间（2）

- 发布会｜蓝绿波浪与玻璃城市 · 嶌翴 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMjc0MzI=.html)
- 会议舞台｜蓝色环幕与光束空间 · 骆笙 · [原案例](https://www.zcool.com.cn/ai/prompt/ZNjkwMTY=.html)

### 弥散与运动模糊（2）

- 自然弥散｜春日绿色动态模糊 · 是早春的树 · [原案例](https://www.zcool.com.cn/ai/prompt/ZNTg2NA==.html)
- 暗色弥散｜蓝橙对称渐变 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTEzMzQ4.html)

### 几何与轨道光环（4）

- 镜片光环｜深紫同心圆环 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTIxODA0.html)
- 复古几何｜80年代极简山脉 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTE3OTc2.html)
- 天体轨道｜靛蓝线条与浅粉留白 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTIwMTQ4.html)
- 金日沙丘｜平衡圆盘与奶油色留白 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTE0MzIw.html)

### 粒子与数字矩阵（1）

- 粒子矩阵｜橙青蓝立方体 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTEwMTky.html)

### 色域与抽象地景（3）

- 抽象地平线｜深蓝与橙金 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTE1OTU2.html)
- 胶片色域｜极简颗粒色块 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTIwMDM2.html)
- 暮色金辉｜青绿与灰紫抽象倒影 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTIwNjk2.html)

### 东方流体与水墨（1）

- 青绿绢丝｜流体水墨山水 · yemmmmai · [原案例](https://www.zcool.com.cn/ai/prompt/ZMzc0OTY=.html)

### 流体与金属缎带（2）

- 颁奖盛典｜深蓝丝绸流体光场 · 晓钟 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMzgwNjA=.html)
- 蓝金液态｜镜面流体与层叠缎带 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTE5OTky.html)

### 材质与柔和光影（2）

- 柔光灰泥｜蓝绿日光与斑驳阴影 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTE3MjQw.html)
- 黑银渐变｜边缘暖金与大面积暗部 · 云尚广告 · [原案例](https://www.zcool.com.cn/ai/prompt/ZMTExNzcy.html)

### 商务系列与章节背景（1）

- 年度报告｜青绿抽象系列封面 · 骆笙 · [原案例](https://www.zcool.com.cn/ai/prompt/ZNjkwMzI=.html)

本次为数据与预览资源更新，已同步源码集合及正在使用的本机应用资源，正常重启后实际桌面显示132张、背景23张。132张运行时提示词及预览字节校验全部通过，桌面验证玻璃详情、发布会详情、小类别切换、无结果搜索和清空恢复，草稿保持一致。未调用付费生图。证据：output/prompt-curation/backgrounds/。
