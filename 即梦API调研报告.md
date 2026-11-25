# 即梦（Jimeng）扩图 + 高清放大 API 调研报告

> 调研日期：2026-08-22
> 结论先行：**有官方 API，且正是为「扩图 / 高清放大」这两个场景量身定做的**。即梦 AI 已于 2025-09 上线火山引擎开放 API，其中「智能扩图 outpainting」和「智能超清」两个能力可通过火山引擎**视觉智能（cv）服务**直接调用，HTTP + AK/SK 鉴权，走"提交任务 → 轮询结果"的异步模式，成熟稳定。另有火山方舟 Seedream（OpenAI 兼容）可做近似替代，以及 GitHub 上若干开源封装（含官方 API 的 MCP 封装和逆向免费版）。

---

## 一、推荐方案：火山引擎「即梦AI」官方 API（智能扩图 + 智能超清）

### 1.1 产品归属与调用方式总览

| 项目 | 内容 |
|---|---|
| 产品线 | 即梦AI（火山引擎，2025-09 上线开放 API） |
| 接口域名 | `https://visual.volcengineapi.com` |
| 鉴权 | 火山引擎 HMAC-SHA256 签名；`Region=cn-north-1`、`Service=cv`；使用 AccessKey/SecretKey |
| 提交任务 | `POST /?Action=CVSync2AsyncSubmitTask&Version=2022-08-31`，返回 `task_id` |
| 查询任务 | `POST /?Action=CVSync2AsyncGetResult&Version=2022-08-31`，轮询直到 `status=done` |
| 任务状态 | `in_queue` → `generating` → `done`（另有 `not_found` / `expired`） |
| 输出 | 图片 URL（**24 小时有效**，需及时转存）或 base64 |
| 计费 | 仅成功出图计费；新用户有 200 次免费体验额度 |

两个能力共用同一套提交/查询接口，只是 `req_key` 和请求参数不同：

| 能力 | req_key（固定值） |
|---|---|
| 智能扩图 outpainting | `jimeng_img2img_seed3_painting_edit` |
| 智能超清 | `jimeng_i2i_seed3_tilesr_cvtob` |

### 1.2 智能扩图 outpainting（即梦同款扩图）

**能力说明**：AI 外扩绘画，根据原图内容推测并补全超出边界的画面，四边扩展比例可自由设置。适用海报制作、高清展示、电商主图优化等。

**提交任务 Body 参数**：

| 参数 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `req_key` | string | 是 | 固定值 `jimeng_img2img_seed3_painting_edit` |
| `binary_data_base64` / `image_urls` | array | 二选一 | 输入图片。普通扩展传 **1 张原图**；画布扩展需传 **2 张**（第一张画布、第二张 mask，尺寸一致） |
| `prompt` | string | 否 | 扩图提示词，中英文均可，建议 ≤800 字符 |
| `top` / `bottom` / `left` / `right` | float | 否 | 上/下/左/右扩展比例，取值范围 [0,1]；某方向不扩展传 0（画布扩展模式无需传） |
| `seed` | int | 否 | 随机种子，-1 为随机；相同正整数 + 相同参数可复现 |
| `callback_url` | string | 否 | 异步回调地址（用轮询则不用配） |
| `return_url` | bool | 否 | 回调模式下是否返回图片链接（24h 有效） |
| `logo_info` / `aigc_meta` | string(JSON) | 否 | 水印 / 隐式标识配置 |

**四种扩展类型**（官方文档定义）：

1. **等比扩展**：四边传相同比例，如 `top=bottom=left=right=0.25`，1024×1024 → 1536×1536（最大扩展倍数为 1）
2. **画幅扩展**：把 1:1 扩成目标画幅（如 16:9），按目标画幅换算四边比例
3. **四边扩展**：自定义单边扩展，如向上 25%、向右 25%（`top=right=0.25`）
4. **画布扩展**：自由定义画布 + 原图在画布内的位置/大小/旋转，传"画布图 + mask 图"（mask：原图区域=黑色 0，待扩展区域=白色 255）；官方提供 Python 示例工具生成画布和 mask

**请求示例**：
```json
{
  "req_key": "jimeng_img2img_seed3_painting_edit",
  "image_urls": ["https://xxxx/original.jpg"],
  "prompt": "向四周自然延伸出蓝天和草地",
  "top": 0.25, "bottom": 0.25, "left": 0.25, "right": 0.25
}
```

**查询结果**：`data.image_urls`（jpeg 格式，24h 有效）/ `data.binary_data_base64`。

### 1.3 智能超清（即梦高清放大，4K/8K）

**能力说明**：基于 Seedream 基模，针对 AIGC 生成图和低清图，在保证全局结构、语义一致的前提下放开部分一致性、生成更多细节，把图像超清到 **4K / 8K**。

**提交任务 Body 参数**：

| 参数 | 类型 | 必选 | 说明 |
|---|---|---|---|
| `req_key` | string | 是 | 固定值 `jimeng_i2i_seed3_tilesr_cvtob` |
| `binary_data_base64` / `image_urls` | array | 二选一 | 输入 **1 张图片** |
| `resolution` | string | 否 | 输出分辨率，默认 `"4k"`，可选 `["4k", "8k"]` |
| `scale` | int | 否 | 细节生成程度，默认 50，范围 [0,100]（越大细节越多，但也可能偏离原图） |
| `callback_url` / `return_url` / `logo_info` / `aigc_meta` | - | 否 | 同扩图 |

