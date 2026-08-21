import {
  AlertTriangle,
  Camera,
  Check,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Plus,
  RotateCcw,
  ScanLine,
  Sparkles,
  X,
} from 'lucide-react';
import { extractDocument, scanDocument, type CornerPoints } from 'scanic';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { jsPDF } from 'jspdf';

export type PhotoScanToolState = {
  hasSource: boolean;
  pageCount: number;
  hasResult: boolean;
};

export type PhotoScanToolHandle = {
  uploadFiles: (files: FileList | File[]) => void;
};

type ScanFilter = 'color' | 'enhanced' | 'gray' | 'bw';
type ScanStage = 'idle' | 'detecting' | 'editing' | 'extracting' | 'result';
type CornerKey = keyof CornerPoints;

type SourceImage = {
  file: File;
  url: string;
  image: HTMLImageElement;
  width: number;
  height: number;
};

type ScanPage = {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
};

const FILTERS: Array<{ id: ScanFilter; label: string; description: string }> = [
  { id: 'color', label: '原色', description: '保留照片色彩' },
  { id: 'enhanced', label: '增强', description: '提亮纸张与文字' },
  { id: 'gray', label: '灰度', description: '适合正式文档' },
  { id: 'bw', label: '黑白', description: '高对比扫描效果' },
];

const CORNER_KEYS: CornerKey[] = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];

function isSupportedImage(file: File) {
  return file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name);
}

function clamp(value: number, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value));
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createInsetCorners(width: number, height: number): CornerPoints {
  const inset = Math.min(width, height) * 0.06;
  return {
    topLeft: { x: inset, y: inset },
    topRight: { x: width - inset, y: inset },
    bottomRight: { x: width - inset, y: height - inset },
    bottomLeft: { x: inset, y: height - inset },
  };
}

function pointsForSvg(corners: CornerPoints) {
  return CORNER_KEYS.map((key) => `${corners[key].x},${corners[key].y}`).join(' ');
}

function loadImage(file: File) {
  return new Promise<SourceImage>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ file, url, image, width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片无法读取'));
    };
    image.src = url;
  });
}

