import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  LevelFormat,
  LevelSuffix,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextDirection,
  TextRun,
  UnderlineType,
  VerticalAlignTable,
  WidthType,
  type TableVerticalAlign,
  type ParagraphChild,
} from 'docx';
import { latexToDocxMath } from './latex-docx';
import { collectMathFormulas, splitMathText } from './math-text';

export type DocxQuestion = {
  id: string;
  type: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  sourceHint: string;
  points: number;
  imageDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  sourceImage?: { caption?: string };
};

export type DocxExamHeader = {
  testTitle: string;
  school: string;
  subject: string;
  teacher: string;
  grade: string;
  section: string;
  term: string;
  date: string;
  duration: string;
  totalScore: string;
};

export type DocxExamPayload = {
  title: string;
  summary: string;
  questions: DocxQuestion[];
  header: DocxExamHeader;
  numeralStyle: 'arabic_indic' | 'western';
  mathWordMode: 'images' | 'latex';
};

export type DocxVariant = 'questions' | 'answers';

const COLORS = {
  ink: '163C3B',
  teal: '087F76',
  tealDark: '06665F',
  tealPale: 'E7F5F0',
  green: '18794E',
  greenPale: 'EAF7EF',
  muted: '667C79',
  line: 'C7D8D2',
  soft: 'F5F9F7',
  white: 'FFFFFF',
};

const PAGE_WIDTH = 11906; // A4 portrait
const PAGE_HEIGHT = 16838;
const PAGE_MARGIN = 900;
const CONTENT_WIDTH = PAGE_WIDTH - (PAGE_MARGIN * 2);
const TABLE_INDENT = 120;
const CELL_MARGIN = { top: 100, bottom: 100, left: 140, right: 140 };
const FONT = 'Arial';

type MathImageAsset = { dataUrl: string; width: number; height: number };
type MathRenderContext = { mode: DocxExamPayload['mathWordMode']; images: Map<string, MathImageAsset> };

function payloadMathValues(payload: DocxExamPayload) {
  return payload.questions.flatMap((question) => [
    question.question,
    ...question.options,
    question.correctAnswer,
    question.explanation,
  ]);
}

async function prepareMathContext(payload: DocxExamPayload): Promise<MathRenderContext> {
  const context: MathRenderContext = { mode: payload.mathWordMode, images: new Map() };
  if (payload.mathWordMode !== 'images') return context;
  const formulas = collectMathFormulas(payloadMathValues(payload));
  if (formulas.length === 0) return context;
  const { renderLatexToPng } = await import('./math-render');
  for (const formula of formulas) {
    try {
      context.images.set(formula, await renderLatexToPng(formula));
    } catch (caught) {
      console.warn(`تعذر تحويل المعادلة إلى صورة: ${formula}`, caught);
      // The native Word equation fallback below keeps the formula visible and editable.
    }
  }
  return context;
}

function formatDocxDigits(value: string | number, style: DocxExamPayload['numeralStyle']) {
  const western = String(value).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  return style === 'arabic_indic' ? western.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]) : western;
}

function imageData(value: string) {
  const encoded = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value;
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: COLORS.line };

function rtlRun(text: string, options: { bold?: boolean; color?: string; size?: number; highlight?: string } = {}) {
  return new TextRun({
    text,
    font: FONT,
    size: options.size || 22,
    sizeComplexScript: options.size || 22,
    bold: options.bold,
    color: options.color || COLORS.ink,
    rightToLeft: true,
    shading: options.highlight ? { type: ShadingType.CLEAR, fill: options.highlight, color: 'auto' } : undefined,
  });
}

function richRuns(value: string, context: MathRenderContext, options: { bold?: boolean; color?: string; size?: number; highlight?: string } = {}): ParagraphChild[] {
  return splitMathText(value).flatMap((segment): ParagraphChild[] => {
    if (segment.kind === 'text') return segment.value ? [rtlRun(segment.value, options)] : [];
    const asset = context.images.get(segment.value);
    if (context.mode === 'images' && asset) {
      const naturalWidth = Math.max(1, asset.width);
      const naturalHeight = Math.max(1, asset.height);
      const complex = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|begin)\b/.test(segment.value);
      let height = complex ? 34 : 22;
      let width = Math.max(18, Math.round((naturalWidth / naturalHeight) * height));
      if (width > 420) {
        height = Math.max(18, Math.round((height / width) * 420));
        width = 420;
      }
      return [new ImageRun({
        type: 'png',
        data: imageData(asset.dataUrl),
        transformation: { width, height },
        altText: { title: 'معادلة رياضية', description: segment.value, name: 'math-expression' },
      })];
    }
    return [latexToDocxMath(segment.value)];
  });
}