**请求示例**：
```json
{
  "req_key": "jimeng_i2i_seed3_tilesr_cvtob",
  "image_urls": ["https://xxxx/lowres.jpg"],
  "resolution": "4k",
  "scale": 50
}
```

**查询结果**：`data.image_urls`（png 格式，24h 有效）。

### 1.4 输入限制（两者相同）

- 图片格式：仅 **JPEG / PNG**（建议 JPEG）
- 文件大小：**≤ 4.7MB**
- 分辨率：**≤ 4096×4096**
- 宽高比：1:3 ~ 3:1（超清文档明确；扩图建议先压缩超限图）

### 1.5 计费（以控制台实际为准）

| 能力 | 计费方式 | 价格 |
|---|---|---|
| 即梦AI-智能超清 | 按调用次数（1张/次） | **0.4 元/图** |
| 即梦AI-智能扩图（outpainting） | 按调用次数（1张/次） | 属图像生成 3.0 系列（图生图 3.0 同源），约 **0.2 元/图**，以控制台为准 |
| 即梦AI-图片生成 4.0 / 4.6 | 按生成张数 | 0.22 元/图 |
| 即梦AI-交互编辑 inpainting | 按调用次数 | 0.2 元/图 |

其他要点：
- 新用户免费体验额度 **200 次**，默认并发 1（付费后 1~2）
- 并发可增购：500 元/日/并发 或 10000 元/月/并发（**智能超清 / inpainting 暂不支持付费扩并发**，量大可联系火山销售）
- 次数资源包：如 10 万次 18,000 元、50 万次 80,000 元（图像生成 3.0 系列）
- 只有调用成功（正常返回图片）才计费

### 1.6 开通流程（约 10 分钟）

1. 注册火山引擎账号并完成**实名认证**（个人/企业均可）：https://www.volcengine.com/
2. 开通服务（二选一入口）：
   - 控制台「模型广场 → 即梦AI → 即梦AI-图片生成4.0系列 → 开通服务」
   - 直接访问视觉智能能力页：`https://console.volcengine.com/ai/ability/detail/2`（即梦AI）
3. 创建密钥：「访问控制 → API 访问密钥 → 新建密钥」，得到 **AccessKey ID + Secret Access Key**（建议用子账号 + 最小权限）
4. 按文档接入：即梦AI 接口总览 https://www.volcengine.com/docs/85621/1544716

### 1.7 官方 SDK

| 语言 | SDK | 关键方法 |
|---|---|---|
| Python | `pip install volcengine` | `visual_service.cv_sync2async_submit_task(form)` / `cv_sync2async_get_result(form)` |
| Node.js | `npm i @volcengine/openapi` | 直接构造 `Action=CVSync2AsyncSubmitTask&Version=2022-08-31` 请求（签名自动处理） |
| Go | `volc-sdk-golang`（service/visual） | `visual.CVSync2AsyncSubmitTask` 等 |

> Node 参考：https://adg.csdn.net/694deaac5b9f5f31781ae345.html （Node.js 对接即梦AI，含 `@volcengine/openapi` 用法）

---

## 二、备选方案：火山方舟 Ark · Seedream（OpenAI 兼容）

如果不想接异步任务接口，或希望"生成 + 编辑"统一走一套 API，可以用火山方舟 Ark：

- 端点：`https://ark.cn-beijing.volces.com/api/v3/images/generations`（**OpenAI 兼容**，SSE 可选）
- 模型：`doubao-seedream-4-0-250828` / `doubao-seedream-4.5` / `doubao-seedream-5.0` 等
- 能力：文生图、**图生图（支持多参考图，最多 14 张）**、组图（最多 15 张）、**原生 4K 输出**、`watermark` / `response_format` 等
- 对"扩图/超清"的近似用法：传入原图 + 描述扩展/高清化的 prompt + `size: "4K"`，让模型重绘。**注意：这不是专用 outpainting / upscale 接口**，边缘衔接、保真度、可控性都不如官方「智能扩图 / 智能超清」，只建议作为兜底
- 开通：火山方舟控制台「开通管理 → 视觉大模型 → Doubao-Seedream → 开通服务」（新用户有免费额度）
- SDK：`@volcengine/ark-runtime`（Node `client.createImage(...)`）、openai Python SDK 配 `base_url`

---

## 三、国际版：BytePlus Vision AI（海外部署用）

字节跳动国际云 BytePlus 提供同源能力（即梦海外版 Dreamina）：

- 域名：`https://visual.byteplusapi.com`，`Region=ap-singapore-1`、`Service=cv`
- 智能超清 req_key：`i2i_seed3_tilesr_cvtob_bp`（2K/4K）
- 另有 Dreamina 4.6 / Creative Upscale / outpainting / inpainting 等文档
- 适合：平台若需海外节点或海外用户，可走 BytePlus，鉴权方式与火山引擎一致（HMAC-SHA256）

---

## 四、GitHub 开源生态盘点

