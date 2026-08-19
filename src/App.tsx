import {
  AnimatePresence,
  motion,
} from 'framer-motion';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Combine,
  Download,
  FileImage,
  FileOutput,
  FileType2,
  FileText,
  GripVertical,
  HardDrive,
  Image as ImageIcon,
  Minimize2,
  Plus,
  RotateCcw,
  ShieldCheck,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PDFDocument } from 'pdf-lib';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { jsPDF } from 'jspdf';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useMemo, useRef, useState } from 'react';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Mode = 'merge' | 'compress' | 'convert';
type ToastKind = 'error' | 'success' | 'info';
type ConvertFormat = 'pdf' | 'image';
type ConversionKind = 'word' | 'pdf' | 'image';

type PdfItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  pages: number;
};

type PdfOutput = {
  blob: Blob;
  name: string;
  size: number;
  originalSize: number;
  kind: 'merge' | 'compress';
  reachedTarget?: boolean;
  targetSize?: number;
};

type DownloadableFile = {
  blob: Blob;
  name: string;
  size: number;
};

type ConversionItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  kind: ConversionKind;
};

type ConversionOutput = {
  kind: 'convert';
  files: DownloadableFile[];
  download: DownloadableFile;
  outputFormat: ConvertFormat;
  originalSize: number;
  size: number;
  sourceName: string;
};

type OutputFile = PdfOutput | ConversionOutput;

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const MEGABYTE = 1024 * 1024;
const KILOBYTE = 1024;
const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;
const PAGE_PADDING = 76;

const ease = [0.22, 1, 0.36, 1] as const;
const PROGRESS_SEGMENT_COUNT = 20;

