# 模型广场与多服务商适配评估报告

日期：2026-06-18

## 1. 结论

可以实现“所有模型都显示出来”，也可以逐步实现“非 OpenAI 兼容接口也能调用”。但这两个目标不能混在一起做。

推荐方向是把当前模型中心升级成三层：

1. **模型/能力目录层**：尽可能展示服务商暴露出来的全部模型、工具、能力、接口。
2. **能力识别层**：判断每个条目是对话、生图、图生图、视频、语音、分层、去背、PDF 转 PPT，还是未知能力。
3. **调用适配层**：只有具备适配器的能力，才允许进入画板下拉或工具按钮实际调用。

这样既能满足“都能显示出来”，也能避免用户点了一个看起来像模型、但实际调用格式不匹配的条目后生成失败。

## 2. 当前状态

当前代码里已经具备一部分基础能力：

- 服务商配置保存在本机 `localStorage`，核心逻辑在 `src/app/page.tsx`。
- `/api/models` 支持 OpenAI 兼容的模型列表探测，也对 Codia 做了专门处理。
- `/api/provider-balance` 已经支持 Codia 的 `/v2/open/credits`。
- 生图主链路在 `src/lib/generate-core.ts`，目前支持：
  - GRSAI 风格的 `/v1/api/generate`
  - OpenAI 兼容的 `/v1/images/generations` 和 `/v1/images/edits`
  - Codia 的 `/v2/open/image/generate_image`
- 模型广场已经有筛选、分类、启用、能力绑定、表格列配置等基础结构。

当前问题是：

- `检测模型：9` 说明已经检测到 Codia 模型。
- `当前筛选：0` 说明前端筛选条件把模型全部过滤掉了。
- Codia 目前只返回 9 个 `generate_image` 官方生图模型，没有把 Codia 的所有工具能力都作为条目展示。

## 3. 为什么 Codia 当前只有 9 个

Codia 官方 OpenAPI 里有很多接口、Schema 和工具能力，但不是所有内容都等同于“可放到生图模型下拉里的模型”。

Codia 的 `/v2/open/image/generate_image` 文档明确列出的 text-to-image / image-to-image 模型是：

- `nano_banana_2`
- `nano_banana_pro`
- `gpt_image`
- `seedream_5`
- `seedream_4_5`
- `recraft_v4`
- `flux_2_pro`
- `flux_2_max`
- `ideogram_v3`

另有 `codia_image_v2`，更适合归到图像工具能力，比如高清、去背、分层、擦除、水印移除，而不是普通画板生图模型。

所以当前接入是保守做法：只把明确支持 `generate_image` 的模型作为生图模型。

## 4. 用户目标拆解

你的目标可以拆成四个需求：

1. **所有模型都能显示**：模型广场不只显示 OpenAI 兼容 `/v1/models`，也展示 Codia、即梦、阿里千问、视频、语音、工具接口等能力。
2. **能调用的模型进入画板下拉**：已适配的模型可以勾选激活，进入对话、生图、图像工具、视频等对应入口。
3. **不能调用的也能看见**：暂时没有适配器的模型可以展示，但标记为“待接入”或“仅展示”。
4. **后续账号同步**：当前保存在本机的服务商、常用模型、能力绑定，未来要能同步到账号。

这四个需求都合理，但要分阶段做。

## 5. 关键风险

### 5.1 模型列表不等于可调用模型

OpenAI 兼容服务商通常可以用 `/v1/models` 获取模型列表。但 Codia 这种原生 API 不一定有模型列表接口，很多模型是写在 OpenAPI 文档、`limits`、`pricing` 或具体接口参数里。

风险：如果把文档里的 Schema、Task operation、工具名都当模型，会出现“列表很多，但点了不能生成”的问题。

建议：模型广场应引入 `entryType`：

- `model`
- `operation`
- `tool`
- `schema`
- `unknown`

### 5.2 能力分类会天然不准

模型名可以推断一部分能力，比如 `gpt-image`、`flux`、`veo`、`tts`。但很多模型名没有稳定规则。

风险：误把文本模型放进生图，把视频模型放进对话，把图像工具放进生图。

建议：分类来源分优先级：

1. 服务商官方元数据
2. 适配器内置规则
3. 用户手动修正
4. 模型名猜测
5. 未知

UI 上要显示分类来源和置信度。

### 5.3 调用协议差异很大

同样是“生图”，不同服务商可能完全不同：

- OpenAI 兼容：`POST /v1/images/generations`
- GRSAI：`POST /v1/api/generate` 加轮询
- Codia：`POST /v2/open/image/generate_image`
- 阿里 DashScope：通常是 DashScope 自己的 task / generation 接口
- 即梦 / 火山：通常是火山引擎风格的签名、任务、轮询或特定 JSON

