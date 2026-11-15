export type TrackedArchiveJob = {
  id: string;
  action: "archive" | "restore";
  title: string;
  startedAt: string;
};

const STORAGE_KEY = "hz_archive_background_jobs_v1";
export const BACKGROUND_ARCHIVE_JOBS_EVENT = "hz:background-archive-jobs-changed";

function notify(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BACKGROUND_ARCHIVE_JOBS_EVENT));
  }
}

export function listTrackedArchiveJobs(): TrackedArchiveJob[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is TrackedArchiveJob => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return typeof record.id === "string"
        && (record.action === "archive" || record.action === "restore")
        && typeof record.title === "string"
        && typeof record.startedAt === "string";
    });
  } catch {
    return [];
  }
}

export function trackBackgroundArchiveJob(job: TrackedArchiveJob): void {
  if (typeof window === "undefined") return;
  const jobs = listTrackedArchiveJobs().filter((item) => item.id !== job.id);
  jobs.unshift(job);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs.slice(0, 20)));
  notify();
}

export function untrackBackgroundArchiveJob(jobId: string): void {
  if (typeof window === "undefined") return;
  const jobs = listTrackedArchiveJobs().filter((item) => item.id !== jobId);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  notify();
}
