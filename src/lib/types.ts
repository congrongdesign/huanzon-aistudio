export interface User {
  id: string;
  email: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
}

export interface Project {
  id: string;
  name: string;
  is_pinned: boolean;
  sort_order: number;
  folder_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ImageFilterSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
  hue: number;
  grayscale: number;
  sepia: number;
  sharpen: number;
  blur: number;
}

export interface CanvasImage {
  id: string;
  project_id: string | null;
  prompt: string;
  image_url: string;
  image_key: string | null;
  reference_images: string | null;
  canvas_block_id?: string | null;
  block_order?: number;
  canvas_x: number;
  canvas_y: number;
  canvas_width: number;
  canvas_height: number;
  size: string;
  model: string;
  status: string;
  is_favorite: boolean;
  created_at: string;
  updated_at: string | null;
  is_reference?: boolean;
  isGenerating?: boolean;
  isUploading?: boolean;
  generateStartTime?: number; // timestamp when generation started
  deleted_at?: string | null;
  filters?: Partial<ImageFilterSettings>;
}

export interface CanvasBlock {
  id: string;
  project_id: string | null;
  name: string;
  color: string;
  canvas_x: number;
  canvas_y: number;
  canvas_width: number;
  canvas_height: number;
  image_scale?: number;
  sort_mode: "compact" | "time_desc" | "time_asc" | "batch";
  padding: number;
  locked: boolean;
  created_at: string;
  updated_at: string | null;
}

export type DesignAssetKind =
  | "image"
  | "mask"
  | "layer"
  | "reference"
  | "export"
  | "ppt_page";

export type DesignLayerType =
  | "image"
  | "background"
  | "subject"
  | "text"
  | "decor"
  | "mask"
  | "reference";

export type DesignOperationKind =
  | "generate"
  | "edit_mask"
  | "edit_instruction"
  | "outpaint"
  | "remove_bg"
  | "upscale"
  | "relight"
  | "text_render"
  | "restore_version";

export type DesignOperationStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface DesignAsset {
  id: string;
  project_id: string | null;
  user_id?: string | null;
  kind: DesignAssetKind;
  url: string;
  key: string | null;
  width: number;
  height: number;
  mime_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string | null;
}

export interface DesignLayer {
  id: string;
  document_id: string | null;
  project_id: string | null;
  user_id?: string | null;
  asset_id: string | null;
  type: DesignLayerType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  z_index: number;
  props: Record<string, unknown>;
  created_at: string;
  updated_at: string | null;
}

