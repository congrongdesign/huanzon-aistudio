type TitleField = { kind: 'title' | 'subtitle'; value: string; start: number; end: number; valueStart: number; valueEnd: number };
export type FontTargetText = { title: string; subtitle?: string };

// Require a delimiter so layout prose such as “主标题和副标题形成文字组” is not text.
function titleFields(text: string): TitleField[] {
  const fields: TitleField[] = [];
  const pattern = /副标题|次标题|子标题|subtitle|subheading|主标题|目标文字|标题文字|标题内容|文字内容|main\s*title|headline|标题|文字/giu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!;
    if (start > 0 && /[a-z\d]/iu.test(text[start - 1])) continue;
    const tail = text.slice(start + match[0].length);
    const prefix = tail.match(/^[ \t]*(?:(?:的)?(?:文字|内容))?[ \t]*(?:(?:改为|改成|替换为|替换成|换成|设置为|是|为)[ \t]*)?(?:[：:=][ \t]*|(?=[“"「『【]))/u);
    if (!prefix) continue;
    let valueStart = start + match[0].length + prefix[0].length;
    while (/\s/u.test(text[valueStart] || '') && valueStart < text.length) valueStart++;
    const closers: Record<string, string> = { '“': '”', '"': '"', '「': '」', '『': '』', '【': '】' };
    const close = closers[text[valueStart]];
    let valueEnd: number, end: number;
    if (close) {
      valueStart++;
      valueEnd = text.indexOf(close, valueStart);
      if (valueEnd < 0) continue;
      end = valueEnd + 1;
    } else {
      const rest = text.slice(valueStart);
      const stop = rest.search(/[\n\r，,。；;]|(?=[ \t]+(?:副标题|次标题|主标题|subtitle)\s*[：:])/iu);
      valueEnd = stop < 0 ? text.length : valueStart + stop;
      end = valueEnd;
    }
    const value = text.slice(valueStart, valueEnd).trim();
    if (value) fields.push({ kind: /副|次|子|^sub/i.test(match[0]) ? 'subtitle' : 'title', value, start, end, valueStart, valueEnd });
  }
  return fields;
}

function usable(value: string) {
  return value && !/(?:在此|这里|此处|请输入|填写|待填|新标题|目标标题|your\s*(?:text|title))/iu.test(value);
}

export function extractFontTargetText(text: string): FontTargetText | null {
  const fields = titleFields(text);
  let title = fields.filter(f => f.kind === 'title' && usable(f.value)).at(-1)?.value;
  const subtitleValue = fields.filter(f => f.kind === 'subtitle').at(-1)?.value;
  const subtitle = subtitleValue && usable(subtitleValue) && !/^(?:无|没有|不要|不需要|不生成|none)$/iu.test(subtitleValue) ? subtitleValue : undefined;
  if (!title) {
    const natural = [...text.matchAll(/(?:文字|标题|字体)(?:内容)?\s*(?:改成|改为|替换为|替换成|换成|是|为)\s*[“"「『]([^”"」』\n]+)[”"」』]/gu)].at(-1);
    title = natural?.[1];
  }
  if (!title) {
    const natural = [...text.matchAll(/(?:文字|标题|字体)(?:内容)?\s*(?:改成|改为|替换为|替换成|换成)\s*([^\n，,。；;]+)/gu)].at(-1);
    title = natural?.[1]?.replace(/^[“"「『]|[”"」』]$/gu, '').trim();
  }
  if (!title) {
    const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const candidate = lines.map(line => line.split(/[，,]/u)[0]).find(line => line.length <= 80 && !/[：:。；;！!？?]/u.test(line) && !/(?:设计|要求|参考|风格|字体|标题|背景|黑底|白底|黑字|白字|配色|装饰|禁止|体现|生成|笔画|英文|图\d)/u.test(line));
    if (candidate && usable(candidate)) title = candidate.replace(/^[“"「『]|[”"」』]$/gu, '');
  }
  return title ? { title, subtitle } : null;
}

export function applyFontTargetText(template: string, target: FontTargetText | null): string {
  if (!target) return template;
  const fields = titleFields(template);
  let result = template;
  for (const field of [...fields].reverse()) {
    const value = field.kind === 'title' ? target.title : target.subtitle;
    result = value
      ? result.slice(0, field.valueStart) + value + result.slice(field.valueEnd)
      : result.slice(0, field.start) + result.slice(field.end).replace(/^[ \t]*[。；;]?[ \t]*\n?/, '');
  }
  // Some templates use a placeholder without a field label.
  result = result.replace(/【(?:在此|请在此|请输入|请填写|填写)[^】]*(?:标题|文字)[^】]*】/gu, target.title);
  if (!fields.some(f => f.kind === 'title') && !result.includes(target.title)) result = `主标题：${target.title}\n${result}`;
  if (target.subtitle && !fields.some(f => f.kind === 'subtitle')) result = `副标题：${target.subtitle}\n${result}`;
  if (!target.subtitle && fields.some(f => f.kind === 'subtitle')) result += '\n只生成主标题，不生成副标题。';
  return result.replace(/\n{3,}/g, '\n\n').trim();
}
