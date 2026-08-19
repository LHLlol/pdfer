import {
  AnimatePresence,
  motion,
} from 'framer-motion';
import {
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  FileText,
  GripVertical,
  HardDrive,
  Plus,
  RotateCcw,
  ShieldCheck,
  Sparkles,
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
import { useMemo, useRef, useState } from 'react';

type Mode = 'merge' | 'compress';
type ToastKind = 'error' | 'success' | 'info';

type PdfItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  pages: number;
};

type OutputFile = {
  blob: Blob;
  name: string;
  size: number;
  originalSize: number;
  kind: Mode;
  reachedTarget?: boolean;
  targetSize?: number;
};

type Toast = {
  id: number;
  kind: ToastKind;
  message: string;
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MEGABYTE = 1024 * 1024;
const KILOBYTE = 1024;

const ease = [0.22, 1, 0.36, 1] as const;

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

function isPdf(file: File) {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function getFriendlyError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
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
    const source = await PDFDocument.load(await items[index].file.arrayBuffer(), {
      updateMetadata: false,
    });
    const copiedPages = await merged.copyPages(source, source.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
    onProgress(18 + ((index + 1) / items.length) * 64);
  }
  const bytes = await merged.save({
    addDefaultPage: false,
    useObjectStreams: true,
  });
  onProgress(94);
  return new Blob([bytesToArrayBuffer(bytes)], { type: 'application/pdf' });
}

async function createCompressedPdf(
  item: PdfItem,
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
  onProgress(92);
  const candidate = new Blob([bytesToArrayBuffer(bytes)], { type: 'application/pdf' });
  return candidate.size < item.size ? candidate : new Blob([sourceBytes], { type: 'application/pdf' });
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
  isDragging,
  onDragChange,
  onDrop,
  onBrowse,
}: {
  mode: Mode;
  hasFiles: boolean;
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
      className={`drop-zone ${isDragging ? 'is-dragging' : ''} ${hasFiles ? 'has-files' : ''}`}
      animate={{ scale: isDragging ? 1.012 : 1 }}
      transition={{ duration: 0.2, ease }}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) onDragChange(false);
      }}
      onDrop={handleDrop}
      onClick={onBrowse}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onBrowse();
      }}
      aria-label={mode === 'merge' ? '选择要合并的 PDF 文件' : '选择要压缩的 PDF'}
    >
      <span className="drop-orbit" aria-hidden="true" />
      <span className="upload-mark" aria-hidden="true">
        <UploadCloud size={24} strokeWidth={1.55} />
      </span>
      <span className="drop-title">{isDragging ? '松开鼠标，添加 PDF' : hasFiles ? '再添加一个 PDF' : '把 PDF 拖到这里'}</span>
      <span className="drop-subtitle">{mode === 'merge' ? '或点击选择 · 支持多个文件' : '或点击选择 · 一次处理一个文件'}</span>
    </motion.div>
  );
}