### 4.1 推荐：andyleimc-source/jimeng-ai-mcp（官方 API 封装，可直接抄实现）
- 地址：https://github.com/andyleimc-source/jimeng-ai-mcp
- 定位：把**火山引擎官方 Volcengine API** 封装成 MCP 服务，供 Claude/Cursor 等调用
- 图片工具：`generate_image`（文生图 4.0/4.6/3.x）、`image_to_image`（图生图）、`inpaint_image`（局部重绘）、**`upscale_image`（智能超清 4K/8K，即 `jimeng_i2i_seed3_tilesr_cvtob`）**
- 价值：仓库里的 `src/jimeng_mcp/client.py`（submit_task/poll_task）和 `auth.py`（**完整 HMAC-SHA256 火山签名实现**）是纯 Python、无 SDK 依赖的现成参考，可直接移植到你们的 Next.js 服务端（或翻译成 TS）

### 4.2 逆向免费版：laixiao/jimeng-free-api-all（⚠️ 不稳定）
- 地址：https://github.com/laixiao/jimeng-free-api-all
- 定位：逆向即梦官网，把能力封装成 **OpenAI 兼容**接口；用官网 `sessionid` 当 token，支持多账号轮询，每日免费积分可生成约 66 次
- 能力：jimeng-5.0/4.6/4.5 文生图、图生图（多图合成）、视频生成（Seedance 2.0）
- **注意**：没有独立的扩图 / 超清接口（只有图生图）；作者明确声明"逆向 API 不稳定，避免封禁风险，仅限自用研究，禁止商用"。**不建议作为生产依赖**

### 4.3 其他生态
- `JiangAogo/ComfyUI-Seedream-API`、`Yunwuxin-666/Comfyui-Jimeng-api`：ComfyUI 调火山 Seedream / 即梦的节点包
- `tengmmvp/Seedream_MCP`：Seedream（Ark）MCP，支持文生图/图生图/组图
- `ffpff/n8n-nodes-jimeng-ai`：n8n 节点，封装文生图 3.1 的提交/查询任务
- `ruiyongwang/dlh`（skills/jimeng-ai）：Agent Skill，含 `jimeng_upscale.ps1` 智能超清脚本

---

## 五、与本项目（环中AIStudio）集成的落地方案建议

你们目前扩图走的是 `/api/generate` 的 `expandComposite`（生成新图 + sharp 裁剪合成），高清放大则没有独立接口。接入即梦后可以：

1. **新增服务端模块 `src/lib/volcengine.ts`**
   - 实现火山签名（参考 jimeng-ai-mcp 的 `auth.py` 翻译成 TS）+ `submitTask(reqKey, params)` + `pollTask(taskId, reqKey)`
   - 环境变量：`VOLC_ACCESS_KEY`、`VOLC_SECRET_KEY`（只放服务端）

2. **扩图改造**
   - 现有 `expandMode`（`expandLeft/Right/Top/Bottom` + 比例预设 + 框内拖拽）UI 完全可复用
   - 确认扩图时：把手柄算出的四边扩展量换算成 `top/bottom/left/right` 比例（相对原图宽高）→ 调 `jimeng_img2img_seed3_painting_edit`
   - 若想保留"原图 100% 还原 + 羽化过渡"的精细控制，可优先用即梦的**画布扩展**模式（传画布+mask，官方给了 Python 示例，等价于你们现在 sharp 合成的效果，且是模型真实生成）
   - 轮询拿到 24h URL 后 **下载 → 转存 S3 → 更新 image_record**（与现有 history 逻辑一致）

3. **新增「高清放大」工具**
   - 图片工具栏加一个按钮（如"即梦超清"），调 `jimeng_i2i_seed3_tilesr_cvtob`（`resolution: 4k/8k`、`scale`）
   - 输入图 >4.7MB 或 >4096 时先用 sharp 压缩再提交

4. **体验注意**
   - 生图耗时较长（几十秒~分钟级），沿用现有 `generatingPlaceholder` + 轮询即可
   - 输出 URL 24h 有效 → 所有落库前必须转存
   - 默认并发 1~2，批量场景注意排队；量大可买并发/资源包

---

## 六、风险与注意事项

1. **内容审核**：输入图/文本、输出图都有前后置审核（版权词、敏感内容），命中会返回 `50411/50511/50412...` 错误码，重试策略各不相同（详见官方错误码表）
2. **合规标识**：输出默认带隐式标识（AIGC 元数据），明水印可通过 `logo_info` 配置关闭/自定义
3. **URL 时效**：24 小时，必须转存
4. **逆向 API 不可用于生产**：sessionid 会失效、有封号风险、接口随时可能变化
5. **价格波动**：以火山引擎控制台实时价格为准（本报告价格来自官方 PDF 快照 2026-07）
6. **并发限制**：1~2 并发，需要时可增购或联系销售

---

## 七、参考资料

- 即梦AI-智能扩图 outpainting 接口文档：https://www.volcengine.com/docs/85621/2375477
- 即梦AI-智能超清 接口文档：https://docs.volcengine.com/docs/85621/2164806
- 即梦AI 开放平台接口总览：https://www.volcengine.com/docs/85621/1544716
- 即梦AI 产品页：https://www.volcengine.com/product/jimeng
- 同步转异步接口说明（提交/查询通用）：https://www.volcengine.com/docs/86081/1660403
- 官方 PDF（即梦AI 文档指南，含计费）：`https://eps-common-private-online.tos-cn-beijing.volces.com/cloud-doc/eps-doc-center-pdf/即梦AI_文档指南_1783567200.pdf`
- GitHub：https://github.com/andyleimc-source/jimeng-ai-mcp
- GitHub：https://github.com/laixiao/jimeng-free-api-all
- 火山方舟 Seedream 文档（Ark images/generations）：https://www.volcengine.com/docs/82379/1330310
- BytePlus 国际版：https://docs.byteplus.com/byteplus-vision/docs/beginners-guide

