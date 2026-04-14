import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Landing } from "../src/components/Landing.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const noopOpenExample = () => {};

function makeJsonFile(content: string, name = "result.json"): File {
  return new File([content], name, { type: "application/json" });
}

function getDropZone(): HTMLElement {
  const zone = document.querySelector(".landing-drop");
  if (!zone) {
    throw new Error("landing-drop element not found");
  }
  return zone as HTMLElement;
}

describe("Landing", () => {
  it("renders the wordmark and slogan", () => {
    render(<Landing error={null} onLoadText={vi.fn()} onReadError={vi.fn()} onOpenExample={noopOpenExample} />);
    expect(screen.getByText("Argue")).toBeTruthy();
    expect(screen.getByText(/Follow the argument/)).toBeTruthy();
    expect(screen.getByText(/Socrates/)).toBeTruthy();
  });

  it("marks the URL input as coming-soon and keeps it disabled", () => {
    render(<Landing error={null} onLoadText={vi.fn()} onReadError={vi.fn()} onOpenExample={noopOpenExample} />);
    expect(screen.getByText(/Coming soon/i)).toBeTruthy();

    const urlInput = document.querySelector('input[type="url"]') as HTMLInputElement;
    expect(urlInput).toBeTruthy();
    expect(urlInput.disabled).toBe(true);

    const urlButton = screen.getByRole("button", { name: /Load From URL/i }) as HTMLButtonElement;
    expect(urlButton.disabled).toBe(true);
  });

  it("does not render any paste input", () => {
    render(<Landing error={null} onLoadText={vi.fn()} onReadError={vi.fn()} onOpenExample={noopOpenExample} />);
    expect(document.querySelector("textarea")).toBeNull();
    expect(screen.queryByRole("button", { name: /Load Pasted JSON/i })).toBeNull();
  });

  it("adds is-drag-over on dragenter and removes it on dragleave", () => {
    render(<Landing error={null} onLoadText={vi.fn()} onReadError={vi.fn()} onOpenExample={noopOpenExample} />);
    const zone = getDropZone();

    fireEvent.dragEnter(zone);
    expect(zone.classList.contains("is-drag-over")).toBe(true);

    fireEvent.dragLeave(zone);
    expect(zone.classList.contains("is-drag-over")).toBe(false);
  });

  it("uses a drag counter so nested dragenter/dragleave do not flicker", () => {
    render(<Landing error={null} onLoadText={vi.fn()} onReadError={vi.fn()} onOpenExample={noopOpenExample} />);
    const zone = getDropZone();

    fireEvent.dragEnter(zone);
    fireEvent.dragEnter(zone);
    expect(zone.classList.contains("is-drag-over")).toBe(true);

    fireEvent.dragLeave(zone);
    expect(zone.classList.contains("is-drag-over")).toBe(true);

    fireEvent.dragLeave(zone);
    expect(zone.classList.contains("is-drag-over")).toBe(false);
  });

  it("calls onLoadText on file drop", async () => {
    const onLoadText = vi.fn();
    render(<Landing error={null} onLoadText={onLoadText} onReadError={vi.fn()} onOpenExample={noopOpenExample} />);
    const zone = getDropZone();
    const file = makeJsonFile('{"dropped":true}', "dropped.json");

    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await Promise.resolve();
    await Promise.resolve();

    expect(onLoadText).toHaveBeenCalledTimes(1);
    expect(onLoadText).toHaveBeenCalledWith('{"dropped":true}', "drop:dropped.json");
  });

  it("resets drag counter after a successful drop", async () => {
    render(<Landing error={null} onLoadText={vi.fn()} onReadError={vi.fn()} onOpenExample={noopOpenExample} />);
    const zone = getDropZone();

    fireEvent.dragEnter(zone);
    fireEvent.dragEnter(zone);
    expect(zone.classList.contains("is-drag-over")).toBe(true);

    const file = makeJsonFile("{}", "a.json");
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    await Promise.resolve();
    await Promise.resolve();

    expect(zone.classList.contains("is-drag-over")).toBe(false);

    fireEvent.dragEnter(zone);
    expect(zone.classList.contains("is-drag-over")).toBe(true);
  });

  it("calls onReadError when file.text() rejects", async () => {
    const onLoadText = vi.fn();
    const onReadError = vi.fn();
    render(<Landing error={null} onLoadText={onLoadText} onReadError={onReadError} onOpenExample={noopOpenExample} />);
    const zone = getDropZone();

    const badFile = makeJsonFile("{}", "bad.json");
    Object.defineProperty(badFile, "text", {
      value: () => Promise.reject(new Error("boom"))
    });

    fireEvent.drop(zone, { dataTransfer: { files: [badFile] } });
    await Promise.resolve();
    await Promise.resolve();

    expect(onLoadText).not.toHaveBeenCalled();
    expect(onReadError).toHaveBeenCalledTimes(1);
    const [source, message] = onReadError.mock.calls[0]!;
    expect(source).toBe("drop:bad.json");
    expect(message).toContain("boom");
  });

  it("ignores a drop without files", async () => {
    const onLoadText = vi.fn();
    const onReadError = vi.fn();
    render(<Landing error={null} onLoadText={onLoadText} onReadError={onReadError} onOpenExample={noopOpenExample} />);
    const zone = getDropZone();

    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    await Promise.resolve();

    expect(onLoadText).not.toHaveBeenCalled();
    expect(onReadError).not.toHaveBeenCalled();
  });

  it("invokes onOpenExample when the example button is clicked", () => {
    const onOpenExample = vi.fn();
    render(<Landing error={null} onLoadText={vi.fn()} onReadError={vi.fn()} onOpenExample={onOpenExample} />);
    const button = screen.getByRole("button", { name: /See example/i });
    fireEvent.click(button);
    expect(onOpenExample).toHaveBeenCalledTimes(1);
  });

  it("disables the example button and shows loading copy when loadingExample is true", () => {
    render(
      <Landing error={null} loadingExample onLoadText={vi.fn()} onReadError={vi.fn()} onOpenExample={noopOpenExample} />
    );
    const button = screen.getByRole("button", { name: /Loading example/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("renders an error block when error prop is provided", () => {
    render(
      <Landing
        error={{ source: "drop:broken.json", message: "Cannot parse JSON: boom" }}
        onLoadText={vi.fn()}
        onReadError={vi.fn()}
        onOpenExample={noopOpenExample}
      />
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("drop:broken.json");
    expect(alert.textContent).toContain("Cannot parse JSON: boom");
  });
});
