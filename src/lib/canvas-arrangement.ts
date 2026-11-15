import { canvasConnections } from './canvas-lineage';
import type { CanvasImage } from './types';

type Batch = { batchId: string; index: number };
type Size = { w: number; h: number };
type Placement = { x: number; y: number };
type Options = {
  getSize: (image: CanvasImage) => Size;
  batchFor?: (image: CanvasImage) => Batch | undefined;
  origin: Placement;
  rowWidth?: number;
};

const GAP = 48;
const STAGE_GAP = 180;
const SECTION_GAP = 144;
const time = (image: CanvasImage) => Date.parse(image.created_at) || 0;

/** Bounded contact sheets, packed by area rather than a fixed number of columns. */
function contactSheet(items: CanvasImage[], getSize: Options['getSize'], sourceLayer: boolean) {
  const cells = new Map<string, Placement>();
  const width = Math.max(...items.map(image => getSize(image).w));
  const maxHeight = Math.max(...items.map(image => getSize(image).h));
  const tileSize = 16;
  const tiles: { items: CanvasImage[]; columns: number; rows: number[]; width: number; height: number }[] = [];
  for (let start = 0; start < items.length; start += tileSize) {
    const chunk = items.slice(start, start + tileSize);
    // Small families keep their familiar two-column layout. Bigger ones balance
    // the actual image proportions, with at most four rows in each contact sheet.
    const columns = sourceLayer && items.length <= 4 ? 1 : chunk.length <= 8 ? Math.min(2, chunk.length)
      : Math.min(chunk.length, Math.max(Math.ceil(chunk.length / 4), Math.round(Math.sqrt(chunk.length * maxHeight * 1.3 / width))));
    const rows: number[] = [];
    chunk.forEach((image, i) => { const row = Math.floor(i / columns); rows[row] = Math.max(rows[row] || 0, getSize(image).h); });
    tiles.push({ items: chunk, columns, rows, width: columns * width + (columns - 1) * GAP,
      height: rows.reduce((sum, h) => sum + h, 0) + GAP * (rows.length - 1) });
  }
  const tileWidth = Math.max(...tiles.map(tile => tile.width));
  const tileHeight = Math.max(...tiles.map(tile => tile.height));
  const tileColumns = Math.min(tiles.length, Math.max(1, Math.round(Math.sqrt(tiles.length * tileHeight * 1.4 / tileWidth))));
  tiles.forEach((tile, index) => {
    const x = (index % tileColumns) * (tileWidth + SECTION_GAP);
    let y = Math.floor(index / tileColumns) * (tileHeight + SECTION_GAP);
    tile.items.forEach((image, i) => {
      if (i && i % tile.columns === 0) y += tile.rows[Math.floor(i / tile.columns) - 1] + GAP;
      cells.set(image.id, { x: x + (i % tile.columns) * (width + GAP), y });
    });
  });
  return { cells, width: Math.min(tileColumns, tiles.length) * (tileWidth + SECTION_GAP) - SECTION_GAP,
    height: Math.ceil(tiles.length / tileColumns) * (tileHeight + SECTION_GAP) - SECTION_GAP };
}