---

## 八、省钱方案：成本对比与替代选型（2026-08 补充）

> 用户反馈即梦官方 API"有点贵"（智能超清 0.4 元/张、智能扩图约 0.2 元/张）。以下按"高清放大"和"扩图"两个场景给出更便宜的替代，含免费额度与自部署方案。

### 8.1 高清放大（超清）成本对比

| 方案 | 单价 | 免费额度 | 说明 |
|---|---|---|---|
| 即梦智能超清（火山官方） | 0.4 元/张 | 新用户 200 次 | 4K/8K，效果最好 |
| **通义万相 2.1 通用图像编辑（super_resolution）** | **0.14 元/张** | **500 张**（百炼开通后 90/180 天内） | 超分倍数 1~4 倍，比即梦便宜 65% |
| 火山方舟 Seedream 5.0 Pro（4K 近似） | 0.3~0.6 元/张 | 新用户有免费额度 | 图生图+4K，非专用超分 |
| **Real-ESRGAN 自部署（推荐免费档）** | **0 元** | - | 开源 MIT，4 倍放大，对 AIGC 图效果好；CPU 可跑（慢）、GPU 更快 |
| 腾讯混元生图 Lite | 0.099 元/张 | 有免费额度 | 生图模型，非专门超分 |

### 8.2 扩图（outpainting）成本对比

| 方案 | 单价 | 免费额度 | 说明 |
|---|---|---|---|
| 即梦智能扩图（火山官方） | 约 0.2 元/张 | 新用户 200 次 | 效果好，四边比例可控 |
| **通义万相 图像画面扩展（image-out-painting）** | **0.18 元/张** | **400~500 张** | 支持：按画幅（4:3/16:9…）、按比例缩放（x/y_scale）、**四边加像素（top/bottom/left/right_offset）**、旋转后扩展；与即梦扩图能力几乎一一对应 |
| **通义万相 2.1 imageedit（expand）** | **0.14 元/张** | 500 张 | 向四方向扩展画布，10 种编辑功能之一 |
| **腾讯混元生图 3.0 扩图** | **限时免费**（原按 0.2 元/张档） | 有免费额度 | 腾讯云文档标注"扩图 限时免费"，建议实测 |
| FLUX Outpainting（fal.ai 版） | 约 0.22 元/张（1024×1024） | 官方 demo 免费 | 国外服务，单次画布上限 4MP，需海外支付 |
| ComfyUI 自部署（SDXL/FLUX 扩图工作流） | 0 元（需 GPU） | - | 完全免费但门槛高，适合已有 GPU 机器 |

### 8.3 推荐省钱组合（针对本项目）

1. **高清放大 → 优先 Real-ESRGAN 自部署（0 元）**
   - 你们已有 sharp 服务端，再挂一个轻量 Python 微服务（或直接复用 `upscaler` / `Real-ESRGAN-CPU-API` 等现成 Docker）即可，长期成本为 0。
   - 需要"创意性增强"（不是纯放大）时再走 通义万相 0.14 元/张 或 即梦 0.4 元/张。
2. **扩图 → 通义万相 image-out-painting（0.18 元/张 + 免费 400~500 张）**
   - 与即梦扩图参数几乎一一对应（四边 offset / 画幅 / 比例），改造量小；先把免费额度用完，再按量付费（0.18 元比即梦 0.2 便宜且额度多）。
3. **免费额度堆叠**（上线初期零成本试跑）：
   - 阿里云百炼：通义万相 500 张免费（imageedit）+ 400~500 张免费（out-painting）
   - 火山引擎：即梦官方 200 次 + 方舟 Seedream 免费额度
   - 硅基流动：FLUX.1 schnell/dev 每日 400 次免费（文生图，可做兜底）
4. **Provider 可切换架构**：把"扩图/超清"做成可配置 provider（即梦 = 高质量档 / 通义万相 = 经济档 / Real-ESRGAN = 免费档），前端工具栏加一个"省电模式"开关即可。
5. **不推荐上生产**：逆向版 jimeng-free-api-all（白嫖官网每日 66 积分）仅适合个人/内部试用，不稳定且有封号风险。

### 8.4 相关价格来源

- 通义万相 image-out-painting：0.18 元/张，免费 400~500 张（阿里云公告/百炼文档）
- 通义万相 2.1 imageedit：0.14 元/张，免费 500 张（阿里云百炼文档）
- 腾讯混元生图 3.0：0.2 元/张（Lite 0.099 元），扩图限时免费（腾讯云计费文档）
- Seedream 5.0 Pro：输出 ≤236 万像素 0.3 元/张、>236 万像素 0.6 元/张（36氪/官方发布）
- FLUX Outpainting：fal 版约 $0.03/首 MP + $0.015/额外 MP（1024×1024 ≈ 0.22 元）
- Real-ESRGAN：https://github.com/xinntao/Real-ESRGAN （MIT，免费）
- 现成 API 封装：https://github.com/robertsLando/upscaler 、https://github.com/edsonllneto/Real-ESRGAN-CPU-API