function ProgressPanel({ label, progress }: { label: string; progress: number }) {
  return (
    <motion.div
      className="progress-panel"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
    >
      <div className="progress-heading">
        <span>{label}</span>
        <span>{formatPercent(progress)}</span>
      </div>
      <div className="progress-track" aria-label={`已完成 ${formatPercent(progress)}`}>
        <motion.div className="progress-value" animate={{ width: `${progress}%` }} transition={{ duration: 0.35, ease }} />
      </div>
      <span className="progress-note">文件始终保留在当前设备 </span>
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
  const activeResult = mode === 'merge' ? mergeResult : compressResult;
  const compressItem = compressItems[0];
  const targetBytes = compressItem ? parseTargetSize(targetDraft, targetUnit) : null;
  const targetError = compressItem && targetDraft && !targetBytes
    ? '请输入类似 5 MB 或 400 KB 的大小 '
    : compressItem && targetBytes && targetBytes >= compressItem.size
      ? '目标大小必须小于原始文件 '
      : null;
  const canProcess = mode === 'merge'
    ? mergeItems.length >= 2
    : Boolean(compressItem && targetBytes && targetBytes < compressItem.size);

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
    const validFiles = files.filter((file) => {
      if (!isPdf(file)) {
        showToast(`${file.name} 不是 PDF 文件 `, 'error');
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        showToast(`${file.name} 超过 100 MB 大小限制 `, 'error');
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
        const existingNames = new Set(mergeItems.map((item) => `${item.name}-${item.size}`));
        const nextItems: PdfItem[] = [];
        for (const file of validFiles) {
          if (existingNames.has(`${file.name}-${file.size}`)) {
            showToast(`${file.name} 已经在列表中 `, 'info');
            continue;
          }
          nextItems.push(await inspectPdf(file));
        }
        if (nextItems.length) {
          setMergeItems((current) => [...current, ...nextItems]);
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

  const processFiles = async () => {
    if (!canProcess || isProcessing) return;
    setIsProcessing(true);
    setProgress(8);
    setProgressLabel(mode === 'merge' ? '读取 PDF' : '分析 PDF');
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
        const blob = await createCompressedPdf(compressItem, setProgress);
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
      }
    } catch (error) {
      showToast(getFriendlyError(error), 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const downloadResult = (result: OutputFile | null) => {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const resetActiveTask = () => {
    if (mode === 'merge') {
      setMergeItems([]);
      setMergeResult(null);
    } else {
      removeCompressItem();
    }
    setProgress(0);
  };

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => event.preventDefault()} aria-label="纸落首页">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>纸落</span>
        </a>
        <div className="topbar-meta">
          <span className="privacy-pip" />
          <span>本地处理</span>
          <span className="meta-divider" />
          <span>PDF 工具 / 02</span>
        </div>
      </header>

      <main className="main-content">
        <section className="intro-block">
          <p className="eyebrow intro-eyebrow"><span>01</span> 更轻的 PDF 工作流</p>
          <h1>拖入 设定 <em>完成</em></h1>
          <p className="intro-copy">在安静、专注的空间里合并或压缩 PDF <br className="desktop-break" /> 无需账号，没有多余功能，文件不会离开你的设备 </p>
        </section>

        <section className="workspace-card" aria-label="PDF 工作区">
          <div className="workspace-topline">
            <div className="mode-label">
              <span className="tiny-file-icon"><FileText size={14} strokeWidth={1.8} /></span>
              <span>{mode === 'merge' ? '排列并合并' : '减小文件体积'}</span>
            </div>
            <div className="mode-switch" role="tablist" aria-label="PDF 操作">
              <button className={mode === 'merge' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'merge'} onClick={() => switchMode('merge')}>合并 PDF</button>
              <button className={mode === 'compress' ? 'is-active' : ''} type="button" role="tab" aria-selected={mode === 'compress'} onClick={() => switchMode('compress')}>压缩 PDF</button>
            </div>
          </div>

          <div className="workspace-body">
            <div className="task-rail" aria-hidden="true">
              <span className="rail-kicker">流程</span>
              <span className="rail-step is-current">01 <i>输入</i></span>
              <span className="rail-line" />
              <span className={`rail-step ${activeItems.length ? 'is-current' : ''}`}>02 <i>设定</i></span>
              <span className="rail-line" />
              <span className={`rail-step ${activeResult ? 'is-current' : ''}`}>03 <i>输出</i></span>
            </div>

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
                      <p className="eyebrow">{mode === 'merge' ? '01 / 按顺序合并' : '01 / 设定目标大小'}</p>
                      <h2>{mode === 'merge' ? '把多个 PDF 合成一个 ' : '让 PDF 更轻一些 '}</h2>
                    </div>
                    <span className="task-description">{mode === 'merge' ? '拖动调整顺序，页面内容保持原样 ' : '设定你想要的大小，文字和矢量内容仍可搜索 '}</span>
                  </div>

                  {!activeItems.length && (
                    <DropZone
                      mode={mode}
                      hasFiles={false}
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
                          <span className="target-hint">文字仍可搜索</span>
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

                  {isProcessing && <ProgressPanel label={progressLabel} progress={progress} />}
                  {!isProcessing && activeResult && (
                    <OutputPanel result={activeResult} onDownload={() => downloadResult(activeResult)} onReset={resetActiveTask} />
                  )}

                  {!isProcessing && !activeResult && mode === 'merge' && mergeItems.length < 2 && mergeItems.length > 0 && (
                    <div className="helper-message"><CircleAlert size={14} /> 再添加一个 PDF 才能合并 </div>
                  )}

                  {!isProcessing && !activeResult && activeItems.length > 0 && (
                    <button className="primary-button process-button" type="button" disabled={!canProcess} onClick={() => void processFiles()}>
                      {mode === 'merge' ? `合并 ${mergeItems.length} 个 PDF` : '压缩 PDF'}
                      <span className="button-arrow">↗</span>
                    </button>
                  )}

                  {!isProcessing && !activeResult && !activeItems.length && (
                    <div className="empty-footnote"><ShieldCheck size={14} /> 本地处理 · 文件不会上传</div>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>

        <div className="page-footnote">
          <span><HardDrive size={14} strokeWidth={1.7} /> 为小任务而做 </span>
          <span className="footnote-right"><Sparkles size={13} strokeWidth={1.7} /> 无需账号</span>
        </div>
      </main>

      <input ref={inputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" multiple={mode === 'merge'} onChange={handleBrowse} />

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
