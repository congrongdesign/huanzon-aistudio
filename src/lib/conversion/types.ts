export type ConversionSourceType = "images" | "pdf";

export type ConversionTaskStatus =
  | "draft"
  | "preparing_pdf"
  | "uploading"
  | "estimating"
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type ConversionSourceFile = {
  name: string;
  size: number;
  type: string;
  origin?: "upload" | "canvas" | "url";
  source_url?: string | null;
  thumbnail_url?: string | null;
  width?: number | null;
  height?: number | null;
};

export type ConversionTaskRecord = {
  id: string;
  user_id: string | null;
  project_id: string | null;
  codia_task_id: string | null;
  source_type: ConversionSourceType;
  source_name: string;
  source_files: ConversionSourceFile[];
  page_count: number;
  status: ConversionTaskStatus;
  progress: number;
  estimated_credits: number | null;
  charged_credits: number | null;
  upload_id: string | null;
  codia_status?: string | null;
  prepared_pdf_key: string | null;
  prepared_pdf_url: string | null;
  ppt_url: string | null;
  archived_asset_id?: string | null;
  archived_at?: string | null;
  error_message: string | null;
  sync_error?: string | null;
  last_synced_at?: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
};

export type ConversionStore = {
  version: number;
  tasks: ConversionTaskRecord[];
};
