import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth";
import { CodiaApiError, getCodiaApiKeyFromHeaders, getCodiaBaseUrlFromHeaders } from "@/lib/codia/client";
import { recordConversionTaskSyncError, syncConversionTaskFromCodia } from "@/lib/conversion/codia-task";
import { getConversionTask, listConversionTasks } from "@/lib/conversion/store";
import type { ConversionTaskRecord } from "@/lib/conversion/types";

export const runtime = "nodejs";

type BatchSyncScope = "selected" | "result_pending" | "all_codia";

type BatchSyncItem = {
  id: string;
  status: "synced" | "failed" | "skipped";
  reason?: string;
  task?: ConversionTaskRecord;
};

function uniqueIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()))).slice(0, 100);
}

function parseScope(value: unknown): BatchSyncScope {
  if (value === "all_codia" || value === "result_pending") return value;
  return "selected";
}

function needsResultSync(task: ConversionTaskRecord) {
  return Boolean(task.codia_task_id && task.status === "succeeded" && !task.ppt_url);
}

function taskTargets(userId: string, body: Record<string, unknown>) {
  const ids = uniqueIds(body.ids);
  if (ids.length > 0) {
    return ids.map((id) => getConversionTask(id, userId)).filter((task): task is ConversionTaskRecord => Boolean(task));
  }

  const scope = parseScope(body.scope);
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : null;
  const tasks = listConversionTasks(userId, projectId);
  if (scope === "result_pending") return tasks.filter(needsResultSync);
  if (scope === "all_codia") return tasks.filter((task) => Boolean(task.codia_task_id));
  return [];
}

export async function POST(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) return NextResponse.json({ error: "未登录" }, { status: 401 });

    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const ids = uniqueIds(body.ids);
    const targets = taskTargets(userId, body);
    const targetById = new Map(targets.map((task) => [task.id, task]));
    const apiKey = getCodiaApiKeyFromHeaders(request.headers);
    const baseUrl = getCodiaBaseUrlFromHeaders(request.headers);
    const items: BatchSyncItem[] = [];

    if (ids.length > 0) {
      for (const id of ids) {
        if (!targetById.has(id)) items.push({ id, status: "skipped", reason: "任务不存在" });
      }
    }

    for (const task of targets) {
      if (!task.codia_task_id) {
        items.push({ id: task.id, status: "skipped", reason: "没有 Codia 任务 ID", task });
        continue;
      }

      try {
        const synced = await syncConversionTaskFromCodia(task, apiKey, baseUrl, { force: true });
        items.push({ id: task.id, status: "synced", task: synced });
      } catch (error) {
        const updated = recordConversionTaskSyncError(task, error);
        items.push({ id: task.id, status: "failed", reason: error instanceof Error ? error.message : "同步失败", task: updated });
      }
    }

    if (items.length === 0) {
      return NextResponse.json({ error: "没有需要同步的任务", items: [] }, { status: 400 });
    }

    const synced = items.filter((item) => item.status === "synced").length;
    const failed = items.filter((item) => item.status === "failed").length;
    const skipped = items.filter((item) => item.status === "skipped").length;
    return NextResponse.json({ items, total: items.length, synced, failed, skipped });
  } catch (error) {
    const status = error instanceof CodiaApiError ? error.status : 500;
    const message = error instanceof Error ? error.message : "批量同步转换任务失败";
    return NextResponse.json({ error: message }, { status });
  }
}
