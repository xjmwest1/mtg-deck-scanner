import type { OCRRegion, Rect } from "../models/detection.ts";

export type TitleLandmark = {
  rect: Rect;
  cardTop: number;
  artTop: number;
  artFrame: Rect;
  score: number;
};

export const MIN_LANDMARKS_FOR_MASKED_OCR = 3;
const WORK_MAX_SIDE = 720;
const MIN_GAP_RATIO = 0.08;
const MAX_GAP_RATIO = 0.36;
const EXPECTED_GAP_RATIO = 0.2;
const MAX_LANDMARKS = 48;

type Span = {
  x: number;
  y: number;
  width: number;
  energy: number;
};

type Rgba = Uint8ClampedArray | Uint8Array;

export function detectTitleLandmarks(canvas: HTMLCanvasElement): TitleLandmark[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || canvas.width < 24 || canvas.height < 24) return [];
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return detectTitleLandmarksFromRgba(image.data, image.width, image.height);
}

export function detectTitleLandmarksFromRgba(
  data: Rgba,
  width: number,
  height: number,
): TitleLandmark[] {
  if (width < 24 || height < 24) return [];
  const scale = Math.min(1, WORK_MAX_SIDE / Math.max(width, height));
  const workW = Math.max(1, Math.round(width * scale));
  const workH = Math.max(1, Math.round(height * scale));
  const luma = downsampleLuma(data, width, height, workW, workH);
  const gx = new Float32Array(workW * workH);
  const gy = new Float32Array(workW * workH);
  computeGradients(luma, gx, gy, workW, workH);

  const minWidth = Math.max(26, Math.round(workW * 0.045));
  const maxWidth = Math.max(minWidth + 8, Math.round(Math.min(workW * 0.5, workH * 0.85)));
  const gyThresh = Math.max(10, histogramPercentile(gy, 0.84));
  const spans = collectHorizontalSpans(gy, workW, workH, gyThresh, minWidth, maxWidth);
  const paired = pairCardTopAndArtTop(spans, luma, gx, gy, workW, workH, minWidth);
  const fromFrames = landmarksFromArtFrames(
    luma,
    gx,
    gy,
    workW,
    workH,
    Math.max(minWidth, Math.round(workW * 0.1)),
    maxWidth,
  );
  const merged = nmsLandmarks([...paired, ...fromFrames]);
  return scaleDetected(selectCardSizedLandmarks(merged), scale);
}

export function shouldMaskOcrToLandmarks(landmarks: TitleLandmark[]): boolean {
  return landmarks.length >= MIN_LANDMARKS_FOR_MASKED_OCR;
}

export function paddedTitleBands(
  landmarks: TitleLandmark[],
  canvas: { width: number; height: number },
): Rect[] {
  return landmarks.map((item) => padTitleRect(item.rect, canvas));
}

export function maskCanvasToTitleBands(
  source: HTMLCanvasElement,
  landmarks: TitleLandmark[],
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return source;
  ctx.fillStyle = "#747474";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const rect of paddedTitleBands(landmarks, source)) {
    if (rect.width < 8 || rect.height < 6) continue;
    ctx.drawImage(
      source,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    );
  }
  return canvas;
}

export function regionInTitleBand(
  box: Rect,
  landmarks: TitleLandmark[],
): boolean {
  if (landmarks.length === 0) return true;
  const midY = box.y + box.height / 2;
  return landmarks.some((item) => {
    const band = item.rect;
    const overlap = horizontalOverlapRatio(box, band);
    if (overlap < 0.22) return false;
    return midY >= band.y - band.height * 0.35 && midY <= band.y + band.height * 1.25;
  });
}

export function regionInArtFrame(box: Rect, landmarks: TitleLandmark[]): boolean {
  const midY = box.y + box.height / 2;
  return landmarks.some((item) => {
    const art = item.artFrame;
    if (horizontalOverlapRatio(box, art) < 0.35) return false;
    return midY >= art.y + 6 && midY <= art.y + art.height;
  });
}

export function keepOcrInTitleLandmarks(
  regions: OCRRegion[],
  landmarks: TitleLandmark[],
): OCRRegion[] {
  if (landmarks.length === 0) return regions;
  return regions.filter((region) => {
    if (regionInTitleBand(region.boundingBox, landmarks)) return true;
    return !regionInArtFrame(region.boundingBox, landmarks);
  });
}

