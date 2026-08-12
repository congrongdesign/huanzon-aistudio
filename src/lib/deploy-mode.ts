export function isCozeCloudRuntime(): boolean {
  return (
    process.env.NEXT_PUBLIC_COZE_CLOUD === "1" ||
    process.env.COZE_PROJECT_ENV === "PROD" ||
    process.env.HZ_BACKEND_MODE === "supabase"
  );
}

