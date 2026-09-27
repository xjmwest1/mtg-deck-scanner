import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CardDetection, Rect } from "../models/detection.ts";
import type {
  AddedRegion,
  DetectionAnnotation,
  TrainingVerdict,
} from "../models/training.ts";
import {
  buildTrainingReport,
  type ReportDetection,
} from "../training/trainingReport.ts";
import {
  applyPersistedLabels,
  buildPersistedLabels,
  clearTrainingLabels,
  hasMeaningfulLabels,
  loadTrainingLabels,
  saveTrainingLabels,
} from "../training/trainingStorage.ts";

type TrainingViewProps = {
  imageUrl: string;
  width: number;
  height: number;
  fileName: string;
  detections: CardDetection[];
};

type Selection =
  | { kind: "detection"; id: string }
  | { kind: "added"; id: string }
  | null;

const MIN_SCALE = 0.25;
const MAX_SCALE = 6;
const MIN_BOX = 8;

export function TrainingView({
  imageUrl,
  width,
  height,
  fileName,
  detections,
}: TrainingViewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [scale, setScale] = useState(1);
  const [annotations, setAnnotations] = useState<Record<string, DetectionAnnotation>>(
    {},
  );
  const [added, setAdded] = useState<AddedRegion[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [draft, setDraft] = useState<Rect | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [restoredCount, setRestoredCount] = useState(0);
  const [hasSavedLabels, setHasSavedLabels] = useState(false);
  const hydratedRef = useRef(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  const fitToWidth = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || width === 0) return;
    const available = stage.clientWidth - 24;
    setScale(Math.max(MIN_SCALE, Math.min(MAX_SCALE, available / width)));
  }, [width]);

  useEffect(() => {
    fitToWidth();
  }, [fitToWidth]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setReport(null);
        setSelected(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    hydratedRef.current = false;
    setSelected(null);
    setReport(null);

    const persisted = loadTrainingLabels(fileName);
    setHasSavedLabels(persisted !== null && hasMeaningfulLabels(persisted));

    if (!persisted) {
      setAnnotations({});
      setAdded([]);
      setRestoredCount(0);
      hydratedRef.current = true;
      return;
    }

    const applied = applyPersistedLabels(detections, width, height, persisted);
    setAnnotations(applied.annotations);
    setAdded(applied.added);
    setRestoredCount(applied.restoredCount);
    hydratedRef.current = true;
  }, [fileName, detections, width, height]);

  useEffect(() => {
    if (!hydratedRef.current) return;

    const persisted = buildPersistedLabels(
      fileName,
      width,
      height,
      detections,
      annotations,
      added,
    );

    if (!hasMeaningfulLabels(persisted)) {
      clearTrainingLabels(fileName);
      setHasSavedLabels(false);
      return;
    }

    saveTrainingLabels(persisted);
    setHasSavedLabels(true);
  }, [annotations, added, detections, fileName, height, width]);

  const toImage = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * width;
    const y = ((clientY - rect.top) / rect.height) * height;
    return {
      x: Math.max(0, Math.min(width, x)),
      y: Math.max(0, Math.min(height, y)),
    };
  }, [width, height]);

  function onSurfaceDown(event: React.PointerEvent<SVGRectElement>) {
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort; drawing still works without it.
    }
    const point = toImage(event.clientX, event.clientY);
    dragStart.current = point;
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function onSurfaceMove(event: React.PointerEvent<SVGRectElement>) {
    if (!dragStart.current) return;
    const point = toImage(event.clientX, event.clientY);
    const start = dragStart.current;
    setDraft({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function onSurfaceUp() {
    const box = draft;
    dragStart.current = null;
    setDraft(null);
    if (!box || box.width < MIN_BOX || box.height < MIN_BOX) {
      setSelected(null);
      return;
    }
    const id = crypto.randomUUID();
    setAdded((prev) => [...prev, { id, box, text: "" }]);
    setSelected({ kind: "added", id });
  }

  function setVerdict(id: string, verdict: TrainingVerdict, correctedText?: string) {
    setAnnotations((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        verdict,
        correctedText,
      },
    }));
  }

  function setDetectionNote(id: string, note: string) {
    const trimmed = note.trim();
    setAnnotations((prev) => {
      const current = prev[id] ?? { verdict: "unreviewed" };
      return {
        ...prev,
        [id]: {
          ...current,
          note: trimmed || undefined,
        },
      };
    });
  }

  function verdictOf(id: string): DetectionAnnotation {
    return annotations[id] ?? { verdict: "unreviewed" };
  }

  const counts = useMemo(() => {
    let correct = 0;
    let corrected = 0;
    let notCard = 0;
    for (const detection of detections) {
      const verdict = (annotations[detection.id] ?? { verdict: "unreviewed" }).verdict;
      if (verdict === "correct") correct += 1;
      else if (verdict === "corrected") corrected += 1;
      else if (verdict === "not-card") notCard += 1;
    }
    return { correct, corrected, notCard, added: added.length };
  }, [annotations, detections, added]);

  function onClearSaved() {
    clearTrainingLabels(fileName);
    setHasSavedLabels(false);
    setRestoredCount(0);
    setAnnotations({});
    setAdded([]);
    setSelected(null);
  }

  function onContinue() {
    const reportDetections: ReportDetection[] = detections.map((detection) => {
      const annotation = verdictOf(detection.id);
      return {
        detectedText: detection.detectedText,
        name: detection.name,
        box: detection.boundingBox,
        verdict: annotation.verdict,
        correctedText: annotation.correctedText,
        note: annotation.note,
      };
    });
    const text = buildTrainingReport({
      filename: fileName,
      width,
      height,
      detections: reportDetections,
      added: added.map((region) => ({
        box: region.box,
        text: region.text,
        note: region.note,
      })),
    });
    (window as Window & { __trainingReport?: string }).__trainingReport = text;
    // eslint-disable-next-line no-console
    console.log(text);
    setReport(text);
  }

  const selectedDetection =
    selected?.kind === "detection"
      ? detections.find((d) => d.id === selected.id)
      : undefined;
  const selectedRegion =
    selected?.kind === "added"
      ? added.find((r) => r.id === selected.id)
      : undefined;

  return (
    <section className="training">
      <div className="training-toolbar">
        <div className="training-zoom">
          <button type="button" onClick={() => setScale((s) => Math.max(MIN_SCALE, s - 0.25))}>
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale((s) => Math.min(MAX_SCALE, s + 0.25))}>
            +
          </button>
          <button type="button" onClick={fitToWidth}>
            Fit
          </button>
        </div>
        <p className="training-hint">
          Drag on the image to mark a missed title. Click a box to fix or reject it.
          Labels are saved per image and restored on the next scan.
        </p>
        {restoredCount > 0 ? (
          <p className="training-restore-notice">
            Restored {restoredCount} saved label{restoredCount === 1 ? "" : "s"} for{" "}
            <strong>{fileName}</strong>.
          </p>
        ) : null}
        <div className="training-counts">
          <span className="tag is-correct">{counts.correct} ok</span>
          <span className="tag is-corrected">{counts.corrected} fixed</span>
          <span className="tag is-not-card">{counts.notCard} rejected</span>
          <span className="tag is-added">{counts.added} added</span>
        </div>
        {hasSavedLabels ? (
          <button type="button" className="training-clear-saved" onClick={onClearSaved}>
            Clear saved
          </button>
        ) : null}
        <button type="button" className="training-continue" onClick={onContinue}>
          Continue
        </button>
      </div>

      <div
        className="training-stage"
        ref={stageRef}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setScale((s) =>
            Math.max(MIN_SCALE, Math.min(MAX_SCALE, s - Math.sign(event.deltaY) * 0.15)),
          );
        }}
      >
        <div
          className="training-canvas"
          style={{ width: width * scale, height: height * scale }}
        >
          <img src={imageUrl} alt="Deck scan" style={{ width: "100%", height: "100%" }} />
          <svg
            ref={svgRef}
            className="training-overlay"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <rect
              className="training-surface"
              x={0}
              y={0}
              width={width}
              height={height}
              onPointerDown={onSurfaceDown}
              onPointerMove={onSurfaceMove}
              onPointerUp={onSurfaceUp}
            />
            {detections.map((detection) => {
              const annotation = verdictOf(detection.id);
              const selectedNow =
                selected?.kind === "detection" && selected.id === detection.id;
              const box = detection.boundingBox;
              const label = detection.name ?? detection.detectedText ?? "?";
              return (
                <g
                  key={detection.id}
                  className={`training-box is-${annotation.verdict}${selectedNow ? " is-selected" : ""}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelected({ kind: "detection", id: detection.id });
                  }}
                >
                  <rect x={box.x} y={box.y} width={box.width} height={box.height} />
                  <TrainingLabel
                    x={box.x}
                    y={box.y}
                    text={annotation.correctedText || label}
                  />
                </g>
              );
            })}
            {added.map((region) => {
              const selectedNow =
                selected?.kind === "added" && selected.id === region.id;
              return (
                <g
                  key={region.id}
                  className={`training-box is-added${selectedNow ? " is-selected" : ""}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelected({ kind: "added", id: region.id });
                  }}
                >
                  <rect
                    x={region.box.x}
                    y={region.box.y}
                    width={region.box.width}
                    height={region.box.height}
                  />
                  <TrainingLabel
                    x={region.box.x}
                    y={region.box.y}
                    text={region.text || "new region"}
                  />
                </g>
              );
            })}
            {draft ? (
              <rect
                className="training-draft"
                x={draft.x}
                y={draft.y}
                width={draft.width}
                height={draft.height}
              />
            ) : null}
          </svg>
        </div>
      </div>

      {selectedDetection ? (
        <DetectionEditor
          key={selectedDetection.id}
          detection={selectedDetection}
          annotation={verdictOf(selectedDetection.id)}
          onCorrect={() => setVerdict(selectedDetection.id, "correct")}
          onReject={() => setVerdict(selectedDetection.id, "not-card")}
          onRename={(text) => setVerdict(selectedDetection.id, "corrected", text)}
          onSaveNote={(note) => setDetectionNote(selectedDetection.id, note)}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {selectedRegion ? (
        <RegionEditor
          key={selectedRegion.id}
          region={selectedRegion}
          onSave={(text) =>
            setAdded((prev) =>
              prev.map((r) => (r.id === selectedRegion.id ? { ...r, text } : r)),
            )
          }
          onSaveNote={(note) =>
            setAdded((prev) =>
              prev.map((r) =>
                r.id === selectedRegion.id
                  ? { ...r, note: note.trim() || undefined }
                  : r,
              ),
            )
          }
          onDelete={() => {
            setAdded((prev) => prev.filter((r) => r.id !== selectedRegion.id));
            setSelected(null);
          }}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {report !== null ? (
        <ReportModal text={report} onClose={() => setReport(null)} />
      ) : null}
    </section>
  );
}

function TrainingLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const clipped = text.length > 26 ? `${text.slice(0, 25)}…` : text;
  return (
    <>
      <rect
        className="training-label-bg"
        x={x}
        y={Math.max(0, y - 20)}
        width={Math.max(60, clipped.length * 9 + 12)}
        height={18}
        rx={3}
      />
      <text className="training-label" x={x + 5} y={Math.max(13, y - 6)}>
        {clipped}
      </text>
    </>
  );
}

function NoteField({
  note,
  onSave,
}: {
  note?: string;
  onSave: (note: string) => void;
}) {
  const [expanded, setExpanded] = useState(Boolean(note?.trim()));
  const [value, setValue] = useState(note ?? "");

  useEffect(() => {
    setValue(note ?? "");
    if (note?.trim()) setExpanded(true);
  }, [note]);

  if (!expanded) {
    return (
      <div className="training-editor-actions">
        <button type="button" className="is-note" onClick={() => setExpanded(true)}>
          Add note
        </button>
      </div>
    );
  }

  return (
    <>
      <textarea
        className="training-note"
        value={value}
        placeholder="Optional note about this box"
        rows={2}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="training-editor-actions">
        <button
          type="button"
          onClick={() => {
            onSave(value);
          }}
        >
          Save note
        </button>
        {value.trim() ? (
          <button
            type="button"
            className="is-not-card"
            onClick={() => {
              setValue("");
              onSave("");
              setExpanded(false);
            }}
          >
            Remove note
          </button>
        ) : (
          <button type="button" className="is-note" onClick={() => setExpanded(false)}>
            Cancel
          </button>
        )}
      </div>
    </>
  );
}

function DetectionEditor({
  detection,
  annotation,
  onCorrect,
  onReject,
  onRename,
  onSaveNote,
  onClose,
}: {
  detection: CardDetection;
  annotation: DetectionAnnotation;
  onCorrect: () => void;
  onReject: () => void;
  onRename: (text: string) => void;
  onSaveNote: (note: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(
    annotation.correctedText ?? detection.name ?? detection.detectedText ?? "",
  );

  return (
    <div className="training-editor">
      <div className="training-editor-head">
        <span className="dialog-kicker">OCR read</span>
        <strong>{detection.detectedText || "(empty)"}</strong>
        <button type="button" className="training-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <form
        className="training-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) onRename(value.trim());
          onClose();
        }}
      >
        <input
          autoFocus
          value={value}
          placeholder="Correct card name"
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="training-editor-actions">
          <button type="submit">Save name</button>
          <button
            type="button"
            className="is-correct"
            onClick={() => {
              onCorrect();
              onClose();
            }}
          >
            Looks right
          </button>
          <button
            type="button"
            className="is-not-card"
            onClick={() => {
              onReject();
              onClose();
            }}
          >
            Not a card
          </button>
        </div>
        <NoteField note={annotation.note} onSave={onSaveNote} />
      </form>
    </div>
  );
}

function RegionEditor({
  region,
  onSave,
  onSaveNote,
  onDelete,
  onClose,
}: {
  region: AddedRegion;
  onSave: (text: string) => void;
  onSaveNote: (note: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(region.text);

  return (
    <div className="training-editor">
      <div className="training-editor-head">
        <span className="dialog-kicker">New region</span>
        <strong>Missed title</strong>
        <button type="button" className="training-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <form
        className="training-editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(value.trim());
          onClose();
        }}
      >
        <input
          autoFocus
          value={value}
          placeholder="Card name in this box"
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="training-editor-actions">
          <button type="submit">Save</button>
          <button type="button" className="is-not-card" onClick={onDelete}>
            Delete box
          </button>
        </div>
        <NoteField note={region.note} onSave={onSaveNote} />
      </form>
    </div>
  );
}

function ReportModal({ text, onClose }: { text: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog training-report"
        role="dialog"
        aria-label="Training prompt"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="dialog-kicker">Prompt for the assistant</p>
        <h2>Training feedback</h2>
        <textarea readOnly value={text} rows={16} />
        <div className="dialog-actions">
          <button type="button" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy prompt"}
          </button>
          <button type="button" className="button-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