function formatBytes(bytes: number, compact = false) {
  if (bytes < KILOBYTE) return `${bytes} 字节`;
  if (bytes < MEGABYTE) {
    const value = bytes / KILOBYTE;
    return `${value >= 10 ? Math.round(value) : value.toFixed(1)} KB`;
  }
  const value = bytes / MEGABYTE;
  return `${compact ? value.toFixed(1) : value.toFixed(value >= 10 ? 1 : 2)} MB`;
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.round(value))}%`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function isWord(file: File) {
  const name = file.name.toLowerCase();
  return file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || name.endsWith('.docx');
}

function isLegacyWord(file: File) {
  return file.name.toLowerCase().endsWith('.doc');
}

function isImage(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
}

function getConversionKind(file: File): ConversionKind | null {
  if (isPdf(file)) return 'pdf';
  if (isWord(file)) return 'word';
  if (isImage(file)) return 'image';
  return null;
}

function getConversionLabel(kind: ConversionKind) {
  if (kind === 'word') return 'Word 文档';
  if (kind === 'pdf') return 'PDF 文件';
  return '图片文件';
}

function getBaseName(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function getFriendlyError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('docx') || message.includes('word')) {
    return '这个 Word 文件无法读取，请确认它是有效的 .docx 文件 ';
  }
  if (message.includes('image') || message.includes('decode')) {
    return '这个图片无法读取，请尝试 PNG、JPG 或 WebP 文件 ';
  }
  if (message.includes('encrypted') || message.includes('password')) {
    return '暂不支持有密码保护的 PDF ';
  }
  if (message.includes('no pages')) {
    return '这个 PDF 不包含可用页面 ';
  }
  if (message.includes('invalid') || message.includes('failed to parse')) {
    return '这个 PDF 无法读取，文件可能已损坏或不完整 ';
  }
  return '读取 PDF 时出现问题，请尝试其他文件 ';
}

function parseTargetSize(value: string, unit: 'KB' | 'MB') {
  const normalized = value.trim().toLowerCase().replace(/,/g, '');
  if (!normalized) return null;
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(kb|mb)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const parsedUnit = match[2] ?? unit.toLowerCase();
  return amount * (parsedUnit === 'mb' ? MEGABYTE : KILOBYTE);
}

function getDefaultTarget(size: number) {
  const half = size * 0.5;
  if (half >= MEGABYTE) {
    return { value: (half / MEGABYTE).toFixed(1), unit: 'MB' as const };
  }
  return { value: Math.max(1, Math.round(half / KILOBYTE)).toString(), unit: 'KB' as const };
}

async function inspectPdf(file: File): Promise<PdfItem> {
  const bytes = await file.arrayBuffer();
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdf.getPageCount();
  if (pages < 1) throw new Error('这个 PDF 不包含页面 ');
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
    file,
    name: file.name,
    size: file.size,
    pages,
  };
}

function bytesToArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function createMergedPdf(items: PdfItem[], onProgress: (value: number) => void) {
  const merged = await PDFDocument.create();
  for (let index = 0; index < items.length; index += 1) {
    const sourceBytes = await items[index].file.arrayBuffer();
    let source = await PDFDocument.load(sourceBytes, {
      updateMetadata: false,
    });

    // A widget annotation (for example, a filled text box) points back to
    // fields in the source document's AcroForm. Copying the page alone leaves
    // those references attached to the new page, which can make the merged
    // file fail in later PDF readers/processors. Flatten existing appearances
    // before copying so the entered content becomes ordinary page content.
    try {
      const form = source.getForm();
      if (form.getFields().length > 0) {
        form.flatten({ updateFieldAppearances: false });
      }
    } catch {
      // Some third-party PDFs have incomplete form metadata. Keep the normal
      // page-copy path as a compatibility fallback for those files.
      source = await PDFDocument.load(sourceBytes, { updateMetadata: false });
    }

    const copiedPages = await merged.copyPages(source, source.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
    onProgress(18 + ((index + 1) / items.length) * 64);
  }
  const bytes = await merged.save({
    addDefaultPage: false,
    useObjectStreams: false,
  });
  onProgress(94);
  return new Blob([bytesToArrayBuffer(bytes)], { type: 'application/pdf' });
}

async function createCompressedPdf(
  item: PdfItem,
  targetBytes: number,
  onProgress: (value: number) => void,
) {
  const sourceBytes = await item.file.arrayBuffer();
  onProgress(22);
  const pdf = await PDFDocument.load(sourceBytes, { updateMetadata: false });
  onProgress(54);
  const bytes = await pdf.save({
    addDefaultPage: false,
    objectsPerTick: 30,
    useObjectStreams: true,
    updateFieldAppearances: false,
  });
  onProgress(54);
  const structuralCandidate = new Blob([bytesToArrayBuffer(bytes)], { type: 'application/pdf' });
  let bestCandidate = structuralCandidate.size < item.size
    ? structuralCandidate
    : new Blob([sourceBytes], { type: 'application/pdf' });

  // pdf-lib can optimize the PDF container, but it cannot recompress images that
  // are already embedded in a PDF. Rasterizing pages gives image-heavy PDFs a
  // real compression path when structural optimization is not enough.
  if (bestCandidate.size <= targetBytes) {
    onProgress(94);
    return bestCandidate;
  }

  const targetRatio = clamp(targetBytes / item.size, 0.08, 0.95);
  const compressionStrength = 1 - targetRatio;
  const baseScale = clamp(1.22 - compressionStrength * 0.68, 0.58, 1.22);
  const baseQuality = clamp(0.82 - compressionStrength * 0.42, 0.38, 0.82);
  const attempts = [
    { scale: baseScale, quality: baseQuality },
    { scale: clamp(baseScale - 0.18, 0.48, 1.05), quality: clamp(baseQuality - 0.14, 0.28, 0.78) },
    { scale: clamp(baseScale - 0.34, 0.42, 0.88), quality: clamp(baseQuality - 0.26, 0.22, 0.65) },
  ];

  const loadingTask = getDocument({ data: new Uint8Array(sourceBytes) });
  const sourcePdf = await loadingTask.promise;
  try {
    for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
      const { scale, quality } = attempts[attemptIndex];
      const rasterized = await rasterizePdf(
        sourcePdf,
        scale,
        quality,
        (pageProgress) => onProgress(54 + ((attemptIndex + pageProgress / 100) / attempts.length) * 42),
      );
      if (rasterized.size < bestCandidate.size) bestCandidate = rasterized;
      if (rasterized.size <= targetBytes) break;
    }
  } finally {
    await loadingTask.destroy();
  }
  onProgress(96);
  return bestCandidate;
}

async function rasterizePdf(
  sourcePdf: Awaited<ReturnType<typeof getDocument>['promise']>,
  scale: number,
  quality: number,
  onProgress: (value: number) => void,
) {
  const compressed = await PDFDocument.create();
  for (let pageNumber = 1; pageNumber <= sourcePdf.numPages; pageNumber += 1) {
    const page = await sourcePdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const maxDimension = Math.max(baseViewport.width, baseViewport.height);
    const renderScale = Math.min(scale, 2000 / maxDimension);
    const viewport = page.getViewport({ scale: renderScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建图片画布');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality);
    const image = await compressed.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
    const outputPage = compressed.addPage([baseViewport.width, baseViewport.height]);
    outputPage.drawImage(image, {
      x: 0,
      y: 0,
      width: baseViewport.width,
      height: baseViewport.height,
    });
    page.cleanup();
    onProgress((pageNumber / sourcePdf.numPages) * 100);
  }
  const bytes = await compressed.save({
    addDefaultPage: false,
    useObjectStreams: true,
  });
  return new Blob([bytesToArrayBuffer(bytes)], { type: 'application/pdf' });
}

type RenderedPage = {
  dataUrl: string;
  file: DownloadableFile;
};

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality = 0.92) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('无法生成图片'));
    }, type, quality);
  });
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(async (image) => {
    if (image.complete) {
      try {
        await image.decode();
      } catch {
        // Some browsers do not expose decode() for data URI images.
      }
      return;
    }
    await new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }));
}

function createWordConversionSandbox() {
  const sandbox = document.createElement('div');
  sandbox.className = 'word-conversion-sandbox';
  sandbox.innerHTML = `
    <style>
      .word-conversion-page {
        box-sizing: border-box;
        width: ${PAGE_WIDTH}px;
        height: ${PAGE_HEIGHT}px;
        padding: ${PAGE_PADDING}px;
        overflow: hidden;
        background: #fff;
        color: #182532;
        font-family: Arial, "Microsoft YaHei", sans-serif;
        font-size: 16px;
        line-height: 1.55;
      }
      .word-conversion-page-content {
        box-sizing: border-box;
        height: ${PAGE_HEIGHT - PAGE_PADDING * 2}px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }
      .word-conversion-page-content > * {
        flex: 0 0 auto;
        max-width: 100%;
        margin: 0 0 13px;
      }
      .word-conversion-page-content h1,
      .word-conversion-page-content h2,
      .word-conversion-page-content h3 {
        color: #182532;
        line-height: 1.25;
      }
      .word-conversion-page-content h1 { font-size: 29px; }
      .word-conversion-page-content h2 { font-size: 23px; }
      .word-conversion-page-content h3 { font-size: 19px; }
      .word-conversion-page-content img { max-width: 100%; height: auto; }
      .word-conversion-page-content table { width: 100%; border-collapse: collapse; }
      .word-conversion-page-content td,
      .word-conversion-page-content th { border: 1px solid #cdd6df; padding: 7px 9px; text-align: left; }
      .word-conversion-page-content ul,
      .word-conversion-page-content ol { padding-left: 28px; }
      .word-conversion-page-content blockquote { margin-left: 0; padding-left: 16px; border-left: 3px solid #2f6bff; color: #5e6b78; }
    </style>
  `;
  Object.assign(sandbox.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${PAGE_WIDTH}px`,
    zIndex: '-1',
    pointerEvents: 'none',
  });
  return sandbox;
}

