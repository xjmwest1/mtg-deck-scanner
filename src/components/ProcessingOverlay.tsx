import type { ScanProgress } from "../vision/scan.ts";

const SCAN_STEPS: ScanProgress[] = [
  "loading-cards",
  "loading-ocr",
  "preparing-image",
  "reading-text",
  "re-reading-titles",
  "matching-names",
  "counting-lands",
];

const STEP_INFO: Record<
  ScanProgress,
  { phase: string; quip: string; detail: string }
> = {
  "loading-cards": {
    phase: "Untap",
    quip: "Waking the library…",
    detail: "Loading Magic card names…",
  },
  "loading-ocr": {
    phase: "Upkeep",
    quip: "Consulting the Oracle…",
    detail: "Starting the on-device reader…",
  },
  "preparing-image": {
    phase: "Draw",
    quip: "Laying out the battlefield…",
    detail: "Preparing the photo…",
  },
  "reading-text": {
    phase: "Main",
    quip: "Peeking at title bars…",
    detail: "Reading visible card titles…",
  },
  "re-reading-titles": {
    phase: "Combat",
    quip: "Fatesealing missed titles…",
    detail: "Re-reading title bands…",
  },
  "matching-names": {
    phase: "Main 2",
    quip: "Cross-referencing the Multiverse…",
    detail: "Matching names against Scryfall…",
  },
  "counting-lands": {
    phase: "End",
    quip: "Tapping out basics…",
    detail: "Counting basic lands…",
  },
};

type ProcessingOverlayProps = {
  imageUrl: string;
  step: ScanProgress;
};

export function ProcessingOverlay({ imageUrl, step }: ProcessingOverlayProps) {
  const stepIndex = SCAN_STEPS.indexOf(step);
  const progress = ((stepIndex + 1) / SCAN_STEPS.length) * 100;
  const info = STEP_INFO[step];

  return (
    <div className="processing-overlay" role="status" aria-live="polite">
      <div className="processing-stage">
        <img src={imageUrl} alt="Scanning deck photo" />
        <div className="processing-dim" aria-hidden="true" />
        <div className="processing-beam" aria-hidden="true" />
      </div>

      <div className="processing-status">
        <ol className="turn-phases" aria-label="Scan progress">
          {SCAN_STEPS.map((scanStep, index) => {
            const phase = STEP_INFO[scanStep].phase;
            const state =
              index < stepIndex
                ? "complete"
                : index === stepIndex
                  ? "current"
                  : "upcoming";

            return (
              <li
                key={scanStep}
                className={`turn-phase is-${state}`}
                aria-current={state === "current" ? "step" : undefined}
              >
                <span className="turn-phase-dot" />
                <span className="turn-phase-label">{phase}</span>
              </li>
            );
          })}
        </ol>

        <div
          className="turn-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label={`Scan progress: ${info.phase}`}
        >
          <div className="turn-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        <p className="processing-quip">{info.quip}</p>
        <p className="processing-detail">{info.detail}</p>
      </div>
    </div>
  );
}
