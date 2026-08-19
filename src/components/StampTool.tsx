import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  CircleAlert,
  Download,
  Eraser,
  ImagePlus,
  Redo2,
  RotateCcw,
  Stamp,
  Undo2,
  UploadCloud,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  StampAnalysis,
  StampCrop,
  cropStampImageData,
  imageDataToPngBlob,
  processStampFile,
} from '../lib/stamp-removal';

type StampOutputMode = 'crop' | 'canvas';
type PreviewBackground = 'transparent' | 'white' | 'black' | 'gray';
type EditorMode = 'erase' | 'restore';
type StampPhase = 'idle' | 'processing' | 'done' | 'error';

type StampDisplay = {
  sourceImageData: ImageData;
  fullOutputImageData: ImageData;
  crop: StampCrop;
  width: number;
  height: number;
  confidence: number;
  alphaCoverage: number;
  redPixelRatio: number;
  isLikelyStamp: boolean;
  isPreviewOnly: boolean;
  version: number;
};

type StampToolState = {
  hasImage: boolean;
  hasResult: boolean;
};

type StampToolProps = {
  onStateChange?: (state: StampToolState) => void;
};

const ease = [0.22, 1, 0.36, 1] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getBaseName(name: string) {
  return name.replace(/\.[^.]+$/, '');
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} 字节`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isStampImage(file: File) {
  return file.type === 'image/png'
    || file.type === 'image/jpeg'
    || file.type === 'image/jpg'
    || file.type === 'image/webp'
    || /\.(png|jpe?g|webp)$/i.test(file.name);
}

function copyCropFromRect(imageData: ImageData, crop: StampCrop): StampCrop {
  const x = clamp(crop.x, 0, Math.max(0, imageData.width - 1));
  const y = clamp(crop.y, 0, Math.max(0, imageData.height - 1));
  const right = clamp(crop.x + crop.width, x + 1, imageData.width);
  const bottom = clamp(crop.y + crop.height, y + 1, imageData.height);
  const width = right - x;
  const height = bottom - y;
  const next = new ImageData(width, height);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * imageData.width + x) * 4;
    next.data.set(imageData.data.subarray(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return { imageData: next, x, y, width, height };
}

function displayFromAnalysis(analysis: StampAnalysis, isPreviewOnly = false): StampDisplay {
  return {
    sourceImageData: analysis.sourceImageData,
    fullOutputImageData: analysis.outputImageData,
    crop: analysis.crop,
    width: analysis.width,
    height: analysis.height,
    confidence: analysis.confidence,
    alphaCoverage: analysis.alphaCoverage,
    redPixelRatio: analysis.redPixelRatio,
    isLikelyStamp: analysis.isLikelyStamp,
    isPreviewOnly,
    version: 0,
  };
}

function drawCanvas(canvas: HTMLCanvasElement | null, display: StampDisplay | null, outputMode: StampOutputMode) {
  if (!canvas || !display) return;
  const imageData = outputMode === 'crop' ? display.crop.imageData : display.fullOutputImageData;
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (context) context.putImageData(imageData, 0, 0);
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function StampDropZone({
  isDragging,
  onDragChange,
  onDrop,
  onBrowse,
}: {
  isDragging: boolean;
  onDragChange: (value: boolean) => void;
  onDrop: (files: FileList | File[]) => void;
  onBrowse: () => void;
}) {
  return (
    <motion.div
      className={`drop-zone stamp-drop-zone ${isDragging ? 'is-dragging' : ''} is-empty`}
      animate={{ scale: isDragging ? 1.012 : 1 }}
      transition={{ duration: 0.2, ease }}
      onDragEnter={(event) => {
        event.preventDefault();
        onDragChange(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        onDragChange(true);
      }}
      onDragLeave={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) onDragChange(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDragChange(false);
        if (event.dataTransfer.files.length) onDrop(event.dataTransfer.files);
      }}
      onClick={onBrowse}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onBrowse();
      }}
      role="button"
      tabIndex={0}
      aria-label="选择要抠图的公章图片"
    >
      <span className="upload-mark" aria-hidden="true"><UploadCloud size={24} strokeWidth={1.55} /></span>
      <span className="drop-title">{isDragging ? '松开鼠标，开始抠图' : '把公章图片拖到这里'}</span>
      <span className="drop-subtitle">或点击选择 · 也可以直接粘贴图片 · PNG / JPG / WebP</span>
    </motion.div>
  );
}

function StampProgress({ progress, label }: { progress: number; label: string }) {
  const normalized = clamp(progress, 0, 100);
  return (
    <motion.div className="progress-panel stamp-progress" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease }}>
      <div className="progress-heading">
        <div className="progress-percent-row">
          <span className="progress-percent">{Math.round(normalized)}%</span>
          <span className="progress-label">{label}</span>
        </div>
      </div>
      <div className="progress-track" role="progressbar" aria-label={`已完成 ${Math.round(normalized)}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(normalized)}>
        {Array.from({ length: 20 }, (_, index) => {
          const filled = index < Math.ceil(normalized / 5);
          return <span key={index} className={`progress-segment ${filled ? 'is-filled' : ''} ${filled && index === Math.ceil(normalized / 5) - 1 ? 'is-current' : ''}`} aria-hidden="true" />;
        })}
      </div>
      <span className="progress-note">本地处理 · 图片不会上传</span>
    </motion.div>
  );
}