async function renderWordPages(file: File, onProgress: (value: number) => void) {
  if (isLegacyWord(file)) {
    throw new Error('legacy word format');
  }
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    { convertImage: mammoth.images.dataUri },
  );
  const sandbox = createWordConversionSandbox();
  const source = document.createElement('div');
  source.className = 'word-conversion-source';
  source.innerHTML = result.value.trim() || '<p>（文档没有可显示内容）</p>';
  sandbox.appendChild(source);
  document.body.appendChild(sandbox);

  const pages: HTMLElement[] = [];

  const createPage = () => {
    const page = document.createElement('section');
    page.className = 'word-conversion-page';
    const pageContent = document.createElement('div');
    pageContent.className = 'word-conversion-page-content';
    page.appendChild(pageContent);
    sandbox.appendChild(page);
    pages.push(page);
    return pageContent;
  };

  let currentContent = createPage();
  const blocks = Array.from(source.children);
  for (const block of blocks) {
    currentContent.appendChild(block);
    if (currentContent.scrollHeight > currentContent.clientHeight && currentContent.children.length > 1) {
      currentContent.removeChild(block);
      currentContent = createPage();
      currentContent.appendChild(block);
    }
  }
  source.remove();
  await Promise.all(pages.map((page) => waitForImages(page)));

  const renderedPages: RenderedPage[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    const canvas = await html2canvas(pages[index], {
      backgroundColor: '#ffffff',
      logging: false,
      scale: 1.5,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      windowWidth: PAGE_WIDTH,
    });
    const blob = await canvasToBlob(canvas, 'image/png');
    renderedPages.push({
      dataUrl: canvas.toDataURL('image/png'),
      file: {
        blob,
        name: `${getBaseName(file.name)}-${String(index + 1).padStart(3, '0')}.png`,
        size: blob.size,
      },
    });
    onProgress(20 + ((index + 1) / pages.length) * 68);
  }
  sandbox.remove();
  return renderedPages;
}

async function renderPdfPagesToImages(file: File, onProgress: (value: number) => void) {
  const loadingTask = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const files: DownloadableFile[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(1.7, Math.max(1, 1800 / baseViewport.width));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建图片画布');
      await page.render({ canvas: canvas, canvasContext: context, viewport }).promise;
      const blob = await canvasToBlob(canvas, 'image/png');
      files.push({
        blob,
        name: `${getBaseName(file.name)}-${String(pageNumber).padStart(3, '0')}.png`,
        size: blob.size,
      });
      page.cleanup();
      onProgress(18 + (pageNumber / pdf.numPages) * 70);
    }
  } finally {
    await loadingTask.destroy();
  }
  return files;
}

