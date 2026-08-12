import type { EditablePptElementRecord, EditablePptPageRecord } from "./types";

export type EditablePptPageExportMode = "editable" | "hybrid" | "raster";

export function inferPageExportMode(page: Pick<EditablePptPageRecord, "page_mode" | "editable_score" | "unknown_node_ratio">): EditablePptPageExportMode {
  if (page.page_mode === "raster_fallback" || (page.editable_score || 0) < 28) {
    return "raster";
  }
  if ((page.editable_score || 0) >= 72 && (page.unknown_node_ratio || 0) <= 45) {
    return "editable";
  }
  return "hybrid";
}

export function shouldIncludeElementInExport(
  element: Pick<EditablePptElementRecord, "hidden" | "export_mode" | "confidence" | "element_type">,
  mode: EditablePptPageExportMode,
) {
  if (mode === "raster") return false;
  if (element.hidden || element.export_mode === "ignored") return false;

  if (mode === "editable") {
    return true;
  }

  if (element.export_mode === "editable") {
    if (element.element_type === "shape") return true;
    return element.confidence >= 52;
  }

  return element.confidence >= 72;
}

export function shouldShowElementInExportPreview(
  element: Pick<EditablePptElementRecord, "hidden" | "export_mode" | "confidence" | "element_type" | "node_role">,
  mode: EditablePptPageExportMode,
) {
  if (element.node_role === "background") return false;
  return shouldIncludeElementInExport(element, mode);
}