function pairCardTopAndArtTop(
  spans: Span[],
  luma: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  width: number,
  height: number,
  minWidth: number,
): TitleLandmark[] {
  if (spans.length === 0) return [];
  const byY = [...spans].sort((a, b) => a.y - b.y || a.x - b.x);
  const found: TitleLandmark[] = [];

  for (let i = 0; i < byY.length; i += 1) {
    const upper = byY[i];
    if (!upper) continue;
    for (let j = i + 1; j < byY.length; j += 1) {
      const lower = byY[j];
      if (!lower) continue;
      const gap = lower.y - upper.y;
      if (gap < 6) continue;
      const spanWidth = Math.min(upper.width, lower.width);
      if (spanWidth < minWidth) continue;
      if (gap > spanWidth * MAX_GAP_RATIO) break;
      if (gap < spanWidth * MIN_GAP_RATIO) continue;
      if (horizontalOverlapRatio(spanRect(upper), spanRect(lower)) < 0.55) {
        continue;
      }
      const landmark = scoreTitlePair(
        luma,
        gx,
        gy,
        width,
        height,
        upper,
        lower,
      );
      if (landmark) found.push(landmark);
    }
  }
  return found;
}

function landmarksFromArtFrames(
  luma: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  width: number,
  height: number,
  minWidth: number,
  maxWidth: number,
): TitleLandmark[] {
  const colEnergy = columnEnergy(gx, width, height);
  const gxThresh = Math.max(8, histogramPercentile(new Float32Array(colEnergy), 0.78));
  const peaks = findPeaks(colEnergy, Math.max(6, Math.round(minWidth * 0.35)), gxThresh);
  const found: TitleLandmark[] = [];

  for (let i = 0; i < peaks.length; i += 1) {
    const left = peaks[i] ?? 0;
    for (let j = i + 1; j < peaks.length; j += 1) {
      const right = peaks[j] ?? 0;
      const frameWidth = right - left;
      if (frameWidth < minWidth) continue;
      if (frameWidth > maxWidth) break;
      if (hasStrongMidVertical(colEnergy, left, right, peaks)) continue;
      const rowE = rowEnergyInRange(gy, width, height, left, right);
      const yPeaks = findPeaks(
        rowE,
        Math.max(4, Math.round(frameWidth * MIN_GAP_RATIO * 0.6)),
        Math.max(8, percentile(rowE, 0.72)),
      );
      for (let a = 0; a < yPeaks.length; a += 1) {
        const artTop = yPeaks[a] ?? 0;
        const expectedGap = clamp(
          Math.round(frameWidth * EXPECTED_GAP_RATIO),
          Math.round(frameWidth * MIN_GAP_RATIO),
          Math.round(frameWidth * MAX_GAP_RATIO),
        );
        const cardTop = nearestPeakInRange(
          yPeaks,
          artTop - expectedGap,
          artTop - Math.round(frameWidth * MIN_GAP_RATIO),
        );
        const upperY = cardTop ?? artTop - expectedGap;
        if (upperY < 2) continue;
        const upper: Span = {
          x: left,
          y: upperY,
          width: frameWidth,
          energy: rowE[upperY] ?? 0,
        };
        const lower: Span = {
          x: left,
          y: artTop,
          width: frameWidth,
          energy: rowE[artTop] ?? 0,
        };
        const landmark = scoreTitlePair(
          luma,
          gx,
          gy,
          width,
          height,
          upper,
          lower,
          cardTop === undefined,
        );
        if (landmark) found.push(landmark);
      }
    }
  }
  return found;
}

