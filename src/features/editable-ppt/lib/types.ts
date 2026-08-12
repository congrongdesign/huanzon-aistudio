export type EditablePptSourceType = "pptx" | "pdf" | "image_zip" | "images";
export type EditablePptJobStatus =
  | "queued"
  | "preprocessing"
  | "ocr"
  | "layout"
  | "reconstructing"
  | "partial_ready"
  | "editable_ready"
  | "needs_review"
  | "ready"
  | "failed"
  | "cancelled";

export type EditablePptPageStatus = "queued" | "processing" | "ready" | "partial_ready" | "needs_review" | "failed";
export type EditablePptPageMode = "native" | "ocr" | "hybrid" | "raster_fallback";
export type EditablePptElementType =
  | "text"
  | "image"
  | "shape"
  | "icon"
  | "table"
  | "chart_or_complex"
  | "background";

export type EditablePptNodeType =
  | "group"
  | "text"
  | "image"
  | "shape"
  | "icon"
  | "table"
  | "chart"
  | "background"
  | "unknown";

export type EditablePptNodeRole =
  | "title"
  | "subtitle"
  | "body"
  | "caption"
  | "hero"
  | "card"
  | "media"
  | "decoration"
  | "background"
  | "unknown";

export type EditablePptExportMode = "editable" | "raster" | "ignored";
export type EditablePptFallbackStrategy = "editable" | "rasterize" | "manual_review";

export interface EditablePptConfig {
  parseMode: "fast" | "balanced" | "high_fidelity";
  languageHint: "auto" | "zh" | "en" | "multi";
  detectTables: boolean;
  detectIcons: boolean;
  rebuildShapes: boolean;
  exportStrategy: "hybrid" | "editable_first" | "fidelity_first";
}

export interface EditablePptJobRecord {
  id: string;
  user_id: string | null;
  project_id: string | null;
  name: string;
  source_type: EditablePptSourceType;
  source_name: string;
  source_key: string | null;
  source_url: string | null;
  page_count: number;
  parsed_count: number;
  failed_page_count: number;
  status: EditablePptJobStatus;
  progress: number;
  aspect_ratio_guess: string | null;
  cover_image_url: string | null;
  cover_image_key: string | null;
  warnings: string;
  config: string;
  summary: string;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
}

export interface EditablePptPageRecord {
  id: string;
  job_id: string;
  page_number: number;
  title: string;
  role: string;
  source_image_url: string;
  source_image_key: string | null;
  preview_image_url: string | null;
  preview_image_key: string | null;
  cleaned_background_url: string | null;
  cleaned_background_key: string | null;
  width: number;
  height: number;
  parse_status: EditablePptPageStatus;
  page_mode: EditablePptPageMode;
  parse_confidence: number;
  editable_score: number;
  text_recovery_score: number;
  layout_recovery_score: number;
  unknown_node_ratio: number;
  ocr_text: string;
  normalized_text: string;
  structure_json: string;
  metrics_json: string;
  warnings_json: string;
  ast: string;
  elements_count: number;
  manual_notes: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface EditablePptElementRecord {
  id: string;
  job_id: string;
  page_id: string;
  element_type: EditablePptElementType;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  z_index: number;
  rotation: number;
  opacity: number;
  group_id: string | null;
  parent_id: string | null;
  confidence: number;
  text_content: string | null;
  style_json: string;
  asset_url: string | null;
  asset_key: string | null;
  hidden: boolean;
  locked: boolean;
  source_ref: string | null;
  node_role: EditablePptNodeRole;
  export_mode: EditablePptExportMode;
  origin_stage: "native" | "ocr" | "region" | "fallback";
  created_at: string;
  updated_at: string | null;
}

export interface EditablePptExportRecord {
  id: string;
  job_id: string;
  user_id: string | null;
  export_type: "pptx";
  status: "queued" | "processing" | "ready" | "failed";
  page_range: string;
  file_url: string | null;
  file_key: string | null;
  file_size: number;
  warnings: string;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

export interface EditablePptStore {
  version: number;
  jobs: EditablePptJobRecord[];
  pages: EditablePptPageRecord[];
  elements: EditablePptElementRecord[];
  exports: EditablePptExportRecord[];
}

export interface EditablePptOcrLine {
  text: string;
  confidence: number;
  bbox: [number, number, number, number];
}

export interface EditablePptStructureMetrics {
  totalNodes: number;
  textNodes: number;
  imageNodes: number;
  shapeNodes: number;
  rasterNodes: number;
  lowConfidenceNodes: number;
  textLineCount: number;
  paragraphCount: number;
  groupedTextCount: number;
  averageTextConfidence: number;
  editableCoverage: number;
  editableScore: number;
  textRecoveryScore: number;
  layoutRecoveryScore: number;
  unknownNodeRatio: number;
}

export interface EditablePptStructureNode {
  id: string;
  type: EditablePptNodeType;
  role: EditablePptNodeRole;
  bbox: [number, number, number, number];
  zIndex: number;
  confidence: number;
  layoutMode?: "absolute" | "row" | "column" | "grid";
  fallbackStrategy?: EditablePptFallbackStrategy;
  exportMode?: EditablePptExportMode;
  sourceRef?: string | null;
  assetKey?: string | null;
  assetUrl?: string | null;
  textContent?: string | null;
  style?: Record<string, unknown>;
  children?: EditablePptStructureNode[];
}

export interface EditablePptStructureRoot {
  version: 2;
  pageId: string;
  pageNumber: number;
  width: number;
  height: number;
  sourceKind: "pptx" | "pdf" | "image";
  pageMode: EditablePptPageMode;
  editableScore: number;
  textRecoveryScore: number;
  layoutRecoveryScore: number;
  unknownNodeRatio: number;
  warnings: string[];
  metrics: EditablePptStructureMetrics;
  children: EditablePptStructureNode[];
}

export interface EditablePptJobDetail {
  job: EditablePptJobRecord;
  pages: EditablePptPageRecord[];
  elementsByPage: Record<string, EditablePptElementRecord[]>;
  exports: EditablePptExportRecord[];
}

export const DEFAULT_EDITABLE_PPT_CONFIG: EditablePptConfig = {
  parseMode: "balanced",
  languageHint: "auto",
  detectTables: false,
  detectIcons: false,
  rebuildShapes: true,
  exportStrategy: "hybrid",
};
