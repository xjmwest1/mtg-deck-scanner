import type { ScanDebug } from "../vision/scanDebug.ts";

const REASON_COPY: Record<ScanDebug["traces"][number]["reason"], string> = {
  matched: "matched",
  "ocr-wrong-match": "OCR read it, wrong name",
  "ocr-unmatched": "OCR read it, no card match",
  filtered: "OCR found it, filter dropped it",
  suppressed: "removed as overlap",
  "not-detected": "OCR never saw a title",
};

type ScanDebugPanelProps = {
  debug: ScanDebug;
};

export function ScanDebugPanel({ debug }: ScanDebugPanelProps) {
  if (!debug) return null;
  const misses = debug.traces.filter((trace) => trace.reason !== "matched");
  if (debug.traces.length === 0 && debug.rawOcr.length === 0) return null;

  return (
    <details className="scan-debug" open={misses.length > 0}>
      <summary>
        Scan trace · {debug.rawOcr.length} OCR lines · {misses.length} misses
      </summary>
      {debug.traces.length > 0 ? (
        <ul>
          {debug.traces.map((trace) => (
            <li key={trace.expected} className={`trace is-${trace.reason}`}>
              <strong>{trace.expected}</strong>
              <span>{REASON_COPY[trace.reason]}</span>
              {trace.ocrText ? <em>OCR: {trace.ocrText}</em> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p>Raw OCR</p>
      <ul className="raw-ocr">
        {debug.rawOcr.map((item, index) => (
          <li key={`${item.text}-${index}`}>
            {item.text}{" "}
            <span>({Math.round(item.confidence * 100)}%)</span>
          </li>
        ))}
      </ul>
      {debug.landCounts && debug.landCounts.length > 0 ? (
        <>
          <p>Basic lands</p>
          <ul className="raw-ocr">
            {debug.landCounts.map((item, index) => (
              <li key={`${item.name}-${index}`}>
                {item.count} {item.name} — {item.source}
                {item.note ? ` (${item.note})` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {debug.titleLandmarks && debug.titleLandmarks.length > 0 ? (
        <>
          <p>Title landmarks</p>
          <ul className="raw-ocr">
            {debug.titleLandmarks.map((item, index) => (
              <li key={`${item.rect.x}-${item.rect.y}-${index}`}>
                band @ ({Math.round(item.rect.x)}, {Math.round(item.rect.y)}){" "}
                {Math.round(item.rect.width)}×{Math.round(item.rect.height)} · top{" "}
                {Math.round(item.cardTop)} → art {Math.round(item.artTop)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {debug.titleBandReocr && debug.titleBandReocr.length > 0 ? (
        <>
          <p>Title-band re-OCR</p>
          <ul className="raw-ocr">
            {debug.titleBandReocr.map((item, index) => (
              <li key={`${item.reason}-${index}`}>
                {item.reason} @ ({Math.round(item.rect.x)}, {Math.round(item.rect.y)}) →{" "}
                {item.texts.length > 0 ? item.texts.join(" · ") : "no text"}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {debug.filteredOut.length > 0 ? (
        <>
          <p>Filtered out</p>
          <ul className="raw-ocr">
            {debug.filteredOut.map((item, index) => (
              <li key={`${item.text}-${index}`}>
                {item.text} — {item.why}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </details>
  );
}