async function loadImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function imageToPng(file: File) {
  const image = await loadImage(file);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图片画布');
  context.drawImage(image, 0, 0);
  const blob = await canvasToBlob(canvas, 'image/png');
  return {
    dataUrl: canvas.toDataURL('image/png'),
    file: { blob, name: `${getBaseName(file.name)}.png`, size: blob.size },
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

async function imageToPdf(file: File) {
  const image = await imageToPng(file);
  const pdf = new jsPDF({
    unit: 'mm',
    format: 'a4',
    orientation: image.width > image.height ? 'landscape' : 'portrait',
  });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const scale = Math.min((pageWidth - margin * 2) / image.width, (pageHeight - margin * 2) / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  pdf.addImage(image.dataUrl, 'PNG', (pageWidth - width) / 2, (pageHeight - height) / 2, width, height, undefined, 'FAST');
  const bytes = pdf.output('arraybuffer');
  return new Blob([bytes], { type: 'application/pdf' });
}

function renderedPagesToPdf(pages: RenderedPage[]) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  pages.forEach((page, index) => {
    if (index > 0) pdf.addPage('a4', 'portrait');
    pdf.addImage(page.dataUrl, 'PNG', 0, 0, 210, 297, undefined, 'FAST');
  });
  return new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' });
}

async function zipFiles(files: DownloadableFile[], name: string) {
  const zip = new JSZip();
  files.forEach((file) => zip.file(file.name, file.blob));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return { blob, name, size: blob.size };
}

async function createConversionOutput(
  item: ConversionItem,
  format: ConvertFormat,
  onProgress: (value: number) => void,
): Promise<ConversionOutput> {
  const baseName = getBaseName(item.name);
  let files: DownloadableFile[];

  if (item.kind === 'word') {
    const pages = await renderWordPages(item.file, onProgress);
    if (format === 'pdf') {
      const blob = renderedPagesToPdf(pages);
      files = [{ blob, name: `${baseName}.pdf`, size: blob.size }];
    } else {
      files = pages.map((page) => page.file);
    }
  } else if (item.kind === 'pdf') {
    if (format === 'pdf') {
      const blob = new Blob([await item.file.arrayBuffer()], { type: 'application/pdf' });
      files = [{ blob, name: `${baseName}-converted.pdf`, size: blob.size }];
      onProgress(88);
    } else {
      files = await renderPdfPagesToImages(item.file, onProgress);
    }
  } else if (format === 'pdf') {
    const blob = await imageToPdf(item.file);
    files = [{ blob, name: `${baseName}.pdf`, size: blob.size }];
    onProgress(88);
  } else {
    const image = await imageToPng(item.file);
    files = [image.file];
    onProgress(88);
  }

  const download = files.length > 1
    ? await zipFiles(files, `${baseName}-images.zip`)
    : files[0];
  onProgress(100);
  return {
    kind: 'convert',
    files,
    download,
    outputFormat: format,
    originalSize: item.size,
    size: download.size,
    sourceName: item.name,
  };
}

function SortableFileRow({
  item,
  index,
  onRemove,
}: {
  item: PdfItem;
  index: number;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  return (
    <motion.div
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: 'hidden' }}
      transition={{ duration: 0.24, ease }}
      className={`file-row ${isDragging ? 'is-dragging' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
    >
      <button
        ref={setActivatorNodeRef}
        className="drag-handle"
        type="button"
        aria-label={`调整 ${item.name} 的顺序`}
        {...listeners}
      >
        <GripVertical size={17} strokeWidth={1.7} />
      </button>
      <span className="file-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="file-icon" aria-hidden="true">
        <FileText size={18} strokeWidth={1.7} />
      </span>
      <span className="file-copy">
        <span className="file-name" title={item.name}>{item.name}</span>
        <span className="file-meta">{item.pages} 页 <i /> {formatBytes(item.size)}</span>
      </span>
      <button
        className="icon-button remove-button"
        type="button"
        aria-label={`移除 ${item.name}`}
        onClick={() => onRemove(item.id)}
      >
        <X size={17} strokeWidth={1.8} />
      </button>
    </motion.div>
  );
}

function DropZone({
  mode,
  hasFiles,
  isNewTask,
  isDragging,
  onDragChange,
  onDrop,
  onBrowse,
}: {
  mode: Mode;
  hasFiles: boolean;
  isNewTask: boolean;
  isDragging: boolean;
  onDragChange: (value: boolean) => void;
  onDrop: (files: FileList | File[]) => void;
  onBrowse: () => void;
}) {
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isDragging) onDragChange(true);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onDragChange(false);
    if (event.dataTransfer.files.length) onDrop(event.dataTransfer.files);
  };

  return (
    <motion.div
      className={`drop-zone ${isDragging ? 'is-dragging' : ''} ${hasFiles ? 'has-files' : 'is-empty'}`}
      animate={{ scale: isDragging ? 1.012 : 1 }}
      transition={{ duration: 0.2, ease }}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) onDragChange(false);
      }}
      onDrop={handleDrop}
      onClick={onBrowse}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onBrowse();
      }}
      aria-label={mode === 'merge' ? '选择要合并的 PDF 文件' : mode === 'compress' ? '选择要压缩的 PDF' : '选择 Word、PDF 或图片文件'}
    >
      <span className="drop-orbit" aria-hidden="true" />
      <span className="upload-mark" aria-hidden="true">
        <UploadCloud size={24} strokeWidth={1.55} />
      </span>
      <span className="drop-title">
        {isDragging
          ? mode === 'convert' ? '松开鼠标，添加文件' : '松开鼠标，添加 PDF'
          : isNewTask
            ? mode === 'convert' ? '拖入文件开始新的任务' : '拖入 PDF 开始新的任务'
          : hasFiles
            ? mode === 'convert' ? '再添加一个文件' : '再添加一个 PDF'
            : mode === 'convert' ? '把文件拖到这里' : '把 PDF 拖到这里'}
      </span>
      <span className="drop-subtitle">
        {mode === 'merge' ? '或点击选择 · 支持多个文件 · 单个不超过 500 MB' : mode === 'compress' ? '或点击选择 · 一次处理一个文件 · 单个不超过 500 MB' : 'Word · PDF · PNG · JPG · WebP · 单个不超过 500 MB'}
      </span>
    </motion.div>
  );
}

function ProgressPanel({ label, progress }: { label: string; progress: number }) {
  const normalizedProgress = clamp(progress, 0, 100);
  const filledSegments = normalizedProgress > 0
    ? Math.ceil(normalizedProgress / (100 / PROGRESS_SEGMENT_COUNT))
    : 0;

  return (
    <motion.div
      className="progress-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
    >
      <div className="progress-heading">
        <div className="progress-percent-row">
          <span className="progress-percent">{formatPercent(normalizedProgress)}</span>
          <span className="progress-label">{label}</span>
        </div>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={`已完成 ${formatPercent(normalizedProgress)}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalizedProgress)}
      >
        {Array.from({ length: PROGRESS_SEGMENT_COUNT }, (_, index) => (
          <motion.span
            key={index}
            className={`progress-segment ${index < filledSegments ? 'is-filled' : ''} ${index === filledSegments - 1 && normalizedProgress < 100 ? 'is-current' : ''}`}
            initial={false}
            animate={{ opacity: index < filledSegments ? 1 : 0.72 }}
            transition={{ duration: 0.24, ease }}
            aria-hidden="true"
          />
        ))}
      </div>
      <span className="progress-note">文件始终保留在当前设备 </span>
    </motion.div>
  );
}

type ToolStepStatus = 'complete' | 'current' | 'upcoming';