function rtlParagraph(text: string, options: {
  bold?: boolean;
  color?: string;
  size?: number;
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  before?: number;
  after?: number;
  keepNext?: boolean;
  shading?: string;
  style?: string;
} = {}) {
  return new Paragraph({
    style: options.style,
    bidirectional: true,
    alignment: options.alignment || AlignmentType.RIGHT,
    keepNext: options.keepNext,
    spacing: { before: options.before || 0, after: options.after ?? 100, line: 300 },
    shading: options.shading ? { type: ShadingType.CLEAR, fill: options.shading, color: 'auto' } : undefined,
    children: [rtlRun(text, options)],
  });
}

function metaLine(label: string, value: string) {
  return new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    spacing: { after: 55, line: 280 },
    children: [
      rtlRun(`${label}: `, { bold: true, size: 18, color: COLORS.tealDark }),
      rtlRun(value.trim() || '........................', { size: 18 }),
    ],
  });
}

function tableCell(children: Paragraph[], width: number, options: { fill?: string; alignment?: TableVerticalAlign } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    margins: CELL_MARGIN,
    verticalAlign: options.alignment || VerticalAlignTable.CENTER,
    textDirection: TextDirection.LEFT_TO_RIGHT_TOP_TO_BOTTOM,
    shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill, color: 'auto' } : undefined,
    borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
    children,
  });
}

function createExamHeader(payload: DocxExamPayload, variant: DocxVariant) {
  const { header } = payload;
  const digits = (value: string | number) => formatDocxDigits(value, payload.numeralStyle);
  const total = digits(header.totalScore.trim() || String(payload.questions.reduce((sum, question) => sum + (Number(question.points) || 0), 0)));
  const title = header.testTitle.trim() || payload.title || 'اختبار تحصيلي';
  const widths = [3370, 3366, 3370];

  const main = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    indent: { size: TABLE_INDENT, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    visuallyRightToLeft: true,
    rows: [new TableRow({
      cantSplit: true,
      children: [
        tableCell([
          metaLine('المدرسة', digits(header.school)),
          metaLine('المادة', digits(header.subject)),
          metaLine('المعلم/ة', digits(header.teacher)),
        ], widths[0], { fill: COLORS.soft }),
        tableCell([
          rtlParagraph(title, { bold: true, size: 30, alignment: AlignmentType.CENTER, color: COLORS.tealDark, after: 90 }),
          rtlParagraph(variant === 'answers' ? 'نموذج الإجابة' : (header.term.trim() || 'ورقة الأسئلة'), { bold: true, size: 20, alignment: AlignmentType.CENTER, color: variant === 'answers' ? COLORS.green : COLORS.muted, after: 0 }),
        ], widths[1], { fill: COLORS.white }),
        tableCell([
          metaLine('الصف', digits(header.grade)),
          metaLine('الفصل/الشعبة', digits(header.section)),
          metaLine('التاريخ', digits(header.date)),
        ], widths[2], { fill: COLORS.soft }),
      ],
    })],
  });

  const studentWidths = variant === 'answers' ? [CONTENT_WIDTH] : [4500, 2700, 2906];
  const student = new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    indent: { size: TABLE_INDENT, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: studentWidths,
    visuallyRightToLeft: true,
    rows: [new TableRow({
      cantSplit: true,
      children: variant === 'answers'
        ? [
            tableCell([rtlParagraph('نموذج إجابة ملون وقابل للتعديل', { bold: true, color: COLORS.green, alignment: AlignmentType.CENTER, after: 0 })], CONTENT_WIDTH, { fill: COLORS.greenPale }),
          ]
        : [
            tableCell([metaLine('اسم الطالب/ة', '................................................')], studentWidths[0]),
            tableCell([metaLine('الزمن', digits(header.duration))], studentWidths[1]),
            tableCell([metaLine('الدرجة', `........ / ${total}`)], studentWidths[2]),
          ],
    })],
  });

  return [main, new Paragraph({ spacing: { after: 70 } }), student, new Paragraph({ spacing: { after: 220 } })];
}