export function StampTool({ onStateChange }: StampToolProps) {
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [display, setDisplay] = useState<StampDisplay | null>(null);
  const [phase, setPhase] = useState<StampPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('准备图片');
  const [errorMessage, setErrorMessage] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [outputMode, setOutputMode] = useState<StampOutputMode>('crop');
  const [previewBackground, setPreviewBackground] = useState<PreviewBackground>('transparent');
  const [editorMode, setEditorMode] = useState<EditorMode>('erase');
  const [brushSize, setBrushSize] = useState(42);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [exportBlob, setExportBlob] = useState<Blob | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayRef = useRef<StampDisplay | null>(null);
  const historyRef = useRef<Uint8ClampedArray[]>([]);
  const redoRef = useRef<Uint8ClampedArray[]>([]);
  const paintingRef = useRef(false);

  useLayoutEffect(() => {
    displayRef.current = display;
    drawCanvas(canvasRef.current, display, outputMode);
  }, [display, outputMode, phase]);

  useEffect(() => {
    onStateChange?.({ hasImage: Boolean(file), hasResult: Boolean(file && display && phase === 'done') });
  }, [display, file, onStateChange, phase]);

  useEffect(() => {
    if (!display || phase === 'processing') return;
    let cancelled = false;
    const imageData = outputMode === 'crop' ? display.crop.imageData : display.fullOutputImageData;
    void imageDataToPngBlob(imageData).then((blob) => {
      if (cancelled) return;
      const url = URL.createObjectURL(blob);
      setExportBlob(blob);
      setExportUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [display, outputMode, phase]);

  useEffect(() => () => {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);

  useEffect(() => () => {
    if (exportUrl) URL.revokeObjectURL(exportUrl);
  }, [exportUrl]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'));
      const pastedFile = imageItem?.getAsFile();
      if (pastedFile) {
        event.preventDefault();
        void processFile(pastedFile);
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

  const resetHistory = () => {
    historyRef.current = [];
    redoRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  };

  const processFile = async (nextFile: File) => {
    if (!isStampImage(nextFile)) {
      setErrorMessage('暂不支持这个文件，请使用 PNG、JPG、JPEG 或 WebP 图片');
      setPhase('error');
      return;
    }
    if (nextFile.size > 500 * 1024 * 1024) {
      setErrorMessage('图片超过 500 MB 大小限制');
      setPhase('error');
      return;
    }

    const nextSourceUrl = URL.createObjectURL(nextFile);
    setFile(nextFile);
    setSourceUrl(nextSourceUrl);
    setDisplay(null);
    setExportBlob(null);
    setExportUrl(null);
    setErrorMessage('');
    setProgress(5);
    setProgressLabel('正在读取图片');
    setPhase('processing');
    setOutputMode('crop');
    resetHistory();

    try {
      const analysis = await processStampFile(
        nextFile,
        (nextProgress, label) => {
          setProgress(nextProgress);
          setProgressLabel(label);
        },
        (preview) => {
          setDisplay({
            sourceImageData: preview.outputImageData,
            fullOutputImageData: preview.outputImageData,
            crop: preview.crop,
            width: preview.width,
            height: preview.height,
            confidence: preview.confidence,
            alphaCoverage: preview.alphaCoverage,
            redPixelRatio: preview.redPixelRatio,
            isLikelyStamp: preview.redPixelRatio > 0.00015 && preview.alphaCoverage > 0.00015,
            isPreviewOnly: true,
            version: 0,
          });
        },
      );
      setDisplay(displayFromAnalysis(analysis));
      setPhase('done');
      setProgress(100);
      setProgressLabel('处理完成');
    } catch {
      setDisplay(null);
      setErrorMessage('这张图片无法读取，请尝试 PNG、JPG 或 WebP 文件');
      setPhase('error');
    }
  };

  const handleDrop = (files: FileList | File[]) => {
    const nextFile = Array.from(files)[0];
    if (nextFile) void processFile(nextFile);
  };

  const updateDisplayAfterPaint = () => {
    const current = displayRef.current;
    if (!current) return;
    const nextCrop = copyCropFromRect(current.fullOutputImageData, current.crop);
    const nextDisplay = {
      ...current,
      crop: nextCrop,
      version: current.version + 1,
    };
    displayRef.current = nextDisplay;
    setDisplay(nextDisplay);
  };

  const paintAt = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = displayRef.current;
    const canvas = canvasRef.current;
    if (!current || !canvas || current.isPreviewOnly) return;
    const rect = canvas.getBoundingClientRect();
    const activeData = outputMode === 'crop' ? current.crop.imageData : current.fullOutputImageData;
    const localX = clamp(Math.floor(((event.clientX - rect.left) / Math.max(1, rect.width)) * activeData.width), 0, activeData.width - 1);
    const localY = clamp(Math.floor(((event.clientY - rect.top) / Math.max(1, rect.height)) * activeData.height), 0, activeData.height - 1);
    const fullX = outputMode === 'crop' ? current.crop.x + localX : localX;
    const fullY = outputMode === 'crop' ? current.crop.y + localY : localY;
    const source = current.sourceImageData.data;
    const output = current.fullOutputImageData.data;
    const radius = Math.max(2, (brushSize / 2) * Math.max(1, Math.max(current.width, current.height) / 1200));
    const left = Math.max(0, Math.floor(fullX - radius));
    const right = Math.min(current.width - 1, Math.ceil(fullX + radius));
    const top = Math.max(0, Math.floor(fullY - radius));
    const bottom = Math.min(current.height - 1, Math.ceil(fullY + radius));

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const distance = Math.sqrt((x - fullX) ** 2 + (y - fullY) ** 2) / radius;
        if (distance > 1) continue;
        const pixelIndex = (y * current.width + x) * 4;
        if (editorMode === 'erase') {
          const strength = distance > 0.74 ? (1 - distance) / 0.26 : 1;
          output[pixelIndex + 3] = Math.round(output[pixelIndex + 3] * (1 - strength));
        } else {
          output[pixelIndex] = source[pixelIndex];
          output[pixelIndex + 1] = source[pixelIndex + 1];
          output[pixelIndex + 2] = source[pixelIndex + 2];
          output[pixelIndex + 3] = source[pixelIndex + 3];
        }
      }
    }
    drawCanvas(canvas, current, outputMode);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!display || display.isPreviewOnly) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    paintingRef.current = true;
    historyRef.current = [...historyRef.current, new Uint8ClampedArray(display.fullOutputImageData.data)].slice(-8);
    redoRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
    paintAt(event);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    updateDisplayAfterPaint();
  };

  const restoreSnapshot = (snapshot: Uint8ClampedArray) => {
    const current = displayRef.current;
    if (!current) return;
    const nextData = new ImageData(new Uint8ClampedArray(snapshot), current.width, current.height);
    const nextDisplay = {
      ...current,
      fullOutputImageData: nextData,
      crop: copyCropFromRect(nextData, current.crop),
      version: current.version + 1,
    };
    displayRef.current = nextDisplay;
    setDisplay(nextDisplay);
  };

  const undo = () => {
    const current = displayRef.current;
    const previous = historyRef.current.pop();
    if (!current || !previous) return;
    redoRef.current.push(new Uint8ClampedArray(current.fullOutputImageData.data));
    restoreSnapshot(previous);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
  };

  const redo = () => {
    const next = redoRef.current.pop();
    const current = displayRef.current;
    if (!current || !next) return;
    historyRef.current.push(new Uint8ClampedArray(current.fullOutputImageData.data));
    restoreSnapshot(next);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
  };

  const resetTask = () => {
    setFile(null);
    setDisplay(null);
    setPhase('idle');
    setProgress(0);
    setErrorMessage('');
    resetHistory();
  };

  const activeDimension = display
    ? outputMode === 'crop' ? `${display.crop.width} × ${display.crop.height}` : `${display.width} × ${display.height}`
    : '';
  const warning = display && !display.isLikelyStamp;

  return (
    <div className="stamp-tool">
      <div className="task-heading">
        <div>
          <h2>{phase === 'done' ? '查看透明结果' : '添加公章图片'}</h2>
        </div>
        <span className="task-description">自动识别红章，保留原始颜色与细节。</span>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {!file && phase !== 'error' && (
          <motion.div key="stamp-empty" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2, ease }}>
            <StampDropZone isDragging={isDragging} onDragChange={setIsDragging} onDrop={handleDrop} onBrowse={() => inputRef.current?.click()} />
            <div className="empty-footnote"><Stamp size={14} strokeWidth={1.7} /> 本地处理 · 文件不会上传</div>
          </motion.div>
        )}

        {phase === 'error' && (
          <motion.div key="stamp-error" className="stamp-error-state" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2, ease }}>
            <div className="stamp-error-copy"><CircleAlert size={18} /><span>{errorMessage}</span></div>
            <button className="primary-button process-button" type="button" onClick={() => inputRef.current?.click()}>重新选择图片 <span className="button-arrow">↗</span></button>
          </motion.div>
        )}

        {file && phase === 'processing' && (
          <motion.div key="stamp-processing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.2, ease }}>
            <StampProgress progress={progress} label={progressLabel} />
            {display && (
              <div className="stamp-processing-note"><Check size={14} /> 预览已生成，正在完成高清 PNG</div>
            )}
          </motion.div>
        )}

        {file && display && phase === 'done' && (
          <motion.div key="stamp-result" className="stamp-result" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.25, ease }}>
            <div className="stamp-file-bar">
              <div className="stamp-file-copy"><span className="file-icon file-icon-image"><ImagePlus size={18} strokeWidth={1.7} /></span><span><strong title={file.name}>{file.name}</strong><small>{formatBytes(file.size)} · {display.width} × {display.height}</small></span></div>
              <button className="text-button" type="button" onClick={resetTask}><RotateCcw size={15} strokeWidth={1.8} /> 重新上传</button>
            </div>

            <div className="stamp-preview-grid">
              <figure className="stamp-preview-card">
                <div className="stamp-preview-stage stamp-original-stage"><img src={sourceUrl ?? ''} alt="公章原图" /></div>
                <figcaption><span>原图</span><small>Before</small></figcaption>
              </figure>
              <figure className="stamp-preview-card">
                <div className={`stamp-preview-stage stamp-result-stage stamp-bg-${previewBackground}`}>
                  <canvas
                    ref={(node) => {
                      canvasRef.current = node;
                      if (node) drawCanvas(node, display, outputMode);
                    }}
                    aria-label="透明背景公章结果"
                    onPointerDown={handlePointerDown}
                    onPointerMove={(event) => { if (paintingRef.current) paintAt(event); }}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                  />
                </div>
                <figcaption><span>透明结果</span><small>{display.isPreviewOnly ? 'Preview' : 'After'}</small></figcaption>
              </figure>
            </div>

            <div className="stamp-preview-options">
              <div className="stamp-option-group" role="tablist" aria-label="输出画布模式">
                <span className="section-label">输出</span>
                <button className={outputMode === 'crop' ? 'is-active' : ''} type="button" role="tab" aria-selected={outputMode === 'crop'} onClick={() => setOutputMode('crop')}>自动裁切</button>
                <button className={outputMode === 'canvas' ? 'is-active' : ''} type="button" role="tab" aria-selected={outputMode === 'canvas'} onClick={() => setOutputMode('canvas')}>原始画布</button>
              </div>
              <div className="stamp-option-group" role="tablist" aria-label="透明背景预览">
                <span className="section-label">背景</span>
                {(['transparent', 'white', 'black', 'gray'] as PreviewBackground[]).map((background) => (
                  <button key={background} className={`stamp-background-button bg-${background} ${previewBackground === background ? 'is-active' : ''}`} type="button" role="tab" aria-selected={previewBackground === background} aria-label={`${background} 背景`} onClick={() => setPreviewBackground(background)} />
                ))}
              </div>
            </div>

            <div className="stamp-editor-bar">
              <div className="stamp-editor-heading"><span className="section-label">细节调整</span><small>自动结果不理想时，可轻轻擦除或恢复局部。</small></div>
              <div className="stamp-editor-actions">
                <button className={editorMode === 'erase' ? 'is-active' : ''} type="button" onClick={() => setEditorMode('erase')}><Eraser size={15} strokeWidth={1.8} /> 擦除</button>
                <button className={editorMode === 'restore' ? 'is-active' : ''} type="button" onClick={() => setEditorMode('restore')}><Stamp size={15} strokeWidth={1.8} /> 恢复</button>
                <label className="stamp-brush-size">笔刷 <input type="range" min="12" max="120" step="4" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} aria-label="笔刷大小" /><output>{brushSize}</output></label>
                <button className="stamp-icon-action" type="button" disabled={!canUndo} onClick={undo} aria-label="撤销"><Undo2 size={16} strokeWidth={1.8} /></button>
                <button className="stamp-icon-action" type="button" disabled={!canRedo} onClick={redo} aria-label="重做"><Redo2 size={16} strokeWidth={1.8} /></button>
              </div>
            </div>

            {warning && <div className="helper-message stamp-warning"><CircleAlert size={14} /> 未能准确确认公章区域，结果仍已生成；可以重新处理或用擦除 / 恢复微调。</div>}

            <div className="stamp-result-footer">
              <div className="stamp-result-stats"><strong>{activeDimension}</strong><span>{outputMode === 'crop' ? '透明 PNG · 自动留白' : '透明 PNG · 原始分辨率'}</span></div>
              <button className="primary-button" type="button" disabled={!exportBlob} onClick={() => exportBlob && downloadBlob(exportBlob, `${getBaseName(file.name)}-transparent.png`)}><Download size={17} strokeWidth={1.9} /> 下载透明 PNG <span className="button-arrow">↗</span></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input ref={inputRef} className="visually-hidden" type="file" tabIndex={-1} aria-hidden="true" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={(event) => { if (event.target.files?.[0]) void processFile(event.target.files[0]); event.target.value = ''; }} />
    </div>
  );
}
