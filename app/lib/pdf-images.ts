type PdfCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfFigureRequest = {
  page: number;
  crop: PdfCrop;
};

export type RenderedFigure = {
  dataUrl: string;
  width: number;
  height: number;
};

type PdfDocument = Awaited<ReturnType<typeof loadPdfDocument>>;

const documentCache = new WeakMap<File, Promise<Awaited<ReturnType<typeof openPdfDocument>>>>();

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

async function openPdfDocument(file: File) {
  const [pdfjs, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs'),
  ]);
  (globalThis as typeof globalThis & { pdfjsWorker?: typeof workerModule }).pdfjsWorker = workerModule;
  pdfjs.GlobalWorkerOptions.workerPort = null;
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

async function loadPdfDocument(file: File) {
  let pending = documentCache.get(file);
  if (!pending) {
    pending = openPdfDocument(file);
    documentCache.set(file, pending);
  }
  return pending;
}

export async function renderPdfFigure(file: File, request: PdfFigureRequest): Promise<RenderedFigure> {
  const documentFile: PdfDocument = await loadPdfDocument(file);
  const pageNumber = Math.trunc(request.page);
  if (pageNumber < 1 || pageNumber > documentFile.numPages) {
    throw new Error(`الصفحة ${pageNumber} غير موجودة في الملف ${file.name}.`);
  }

  const page = await documentFile.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const targetWidth = clamp(baseViewport.width * 2, 1200, 2200);
  const viewport = page.getViewport({ scale: targetWidth / baseViewport.width });
  const pageCanvas = document.createElement('canvas');
  pageCanvas.width = Math.ceil(viewport.width);
  pageCanvas.height = Math.ceil(viewport.height);
  const pageContext = pageCanvas.getContext('2d', { alpha: false });
  if (!pageContext) throw new Error('تعذر تجهيز مساحة رسم صفحة PDF.');
  await page.render({ canvas: pageCanvas, canvasContext: pageContext, viewport }).promise;

  const x = clamp(request.crop.x, 0, 99);
  const y = clamp(request.crop.y, 0, 99);
  const width = clamp(request.crop.width, 1, 100 - x);
  const height = clamp(request.crop.height, 1, 100 - y);
  const sourceX = Math.round((x / 100) * pageCanvas.width);
  const sourceY = Math.round((y / 100) * pageCanvas.height);
  const sourceWidth = Math.max(1, Math.round((width / 100) * pageCanvas.width));
  const sourceHeight = Math.max(1, Math.round((height / 100) * pageCanvas.height));

  const maximumOutputWidth = 1400;
  const outputScale = Math.min(1, maximumOutputWidth / sourceWidth);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = Math.max(1, Math.round(sourceWidth * outputScale));
  outputCanvas.height = Math.max(1, Math.round(sourceHeight * outputScale));
  const outputContext = outputCanvas.getContext('2d', { alpha: false });
  if (!outputContext) throw new Error('تعذر إنشاء صورة الشكل المستخرج.');
  outputContext.fillStyle = '#ffffff';
  outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
  outputContext.drawImage(
    pageCanvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height,
  );

  return {
    dataUrl: outputCanvas.toDataURL('image/png'),
    width: outputCanvas.width,
    height: outputCanvas.height,
  };
}
