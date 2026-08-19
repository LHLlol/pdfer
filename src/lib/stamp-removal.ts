export type StampProgressHandler = (progress: number, label: string) => void;

export type StampCrop = {
  imageData: ImageData;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type StampPreview = {
  outputImageData: ImageData;
  crop: StampCrop;
  blob: Blob;
  width: number;
  height: number;
  confidence: number;
  alphaCoverage: number;
  redPixelRatio: number;
};

export type StampAnalysis = {
  sourceImageData: ImageData;
  outputImageData: ImageData;
  crop: StampCrop;
  fullBlob: Blob;
  cropBlob: Blob;
  width: number;
  height: number;
  confidence: number;
  alphaCoverage: number;
  redPixelRatio: number;
  isLikelyStamp: boolean;
};

type LabColor = { l: number; a: number; b: number };
type BackgroundColor = { r: number; g: number; b: number; lab: LabColor };

const PREVIEW_MAX_DIMENSION = 1500;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const normalized = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function median(values: number[]) {
  if (!values.length) return 255;
  values.sort((left, right) => left - right);
  return values[Math.floor(values.length / 2)];
}

function rgbToHsv(r: number, g: number, b: number) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta > 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }

  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

function pivotRgb(value: number) {
  const normalized = value / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function rgbToLab(r: number, g: number, b: number): LabColor {
  const red = pivotRgb(r);
  const green = pivotRgb(g);
  const blue = pivotRgb(b);
  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047;
  const y = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 1;
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883;
  const pivot = (value: number) => value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + (16 / 116);
  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);
  return {
    l: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function labDistance(left: LabColor, right: LabColor) {
  return Math.sqrt(
    ((left.l - right.l) * 0.8) ** 2
      + (left.a - right.a) ** 2
      + (left.b - right.b) ** 2,
  );
}

function estimateBackground(imageData: ImageData): BackgroundColor {
  const { width, height, data } = imageData;
  const band = Math.max(2, Math.floor(Math.min(width, height) * 0.045));
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 18000)));
  const neutralSamples: Array<[number, number, number]> = [];
  const allSamples: Array<[number, number, number]> = [];

  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const index = (y * width + x) * 4;
      const sample: [number, number, number] = [data[index], data[index + 1], data[index + 2]];
      allSamples.push(sample);
      const spread = Math.max(sample[0], sample[1], sample[2]) - Math.min(sample[0], sample[1], sample[2]);
      const brightness = (sample[0] + sample[1] + sample[2]) / 3;
      if (spread < 54 && brightness > 118) neutralSamples.push(sample);
    }
  }

  const samples = neutralSamples.length > 10 ? neutralSamples : allSamples;
  const background = {
    r: median(samples.map((sample) => sample[0])),
    g: median(samples.map((sample) => sample[1])),
    b: median(samples.map((sample) => sample[2])),
  };
  return { ...background, lab: rgbToLab(background.r, background.g, background.b) };
}

function hueDistanceToRed(hue: number) {
  return Math.min(hue, 1 - hue);
}

function buildStampMask(imageData: ImageData, onProgress?: (progress: number) => void) {
  const { width, height, data } = imageData;
  const background = estimateBackground(imageData);
  const alpha = new Uint8Array(width * height);
  const warm = new Uint8Array(width * height);
  let redPixelCount = 0;
  let strongPixelCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const index = pixelIndex * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const hsv = rgbToHsv(r, g, b);
      const lab = rgbToLab(r, g, b);
      const hueScore = smoothstep(0.16, 0, hueDistanceToRed(hsv.hue));
      const redDominance = clamp((r - ((g + b) / 2) + 4) / 110, 0, 1);
      const labRedScore = clamp((lab.a - background.lab.a + 1.5) / 25, 0, 1);
      const saturationScore = clamp((hsv.saturation - 0.025) / 0.42, 0, 1);
      const colorDistance = clamp((labDistance(lab, background.lab) - 3) / 38, 0, 1);
      const redAffinity = clamp(
        redDominance * 0.52 + hueScore * 0.18 + labRedScore * 0.2 + saturationScore * 0.1,
        0,
        1,
      );
      // Neutral whites have an undefined HSV hue that browsers commonly report as 0 (red).
      // Require a real chroma/red-dominance signal so white paper cannot become the crop bounds.
      const chromaticRed = hueScore > 0.18
        && (hsv.saturation > 0.045 || redDominance > 0.08 || labRedScore > 0.15);
      const isWarm = redAffinity > 0.048 && redDominance > 0.028 && (chromaticRed || redDominance > 0.2);
      warm[pixelIndex] = isWarm ? 1 : 0;
      if (!isWarm) continue;

      const mixedInkScore = redAffinity * 0.7 + colorDistance * 0.18 + saturationScore * 0.12;
      const edgeAlpha = smoothstep(0.045, 0.58, mixedInkScore);
      const inputAlpha = data[index + 3] / 255;
      const alphaValue = Math.round(edgeAlpha * inputAlpha * 255);
      alpha[pixelIndex] = alphaValue;
      redPixelCount += 1;
      if (alphaValue > 150) strongPixelCount += 1;
    }
    if (onProgress && y % Math.max(1, Math.floor(height / 10)) === 0) {
      onProgress((y / height) * 62);
    }
  }

  // A small, red-only max filter keeps pale one-pixel strokes and broken circular borders.
  // It never spreads alpha into neutral or black pixels, which prevents paper halos.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      if (!warm[pixelIndex] || alpha[pixelIndex] >= 220) continue;
      let neighborMax = alpha[pixelIndex];
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (!offsetX && !offsetY) continue;
          const nextX = x + offsetX;
          const nextY = y + offsetY;
          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
          const neighborIndex = nextY * width + nextX;
          if (warm[neighborIndex]) neighborMax = Math.max(neighborMax, alpha[neighborIndex]);
        }
      }
      alpha[pixelIndex] = Math.max(alpha[pixelIndex], Math.round(alpha[pixelIndex] * 0.72 + neighborMax * 0.28));
    }
  }

  const output = new ImageData(width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let alphaPixelCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const index = pixelIndex * 4;
      const alphaValue = alpha[pixelIndex];
      output.data[index + 3] = alphaValue;
      if (alphaValue < 2) continue;

      const a = alphaValue / 255;
      const originalR = data[index];
      const originalG = data[index + 1];
      const originalB = data[index + 2];
      // Solve the simple compositing equation at translucent edges to remove white paper spill.
      // The center remains byte-for-byte from the source image.
      if (a < 0.93) {
        output.data[index] = clamp(Math.round((originalR - background.r * (1 - a)) / Math.max(a, 0.06)), 0, 255);
        output.data[index + 1] = clamp(Math.round((originalG - background.g * (1 - a)) / Math.max(a, 0.06)), 0, 255);
        output.data[index + 2] = clamp(Math.round((originalB - background.b * (1 - a)) / Math.max(a, 0.06)), 0, 255);
      } else {
        output.data[index] = originalR;
        output.data[index + 1] = originalG;
        output.data[index + 2] = originalB;
      }

      alphaPixelCount += 1;
      if (alphaValue > 8) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (onProgress) onProgress(72);
  const hasBounds = maxX >= minX && maxY >= minY;
  const bounds = hasBounds
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : { x: 0, y: 0, width, height };
  const redPixelRatio = redPixelCount / Math.max(1, width * height);
  const alphaCoverage = alphaPixelCount / Math.max(1, width * height);
  const boundsCoverage = (bounds.width * bounds.height) / Math.max(1, width * height);
  const confidence = clamp(
    smoothstep(0.0005, 0.012, redPixelRatio) * 0.62
      + smoothstep(0.0005, 0.08, boundsCoverage) * 0.2
      + clamp(strongPixelCount / Math.max(1, redPixelCount), 0, 1) * 0.18,
    0,
    1,
  );

  return { output, bounds, confidence, alphaCoverage, redPixelRatio };
}

