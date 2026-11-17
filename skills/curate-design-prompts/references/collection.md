# 本批集合格式

UTF-8 JSON，图片路径相对于此 JSON。稳定 key 取来源实际案例 ID，不随机改变。每张图必须实际查看；提示词需要原文与对应效果图核对，字体需要一款一图。不要把示意字段当成真实来源。

```json
{
  "kind": "prompts",
  "name": "本批精选",
  "author": "整理者",
  "description": "本批来源与筛选说明",
  "cards": [{
    "key": "site-actual-case-id",
    "title": "案例真实名称",
    "group": "背景设计",
    "subcategory": "玻璃与折射",
    "tags": ["玻璃", "横版"],
    "text": "完整中文原提示词或忠实翻译，保留参数",
    "originalText": "非中文来源的完整原文",
    "model": "实际标注模型，未知写未注明",
    "author": "原作者，未署名则说明",
    "sourceUrl": "https://来源域名/具体作品",
    "originalImageUrl": "https://来源域名/原图.png",
    "collectedAt": "实际收录日期",
    "note": "原图对应核对、翻译说明与差异，来源效果未在本机重生成",
    "file": "images/001.webp",
    "visualReviewed": true,
    "verifiedPair": true
  }]
}
```

字体集合改 `kind` 为 `fonts`；`text` 为明确标记的整理所得风格指令，不能冒充作者原提示词。另填 `sampleText`（图中文字）、`style`（简短风格）、`crop`（原图像素 left/top/right/bottom），一款一图并保持完整笔画。字体用的裁图清单 `crop_fonts.py` 格式见该脚本参数；它生成的 cards 须整理成上述集合格式再打包。

保留原文/原图/裁切证据在本批目录；卡片备注≤2000字，完整证据过长时在独立资料保留并准确摘要。标题≤160字，分组≤50字，text≤30000字，标签≤10个且每个≤30字。每批≤1000条且图片总计≤256MiB。实际来源图缺失或必要参考图未取得时暂不入库。
