import { NextRequest, NextResponse } from "next/server";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { getCurrentUserId } from "@/lib/auth";
import {
  createAssetVersion,
  createDesignAsset,
  createImageRecord,
  getImageRecordById,
  isLocalBackendEnabled,
  resolveLocalFilePath,
  saveBinaryFile,
} from "@/lib/local-backend";
import { prepareReferenceImagesForModel } from "@/lib/image-edit/reference-prep";
import { S3Storage, S3Config } from "coze-coding-dev-sdk";
import fs from "node:fs/promises";
import type { DesignAssetKind } from "@/lib/types";
import { createTrackedOperation, updateTrackedOperation } from "@/lib/design-operation-tracker";
import { normalizeOperationError, toOperationErrorLog, toOperationErrorPayload } from "@/lib/operation-error";

// Supported aspect ratios for grsai models
const SUPPORTED_RATIOS = [
  "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3",
  "1:2", "2:1", "1:3", "3:1", "4:5", "5:4", "5:6", "6:5",
  "1:4", "4:1", "1:8", "8:1",
];

interface GrsaiResponse {
  id?: string;
  status?: string;
  results?: { url: string }[];
  error?: string;
}

type OriginalImageInfo = {
  id?: string;
  project_id: string | null;
  canvas_x: number;
  canvas_y: number;
  canvas_width: number;
  canvas_height: number;
  image_url: string;
  image_key?: string | null;
  size: string;
};

type TrackedOperation = { id: string };

type TrackedAsset = {
  id: string;
  project_id: string | null;
  kind: string;
  url: string;
  key: string | null;
};

type SmartElement = {
  id: number;
  area: number;
  coverage: number;
  bbox: { x: number; y: number; width: number; height: number };
  score?: number;
  edgeMean?: number;
  fillRatio?: number;
};

function findClosestRatio(w: number, h: number): string {
  const targetRatio = w / h;
  let bestDiff = Infinity;
  let bestLabel = "1:1";
  for (const r of SUPPORTED_RATIOS) {
    const [rw, rh] = r.split(":").map(Number);
    const ratio = rw / rh;
    const diff = Math.abs(ratio - targetRatio);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLabel = r;
    }
  }
  return bestLabel;
}

async function loadImageBuffer(imageUrl: string): Promise<Buffer> {
  if (!imageUrl) throw new Error("图片地址为空");

  if (imageUrl.startsWith("/api/local-file/")) {
    const key = decodeURIComponent(imageUrl.split("/").pop()?.split("?")[0] || "");
    if (!key) throw new Error("本地图片 key 为空");
    return fs.readFile(resolveLocalFilePath(key));
  }

  if (imageUrl.startsWith("data:")) {
    const raw = imageUrl.replace(/^data:[^;]+;base64,/, "");
    return Buffer.from(raw, "base64");
  }

  const imgResp = await fetch(imageUrl, { signal: AbortSignal.timeout(30000) });
  if (!imgResp.ok) throw new Error(`Download original failed: ${imgResp.status}`);
  return Buffer.from(await imgResp.arrayBuffer());
}

function getPixel(raw: Buffer, width: number, x: number, y: number) {
  const idx = (y * width + x) * 3;
  return {
    r: raw[idx],
    g: raw[idx + 1],
    b: raw[idx + 2],
  };
}

