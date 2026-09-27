import { useRef } from "react";
import { loadCatalogSample, SAMPLE_CATALOG } from "../vision/sampleCatalog.ts";

type PhotoUploaderProps = {
  disabled?: boolean;
  onSelect: (file: File) => void;
  onError?: (message: string) => void;
};

export function PhotoUploader({ disabled, onSelect, onError }: PhotoUploaderProps) {
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    onSelect(file);
  }

  function resetInput(event: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(event.target.files);
    event.target.value = "";
  }

  function chooseSample(id: string) {
    void loadCatalogSample(id)
      .then(onSelect)
      .catch((error: unknown) => {
        onError?.(
          error instanceof Error ? error.message : "Could not load the sample photo.",
        );
      });
  }

  return (
    <section className="uploader">
      <div
        className="dropzone"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (disabled) return;
          handleFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          disabled={disabled}
          onChange={resetInput}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          disabled={disabled}
          onChange={resetInput}
        />
        <span className="dropzone-kicker">Photograph or upload</span>
        <strong>Lay the deck in overlapping columns so every name stays visible.</strong>
        <p>
          This first version reads English card titles in the browser, matches
          them to known Magic names, and lets you tap anything that looks wrong.
        </p>
        <div className="upload-actions">
          <button
            type="button"
            className="dropzone-cta"
            disabled={disabled}
            onClick={() => libraryInputRef.current?.click()}
          >
            <span className="library-cta-desktop">Choose a photo</span>
            <span className="library-cta-mobile">Photo library</span>
          </button>
          <button
            type="button"
            className="dropzone-cta button-secondary upload-camera-cta"
            disabled={disabled}
            onClick={() => cameraInputRef.current?.click()}
          >
            Take a photo
          </button>
        </div>
      </div>

      <div className="sample-picker">
        <p className="dropzone-kicker">Try a sample</p>
        <div className="sample-grid">
          {SAMPLE_CATALOG.map((sample) => (
            <button
              key={sample.id}
              type="button"
              className="sample-card"
              disabled={disabled}
              onClick={() => chooseSample(sample.id)}
            >
              {sample.src ? (
                <img src={sample.src} alt="" />
              ) : (
                <span className="sample-card-placeholder" aria-hidden="true" />
              )}
              <strong>{sample.title}</strong>
              <span>{sample.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
