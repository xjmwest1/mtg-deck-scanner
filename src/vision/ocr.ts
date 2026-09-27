import { publicAbsoluteUrl } from "../lib/publicUrl.ts";
import type { OCRRegion, Point } from "../models/detection.ts";
import { explainFetchError } from "../lib/errors.ts";

type OcrClient = {
  predict: (
    input: HTMLCanvasElement,
    params?: Record<string, number | string>,
  ) => Promise<OcrPredictResult[]>;
};

type OcrPredictResult = {
  items?: OcrItem[];
};

type OcrItem = {
  text?: string;
  score?: number;
  poly?: unknown;
};

let ocrPromise: Promise<OcrClient> | null = null;
let predictQueue: Promise<unknown> = Promise.resolve();

export function preloadOcr(): Promise<OcrClient> {
  if (!ocrPromise) {
    ocrPromise = createOcr().catch((error: unknown) => {
      ocrPromise = null;
      throw explainFetchError("The on-device OCR model", error);
    });
  }
  return ocrPromise;
}

type OcrPredictParams = Record<string, number | string>;

const FULL_IMAGE_OCR_PARAMS: OcrPredictParams = {
  textDetLimitSideLen: 1920,
  textDetLimitType: "max",
  textDetThresh: 0.2,
  textDetBoxThresh: 0.4,
  textDetUnclipRatio: 1.8,
  textRecScoreThresh: 0.2,
};

const TITLE_BAND_OCR_PARAMS: OcrPredictParams = {
  textDetLimitSideLen: 1280,
  textDetLimitType: "max",
  textDetThresh: 0.08,
  textDetBoxThresh: 0.25,
  textDetUnclipRatio: 2.4,
  textRecScoreThresh: 0.08,
};

/** Lighter band pass for dense photos — less WASM memory per crop. */
const TITLE_BAND_LITE_OCR_PARAMS: OcrPredictParams = {
  textDetLimitSideLen: 960,
  textDetLimitType: "max",
  textDetThresh: 0.1,
  textDetBoxThresh: 0.3,
  textDetUnclipRatio: 2,
  textRecScoreThresh: 0.12,
};

export async function recognizeText(
  canvas: HTMLCanvasElement,
): Promise<OCRRegion[]> {
  return predictRegions(canvas, FULL_IMAGE_OCR_PARAMS);
}

export async function recognizeTitleBand(
  canvas: HTMLCanvasElement,
): Promise<OCRRegion[]> {
  return predictRegions(canvas, TITLE_BAND_OCR_PARAMS);
}

export async function recognizeTitleBandLite(
  canvas: HTMLCanvasElement,
): Promise<OCRRegion[]> {
  return predictRegions(canvas, TITLE_BAND_LITE_OCR_PARAMS);
}

async function predictRegions(
  canvas: HTMLCanvasElement,
  params: OcrPredictParams,
): Promise<OCRRegion[]> {
  const result = await enqueuePredict(canvas, params);

  return (result?.items ?? []).flatMap((item) => {
    const text = (item.text ?? "").replace(/\s+/g, " ").trim();
    const polygon = toPolygon(item.poly);
    if (!text || polygon.length < 4) return [];
    return [
      {
        text,
        confidence: clamp01(item.score ?? 0),
        polygon,
        boundingBox: boundingBoxFromPolygon(polygon),
      },
    ];
  });
}

function enqueuePredict(
  canvas: HTMLCanvasElement,
  params: OcrPredictParams,
): Promise<OcrPredictResult | undefined> {
  const run = predictQueue.then(() => predictOnce(canvas, params));
  predictQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function predictOnce(
  canvas: HTMLCanvasElement,
  params: OcrPredictParams,
): Promise<OcrPredictResult | undefined> {
  const ocr = await preloadOcr();
  try {
    const [result] = await ocr.predict(canvas, params);
    return result;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/worker|disposed|wasm|memory/i.test(detail)) {
      ocrPromise = null;
    }
    throw explainFetchError("Reading the photo", error);
  }
}

async function createOcr(): Promise<OcrClient> {
  const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
  const detUrl = publicAbsoluteUrl("models/PP-OCRv5_mobile_det_onnx_infer.tar");
  const recUrl = publicAbsoluteUrl("models/PP-OCRv5_mobile_rec_onnx_infer.tar");
  const hasLocalModels = await resourceExists(detUrl) && await resourceExists(recUrl);

  const ocr = await PaddleOCR.create({
    lang: "en",
    ocrVersion: "PP-OCRv5",
    worker: true,
    ...(hasLocalModels
      ? {
          textDetectionModelName: "PP-OCRv5_mobile_det",
          textDetectionModelAsset: { url: detUrl },
          textRecognitionModelName: "PP-OCRv5_mobile_rec",
          textRecognitionModelAsset: { url: recUrl },
        }
      : {}),
    ortOptions: {
      backend: "wasm",
      wasmPaths: publicAbsoluteUrl("ort/"),
      numThreads: 1,
      simd: true,
    },
  });
  return ocr as OcrClient;
}

async function resourceExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

function toPolygon(poly: unknown): Point[] {
  if (!Array.isArray(poly)) return [];
  return poly.map((point) => {
    if (Array.isArray(point) && point.length >= 2) {
      return { x: Number(point[0]) || 0, y: Number(point[1]) || 0 };
    }
    if (point && typeof point === "object") {
      const record = point as { x?: unknown; y?: unknown };
      return { x: Number(record.x) || 0, y: Number(record.y) || 0 };
    }
    return { x: 0, y: 0 };
  });
}

function boundingBoxFromPolygon(polygon: Point[]) {
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
