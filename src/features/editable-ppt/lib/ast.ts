import type {
  EditablePptElementRecord,
  EditablePptPageRecord,
  EditablePptStructureMetrics,
  EditablePptStructureNode,
  EditablePptStructureRoot,
} from "./types";

export function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseWarnings(value: string | null | undefined) {
  const parsed = safeJsonParse<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function inferSourceKind(sourceRef: string | null | undefined): "pptx" | "pdf" | "image" {
  if (!sourceRef) return "image";
  if (sourceRef.startsWith("pptx")) return "pptx";
  if (sourceRef.startsWith("pdf")) return "pdf";
  return "image";
}

export function parseStructureRoot(page: EditablePptPageRecord): EditablePptStructureRoot | null {
  const fallbackMetrics: EditablePptStructureMetrics = {
    totalNodes: 0,
    textNodes: 0,
    imageNodes: 0,
    shapeNodes: 0,
    rasterNodes: 0,
    lowConfidenceNodes: 0,
    textLineCount: 0,
    paragraphCount: 0,
    groupedTextCount: 0,
    averageTextConfidence: 0,
    editableCoverage: 0,
    editableScore: page.editable_score || 0,
    textRecoveryScore: page.text_recovery_score || 0,
    layoutRecoveryScore: page.layout_recovery_score || 0,
    unknownNodeRatio: page.unknown_node_ratio || 0,
  };

  return safeJsonParse<EditablePptStructureRoot | null>(page.structure_json, null) || {
    version: 2,
    pageId: page.id,
    pageNumber: page.page_number,
    width: page.width,
    height: page.height,
    sourceKind: "image",
    pageMode: page.page_mode || "ocr",
    editableScore: page.editable_score || 0,
    textRecoveryScore: page.text_recovery_score || 0,
    layoutRecoveryScore: page.layout_recovery_score || 0,
    unknownNodeRatio: page.unknown_node_ratio || 0,
    warnings: parseWarnings(page.warnings_json),
    metrics: safeJsonParse<EditablePptStructureMetrics>(page.metrics_json, fallbackMetrics),
    children: [],
  };
}

export function buildPageAst(page: EditablePptPageRecord, elements: EditablePptElementRecord[]) {
  const sorted = elements.slice().sort((a, b) => a.z_index - b.z_index);
  const roots: EditablePptStructureNode[] = [];
  const nodeMap = new Map<string, EditablePptStructureNode>();

  for (const element of sorted) {
    const node: EditablePptStructureNode = {
      id: element.id,
      type: element.element_type === "chart_or_complex" ? "chart" : element.element_type,
      role: element.node_role || "unknown",
      bbox: [element.bbox_x, element.bbox_y, element.bbox_w, element.bbox_h],
      zIndex: element.z_index,
      confidence: element.confidence,
      fallbackStrategy: element.export_mode === "raster" ? "rasterize" : "editable",
      exportMode: element.export_mode,
      sourceRef: element.source_ref,
      assetKey: element.asset_key,
      assetUrl: element.asset_url,
      textContent: element.text_content,
      style: safeJsonParse<Record<string, unknown>>(element.style_json, {}),
      children: [],
    };
    nodeMap.set(element.id, node);
  }

  for (const element of sorted) {
    const node = nodeMap.get(element.id);
    if (!node) continue;
    if (element.parent_id && nodeMap.has(element.parent_id)) {
      const parent = nodeMap.get(element.parent_id)!;
      parent.children = parent.children || [];
      parent.children.push(node);
      continue;
    }
    roots.push(node);
  }

  const sourceKind = sorted.length > 0 ? inferSourceKind(sorted[0].source_ref) : "image";
  const parsedMetrics = safeJsonParse<EditablePptStructureMetrics | null>(page.metrics_json, null);
  const warnings = parseWarnings(page.warnings_json);

  return {
    version: 2,
    pageId: page.id,
    pageNumber: page.page_number,
    width: page.width,
    height: page.height,
    title: page.title,
    role: page.role,
    sourceKind,
    pageMode: page.page_mode || "ocr",
    editableScore: page.editable_score || 0,
    textRecoveryScore: page.text_recovery_score || 0,
    layoutRecoveryScore: page.layout_recovery_score || 0,
    unknownNodeRatio: page.unknown_node_ratio || 0,
    warnings,
    metrics: parsedMetrics || {
      totalNodes: roots.length,
      textNodes: sorted.filter((item) => item.element_type === "text").length,
      imageNodes: sorted.filter((item) => item.element_type === "image").length,
      shapeNodes: sorted.filter((item) => item.element_type === "shape").length,
      rasterNodes: sorted.filter((item) => item.export_mode === "raster").length,
      lowConfidenceNodes: sorted.filter((item) => item.confidence < 55).length,
      textLineCount: sorted.filter((item) => item.element_type === "text").length,
      paragraphCount: sorted.filter((item) => item.element_type === "text").length,
      groupedTextCount: sorted.filter((item) => item.element_type === "text" && item.group_id).length,
      averageTextConfidence: 0,
      editableCoverage: 0,
      editableScore: page.editable_score || 0,
      textRecoveryScore: page.text_recovery_score || 0,
      layoutRecoveryScore: page.layout_recovery_score || 0,
      unknownNodeRatio: page.unknown_node_ratio || 0,
    },
    background: {
      type: page.cleaned_background_url ? "cleaned_background" : "source_image",
      imageUrl: page.cleaned_background_url || page.source_image_url,
      sourceImageUrl: page.source_image_url,
    },
    children: roots,
    elements: sorted.map((element) => ({
      id: element.id,
      type: element.element_type,
      bbox: [element.bbox_x, element.bbox_y, element.bbox_w, element.bbox_h],
      zIndex: element.z_index,
      rotation: element.rotation,
      opacity: element.opacity,
      groupId: element.group_id,
      parentId: element.parent_id,
      confidence: element.confidence,
      role: element.node_role,
      exportMode: element.export_mode,
      textContent: element.text_content,
      style: safeJsonParse<Record<string, unknown>>(element.style_json, {}),
      assetUrl: element.asset_url,
      hidden: element.hidden,
      locked: element.locked,
      sourceRef: element.source_ref,
    })),
  };
}