---

## 九、高清放大：GitHub 开源方案盘点（2026-08）

> 扩图平台已实现，本节约过扩图，专注「高清放大 / 超分辨率」。所有方案均**免费、可自部署**；按"接入难度 + 画质 + 资源消耗"分为六类。

### 9.1 经典通用超分模型（自部署，性价比最高，推荐首选）

| 项目 | Star | License | 说明 |
|---|---|---|---|
| **Real-ESRGAN** (xinntao/Real-ESRGAN) | 36.5k | BSD-3 | 通用/真实图像 4x 超分，对 AIGC 图效果好；提供 `realesrgan-ncnn-vulkan` 可执行文件（CPU/GPU、macOS/Linux/Windows 免 Python 环境） |
| **Real-CUGAN** (bilibili/ailab) | 5.9k | - | B站开源，2x/3x/4x，动漫/插画/视频超分效果好，有 ncnn-vulkan 版 |
| BasicSR (XPixelGroup/BasicSR) | 8.4k | Apache-2.0 | 超分工具箱（ESRGAN/EDSR/SwinIR 等），适合学术与实验 |
| SCUNet (cszn) | 820 | Apache-2.0 | 轻量盲复原+超分，低配机器可跑 |
| waifu2x-ncnn-vulkan (nihui) | 3.5k | MIT | 老牌动漫放大，Apple Silicon 等 GPU 加速 |

### 9.2 扩散模型超分（画质天花板，吃显存）

| 项目 | Star | 说明 |
|---|---|---|
| **SUPIR** (Fanghua-Yu/SUPIR) | 5.6k | 基于 Stable Diffusion 的盲超分，真人照片质感最强；**约需 24GB 显存**；配套 ComfyUI-SUPIR 节点 (kijai/ComfyUI-SUPIR 2.3k⭐) |
| StableSR (IceClear/StableSR) | 2.7k | IJCV2024，扩散先验超分 |
| DiffBIR (XPixelGroup/DiffBIR) | 4.1k | Apache-2.0，生成式盲恢复+超分 |

### 9.3 人脸修复增强（可选叠加）

- **GFPGAN** (TencentARC) 37.7k⭐：人脸修复+超分
- **CodeFormer** (sczhou) 18.1k⭐：人脸修复效果好、可控性强
- 适合人像类图片，可放在超分之后做人脸增强

### 9.4 开箱即用应用 / 服务（最省事）

| 项目 | Star | License | 说明 |
|---|---|---|---|
| **Upscayl** (upscayl/upscayl) | 48.7k | AGPL-3.0 | 跨平台 GUI，内置 Real-ESRGAN/Real-CUGAN，支持 CLI/headless 脚本化 |
| **Final2x** (EutropicAI/Final2x) | 7.3k | BSD-3 | 跨平台 GUI+CLI，内置 RealCUGAN/Real-ESRGAN/Waifu2x/SRMD 多模型 |
| chaiNNer (chaiNNer-org) | 6.0k | GPL-3.0 | 节点式批处理工具，支持超分模型链 |
| spandrel (chaiNNer-org) | 313 | MIT | 超分模型统一加载框架（适合自建后端推理） |
| robertsLando/upscaler | - | - | FastAPI + Real-ESRGAN 的 Web API + UI，可直接自托管成微服务 |

### 9.5 Node.js / 前端生态（可直接融入 Next.js）

| 项目 | 说明 |
|---|---|
| **UpscalerJS** (thekevinscott/UpscalerJS, 896⭐, MIT, npm `upscaler`) | 基于 TensorFlow.js，**浏览器 + Node 双端**，内置 ESRGAN x2/x3/x4 等模型，无外部二进制，Node 后端用 tfjs-node 即可跑 |
| waifu2x-tfjs / @plotdb/upscaler / upscalejs | npm 上的 tf.js 超分封装 |
| upscayl-node / @drovp/upscale | 在 Node 中调用 Real-ESRGAN / waifu2x 二进制的方式 |

### 9.6 ComfyUI 作为超分后端

- **ComfyUI** (Comfy-Org/ComfyUI) 129k⭐，GPL-3.0：用 `UpscaleModelLoader`（RealESRGAN_x4plus 等）+ UltimateSDUpscale 搭建工作流，暴露 HTTP API（`/prompt`），可当独立超分服务，适合已有 GPU 机器。

### 9.7 与本平台集成：三种落地路径（推荐）

1. **最快 / 免费 / 无 Python 依赖**：直接用 **Real-ESRGAN 官方 `realesrgan-ncnn-vulkan` 可执行文件**
   - Node 端 `child_process` 调用，Linux 服务器无 GPU 也能 CPU 跑，macOS/Windows 可 GPU 加速；输出 4x PNG → sharp 后处理 → 上传 S3。
2. **纯 JS / 零外部依赖**：**UpscalerJS**（npm `upscaler` + `@tensorflow/tfjs-node`）
   - 直接写进你们 Next.js 后端，一行服务端代码即可，画质为 ESRGAN 系（中等偏上）。
3. **画质优先**：**Python FastAPI 微服务 + Real-ESRGAN（PyTorch）**，或 **ComfyUI** 工作流；人像图再叠加 GFPGAN/CodeFormer；终极画质上 SUPIR（需大显存）。

