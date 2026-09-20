export type PreparedImage = {
  width: number;
  height: number;
  displayUrl: string;
  ocrCanvas: HTMLCanvasElement;
};

const MAX_SIDE = 1920;

export async function prepareImage(file: File): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const displayCanvas = document.createElement("canvas");
  displayCanvas.width = width;
  displayCanvas.height = height;
  const displayCtx = displayCanvas.getContext("2d");
  if (!displayCtx) throw new Error("Could not create a drawing context.");
  displayCtx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const ocrCanvas = document.createElement("canvas");
  ocrCanvas.width = width;
  ocrCanvas.height = height;
  const ocrCtx = ocrCanvas.getContext("2d");
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
  const sorted = Uint8Array.from(luma);
  sorted.sort();
  const low = sorted[Math.floor(sorted.length * 0.02)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.98)] ?? 255;
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

export function enhanceCanvasContrast(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
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
