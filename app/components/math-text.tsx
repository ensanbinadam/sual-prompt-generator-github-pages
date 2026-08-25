'use client';

import { useMemo } from 'react';
import katex from 'katex';
import { splitMathText } from '../lib/math-text';

export function MathText({ value }: { value: string }) {
  const segments = useMemo(() => splitMathText(value), [value]);

  return (
    <span className="rich-math-text">
      {segments.map((segment, index) => {
        if (segment.kind === 'text') return <span key={index}>{segment.value}</span>;
        try {
          const html = katex.renderToString(segment.value, {
            displayMode: false,
            output: 'htmlAndMathml',
            strict: 'ignore',
            throwOnError: true,
            trust: false,
          });
          return <span className="math-expression" dir="ltr" key={index} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch {
          return <span className="math-expression math-fallback" dir="ltr" key={index}>{segment.value}</span>;
        }
      })}
    </span>
  );
}
