import { useRef, useState } from "preact/hooks";

type LandingError = {
  source: string;
  message: string;
};

type LandingProps = {
  error: LandingError | null;
  onLoadText: (text: string, source: string) => void;
  onReadError: (source: string, error: string) => void;
};

export function Landing({ error, onLoadText, onReadError }: LandingProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);

  const openPicker = () => {
    inputRef.current?.click();
  };

  const readAsText = async (file: File, source: string) => {
    setReading(true);
    try {
      const text = await file.text();
      onLoadText(text, source);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown read error.";
      onReadError(source, `Failed to read ${file.name}: ${message}`);
    } finally {
      setReading(false);
    }
  };

  const onFileChange = async (event: Event) => {
    const element = event.currentTarget as HTMLInputElement;
    const file = element.files?.[0];
    if (!file) {
      return;
    }
    await readAsText(file, `file:${file.name}`);
    element.value = "";
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragOver(false);

    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    await readAsText(file, `drop:${file.name}`);
  };

  return (
    <section className="landing">
      <header className="landing-hero">
        <div className="landing-wordmark" aria-label="Argue">
          <span className="landing-flank" aria-hidden="true" />
          <h1 className="landing-title">Argue</h1>
          <span className="landing-flank" aria-hidden="true" />
        </div>
        <blockquote className="landing-slogan">
          <p>&ldquo;Follow the argument wherever it leads.&rdquo;</p>
          <cite>— Socrates, in Plato&rsquo;s Republic</cite>
        </blockquote>
      </header>

      <div
        className={`landing-drop ${dragOver ? "is-drag-over" : ""}`}
        role="button"
        tabIndex={0}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragLeave={() => {
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) {
            setDragOver(false);
          }
        }}
        onDrop={onDrop}
      >
        <input ref={inputRef} type="file" accept="application/json,.json" onChange={onFileChange} hidden />
        <p className="landing-drop-headline">Drop result.json</p>
        <p className="landing-drop-sub">{reading ? "Reading file…" : "or click to choose a file"}</p>
      </div>

      <div className="landing-input-grid">
        <div className="landing-field is-disabled">
          <label className="landing-field-label" htmlFor="landing-url-input">
            From URL <span className="landing-field-tag">Coming soon</span>
          </label>
          <input
            id="landing-url-input"
            type="url"
            placeholder="https://example.com/argue-result.json"
            disabled
            aria-disabled="true"
          />
          <button type="button" disabled>
            Load From URL
          </button>
        </div>
      </div>

      {error ? (
        <p className="landing-error" role="alert">
          <span className="landing-error-source mono">{error.source}</span>
          <span className="landing-error-message">{error.message}</span>
        </p>
      ) : null}
    </section>
  );
}