function scoreTitlePair(
  luma: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  width: number,
  height: number,
  upper: Span,
  lower: Span,
  inferredTop = false,
): TitleLandmark | null {
  const left = Math.round(Math.max(upper.x, lower.x));
  const right = Math.round(Math.min(upper.x + upper.width, lower.x + lower.width));
  const bandWidth = right - left;
  const gap = lower.y - upper.y;
  if (bandWidth < 24 || gap < 6) return null;

  const artBottom = Math.min(height - 2, lower.y + Math.max(10, Math.round(bandWidth * 0.28)));
  const down = verticalEdgeScore(gx, width, height, left, right, lower.y + 2, artBottom);
  if (down < 6) return null;

  const title = meanLuma(luma, width, height, left, right, upper.y + 2, lower.y - 1);
  const border = meanLuma(
    luma,
    width,
    height,
    left,
    right,
    Math.max(0, upper.y - 1),
    upper.y + 2,
  );
  const artTex = textureScore(gx, gy, width, height, left, right, lower.y + 2, artBottom);
  const titleTex = textureScore(
    gx,
    gy,
    width,
    height,
    left,
    right,
    upper.y + 2,
    Math.max(upper.y + 3, lower.y - 1),
  );
  const aboveTex = textureScore(
    gx,
    gy,
    width,
    height,
    left,
    right,
    Math.max(0, upper.y - Math.round(bandWidth * 0.28)),
    Math.max(0, upper.y - 2),
  );

  const darkTop = border + 8 < title;
  const artBelow = artTex > titleTex * 0.85 + 4;
  // The band between card top and art top is a painted title bar: calmer than
  // the illustration. Pairs of edges inside the art fail this check.
  if (titleTex > 16 && titleTex >= artTex * 0.72) return null;
  if (!artBelow && down < 14) return null;
  if (gap < 8 && bandWidth < 70) return null;

  // Type lines sit under the art window, so the frame verticals continue upward
  // from the upper edge. Stacked titles have a dark card border instead.
  const up = verticalEdgeScore(
    gx,
    width,
    height,
    left,
    right,
    Math.max(1, upper.y - Math.round(bandWidth * 0.28)),
    Math.max(1, upper.y - 2),
  );
  const typeLineLike =
    !inferredTop &&
    !darkTop &&
    up > down * 0.85 &&
    aboveTex > titleTex * 1.25;
  if (typeLineLike) return null;

  const weakTop = inferredTop && !darkTop;
  const gapPrior = 1 - Math.min(1, Math.abs(gap / bandWidth - EXPECTED_GAP_RATIO) / 0.2);
  const score =
    (weakTop ? 0.72 : 1) *
    (0.28 * normalize(lower.energy, 12, 80) +
      0.18 * normalize(upper.energy, 8, 70) +
      0.18 * normalize(down, 6, 40) +
      0.12 * (darkTop ? 1 : 0.35) +
      0.1 * gapPrior +
      0.14 * normalize(bandWidth, 36, 110) +
      0.1 * normalize(artTex / (titleTex + 1), 1, 6));
  if (score < 0.32) return null;

  const rect: Rect = {
    x: left,
    y: upper.y,
    width: bandWidth,
    height: gap,
  };
  return {
    rect,
    cardTop: upper.y,
    artTop: lower.y,
    artFrame: {
      x: left,
      y: lower.y,
      width: bandWidth,
      height: Math.max(8, artBottom - lower.y),
    },
    score,
  };
}

function collectHorizontalSpans(
  gy: Float32Array,
  width: number,
  height: number,
  thresh: number,
  minWidth: number,
  maxWidth: number,
): Span[] {
  const spans: Span[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    let x = 1;
    while (x < width - 1) {
      const energy = spanEnergy(gy, width, y, x);
      if (energy < thresh) {
        x += 1;
        continue;
      }
      const start = x;
      let sum = 0;
      let count = 0;
      while (x < width - 1) {
        const next = spanEnergy(gy, width, y, x);
        if (next < thresh * 0.55) break;
        sum += next;
        count += 1;
        x += 1;
      }
      const spanWidth = x - start;
      if (spanWidth >= minWidth && spanWidth <= maxWidth && count > 0) {
        spans.push({
          x: start,
          y,
          width: spanWidth,
          energy: sum / count,
        });
      }
      x += 1;
    }
  }
  return collapseNearbySpans(spans, minWidth);
}

function collapseNearbySpans(spans: Span[], minWidth: number): Span[] {
  const sorted = [...spans].sort((a, b) => a.y - b.y || a.x - b.x);
  const kept: Span[] = [];
  for (const span of sorted) {
    const prev = kept[kept.length - 1];
    if (
      prev &&
      Math.abs(span.y - prev.y) <= 1 &&
      Math.abs(span.x - prev.x) <= 4 &&
      Math.abs(span.width - prev.width) <= Math.max(6, minWidth * 0.2)
    ) {
      if (span.energy > prev.energy) kept[kept.length - 1] = span;
      continue;
    }
    kept.push(span);
  }
  return kept;
}

function selectCardSizedLandmarks(landmarks: TitleLandmark[]): TitleLandmark[] {
  if (landmarks.length === 0) return [];
  const ranked = [...landmarks].sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score ?? 0;
  const strong = ranked.filter((item) => item.score >= best * 0.42);
  const widths = strong.slice(0, 10).map((item) => item.rect.width);
  const typical = median(widths) || minWidthGuess(strong);
  return strong
    .filter((item) => {
      if (item.rect.width < typical * 0.55) return false;
      if (item.rect.height < 8) return false;
      return item.rect.width / Math.max(1, item.rect.height) >= 3.2;
    })
    .slice(0, MAX_LANDMARKS);
}