export interface AssetVersion {
  id: string;
  asset_id: string;
  parent_asset_id: string | null;
  operation_id: string | null;
  user_id?: string | null;
  version_index: number;
  label: string;
  url: string;
  key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type AssetIndexSourceType = "design_asset" | "image_record";

export type AssetIndexMode = "full" | "project" | "ids";

export type AssetIndexJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface AssetIndexEntry {
  id: string;
  user_id?: string | null;
  project_id: string | null;
  source_type: AssetIndexSourceType;
  source_id: string;
  kind: DesignAssetKind | "image_record";
  url: string;
  key: string | null;
  width: number;
  height: number;
  prompt: string;
  model: string;
  size: string;
  tags: string[];
  caption: string;
  ocr_text: string;
  dominant_color: string | null;
  keywords: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string | null;
}

export interface AssetIndexJob {
  id: string;
  user_id?: string | null;
  project_id: string | null;
  mode: AssetIndexMode;
  status: AssetIndexJobStatus;
  source_count: number;
  indexed_count: number;
  failed_count: number;
  params: Record<string, unknown>;
  stats: Record<string, unknown>;
  error: string | null;
  error_code: string | null;
  retryable: boolean | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface DesignOperation {
  id: string;
  document_id: string | null;
  project_id: string | null;
  user_id?: string | null;
  input_asset_ids: string[];
  output_asset_ids: string[];
  kind: DesignOperationKind;
  prompt: string;
  mask_asset_id: string | null;
  provider: string;
  model: string;
  params: Record<string, unknown>;
  status: DesignOperationStatus;
  error: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

export interface ChatMessage {
  id: string;
  project_id: string | null;
  role: "user" | "assistant";
  content: string;
  reference_image_urls: string | null;
  image_url?: string | null;  // Generated image URL (for assistant messages with generated images)
  created_at: string;
}

export interface SocialMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  type: 'text' | 'image' | 'prompt' | 'skill' | 'project' | 'emoji';
  attachment_url?: string;
  attachment_data?: Record<string, unknown>;
  created_at: string;
}

export interface ModelOption {
  value: string;
  label: string;
  group: string;
}

export interface ChatModelOption {
  value: string;
  label: string;
  group: string;
  description?: string;
}

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  { value: "gpt-5.4", label: "gpt-5.4", group: "OpenAI", description: "更强推理与生成，适合复杂任务" },
  { value: "gpt-5.5", label: "gpt-5.5", group: "OpenAI", description: "更新一代通用模型，适合更复杂对话与生成" },
  { value: "gpt-4o", label: "GPT-4o", group: "OpenAI", description: "多模态旗舰模型，理解+生成" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini", group: "OpenAI", description: "高性能低成本，快速响应" },
  { value: "gpt-4.1", label: "GPT-4.1", group: "OpenAI", description: "最新旗舰，复杂指令遵循" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 Mini", group: "OpenAI", description: "均衡型，兼顾性能与成本" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano", group: "OpenAI", description: "超低时延，高并发" },
  { value: "o3-mini", label: "o3 Mini", group: "OpenAI", description: "推理优化模型" },
  { value: "o4-mini", label: "o4 Mini", group: "OpenAI", description: "最新推理模型" },
  { value: "gemini-3.1-pro", label: "Gemini 3.1 Pro", group: "Gemini", description: "最新Gemini推理模型" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", group: "Gemini", description: "轻量快速，适合高频交互" },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", group: "Gemini", description: "速度优先，响应更快" },
  { value: "gemini-3-flash", label: "Gemini 3 Flash", group: "Gemini", description: "通用快速模型" },
  { value: "gemini-3-pro", label: "Gemini 3 Pro", group: "Gemini", description: "更强推理和文本生成能力" },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", group: "Gemini", description: "更轻量更快，适合高频调用" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", group: "Gemini", description: "Google旗舰，超长上下文" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", group: "Gemini", description: "快速响应，高性价比" },
  { value: "deepseek-chat", label: "DeepSeek Chat", group: "DeepSeek", description: "平衡推理与输出，适合日常" },
  { value: "deepseek-reasoner", label: "DeepSeek Reasoner", group: "DeepSeek", description: "深度推理，复杂问题" },
  { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4", group: "Claude", description: "Anthropic旗舰模型" },
  { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", group: "Claude", description: "快速响应，高性价比" },
  { value: "doubao-seed-2-0-pro-260215", label: "Doubao Seed 2.0 Pro", group: "Doubao", description: "旗舰级全能模型，复杂推理与长上下文" },
  { value: "doubao-seed-2-0-lite-260215", label: "Doubao Seed 2.0 Lite", group: "Doubao", description: "均衡型模型，兼顾性能与成本" },
  { value: "doubao-seed-2-0-mini-260215", label: "Doubao Seed 2.0 Mini", group: "Doubao", description: "低时延高并发，快速响应" },
  { value: "deepseek-v3-2-251201", label: "DeepSeek V3", group: "DeepSeek", description: "平衡推理能力与输出长度，适合日常使用" },
  { value: "kimi-k2-5-260127", label: "Kimi K2.5", group: "Kimi", description: "原生多模态架构，Agent/代码/视觉理解" },
  { value: "glm-5-0-260211", label: "GLM-5", group: "GLM", description: "智谱旗舰，Agentic Engineering" },
  { value: "glm-4-7-251222", label: "GLM-4.7", group: "GLM", description: "更强编程与多步推理" },
  { value: "qwen-3-5-plus-260215", label: "Qwen 3.5 Plus", group: "Qwen", description: "混合架构，高推理效率" },
];

export const MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-image-2", label: "GPT Image 2", group: "ChatGPT" },
  { value: "gpt-image-2-vip", label: "GPT Image 2 VIP", group: "ChatGPT" },
  { value: "nano-banana", label: "Nano Banana", group: "Nano Banana" },
  { value: "nano-banana-fast", label: "Nano Banana Fast", group: "Nano Banana" },
  { value: "nano-banana-2", label: "Nano Banana 2", group: "Nano Banana" },
  { value: "nano-banana-2-cl", label: "Nano Banana 2 CL", group: "Nano Banana" },
  { value: "nano-banana-2-4k-cl", label: "Nano Banana 2 4K CL", group: "Nano Banana" },
  { value: "nano-banana-pro", label: "Nano Banana Pro", group: "Nano Banana" },
  { value: "nano-banana-pro-cl", label: "Nano Banana Pro CL", group: "Nano Banana" },
  { value: "nano-banana-pro-vip", label: "Nano Banana Pro VIP", group: "Nano Banana" },
  { value: "nano-banana-pro-4k-vip", label: "Nano Banana Pro 4K VIP", group: "Nano Banana" },
];

export interface ReferenceImage {
  id: string;
  project_id: string | null;
  image_url: string;
  image_key: string | null;
  file_name: string | null;
  created_at: string;
}

export const ASPECT_RATIOS = [
  "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9",
];

export const ASPECT_RATIOS_EXTENDED = [
  ...ASPECT_RATIOS,
  "1:4", "4:1", "1:8", "8:1",
];

export const VIP_PIXEL_SIZES = [
  { value: "1024x1024", label: "1K · 1:1 (1024×1024)" },
  { value: "2048x2048", label: "2K · 1:1 (2048×2048)" },
  { value: "2880x2880", label: "4K · 1:1 (2880×2880)" },
  { value: "1280x720", label: "1K · 16:9 (1280×720)" },
  { value: "2048x1152", label: "2K · 16:9 (2048×1152)" },
  { value: "3840x2160", label: "4K · 16:9 (3840×2160)" },
  { value: "720x1280", label: "1K · 9:16 (720×1280)" },
  { value: "1152x2048", label: "2K · 9:16 (1152×2048)" },
  { value: "2160x3840", label: "4K · 9:16 (2160×3840)" },
  { value: "1152x864", label: "1K · 4:3 (1152×864)" },
  { value: "2304x1728", label: "2K · 4:3 (2304×1728)" },
  { value: "3264x2448", label: "4K · 4:3 (3264×2448)" },
  { value: "864x1152", label: "1K · 3:4 (864×1152)" },
  { value: "1728x2304", label: "2K · 3:4 (1728×2304)" },
  { value: "2448x3264", label: "4K · 3:4 (2448×3264)" },
  { value: "1536x1024", label: "1K · 3:2 (1536×1024)" },
  { value: "2048x1360", label: "2K · 3:2 (2048×1360)" },
  { value: "3504x2336", label: "4K · 3:2 (3504×2336)" },
  { value: "1024x1536", label: "1K · 2:3 (1024×1536)" },
  { value: "1360x2048", label: "2K · 2:3 (1360×2048)" },
  { value: "2336x3504", label: "4K · 2:3 (2336×3504)" },
  { value: "1120x896", label: "1K · 5:4 (1120×896)" },
  { value: "2240x1792", label: "2K · 5:4 (2240×1792)" },
  { value: "3200x2560", label: "4K · 5:4 (3200×2560)" },
  { value: "896x1120", label: "1K · 4:5 (896×1120)" },
  { value: "1792x2240", label: "2K · 4:5 (1792×2240)" },
  { value: "2560x3200", label: "4K · 4:5 (2560×3200)" },
  { value: "1456x624", label: "1K · 21:9 (1456×624)" },
  { value: "2912x1248", label: "2K · 21:9 (2912×1248)" },
  { value: "3840x1648", label: "4K · 21:9 (3840×1648)" },
  { value: "624x1456", label: "1K · 9:21 (624×1456)" },
  { value: "1248x2912", label: "2K · 9:21 (1248×2912)" },
  { value: "1648x3840", label: "4K · 9:21 (1648×3840)" },
  { value: "688x2048", label: "1K · 1:3 (688×2048)" },
  { value: "1280x3840", label: "4K · 1:3 (1280×3840)" },
  { value: "2048x688", label: "1K · 3:1 (2048×688)" },
  { value: "3840x1280", label: "4K · 3:1 (3840×1280)" },
  { value: "1536x768", label: "1K · 2:1 (1536×768)" },
  { value: "3072x1536", label: "2K · 2:1 (3072×1536)" },
  { value: "3840x1920", label: "4K · 2:1 (3840×1920)" },
  { value: "768x1536", label: "1K · 1:2 (768×1536)" },
  { value: "1536x3072", label: "2K · 1:2 (1536×3072)" },
  { value: "1920x3840", label: "4K · 1:2 (1920×3840)" },
];

export const IMAGE_SIZES = ["1K", "2K", "4K"];

export const STYLE_PRESETS = [
  { value: "", label: "无风格" },
  { value: "cyberpunk", label: "赛博朋克", suffix: ", cyberpunk neon aesthetic, futuristic" },
  { value: "watercolor", label: "水彩画", suffix: ", watercolor painting style, soft translucent colors" },
  { value: "anime", label: "日本动漫", suffix: ", Japanese anime style, vibrant colors, detailed illustration" },
  { value: "oil-painting", label: "油画", suffix: ", oil painting style, rich textures, classical composition" },
  { value: "minimalist", label: "极简主义", suffix: ", minimalist design, clean lines, simple composition" },
  { value: "fantasy", label: "奇幻", suffix: ", fantasy art style, magical atmosphere, epic composition" },
  { value: "pixel-art", label: "像素艺术", suffix: ", pixel art style, retro game aesthetic" },
  { value: "photography", label: "摄影级", suffix: ", professional photography, hyperrealistic, 8k sharp details" },
];
