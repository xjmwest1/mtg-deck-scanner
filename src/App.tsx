import { useCallback, useEffect, useState } from "react";
import { loadCardIndex, type CardIndex } from "./cards/cardIndex.ts";
import { CardCorrectionDialog } from "./components/CardCorrectionDialog.tsx";
import { PhotoUploader } from "./components/PhotoUploader.tsx";
import { ProcessingOverlay } from "./components/ProcessingOverlay.tsx";
import { ScannerView } from "./components/ScannerView.tsx";
import { ScanDebugPanel } from "./components/ScanDebugPanel.tsx";
import { TrainingView } from "./components/TrainingView.tsx";
import { isTrainingMode } from "./lib/config.ts";
import { explainFetchError } from "./lib/errors.ts";
import type { CardDetection } from "./models/detection.ts";
import { isBasicLand } from "./models/deck.ts";
import { scanDeckPhoto, type ScanProgress } from "./vision/scan.ts";
import type { ScanDebug } from "./vision/scanDebug.ts";

type AppState =
  | { phase: "idle" }
  | { phase: "processing"; step: ScanProgress; imageUrl: string; fileName: string }
  | {
      phase: "review";
      imageUrl: string;
      width: number;
      height: number;
      fileName: string;
      detections: CardDetection[];
      debug: ScanDebug;
    }
  | { phase: "error"; message: string };

export default function App() {
  const [state, setState] = useState<AppState>({ phase: "idle" });
  const [cardIndex, setCardIndex] = useState<CardIndex | null>(null);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const trainingMode = isTrainingMode();

  useEffect(() => {
    void loadCardIndex()
      .then(setCardIndex)
      .catch(() => {
        // The scan path will surface a clearer error if this stays unavailable.
      });
  }, []);

  const selected =
    state.phase === "review"
      ? state.detections.find((detection) => detection.id === selectedId)
      : undefined;

  const reset = useCallback(() => {
    if (state.phase === "review" || state.phase === "processing") {
      URL.revokeObjectURL(state.imageUrl);
    }
    setSelectedId(undefined);
    setState({ phase: "idle" });
  }, [state]);

  async function onSelectFile(file: File) {
    if (state.phase === "review" || state.phase === "processing") {
      URL.revokeObjectURL(state.imageUrl);
    }
    setSelectedId(undefined);
    const previewUrl = URL.createObjectURL(file);
    setState({
      phase: "processing",
      step: "loading-cards",
      imageUrl: previewUrl,
      fileName: file.name,
    });
    try {
      const result = await scanDeckPhoto(file, (step) => {
        setState((current) =>
          current.phase === "processing"
            ? { ...current, step }
            : current,
        );
      });
      (
        window as Window & { __scanDebug?: ScanDebug; __scanDetections?: CardDetection[] }
      ).__scanDebug = result.debug;
      (
        window as Window & { __scanDebug?: ScanDebug; __scanDetections?: CardDetection[] }
      ).__scanDetections = result.detections;
      URL.revokeObjectURL(previewUrl);
      setState({
        phase: "review",
        imageUrl: result.image.displayUrl,
        width: result.image.width,
        height: result.image.height,
        fileName: file.name,
        detections: result.detections,
        debug: result.debug,
      });
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      setState({
        phase: "error",
        message: explainFetchError("Scanning", error).message,
      });
    }
  }

  function updateDetections(
    updater: (detections: CardDetection[]) => CardDetection[],
  ) {
    setState((current) =>
      current.phase === "review"
        ? { ...current, detections: updater(current.detections) }
        : current,
    );
  }

  function chooseName(id: string, name: string) {
    updateDetections((detections) =>
      detections.map((detection) =>
        detection.id === id
          ? {
              ...detection,
              name,
              status: "corrected",
              confidence: 1,
              count: isBasicLand(name) ? detection.count ?? 1 : 1,
              countSource: isBasicLand(name)
                ? detection.countSource ?? "manual"
                : undefined,
            }
          : detection,
      ),
    );
    setSelectedId(undefined);
  }

  function changeCount(id: string, count: number) {
    updateDetections((detections) =>
      detections.map((detection) =>
        detection.id === id
          ? { ...detection, count, countSource: "manual", status: "corrected" }
          : detection,
      ),
    );
  }

  function deleteDetection(id: string) {
    updateDetections((detections) =>
      detections.filter((detection) => detection.id !== id),
    );
    setSelectedId(undefined);
  }

  function addCard(name: string) {
    updateDetections((detections) => [
      ...detections,
      {
        id: crypto.randomUUID(),
        name,
        detectedText: name,
        confidence: 1,
        polygon: [],
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        matches: [{ name, score: 1 }],
        status: "corrected",
        source: "manual",
        count: 1,
        countSource: "manual",
      },
    ]);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">{trainingMode ? "Training mode" : "Client-side MVP"}</p>
          <h1>MTG Deck Scanner</h1>
        </div>
        {state.phase !== "idle" ? (
          <button type="button" className="button-secondary" onClick={reset}>
            New photo
          </button>
        ) : null}
      </header>

      {state.phase === "idle" || state.phase === "error" ? (
        <>
          <PhotoUploader
            onSelect={(file) => void onSelectFile(file)}
            onError={(message) => setState({ phase: "error", message })}
          />
          {state.phase === "error" ? (
            <p className="banner error">{state.message}</p>
          ) : (
            <p className="banner">
              No image leaves this device. The first scan downloads the OCR
              model and a local list of English card names.
            </p>
          )}
        </>
      ) : null}

      {state.phase === "processing" ? (
        <ProcessingOverlay imageUrl={state.imageUrl} step={state.step} />
      ) : null}

      {state.phase === "review" && trainingMode ? (
        <TrainingView
          imageUrl={state.imageUrl}
          width={state.width}
          height={state.height}
          fileName={state.fileName}
          detections={state.detections}
        />
      ) : null}

      {state.phase === "review" && !trainingMode ? (
        <>
          <ScannerView
            imageUrl={state.imageUrl}
            width={state.width}
            height={state.height}
            detections={state.detections}
            cardIndex={cardIndex}
            selectedId={selectedId}
            onSelect={(detection) => setSelectedId(detection.id)}
            onAddCard={addCard}
          />
          <ScanDebugPanel debug={state.debug} />
        </>
      ) : null}

      {selected ? (
        <CardCorrectionDialog
          detection={selected}
          cardIndex={cardIndex}
          onClose={() => setSelectedId(undefined)}
          onChoose={(name) => chooseName(selected.id, name)}
          onChangeCount={(count) => changeCount(selected.id, count)}
          onDelete={() => deleteDetection(selected.id)}
        />
      ) : null}
    </div>
  );
}
