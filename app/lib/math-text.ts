export type MathTextSegment = { kind: 'text' | 'math'; value: string };

export function normalizeMathDelimiters(value: string) {
  return value
    .replace(/\\\[([\s\S]*?)\\\]/g, (_match, formula: string) => `$${formula.trim()}$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_match, formula: string) => `$${formula.trim()}$`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (_match, formula: string) => `$${formula.trim()}$`);
}

export function splitMathText(value: string): MathTextSegment[] {
  const normalized = normalizeMathDelimiters(value || '');
  const segments: MathTextSegment[] = [];
  const matcher = /\$([^$\n]+)\$/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(normalized))) {
    if (match.index > cursor) segments.push({ kind: 'text', value: normalized.slice(cursor, match.index) });
    const formula = match[1].trim();
    if (formula) segments.push({ kind: 'math', value: formula });
    cursor = match.index + match[0].length;
  }

  if (cursor < normalized.length) segments.push({ kind: 'text', value: normalized.slice(cursor) });
  return segments.length > 0 ? segments : [{ kind: 'text', value: normalized }];
}

export function containsMath(value: string) {
  return splitMathText(value).some((segment) => segment.kind === 'math');
}

export function collectMathFormulas(values: string[]) {
  return [...new Set(values.flatMap((value) => splitMathText(value)
    .filter((segment) => segment.kind === 'math')
    .map((segment) => segment.value)))];
}