export function cropStampImageData(imageData: ImageData, bounds: { x: number; y: number; width: number; height: number }, paddingRatio = 0.04): StampCrop {
  const padding = Math.max(2, Math.ceil(Math.max(bounds.width, bounds.height) * paddingRatio));
  const x = clamp(bounds.x - padding, 0, imageData.width - 1);
  const y = clamp(bounds.y - padding, 0, imageData.height - 1);
  const right = clamp(bounds.x + bounds.width + padding, x + 1, imageData.width);
  const bottom = clamp(bounds.y + bounds.height + padding, y + 1, imageData.height);
  const width = right - x;
  const height = bottom - y;
  const cropData = new ImageData(width, height);

  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((y + row) * imageData.width + x) * 4;
    const targetStart = row * width * 4;
    cropData.data.set(imageData.data.subarray(sourceStart, sourceStart + width * 4), targetStart);
  }

  return { imageData: cropData, x, y, width, height };
}

export async function imageDataToPngBlob(imageData: ImageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建图片画布');
  context.putImageData(imageData, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成 PNG')), 'image/png');
  });
}

function createScaledImageData(source: ImageData, scale: number) {
  if (scale >= 0.999) return source;
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = source.width;
  sourceCanvas.height = source.height;
  const sourceContext = sourceCanvas.getContext('2d');
  if (!sourceContext) throw new Error('无法创建预览画布');
  sourceContext.putImageData(source, 0, 0);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建预览画布');
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

async function loadSourceImageData(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法创建图片画布');
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function processStampFile(
  file: File,
  onProgress: StampProgressHandler,
  onPreview?: (preview: StampPreview) => void,
): Promise<StampAnalysis> {
  const source = await loadSourceImageData(file);
  onProgress(12, '正在读取图片');
  await yieldToBrowser();

  const scale = Math.min(1, PREVIEW_MAX_DIMENSION / Math.max(source.width, source.height));
  const previewSource = createScaledImageData(source, scale);
  const previewMask = buildStampMask(previewSource, (value) => onProgress(16 + value * 0.54, '正在识别印章'));
  const previewCrop = cropStampImageData(previewMask.output, previewMask.bounds);
  const previewBlob = await imageDataToPngBlob(previewCrop.imageData);
  onPreview?.({
    outputImageData: previewMask.output,
    crop: previewCrop,
    blob: previewBlob,
    width: previewSource.width,
    height: previewSource.height,
    confidence: previewMask.confidence,
    alphaCoverage: previewMask.alphaCoverage,
    redPixelRatio: previewMask.redPixelRatio,
  });
  onProgress(70, '预览已就绪，正在保留原始分辨率');
  await yieldToBrowser();

  const fullMask = buildStampMask(source, (value) => onProgress(70 + value * 0.32, '正在优化边缘'));
  const crop = cropStampImageData(fullMask.output, fullMask.bounds);
  const [fullBlob, cropBlob] = await Promise.all([
    imageDataToPngBlob(fullMask.output),
    imageDataToPngBlob(crop.imageData),
  ]);
  onProgress(100, '处理完成');
  return {
    sourceImageData: source,
    outputImageData: fullMask.output,
    crop,
    fullBlob,
    cropBlob,
    width: source.width,
    height: source.height,
    confidence: fullMask.confidence,
    alphaCoverage: fullMask.alphaCoverage,
    redPixelRatio: fullMask.redPixelRatio,
    isLikelyStamp: fullMask.redPixelRatio > 0.00015 && fullMask.alphaCoverage > 0.00015,
  };
}
