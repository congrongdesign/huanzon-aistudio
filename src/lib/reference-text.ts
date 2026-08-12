export function buildNumberedReferencePromptText(input: string, references: unknown[] | number): string {
  const referenceCount = Array.isArray(references) ? references.length : Math.max(0, Math.trunc(references || 0));
  const text = String(input || "").replace(/\u00a0/g, " ");
  if (referenceCount <= 0) return text;

  let tokenIndex = 0;
  const replaced = text.replace(/\[@[^\]]*\]/g, () => {
    tokenIndex += 1;
    return tokenIndex <= referenceCount ? `【参考图${tokenIndex}】` : `【参考图${tokenIndex}（未附图）】`;
  });

  const referenceGuide = [
    "",
    "参考图编号说明：",
    ...Array.from({ length: referenceCount }, (_, index) => `- 参考图${index + 1}：对应本消息附带的第 ${index + 1} 张图片。`),
    "请严格按编号理解用户对不同参考图的要求，不要混淆不同参考图的用途。",
  ].join("\n");

  return `${replaced.trimEnd()}${referenceGuide}`;
}