function splitPair(value: string) {
  const parts = value.split(/\s+[—–-]\s+/);
  return parts.length >= 2 ? [parts[0].trim(), parts.slice(1).join(' - ').trim()] : [value.trim(), ''];
}

function isCorrectOption(option: string, answer: string) {
  const normalizedOption = option.replace(/^\s*[أ-يA-Za-z0-9]+[).،:-]\s*/, '').trim().toLowerCase();
  const normalizedAnswer = answer.trim().toLowerCase();
  return normalizedOption.length > 0 && (normalizedAnswer === normalizedOption || normalizedAnswer.includes(normalizedOption));
}

function answerLine() {
  return new Paragraph({
    bidirectional: true,
    spacing: { before: 80, after: 190 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: COLORS.line } },
    children: [new TextRun({ text: ' ', underline: { type: UnderlineType.NONE } })],
  });
}

function optionsParagraphs(question: DocxQuestion, questionIndex: number, variant: DocxVariant, math: MathRenderContext) {
  return question.options.map((option) => {
    const correct = variant === 'answers' && isCorrectOption(option, question.correctAnswer);
    return new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      numbering: { reference: 'exam-options', level: 0, instance: questionIndex + 1 },
      spacing: { before: 0, after: 70, line: 290 },
      shading: correct ? { type: ShadingType.CLEAR, fill: COLORS.greenPale, color: 'auto' } : undefined,
      children: richRuns(option, math, { color: correct ? COLORS.green : COLORS.ink, bold: correct }),
    });
  });
}

function wordBank(question: DocxQuestion, math: MathRenderContext) {
  return new Table({
    width: { size: CONTENT_WIDTH - 500, type: WidthType.DXA },
    indent: { size: 360, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [CONTENT_WIDTH - 500],
    visuallyRightToLeft: true,
    rows: [new TableRow({
      cantSplit: true,
      children: [tableCell([
        new Paragraph({
          bidirectional: true,
          alignment: AlignmentType.CENTER,
          spacing: { after: 0, line: 300 },
          children: richRuns(`صندوق الكلمات: ${question.options.join('  |  ')}`, math, { bold: true, color: COLORS.tealDark }),
        }),
      ], CONTENT_WIDTH - 500, { fill: COLORS.tealPale })],
    })],
  });
}

function pairsTable(question: DocxQuestion, variant: DocxVariant, kind: 'matching' | 'classification', math: MathRenderContext) {
  const pairs = question.options.map(splitPair);
  const rightValues = variant === 'answers' ? pairs.map((pair) => pair[1]) : [...pairs.map((pair) => pair[1])].reverse();
  const widths = kind === 'matching' ? [5000, 5106] : [6500, 3606];
  const labels = kind === 'matching' ? ['العمود (أ)', 'العمود (ب)'] : ['العنصر', variant === 'answers' ? 'التصنيف الصحيح' : 'اكتب التصنيف'];
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    indent: { size: TABLE_INDENT, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    visuallyRightToLeft: true,
    rows: [
      new TableRow({
        tableHeader: true,
        cantSplit: true,
        children: labels.map((label, index) => tableCell([
          rtlParagraph(label, { bold: true, alignment: AlignmentType.CENTER, color: COLORS.white, after: 0 }),
        ], widths[index], { fill: COLORS.teal })),
      }),
      ...pairs.map((pair, index) => new TableRow({
        cantSplit: true,
        children: [
          tableCell([new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, spacing: { after: 0, line: 300 }, children: richRuns(pair[0], math) })], widths[0]),
          tableCell([
            new Paragraph({
              bidirectional: true,
              alignment: AlignmentType.RIGHT,
              spacing: { after: 0, line: 300 },
              children: richRuns(
                kind === 'classification' && variant === 'questions' ? '................................' : rightValues[index],
                math,
                { bold: variant === 'answers', color: variant === 'answers' ? COLORS.green : COLORS.ink },
              ),
            }),
          ], widths[1], { fill: variant === 'answers' ? COLORS.greenPale : COLORS.white }),
        ],
      })),
    ],
  });
}