风险：只保存 `baseUrl + apiKey + model` 不够，必须知道该模型走哪个 adapter、哪个 operation、参数怎么映射。

建议：引入 Adapter Registry。

### 5.4 异步任务和进度不一致

图片、视频、PPT、分层等能力经常是异步任务。不同服务商返回的状态字段、进度字段、结果字段都不同。

风险：画布加载框卡住、95% 不动、任务失败原因不清晰。

建议：所有适配器统一返回平台内部状态：

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`

并统一输出：

- `progress`
- `message`
- `retryable`
- `rawStatus`
- `providerError`

### 5.5 余额和费用风险

Codia 有统一 credits。其他中转站也可能有余额、分组倍率、模型单价。视频模型和高清模型可能成本明显高于普通生图。

风险：用户误点高成本模型，或者余额不足时任务中途失败。

建议：

- 每个服务商保留余额查询适配器。
- 能预估费用的操作先显示预估费用。
- 高成本能力默认需要确认，或者至少显示成本提示。

### 5.6 参考图限制不统一

不同模型对参考图数量、格式、大小、公网 URL、base64 的支持不同。

风险：同一个参考图链路在 A 模型可用，在 B 模型失败。

建议：能力条目里保存 `inputConstraints`：

- `maxReferenceImages`
- `acceptedMimeTypes`
- `requiresPublicUrl`
- `supportsDataUrl`
- `maxImageBytes`
- `maxResolution`

### 5.7 维护成本

接入越多原生服务商，后续维护成本越高。

风险：模型名、接口字段、计费、错误码更新后，旧适配器失效。

建议：

- 优先接 OpenAI 兼容中转站。
- 原生 API 只接高价值能力。
- 每个原生服务商有独立 adapter 文件和诊断页面。

## 6. 推荐架构

### 6.1 服务商 Provider

服务商配置不只保存 `baseUrl` 和 `apiKey`，还应保存：

```ts
type ProviderProfile = {
  id: string;
  name: string;
  type: "openai-compatible" | "grsai" | "yunwu" | "codia" | "dashscope" | "volcengine" | "custom";
  baseUrl: string;
  apiKeyLocal: string;
  enabled: boolean;
  capabilities: string[];
  lastDetectedAt?: string;
};
```

### 6.2 目录条目 CatalogItem

模型广场展示的不是单纯模型，而是目录条目：

```ts
type CatalogItem = {
  id: string;
  providerId: string;
  entryType: "model" | "operation" | "tool" | "schema" | "unknown";
  capability: "chat" | "image" | "image-edit" | "video" | "speech" | "embedding" | "rerank" | "conversion" | "unknown";
  displayName: string;
  modelId?: string;
  operationId?: string;
  endpoint?: string;
  adapterId?: string;
  callable: boolean;
  callableReason?: string;
  categorySource: "official" | "adapter" | "manual" | "name-rule" | "unknown";
  confidence: "high" | "medium" | "low";
  inputConstraints?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  raw?: unknown;
};
```

### 6.3 Adapter Registry

每个服务商适配器负责三件事：

1. `detectCatalog()`：检测模型和能力。
2. `checkBalance()`：查询余额。
3. `invoke()`：把平台内部请求转成服务商请求。

建议结构：

```ts
type ProviderAdapter = {
  id: string;
  label: string;
  detectCatalog(provider: ProviderProfile): Promise<CatalogItem[]>;
  checkBalance?(provider: ProviderProfile): Promise<BalanceResult>;
  invoke?(request: PlatformOperationRequest): Promise<PlatformOperationResult>;
};
```

当前可以先有这些 adapter：

- `openai-compatible`
- `grsai`
- `yunwu`
- `codia`
- `manual-catalog`

后续再加：

- `dashscope`
- `volcengine-jimeng`
- `kling`
- `vidu`
- `runway`

### 6.4 平台内部操作协议

画布不要直接关心服务商接口格式，而是只发平台内部请求：

```ts
type PlatformOperationRequest = {
  capability: "image" | "image-edit" | "video" | "chat" | "conversion";
  operation: "text-to-image" | "image-to-image" | "upscale" | "remove-bg" | "layering" | "text-to-video";
  providerId: string;
  adapterId: string;
  modelId?: string;
  prompt?: string;
  inputImages?: string[];
  size?: string;
  options?: Record<string, unknown>;
};
```

这样画布、生图、图像工具、视频工具都复用同一套路由。

## 7. UI 建议

### 7.1 模型广场默认显示全部

不要默认只显示“可调用模型”。默认应显示当前服务商检测到的所有条目。

推荐顶部状态：

- `全部`
- `可调用`
- `已激活`
- `待接入`
- `工具能力`
- `未知`

### 7.2 启用逻辑分层

勾选后不一定直接进入画板下拉：

- `callable=true`：勾选后进入对应能力下拉。
- `callable=false`：可收藏、可查看、可标记分类，但不能激活为生产调用。

UI 文案建议：

- `可调用`
- `待接入`
- `仅展示`
- `需配置`
- `余额不可用`

### 7.3 画板下拉只显示可调用项

画板生图下拉只显示：

- 能力为 `image`
- 操作为 `text-to-image` 或可兼容当前输入
- 有 adapter
- 已激活

图像工具只显示：

- `image-edit`
- `upscale`
- `remove-bg`
- `layering`
- `object-erase`

视频工具只显示：

- `video`
- `text-to-video`
- `image-to-video`

### 7.4 当前“筛选导致空列表”的处理

截图里 `检测模型 9 / 当前筛选 0`，说明筛选条件把结果清空。

建议立即优化：

- 检测新服务商成功后自动重置筛选。
- 当 `detected > 0` 且 `filtered = 0` 时，显示更明确的空状态。
- 在空状态里提供一键 `清除筛选`。
- 顶部清楚显示当前生效的筛选条件，包括供应商、分类、标签、分组、激活状态。

## 8. 分阶段实施建议

### 阶段 1：先修当前体验

目标：让用户看见检测到的模型，不再被筛选误导。

工作：

- 检测成功后自动重置模型广场筛选。
- Codia 的 9 个生图模型全部标记为 `image`。
- 把 `codia_image_v2` 作为图像工具能力展示。
- 空列表状态说明“被筛选过滤”而不是“暂无模型”。

风险低，改动小。

### 阶段 2：模型广场改成“全部目录”

目标：所有检测到的模型、工具、能力都展示。

工作：

- 增加 `entryType`、`callable`、`adapterId`、`operationId` 字段。
- Codia 展示 `generate_image`、`image_to_image`、`upscale`、`layering`、`remove_bg`、`pdf_to_ppt` 等能力。
- UI 增加 `可调用 / 待接入 / 工具能力 / 未知` 视图。

风险中等，主要是 UI 和数据结构变化。

### 阶段 3：Adapter Registry

目标：原生 API 不再硬塞进 `generate-core.ts`。

工作：

- 建立 `src/lib/providers/adapters/*`。
- 将 OpenAI、GRSAI、Codia 迁移成 adapter。
- 生图、图像工具、转换中心统一通过 adapter 调用。

风险中高，但这是长期正确方向。

### 阶段 4：接入更多原生服务商

目标：支持即梦、阿里千问、视频、语音等非 OpenAI 兼容能力。

优先级建议：

1. 阿里千问 / DashScope：文本、视觉、生图都常用。
2. 火山 / 即梦：图像和视频价值高。
3. Codia 图像工具全量：去背、分层、高清、擦除、水印移除。
4. 视频模型：可灵、Vidu、Runway、Veo 等。

风险高，建议一个服务商一个 PR 或一个迭代。

### 阶段 5：账号同步

目标：登录后多设备同步模型配置。

工作：

- 新增服务商表、模型目录缓存表、能力绑定表。
- API Key 不建议明文同步，至少需要加密存储或只本机保存。
- 同步常用模型、能力绑定、手动分类修正、表格列配置。

风险高，涉及账号、隐私和安全。

## 9. 推荐优先级

最建议先做：

1. 修筛选空列表和 Codia 分类问题。
2. 模型广场改成“全部显示”，但明确 `可调用 / 待接入`。
3. Codia 展示全部 OpenAPI 能力，不只展示 9 个生图模型。
4. 建立 adapter registry，把生图、图像工具、转换中心逐步统一。

暂时不建议马上做：

- 一次性接入所有原生服务商。
- 所有模型都直接进画布下拉。
- 未适配模型允许直接调用。
- API Key 立即云同步。

## 10. 最终建议

当前平台应该从“模型选择器”升级成“服务商能力中心”。

模型广场负责展示全部，画布下拉只负责展示可调用。这个边界非常关键。

短期改法可以很快：

- 先让所有检测结果可见。
- 不能调用的标记为待接入。
- 已有适配器的才能启用到画板。

长期改法应该走 adapter registry：

- 每个服务商独立检测、余额、调用、错误解析。
- 平台内部统一 operation 协议。
- UI 根据 `callable` 和 `capability` 自动决定能放到哪里。

这样后续接阿里千问、即梦、视频、语音、分层、转换工具时，不会继续把所有差异堆进一个生图函数里。

## 11. 参考

- Codia API 文档：https://codia.ai/zh-CN/api-reference
- Codia OpenAPI：`https://codia.ai/openapi.json`
- 当前模型检测入口：`src/app/api/models/route.ts`
- 当前余额检测入口：`src/app/api/provider-balance/route.ts`
- 当前生图核心：`src/lib/generate-core.ts`
- 当前模型中心 UI：`src/app/page.tsx`