> 托管 API 兜底（不部署）：Replicate / fal.ai 上的 Real-ESRGAN、FLUX upscale 等，按量付费，省运维，适合量小期过渡。

### 9.8 结论

- **日常高清放大推荐 `realesrgan-ncnn-vulkan`（0 元，接入最简单）**，画质足够；二次元/插画场景用 **Real-CUGAN**；人像多则叠加 **GFPGAN/CodeFormer**。
- 如果不想引入二进制/Python，用 **UpscalerJS** 纯 JS 方案最契合当前 Next.js 技术栈。
- 需要"创意性增强"（细节重绘式放大）时，再付费走 通义万相（0.14 元/张）或 即梦智能超清（0.4 元/张）。

---

## 十、本机可行性评估（MacBook Air · Apple M3 · 16GB 统一内存 · macOS 15.5）

### 机器环境
- 芯片：Apple M3（8 核 CPU：4P+4E / 10 核 GPU），Metal 3
- 内存：16GB 统一内存（**主要瓶颈**）
- 磁盘：约 900GB，充足
- 开发环境：Node v24 + pnpm 11 ✓；Python 3.9.6（系统旧版）；**未装 Homebrew**
- 注意：MacBook Air **无风扇**，长时间高负载（扩散模型）会降频

### 方案可行性对照

| 方案 | 本机可行性 | 说明 |
|---|---|---|
| **UpscalerJS（Node 纯 JS）** | ✅ 推荐 | Node 24 直接跑（CPU），零外部依赖、零 Python；ESRGAN 系画质中等偏上；最契合 Next.js |
| **Real-ESRGAN（PyTorch MPS）** | ✅ 推荐 | M3 GPU 加速，画质最好；需建 Python venv（系统 3.9 可装 torch 2.x MPS）|
| **waifu2x-ncnn-vulkan** | ✅ 推荐（动漫） | 官方 release 有 macOS 包且支持 Apple Silicon GPU，MIT 协议 |
| **Real-CUGAN** | ✅ 可用（动漫/插画） | ncnn/PyTorch 均可跑，注意仓库无明确 LICENSE |
| **GFPGAN / CodeFormer** | ✅ 可用（人像） | MPS 可跑 16GB 够用；**CodeFormer 为 S-Lab 自定义协议，商用需注意** |
| **ComfyUI（轻量超分工作流）** | ✅ 可用 | M3 16GB 可跑 RealESRGAN/UltimateSDUpscale；重型 SDXL/FLUX 会慢+发热降频 |
| **realesrgan-ncnn-vulkan 二进制** | ⚠️ 一般 | 官方 macOS 包是 2022 Intel 版，Apple Silicon 需 Rosetta/MoltenVK，不如直接走 PyTorch MPS |
| **Final2x / Upscayl（GUI/CLI）** | ⚠️ 可用 | 原生 Mac 版可跑；Upscayl 为 **AGPL-3.0**（商用注意）；适合手动/半自动，不适合做服务端 API |
| **StableSR / DiffBIR** | ⚠️ 勉强 | 扩散模型吃显存，16GB 统一内存下很慢/易 OOM，不建议生产 |
| **SUPIR** | ❌ 不建议 | 需 ~24GB VRAM，16GB 统一内存会 OOM/极慢，且无风扇散热扛不住 |

### 结论（针对本机）
1. **首选「UpscalerJS」纯 JS 路线**：今天就能在 Next.js 里跑通，无 Python/无二进制/无 Homebrew 依赖，License 是 MIT，商用安全。
2. **画质优先「Real-ESRGAN + PyTorch MPS」**：M3 GPU 加速效果最好，需要建一个 Python venv（torch 2.x 支持 macOS MPS；系统 Python 3.9 够用，建议另装 3.11+ 更稳）。
3. 人像多再叠加 GFPGAN/CodeFormer；动漫/插画场景用 Real-CUGAN 或 waifu2x-ncnn-vulkan。
4. 以后部署到 Linux 服务器：UpscalerJS 跨平台通用；Real-ESRGAN PyTorch 在服务器装 CUDA 版即可，代码不用改。

---

## 十一、Windows 兼容性评估（重要）

> 项目形态：Electron 桌面应用（环中AIStudio）+ Next.js standalone 打包；`electron-builder.yml` 为 **`npmRebuild:false / nodeGypRebuild:false`**，原生依赖一律走**预编译二进制**（与 `@img/sharp-win32-x64` 同模式）；Windows 目标为 **x64**（NSIS + portable），Mac 为 Apple Silicon。

### 各方案 Windows 兼容性对照

