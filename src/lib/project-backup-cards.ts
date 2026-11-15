import type { Project } from "./types";
import type { ProjectArchiveEntry } from "./project-archive-types";

export type BackupCard = { id: string; name: string; project?: Project; versions: ProjectArchiveEntry[]; thumbnail: string };

export function projectBackupCards(projects: Project[], entries: ProjectArchiveEntry[]): BackupCard[] {
  const cards = new Map<string, BackupCard>();
  for (const project of projects) cards.set(project.id, { id: project.id, name: project.name, project, versions: [], thumbnail: "" });
  for (const entry of [...entries].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))) {
    const card = cards.get(entry.projectId) || { id: entry.projectId, name: entry.projectName, versions: [], thumbnail: "" };
    card.versions.push(entry);
    card.thumbnail ||= entry.thumbnailDataUrl || "";
    cards.set(card.id, card);
  }
  return [...cards.values()];
}
