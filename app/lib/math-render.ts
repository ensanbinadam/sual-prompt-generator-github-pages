import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';

export type RenderedMathImage = {
  dataUrl: string;
  width: number;
  height: number;
};

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const renderCache = new Map<string, Promise<RenderedMathImage>>();

function explicitSvgSize(markup: string) {
  const svgMatch = markup.match(/<svg\b[\s\S]*<\/svg>/i);
  if (!svgMatch) throw new Error('تعذر إنشاء رسم SVG للمعادلة.');
  const source = svgMatch[0].replaceAll('currentColor', '#163c3b');
  const widthEx = Number(source.match(/\bwidth="([\d.]+)ex"/i)?.[1] || 8);
  const heightEx = Number(source.match(/\bheight="([\d.]+)ex"/i)?.[1] || 2.4);
  const width = Math.max(28, Math.min(1200, Math.ceil(widthEx * 12 + 16)));
  const height = Math.max(28, Math.min(360, Math.ceil(heightEx * 14 + 16)));
  const svg = source
    .replace(/\bwidth="[^"]+"/i, `width="${width}"`)
    .replace(/\bheight="[^"]+"/i, `height="${height}"`);
  return { svg, width, height };
}

async function svgToPng(svg: string, width: number, height: number): Promise<RenderedMathImage> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('تعذر إنشاء صورة المعادلة.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function renderFormula(latex: string) {
  const tex = new TeX({ packages: ['base'] });
  const svgOutput = new SVG({ fontCache: 'local', linebreaks: { inline: false } });
  const mathDocument = mathjax.document('', { InputJax: tex, OutputJax: svgOutput });
  const node = mathDocument.convert(latex, { display: false });
  const markup = adaptor.outerHTML(node);
  const { svg, width, height } = explicitSvgSize(markup);
  return svgToPng(svg, width, height);
}

export function renderLatexToPng(latex: string) {
  const key = latex.trim();
  let pending = renderCache.get(key);
  if (!pending) {
    pending = renderFormula(key).catch((error) => {
      renderCache.delete(key);
      throw error;
    });
    renderCache.set(key, pending);
  }
  return pending;
}
