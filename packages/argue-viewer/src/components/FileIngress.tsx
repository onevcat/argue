import { useRef, useState } from "preact/hooks";

type FileIngressProps = {
  onLoadText: (text: string, source: string) => void;
  onReadError: (source: string, error: string) => void;
};

export function FileIngress({ onLoadText, onReadError }: FileIngressProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [pastedText, setPastedText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);

  const hint = reading ? "Reading file..." : "Drop result.json, pick a file, or paste JSON.";

  const openPicker = () => {
    inputRef.current?.click();
  };

  const loadFromClipboard = async () => {
    setClipboardError(null);
    try {
      const text = await navigator.clipboard.readText();
      setPastedText(text);
      onLoadText(text, "clipboard");
    } catch {
      setClipboardError("Clipboard access denied. Paste manually into the textarea.");
    }
  };

  const readAsText = async (file: File, source: string) => {
    setReading(true);
    try {
      const text = await file.text();
      onLoadText(text, source);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown read error.";
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
    <section
      className={`ingress ${dragOver ? "is-drag-over" : ""}`}
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
      <div className="ingress-meta">
        <h1>Argue Viewer</h1>
        <p>{hint}</p>
      </div>

      <div className="ingress-actions">
        <input ref={inputRef} type="file" accept="application/json,.json" onChange={onFileChange} hidden />
        <button type="button" onClick={openPicker} disabled={reading}>
          Select result.json
        </button>
        <button type="button" onClick={loadFromClipboard} disabled={reading}>
          Read Clipboard
        </button>
        <button type="button" onClick={() => onLoadText(pastedText, "paste")} disabled={reading || !pastedText.trim()}>
          Load Pasted JSON
        </button>
      </div>
      {clipboardError ? <p className="error-line">{clipboardError}</p> : null}

      <label className="paste-box">
        Paste JSON
        <textarea
          value={pastedText}
          onInput={(event) => setPastedText((event.currentTarget as HTMLTextAreaElement).value)}
          rows={5}
          placeholder='{"resultVersion":1,...}'
          disabled={reading}
        />
      </label>
    </section>
  );
}