function ToolStep({
  number,
  title,
  description,
  status,
}: {
  number: string;
  title: string;
  description: string;
  status: ToolStepStatus;
}) {
  return (
    <div className={`tool-step is-${status}`} aria-current={status === 'current' ? 'step' : undefined}>
      <span className="tool-step-marker" aria-hidden="true">
        {status === 'complete' ? <Check size={17} strokeWidth={2.5} /> : status === 'current' ? <span className="tool-step-current-dot" /> : <Clock3 size={17} strokeWidth={1.9} />}
      </span>
      <div className="tool-step-copy">
        <span className="tool-step-number">{number}</span>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </div>
  );
}

function ConversionFileCard({ item, onRemove }: { item: ConversionItem; onRemove: () => void }) {
  return (
    <motion.div
      className="single-file-card conversion-file-card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease }}
    >
      <span className={`file-icon file-icon-${item.kind}`}>
        {item.kind === 'word' ? <FileType2 size={19} strokeWidth={1.7} /> : item.kind === 'pdf' ? <FileText size={19} strokeWidth={1.7} /> : <FileImage size={19} strokeWidth={1.7} />}
      </span>
      <span className="file-copy">
        <span className="file-name" title={item.name}>{item.name}</span>
        <span className="file-meta">{getConversionLabel(item.kind)} <i /> {formatBytes(item.size)}</span>
      </span>
      <button className="icon-button remove-button" type="button" onClick={onRemove} aria-label={`移除 ${item.name}`}>
        <X size={17} strokeWidth={1.8} />
      </button>
    </motion.div>
  );
}

function OutputPanel({
  result,
  onDownload,
  onReset,
}: {
  result: OutputFile;
  onDownload: () => void;
  onReset: () => void;
}) {
  if (result.kind === 'convert') {
    const isImageOutput = result.outputFormat === 'image';
    const isArchive = result.files.length > 1;
    return (
      <motion.section
        className="output-panel conversion-output-panel"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.34, ease }}
      >
        <div className="output-status">
          <span className="success-mark"><Check size={15} strokeWidth={2.3} /></span>
          <div>
            <p className="eyebrow">可以下载了</p>
            <h3>{isImageOutput ? '图片已准备好' : 'PDF 已准备好'}</h3>
          </div>
        </div>
        <div className="output-stats">
          <div>
            <span className="stat-label">输出内容</span>
            <strong>{isImageOutput ? `${result.files.length} 张图片` : '1 个 PDF'}</strong>
          </div>
          <div className="output-detail">
            <span className="conversion-source">来自 {result.sourceName}</span>
            {isArchive ? '将下载为 ZIP 图片包' : `文件大小 ${formatBytes(result.size)}`}
          </div>
        </div>
        <div className="output-actions">
          <button className="primary-button" type="button" onClick={onDownload}>
            {isArchive ? <Download size={17} strokeWidth={1.9} /> : isImageOutput ? <ImageIcon size={17} strokeWidth={1.9} /> : <Download size={17} strokeWidth={1.9} />}
            {isArchive ? '下载图片包' : isImageOutput ? '下载图片' : '下载 PDF'}
          </button>
          <button className="text-button" type="button" onClick={onReset}>
            <RotateCcw size={15} strokeWidth={1.8} />
            重新开始
          </button>
        </div>
      </motion.section>
    );
  }
  const reduction = result.originalSize > 0 ? (1 - result.size / result.originalSize) * 100 : 0;
  const isSmaller = reduction > 0;
  return (
    <motion.section
      className="output-panel"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.34, ease }}
    >
      <div className="output-status">
        <span className="success-mark"><Check size={15} strokeWidth={2.3} /></span>
        <div>
          <p className="eyebrow">可以下载了</p>
          <h3>{result.kind === 'merge' ? '合并完成' : '压缩完成'}</h3>
        </div>
      </div>
      <div className="output-stats">
        <div>
          <span className="stat-label">{result.kind === 'merge' ? '输出文件' : '压缩前'}</span>
          <strong>{result.kind === 'merge' ? `${formatBytes(result.size)}` : formatBytes(result.originalSize)}</strong>
        </div>
        {result.kind === 'compress' && (
          <>
            <span className="stat-arrow">→</span>
            <div>
              <span className="stat-label">压缩后</span>
              <strong>{formatBytes(result.size)}</strong>
            </div>
          </>
        )}
        <div className="output-detail">
          {result.kind === 'merge' ? 'PDF 已准备好' : isSmaller ? `体积减少 ${Math.round(reduction)}%` : '本地可达到的最佳结果'}
          {result.kind === 'compress' && <span>目标 {formatBytes(result.targetSize ?? result.size)}{result.reachedTarget === false ? ' · 尚未达到' : ''}</span>}
        </div>
      </div>
      <div className="output-actions">
        <button className="primary-button" type="button" onClick={onDownload}>
          <Download size={17} strokeWidth={1.9} />
          下载 PDF
        </button>
        <button className="text-button" type="button" onClick={onReset}>
          <RotateCcw size={15} strokeWidth={1.8} />
          重新开始
        </button>
      </div>
    </motion.section>
  );
}