/** Stable family ordering; viewport scale and previous positions never affect topology. */
export function arrangeCanvasFamilies(images: readonly CanvasImage[], options: Options): Map<string, Placement> {
  const { getSize, batchFor = () => undefined, origin, rowWidth = 2600 } = options;
  const byId = new Map(images.map(image => [image.id, image]));
  const sorted = [...images].sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));
  const order = new Map(sorted.map((image, index) => [image.id, index]));
  const compare = (a: CanvasImage, b: CanvasImage) => {
    const ab = batchFor(a), bb = batchFor(b);
    return ab && bb && ab.batchId === bb.batchId ? ab.index - bb.index || order.get(a.id)! - order.get(b.id)! : order.get(a.id)! - order.get(b.id)!;
  };
  const parents = new Map<string, string[]>(), children = new Map<string, string[]>();
  const representatives = new Map(sorted.map(image => [image.id, image.id]));
  const find = (id: string): string => {
    let root = id;
    while (representatives.get(root) !== root) root = representatives.get(root)!;
    while (id !== root) { const next = representatives.get(id)!; representatives.set(id, root); id = next; }
    return root;
  };
  const unite = (a: string, b: string) => representatives.set(find(b), find(a));
  for (const edge of canvasConnections(images)) {
    parents.set(edge.target, [...(parents.get(edge.target) || []), edge.source]);
    children.set(edge.source, [...(children.get(edge.source) || []), edge.target]);
    unite(edge.source, edge.target);
  }
  // Unrelated generations keep their batch together without inventing a lineage.
  const looseGroups = new Map<string, string>();
  for (const image of sorted) {
    if (parents.has(image.id) || children.has(image.id)) continue;
    const batch = batchFor(image);
    const prompt = image.prompt.replace(/\[[^\]]+\]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 80);
    const key = `${image.project_id}:` + (batch ? `batch:${batch.batchId}` : `prompt:${Math.floor(time(image) / 300000)}:${image.model}:${prompt}`);
    const first = looseGroups.get(key);
    if (first) unite(first, image.id); else looseGroups.set(key, image.id);
  }
  const families = new Map<string, CanvasImage[]>();
  for (const image of sorted) { const key = find(image.id); families.set(key, [...(families.get(key) || []), image]); }
  const positions = new Map<string, Placement>();
  // The whole canvas also grows in both directions as the collection grows.
  const area = sorted.reduce((sum, image) => { const s = getSize(image); return sum + (s.w + GAP) * (s.h + GAP); }, 0);
  const packingWidth = Math.max(rowWidth, Math.sqrt(area * 1.7));
  let familyX = origin.x, familyY = origin.y, rowHeight = 0;
  for (const family of families.values()) {
    const familyIds = new Set(family.map(image => image.id));
    const indegree = new Map(family.map(image => [image.id, (parents.get(image.id) || []).filter(id => familyIds.has(id)).length]));
    const rank = new Map(family.map(image => [image.id, 0]));
    const remaining = new Set(family.map(image => image.id));
    const ready = family.filter(image => !indegree.get(image.id)).map(image => image.id);
    while (remaining.size) {
      // Broken old metadata can form a cycle. Break it deterministically, never recurse.
      const id = ready.shift() || remaining.values().next().value!;
      if (!remaining.delete(id)) continue;
      for (const child of children.get(id) || []) {
        if (!remaining.has(child)) continue;
        rank.set(child, Math.max(rank.get(child)!, rank.get(id)! + 1));
        indegree.set(child, indegree.get(child)! - 1);
        if (!indegree.get(child)) ready.push(child);
      }
    }
    const layers = new Map<number, CanvasImage[]>();
    for (const image of family) { const depth = rank.get(image.id)!; layers.set(depth, [...(layers.get(depth) || []), image]); }
    const local = new Map<string, Placement>();
    if (layers.size > 2 && layers.size <= 12) {
      // Reserve room for an image AND its edits inside the same sheet cell.
      // A later edit is never pushed past every unrelated sibling in its family.
      type Branch = { positions: Map<string, Placement>; width: number; height: number };
      const owned = new Map<string, CanvasImage[]>();
      const hasOwner = new Set<string>();
      for (const image of family) {
        const owner = (parents.get(image.id) || []).find(id => rank.get(id)! < rank.get(image.id)!);
        if (owner) { const group = owned.get(owner) || []; group.push(image); owned.set(owner, group); hasOwner.add(image.id); }
      }
      const branches = new Map<string, Branch>();
      for (const [, layer] of [...layers].sort(([a], [b]) => b - a)) for (const image of layer) {
        const descendants = (owned.get(image.id) || []).sort(compare);
        const size = getSize(image);
        if (!descendants.length) { branches.set(image.id, { positions: new Map([[image.id, { x: 0, y: 0 }]]), width: size.w, height: size.h }); continue; }
        const sheet = contactSheet(descendants, child => { const branch = branches.get(child.id)!; return { w: branch.width, h: branch.height }; }, false);
        const positions = new Map<string, Placement>([[image.id, { x: 0, y: Math.max(0, (sheet.height - size.h) / 2) }]]);
        for (const child of descendants) {
          const p = sheet.cells.get(child.id)!, branch = branches.get(child.id)!;
          for (const [id, position] of branch.positions) positions.set(id, { x: size.w + STAGE_GAP + p.x + position.x, y: p.y + position.y });
        }
        branches.set(image.id, { positions, width: size.w + STAGE_GAP + sheet.width, height: Math.max(size.h, sheet.height) });
      }
      const roots = family.filter(image => !hasOwner.has(image.id));
      const sheet = contactSheet(roots, image => { const branch = branches.get(image.id)!; return { w: branch.width, h: branch.height }; }, false);
      for (const root of roots) {
        const p = sheet.cells.get(root.id)!;
        for (const [id, position] of branches.get(root.id)!.positions) local.set(id, { x: p.x + position.x, y: p.y + position.y });
      }
    } else {
    const grids = new Map<string, { top: number; height: number }>();
    const familyArea = family.reduce((sum, image) => { const size = getSize(image); return sum + (size.w + GAP) * (size.h + GAP); }, 0);
    const familyWrapWidth = Math.max(rowWidth, Math.sqrt(familyArea * 1.7));
    let layerX = 0, stageRowY = 0, stageRowHeight = 0;
    for (const [depth, layer] of [...layers].sort(([a], [b]) => a - b)) {
      const groups = new Map<string, CanvasImage[]>();
      for (const image of layer) {
        const parent = (parents.get(image.id) || []).find(id => rank.get(id)! < depth);
        const key = parent || 'roots';
        groups.set(key, [...(groups.get(key) || []), image]);
      }
      const center = (key: string) => { const p = local.get(key), image = byId.get(key); return p && image ? p.y + getSize(image).h / 2 : 0; };
      const sourceLayer = depth === 0 && layers.size > 1;
      const stage = new Map<string, Placement>();
      let layerWidth = 0, cursorY = 0, groupX = 0, groupRowHeight = 0;
      const groupArea = [...groups.values()].reduce((sum, items) => { const sheet = contactSheet(items, getSize, sourceLayer); return sum + (sheet.width + SECTION_GAP) * (sheet.height + SECTION_GAP); }, 0);
      const groupRowWidth = Math.max(rowWidth, Math.sqrt(groupArea * 1.4));
      for (const [key, items] of [...groups].sort(([a], [b]) => center(a) - center(b))) {
        items.sort(compare);
        const sheet = contactSheet(items, getSize, sourceLayer);
        const height = sheet.height;
        if (groups.size > 8 && groupX > 0 && groupX + sheet.width > groupRowWidth) {
          groupX = 0; cursorY += groupRowHeight + SECTION_GAP; groupRowHeight = 0;
        }
        const top = groups.size > 8 ? cursorY : Math.max(cursorY, center(key) - stageRowY - height / 2);
        for (const [id, p] of sheet.cells) stage.set(id, { x: groupX + p.x, y: top + p.y });
        grids.set(key, { top: top + stageRowY, height });
        layerWidth = Math.max(layerWidth, groupX + sheet.width);
        if (groups.size > 8) { groupX += sheet.width + SECTION_GAP; groupRowHeight = Math.max(groupRowHeight, height); }
        else cursorY = top + height + SECTION_GAP;
      }
      const minStageY = Math.min(...[...stage.values()].map(p => p.y));
      if (depth > 1 && layerX > 0 && layerX + layerWidth > familyWrapWidth) {
        layerX = 0; stageRowY += stageRowHeight + SECTION_GAP; stageRowHeight = 0;
        for (const p of stage.values()) p.y -= minStageY;
      }
      for (const [id, p] of stage) local.set(id, { x: layerX + p.x, y: stageRowY + p.y });
      stageRowHeight = Math.max(stageRowHeight, ...layer.map(image => stage.get(image.id)!.y + getSize(image).h));
      layerX += layerWidth + STAGE_GAP;
    }
    // One reference sits at the centre of its result sheet, like the user's layout.
    const roots = layers.get(0)!;
    if (layers.size > 1 && roots.length <= 4 && (layers.get(1) || []).every(image => local.get(image.id)!.x > local.get(roots[0].id)!.x + getSize(roots[0]).w)) {
      let bottom = -Infinity;
      for (const root of roots) {
        const grid = grids.get(root.id), size = getSize(root), current = local.get(root.id)!;
        const desired = grid ? grid.top + (grid.height - size.h) / 2 : current.y;
        const y = Math.max(desired, bottom + GAP);
        local.set(root.id, { x: current.x, y }); bottom = y + size.h;
      }
    }
    }
    const minY = Math.min(...[...local.values()].map(p => p.y));
    const width = Math.max(...family.map(image => local.get(image.id)!.x + getSize(image).w));
    const height = Math.max(...family.map(image => local.get(image.id)!.y + getSize(image).h)) - minY;
    if (familyX > origin.x && familyX + width > origin.x + packingWidth) { familyX = origin.x; familyY += rowHeight + SECTION_GAP; rowHeight = 0; }
    for (const [id, p] of local) positions.set(id, { x: Math.round(familyX + p.x), y: Math.round(familyY + p.y - minY) });
    familyX += width + SECTION_GAP;
    rowHeight = Math.max(rowHeight, height);
  }
  return positions;
}