function colorDistance(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function estimateBackgroundColor(raw: Buffer, width: number, height: number) {
  const samples: Array<{ r: number; g: number; b: number }> = [];
  const stepX = Math.max(1, Math.floor(width / 40));
  const stepY = Math.max(1, Math.floor(height / 40));

  for (let x = 0; x < width; x += stepX) {
    samples.push(getPixel(raw, width, x, 0));
    samples.push(getPixel(raw, width, x, height - 1));
  }
  for (let y = 0; y < height; y += stepY) {
    samples.push(getPixel(raw, width, 0, y));
    samples.push(getPixel(raw, width, width - 1, y));
  }
  if (samples.length === 0) return { r: 255, g: 255, b: 255 };

  const sum = samples.reduce((acc, s) => ({ r: acc.r + s.r, g: acc.g + s.g, b: acc.b + s.b }), { r: 0, g: 0, b: 0 });
  return {
    r: Math.round(sum.r / samples.length),
    g: Math.round(sum.g / samples.length),
    b: Math.round(sum.b / samples.length),
  };
}

function buildSmartSubjectMask(raw: Buffer, width: number, height: number, threshold: number) {
  const total = width * height;
  const bg = estimateBackgroundColor(raw, width, height);
  const background = new Uint8Array(total);
  const visited = new Uint8Array(total);
  const queue = new Uint32Array(total);
  let qHead = 0;
  let qTail = 0;
  let backgroundCount = 0;

  const pushIfBackground = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    const px = getPixel(raw, width, x, y);
    if (colorDistance(px, bg) <= threshold) {
      background[idx] = 1;
      queue[qTail++] = idx;
      backgroundCount++;
    }
  };

  for (let x = 0; x < width; x++) {
    pushIfBackground(x, 0);
    pushIfBackground(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    pushIfBackground(0, y);
    pushIfBackground(width - 1, y);
  }

  while (qHead < qTail) {
    const idx = queue[qHead++];
    const x = idx % width;
    const y = Math.floor(idx / width);
    pushIfBackground(x - 1, y);
    pushIfBackground(x + 1, y);
    pushIfBackground(x, y - 1);
    pushIfBackground(x, y + 1);
  }

  const subjectBinary = new Uint8Array(total);
  const subjectMask = Buffer.alloc(total * 3);
  let subjectCount = 0;
  for (let i = 0; i < total; i++) {
    const isSubject = background[i] ? 0 : 1;
    subjectBinary[i] = isSubject;
    const subject = isSubject ? 255 : 0;
    if (isSubject) subjectCount++;
    const p = i * 3;
    subjectMask[p] = subject;
    subjectMask[p + 1] = subject;
    subjectMask[p + 2] = subject;
  }

  return {
    maskRaw: subjectMask,
    subjectBinary,
    subjectRatio: subjectCount / total,
    backgroundRatio: backgroundCount / total,
    backgroundColor: bg,
    threshold,
  };
}

function buildMaskRawFromBinary(binary: Uint8Array): Buffer {
  const maskRaw = Buffer.alloc(binary.length * 3);
  for (let i = 0; i < binary.length; i++) {
    const value = binary[i] ? 255 : 0;
    const p = i * 3;
    maskRaw[p] = value;
    maskRaw[p + 1] = value;
    maskRaw[p + 2] = value;
  }
  return maskRaw;
}

function buildConnectedElementMapFromSubjectMask(subjectBinary: Uint8Array, width: number, height: number): {
  idMap: number[];
  elements: SmartElement[];
  filteredSubjectBinary: Uint8Array;
} {
  const total = width * height;
  const labels = new Int32Array(total);
  const queue = new Int32Array(total);
  const components: Array<{
    rawId: number;
    area: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }> = [];

  let rawId = 1;

  for (let idx = 0; idx < total; idx++) {
    if (!subjectBinary[idx] || labels[idx] !== 0) continue;

    labels[idx] = rawId;
    let head = 0;
    let tail = 0;
    queue[tail++] = idx;

    let area = 0;
    let minX = width - 1;
    let minY = height - 1;
    let maxX = 0;
    let maxY = 0;

    while (head < tail) {
      const current = queue[head++];
      area++;
      const x = current % width;
      const y = (current - x) / width;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const xStart = x > 0 ? x - 1 : x;
      const xEnd = x < width - 1 ? x + 1 : x;
      const yStart = y > 0 ? y - 1 : y;
      const yEnd = y < height - 1 ? y + 1 : y;

      for (let ny = yStart; ny <= yEnd; ny++) {
        for (let nx = xStart; nx <= xEnd; nx++) {
          if (nx === x && ny === y) continue;
          const next = ny * width + nx;
          if (!subjectBinary[next] || labels[next] !== 0) continue;
          labels[next] = rawId;
          queue[tail++] = next;
        }
      }
    }

    components.push({ rawId, area, minX, minY, maxX, maxY });
    rawId++;
  }

  if (components.length === 0) {
    return {
      idMap: new Array<number>(total).fill(0),
      elements: [],
      filteredSubjectBinary: new Uint8Array(total),
    };
  }

  const sorted = [...components].sort((a, b) => b.area - a.area);
  const minArea = Math.max(36, Math.floor(total * 0.00022));
  let kept = sorted.filter((item) => item.area >= minArea);
  if (kept.length === 0) kept = [sorted[0]];
  kept = kept.slice(0, 48);

  const finalIdByRawId = new Int32Array(rawId + 1);
  const elements: SmartElement[] = kept.map((item, index) => {
    const finalId = index + 1;
    finalIdByRawId[item.rawId] = finalId;
    return {
      id: finalId,
      area: item.area,
      coverage: Number((item.area / total).toFixed(6)),
      bbox: {
        x: item.minX,
        y: item.minY,
        width: item.maxX - item.minX + 1,
        height: item.maxY - item.minY + 1,
      },
    };
  });

  const filteredSubjectBinary = new Uint8Array(total);
  const idMap = new Array<number>(total).fill(0);
  for (let i = 0; i < total; i++) {
    const currentRawId = labels[i];
    if (currentRawId <= 0) continue;
    const finalId = finalIdByRawId[currentRawId];
    if (finalId <= 0) continue;
    idMap[i] = finalId;
    filteredSubjectBinary[i] = 1;
  }

  return { idMap, elements, filteredSubjectBinary };
}

function computeEdgeMagnitude(raw: Buffer, width: number, height: number): Uint8Array {
  const total = width * height;
  const gray = new Uint16Array(total);
  for (let i = 0; i < total; i++) {
    const p = i * 3;
    gray[i] = (raw[p] * 77 + raw[p + 1] * 150 + raw[p + 2] * 29) >> 8;
  }

  const edges = new Uint8Array(total);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const tl = gray[(y - 1) * width + (x - 1)];
      const tc = gray[(y - 1) * width + x];
      const tr = gray[(y - 1) * width + (x + 1)];
      const ml = gray[y * width + (x - 1)];
      const mr = gray[y * width + (x + 1)];
      const bl = gray[(y + 1) * width + (x - 1)];
      const bc = gray[(y + 1) * width + x];
      const br = gray[(y + 1) * width + (x + 1)];

      const gx = -tl - (2 * ml) - bl + tr + (2 * mr) + br;
      const gy = -tl - (2 * tc) - tr + bl + (2 * bc) + br;
      const magnitude = Math.min(255, Math.round(Math.hypot(gx, gy) / 4));
      edges[idx] = magnitude;
    }
  }
  return edges;
}

