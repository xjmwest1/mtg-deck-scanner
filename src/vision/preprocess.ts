export type PreparedImage = {
  width: number;
  height: number;
  displayUrl: string;
  ocrCanvas: HTMLCanvasElement;
};

const MAX_SIDE = 1920;

export function sniffImageType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return undefined;
}

export async function fileWithSniffedType(file: Blob, filename: string): Promise<File> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const type = sniffImageType(header) ?? file.type;
  return new File([file], filename, { type: type || "image/jpeg" });
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  const typed = await fileWithSniffedType(file, file.name);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(typed, {
      imageOrientation: "from-image",
    });
  } catch {
    throw new Error("Could not decode the photo. Try a JPEG or PNG.");
  }

  const scale = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const displayCanvas = document.createElement("canvas");
  displayCanvas.width = width;
  displayCanvas.height = height;
  const displayCtx = displayCanvas.getContext("2d");
  if (!displayCtx) throw new Error("Could not create a drawing context.");
  displayCtx.imageSmoothingEnabled = true;
  displayCtx.imageSmoothingQuality = "high";
  displayCtx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const ocrCanvas = document.createElement("canvas");
  ocrCanvas.width = width;
  ocrCanvas.height = height;
  const ocrCtx = ocrCanvas.getContext("2d", { willReadFrequently: true });
  if (!ocrCtx) throw new Error("Could not create a drawing context.");
  ocrCtx.drawImage(displayCanvas, 0, 0);
  enhanceContrast(ocrCtx, width, height);

  const displayUrl = await canvasToUrl(displayCanvas);
  return { width, height, displayUrl, ocrCanvas };
}

function enhanceContrast(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const image = ctx.getImageData(0, 0, width, height);
  const { data } = image;
  const luma = new Uint8Array(width * height);
  for (let i = 0; i < luma.length; i += 1) {
    const o = i * 4;
    luma[i] = Math.round(
      0.2126 * (data[o] ?? 0) + 0.7152 * (data[o + 1] ?? 0) + 0.0722 * (data[o + 2] ?? 0),
    );
  }
  const [low, high] = contrastPercentiles(luma);
  const span = Math.max(1, high - low);
  if (span < 48) return;
  const scale = 255 / span;
  for (let i = 0; i < luma.length; i += 1) {
    const o = i * 4;
    for (let c = 0; c < 3; c += 1) {
      const value = data[o + c] ?? 0;
      data[o + c] = Math.max(0, Math.min(255, Math.round((value - low) * scale)));
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** 2nd / 98th percentile via histogram — O(n), no extra sort buffer. */
function contrastPercentiles(luma: Uint8Array): [number, number] {
  const hist = new Uint32Array(256);
  for (let i = 0; i < luma.length; i += 1) {
    hist[luma[i] ?? 0] += 1;
  }
  const total = luma.length;
  if (total === 0) return [0, 255];

  const lowTarget = Math.floor(total * 0.02);
  const highTarget = Math.min(total - 1, Math.floor(total * 0.98));
  let acc = 0;
  let low = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v] ?? 0;
    if (acc > lowTarget) {
      low = v;
      break;
    }
  }
  acc = 0;
  let high = 255;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v] ?? 0;
    if (acc > highTarget) {
      high = v;
      break;
    }
  }
  return [low, high];
}

export function enhanceCanvasContrast(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  enhanceContrast(ctx, canvas.width, canvas.height);
}

function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not encode the prepared image."));
          return;
        }
        resolve(URL.createObjectURL(blob));
      },
      "image/jpeg",
      0.92,
    );
  });
}
