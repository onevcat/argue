import { useMemo, useRef, useState } from "preact/hooks";

type FileIngressProps = {
  loading: boolean;
  onLoadText: (text: string, source: string) => void;
};

export function FileIngress({ loading, onLoadText }: FileIngressProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pastedText, setPastedText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [clipboardError, setClipboardError] = useState<string | null>(null);

  const hint = useMemo(() => {
    if (loading) {
      return "Parsing and validating...";
    }

    return "Drop result.json, pick a file, or paste JSON.";
  }, [loading]);

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

  const onFileChange = async (event: Event) => {
    const element = event.currentTarget as HTMLInputElement;
    const file = element.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    onLoadText(text, `file:${file.name}`);
    element.value = "";
  };

  const onDrop = async (event: DragEvent) => {
    event.preventDefault();
    setDragOver(false);

    const file = event.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    onLoadText(text, `drop:${file.name}`);
  };

  return (
    <section
      className={`ingress ${dragOver ? "is-drag-over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div className="ingress-meta">
        <h1>Argue Viewer</h1>
        <p>{hint}</p>
      </div>

      <div className="ingress-actions">
        <input ref={inputRef} type="file" accept="application/json,.json" onChange={onFileChange} hidden />
        <button type="button" onClick={openPicker} disabled={loading}>
          Select result.json
        </button>
        <button type="button" onClick={loadFromClipboard} disabled={loading}>
          Read Clipboard
        </button>
        <button type="button" onClick={() => onLoadText(pastedText, "paste")} disabled={loading || !pastedText.trim()}>
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
          disabled={loading}
        />
      </label>
    </section>
  );
}