function buildSuperpixelElementMapFromSubjectMask(raw: Buffer, subjectBinary: Uint8Array, width: number, height: number): {
  idMap: number[];
  elements: SmartElement[];
  filteredSubjectBinary: Uint8Array;
} {
  const total = width * height;
  let subjectCount = 0;
  for (let i = 0; i < total; i++) {
    if (subjectBinary[i]) subjectCount++;
  }
  if (subjectCount < 32) {
    return buildConnectedElementMapFromSubjectMask(subjectBinary, width, height);
  }

  const desiredSeeds = Math.max(220, Math.min(2400, Math.round(subjectCount / 240)));
  const step = Math.max(8, Math.min(28, Math.round(Math.sqrt(total / desiredSeeds))));
  const halfStep = Math.max(1, Math.floor(step / 2));
  const edges = computeEdgeMagnitude(raw, width, height);

  const seedX: number[] = [];
  const seedY: number[] = [];
  const seedR: number[] = [];
  const seedG: number[] = [];
  const seedB: number[] = [];

  for (let y = halfStep; y < height; y += step) {
    for (let x = halfStep; x < width; x += step) {
      let bestIdx = -1;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let oy = -2; oy <= 2; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= height) continue;
        for (let ox = -2; ox <= 2; ox++) {
          const nx = x + ox;
          if (nx < 0 || nx >= width) continue;
          const idx = ny * width + nx;
          if (!subjectBinary[idx]) continue;
          const score = (edges[idx] * 0.75) + (ox * ox + oy * oy) * 0.35;
          if (score < bestScore) {
            bestScore = score;
            bestIdx = idx;
          }
        }
      }
      if (bestIdx < 0) continue;
      const sx = bestIdx % width;
      const sy = (bestIdx - sx) / width;
      const p = bestIdx * 3;
      seedX.push(sx);
      seedY.push(sy);
      seedR.push(raw[p]);
      seedG.push(raw[p + 1]);
      seedB.push(raw[p + 2]);
    }
  }

  if (seedX.length < 6) {
    return buildConnectedElementMapFromSubjectMask(subjectBinary, width, height);
  }

  const labels = new Int32Array(total);
  labels.fill(-1);
  const distances = new Float32Array(total);

  const compactness = 7.5;
  const colorScale = 20;
  const edgeScale = 0.42;
  const iterations = 4;

  for (let iter = 0; iter < iterations; iter++) {
    distances.fill(Number.POSITIVE_INFINITY);
    labels.fill(-1);

    for (let k = 0; k < seedX.length; k++) {
      const sx = seedX[k];
      const sy = seedY[k];
      const minX = Math.max(0, Math.floor(sx - step));
      const maxX = Math.min(width - 1, Math.ceil(sx + step));
      const minY = Math.max(0, Math.floor(sy - step));
      const maxY = Math.min(height - 1, Math.ceil(sy + step));

      for (let y = minY; y <= maxY; y++) {
        const row = y * width;
        for (let x = minX; x <= maxX; x++) {
          const idx = row + x;
          if (!subjectBinary[idx]) continue;
          const p = idx * 3;
          const dr = raw[p] - seedR[k];
          const dg = raw[p + 1] - seedG[k];
          const db = raw[p + 2] - seedB[k];
          const colorDist = Math.sqrt(dr * dr + dg * dg + db * db) / colorScale;
          const dx = x - sx;
          const dy = y - sy;
          const spatialDist = (Math.sqrt(dx * dx + dy * dy) / step) * compactness;
          const edgePenalty = (edges[idx] / 255) * edgeScale;
          const score = colorDist + spatialDist + edgePenalty;
          if (score < distances[idx]) {
            distances[idx] = score;
            labels[idx] = k;
          }
        }
      }
    }

    const sumX = new Float64Array(seedX.length);
    const sumY = new Float64Array(seedX.length);
    const sumR = new Float64Array(seedX.length);
    const sumG = new Float64Array(seedX.length);
    const sumB = new Float64Array(seedX.length);
    const count = new Uint32Array(seedX.length);

    for (let idx = 0; idx < total; idx++) {
      const label = labels[idx];
      if (label < 0) continue;
      const x = idx % width;
      const y = (idx - x) / width;
      const p = idx * 3;
      sumX[label] += x;
      sumY[label] += y;
      sumR[label] += raw[p];
      sumG[label] += raw[p + 1];
      sumB[label] += raw[p + 2];
      count[label] += 1;
    }

    for (let k = 0; k < seedX.length; k++) {
      if (count[k] === 0) continue;
      seedX[k] = sumX[k] / count[k];
      seedY[k] = sumY[k] / count[k];
      seedR[k] = sumR[k] / count[k];
      seedG[k] = sumG[k] / count[k];
      seedB[k] = sumB[k] / count[k];
    }
  }

  const queue = new Int32Array(total);
  const visited = new Uint8Array(total);
  const componentByPixel = new Int32Array(total);
  const components: Array<{
    componentId: number;
    area: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    sumR: number;
    sumG: number;
    sumB: number;
    edgeSum: number;
  }> = [];
  let componentId = 0;

  for (let idx = 0; idx < total; idx++) {
    if (!subjectBinary[idx] || visited[idx] || labels[idx] < 0) continue;
    const seedLabel = labels[idx];
    visited[idx] = 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = idx;

    let area = 0;
    let minX = width - 1;
    let minY = height - 1;
    let maxX = 0;
    let maxY = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let edgeSum = 0;

    while (head < tail) {
      const current = queue[head++];
      componentByPixel[current] = componentId + 1;
      area++;
      const x = current % width;
      const y = (current - x) / width;

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const p = current * 3;
      sumR += raw[p];
      sumG += raw[p + 1];
      sumB += raw[p + 2];
      edgeSum += edges[current];

      const left = x > 0 ? current - 1 : -1;
      const right = x < width - 1 ? current + 1 : -1;
      const up = y > 0 ? current - width : -1;
      const down = y < height - 1 ? current + width : -1;

      if (left >= 0 && !visited[left] && subjectBinary[left] && labels[left] === seedLabel) {
        visited[left] = 1;
        queue[tail++] = left;
      }
      if (right >= 0 && !visited[right] && subjectBinary[right] && labels[right] === seedLabel) {
        visited[right] = 1;
        queue[tail++] = right;
      }
      if (up >= 0 && !visited[up] && subjectBinary[up] && labels[up] === seedLabel) {
        visited[up] = 1;
        queue[tail++] = up;
      }
      if (down >= 0 && !visited[down] && subjectBinary[down] && labels[down] === seedLabel) {
        visited[down] = 1;
        queue[tail++] = down;
      }
    }

    components.push({ componentId: componentId + 1, area, minX, minY, maxX, maxY, sumR, sumG, sumB, edgeSum });
    componentId++;
  }

  if (components.length === 0) {
    return {
      idMap: new Array<number>(total).fill(0),
      elements: [],
      filteredSubjectBinary: new Uint8Array(total),
    };
  }

  const componentMeanColors = new Array<{ r: number; g: number; b: number }>(componentId + 1);
  for (const item of components) {
    componentMeanColors[item.componentId] = {
      r: item.sumR / Math.max(1, item.area),
      g: item.sumG / Math.max(1, item.area),
      b: item.sumB / Math.max(1, item.area),
    };
  }

  const parent = new Int32Array(componentId + 1);
  for (let i = 1; i <= componentId; i++) parent[i] = i;
  const findParent = (value: number) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  const unionParent = (a: number, b: number) => {
    const rootA = findParent(a);
    const rootB = findParent(b);
    if (rootA === rootB) return;
    if (rootA < rootB) parent[rootB] = rootA;
    else parent[rootA] = rootB;
  };

  const boundaryStats = new Map<number, { count: number; edgeSum: number }>();
  const boundaryBase = componentId + 1;
  const addBoundary = (a: number, b: number, idxA: number, idxB: number) => {
    if (a <= 0 || b <= 0 || a === b) return;
    const low = a < b ? a : b;
    const high = a < b ? b : a;
    const key = low * boundaryBase + high;
    const current = boundaryStats.get(key);
    if (current) {
      current.count++;
      current.edgeSum += Math.max(edges[idxA], edges[idxB]);
    } else {
      boundaryStats.set(key, {
        count: 1,
        edgeSum: Math.max(edges[idxA], edges[idxB]),
      });
    }
  };

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const idx = row + x;
      const current = componentByPixel[idx];
      if (current <= 0) continue;
      if (x < width - 1) {
        addBoundary(current, componentByPixel[idx + 1], idx, idx + 1);
      }
      if (y < height - 1) {
        addBoundary(current, componentByPixel[idx + width], idx, idx + width);
      }
    }
  }

  for (const [key, stats] of boundaryStats.entries()) {
    const low = Math.floor(key / boundaryBase);
    const high = key % boundaryBase;
    const compA = components[low - 1];
    const compB = components[high - 1];
    if (!compA || !compB) continue;

    const meanEdge = stats.edgeSum / Math.max(1, stats.count);
    const colorGap = colorDistance(componentMeanColors[low], componentMeanColors[high]);
    const smallMerge = Math.min(compA.area, compB.area) < Math.max(80, Math.floor(total * 0.00008));
    const edgeThreshold = smallMerge ? 28 : 16;
    const colorThreshold = smallMerge ? 30 : 18;
    const sizeRatio = Math.max(compA.area, compB.area) / Math.max(1, Math.min(compA.area, compB.area));
    const shouldMerge =
      sizeRatio <= 14 &&
      meanEdge <= edgeThreshold &&
      colorGap <= colorThreshold;

    if (shouldMerge) {
      unionParent(low, high);
    }
  }

  const mergedGroups = new Map<number, {
    root: number;
    area: number;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    sumR: number;
    sumG: number;
    sumB: number;
    edgeSum: number;
    memberIds: number[];
  }>();

  for (const item of components) {
    const root = findParent(item.componentId);
    const group = mergedGroups.get(root) || {
      root,
      area: 0,
      minX: width - 1,
      minY: height - 1,
      maxX: 0,
      maxY: 0,
      sumR: 0,
      sumG: 0,
      sumB: 0,
      edgeSum: 0,
      memberIds: [],
    };
    group.area += item.area;
    group.minX = Math.min(group.minX, item.minX);
    group.minY = Math.min(group.minY, item.minY);
    group.maxX = Math.max(group.maxX, item.maxX);
    group.maxY = Math.max(group.maxY, item.maxY);
    group.sumR += item.sumR;
    group.sumG += item.sumG;
    group.sumB += item.sumB;
    group.edgeSum += item.edgeSum;
    group.memberIds.push(item.componentId);
    mergedGroups.set(root, group);
  }

  const grouped = Array.from(mergedGroups.values()).map((group) => {
    const bboxWidth = group.maxX - group.minX + 1;
    const bboxHeight = group.maxY - group.minY + 1;
    const bboxArea = Math.max(1, bboxWidth * bboxHeight);
    const fillRatio = group.area / bboxArea;
    const edgeMean = group.edgeSum / Math.max(1, group.area);
    const score = (edgeMean * 2.8) + ((1 - fillRatio) * 2.2) + (Math.log2(group.area + 1) * 0.12);
    return {
      ...group,
      bboxWidth,
      bboxHeight,
      fillRatio,
      edgeMean,
      score,
    };
  });

  const minArea = Math.max(4, Math.floor(total * 0.0000025));
  let kept = grouped.filter((item) => item.area >= minArea || item.edgeMean >= 12 || item.fillRatio <= 0.55);
  if (kept.length === 0) {
    kept = [...grouped].sort((a, b) => b.score - a.score || b.area - a.area).slice(0, 1);
  }
  kept = kept.sort((a, b) => b.score - a.score || b.area - a.area).slice(0, 1200);

  const finalIdByComponent = new Int32Array(componentId + 1);
  const elements: SmartElement[] = kept.map((item, index) => {
    const finalId = index + 1;
    for (const memberId of item.memberIds) {
      finalIdByComponent[memberId] = finalId;
    }
    return {
      id: finalId,
      area: item.area,
      coverage: Number((item.area / total).toFixed(6)),
      bbox: {
        x: item.minX,
        y: item.minY,
        width: item.bboxWidth,
        height: item.bboxHeight,
      },
      score: Number(item.score.toFixed(4)),
      edgeMean: Number(item.edgeMean.toFixed(4)),
      fillRatio: Number(item.fillRatio.toFixed(4)),
    };
  });

  const idMap = new Array<number>(total).fill(0);
  const filteredSubjectBinary = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const component = componentByPixel[i];
    if (component <= 0) continue;
    const finalId = finalIdByComponent[component];
    if (finalId <= 0) continue;
    idMap[i] = finalId;
    filteredSubjectBinary[i] = 1;
  }

  return { idMap, elements, filteredSubjectBinary };
}

