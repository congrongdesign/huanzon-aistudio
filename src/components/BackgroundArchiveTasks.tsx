"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import { LoadingState } from "@/components/creation/GenerationState";
import type { ProjectArchiveJob } from "@/lib/project-archive-types";
import {
  BACKGROUND_ARCHIVE_JOBS_EVENT,
  listTrackedArchiveJobs,
  untrackBackgroundArchiveJob,
  type TrackedArchiveJob,
} from "@/lib/background-archive-jobs";

type BackgroundArchiveTasksProps = {
  getAuthHeaders: () => HeadersInit;
  onJobFinished: (job: ProjectArchiveJob) => Promise<void> | void;
  onProjectsChanged?: () => Promise<void> | void;
};

function isRunning(job: ProjectArchiveJob): boolean {
  return job.status === "queued" || job.status === "running";
}

export default function BackgroundArchiveTasks({
  getAuthHeaders,
  onJobFinished,
  onProjectsChanged,
}: BackgroundArchiveTasksProps) {
  const [trackedJobs, setTrackedJobs] = useState<TrackedArchiveJob[]>([]);
  const [jobs, setJobs] = useState<Record<string, ProjectArchiveJob>>({});
  const [recentFinished, setRecentFinished] = useState<ProjectArchiveJob[]>([]);
  const finishedIdsRef = useRef<Set<string>>(new Set());
  const removedCountsRef = useRef<Record<string, number>>({});
  const timersRef = useRef<Map<string, number>>(new Map());

  const refreshTrackedJobs = useCallback(() => {
    setTrackedJobs(listTrackedArchiveJobs());
  }, []);

  useEffect(() => {
    refreshTrackedJobs();
    window.addEventListener(BACKGROUND_ARCHIVE_JOBS_EVENT, refreshTrackedJobs);
    return () => window.removeEventListener(BACKGROUND_ARCHIVE_JOBS_EVENT, refreshTrackedJobs);
  }, [refreshTrackedJobs]);

  const pollJobs = useCallback(async () => {
    await Promise.all(trackedJobs.map(async (tracked) => {
      try {
        const response = await fetch(`/api/project-archive?jobId=${encodeURIComponent(tracked.id)}`, {
          headers: getAuthHeaders(),
          cache: "no-store",
        });
        if (response.status === 404) {
          untrackBackgroundArchiveJob(tracked.id);
          return;
        }
        const data = await response.json() as { job?: ProjectArchiveJob };
        const job = data.job;
        if (!response.ok || !job) return;
        setJobs((current) => ({ ...current, [job.id]: job }));
        const removed = job.results.filter(result => result.originalRemoved).length;
        if (removed > (removedCountsRef.current[job.id] || 0)) {
          removedCountsRef.current[job.id] = removed;
          await onProjectsChanged?.();
        }
        if (isRunning(job)) {
          finishedIdsRef.current.delete(job.id);
          return;
        }
        if (finishedIdsRef.current.has(job.id)) return;

        finishedIdsRef.current.add(job.id);
        setRecentFinished((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 2));
        await onJobFinished(job);
        untrackBackgroundArchiveJob(job.id);
        const timer = window.setTimeout(() => {
          setRecentFinished((current) => current.filter((item) => item.id !== job.id));
          timersRef.current.delete(job.id);
        }, 8000);
        timersRef.current.set(job.id, timer);
      } catch {
        // Keep tracking on temporary network/server errors.
      }
    }));
  }, [getAuthHeaders, onJobFinished, onProjectsChanged, trackedJobs]);

  useEffect(() => {
    if (trackedJobs.length === 0) return;
    void pollJobs();
    const timer = window.setInterval(() => void pollJobs(), 1000);
    return () => window.clearInterval(timer);
  }, [pollJobs, trackedJobs.length]);

  useEffect(() => () => {
    for (const timer of timersRef.current.values()) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  const activeJob = trackedJobs
    .map((tracked) => jobs[tracked.id])
    .find((job) => job && isRunning(job));
  const finishedJob = recentFinished[0];
  const displayJob = activeJob || finishedJob;

  if (!displayJob) return null;
  const failed = displayJob.status === "failed" || displayJob.status === "partial";
  const label = isRunning(displayJob)
    ? `${displayJob.action === "archive" ? "备份" : "恢复"} ${displayJob.completed + displayJob.failed}/${displayJob.total}`
    : displayJob.status === "paused" ? "任务已暂停"
    : displayJob.status === "cancelled" ? "任务已取消"
    : failed
      ? `${displayJob.action === "archive" ? "备份" : "恢复"}有失败`
      : `${displayJob.action === "archive" ? "备份" : "恢复"}完成`;

  return (
    <div
      className={`motif-task-summary flex h-7 min-w-0 max-w-[260px] items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium ${failed ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400" : isRunning(displayJob) ? "border-primary/25 bg-primary/10 text-primary" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"}`}
      title={displayJob.stage || label}
    >
      {isRunning(displayJob) ? (
        <LoadingState label="" />
      ) : failed ? (
        <AlertCircle className="h-3 w-3 shrink-0" />
      ) : (
        <CheckCircle2 className="h-3 w-3 shrink-0" />
      )}
      <span className="shrink-0">{label}</span>
      <span className="min-w-0 truncate text-current/70">{displayJob.stage}</span>
    </div>
  );
}