function responseSpace(type: string) {
  const count = type === 'essay' ? 5 : type === 'short_answer' ? 2 : type === 'fill_blank' ? 1 : 0;
  return Array.from({ length: count }, answerLine);
}

function questionBlock(question: DocxQuestion, index: number, variant: DocxVariant, numeralStyle: DocxExamPayload['numeralStyle'], math: MathRenderContext) {
  const items: Array<Paragraph | Table> = [];
  const points = Number(question.points) || 1;
  items.push(new Paragraph({
    style: 'ExamQuestion',
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    keepNext: true,
    spacing: { before: index === 0 ? 0 : 170, after: 110, line: 320 },
    children: [
      rtlRun(`${formatDocxDigits(index + 1, numeralStyle)}. `, { bold: true, color: COLORS.teal, size: 24 }),
      ...richRuns(question.question, math, { bold: true, size: 24 }),
      rtlRun(`  (${formatDocxDigits(points, numeralStyle)} ${points === 1 ? 'درجة' : 'درجات'})`, { bold: true, color: COLORS.teal, size: 18 }),
    ],
  }));

  if (question.imageDataUrl) {
    const naturalWidth = Math.max(1, question.imageWidth || 1000);
    const naturalHeight = Math.max(1, question.imageHeight || 650);
    const width = Math.min(520, naturalWidth);
    const height = Math.max(80, Math.round((naturalHeight / naturalWidth) * width));
    items.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      keepNext: Boolean(question.sourceImage?.caption),
      spacing: { before: 40, after: question.sourceImage?.caption ? 35 : 100 },
      children: [new ImageRun({
        type: 'png',
        data: imageData(question.imageDataUrl),
        transformation: { width, height },
        altText: { title: question.sourceImage?.caption || 'شكل من المصدر', description: question.sourceImage?.caption || 'شكل مستخرج من ملف المصدر', name: 'source-figure' },
      })],
    }));
    if (question.sourceImage?.caption) items.push(rtlParagraph(question.sourceImage.caption, { size: 17, color: COLORS.muted, alignment: AlignmentType.CENTER, after: 100 }));
  }

  if (question.type === 'word_bank' && question.options.length > 0) {
    items.push(wordBank(question, math));
  } else if (question.type === 'matching' && question.options.length > 0) {
    items.push(pairsTable(question, variant, 'matching', math));
  } else if (question.type === 'classification' && question.options.length > 0) {
    items.push(pairsTable(question, variant, 'classification', math));
  } else if (question.options.length > 0) {
    items.push(...optionsParagraphs(question, index, variant, math));
  }

  if (variant === 'questions') {
    items.push(...responseSpace(question.type));
  } else {
    items.push(new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      keepNext: Boolean(question.explanation || question.sourceHint),
      spacing: { before: 100, after: 80, line: 300 },
      shading: { type: ShadingType.CLEAR, fill: COLORS.greenPale, color: 'auto' },
      border: {
        top: { style: BorderStyle.SINGLE, size: 5, color: COLORS.green },
        bottom: { style: BorderStyle.SINGLE, size: 5, color: COLORS.green },
        left: { style: BorderStyle.SINGLE, size: 5, color: COLORS.green },
        right: { style: BorderStyle.SINGLE, size: 5, color: COLORS.green },
      },
      children: [
        rtlRun('الإجابة الصحيحة: ', { bold: true, color: COLORS.green }),
        ...richRuns(question.correctAnswer || 'غير محددة', math, { bold: true, color: COLORS.green }),
      ],
    }));
    if (question.explanation) {
      items.push(new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        keepNext: Boolean(question.sourceHint),
        spacing: { after: 60, line: 290 },
        children: [rtlRun('التفسير: ', { bold: true, color: COLORS.tealDark, size: 19 }), ...richRuns(question.explanation, math, { size: 19, color: COLORS.muted })],
      }));
    }
    if (question.sourceHint) {
      items.push(new Paragraph({
        bidirectional: true,
        alignment: AlignmentType.RIGHT,
        spacing: { after: 110, line: 280 },
        children: [rtlRun('من المصدر: ', { bold: true, color: COLORS.tealDark, size: 17 }), rtlRun(question.sourceHint, { size: 17, color: COLORS.muted })],
      }));
    }
  }

  return items;
}