function buildElementMapFromSubjectMask(raw: Buffer, subjectBinary: Uint8Array, width: number, height: number): {
  idMap: number[];
  elements: SmartElement[];
  filteredSubjectBinary: Uint8Array;
} {
  const refined = buildSuperpixelElementMapFromSubjectMask(raw, subjectBinary, width, height);
  if (refined.elements.length >= 6) return refined;
  return buildConnectedElementMapFromSubjectMask(subjectBinary, width, height);
}

async function uploadImageBuffer(input: {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}): Promise<{ key: string | null; url: string }> {
  if (isLocalBackendEnabled()) {
    const saved = saveBinaryFile(input.buffer, input.fileName, input.contentType);
    return { key: saved.key, url: saved.url };
  }

  const s3 = new S3Storage(new S3Config());
  const key = await s3.uploadFile({
    fileContent: input.buffer,
    fileName: input.fileName,
    contentType: input.contentType,
  });
  const url = await s3.generatePresignedUrl({ key });
  if (!url) throw new Error("上传图片失败");
  return { key, url };
}

async function getOriginalImageInfo(imageId: string | undefined, imageUrl: string | undefined, userId: string): Promise<OriginalImageInfo> {
  if (isLocalBackendEnabled()) {
    const record = imageId ? getImageRecordById(imageId, userId) : null;
    if (record) {
      return {
        id: record.id,
        project_id: record.project_id,
        canvas_x: record.canvas_x,
        canvas_y: record.canvas_y,
        canvas_width: record.canvas_width,
        canvas_height: record.canvas_height,
        image_url: imageUrl || record.image_url,
        image_key: record.image_key,
        size: record.size,
      };
    }

    if (imageUrl) {
      return {
        id: imageId,
        project_id: null,
        canvas_x: 0,
        canvas_y: 0,
        canvas_width: 320,
        canvas_height: 320,
        image_url: imageUrl,
        size: "1:1",
      };
    }
  }

  const supabase = getSupabaseClient();
  const { data: originalImage } = await supabase
    .from("image_records")
    .select("id, project_id, canvas_x, canvas_y, canvas_width, canvas_height, image_url, image_key, size")
    .eq("id", imageId)
    .eq("user_id", userId)
    .single();

  if (!originalImage) {
    if (!imageUrl) throw new Error("未找到原始图片记录");
    return {
      id: imageId,
      project_id: null,
      canvas_x: 0,
      canvas_y: 0,
      canvas_width: 320,
      canvas_height: 320,
      image_url: imageUrl,
      size: "1:1",
    };
  }

  return {
    id: String(originalImage.id || imageId || ""),
    project_id: (originalImage.project_id as string | null) || null,
    canvas_x: Number(originalImage.canvas_x || 0),
    canvas_y: Number(originalImage.canvas_y || 0),
    canvas_width: Number(originalImage.canvas_width || 320),
    canvas_height: Number(originalImage.canvas_height || 320),
    image_url: imageUrl || String(originalImage.image_url || ""),
    image_key: (originalImage.image_key as string | null) || null,
    size: String(originalImage.size || "1:1"),
  };
}


