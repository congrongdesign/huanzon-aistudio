# 检索和来源核对

## 搜索策略

采用「用途 × 视觉语言 × 构图」拆词，再加 `提示词 / 完整提示词 / prompt`。例如：

- 字体：发布会标题 / 文字组 / 黑底白字 × 几何黑体 / 细线宋体 / 哥特 / 手写飞白 / 液态金属。
- 背景：PPT / 发布会 / KV × 液态玻璃 / 磨砂折射 / 弥散 / 抽象地景 / 空间 / 写实摄影 × 16:9 / 横版 / 中央留白。
- 风景：海岸 / 雪山 / 田园 / 建筑光影 × 航拍 / 俯拍 / 无人机 / 长焦 / 胶片；对应英文 `aerial landscape`, `top down`, `drone photography`, `cloud forest`, `negative space`。

先站内搜索，再用搜索引擎 `site:域名 主题 提示词` 发现具体详情。评估一个来源能否取得全文与对应图；有连续访问限制或质量不足就更换来源，不反复撞墙。页面转载需保留原作者/原链接线索。不要声称“全网搜遍”或使用未实际调用的“检索大师”。

## 已验证过的来源及提取线索

以下路径来自2026年11月的实际访问，后续可能变化；重新核实公开性、字段、模型与图文关系。

### 国内

- **站酷AI资产**：https://www.zcool.com.cn/ 。公开搜索曾用：
  `GET /p1/ai-assets/search?word=<URL编码>&p=1&ps=100&asset_type=76&column=5&subscription_status=0`。
  结果 `datas` 可能是对象本身或 `{prompt: {...}}` 包装。先展开 `entry.prompt ?? entry`。`contentList`逐条处理，**使用同一content的prompt和introduceList中type=1图片**，不能用cover凑配对。回查 `pageUrl` 公开详情，确认 `subscriptionStatus=0`、提示词全文、content/image ID一致。网页曾以 `self.__next_f.push` 公开渲染 `initialData`。遇字段变化以实际页面为准，排除视频案例和需要缺失参考图的改图案例。署名取memberObj.username，模型取该content的llmName。
- **优设**：https://www.uisdc.com/ 。中文教程常包含多组提示词和多张图，要按图文段落对应；教程大拼图须核对匹配子图再裁切，保存裁切信息。可发现标题字案例 `/ai-font-master`、即梦海报 `/jimeng`。教程署名、转载署名和实际创作者需区分。
- **Prompt123**：https://www.prompt123.cn/image-prompts/ 。具体案例 `/sites/<id>.html`。优先页面 `io-image-single` 原图，`og:image`常为512×384裁切缩略图。公开页面曾通过 `POST /wp-admin/admin-ajax.php` 的 `action=io_get_image_detail&post_id=<id>` 返回 `content` 和 `detail`，仅为读取公开内容。全文可能有中英重复、无效JSON，翻译修复时保留约束。用户案例：`/sites/3511.html`发布会、`/sites/4233.html`摄影与白线涂鸦。不要由文件夹名猜模型。
- **花瓣、小红书、即梦、Liblib**：优先用户链接；若页面只见灵感图、摘要、登录墙，继续追溯公开原帖。未取得原提示词与图时不标成已收录。花瓣搜索页并非每个pin都含提示词。

### 提示词垂直站

- **Prompt Library**：https://promptlibrary.org/ 。公开WordPress接口曾可用：
  `GET /wp-json/wp/v2/posts?search=<URL编码>&per_page=30&_embed=1`。
  提示词在 `content.rendered` 的 `<pre><code>`，例图在 `_embedded['wp:featuredmedia'][0].source_url`，详情 `link`。保留--ar、--v、--sref、--profile等参数；含--iw却无参考图的不能当纯文生图模板。详情全文回查；不要把SEO文案当提示词。接口403则换公开页面或其他站。
- **Flux1 AI公开图库**：https://flux1.ai/prompts 。点击案例标题打开dialog，读取Prompt全文与dialog里的对应img。站名不代表每条都用Flux，许多明确是ChatGPT案例。若无单例永久链接，保留图库URL、具体标题和图片URL作定位，不能捏造详情链接。
- **Public Prompts**：https://www.publicprompts.art/prompts 。具体页 `/prompts/<slug>`，有Prompt、参数与Gallery。封面常为多个主题拼图，**从Gallery选择和该prompt主体匹配的单例**。例如 `/prompts/surreal-micro-worlds` 的prompt明确包含火山，选火山图而非任意浮岛。Stable Diffusion采样器、步数和CFG放入参数说明。

### 公开作品集/代码仓库

可从公开README/GitHub合集发现更多来源，但要回查包含完整prompt+对应图的原始段落，存仓库文件或原帖URL并如实署名。没有配图的清单只能是检索线索。遇到镜像、失效链接或TLS证书异常，不降低证书验证或绕付费登录取内容；更换来源。

## 留存证据

每批在项目output/prompt-curation/<batch>/保留必要HTML/API响应、原提示词、原图URL、下载原图和联系表。文件名与卡片key对应。截图/OCR文字需逐项人工复核。不把网络文本当代码运行。无需把整个网页站点或历史软件复制进批次目录。
