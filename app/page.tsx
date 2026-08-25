'use client';

import { ChangeEvent, DragEvent, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { MathText } from './components/math-text';
import { prepareJsonImport } from './lib/json-import';
import { containsMath, normalizeMathDelimiters } from './lib/math-text';

type SourceKind = 'text' | 'file' | 'image';
type Difficulty = 'easy' | 'balanced' | 'advanced';
type QuestionType = 'multiple_choice' | 'true_false' | 'fill_blank' | 'word_bank' | 'matching' | 'ordering' | 'short_answer' | 'multi_select' | 'classification' | 'essay';
type NumeralStyle = 'arabic_indic' | 'western';
type PrintVariant = 'questions' | 'answers';
type MathWordMode = 'images' | 'latex';

type SourceImage = {
  fileName: string;
  page: number;
  caption: string;
  crop: { x: number; y: number; width: number; height: number };
};

type Question = {
  id: string;
  type: QuestionType;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  sourceHint: string;
  difficulty: 'easy' | 'medium' | 'hard';
  points: number;
  sourceImage?: SourceImage;
  imageDataUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageError?: string;
  imageOrigin?: 'pdf' | 'manual';
};

type QuestionSet = { title: string; summary: string; questions: Question[] };
type ExamHeader = {
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

const typeDefinitions: Array<{ key: QuestionType; label: string; initial: number; tone: string }> = [
  { key: 'multiple_choice', label: 'اختيار من متعدد', initial: 6, tone: 'mint' },
  { key: 'true_false', label: 'صح أو خطأ', initial: 4, tone: 'sun' },
  { key: 'fill_blank', label: 'أكمل الفراغ', initial: 2, tone: 'violet' },
  { key: 'word_bank', label: 'صندوق الكلمات', initial: 0, tone: 'lime' },
  { key: 'matching', label: 'توصيل', initial: 0, tone: 'blue' },
  { key: 'ordering', label: 'ترتيب', initial: 0, tone: 'rose' },
  { key: 'short_answer', label: 'إجابة قصيرة', initial: 0, tone: 'cyan' },
  { key: 'multi_select', label: 'متعدد الإجابات', initial: 0, tone: 'indigo' },
  { key: 'classification', label: 'تصنيف', initial: 0, tone: 'amber' },
  { key: 'essay', label: 'سؤال مقالي', initial: 0, tone: 'coral' },
];

const initialCounts = Object.fromEntries(typeDefinitions.map((type) => [type.key, type.initial])) as Record<QuestionType, number>;
const typeLabels = Object.fromEntries(typeDefinitions.map((type) => [type.key, type.label])) as Record<QuestionType, string>;
const difficultyLabels = { easy: 'سهل', medium: 'متوسط', hard: 'متقدم' };
const acceptedFiles = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';
const initialHeader: ExamHeader = {
  testTitle: 'اختبار تحصيلي',
  school: '',
  subject: '',
  teacher: '',
  grade: '',
  section: '',
  term: '',
  date: '',
  duration: '',
  totalScore: '',
};

function formatDigits(value: string | number, style: NumeralStyle) {
  const western = String(value).replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  return style === 'arabic_indic'
    ? western.replace(/\d/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)])
    : western;
}

function clampPercent(value: unknown, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : fallback;
}

function parseSourceImage(value: unknown): SourceImage | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const cropRaw = raw.crop && typeof raw.crop === 'object' ? raw.crop as Record<string, unknown> : {};
  const fileName = typeof raw.fileName === 'string' ? raw.fileName.trim() : '';
  const page = Math.max(1, Math.trunc(Number(raw.page) || 1));
  if (!fileName) return undefined;
  const x = Math.min(99, clampPercent(cropRaw.x, 0));
  const y = Math.min(99, clampPercent(cropRaw.y, 0));
  return {
    fileName,
    page,
    caption: typeof raw.caption === 'string' ? raw.caption.trim() : '',
    crop: {
      x,
      y,
      width: Math.min(100 - x, Math.max(1, clampPercent(cropRaw.width, 100 - x))),
      height: Math.min(100 - y, Math.max(1, clampPercent(cropRaw.height, 100 - y))),
    },
  };
}

function isUncroppedSourceImage(sourceImage?: SourceImage) {
  if (!sourceImage) return false;
  const { x, y, width, height } = sourceImage.crop;
  return x <= 1 && y <= 1 && width >= 98 && height >= 98;
}

function readableSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function normalizePageRange(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[،؛\s]+/g, ',')
    .replace(/[–—−]/g, '-')
    .replace(/^,+|,+$/g, '');
}

function isValidPageRange(value: string) {
  if (!value) return true;
  if (!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(value)) return false;
  return value.split(',').every((part) => {
    const [from, to = from] = part.split('-').map(Number);
    return from >= 1 && to >= from;
  });
}

function headerValue(value: string) {
  return value.trim() || '........................';
}

const questionTypes = new Set<QuestionType>(typeDefinitions.map((type) => type.key));

function parseQuestionSet(value: string): QuestionSet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(prepareJsonImport(value));
  } catch (caught) {
    if (caught instanceof Error && /لم أجد|انقطع قبل اكتمال/.test(caught.message)) throw caught;
    throw new Error('تعذر إصلاح بنية النتيجة تلقائيًا. انسخ رد ChatGPT كاملًا دون حذف أوله أو آخره ثم حاول مجددًا.');
  }

  if (!parsed || typeof parsed !== 'object') throw new Error('النتيجة لا تحتوي مجموعة أسئلة صالحة.');
  const data = parsed as Record<string, unknown>;
  if (!Array.isArray(data.questions) || data.questions.length === 0) throw new Error('لم أجد أسئلة داخل النتيجة المستوردة.');

  const questions = data.questions.map((item, index): Question => {
    if (!item || typeof item !== 'object') throw new Error(`السؤال رقم ${index + 1} غير مكتمل.`);
    const raw = item as Record<string, unknown>;
    const type = typeof raw.type === 'string' && questionTypes.has(raw.type as QuestionType) ? raw.type as QuestionType : 'short_answer';
    const question = typeof raw.question === 'string' ? normalizeMathDelimiters(raw.question.trim()) : '';
    if (!question) throw new Error(`نص السؤال رقم ${index + 1} مفقود.`);
    const difficulty = raw.difficulty === 'easy' || raw.difficulty === 'hard' ? raw.difficulty : 'medium';
    return {
      id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : `q-${index + 1}-${Date.now()}`,
      type,
      question,
      options: Array.isArray(raw.options) ? raw.options.filter((option): option is string => typeof option === 'string').map((option) => normalizeMathDelimiters(option.trim())).filter(Boolean) : [],
      correctAnswer: typeof raw.correctAnswer === 'string' ? normalizeMathDelimiters(raw.correctAnswer.trim()) : '',
      explanation: typeof raw.explanation === 'string' ? normalizeMathDelimiters(raw.explanation.trim()) : '',
      sourceHint: typeof raw.sourceHint === 'string' ? raw.sourceHint.trim() : '',
      difficulty,
      points: typeof raw.points === 'number' && Number.isFinite(raw.points) ? Math.max(0.5, raw.points) : 1,
      sourceImage: parseSourceImage(raw.sourceImage),
    };
  });

  return {
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'اختبار مستورد من ChatGPT',
    summary: typeof data.summary === 'string' ? data.summary.trim() : 'مجموعة أسئلة مستوردة وجاهزة للمراجعة.',
    questions,
  };
}