function minWidthGuess(landmarks: TitleLandmark[]): number {
  return Math.max(48, ...landmarks.map((item) => item.rect.width * 0.5));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function scaleDetected(landmarks: TitleLandmark[], scale: number): TitleLandmark[] {
  if (scale === 1) return landmarks;
  return landmarks.map((item) => scaleLandmark(item, 1 / scale));
}

function nmsLandmarks(landmarks: TitleLandmark[]): TitleLandmark[] {
  const ranked = [...landmarks].sort((a, b) => b.score - a.score);
  const kept: TitleLandmark[] = [];
  for (const item of ranked) {
    const duplicate = kept.some((other) => {
      if (iou(item.rect, other.rect) > 0.45) return true;
      const sameColumn = horizontalOverlapRatio(item.rect, other.rect) > 0.6;
      return sameColumn && Math.abs(item.rect.y - other.rect.y) < 12;
    });
    if (!duplicate) kept.push(item);
  }
  return kept;
}

function downsampleLuma(
  data: Rgba,
  srcW: number,
  srcH: number,
  workW: number,
  workH: number,
): Float32Array {
  const luma = new Float32Array(workW * workH);
  for (let y = 0; y < workH; y += 1) {
    const srcY = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / workH));
    for (let x = 0; x < workW; x += 1) {
      const srcX = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / workW));
      const o = (srcY * srcW + srcX) * 4;
      luma[y * workW + x] =
        0.2126 * (data[o] ?? 0) +
        0.7152 * (data[o + 1] ?? 0) +
        0.0722 * (data[o + 2] ?? 0);
    }
  }
  return luma;
}

function computeGradients(
  luma: Float32Array,
  gx: Float32Array,
  gy: Float32Array,
  width: number,
  height: number,
): void {
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      gx[i] = Math.abs((luma[i + 1] ?? 0) - (luma[i - 1] ?? 0));
      gy[i] = Math.abs((luma[i + width] ?? 0) - (luma[i - width] ?? 0));
    }
  }
}

function spanEnergy(gy: Float32Array, width: number, y: number, x: number): number {
  const i = y * width + x;
  return Math.max(gy[i - width] ?? 0, gy[i] ?? 0, gy[i + width] ?? 0);
}

function columnEnergy(gx: Float32Array, width: number, height: number): number[] {
  const energy = new Array<number>(width).fill(0);
  const usable = Math.max(1, height - 2);
  for (let x = 1; x < width - 1; x += 1) {
    let sum = 0;
    for (let y = 1; y < height - 1; y += 1) {
      sum += gx[y * width + x] ?? 0;
    }
    energy[x] = sum / usable;
  }
  return energy;
}

function rowEnergyInRange(
  gy: Float32Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
): number[] {
  const energy = new Array<number>(height).fill(0);
  const span = Math.max(1, x1 - x0);
  for (let y = 1; y < height - 1; y += 1) {
    let sum = 0;
    for (let x = x0; x < x1; x += 1) {
      sum += gy[y * width + x] ?? 0;
    }
    energy[y] = sum / span;
  }
  return energy;
}

function verticalEdgeScore(
  gx: Float32Array,
  width: number,
  height: number,
  left: number,
  right: number,
  y0: number,
  y1: number,
): number {
  const top = Math.max(1, Math.round(y0));
  const bottom = Math.min(height - 2, Math.round(y1));
  if (bottom <= top) return 0;
  let leftSum = 0;
  let rightSum = 0;
  const rows = bottom - top;
  for (let y = top; y < bottom; y += 1) {
    leftSum += maxInX(gx, width, y, left - 2, left + 2);
    rightSum += maxInX(gx, width, y, right - 2, right + 2);
  }
  return Math.min(leftSum, rightSum) / rows;
}