function applyFilter(source: HTMLCanvasElement, filter: ScanFilter) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return source;
  context.drawImage(source, 0, 0);
  if (filter === 'color') return canvas;

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  let luminanceTotal = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    luminanceTotal += 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
  }

  const averageLuminance = luminanceTotal / Math.max(1, pixels.length / 4);
  const threshold = clamp(averageLuminance * 0.86, 132, 212);

  for (let index = 0; index < pixels.length; index += 4) {
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;

    if (filter === 'gray') {
      pixels[index] = luminance;
      pixels[index + 1] = luminance;
      pixels[index + 2] = luminance;
    } else if (filter === 'bw') {
      const value = luminance > threshold ? 255 : 24;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
    } else {
      pixels[index] = clamp((red - 128) * 1.18 + 142);
      pixels[index + 1] = clamp((green - 128) * 1.18 + 142);
      pixels[index + 2] = clamp((blue - 128) * 1.18 + 142);
    }
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function canvasToPage(canvas: HTMLCanvasElement, name: string, filter: ScanFilter): ScanPage {
  return {
    id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    dataUrl: canvas.toDataURL('image/jpeg', filter === 'bw' ? 0.94 : 0.92),
    width: canvas.width,
    height: canvas.height,
  };
}

const PhotoScanTool = forwardRef<PhotoScanToolHandle, {
  isDragging?: boolean;
  onStateChange?: (state: PhotoScanToolState) => void;
}>(({ isDragging = false, onStateChange }, ref) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ key: CornerKey; pointerId: number } | null>(null);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [corners, setCorners] = useState<CornerPoints | null>(null);
  const [stage, setStage] = useState<ScanStage>('idle');
  const [filter, setFilter] = useState<ScanFilter>('enhanced');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [baseCanvas, setBaseCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pages, setPages] = useState<ScanPage[]>([]);
  const [notice, setNotice] = useState('支持 JPG、PNG、WebP；手机端可直接调用相机拍摄');

  const emitState = useCallback(() => {
    onStateChange?.({
      hasSource: Boolean(source),
      pageCount: pages.length,
      hasResult: Boolean(previewUrl) || pages.length > 0,
    });
  }, [onStateChange, pages.length, previewUrl, source]);

  useEffect(() => {
    emitState();
  }, [emitState]);

  useEffect(() => () => {
    if (sourceUrlRef.current) URL.revokeObjectURL(sourceUrlRef.current);
  }, []);

  const resetSource = useCallback(() => {
    if (sourceUrlRef.current) {
      URL.revokeObjectURL(sourceUrlRef.current);
      sourceUrlRef.current = null;
    }
    setSource(null);
    setCorners(null);
    setBaseCanvas(null);
    setPreviewUrl(null);
    setStage('idle');
  }, []);

  const detectCorners = useCallback(async (nextSource: SourceImage) => {
    setStage('detecting');
    setNotice('正在寻找纸张边缘…');
    try {
      const result = await scanDocument(nextSource.image, {
        mode: 'detect',
        output: 'canvas',
        detector: 'classical',
        maxProcessingDimension: 1400,
        minDetectionConfidence: 0.2,
      });
      if (result.success && result.corners) {
        setCorners(result.corners);
        setNotice('已找到纸张边缘，可拖动四个角进行微调');
      } else {
        setCorners(createInsetCorners(nextSource.width, nextSource.height));
        setNotice('暂时没有稳定识别到纸张边缘，已放置一个可手动调整的区域');
      }
    } catch {
      setCorners(createInsetCorners(nextSource.width, nextSource.height));
      setNotice('自动识别不可用，仍可手动拖动四角完成裁剪');
    } finally {
      setStage('editing');
    }
  }, []);

  const selectFile = useCallback(async (file: File) => {
    if (!isSupportedImage(file)) {
      setNotice('请选择 JPG、PNG、WebP 或其他常见图片格式');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setNotice('单张照片不能超过 50 MB');
      return;
    }
    resetSource();
    try {
      const nextSource = await loadImage(file);
      sourceUrlRef.current = nextSource.url;
      setSource(nextSource);
      setFilter('enhanced');
      setNotice(`已载入 ${file.name} · ${formatBytes(file.size)}`);
      await detectCorners(nextSource);
    } catch {
      setNotice('这张照片无法读取，请换一张 JPG、PNG 或 WebP 图片');
      setStage('idle');
    }
  }, [detectCorners, resetSource]);

  const uploadFiles = useCallback((files: FileList | File[]) => {
    const image = Array.from(files).find(isSupportedImage);
    if (!image) {
      setNotice('请上传手机拍摄的图片文件，而不是 PDF');
      return;
    }
    if (Array.from(files).filter(isSupportedImage).length > 1) {
      setNotice('照片扫描一次处理一张；完成后点击“继续添加下一页”');
    }
    void selectFile(image);
  }, [selectFile]);

  useImperativeHandle(ref, () => ({ uploadFiles }), [uploadFiles]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) uploadFiles(event.target.files);
    event.target.value = '';
  };

  const handlePointerDown = (key: CornerKey, event: React.PointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    dragRef.current = { key, pointerId: event.pointerId };
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !source || !corners) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp((event.clientX - rect.left) * source.width / rect.width, 0, source.width);
    const y = clamp((event.clientY - rect.top) * source.height / rect.height, 0, source.height);
    setCorners((current) => current ? { ...current, [dragRef.current?.key ?? 'topLeft']: { x, y } } : current);
  };

  const stopPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The pointer may have been released outside the SVG.
      }
      dragRef.current = null;
    }
  };

  const extractScan = async () => {
    if (!source || !corners) return;
    setStage('extracting');
    setNotice('正在透视裁剪并生成扫描件…');
    try {
      const result = await extractDocument(source.image, corners, { output: 'canvas' });
      if (!result.success || !(result.output instanceof HTMLCanvasElement)) {
        throw new Error('无法提取纸张');
      }
      setBaseCanvas(result.output);
      setPreviewUrl(applyFilter(result.output, filter).toDataURL('image/jpeg', 0.92));
      setStage('result');
      setNotice('扫描件已生成，可切换效果后加入 PDF');
    } catch {
      setStage('editing');
      setNotice('裁剪失败，请重新调整四角，让它们贴合纸张边缘');
    }
  };

  useEffect(() => {
    if (!baseCanvas || stage !== 'result') return;
    setPreviewUrl(applyFilter(baseCanvas, filter).toDataURL('image/jpeg', filter === 'bw' ? 0.94 : 0.92));
  }, [baseCanvas, filter, stage]);

  const addPage = () => {
    if (!baseCanvas || !source) return;
    const filteredCanvas = applyFilter(baseCanvas, filter);
    const nextPage = canvasToPage(filteredCanvas, `${source.file.name.replace(/\.[^.]+$/, '')}-扫描件`, filter);
    setPages((current) => [...current, nextPage]);
    setNotice(`已加入第 ${pages.length + 1} 页，继续添加下一张照片即可`);
    resetSource();
  };

  const removePage = (id: string) => {
    setPages((current) => current.filter((page) => page.id !== id));
  };

  const downloadPdf = () => {
    if (!pages.length) return;
    const first = pages[0];
    const pageWidth = 595.28;
    const firstHeight = pageWidth * first.height / first.width;
    const pdf = new jsPDF({ unit: 'pt', format: [pageWidth, firstHeight], compress: true });
    pages.forEach((page, index) => {
      const height = pageWidth * page.height / page.width;
      if (index > 0) pdf.addPage([pageWidth, height]);
      pdf.addImage(page.dataUrl, 'JPEG', 0, 0, pageWidth, height, undefined, 'FAST');
    });
    pdf.save('扫描件.pdf');
  };

  const activeFilter = FILTERS.find((item) => item.id === filter) ?? FILTERS[0];

  return (
    <div className="photo-scan-tool">
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,.jpg,.jpeg,.png,.webp"
        capture="environment"
        onChange={handleFileChange}
      />

      {!source && stage === 'idle' && (
        <button
          className={`photo-scan-drop ${isDragging ? 'is-dragging' : ''}`}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="photo-scan-drop-icon"><Camera size={28} strokeWidth={1.6} /></span>
          <strong>拍一张或上传文件照片</strong>
          <span>自动识别纸张边缘，校正倾斜并生成扫描件</span>
          <small>手机端点击后可直接打开相机 · 最大 50 MB</small>
          <span className="photo-scan-drop-action"><ImageIcon size={14} /> 选择图片</span>
        </button>
      )}

      {source && (stage === 'detecting' || stage === 'editing') && (
        <section className="photo-scan-editor" aria-label="调整扫描范围">
          <div className="photo-scan-editor-heading">
            <div>
              <span className="eyebrow">STEP 01 · 校正边缘</span>
              <h3>{stage === 'detecting' ? '正在识别纸张…' : '确认纸张范围'}</h3>
            </div>
            <button className="text-button" type="button" onClick={resetSource}>
              <RotateCcw size={15} /> 重新选择
            </button>
          </div>
          <div
            ref={previewRef}
            className="photo-scan-preview photo-scan-preview-editing"
            style={{ aspectRatio: `${source.width} / ${source.height}` }}
          >
            <img src={source.url} alt="待扫描的文档照片" />
            {corners && (
              <svg
                className="photo-scan-corners"
                viewBox={`0 0 ${source.width} ${source.height}`}
                preserveAspectRatio="none"
                aria-label="可拖动的四角裁剪区域"
                onPointerMove={handlePointerMove}
                onPointerUp={stopPointer}
                onPointerCancel={stopPointer}
              >
                <polygon points={pointsForSvg(corners)} />
                {CORNER_KEYS.map((key) => (
                  <circle
                    key={key}
                    className="photo-scan-corner-handle"
                    cx={corners[key].x}
                    cy={corners[key].y}
                    r={Math.max(18, Math.min(source.width, source.height) * 0.018)}
                    onPointerDown={(event) => handlePointerDown(key, event)}
                    role="slider"
                    aria-label={`调整${key === 'topLeft' ? '左上' : key === 'topRight' ? '右上' : key === 'bottomRight' ? '右下' : '左下'}角`}
                  />
                ))}
              </svg>
            )}
            {stage === 'detecting' && <div className="photo-scan-detecting"><LoaderCircle className="photo-scan-spinner" size={18} /> 自动寻找纸张边缘</div>}
          </div>
          <div className="photo-scan-editor-note"><ScanLine size={14} /> {notice}</div>
          <div className="photo-scan-editor-actions">
            <button className="secondary-button" type="button" onClick={() => setCorners(createInsetCorners(source.width, source.height))} disabled={stage === 'detecting'}>
              <RotateCcw size={15} /> 重置四角
            </button>
            <button className="primary-button" type="button" onClick={() => void extractScan()} disabled={stage === 'detecting'}>
              <Sparkles size={15} /> 生成扫描件 <span className="button-arrow">↗</span>
            </button>
          </div>
        </section>
      )}

      {source && (stage === 'extracting' || stage === 'result') && (
        <section className="photo-scan-result" aria-label="扫描件预览">
          <div className="photo-scan-editor-heading">
            <div>
              <span className="eyebrow">STEP 02 · 处理效果</span>
              <h3>{stage === 'extracting' ? '正在生成扫描件…' : '扫描效果预览'}</h3>
            </div>
            <button className="text-button" type="button" onClick={() => setStage('editing')} disabled={stage === 'extracting'}>
              <RotateCcw size={15} /> 返回调角
            </button>
          </div>
          <div className="photo-scan-preview photo-scan-preview-result" style={{ aspectRatio: source.width / source.height }}>
            {previewUrl && <img src={previewUrl} alt="扫描件效果预览" />}
            {stage === 'extracting' && <div className="photo-scan-detecting"><LoaderCircle className="photo-scan-spinner" size={18} /> 正在生成</div>}
          </div>
          <div className="photo-scan-filter-row" role="radiogroup" aria-label="扫描效果">
            {FILTERS.map((item) => (
              <button
                key={item.id}
                className={`photo-scan-filter ${filter === item.id ? 'is-active' : ''}`}
                type="button"
                role="radio"
                aria-checked={filter === item.id}
                onClick={() => setFilter(item.id)}
                disabled={stage === 'extracting'}
              >
                <span>{item.label}</span>
                <small>{item.description}</small>
              </button>
            ))}
          </div>
          <div className="photo-scan-editor-note"><Sparkles size={14} /> 当前效果：{activeFilter.label} · {notice}</div>
          <div className="photo-scan-editor-actions">
            <button className="secondary-button" type="button" onClick={() => setStage('editing')} disabled={stage === 'extracting'}>
              <RotateCcw size={15} /> 重新调角
            </button>
            <button className="primary-button" type="button" onClick={addPage} disabled={stage === 'extracting'}>
              <Plus size={15} /> 加入第 {pages.length + 1} 页 <span className="button-arrow">↗</span>
            </button>
          </div>
        </section>
      )}

      {pages.length > 0 && (
        <section className="photo-scan-pages" aria-label="已扫描页面">
          <div className="photo-scan-pages-heading">
            <div>
              <span className="eyebrow">STEP 03 · 输出文档</span>
              <h3>已扫描 {pages.length} 页</h3>
            </div>
            <button className="primary-button photo-scan-download" type="button" onClick={downloadPdf}>
              <Download size={16} /> 下载 PDF
            </button>
          </div>
          <div className="photo-scan-page-list">
            {pages.map((page, index) => (
              <div className="photo-scan-page" key={page.id}>
                <img src={page.dataUrl} alt={`第 ${index + 1} 页扫描件`} />
                <div className="photo-scan-page-meta"><span>第 {index + 1} 页</span><small>{page.width} × {page.height}</small></div>
                <button className="photo-scan-page-remove" type="button" onClick={() => removePage(page.id)} aria-label={`移除第 ${index + 1} 页`}><X size={14} /></button>
              </div>
            ))}
            <button className="photo-scan-add-page" type="button" onClick={() => fileInputRef.current?.click()}>
              <Plus size={22} />
              <span>继续添加下一页</span>
            </button>
          </div>
          <div className="photo-scan-local-note"><Check size={13} /> 图片处理与 PDF 生成均在当前设备完成</div>
        </section>
      )}

      {!source && stage === 'idle' && pages.length === 0 && (
        <div className="photo-scan-hints">
          <div><ScanLine size={15} /><span><strong>自动校正</strong>识别四角并拉正透视</span></div>
          <div><Sparkles size={15} /><span><strong>扫描增强</strong>原色、灰度、黑白一键切换</span></div>
          <div><Check size={15} /><span><strong>本地处理</strong>照片不会上传到服务器</span></div>
        </div>
      )}

      {notice && (source || pages.length > 0) && <p className="photo-scan-status" role="status">{notice}</p>}
      {pages.length > 0 && !source && (
        <button className="photo-scan-new-task" type="button" onClick={() => fileInputRef.current?.click()}>
          <Camera size={15} /> 拍摄或添加新的第一页
        </button>
      )}
      {!source && stage === 'idle' && pages.length === 0 && isDragging && (
        <div className="photo-scan-drag-hint"><AlertTriangle size={14} /> 松开鼠标，导入照片</div>
      )}
    </div>
  );
});

PhotoScanTool.displayName = 'PhotoScanTool';

export { PhotoScanTool };