function createRunningHeader(variant: DocxVariant) {
  return new Header({
    children: [new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.RIGHT,
      spacing: { after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.line } },
      children: [rtlRun(`سُؤال | ${variant === 'answers' ? 'نموذج الإجابة' : 'ورقة الأسئلة'}`, { bold: true, size: 17, color: COLORS.muted })],
    })],
  });
}

function createFooter(variant: DocxVariant) {
  return new Footer({
    children: [new Paragraph({
      bidirectional: true,
      alignment: AlignmentType.CENTER,
      spacing: { before: 60 },
      border: { top: { style: BorderStyle.SINGLE, size: 3, color: COLORS.line } },
      children: [new TextRun({
        font: FONT,
        size: 16,
        color: COLORS.muted,
        rightToLeft: true,
        children: [variant === 'answers' ? 'نموذج الإجابة الملون  |  صفحة ' : 'ورقة الأسئلة  |  صفحة ', PageNumber.CURRENT, ' من ', PageNumber.TOTAL_PAGES],
      })],
    })],
  });
}

export function createExamDocument(payload: DocxExamPayload, variant: DocxVariant, math: MathRenderContext = { mode: payload.mathWordMode, images: new Map() }) {
  const children: Array<Paragraph | Table> = [
    ...createExamHeader(payload, variant),
    ...payload.questions.flatMap((question, index) => questionBlock(question, index, variant, payload.numeralStyle, math)),
  ];

  return new Document({
    title: variant === 'answers' ? `${payload.title} - نموذج الإجابة` : payload.title,
    subject: variant === 'answers' ? 'نموذج إجابة ملون وقابل للتعديل' : 'ورقة أسئلة قابلة للتعديل',
    creator: 'سُؤال',
    description: 'مستند Word أصلي قابل للتحرير، أُنشئ بواسطة سُؤال.',
    styles: {
      default: {
        document: {
          run: { font: FONT, size: 22, sizeComplexScript: 22, color: COLORS.ink, rightToLeft: true },
          paragraph: { alignment: AlignmentType.RIGHT, spacing: { after: 120, line: 300 } },
        },
        heading1: {
          run: { font: FONT, size: 32, sizeComplexScript: 32, bold: true, color: COLORS.tealDark, rightToLeft: true },
          paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 360, after: 200 } },
        },
        heading2: {
          run: { font: FONT, size: 26, sizeComplexScript: 26, bold: true, color: COLORS.tealDark, rightToLeft: true },
          paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 280, after: 140 } },
        },
        heading3: {
          run: { font: FONT, size: 24, sizeComplexScript: 24, bold: true, color: COLORS.ink, rightToLeft: true },
          paragraph: { alignment: AlignmentType.RIGHT, spacing: { before: 200, after: 100 } },
        },
      },
      paragraphStyles: [
        {
          id: 'ExamQuestion',
          name: 'سؤال الاختبار',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: FONT, size: 24, sizeComplexScript: 24, bold: true, color: COLORS.ink, rightToLeft: true },
          paragraph: { alignment: AlignmentType.RIGHT, keepNext: true, spacing: { before: 170, after: 110, line: 320 } },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'exam-options',
          levels: [{
            level: 0,
            format: LevelFormat.ARABIC_ALPHA,
            text: '%1)',
            alignment: AlignmentType.RIGHT,
            suffix: LevelSuffix.SPACE,
            style: {
              run: { font: FONT, size: 20, sizeComplexScript: 20, color: COLORS.tealDark, rightToLeft: true },
              paragraph: { indent: { right: 620, hanging: 240 } },
            },
          }],
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: PAGE_MARGIN, right: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, header: 480, footer: 480, gutter: 0 },
        },
      },
      headers: { default: createRunningHeader(variant) },
      footers: { default: createFooter(variant) },
      children,
    }],
  });
}

function safeFileName(value: string) {
  return (value || 'اختبار').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'اختبار';
}

export async function downloadExamDocx(payload: DocxExamPayload, variant: DocxVariant) {
  const math = await prepareMathContext(payload);
  const documentFile = createExamDocument(payload, variant, math);
  const blob = await Packer.toBlob(documentFile);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileName(payload.header.testTitle || payload.title)} - ${variant === 'answers' ? 'نموذج الإجابة' : 'الأسئلة'}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return blob;
}