| 方案 | Windows x64 | macOS(Apple Silicon) | 打包/依赖 | 协议 | 结论 |
|---|---|---|---|---|---|
| **UpscalerJS（Node/浏览器双端）** | ✅ | ✅ | 纯 JS；Node 端用 `@tensorflow/tfjs-node` 预编译二进制（与 sharp 同模式）；或**渲染进程 WebGL 跑（零原生依赖）** | MIT | 🏆 全平台一致，首选 |
| **realesrgan-ncnn-vulkan 二进制** | ✅ 官方 Win 包 | ⚠️ 官方 macOS 包是 2022 Intel 版（需 Rosetta） | 随包 extraResources 分发；Windows 需 Vulkan（Win10/11 一般自带） | BSD-3 | 可作 Win/Linux 主力，Mac 不理想 |
| **waifu2x-ncnn-vulkan 二进制** | ✅ | ✅ 官方支持 Apple Silicon | 同上，随包分发 | MIT | 动漫方向跨平台最好 |
| **Real-CUGAN** | ✅ | ✅（ncnn/PyTorch） | 同上；License 不明确 | - | 动漫/插画可用 |
| **Real-ESRGAN（PyTorch MPS/CUDA）** | ⚠️ 可行 | ✅ MPS | ❌ 需随包带 Python+torch（数 GB），不建议打进 Electron | BSD-3 | 更适合云端服务器 |
| **ComfyUI** | ✅ | ✅ | ❌ 体积大、依赖 Python，不建议打进桌面包 | GPL-3.0 | 云端/独立服务用 |
| **SUPIR / StableSR / DiffBIR** | ❌/⚠️ | ❌ | 显存/体积都不现实 | 各自 | 仅云端 GPU 服务器 |
| **Upscayl / Final2x（GUI/CLI）** | ✅ | ✅ | 需外挂应用，不适合做服务端 API；Upscayl 为 AGPL-3.0 | ⚠️ | 手动工具用 |

### Windows 兼容结论
1. **首选 UpscalerJS**：同一套代码 Win/Mac/Linux 一致；两条执行路径都成立——
   - **渲染进程 WebGL 跑**（Electron 双平台自带 WebGL，零原生依赖、GPU 加速，最省事）；
   - **Node 服务端跑**（`@tensorflow/tfjs-node` 预编译 .node，与你们 sharp 的处理方式完全一致，Windows x64 / macOS arm64 都有预编译包）。
2. **二进制方案（realesrgan/waifu2x ncnn-vulkan）**：Windows x64 官方包直接可用，用 `electron-builder extraResources` 随包分发（和 `.next/standalone` 同思路）；但 **Mac(Apple Silicon) 端 realesrgan 官方包是 Intel 版**，跨平台体验不一致。
3. **Python 系方案（Real-ESRGAN PyTorch / ComfyUI / SUPIR）一律不建议打进桌面包**（体积数 GB、各平台 runtime 维护成本高）；如需要顶级画质，作为**云端 GPU 服务**单独部署。
4. 若不想维护任何本地推理：**云 API（通义万相 0.14 元/张、即梦 0.4 元/张）天然跨平台**，可作为桌面版默认 + 本地推理可选的架构。

---

## 十二、写实照片 / 人像专项选型（补充）

> 平台定位是「写实照片 + 人像」，通用超分对人像脸部细节提升有限。标准做法是**全图超分 + 人脸专项修复**两层。

### 全图超分（写实照片）
| 方案 | Star | 特点 |
|---|---|---|
| **Real-ESRGAN（`realesr-general-x4v3` 模型）** | 36.5k | 真实照片专用模型，保真放大首选，BSD-3 |
| **HAT**（XPixelGroup/HAT） | 1.6k | CVPR2023 Transformer 超分，细节纹理好，比 ESRGAN 重 |
| SUPIR | 5.6k | 扩散式超分，写实照片质感最强，需 24GB 显存（云端） |
| 通义万相 2.1 超分（云 API） | - | 0.14 元/张，生成式增强，写实人像细节好 |

### 人像 / 脸部专项修复（关键层）
| 方案 | Star | 特点 |
|---|---|---|
| **GFPGAN**（TencentARC） | 37.7k | 通用人脸修复 + 超分，老照片/模糊人像经典方案 |
| **CodeFormer**（sczhou） | 18.1k | 人脸修复画质/可控性最好（w 参数 0~1），业界标准；⚠️ S-Lab 自定义协议，商用需确认 |
| 组合管线 | - | 业界标准：**Real-ESRGAN 全图放大 → GFPGAN/CodeFormer 修脸**（老照片修复即此流程） |

> ⚠️ GFPGAN / CodeFormer 均为 PyTorch 项目：**Win/Mac 能跑（MPS/CUDA），但把 Python+torch 打进 Electron 桌面包不现实（数 GB）** → 适合作为**云端 GPU 服务**或**独立部署**，桌面端通过 API 调用。

### 对本项目（写实人像 + Win/Mac 桌面）的最终建议
1. **本地免费兜底**：UpscalerJS（全平台一致、MIT）做通用 4x 放大——写实照片可用，但**人像脸部增强有限**。
2. **写实/人像主打（云端）**：部署一个 **Real-ESRGAN + GFPGAN/CodeFormer** 的 Python 服务（FastAPI，单接口返回放大+修脸结果）；桌面端/服务器统一 HTTP 调用，天然跨 Win/Mac。
3. **省事档（云 API）**：通义万相 2.1 超分（0.14 元/张）做全图增强；人像脸部如需专门修复，可接阿里云/百度/腾讯的人像修复类公有云 API（按次计费、跨平台）。
4. **体验分级**：工具栏做「保真放大（本地 UpscalerJS / 云端 Real-ESRGAN）」与「人像增强（云端 GFPGAN/CodeFormer）」两档，用户按需选。

---

## 十三、4K 输出能力与落地要点（补充）