function textureScore(
  gx: Float32Array,
  gy: Float32Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  const left = Math.max(1, Math.round(x0));
  const right = Math.min(width - 1, Math.round(x1));
  const top = Math.max(1, Math.round(y0));
  const bottom = Math.min(height - 1, Math.round(y1));
  if (right <= left || bottom <= top) return 0;
  let sum = 0;
  let n = 0;
  for (let y = top; y < bottom; y += 1) {
    const row = y * width;
    for (let x = left; x < right; x += 1) {
      sum += (gx[row + x] ?? 0) + (gy[row + x] ?? 0);
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

function meanLuma(
  luma: Float32Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
): number {
  const left = Math.max(0, Math.round(x0));
  const right = Math.min(width, Math.round(x1));
  const top = Math.max(0, Math.round(y0));
  const bottom = Math.min(height, Math.round(y1));
  if (right <= left || bottom <= top) return 0;
  let sum = 0;
  let n = 0;
  for (let y = top; y < bottom; y += 1) {
    const row = y * width;
    for (let x = left; x < right; x += 1) {
      sum += luma[row + x] ?? 0;
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

function maxInX(
  values: Float32Array,
  width: number,
  y: number,
  x0: number,
  x1: number,
): number {
  let max = 0;
  const left = Math.max(1, Math.round(x0));
  const right = Math.min(width - 1, Math.round(x1));
  const row = y * width;
  for (let x = left; x <= right; x += 1) {
    const value = values[row + x] ?? 0;
    if (value > max) max = value;
  }
  return max;
}

function findPeaks(values: number[], minSpacing: number, floor: number): number[] {
  const peaks: number[] = [];
  for (let i = 2; i < values.length - 2; i += 1) {
    const value = values[i] ?? 0;
    if (value < floor) continue;
    if (value < (values[i - 1] ?? 0) || value < (values[i + 1] ?? 0)) continue;
    const previous = peaks[peaks.length - 1];
    if (previous !== undefined && i - previous < minSpacing) {
      if (value > (values[previous] ?? 0)) peaks[peaks.length - 1] = i;
      continue;
    }
    peaks.push(i);
  }
  return peaks;
}

function nearestPeakInRange(peaks: number[], target: number, minY: number): number | undefined {
  let best: number | undefined;
  let bestDist = Infinity;
  for (const peak of peaks) {
    if (peak > target + 3 || peak < minY) continue;
    const dist = Math.abs(peak - target);
    if (dist < bestDist) {
      best = peak;
      bestDist = dist;
    }
  }
  return best;
}

function hasStrongMidVertical(
  colEnergy: number[],
  left: number,
  right: number,
  peaks: number[],
): boolean {
  const width = right - left;
  const mid0 = left + width * 0.32;
  const mid1 = left + width * 0.68;
  const side = Math.min(colEnergy[left] ?? 0, colEnergy[right] ?? 0);
  return peaks.some((peak) => peak > mid0 && peak < mid1 && (colEnergy[peak] ?? 0) > side * 0.72);
}

function padTitleRect(rect: Rect, canvas: { width: number; height: number }): Rect {
  const padX = Math.max(4, rect.width * 0.04);
  const padY = Math.max(2, rect.height * 0.1);
  const x = Math.max(0, rect.x - padX);
  const y = Math.max(0, rect.y - padY);
  return {
    x,
    y,
    width: Math.max(0, Math.min(canvas.width, rect.x + rect.width + padX) - x),
    height: Math.max(0, Math.min(canvas.height, rect.y + rect.height + padY) - y),
  };
}

function scaleLandmark(landmark: TitleLandmark, scale: number): TitleLandmark {
  const mapRect = (rect: Rect): Rect => ({
    x: rect.x * scale,
    y: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });
  return {
    ...landmark,
    rect: mapRect(landmark.rect),
    artFrame: mapRect(landmark.artFrame),
    cardTop: landmark.cardTop * scale,
    artTop: landmark.artTop * scale,
  };
}

function spanRect(span: Span): Rect {
  return { x: span.x, y: span.y, width: span.width, height: 1 };
}

function histogramPercentile(values: Float32Array, p: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i += 1) {
    const bin = Math.max(0, Math.min(255, Math.round(values[i] ?? 0)));
    hist[bin] = (hist[bin] ?? 0) + 1;
  }
  const target = Math.floor(values.length * p);
  let seen = 0;
  for (let bin = 0; bin < hist.length; bin += 1) {
    seen += hist[bin] ?? 0;
    if (seen >= target) return bin;
  }
  return 0;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[index] ?? 0;
}

function normalize(value: number, low: number, high: number): number {
  if (high <= low) return 0;
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function horizontalOverlapRatio(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const overlap = right - left;
  if (overlap <= 0) return 0;
  return overlap / Math.max(1, Math.min(a.width, b.width));
}

function iou(a: Rect, b: Rect): number {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.width, b.x + b.width) - x;
  const h = Math.min(a.y + a.height, b.y + b.height) - y;
  if (w <= 0 || h <= 0) return 0;
  const intersection = w * h;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union <= 0 ? 0 : intersection / union;
}