function App() {
  const [mode, setMode] = useState<Mode>('merge');
  const [mergeItems, setMergeItems] = useState<PdfItem[]>([]);
  const [compressItems, setCompressItems] = useState<PdfItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('准备 PDF');
  const [mergeResult, setMergeResult] = useState<OutputFile | null>(null);
  const [compressResult, setCompressResult] = useState<OutputFile | null>(null);
  const [conversionItem, setConversionItem] = useState<ConversionItem | null>(null);
  const [conversionFormat, setConversionFormat] = useState<ConvertFormat>('pdf');
  const [conversionResult, setConversionResult] = useState<ConversionOutput | null>(null);
  const [targetDraft, setTargetDraft] = useState('');
  const [targetUnit, setTargetUnit] = useState<'KB' | 'MB'>('MB');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const toastId = useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeItems = mode === 'merge' ? mergeItems : compressItems;
  const activeItemCount = mode === 'convert' ? (conversionItem ? 1 : 0) : activeItems.length;
  const activeResult = mode === 'merge' ? mergeResult : mode === 'compress' ? compressResult : conversionResult;
  const compressItem = compressItems[0];
  const targetBytes = compressItem ? parseTargetSize(targetDraft, targetUnit) : null;
  const targetError = compressItem && targetDraft && !targetBytes
    ? '请输入类似 5 MB 或 400 KB 的大小 '
    : compressItem && targetBytes && targetBytes >= compressItem.size
      ? '目标大小必须小于原始文件 '
      : null;
  const canProcess = mode === 'merge'
    ? mergeItems.length >= 2
    : mode === 'compress'
      ? Boolean(compressItem && targetBytes && targetBytes < compressItem.size)
      : Boolean(conversionItem);

  const totalPages = useMemo(
    () => mergeItems.reduce((sum, item) => sum + item.pages, 0),
    [mergeItems],
  );

  const showToast = (message: string, kind: ToastKind = 'info') => {
    const id = toastId.current + 1;
    toastId.current = id;
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  };

  const openFilePicker = () => inputRef.current?.click();

  const addFiles = async (rawFiles: FileList | File[]) => {
    const files = Array.from(rawFiles);
    if (!files.length) return;
    if (mode === 'convert') {
      const file = files[0];
      if (file.size > MAX_FILE_SIZE) {
        showToast(`${file.name} 超过 500 MB 大小限制 `, 'error');
        return;
      }
      if (isLegacyWord(file)) {
        showToast('暂不支持旧版 .doc，请另存为 .docx 后再转换 ', 'error');
        return;
      }
      const kind = getConversionKind(file);
      if (!kind) {
        showToast(`${file.name} 不是支持的 Word、PDF 或图片文件 `, 'error');
        return;
      }
      setConversionItem({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
        file,
        name: file.name,
        size: file.size,
        kind,
      });
      setConversionResult(null);
      setConversionFormat('pdf');
      if (files.length > 1) showToast('格式转换一次处理一个文件，已使用第一个文件 ', 'info');
      return;
    }

    const validFiles = files.filter((file) => {
      if (!isPdf(file)) {
        showToast(`${file.name} 不是 PDF 文件 `, 'error');
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        showToast(`${file.name} 超过 500 MB 大小限制 `, 'error');
        return false;
      }
      return true;
    });
    if (!validFiles.length) return;

    try {
      if (mode === 'compress') {
        const item = await inspectPdf(validFiles[0]);
        setCompressItems([item]);
        setCompressResult(null);
        const defaultTarget = getDefaultTarget(item.size);
        setTargetDraft(defaultTarget.value);
        setTargetUnit(defaultTarget.unit);
        if (validFiles.length > 1) showToast('压缩模式一次处理一个 PDF，已使用第一个文件 ', 'info');
      } else {
        const isStartingNewMerge = Boolean(mergeResult);
        const existingNames = new Set(
          (isStartingNewMerge ? [] : mergeItems).map((item) => `${item.name}-${item.size}`),
        );
        const nextItems: PdfItem[] = [];
        for (const file of validFiles) {
          if (existingNames.has(`${file.name}-${file.size}`)) {
            showToast(`${file.name} 已经在列表中 `, 'info');
            continue;
          }
          nextItems.push(await inspectPdf(file));
        }
        if (nextItems.length) {
          setMergeItems((current) => isStartingNewMerge ? nextItems : [...current, ...nextItems]);
          setMergeResult(null);
        }
      }
    } catch (error) {
      showToast(getFriendlyError(error), 'error');
    }
  };

  const switchMode = (nextMode: Mode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    setIsDragging(false);
    setIsProcessing(false);
  };

  const handleBrowse = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = '';
  };

  const handleSortEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return;
    setMergeItems((items) => {
      const oldIndex = items.findIndex((item) => item.id === event.active.id);
      const newIndex = items.findIndex((item) => item.id === event.over?.id);
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const removeMergeItem = (id: string) => {
    setMergeItems((items) => items.filter((item) => item.id !== id));
    setMergeResult(null);
  };

  const removeCompressItem = () => {
    setCompressItems([]);
    setCompressResult(null);
    setTargetDraft('');
  };

  const removeConversionItem = () => {
    setConversionItem(null);
    setConversionResult(null);
  };

  const processFiles = async () => {
    if (!canProcess || isProcessing) return;
    setIsProcessing(true);
    setProgress(8);
    setProgressLabel(mode === 'merge' ? '读取 PDF' : mode === 'compress' ? '分析 PDF' : '准备转换');
    try {
      if (mode === 'merge') {
        setProgressLabel('合并页面');
        const blob = await createMergedPdf(mergeItems, setProgress);
        setProgressLabel('正在完成');
        setProgress(100);
        setMergeResult({
          blob,
          name: 'merged.pdf',
          size: blob.size,
          originalSize: mergeItems.reduce((sum, item) => sum + item.size, 0),
          kind: 'merge',
        });
      } else if (compressItem && targetBytes) {
        setProgressLabel('优化 PDF 结构');
        const blob = await createCompressedPdf(compressItem, targetBytes, setProgress);
        setProgressLabel('正在完成');
        setProgress(100);
        setCompressResult({
          blob,
          name: `${compressItem.name.replace(/\.pdf$/i, '')}-compressed.pdf`,
          size: blob.size,
          originalSize: compressItem.size,
          kind: 'compress',
          reachedTarget: blob.size <= targetBytes,
          targetSize: targetBytes,
        });
      } else if (mode === 'convert' && conversionItem) {
        setProgressLabel(conversionFormat === 'pdf' ? '准备 PDF' : '渲染图片');
        const result = await createConversionOutput(conversionItem, conversionFormat, setProgress);
        setProgressLabel('正在完成');
        setProgress(100);
        setConversionResult(result);
      }
    } catch (error) {
      showToast(getFriendlyError(error), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadResult = (result: OutputFile | null) => {
    if (!result) return;
    const downloadable = result.kind === 'convert' ? result.download : result;
    const url = URL.createObjectURL(downloadable.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadable.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const resetActiveTask = () => {
    if (mode === 'merge') {
      setMergeItems([]);
      setMergeResult(null);
    } else if (mode === 'compress') {
      removeCompressItem();
    } else {
      removeConversionItem();
    }
    setProgress(0);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="/" onClick={(event) => event.preventDefault()} aria-label="ZhiLuo 首页">
            <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
            <span>ZhiLuo</span>
          </a>
        </div>
      </header>

      <main className="main-content">
        <section className="intro-block" id="about">
          <h1>处理 PDF，<em>从这里开始</em></h1>
          <p className="intro-copy">合并、压缩或转换文件。无需账号，文件始终留在你的设备。</p>
          <div className={`mode-switch intro-mode-switch mode-${mode}`} role="tablist" aria-label="文件操作">
            <button className={mode === 'merge' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'merge'} onClick={() => switchMode('merge')}>
              <Combine size={20} strokeWidth={1.8} aria-hidden="true" />
              <span>合并 PDF</span>
            </button>
            <button className={mode === 'compress' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'compress'} onClick={() => switchMode('compress')}>
              <Minimize2 size={20} strokeWidth={1.8} aria-hidden="true" />
              <span>压缩 PDF</span>
            </button>
            <button className={mode === 'convert' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'convert'} onClick={() => switchMode('convert')}>
              <FileOutput size={20} strokeWidth={1.8} aria-hidden="true" />
              <span>格式转换</span>
            </button>
          </div>
        </section>

        <section className="workspace-card" id="workspace" aria-label="文件工作区">
          <div className="workspace-body">
            <aside className="tool-description" aria-label="工具说明">
              <div className="tool-description-kicker">
                <span className="tool-index">01</span>
                <span>当前工具</span>
              </div>
              <div>
                <h2>{mode === 'merge' ? '合并 PDF' : mode === 'compress' ? '压缩 PDF' : '格式转换'}</h2>
                <p>{mode === 'merge' ? '把多个文件按顺序合成一个 PDF。页面内容保持原样。' : mode === 'compress' ? '设定目标大小，减少文件体积，方便发送与存档。' : '在 Word、PDF 和图片之间转换，适合打印与分享。'}</p>
              </div>
              <div className="tool-steps" aria-label="处理流程">
                <ToolStep
                  number="01"
                  title="输入文件"
                  description="添加要处理的文件"
                  status={activeItemCount ? 'complete' : 'current'}
                />
                <ToolStep
                  number="02"
                  title="设置参数"
                  description={mode === 'merge' ? '确认文件顺序' : mode === 'compress' ? '调整目标大小' : '选择输出格式'}
                  status={activeResult ? 'complete' : activeItemCount ? 'current' : 'upcoming'}
                />
                <ToolStep
                  number="03"
                  title="下载结果"
                  description="处理完成后保存文件"
                  status={activeResult ? 'current' : 'upcoming'}
                />
              </div>
            </aside>

            <div className="task-content">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={mode}
                  className="mode-content"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.2, ease }}
                >
                  <div className="task-heading">
                    <div>
                      <h2>{mode === 'merge' ? '添加 PDF 文件' : mode === 'compress' ? '添加一个 PDF' : '添加要转换的文件'}</h2>
                    </div>
                    <span className="task-description">{mode === 'merge' ? '支持多个文件，可拖动调整顺序。' : mode === 'compress' ? '目标大小越小，页面图片质量可能越低。' : '支持 Word、PDF、PNG、JPG 和 WebP。'}</span>
                  </div>

                  {!isProcessing && (mode === 'merge' || !activeItemCount || Boolean(activeResult)) && (
                    <DropZone
                      mode={mode}
                      hasFiles={activeItemCount > 0}
                      isNewTask={Boolean(activeResult)}
                      isDragging={isDragging}
                      onDragChange={setIsDragging}
                      onDrop={addFiles}
                      onBrowse={openFilePicker}
                    />
                  )}

                  {mode === 'merge' && mergeItems.length > 0 && (
                    <>
                      <div className="list-summary">
                        <span>共 <strong>{mergeItems.length}</strong> 个 PDF，已按顺序排列</span>
                        <span>共 {totalPages} 页</span>
                      </div>
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSortEnd}>
                        <SortableContext items={mergeItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                          <motion.div className="file-list" layout>
                            <AnimatePresence initial={false}>
                              {mergeItems.map((item, index) => (
                                <SortableFileRow key={item.id} item={item} index={index} onRemove={removeMergeItem} />
                              ))}
                            </AnimatePresence>
                          </motion.div>
                        </SortableContext>
                      </DndContext>
                      {!isProcessing && !mergeResult && (
                        <button className="add-pdf-button" type="button" onClick={openFilePicker}>
                          <Plus size={16} strokeWidth={1.9} />
                          添加 PDF
                        </button>
                      )}
                    </>
                  )}

                  {mode === 'compress' && compressItem && !compressResult && (
                    <div className="compress-setup">
                      <div className="single-file-card">
                        <span className="file-icon"><FileText size={19} strokeWidth={1.7} /></span>
                        <span className="file-copy">
                          <span className="file-name" title={compressItem.name}>{compressItem.name}</span>
                          <span className="file-meta">{compressItem.pages} 页 <i /> {formatBytes(compressItem.size)}</span>
                        </span>
                        <button className="icon-button remove-button" type="button" onClick={removeCompressItem} aria-label="移除 PDF">
                          <X size={17} strokeWidth={1.8} />
                        </button>
                      </div>
                      <div className="target-block">
                        <div className="target-heading">
                          <div>
                            <span className="section-label">目标大小</span>
                            <span className="section-note">原始大小：{formatBytes(compressItem.size)}</span>
                          </div>
                          <span className="target-hint">优先保留清晰度</span>
                        </div>
                        <div className={`target-input-wrap ${targetError ? 'has-error' : ''}`}>
                          <input
                            value={targetDraft}
                            onChange={(event) => setTargetDraft(event.target.value)}
                            aria-label="目标文件大小"
                            inputMode="decimal"
                            placeholder="输入大小"
                          />
                          <select value={targetUnit} onChange={(event) => setTargetUnit(event.target.value as 'KB' | 'MB')} aria-label="目标大小单位">
                            <option value="KB">KB</option>
                            <option value="MB">MB</option>
                          </select>
                          <ChevronDown className="select-chevron" size={14} strokeWidth={1.8} aria-hidden="true" />
                        </div>
                        {targetError && <span className="input-error"><CircleAlert size={13} /> {targetError}</span>}
                        <div className="target-presets" aria-label="目标大小快捷选项">
                          {[['轻度', 0.5], ['中度', 0.3], ['强力', 0.15]].map(([label, ratio]) => {
                            const bytes = compressItem.size * Number(ratio);
                            const preset = getDefaultTarget(bytes);
                            return (
                              <button key={label} type="button" onClick={() => { setTargetDraft(preset.value); setTargetUnit(preset.unit); }}>
                                <span>{label}</span>
                                <small>{Math.round(Number(ratio) * 100)}%</small>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {mode === 'convert' && conversionItem && !conversionResult && (
                    <div className="convert-setup">
                      <ConversionFileCard item={conversionItem} onRemove={removeConversionItem} />
                      <div className="convert-format-block">
                        <div className="target-heading">
                          <div>
                            <span className="section-label">输出格式</span>
                            <span className="section-note">原始文件：{formatBytes(conversionItem.size)}</span>
                          </div>
                          <span className="target-hint">本地转换，不上传文件</span>
                        </div>
                        <div className="convert-format-switch" role="radiogroup" aria-label="选择输出格式">
                          <button className={conversionFormat === 'pdf' ? 'is-active' : ''} type="button" role="radio" aria-checked={conversionFormat === 'pdf'} onClick={() => setConversionFormat('pdf')}>
                            <FileText size={18} strokeWidth={1.7} />
                            <span><strong>PDF</strong><small>{conversionItem.kind === 'pdf' ? '保留 PDF 文件' : '适合打印和分享'}</small></span>
                          </button>
                          <button className={conversionFormat === 'image' ? 'is-active' : ''} type="button" role="radio" aria-checked={conversionFormat === 'image'} onClick={() => setConversionFormat('image')}>
                            <ImageIcon size={18} strokeWidth={1.7} />
                            <span><strong>图片</strong><small>{conversionItem.kind === 'pdf' ? '每页一张 PNG' : '每页一张 PNG'}</small></span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {isProcessing && <ProgressPanel label={progressLabel} progress={progress} />}
                  {!isProcessing && activeResult && (
                    <OutputPanel result={activeResult} onDownload={() => downloadResult(activeResult)} onReset={resetActiveTask} />
                  )}

                  {!isProcessing && !activeResult && mode === 'merge' && mergeItems.length < 2 && mergeItems.length > 0 && (
                    <div className="helper-message"><CircleAlert size={14} /> 再添加一个 PDF 才能合并 </div>
                  )}

                  {!isProcessing && !activeResult && activeItemCount > 0 && (
                    <button className="primary-button process-button" type="button" disabled={!canProcess} onClick={() => void processFiles()}>
                      {mode === 'merge' ? `合并 ${mergeItems.length} 个 PDF` : mode === 'compress' ? '压缩 PDF' : conversionFormat === 'pdf' ? '转换为 PDF' : '转换为图片'}
                      <span className="button-arrow">↗</span>
                    </button>
                  )}

                  {!isProcessing && !activeResult && !activeItemCount && (
                    <div className="empty-footnote"><ShieldCheck size={14} /> 本地处理 · 文件不会上传</div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>

        <div className="page-footnote">
          <span><HardDrive size={14} strokeWidth={1.7} /> 为小任务而做 </span>
        </div>
      </main>

      <input ref={inputRef} className="visually-hidden" type="file" accept={mode === 'convert' ? 'application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*' : 'application/pdf,.pdf'} multiple={mode === 'merge'} onChange={handleBrowse} />

      <AnimatePresence>
        {toasts.length > 0 && (
          <div className="toast-stack" aria-live="polite">
            {toasts.map((toast) => (
              <motion.div key={toast.id} className={`toast toast-${toast.kind}`} initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}>
                {toast.kind === 'error' ? <CircleAlert size={16} /> : toast.kind === 'success' ? <Check size={16} /> : <ShieldCheck size={16} />}
                <span>{toast.message}</span>
                <button type="button" onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))} aria-label="关闭提示"><X size={14} /></button>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default App;