> 需求：写实照片/人像放大到 4K。建议定义：**输出长边 4096px（≈4K），保持原图宽高比**（16:9 则 3840×2160，方形则 4096×4096）。

### 各方案 4K 能力对照

| 方案 | 4K 能力 | 计算方式 | 备注 |
|---|---|---|---|
| **Real-ESRGAN x4** | ✅ | 输出 = 输入×4（1024²→4096²，1920×1080→7680×4320） | 输入 ≥1024 即可到 4K；输入很大时用 x2 或先缩图避免超 8K |
| **即梦智能超清（云 API）** | ✅ 原生 4K/8K | `resolution: "4k"/"8k"` | 输入 ≤4096×4096；0.4 元/张 |
| **通义万相 2.1 超分（云 API）** | ✅ | 超分 1~4 倍 | 0.14 元/张，免费 500 张 |
| **GFPGAN / CodeFormer** | ⚠️ 间接 | 只修脸块（512/1024），需贴回 4K 全图 | 与 Real-ESRGAN 组合：放大到 4K 后把修好的脸替换回去 |
| **UpscalerJS（本地）** | ⚠️ 可达但慢 | x2/x3/x4 模型 | CPU 跑 4K（4096²）约数分钟~十几分钟，内存峰值高；适合小图或 ≤2K→4K |
| **realesrgan-ncnn-vulkan（Win GPU）** | ✅ 快 | 4x GPU 加速 | 4K 输出秒级~十几秒 |
| **SUPIR（云端 GPU）** | ✅ | 4x 扩散 | 需 24GB VRAM |

### 本机（M3 16GB）跑 4K 的注意点
- **Real-ESRGAN x4（PyTorch MPS）**：4096² 输出峰值内存约 2~4GB，16GB 统一内存够用，速度 GPU 加速可接受 → 本地 4K 主力。
- **realesrgan-ncnn-vulkan（Windows）**：GPU 4x 到 4K 快；Mac(Apple Silicon) 官方包是 Intel 版需 Rosetta → Win 端用二进制、Mac 端用 PyTorch MPS。
- **UpscalerJS（CPU）**：**不建议直接 x4 到 4096²**（慢+内存峰值高）；可 x2 到 4K（2048²→4096²）或做分块。
- **云端 API**：4K 无性能压力，跨 Win/Mac 一致。

### 4K 落地建议（管线）
1. 读取输入图尺寸 → 计算到 4K（长边 4096）所需倍数（1~4x，超 4 倍先分两次或直接云 API）。
2. 本地免费档：≤2048² 用 UpscalerJS x2 到 4K；写实/人像质量优先用云端 Real-ESRGAN+GFPGAN 服务。
3. 人像：全图到 4K 后，人脸区域用 GFPGAN/CodeFormer 增强并贴回（保持 4K 画质）。
4. 输出统一 `sharp` 收尾（格式 JPEG/WebP、质量参数）→ 上传 S3 → 更新 image_record。

---

## 十四、速度优先选型（4K 快速出图，补充）

> 需求补充：要快。CPU 方案（UpscalerJS 跑 4K 需数分钟）排除，4K 必须 GPU/云。

### 速度对比（4K 输出，近似量级）
| 方案 | 速度（4K） | 平台 | 说明 |
|---|---|---|---|
| **realesrgan-ncnn-vulkan（GPU）** | ⚡ 秒级（2~15s） | Win/Linux 官方二进制；Mac 需 Rosetta 或社区 Apple Silicon 构建 | 通用显卡（NVIDIA/AMD/Intel）Vulkan 都能加速，**免费最快** |
| **Real-ESRGAN（PyTorch MPS）** | ⚡ 秒级~十几秒 | Mac(Apple Silicon) 原生 GPU | Mac 端最快最稳 |
| **Real-ESRGAN（CUDA）** | ⚡ 秒级 | 云端 Linux + NVIDIA | 服务器方案 |
| **云 API（通义万相 / 即梦）** | 10~60s+网络 | 跨平台 | 速度受排队/网络影响，胜在零部署 |
| **UpscalerJS（CPU）** | ❌ 数分钟~十几分钟 | 全平台 | 只适合小图/预览，4K 不推荐 |
| **FSRCNN/ESPCN（OpenCV）** | ⚡ 实时（1~2s） | 全平台 | 画质一般，可做"极速预览"档 |

### 快速落地结论
1. **Windows 桌面：`realesrgan-ncnn-vulkan` 二进制**（Vulkan GPU 加速，4K 秒级；Win10/11 显卡驱动自带 Vulkan）。
2. **Mac 桌面（M3）：Real-ESRGAN PyTorch MPS**（原生 GPU，4K 秒级~十几秒；需一个 Python venv）。
3. **架构统一**：前端「高清放大」→ Next.js `/api/image-process` → 平台分派：
   - Windows → 调 ncnn-vulkan 二进制（child_process）；
   - macOS → 调本地 Python MPS 服务（或同一二进制走 Rosetta，兜底）；
   - 未来服务器 → CUDA 版 Real-ESRGAN，接口不变。
4. **可选极速预览档**：OpenCV FSRCNN（1~2s 出 4K，画质一般）给用户"先看轮廓"，再后台跑 Real-ESRGAN 出正式 4K。
5. **不要用 UpscalerJS 跑 4K**（CPU 太慢），仅作为无 GPU 环境兜底。
