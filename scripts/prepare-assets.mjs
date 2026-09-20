import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const CARD_NAMES_PATH = path.join(ROOT, "public", "card-names.json");
const MODELS_DIR = path.join(ROOT, "public", "models");
const DET_PATH = path.join(MODELS_DIR, "PP-OCRv5_mobile_det_onnx_infer.tar");
const REC_PATH = path.join(MODELS_DIR, "PP-OCRv5_mobile_rec_onnx_infer.tar");

const DET_URL =
  "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar";
const REC_URL =
  "https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_rec_onnx_infer.tar";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download ${url} (${response.status})`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

if (!(await exists(CARD_NAMES_PATH))) {
  const cardResponse = await fetch("https://api.scryfall.com/catalog/card-names", {
    headers: {
      Accept: "application/json",
      "User-Agent": "mtg-deck-scanner/0.1",
    },
  });
  if (!cardResponse.ok) {
    throw new Error(`Could not download Scryfall card names (${cardResponse.status})`);
  }
  const cardPayload = await cardResponse.json();
  if (!Array.isArray(cardPayload.data)) {
    throw new Error("Scryfall card-name catalog was malformed.");
  }
  await writeFile(CARD_NAMES_PATH, JSON.stringify({ data: cardPayload.data }));
  console.log(`Wrote ${String(cardPayload.data.length)} card names.`);
} else {
  console.log("Card names already present.");
}

await mkdir(MODELS_DIR, { recursive: true });
const downloads = [];
if (!(await exists(DET_PATH))) {
  downloads.push(download(DET_URL, DET_PATH).then(() => console.log("Wrote detection model.")));
}
if (!(await exists(REC_PATH))) {
  downloads.push(download(REC_URL, REC_PATH).then(() => console.log("Wrote recognition model.")));
}
if (downloads.length === 0) {
  console.log("OCR models already present.");
} else {
  await Promise.all(downloads);
}