export default function Home() {
  const [source, setSource] = useState<SourceKind>('text');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [pageRanges, setPageRanges] = useState<Record<string, string>>({});
  const [counts, setCounts] = useState(initialCounts);
  const [difficulty, setDifficulty] = useState<Difficulty>('balanced');
  const [numeralStyle, setNumeralStyle] = useState<NumeralStyle>('arabic_indic');
  const [mathWordMode, setMathWordMode] = useState<MathWordMode>('images');
  const [includeSourceImages, setIncludeSourceImages] = useState(false);
  const [imageQuestionCount, setImageQuestionCount] = useState(10);
  const [instructions, setInstructions] = useState('');
  const [examHeader, setExamHeader] = useState<ExamHeader>(initialHeader);
  const [printColumns, setPrintColumns] = useState<1 | 2 | 3>(1);
  const [printSize, setPrintSize] = useState<'compact' | 'normal' | 'large' | 'huge'>('normal');
  const [printVariant, setPrintVariant] = useState<PrintVariant>('questions');
  const [result, setResult] = useState<QuestionSet | null>(null);
  const [prompt, setPrompt] = useState('');
  const [importText, setImportText] = useState('');
  const [error, setError] = useState('');
  const [showAnswers, setShowAnswers] = useState(true);
  const [copied, setCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);
  const [wordExporting, setWordExporting] = useState<'questions' | 'answers' | null>(null);
  const [wordSuccess, setWordSuccess] = useState('');
  const [imageProcessing, setImageProcessing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const total = useMemo(() => Object.values(counts).reduce((sum, value) => sum + value, 0), [counts]);
  const visualQuestionTarget = includeSourceImages ? Math.min(total, Math.max(1, imageQuestionCount)) : 0;
  const pdfFiles = useMemo(() => files.filter((file) => /\.pdf$/i.test(file.name)), [files]);
  const resultTotalScore = useMemo(
    () => result?.questions.reduce((sum, question) => sum + (Number(question.points) || 0), 0) || 0,
    [result],
  );
  const uncroppedImageCount = useMemo(
    () => result?.questions.filter((question) => question.imageOrigin !== 'manual' && isUncroppedSourceImage(question.sourceImage)).length || 0,
    [result],
  );
  const pendingImageCount = useMemo(
    () => result?.questions.filter((question) => question.sourceImage && !question.imageDataUrl).length || 0,
    [result],
  );

  function setCount(key: QuestionType, change: number) {
    setCounts((current) => {
      const nextValue = Math.max(0, current[key] + change);
      return { ...current, [key]: nextValue };
    });
  }

  function setCountValue(key: QuestionType, value: string) {
    const normalized = value
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/\D/g, '');
    const parsed = Number(normalized);
    const nextValue = normalized && Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
    setCounts((current) => ({ ...current, [key]: nextValue }));
  }

  function addFiles(incoming: File[]) {
    setError('');
    const valid = incoming.filter((file) => {
      const allowed = /\.(pdf|docx|txt|md|png|jpe?g|webp)$/i.test(file.name);
      if (!allowed) setError(`الملف «${file.name}» من نوع غير مدعوم.`);
      else if (file.size > 15 * 1024 * 1024) setError(`الملف «${file.name}» أكبر من 15 MB.`);
      return allowed && file.size <= 15 * 1024 * 1024;
    });
    setFiles((current) => [...current, ...valid].slice(0, 10));
    if (valid.some((file) => /\.pdf$/i.test(file.name))) setIncludeSourceImages(true);
  }

  function setImageQuestionCountValue(value: string) {
    const normalized = value
      .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
      .replace(/\D/g, '');
    setImageQuestionCount(normalized ? Math.max(1, Math.trunc(Number(normalized))) : 1);
  }

  function updateHeader(key: keyof ExamHeader, value: string) {
    setExamHeader((current) => ({ ...current, [key]: value }));
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    addFiles(Array.from(event.target.files || []));
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  }

  function normalizePdfName(value: string) {
    return value.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ar');
  }

  function findPdfFile(fileName: string) {
    const wanted = normalizePdfName(fileName);
    const exact = pdfFiles.find((file) => normalizePdfName(file.name) === wanted);
    if (exact) return exact;
    const wantedStem = wanted.replace(/\.pdf$/i, '');
    const byStem = pdfFiles.find((file) => normalizePdfName(file.name).replace(/\.pdf$/i, '') === wantedStem);
    return byStem || (pdfFiles.length === 1 ? pdfFiles[0] : undefined);
  }

  function sourcePageHint(value: string) {
    const western = value.replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
    const labeled = western.match(/(?:الصفحة|صفحة|ص\.?|page)\s*[:#-]?\s*(\d{1,4})/i);
    return labeled ? Math.max(1, Number(labeled[1])) : undefined;
  }

  function questionNeedsVisual(question: Question) {
    return /(?:الشكل|الرسم|الصورة|الجدول|المخطط|التمثيل البياني|البيان|المجسم|الخريطة)/.test(`${question.question} ${question.explanation}`);
  }

  function defaultSourceImage(question: Question, file = pdfFiles[0]): SourceImage | undefined {
    if (!file) return undefined;
    const page = sourcePageHint(question.sourceHint) || 1;
    return {
      fileName: file.name,
      page,
      caption: `شكل من الصفحة ${formatDigits(page, numeralStyle)}`,
      crop: { x: 0, y: 0, width: 100, height: 100 },
    };
  }

  async function renderSourceImage(question: Question): Promise<Question> {
    if (!question.sourceImage) return question;
    const file = findPdfFile(question.sourceImage.fileName);
    if (!file) {
      return { ...question, imageError: `أعد اختيار ملف PDF «${question.sourceImage.fileName}» في أعلى الصفحة ثم أعد القص.` };
    }
    try {
      const { renderPdfFigure } = await import('./lib/pdf-images');
      const rendered = await renderPdfFigure(file, question.sourceImage);
      return {
        ...question,
        imageDataUrl: rendered.dataUrl,
        imageWidth: rendered.width,
        imageHeight: rendered.height,
        imageOrigin: 'pdf',
        imageError: isUncroppedSourceImage(question.sourceImage)
          ? 'حدود القص تغطي الصفحة كاملة. افتح أداة القص أدناه وحدد الشكل فقط قبل تصدير Word أو PDF.'
          : undefined,
      };
    } catch (caught) {
      return { ...question, imageError: caught instanceof Error ? caught.message : 'تعذر استخراج الشكل من ملف PDF.' };
    }
  }

  async function hydrateSourceImages(questionSet: QuestionSet) {
    const prepared = {
      ...questionSet,
      questions: questionSet.questions.map((question) => {
        if (question.sourceImage) {
          const matched = findPdfFile(question.sourceImage.fileName);
          return matched ? { ...question, sourceImage: { ...question.sourceImage, fileName: matched.name } } : question;
        }
        const hintedPage = sourcePageHint(question.sourceHint);
        if (includeSourceImages && hintedPage && questionNeedsVisual(question)) {
          return { ...question, sourceImage: defaultSourceImage(question) };
        }
        return question;
      }),
    };
    if (!prepared.questions.some((question) => question.sourceImage)) return prepared;
    setImageProcessing(true);
    const nextQuestions: Question[] = [];
    for (const question of prepared.questions) nextQuestions.push(await renderSourceImage(question));
    setImageProcessing(false);
    return { ...prepared, questions: nextQuestions };
  }

  async function attachQuestionSourceImage(questionId: string) {
    const question = result?.questions.find((item) => item.id === questionId);
    if (!question) return;
    const sourceImage = question.sourceImage || defaultSourceImage(question);
    if (!sourceImage) {
      setError('أعد اختيار ملف PDF أولًا، ثم أرفق الشكل بالسؤال.');
      return;
    }
    const prepared = { ...question, sourceImage, imageDataUrl: undefined, imageError: undefined };
    updateQuestion(questionId, prepared);
    setImageProcessing(true);
    const refreshed = await renderSourceImage(prepared);
    setResult((current) => current ? { ...current, questions: current.questions.map((item) => item.id === questionId ? refreshed : item) } : current);
    setImageProcessing(false);
  }

  async function refreshQuestionImage(questionId: string) {
    const question = result?.questions.find((item) => item.id === questionId);
    if (!question?.sourceImage) return;
    setImageProcessing(true);
    const refreshed = await renderSourceImage(question);
    setResult((current) => current ? { ...current, questions: current.questions.map((item) => item.id === questionId ? refreshed : item) } : current);
    setImageProcessing(false);
  }

  async function applyManualQuestionImage(questionId: string, blob: Blob, label: string) {
    if (!blob.type.startsWith('image/')) {
      setError('الملف المختار ليس صورة صالحة. استخدم PNG أو JPG أو WebP.');
      return;
    }
    if (blob.size > 12 * 1024 * 1024) {
      setError('الصورة أكبر من 12 MB. اختر نسخة أصغر من فضلك.');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('تعذر قراءة الصورة.'));
      reader.readAsDataURL(blob);
    });
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const question = result?.questions.find((item) => item.id === questionId);
    if (!question) return;
    const fallback = defaultSourceImage(question);
    updateQuestion(questionId, {
      sourceImage: question.sourceImage || fallback || {
        fileName: label,
        page: 1,
        caption: 'شكل أُضيف يدويًا',
        crop: { x: 0, y: 0, width: 100, height: 100 },
      },
      imageDataUrl: dataUrl,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      imageError: undefined,
      imageOrigin: 'manual',
    });
    setError('');
  }

  async function handleManualImageFile(questionId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await applyManualQuestionImage(questionId, file, file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر إدراج الصورة المختارة.');
    }
  }

  async function pasteQuestionImage(questionId: string) {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (!imageType) continue;
        await applyManualQuestionImage(questionId, await item.getType(imageType), 'صورة من الحافظة');
        return;
      }
      setError('لا توجد صورة في الحافظة. انسخ الصورة من الملف الأصلي ثم حاول مجددًا.');
    } catch {
      setError('تعذر قراءة الحافظة. اسمح للموقع بالوصول إليها، أو استخدم «استبدال بصورة من الجهاز».');
    }
  }

  function generatePrompt() {
    setError('');
    if (!text.trim() && files.length === 0) {
      setError('أضف نصًا أو ملفًا واحدًا على الأقل للبدء.');
      return;
    }
    if (total === 0) {
      setError('اختر سؤالًا واحدًا على الأقل.');
      return;
    }
    if (includeSourceImages && !files.some((file) => /\.pdf$/i.test(file.name))) {
      setError('خيار إرفاق صور المصدر يحتاج إلى اختيار ملف PDF واحد على الأقل.');
      return;
    }
    const invalidPdf = files.find((file) => file.type === 'application/pdf' && !isValidPageRange(normalizePageRange(pageRanges[fileKey(file)] || '')));
    if (invalidPdf) {
      setError(`صيغة الصفحات للملف «${invalidPdf.name}» غير صحيحة. استخدم مثلًا: 1-5، 8، 10-12.`);
      return;
    }

    const requestedTypes = typeDefinitions
      .filter((type) => counts[type.key] > 0)
      .map((type) => `- ${type.label} (${type.key}): ${formatDigits(counts[type.key], numeralStyle)} سؤالًا`)
      .join('\n');
    const fileList = files.length > 0
      ? files.map((file, index) => {
          const range = file.type === 'application/pdf' ? normalizePageRange(pageRanges[fileKey(file)] || '') : '';
          return `${index + 1}. ${file.name}${range ? ` — الصفحات المطلوبة فقط: ${range}` : ' — استخدم كامل الملف'}`;
        }).join('\n')
      : 'لا توجد ملفات مرفقة؛ المصدر هو النص المدرج أدناه.';
    const difficultyPlan = difficulty === 'easy'
      ? 'اجعل الغالب سهلًا (نحو 70% سهل، 25% متوسط، 5% متقدم).'
      : difficulty === 'advanced'
        ? 'اجعل الأسئلة عميقة (نحو 10% سهل، 40% متوسط، 50% متقدم).'
        : 'وزّع الصعوبة بتوازن (نحو 30% سهل، 50% متوسط، 20% متقدم).';
    const headerContext = [
      examHeader.testTitle && `عنوان الاختبار: ${examHeader.testTitle}`,
      examHeader.subject && `المادة: ${examHeader.subject}`,
      examHeader.grade && `الصف: ${examHeader.grade}`,
      examHeader.term && `الفصل الدراسي: ${examHeader.term}`,
      examHeader.totalScore && `مجموع الدرجات المطلوب: ${examHeader.totalScore}`,
    ].filter(Boolean).join('\n') || 'لا توجد بيانات سياقية إضافية.';
    const sourceText = text.trim() ? `<source_text>\n${text.trim()}\n</source_text>` : '<source_text>لا يوجد نص ملصق؛ اعتمد على الملفات المرفقة فقط.</source_text>';
    const numeralInstruction = numeralStyle === 'arabic_indic'
      ? 'استخدم الأرقام العربية الهندية (٠١٢٣٤٥٦٧٨٩) داخل نصوص الأسئلة والإجابات، مع إبقاء الأرقام البنائية في JSON بصيغتها الرقمية الصحيحة.'
      : 'استخدم الأرقام الإنجليزية (0123456789) داخل نصوص الأسئلة والإجابات.';
    const imageInstruction = includeSourceImages
      ? `\n11. أنشئ بالضبط ${visualQuestionTarget} سؤالًا تعتمد إجابتها جوهريًا على شكل أو رسم أو صورة أو جدول أو مخطط موجود فعلًا في PDF، ووزّعها على الأشكال التعليمية المهمة في الصفحات المحددة. يجب أن يشير نص كل واحد منها بوضوح إلى «الشكل المرفق» أو «الجدول المرفق»، ويجب إلزاميًا أن يحتوي sourceImage غير null؛ لا تستبدل الشكل بوصف نصي ولا تجعل sourceImage بالقيمة null لهذه الأسئلة. اجعل fileName مطابقًا حرفيًا لأحد أسماء الملفات أعلاه وحدد page بدقة. افحص الصفحة بصريًا وحدد صندوق قص محكمًا حول الشكل وحده كنسب مئوية x وy وwidth وheight من أعلى يسار الصفحة؛ يجب أن يكون width وheight بين 8 و90، ويُمنع استخدام قص الصفحة كاملة 0،0،100،100 أو إدخال هوامش الصفحة ونصوصها غير اللازمة. لا تستخدم الغلاف أو الصور الزخرفية. اجعل sourceImage بالقيمة null فقط لبقية الأسئلة غير البصرية. قبل إنهاء JSON تأكد أن عدد sourceImage غير الفارغة ${visualQuestionTarget} وأن كل واحدة منها ذات قص حقيقي أصغر من الصفحة.`
      : '\n11. اجعل sourceImage بالقيمة null في جميع الأسئلة؛ لم يطلب المستخدم صورًا من المصدر.';
    const mathInstruction = `\n12. حافظ على المعادلات والرموز الرياضية ولا تكتبها كنص عربي مختلط الاتجاه. ضع كل تعبير رياضي حصريًا بين علامتي $ بصيغة LaTeX صحيحة داخل جميع حقول النص، مثل: $x^2=9$ و$\\frac{a}{b}$ و$\\angle ABC$ و$AB\\parallel CD$. داخل JSON اهرب كل شرطة مائلة عكسية بكتابتها مرتين. لا تستخدم رمزًا رياضيًا عاريًا خارج $...$، ولا تغيّر ترتيب حدود المعادلة.`;
    const performanceInstruction = `\n13. ابدأ بإنتاج JSON مباشرة في الرد نفسه. لا تنشئ خطة عمل أو مهامًا فرعية، ولا تستخرج أو تنسخ أو «تنظّف» نص صفحات الملف كاملًا. اقرأ من المصدر فقط القدر اللازم لصياغة كل سؤال، ونفّذ الأسئلة تباعًا داخليًا دون التوقف لطلب متابعة. إذا كان العدد كبيرًا فقسّم المعالجة داخليًا إلى دفعات صغيرة ثم اجمعها كلها في مصفوفة questions واحدة، مع المحافظة على العدد الدقيق المطلوب.`;

    const nextPrompt = `أنت خبير في بناء الاختبارات العربية وقياس نواتج التعلم. أنشئ اختبارًا ملتزمًا حصريًا بالمصدر الذي أرفقته أو ألصقته، ولا تضف معلومات من خارج المصدر.

مصادر الاختبار المرفقة في هذه المحادثة:
${fileList}
- عند تحديد صفحات لملف PDF، لا تستخدم أي معلومة من خارج تلك الصفحات.
- إذا تعذر الوصول إلى ملف مذكور، اكتب رسالة قصيرة باسم الملف المفقود فقط بدل بدء معالجة مطوّلة.

سياق الاختبار:
${headerContext}

المطلوب بالعدد الدقيق (${formatDigits(total, numeralStyle)} سؤالًا):
${requestedTypes}

مستوى الصعوبة:
${difficultyPlan}

نمط الأرقام:
${numeralInstruction}

تعليمات خاصة:
${instructions.trim() || 'لا توجد؛ ركّز على المفاهيم الرئيسة ووضوح الصياغة وتنوّع المهارات.'}

قواعد الجودة:
1. التزم بالمصدر، وامنع التكرار والأسئلة الملتبسة أو التي تكشف إجابتها في سؤال آخر.
2. وزّع الأسئلة على أجزاء المصدر المهمة، وراعِ اللغة العربية السليمة ومستوى الصف إن ذُكر.
3. correctAnswer يجب أن يكون نص الإجابة الدقيق، وفي الاختيار يكون مطابقًا لنص الخيار الصحيح.
4. اكتب explanation موجزًا يوضح سبب صحة الإجابة، وsourceHint يذكر الصفحة أو العنوان أو الفقرة من المصدر.
5. عند multiple_choice استخدم أربعة خيارات قوية. وعند true_false استخدم ["صح", "خطأ"].
6. عند fill_blank وshort_answer وessay اجعل options مصفوفة فارغة.
7. عند word_bank ضع كلمات الصندوق في options.
8. عند matching أو classification ضع كل زوج كسلسلة واحدة بصيغة "العنصر — المقابل الصحيح" داخل options.
9. عند ordering ضع العناصر في options بترتيبها الصحيح. وعند multi_select ضع الخيارات كلها واجمع الإجابات الصحيحة في correctAnswer مفصولة بعلامة "،".
10. استخدم difficulty فقط بالقيم easy أو medium أو hard. وزّع points بحيث يساوي مجموعها ${examHeader.totalScore.trim() || total}.${imageInstruction}${mathInstruction}${performanceInstruction}

أعد النتيجة بصيغة JSON صالحة فقط، دون Markdown أو مقدمات أو تعليقات، بهذا البناء الحرفي:
{
  "title": "عنوان الاختبار",
  "summary": "وصف موجز لمحتوى الاختبار",
  "questions": [
    {
      "id": "q1",
      "type": "multiple_choice",
      "question": "إذا كان $x^2=9$ فما قيمة $x$؟",
      "options": ["$x=3$", "$x=-3$", "$x=0$", "$x=9$"],
      "correctAnswer": "$x=3$",
      "explanation": "تعليل موجز مستند إلى المصدر",
      "sourceHint": "الصفحة أو القسم من المصدر",
      "difficulty": "medium",
      "points": 1,
      "sourceImage": ${includeSourceImages ? '{"fileName":"اسم الملف.pdf","page":3,"caption":"وصف الشكل","crop":{"x":10,"y":15,"width":70,"height":40}}' : 'null'}
    }
  ]
}

${sourceText}`;

    setPrompt(nextPrompt);
    setImportText('');
    setResult(null);
    setTimeout(() => promptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  async function copyPrompt() {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 1800);
  }

  async function importChatGptResult() {
    setError('');
    if (!importText.trim()) {
      setError('الصق نتيجة ChatGPT أولًا ثم اضغط استيراد.');
      return;
    }
    try {
      const imported = parseQuestionSet(importText);
      setResult(imported);
      const hydrated = await hydrateSourceImages(imported);
      setResult(hydrated);
      setShowAnswers(true);
      setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'تعذر استيراد النتيجة.');
      setTimeout(() => promptRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    }
  }

  function updateQuestion(id: string, patch: Partial<Question>) {
    setResult((current) => current ? { ...current, questions: current.questions.map((item) => item.id === id ? { ...item, ...patch } : item) } : current);
  }

  function updateOption(id: string, index: number, value: string) {
    const question = result?.questions.find((item) => item.id === id);
    if (!question) return;
    updateQuestion(id, { options: question.options.map((option, optionIndex) => optionIndex === index ? value : option) });
  }

  function updateSourceCrop(id: string, key: keyof SourceImage['crop'], value: number) {
    const question = result?.questions.find((item) => item.id === id);
    if (!question?.sourceImage) return;
    const currentCrop = question.sourceImage.crop;
    const maximum = key === 'x' ? 100 - currentCrop.width
      : key === 'y' ? 100 - currentCrop.height
        : key === 'width' ? 100 - currentCrop.x
          : 100 - currentCrop.y;
    updateQuestion(id, {
      sourceImage: {
        ...question.sourceImage,
        crop: { ...currentCrop, [key]: Math.min(maximum, Math.max(key === 'width' || key === 'height' ? 1 : 0, value)) },
      },
      imageDataUrl: undefined,
      imageWidth: undefined,
      imageHeight: undefined,
      imageError: 'تم تعديل الحدود. اضغط «تطبيق الصفحة والقص» لمعاينة الشكل قبل التصدير.',
    });
  }

  function updateSourceImageMeta(id: string, patch: Partial<Pick<SourceImage, 'fileName' | 'page' | 'caption'>>) {
    const question = result?.questions.find((item) => item.id === id);
    if (!question?.sourceImage) return;
    updateQuestion(id, {
      sourceImage: { ...question.sourceImage, ...patch },
      imageDataUrl: undefined,
      imageWidth: undefined,
      imageHeight: undefined,
      imageError: undefined,
      imageOrigin: 'pdf',
    });
  }

  function removeSourceImage(id: string) {
    updateQuestion(id, { sourceImage: undefined, imageDataUrl: undefined, imageWidth: undefined, imageHeight: undefined, imageError: undefined, imageOrigin: undefined });
  }

  function removeQuestion(id: string) {
    setResult((current) => current ? { ...current, questions: current.questions.filter((item) => item.id !== id) } : current);
  }

  function resultAsText() {
    if (!result) return '';
    const totalScore = examHeader.totalScore.trim() || String(resultTotalScore || '');
    return [
      examHeader.school ? `المدرسة: ${examHeader.school}` : '',
      examHeader.subject ? `المادة: ${examHeader.subject}` : '',
      examHeader.teacher ? `المعلم/ة: ${examHeader.teacher}` : '',
      examHeader.grade ? `الصف: ${examHeader.grade}` : '',
      examHeader.section ? `الفصل/الشعبة: ${examHeader.section}` : '',
      examHeader.term ? `الفصل الدراسي: ${examHeader.term}` : '',
      examHeader.date ? `التاريخ: ${examHeader.date}` : '',
      examHeader.duration ? `الزمن: ${examHeader.duration}` : '',
      totalScore ? `الدرجة الكلية: ${totalScore}` : '',
      examHeader.testTitle || result.title,
      result.summary,
      'اسم الطالب/ة: ........................................................',
      '',
      ...result.questions.flatMap((question, index) => [
        `${formatDigits(index + 1, numeralStyle)}. ${question.question} (${formatDigits(question.points || 1, numeralStyle)} درجة)`,
        ...question.options.map((option, optionIndex) => `   ${'أبجدهوزح'[optionIndex] || formatDigits(optionIndex + 1, numeralStyle)}) ${option}`),
        question.sourceImage ? `الشكل: ${question.sourceImage.caption || `من الصفحة ${formatDigits(question.sourceImage.page, numeralStyle)}`}` : '',
        showAnswers ? `الإجابة: ${question.correctAnswer}` : '',
        showAnswers ? `التفسير: ${question.explanation}` : '',
        '',
      ]),
    ].filter((line) => line !== '').join('\n');
  }

  async function copyAll() {
    await navigator.clipboard.writeText(resultAsText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function downloadText() {
    const blob = new Blob([resultAsText()], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${result?.title || 'أسئلة'}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function printExam(variant: PrintVariant) {
    if (!result) return;
    if (uncroppedImageCount > 0) {
      setError(`يوجد ${formatDigits(uncroppedImageCount, numeralStyle)} شكلًا ما زال قصّه يغطي الصفحة كاملة. عدّل الاقتصاص داخل بطاقات الأسئلة أولًا.`);
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (pendingImageCount > 0) {
      setError(`يوجد ${formatDigits(pendingImageCount, numeralStyle)} شكلًا لم تُطبّق معاينته بعد. اضغط «تطبيق الصفحة والقص» لكل شكل.`);
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    flushSync(() => setPrintVariant(variant));
    const previousTitle = document.title;
    document.title = `${examHeader.testTitle || result.title} - ${variant === 'answers' ? 'نموذج الإجابة' : 'الأسئلة'}`;
    window.print();
    document.title = previousTitle;
  }

  async function exportWord(variant: 'questions' | 'answers') {
    if (!result || wordExporting) return;
    setError('');
    setWordSuccess('');
    if (uncroppedImageCount > 0) {
      setError(`تعذر تصدير Word: يوجد ${formatDigits(uncroppedImageCount, numeralStyle)} شكلًا بحدود صفحة كاملة. افتح «تعديل اقتصاص الشكل» وحدد الشكل فقط ثم طبّق القص.`);
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (pendingImageCount > 0) {
      setError(`تعذر تصدير Word: يوجد ${formatDigits(pendingImageCount, numeralStyle)} شكلًا لم تُطبّق معاينته بعد. اضغط «تطبيق الصفحة والقص» لكل شكل.`);
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    setWordExporting(variant);
    try {
      const { downloadExamDocx } = await import('./lib/export-docx');
      const blob = await downloadExamDocx({
        title: result.title,
        summary: result.summary,
        questions: result.questions,
        header: examHeader,
        numeralStyle,
        mathWordMode,
      }, variant);
      setWordSuccess(`تم إنشاء ملف Word ${variant === 'answers' ? 'للإجابات' : 'للأسئلة'} بنجاح (${readableSize(blob.size)}). إذا لم يظهر التنزيل فتحقق من إذن التنزيل في المتصفح.`);
    } catch (caught) {
      setError(caught instanceof Error ? `تعذر إنشاء ملف Word: ${caught.message}` : 'تعذر إنشاء ملف Word. أعد المحاولة من فضلك.');
    } finally {
      setWordExporting(null);
    }
  }

  return (
    <main className="site-shell">
      <nav className="topbar" aria-label="التنقل الرئيسي">
        <a className="brand" href="#top" aria-label="سؤال برومبت - الصفحة الرئيسية"><span className="brand-mark">؟</span><span>سُؤال برومبت</span></a>
        <div className="nav-note"><span className="spark">✦</span> يعمل مع ChatGPT دون مفتاح API</div>
        <button className="help-button" type="button" onClick={() => document.querySelector('.workspace')?.scrollIntoView({ behavior: 'smooth' })}>كيف يعمل؟</button>
      </nav>

      <section className="hero" id="top">
        <div className="eyebrow"><span /> مولّد البرومبت التعليمي</div>
        <h1>اضبط اختبارك ثم<br /><em>انسخ الطلب إلى ChatGPT</em></h1>
        <p>حدّد المصدر وأنواع الأسئلة والترويسة، وسنجهز لك برومبتًا دقيقًا ونتيجة قابلة للاستيراد والتصدير إلى Word وPDF.</p>
        <div className="trust-row" aria-label="مزايا الخدمة"><span>✓ لا يحتاج مفتاح API</span><span>✓ ملفاتك تبقى على جهازك</span><span>✓ Word وPDF مستقلان</span></div>
      </section>

      <section className="workspace" aria-label="إنشاء الأسئلة">
        <div className="workspace-main">
          <div className="section-heading"><span className="step">١</span><div><h2>أضف محتواك</h2><p>اختر الطريقة الأنسب لك</p></div></div>
          <div className="source-tabs" role="tablist" aria-label="مصدر المحتوى">
            <button role="tab" aria-selected={source === 'text'} className={source === 'text' ? 'active' : ''} onClick={() => setSource('text')} type="button">▤ <span>نص</span></button>
            <button role="tab" aria-selected={source === 'file'} className={source === 'file' ? 'active' : ''} onClick={() => setSource('file')} type="button">↥ <span>ملف PDF أو Word</span></button>
            <button role="tab" aria-selected={source === 'image'} className={source === 'image' ? 'active' : ''} onClick={() => setSource('image')} type="button">▧ <span>صور</span></button>
          </div>

          {source === 'text' ? (
            <div className="text-box-wrap">
              <textarea value={text} onChange={(event) => setText(event.target.value.slice(0, 50000))} aria-label="النص المراد استخراج الأسئلة منه" placeholder="الصق الدرس أو المقال أو المحتوى هنا…" />
              <div className="text-box-footer"><span>كلما كان النص أوضح، كانت الأسئلة أدق</span><span>{formatDigits(text.length, numeralStyle)} / {formatDigits('50,000', numeralStyle)}</span></div>
            </div>
          ) : (
            <>
              <input ref={fileInput} className="visually-hidden" type="file" accept={source === 'image' ? '.png,.jpg,.jpeg,.webp' : acceptedFiles} multiple onChange={handleFileChange} />
              <button className="drop-zone" type="button" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
                <span className="upload-icon">↥</span>
                <strong>{source === 'file' ? 'اختر الملفات التي ستُرفقها لاحقًا في ChatGPT' : 'اختر الصور التي ستُرفقها لاحقًا في ChatGPT'}</strong>
                <small>{source === 'file' ? 'نقرأ أسماء الملفات فقط لبناء البرومبت — ولا نرفعها من جهازك' : 'نقرأ أسماء الصور فقط — وسترفقها أنت في ChatGPT'}</small>
              </button>
            </>
          )}

          {files.length > 0 && (
            <div className="file-list" aria-label="الملفات المختارة">
              {files.map((file, index) => (
                <div className={`file-entry ${file.type === 'application/pdf' ? 'has-pages' : ''}`} key={`${file.name}-${index}`}>
                  <div className="file-chip"><span>{file.type.startsWith('image/') ? '▧' : '▤'}</span><div><strong>{file.name}</strong><small>{readableSize(file.size)}</small></div><button aria-label={`إزالة ${file.name}`} onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} type="button">×</button></div>
                  {file.type === 'application/pdf' && (
                    <label className="page-range-field">
                      <span>الصفحات المطلوبة <small>اتركها فارغة لاستخدام الكل</small></span>
                      <input
                        value={pageRanges[fileKey(file)] || ''}
                        onChange={(event) => setPageRanges((current) => ({ ...current, [fileKey(file)]: event.target.value }))}
                        placeholder="مثال: 1-5، 8، 10-12"
                        inputMode="text"
                        aria-label={`الصفحات المطلوبة من ${file.name}`}
                      />
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}

          <label className="instructions-field"><span>تعليمات إضافية <small>اختياري</small></span><input value={instructions} maxLength={2000} onChange={(event) => setInstructions(event.target.value)} placeholder="مثال: ركّز على المفاهيم الرئيسة وتجنّب التواريخ…" /></label>

          <details className="header-settings" open>
            <summary><span>بيانات ترويسة ورقة الاختبار</span><small>اختيارية وتظهر في الطباعة وملف Word</small></summary>
            <div className="header-fields">
              <label><span>عنوان الاختبار</span><input value={examHeader.testTitle} onChange={(event) => updateHeader('testTitle', event.target.value)} placeholder="اختبار تحصيلي" /></label>
              <label><span>اسم المدرسة</span><input value={examHeader.school} onChange={(event) => updateHeader('school', event.target.value)} placeholder="مدرسة…" /></label>
              <label><span>المادة</span><input value={examHeader.subject} onChange={(event) => updateHeader('subject', event.target.value)} placeholder="العلوم" /></label>
              <label><span>المعلم/ة</span><input value={examHeader.teacher} onChange={(event) => updateHeader('teacher', event.target.value)} placeholder="الاسم" /></label>
              <label><span>الصف</span><input value={examHeader.grade} onChange={(event) => updateHeader('grade', event.target.value)} placeholder="الصف الخامس" /></label>
              <label><span>الفصل / الشعبة</span><input value={examHeader.section} onChange={(event) => updateHeader('section', event.target.value)} placeholder="أ" /></label>
              <label><span>الفصل الدراسي</span><input value={examHeader.term} onChange={(event) => updateHeader('term', event.target.value)} placeholder="الأول" /></label>
              <label><span>التاريخ</span><input value={examHeader.date} onChange={(event) => updateHeader('date', event.target.value)} placeholder="1448/…/…" /></label>
              <label><span>زمن الاختبار</span><input value={examHeader.duration} onChange={(event) => updateHeader('duration', event.target.value)} placeholder="45 دقيقة" /></label>
              <label><span>الدرجة الكلية</span><input value={examHeader.totalScore} onChange={(event) => updateHeader('totalScore', event.target.value.replace(/[^٠-٩0-9.]/g, ''))} placeholder="تُحسب تلقائيًا" inputMode="decimal" /></label>
            </div>
            <div className="header-live-preview" aria-label="معاينة ترويسة الاختبار">
              <div><span>المدرسة: <b>{headerValue(examHeader.school)}</b></span><span>المادة: <b>{headerValue(examHeader.subject)}</b></span><span>المعلم/ة: <b>{headerValue(examHeader.teacher)}</b></span></div>
              <div><strong>{headerValue(examHeader.testTitle)}</strong><span>{headerValue(examHeader.term)}</span></div>
              <div><span>الصف: <b>{headerValue(examHeader.grade)}</b></span><span>الفصل: <b>{headerValue(examHeader.section)}</b></span><span>التاريخ: <b>{headerValue(examHeader.date)}</b></span></div>
              <p><span>اسم الطالب/ة: ........................................</span><span>الزمن: {headerValue(examHeader.duration)}</span><span>الدرجة: ........ / {headerValue(examHeader.totalScore)}</span></p>
            </div>
          </details>
        </div>

        <aside className="settings-panel">
          <div className="section-heading compact"><span className="step">٢</span><div><h2>خصّص الأسئلة</h2><p>يمكن تعديلها لاحقًا</p></div></div>
          <div className="type-list">
            {typeDefinitions.map((type) => (
              <div className="type-row" key={type.key}>
                <span className={`type-dot ${type.tone}`} />
                <span>{type.label}</span>
                <div className="counter" aria-label={`عدد أسئلة ${type.label}`}>
                  <button aria-label={`تقليل ${type.label}`} onClick={() => setCount(type.key, -1)} type="button">−</button>
                  <input
                    aria-label={`إدخال عدد أسئلة ${type.label}`}
                    inputMode="numeric"
                    onChange={(event) => setCountValue(type.key, event.target.value)}
                    pattern="[0-9٠-٩]*"
                    type="text"
                    value={formatDigits(counts[type.key], numeralStyle)}
                  />
                  <button aria-label={`زيادة ${type.label}`} onClick={() => setCount(type.key, 1)} type="button">+</button>
                </div>
              </div>
            ))}
          </div>
          <p className="count-note">اكتب العدد المطلوب مباشرة لكل نوع — لا يفرض المولّد حدًا برمجيًا على عدد الأسئلة.</p>
          <div className="difficulty">
            <div><strong>مستوى الصعوبة</strong><span>{difficulty === 'easy' ? 'سهل' : difficulty === 'advanced' ? 'متقدم' : 'متوازن'}</span></div>
            <input aria-label="مستوى الصعوبة" type="range" min="1" max="3" value={difficulty === 'easy' ? 1 : difficulty === 'advanced' ? 3 : 2} onChange={(event) => setDifficulty(event.target.value === '1' ? 'easy' : event.target.value === '3' ? 'advanced' : 'balanced')} />
            <div className="range-labels"><span>سهل</span><span>متوازن</span><span>متقدم</span></div>
          </div>
          <div className="output-preferences" aria-label="خيارات الإخراج">
            <div className="preference-heading"><strong>خيارات الإخراج</strong><span>تُضمّن في البرومبت والتصدير</span></div>
            <div className="numeral-preference">
              <span>شكل الأرقام</span>
              <div className="segmented-control" role="group" aria-label="شكل الأرقام">
                <button className={numeralStyle === 'arabic_indic' ? 'active' : ''} onClick={() => setNumeralStyle('arabic_indic')} type="button">١٢٣ عربية</button>
                <button className={numeralStyle === 'western' ? 'active' : ''} onClick={() => setNumeralStyle('western')} type="button">123 إنجليزية</button>
              </div>
            </div>
            <fieldset className="math-word-preference">
              <legend>الأرقام والرموز الرياضية في Word:</legend>
              <label>
                <input checked={mathWordMode === 'images'} name="math-word-mode" onChange={() => setMathWordMode('images')} type="radio" />
                <span className="radio-circle" aria-hidden="true" />
                <b>صور</b>
                <small>الأدق في الشكل والطباعة</small>
              </label>
              <label>
                <input checked={mathWordMode === 'latex'} name="math-word-mode" onChange={() => setMathWordMode('latex')} type="radio" />
                <span className="radio-circle" aria-hidden="true" />
                <b>LaTeX</b>
                <small>معادلات Word قابلة للتحرير</small>
              </label>
            </fieldset>
            <label className="source-image-toggle">
              <input checked={includeSourceImages} onChange={(event) => setIncludeSourceImages(event.target.checked)} type="checkbox" />
              <span className="toggle-track" aria-hidden="true"><i /></span>
              <span><b>إرفاق صور من ملف PDF بالأسئلة</b><small>يُفعّل تلقائيًا عند إرفاق PDF؛ يحدد ChatGPT الشكل والصفحة ثم يقتصّه الموقع محليًا.</small></span>
            </label>
            {includeSourceImages && (
              <label className="image-question-count">
                <span><b>عدد الأسئلة المعتمدة على الصور والأشكال</b><small>يفرضه المولد صراحةً داخل البرومبت</small></span>
                <input aria-label="عدد الأسئلة المعتمدة على الصور والأشكال" inputMode="numeric" onChange={(event) => setImageQuestionCountValue(event.target.value)} pattern="[0-9٠-٩]*" type="text" value={formatDigits(imageQuestionCount, numeralStyle)} />
              </label>
            )}
          </div>
          {error && <div className="error-message" role="alert">{error}</div>}
          <button className="generate-button" onClick={generatePrompt} type="button"><span>✦</span> جهّز برومبت {formatDigits(total, numeralStyle)} سؤالًا</button>
          <p className="privacy-note">🔒 لا يُرسل شيء من هذه الصفحة إلى خادم ذكاء اصطناعي</p>
        </aside>
      </section>

      {prompt && (
        <section className="prompt-stage" ref={promptRef} aria-label="البرومبت والاستيراد">
          <div className="manual-flow" aria-label="خطوات الاستخدام">
            <div className="flow-step done"><span>١</span><div><strong>تم ضبط الطلب</strong><small>الترويسة والأنواع والصعوبة</small></div></div>
            <div className="flow-line" />
            <div className="flow-step active"><span>٢</span><div><strong>انسخ إلى ChatGPT</strong><small>وأرفق الملفات المسماة في الطلب</small></div></div>
            <div className="flow-line" />
            <div className="flow-step"><span>٣</span><div><strong>الصق النتيجة</strong><small>سنحوّل JSON إلى اختبار قابل للتعديل</small></div></div>
          </div>
          <div className="prompt-workbench">
            <article className="prompt-output">
              <div className="prompt-panel-heading"><div><span className="prompt-ready-pill">جاهز للنسخ</span><h2>برومبت الاختبار الاحترافي</h2><p>انسخه كما هو، ثم أرفق ملفات المصدر في ChatGPT قبل الإرسال.</p></div><span className="panel-number">٣</span></div>
              <textarea className="code-textarea" value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="البرومبت المُنشأ" spellCheck={false} />
              <div className="prompt-actions">
                <button className="copy-prompt-button" onClick={copyPrompt} type="button">{promptCopied ? 'تم نسخ البرومبت ✓' : 'نسخ البرومبت'}</button>
                <a className="chatgpt-link" href="https://chatgpt.com/" target="_blank" rel="noreferrer">فتح ChatGPT ↗</a>
              </div>
              {files.length > 0 && <p className="attachment-reminder">تنبيه: النسخ لا ينقل الملفات تلقائيًا. أرفق في ChatGPT: <b>{files.map((file) => file.name).join('، ')}</b></p>}
            </article>

            <article className="import-panel">
              <div className="prompt-panel-heading"><div><span className="prompt-ready-pill import">العودة إلى الموقع</span><h2>استورد نتيجة ChatGPT</h2><p>انسخ الرد كاملًا؛ يقبل الموقع JSON الخام أو الموجود داخل صندوق كود.</p></div><span className="panel-number">٤</span></div>
              <textarea className="code-textarea import-textarea" value={importText} onChange={(event) => setImportText(event.target.value)} aria-label="نتيجة ChatGPT" placeholder={'الصق هنا النتيجة التي تبدأ مثلًا بـ:\n{\n  "title": "...",\n  "questions": [...]\n}'} spellCheck={false} />
              {error && <div className="error-message importer-error" role="alert">{error}</div>}
               <button className="import-button" disabled={imageProcessing} onClick={importChatGptResult} type="button">{imageProcessing ? 'جارٍ استخراج صور PDF…' : 'استيراد وبناء الاختبار'} <span>←</span></button>
              <p className="import-note">بعد الاستيراد يمكنك مراجعة كل سؤال ثم تنزيل ملف الأسئلة وملف الإجابات بصيغة Word.</p>
            </article>
          </div>
        </section>
      )}

      {!prompt && !result && (
        <section className="preview-strip" aria-label="مخرجات الخدمة"><div><strong>ثلاث خطوات بلا رصيد API</strong><span>جهّز البرومبت · ولّد في ChatGPT · استورد وعدّل وصدّر إلى Word</span></div><div className="mini-question"><span className="mini-num">١</span><p>ما الفكرة الرئيسة التي يشرحها النص؟</p><b>أ</b><i /><b>ب</b><i /></div></section>
      )}

      {result && (
        <>
          <section className={`results-section print-columns-${printColumns} print-size-${printSize}`} ref={resultsRef} aria-label="الأسئلة المستخرجة">
            <div className="exam-paper-header">
              <div><span>المدرسة: <b>{headerValue(examHeader.school)}</b></span><span>المادة: <b>{headerValue(examHeader.subject)}</b></span><span>المعلم/ة: <b>{headerValue(examHeader.teacher)}</b></span></div>
              <div><strong>{examHeader.testTitle || result.title}</strong><span>{headerValue(examHeader.term)}</span></div>
              <div><span>الصف: <b>{headerValue(examHeader.grade)}</b></span><span>الفصل: <b>{headerValue(examHeader.section)}</b></span><span>التاريخ: <b>{headerValue(examHeader.date)}</b></span></div>
              <p><span>اسم الطالب/ة: ........................................</span><span>الزمن: {headerValue(examHeader.duration)}</span><span>الدرجة: ........ / {formatDigits(headerValue(examHeader.totalScore || String(resultTotalScore)), numeralStyle)}</span></p>
            </div>
            <div className="results-header">
              <div><span className="result-kicker">تم استيراد نتيجة ChatGPT بنجاح</span><input aria-label="عنوان الاختبار" value={result.title} onChange={(event) => setResult({ ...result, title: event.target.value })} /><p>{result.summary}</p></div>
              <div className="results-actions">
                <button onClick={() => setShowAnswers((current) => !current)} type="button">{showAnswers ? 'إخفاء الحل' : 'إظهار الحل'}</button>
                <button onClick={copyAll} type="button">{copied ? 'تم النسخ ✓' : 'نسخ الكل'}</button>
                <button onClick={downloadText} type="button">تنزيل TXT</button>
                <button className="word-button" disabled={Boolean(wordExporting)} onClick={() => exportWord('questions')} type="button">{wordExporting === 'questions' ? 'جارٍ إنشاء Word…' : 'تنزيل الأسئلة DOCX'}</button>
                <button className="word-answer-button" disabled={Boolean(wordExporting)} onClick={() => exportWord('answers')} type="button">{wordExporting === 'answers' ? 'جارٍ إنشاء الإجابات…' : 'تنزيل الإجابات DOCX'}</button>
                <button className="print-button" onClick={() => printExam('questions')} type="button">تنزيل PDF الأسئلة</button>
                <button className="answer-print-button" onClick={() => printExam('answers')} type="button">تنزيل PDF الإجابات</button>
              </div>
            </div>
            <div className="print-controls" aria-label="تنسيق ورقة الاختبار">
              <strong>تنسيق PDF</strong>
              <label>الأعمدة <select value={printColumns} onChange={(event) => setPrintColumns(Number(event.target.value) as 1 | 2 | 3)}><option value={1}>عمود واحد</option><option value={2}>عمودان</option><option value={3}>٣ أعمدة</option></select></label>
              <label>حجم النص <select value={printSize} onChange={(event) => setPrintSize(event.target.value as 'compact' | 'normal' | 'large' | 'huge')}><option value="compact">صغير</option><option value="normal">متوسط</option><option value="large">كبير</option><option value="huge">ضخم</option></select></label>
              <span>الدرجة المحسوبة: {formatDigits(resultTotalScore, numeralStyle)}</span>
            </div>
            {wordSuccess && <div className="word-success" role="status">✓ {wordSuccess}</div>}
            {uncroppedImageCount > 0 && <div className="crop-review-warning" role="alert">⚠ يوجد {formatDigits(uncroppedImageCount, numeralStyle)} شكلًا بحدود صفحة كاملة. لن يسمح المولد بتصديرها قبل قص كل شكل من أداة «تعديل اقتصاص الشكل» داخل السؤال.</div>}
            {uncroppedImageCount === 0 && pendingImageCount > 0 && <div className="crop-review-warning" role="alert">⚠ طبّق الصفحة والقص على {formatDigits(pendingImageCount, numeralStyle)} شكلًا لمعاينتها قبل التصدير.</div>}
            <p className="pdf-save-note">عند فتح نافذة الطباعة اختر «حفظ بصيغة PDF» لتنزيل الملف.</p>
            {imageProcessing && <div className="image-processing" role="status">جارٍ تجهيز صور الصفحات محليًا…</div>}
            <div className="question-grid">
              {result.questions.map((question, index) => (
                <article className="question-card" id={`question-${question.id}`} key={question.id || index}>
                  <div className="question-meta"><span className={`question-index type-${question.type}`}>{formatDigits(index + 1, numeralStyle)}</span><span>{typeLabels[question.type]}</span><span className="difficulty-badge">{difficultyLabels[question.difficulty]}</span><label className="points-editor"><input aria-label={`درجة السؤال ${index + 1}`} type="number" min="0.5" step="0.5" value={question.points || 1} onChange={(event) => updateQuestion(question.id, { points: Math.max(0.5, Number(event.target.value) || 1) })} /> درجة</label><button aria-label="حذف السؤال" onClick={() => removeQuestion(question.id)} type="button">×</button></div>
                  <textarea className="question-editor" aria-label={`نص السؤال ${index + 1}`} value={question.question} onChange={(event) => updateQuestion(question.id, { question: event.target.value })} />
                  {containsMath(question.question) && <div className="math-live-preview"><span>معاينة الرياضيات</span><MathText value={question.question} /></div>}
                  {question.imageDataUrl && (
                    <figure className="source-figure">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={question.imageDataUrl} alt={question.sourceImage?.caption || `شكل السؤال ${index + 1}`} />
                      <figcaption>{question.sourceImage?.caption || 'شكل مستخرج من المصدر'}</figcaption>
                    </figure>
                  )}
                  <details className="manual-image-tools">
                    <summary>{question.imageDataUrl ? 'استبدال الشكل بصورة دقيقة من المصدر' : 'إضافة صورة يدوية لهذا السؤال'}</summary>
                    <div className="manual-image-actions" aria-label={`استبدال شكل السؤال ${index + 1}`}>
                      <label className="upload-image-button">
                        <input accept="image/png,image/jpeg,image/webp" onChange={(event) => handleManualImageFile(question.id, event)} type="file" />
                        <span>▧ اختيار صورة من الجهاز</span>
                      </label>
                      <button onClick={() => pasteQuestionImage(question.id)} type="button">▣ لصق صورة من الحافظة</button>
                      {question.imageOrigin === 'manual' && question.sourceImage && (
                        <label className="manual-caption-field"><span>وصف الشكل</span><input value={question.sourceImage.caption} onChange={(event) => updateQuestion(question.id, { sourceImage: { ...question.sourceImage!, caption: event.target.value } })} /></label>
                      )}
                      {question.imageOrigin === 'manual' && <button className="remove-manual-image" onClick={() => removeSourceImage(question.id)} type="button">إزالة الصورة اليدوية</button>}
                      <small>انسخ الرسم من الملف الأصلي أو التقطه بأداة القص في جهازك، ثم ألصقه هنا. سيحل محل القص الآلي في Word وPDF.</small>
                    </div>
                  </details>
                  {!question.sourceImage && pdfFiles.length > 0 && (
                    <button className="attach-source-image" disabled={imageProcessing} onClick={() => attachQuestionSourceImage(question.id)} type="button">＋ إرفاق شكل من ملف PDF بهذا السؤال</button>
                  )}
                  {question.sourceImage && question.imageOrigin !== 'manual' && (
                    <details className={`crop-editor ${isUncroppedSourceImage(question.sourceImage) ? 'needs-crop' : ''}`}>
                      <summary>{isUncroppedSourceImage(question.sourceImage) ? '⚠ اقتصاص مطلوب قبل التصدير' : 'تعديل اقتصاص الشكل'} · الصفحة {formatDigits(question.sourceImage.page, numeralStyle)}</summary>
                      {question.imageError && <p className="crop-error">{question.imageError}</p>}
                      <div className="source-image-fields">
                        <label><span>ملف PDF</span><select value={question.sourceImage.fileName} onChange={(event) => updateSourceImageMeta(question.id, { fileName: event.target.value })}>{pdfFiles.map((file) => <option key={fileKey(file)} value={file.name}>{file.name}</option>)}</select></label>
                        <label><span>رقم الصفحة</span><input min="1" type="number" value={question.sourceImage.page} onChange={(event) => updateSourceImageMeta(question.id, { page: Math.max(1, Number(event.target.value) || 1) })} /></label>
                        <label className="caption-field"><span>وصف الشكل</span><input value={question.sourceImage.caption} onChange={(event) => updateSourceImageMeta(question.id, { caption: event.target.value })} /></label>
                      </div>
                      <div className="crop-sliders">
                        {(['x', 'y', 'width', 'height'] as const).map((key) => (
                          <label key={key}><span>{key === 'x' ? 'من اليسار' : key === 'y' ? 'من الأعلى' : key === 'width' ? 'العرض' : 'الارتفاع'}: {formatDigits(Math.round(question.sourceImage!.crop[key]), numeralStyle)}٪</span><input type="range" min={key === 'width' || key === 'height' ? 1 : 0} max={100} value={question.sourceImage!.crop[key]} onChange={(event) => updateSourceCrop(question.id, key, Number(event.target.value))} /></label>
                        ))}
                      </div>
                      <div className="crop-actions"><button disabled={imageProcessing} onClick={() => refreshQuestionImage(question.id)} type="button">تطبيق الصفحة والقص</button><button className="remove-source-image" onClick={() => removeSourceImage(question.id)} type="button">إزالة الشكل</button></div>
                    </details>
                  )}
                  {question.options.length > 0 && (
                    <div className="options-editor">
                      {question.options.map((option, optionIndex) => <label key={optionIndex}><span>{formatDigits(optionIndex + 1, numeralStyle)}</span><div><input aria-label={`الخيار ${optionIndex + 1}`} value={option} onChange={(event) => updateOption(question.id, optionIndex, event.target.value)} />{containsMath(option) && <small className="option-math-preview"><MathText value={option} /></small>}</div></label>)}
                    </div>
                  )}
                  {showAnswers && (
                    <div className="answer-box"><label><span>الإجابة النموذجية</span><input value={question.correctAnswer} onChange={(event) => updateQuestion(question.id, { correctAnswer: event.target.value })} />{containsMath(question.correctAnswer) && <small className="answer-math-preview"><MathText value={question.correctAnswer} /></small>}</label><label><span>لماذا؟</span><textarea value={question.explanation} onChange={(event) => updateQuestion(question.id, { explanation: event.target.value })} /></label>{question.sourceHint && <p><b>من المصدر:</b> {question.sourceHint}</p>}</div>
                  )}
                </article>
              ))}
            </div>
            <div className="result-footer"><span>{formatDigits(result.questions.length, numeralStyle)} سؤالًا جاهزًا</span><button onClick={() => promptRef.current?.scrollIntoView({ behavior: 'smooth' })} type="button">العودة إلى البرومبت ↺</button></div>
          </section>

          <section className={`print-sheet print-columns-${printColumns} print-size-${printSize} print-${printVariant}`} aria-hidden="true">
            <div className="print-exam-header">
              <div><span>المدرسة: <b>{headerValue(examHeader.school)}</b></span><span>المادة: <b>{headerValue(examHeader.subject)}</b></span><span>المعلم/ة: <b>{headerValue(examHeader.teacher)}</b></span></div>
              <div className="print-exam-title"><strong>{examHeader.testTitle || result.title}</strong><span>{printVariant === 'answers' ? 'نموذج الإجابة' : headerValue(examHeader.term)}</span></div>
              <div><span>الصف: <b>{headerValue(examHeader.grade)}</b></span><span>الفصل: <b>{headerValue(examHeader.section)}</b></span><span>التاريخ: <b>{headerValue(examHeader.date)}</b></span></div>
              <p>{printVariant === 'questions' ? <span>اسم الطالب/ة: ........................................</span> : <span>نموذج إجابة ملون</span>}<span>الزمن: {headerValue(examHeader.duration)}</span><span>الدرجة: ........ / {formatDigits(headerValue(examHeader.totalScore || String(resultTotalScore)), numeralStyle)}</span></p>
            </div>
            <div className="print-question-grid">
              {result.questions.map((question, index) => (
                <article className="print-question" key={`print-${question.id || index}`}>
                  <div className="print-question-heading"><b>{formatDigits(index + 1, numeralStyle)}.</b><strong><MathText value={question.question} /></strong><span>({formatDigits(question.points || 1, numeralStyle)} {question.points === 1 ? 'درجة' : 'درجات'})</span></div>
                  {question.imageDataUrl && (
                    <figure>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={question.imageDataUrl} alt="" />
                      <figcaption>{question.sourceImage?.caption}</figcaption>
                    </figure>
                  )}
                  {question.options.length > 0 && <ol className="print-options">{question.options.map((option, optionIndex) => <li key={optionIndex}><b>{'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ'[optionIndex] || formatDigits(optionIndex + 1, numeralStyle)})</b><span><MathText value={option} /></span></li>)}</ol>}
                  {printVariant === 'questions' && (question.type === 'short_answer' || question.type === 'fill_blank' || question.type === 'essay') && <div className={`response-lines response-${question.type}`}><i /><i />{question.type === 'essay' && <><i /><i /></>}</div>}
                  {printVariant === 'answers' && <div className="print-answer"><p><b>الإجابة الصحيحة:</b> <MathText value={question.correctAnswer || 'غير محددة'} /></p>{question.explanation && <p><b>التفسير:</b> <MathText value={question.explanation} /></p>}{question.sourceHint && <small>من المصدر: {question.sourceHint}</small>}</div>}
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