async function createTrackedAsset(userId: string, input: {
  projectId: string | null;
  kind: DesignAssetKind;
  url: string;
  key: string | null;
  width: number;
  height: number;
  mimeType: string;
  metadata: Record<string, unknown>;
}): Promise<TrackedAsset> {
  if (isLocalBackendEnabled()) {
    return createDesignAsset(userId, {
      project_id: input.projectId,
      kind: input.kind,
      url: input.url,
      key: input.key,
      width: input.width,
      height: input.height,
      mime_type: input.mimeType,
      metadata: input.metadata,
    });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("design_assets")
    .insert({
      project_id: input.projectId,
      user_id: userId,
      kind: input.kind,
      url: input.url,
      key: input.key,
      width: input.width,
      height: input.height,
      mime_type: input.mimeType,
      metadata: input.metadata,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return {
    id: String(data.id),
    project_id: (data.project_id as string | null) || null,
    kind: String(data.kind || input.kind),
    url: String(data.url || input.url),
    key: (data.key as string | null) || null,
  };
}

async function createTrackedVersion(userId: string, input: {
  assetId: string;
  parentAssetId: string | null;
  operationId: string;
  label: string;
  url: string;
  key: string | null;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (isLocalBackendEnabled()) {
    createAssetVersion(userId, {
      asset_id: input.assetId,
      parent_asset_id: input.parentAssetId,
      operation_id: input.operationId,
      label: input.label,
      url: input.url,
      key: input.key,
      metadata: input.metadata,
    });
    return;
  }

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("asset_versions").insert({
    asset_id: input.assetId,
    parent_asset_id: input.parentAssetId,
    operation_id: input.operationId,
    user_id: userId,
    label: input.label,
    url: input.url,
    key: input.key,
    metadata: input.metadata,
  });
  if (error) throw new Error(error.message);
}

export async function POST(request: NextRequest) {
  let operationForFailure: { userId: string; id: string } | null = null;
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      const normalized = normalizeOperationError({ message: "未登录", status: 401 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const body = await request.json();
    const { imageId, imageUrl, maskBase64, prompt, apiKey, baseUrl, model, origWidth, origHeight } = body;

    if (!imageId && !imageUrl) {
      const normalized = normalizeOperationError({ message: "缺少图片信息", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    if (!prompt) {
      const normalized = normalizeOperationError({ message: "缺少提示词", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }
    if (!maskBase64 || typeof maskBase64 !== "string") {
      const normalized = normalizeOperationError({ message: "缺少涂抹蒙版", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    // API configuration
    const grsaiApiKey = apiKey || process.env.GRS_API_KEY || "";
    const grsaiBaseUrl = (baseUrl || process.env.GRS_BASE_URL || "https://grsaiapi.com").replace(/\/+$/, "");

    if (!grsaiApiKey) {
      const normalized = normalizeOperationError({ message: "未配置生图 API Key", status: 400 });
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    const originalImage = await getOriginalImageInfo(imageId, imageUrl, userId);

    const effectiveImageUrl = imageUrl || originalImage.image_url;
    const useModel = model || "gpt-image-2";

    // Calculate original aspect ratio
    const origW = origWidth || originalImage.canvas_width || 1024;
    const origH = origHeight || originalImage.canvas_height || 1024;
    const aspectRatio = findClosestRatio(origW, origH);

    console.log(`[inpaint] Starting: model=${useModel}, origSize=${origW}x${origH}, ratio=${aspectRatio}`);

    const sharp = (await import("sharp")).default;
    let operation: TrackedOperation | null = null;
    const failOperation = async (message: string) => {
      if (!operation) return;
      const normalized = normalizeOperationError({ message, status: 500 });
      await updateTrackedOperation(userId, operation.id, { status: "failed", error: toOperationErrorLog(normalized) }).catch(() => {});
    };

    operation = await createTrackedOperation(userId, {
      projectId: originalImage.project_id,
      inputAssetIds: [],
      kind: "edit_mask",
      prompt,
      provider: isLocalBackendEnabled() ? "local/grsai" : "s3/grsai",
      model: useModel,
      params: {
        imageId: imageId || null,
        origWidth: origWidth || null,
        origHeight: origHeight || null,
      },
      status: "running",
    });
    operationForFailure = { userId, id: operation.id };

    // ─── Step 1: Download original image and parse mask ───
    const imgBuffer = await loadImageBuffer(effectiveImageUrl);
    const imgMeta = await sharp(imgBuffer).metadata();
    const imgW = imgMeta.width || origW;
    const imgH = imgMeta.height || origH;
    const inputAsset = await createTrackedAsset(userId, {
      projectId: originalImage.project_id,
      kind: "image",
      url: effectiveImageUrl,
      key: originalImage.image_key || null,
      width: imgW,
      height: imgH,
      mimeType: imgMeta.format ? `image/${imgMeta.format}` : "image/png",
      metadata: {
        source: "image_record",
        imageRecordId: imageId || originalImage.id || null,
        operationId: operation.id,
      },
    });
    await updateTrackedOperation(userId, operation.id, { inputAssetIds: [inputAsset.id] });

    // Parse mask (white background, black = painted area)
    const maskData = maskBase64.replace(/^data:image\/\w+;base64,/, "");
    const maskBuffer = Buffer.from(maskData, "base64");
    const savedMask = await uploadImageBuffer({
      buffer: maskBuffer,
      fileName: `inpaint_mask_${operation.id}.png`,
      contentType: "image/png",
    });
    const maskAsset = await createTrackedAsset(userId, {
      projectId: originalImage.project_id,
      kind: "mask",
      url: savedMask.url,
      key: savedMask.key,
      width: imgW,
      height: imgH,
      mimeType: "image/png",
      metadata: {
        source: "inpaint",
        imageId: imageId || null,
        operationId: operation.id,
      },
    });
    await updateTrackedOperation(userId, operation.id, { maskAssetId: maskAsset.id });

    // Resize mask to match original image size, ensure RGB
    const resizedMaskRaw = await sharp(maskBuffer)
      .resize(imgW, imgH, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer();

    // Verify mask has painted pixels
    let paintedCount = 0;
    for (let i = 0; i < imgW * imgH; i++) {
      if (resizedMaskRaw[i * 3] < 128) paintedCount++;
    }

    if (paintedCount === 0) {
      const normalized = normalizeOperationError({ message: "未检测到涂抹区域", status: 400 });
      await failOperation(normalized.message);
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    console.log(`[inpaint] Mask OK: ${paintedCount} painted pixels out of ${imgW * imgH} (${(paintedCount / (imgW * imgH) * 100).toFixed(1)}%)`);

    // ─── Step 2: Create magenta overlay composite for reference ───
    // Paint bright magenta on the masked area so the model can see what to change
    const origRaw = await sharp(imgBuffer).ensureAlpha().raw().toBuffer();
    const overlayRaw = Buffer.alloc(origRaw.length);

    for (let i = 0; i < imgW * imgH; i++) {
      const pi = i * 4;
      const maskR = resizedMaskRaw[i * 3];
      const isPainted = maskR < 128;

      if (isPainted) {
        // Bright magenta overlay (60% opacity) for visibility
        overlayRaw[pi] = Math.round(origRaw[pi] * 0.4 + 255 * 0.6);     // R
        overlayRaw[pi + 1] = Math.round(origRaw[pi + 1] * 0.4 + 0 * 0.6); // G
        overlayRaw[pi + 2] = Math.round(origRaw[pi + 2] * 0.4 + 255 * 0.6); // B
        overlayRaw[pi + 3] = 255;
      } else {
        overlayRaw[pi] = origRaw[pi];
        overlayRaw[pi + 1] = origRaw[pi + 1];
        overlayRaw[pi + 2] = origRaw[pi + 2];
        overlayRaw[pi + 3] = origRaw[pi + 3];
      }
    }

    const compositeImage = await sharp(overlayRaw, { raw: { width: imgW, height: imgH, channels: 4 } })
      .png()
      .toBuffer();

    const uploadedRef = await uploadImageBuffer({
      buffer: compositeImage,
      fileName: `inpaint_ref_${operation.id}.png`,
      contentType: "image/png",
    });
    const preparedRef = await prepareReferenceImagesForModel([uploadedRef.url]);
    const refUrl = preparedRef.references[0] || effectiveImageUrl;

    console.log(`[inpaint] Composite reference uploaded, calling generate API...`);

    // ─── Step 3: Call grsai generate API with magenta overlay as reference ───
    const isNanoBanana = useModel.startsWith("nano-banana");

    const requestBody: Record<string, unknown> = {
      model: useModel,
      prompt: `INPAINTING TASK: The area marked in bright magenta/purple color in this image needs to be changed. Replace the magenta-marked area with: ${prompt}. Keep all non-magenta areas exactly the same as in the original. The magenta overlay indicates the region to edit.`,
      images: [refUrl],
      replyType: "json",
      aspectRatio: aspectRatio,
    };

    if (isNanoBanana) {
      requestBody.imageSize = "1K";
    }

    const genResp = await fetch(`${grsaiBaseUrl}/v1/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${grsaiApiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const genData = await genResp.json() as GrsaiResponse;

    if (!genResp.ok || genData.status === "failed" || genData.status === "violation") {
      const normalized = normalizeOperationError({
        message: genData.error || `生图API错误 (HTTP ${genResp.status})`,
        upstreamStatus: genResp.status,
        status: genResp.status === 429 ? 429 : 502,
      });
      console.error("[inpaint] Generate API error:", normalized.message);
      await failOperation(normalized.message);
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    // Poll for completion
    let resultUrl = "";

    if (genData.status === "running" && genData.id) {
      const taskId = genData.id;
      console.log("[inpaint] Task running, polling:", taskId);

      const pollIntervals = [1500, 1500, 2000, 2000, 2500, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000];
      let pollCount = 0;

      while (pollCount < 20) {
        const delay = pollIntervals[pollCount] || 3000;
        await new Promise(r => setTimeout(r, delay));
        pollCount++;

        const statusResp = await fetch(`${grsaiBaseUrl}/v1/api/generate/${taskId}`, {
          headers: { "Authorization": `Bearer ${grsaiApiKey}` },
        });

        if (!statusResp.ok) continue;

        const statusData = await statusResp.json() as GrsaiResponse;

        if (statusData.status === "succeeded" && statusData.results?.[0]?.url) {
          resultUrl = statusData.results[0].url;
          break;
        }

        if (statusData.status === "failed" || statusData.status === "violation") {
          const normalized = normalizeOperationError({
            message: `生图失败: ${statusData.error || "未知错误"}`,
            status: 502,
          });
          await failOperation(normalized.message);
          return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
        }
      }

      if (!resultUrl) {
        const normalized = normalizeOperationError({ message: "生图超时", status: 504 });
        await failOperation(normalized.message);
        return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
      }
    } else if (genData.status === "succeeded" && genData.results?.[0]?.url) {
      resultUrl = genData.results[0].url;
    }

    if (!resultUrl) {
      const normalized = normalizeOperationError({ message: "未获取到生图结果", status: 500 });
      await failOperation(normalized.message);
      return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
    }

    console.log(`[inpaint] Generate succeeded, now compositing with original...`);

    // ─── Step 4: Pixel-level composite: generated image + original using mask ───
    // This is the KEY step that ensures non-painted areas are EXACTLY the original
    // - For painted pixels (mask black): use generated image pixels
    // - For non-painted pixels (mask white): use original image pixels
    // - Feather edges for smooth transition

    // Download generated result
    const genImgResp = await fetch(resultUrl, { signal: AbortSignal.timeout(30000) });
    if (!genImgResp.ok) throw new Error(`Download generated failed: ${genImgResp.status}`);
    const genBuffer = Buffer.from(await genImgResp.arrayBuffer());

    // Resize generated image to match original dimensions (in case model output differs)
    const genResized = await sharp(genBuffer)
      .resize(imgW, imgH, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer();

    // Create feathered mask: painted area = 1.0, non-painted = 0.0, edges = smooth gradient
    const FEATHER_RADIUS = 3; // pixels for edge feathering
    const maskFloat = new Float32Array(imgW * imgH);

    // First pass: binary mask from raw mask data
    for (let i = 0; i < imgW * imgH; i++) {
      maskFloat[i] = resizedMaskRaw[i * 3] < 128 ? 1.0 : 0.0;
    }

    // Second pass: simple box blur for feathering (3 passes for smoother result)
    for (let pass = 0; pass < 3; pass++) {
      const temp = new Float32Array(maskFloat);
      // Horizontal blur
      for (let y = 0; y < imgH; y++) {
        for (let x = 0; x < imgW; x++) {
          let sum = 0;
          let count = 0;
          for (let dx = -FEATHER_RADIUS; dx <= FEATHER_RADIUS; dx++) {
            const nx = x + dx;
            if (nx >= 0 && nx < imgW) {
              sum += temp[y * imgW + nx];
              count++;
            }
          }
          maskFloat[y * imgW + x] = sum / count;
        }
      }
      // Vertical blur
      const temp2 = new Float32Array(maskFloat);
      for (let y = 0; y < imgH; y++) {
        for (let x = 0; x < imgW; x++) {
          let sum = 0;
          let count = 0;
          for (let dy = -FEATHER_RADIUS; dy <= FEATHER_RADIUS; dy++) {
            const ny = y + dy;
            if (ny >= 0 && ny < imgH) {
              sum += temp2[ny * imgW + x];
              count++;
            }
          }
          maskFloat[y * imgW + x] = sum / count;
        }
      }
    }

    // Composite: blend original and generated using feathered mask
    // maskFloat[i] = 1.0 means "use generated" (painted), 0.0 means "use original" (keep)
    const compositeRaw = Buffer.alloc(origRaw.length);

    for (let i = 0; i < imgW * imgH; i++) {
      const pi = i * 4;
      const alpha = maskFloat[i]; // 0.0 = original, 1.0 = generated

      compositeRaw[pi] = Math.round(origRaw[pi] * (1 - alpha) + genResized[pi] * alpha);
      compositeRaw[pi + 1] = Math.round(origRaw[pi + 1] * (1 - alpha) + genResized[pi + 1] * alpha);
      compositeRaw[pi + 2] = Math.round(origRaw[pi + 2] * (1 - alpha) + genResized[pi + 2] * alpha);
      compositeRaw[pi + 3] = 255;
    }

    const finalImage = await sharp(compositeRaw, { raw: { width: imgW, height: imgH, channels: 4 } })
      .png()
      .toBuffer();

    console.log(`[inpaint] Composite done, uploading final result...`);

    const uploadedFinal = await uploadImageBuffer({
      buffer: finalImage,
      fileName: `inpaint_${operation.id}.png`,
      contentType: "image/png",
    });
    const finalUrl = uploadedFinal.url;
    const objectKey = uploadedFinal.key;

    // Calculate canvas position for the new image (right of original)
    const offsetX = (originalImage?.canvas_width || 320) + 20;
    const canvasX = (originalImage?.canvas_x || 0) + offsetX;
    const canvasY = originalImage?.canvas_y || 0;
    const canvasW = originalImage?.canvas_width || 320;
    const canvasH = originalImage?.canvas_height || 320;

    let newRecord: Record<string, unknown>;
    if (isLocalBackendEnabled()) {
      newRecord = createImageRecord({
        project_id: originalImage.project_id || null,
        user_id: userId,
        prompt: `[局部重绘] ${prompt}`,
        image_url: finalUrl,
        image_key: objectKey,
        size: aspectRatio,
        model: useModel,
        status: "completed",
        canvas_x: canvasX,
        canvas_y: canvasY,
        canvas_width: canvasW,
        canvas_height: canvasH,
        reference_images: JSON.stringify([imageId || effectiveImageUrl]),
      }) as unknown as Record<string, unknown>;
    } else {
      const supabase = getSupabaseClient();
      const { data, error: dbError } = await supabase
        .from("image_records")
        .insert({
          project_id: originalImage.project_id || null,
          user_id: userId,
          prompt: `[局部重绘] ${prompt}`,
          image_url: finalUrl,
          image_key: objectKey,
          size: aspectRatio,
          model: useModel,
          status: "completed",
          canvas_x: canvasX,
          canvas_y: canvasY,
          canvas_width: canvasW,
          canvas_height: canvasH,
          reference_images: JSON.stringify([imageId || effectiveImageUrl]),
        })
        .select()
        .single();

      if (dbError) {
        console.error("[inpaint] DB insert error:", dbError);
        const normalized = normalizeOperationError({ message: dbError.message || "保存记录失败", status: 500 });
        await updateTrackedOperation(userId, operation.id, { status: "failed", error: toOperationErrorLog(normalized) });
        return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
      }
      newRecord = data as Record<string, unknown>;
    }

    const outputAsset = await createTrackedAsset(userId, {
      projectId: originalImage.project_id,
      kind: "image",
      url: finalUrl,
      key: objectKey,
      width: imgW,
      height: imgH,
      mimeType: "image/png",
      metadata: {
        source: "inpaint",
        imageRecordId: newRecord.id,
        originalImageId: imageId || null,
        operationId: operation.id,
      },
    });
    await createTrackedVersion(userId, {
      assetId: outputAsset.id,
      parentAssetId: inputAsset.id,
      operationId: operation.id,
      label: "局部重绘",
      url: finalUrl,
      key: objectKey,
      metadata: {
        prompt,
        originalImageId: imageId || null,
      },
    });
    await updateTrackedOperation(userId, operation.id, {
      inputAssetIds: [inputAsset.id],
      outputAssetIds: [outputAsset.id],
      status: "completed",
      params: {
        imageId: imageId || null,
        imageRecordId: newRecord.id,
        maskCoverage: paintedCount / (imgW * imgH),
        refKey: uploadedRef.key,
      },
    });

    console.log(`[inpaint] Success! New record: ${newRecord?.id}`);

    return NextResponse.json({
      success: true,
      record: newRecord,
      operationId: operation.id,
      outputAssetId: outputAsset.id,
    });

  } catch (err) {
    console.error("[inpaint] Error:", err);
    const normalized = normalizeOperationError({
      message: err instanceof Error ? err.message : String(err),
      status: 500,
      fallbackMessage: "局部重绘失败",
    });
    if (operationForFailure) {
      await updateTrackedOperation(operationForFailure.userId, operationForFailure.id, {
        status: "failed",
        error: toOperationErrorLog(normalized),
      }).catch(() => {});
    }
    return NextResponse.json(toOperationErrorPayload(normalized), { status: normalized.status });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const userId = getCurrentUserId(request);
    if (!userId) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { imageId, imageUrl, threshold } = body as {
      imageId?: string;
      imageUrl?: string;
      threshold?: number;
    };

    if (!imageId && !imageUrl) {
      return NextResponse.json({ error: "缺少图片信息" }, { status: 400 });
    }

    const originalImage = await getOriginalImageInfo(imageId, imageUrl, userId);
    const effectiveImageUrl = imageUrl || originalImage.image_url;
    const imgBuffer = await loadImageBuffer(effectiveImageUrl);
    const sharp = (await import("sharp")).default;
    const meta = await sharp(imgBuffer).metadata();
    const width = meta.width || originalImage.canvas_width || 1024;
    const height = meta.height || originalImage.canvas_height || 1024;
    const rgbRaw = await sharp(imgBuffer).removeAlpha().raw().toBuffer();

    const normalizedThreshold = Number.isFinite(Number(threshold))
      ? Math.max(12, Math.min(96, Number(threshold)))
      : 42;
    let result = buildSmartSubjectMask(rgbRaw, width, height, normalizedThreshold);

    if (result.subjectRatio < 0.03 || result.subjectRatio > 0.95) {
      result = buildSmartSubjectMask(rgbRaw, width, height, Math.min(96, normalizedThreshold + 18));
    }

    const elementMap = buildElementMapFromSubjectMask(rgbRaw, result.subjectBinary, width, height);
    const effectiveMaskRaw = elementMap.elements.length > 0
      ? buildMaskRawFromBinary(elementMap.filteredSubjectBinary)
      : result.maskRaw;

    const maskPng = await sharp(effectiveMaskRaw, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer();
    const maskBase64 = `data:image/png;base64,${maskPng.toString("base64")}`;

    return NextResponse.json({
      success: true,
      imageId: imageId || originalImage.id || null,
      width,
      height,
      maskBase64,
      idMap: elementMap.idMap,
      elements: elementMap.elements,
      stats: {
        subjectRatio: Number(result.subjectRatio.toFixed(4)),
        backgroundRatio: Number(result.backgroundRatio.toFixed(4)),
        backgroundColor: result.backgroundColor,
        threshold: result.threshold,
        elementCount: elementMap.elements.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "自动选区失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
