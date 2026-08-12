import fs from "node:fs";
import path from "node:path";

function uniqueExisting(candidates: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const clean = candidate?.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    if (fs.existsSync(clean)) result.push(clean);
  }
  return result;
}

export function getDocToolBinDirs(): string[] {
  return uniqueExisting([
    path.join(process.cwd(), "tools", "cloud-doc-tools", "bin"),
    path.join(process.cwd(), "tools", "envs", "poppler", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/Applications/LibreOffice.app/Contents/MacOS",
  ]);
}

export function getDocToolPathEnv(): string {
  return Array.from(new Set([...(process.env.PATH || "").split(path.delimiter), ...getDocToolBinDirs()].filter(Boolean))).join(path.delimiter);
}

export function findLibreOffice(): string | null {
  const binDirs = getDocToolBinDirs();
  return uniqueExisting([
    process.env.LIBREOFFICE_PATH,
    path.join(process.cwd(), "tools", "LibreOffice", "LibreOffice.app", "Contents", "MacOS", "soffice"),
    ...binDirs.flatMap((dir) => [path.join(dir, "soffice"), path.join(dir, "libreoffice")]),
  ])[0] || null;
}

export function findPdfToPpm(): string | null {
  const binDirs = getDocToolBinDirs();
  return uniqueExisting([
    process.env.PDFTOPPM_PATH,
    ...binDirs.map((dir) => path.join(dir, "pdftoppm")),
  ])[0] || null;
}

export function findPdfInfo(): string | null {
  const binDirs = getDocToolBinDirs();
  return uniqueExisting([
    process.env.PDFINFO_PATH,
    ...binDirs.map((dir) => path.join(dir, "pdfinfo")),
  ])[0] || null;
}

