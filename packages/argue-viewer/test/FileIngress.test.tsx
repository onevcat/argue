import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileIngress } from "../src/components/FileIngress.js";

afterEach(cleanup);

function makeJsonFile(content: string, name = "result.json"): File {
  return new File([content], name, { type: "application/json" });
}

function getSection(): HTMLElement {
  const section = document.querySelector(".ingress");
  if (!section) {
    throw new Error("ingress section not found");
  }
  return section as HTMLElement;
}

describe("FileIngress", () => {
  it("calls onLoadText when paste button is clicked with non-empty input", () => {
    const onLoadText = vi.fn();
    render(<FileIngress onLoadText={onLoadText} onReadError={vi.fn()} />);

    const textarea = screen.getByLabelText(/Paste JSON/i) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: '{"foo":1}' } });

    const button = screen.getByRole("button", { name: /Load Pasted JSON/i });
    fireEvent.click(button);

    expect(onLoadText).toHaveBeenCalledTimes(1);
    expect(onLoadText).toHaveBeenCalledWith('{"foo":1}', "paste");
  });

  it("disables the paste button when input is empty or whitespace", () => {
    render(<FileIngress onLoadText={vi.fn()} onReadError={vi.fn()} />);

    const button = screen.getByRole("button", { name: /Load Pasted JSON/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const textarea = screen.getByLabelText(/Paste JSON/i) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "   " } });
    expect(button.disabled).toBe(true);

    fireEvent.input(textarea, { target: { value: "x" } });
    expect(button.disabled).toBe(false);
  });

  it("adds is-drag-over on dragenter and removes it on dragleave", () => {
    render(<FileIngress onLoadText={vi.fn()} onReadError={vi.fn()} />);
    const section = getSection();

    fireEvent.dragEnter(section);
    expect(section.classList.contains("is-drag-over")).toBe(true);

    fireEvent.dragLeave(section);
    expect(section.classList.contains("is-drag-over")).toBe(false);
  });

  it("uses a drag counter so nested dragenter/dragleave do not flicker", () => {
    render(<FileIngress onLoadText={vi.fn()} onReadError={vi.fn()} />);
    const section = getSection();

    // simulate entering the section, then a nested child, then leaving the child.
    fireEvent.dragEnter(section); // depth 1
    fireEvent.dragEnter(section); // depth 2 (nested child)
    expect(section.classList.contains("is-drag-over")).toBe(true);

    fireEvent.dragLeave(section); // depth 1 — still over outer
    expect(section.classList.contains("is-drag-over")).toBe(true);

    fireEvent.dragLeave(section); // depth 0 — fully left
    expect(section.classList.contains("is-drag-over")).toBe(false);
  });

  it("calls onLoadText on file drop", async () => {
    const onLoadText = vi.fn();
    render(<FileIngress onLoadText={onLoadText} onReadError={vi.fn()} />);
    const section = getSection();
    const file = makeJsonFile('{"dropped":true}', "dropped.json");

    fireEvent.drop(section, { dataTransfer: { files: [file] } });

    // the handler awaits file.text() which is a microtask — flush.
    await Promise.resolve();
    await Promise.resolve();

    expect(onLoadText).toHaveBeenCalledTimes(1);
    expect(onLoadText).toHaveBeenCalledWith('{"dropped":true}', "drop:dropped.json");
  });

  it("resets drag counter after a successful drop", async () => {
    render(<FileIngress onLoadText={vi.fn()} onReadError={vi.fn()} />);
    const section = getSection();

    fireEvent.dragEnter(section);
    fireEvent.dragEnter(section);
    expect(section.classList.contains("is-drag-over")).toBe(true);

    const file = makeJsonFile("{}", "a.json");
    fireEvent.drop(section, { dataTransfer: { files: [file] } });
    await Promise.resolve();
    await Promise.resolve();

    expect(section.classList.contains("is-drag-over")).toBe(false);

    // Re-entering after drop should still work (counter fully reset).
    fireEvent.dragEnter(section);
    expect(section.classList.contains("is-drag-over")).toBe(true);
  });

  it("calls onReadError when file.text() rejects", async () => {
    const onLoadText = vi.fn();
    const onReadError = vi.fn();
    render(<FileIngress onLoadText={onLoadText} onReadError={onReadError} />);
    const section = getSection();

    // Build a File whose .text() throws.
    const badFile = makeJsonFile("{}", "bad.json");
    Object.defineProperty(badFile, "text", {
      value: () => Promise.reject(new Error("boom"))
    });

    fireEvent.drop(section, { dataTransfer: { files: [badFile] } });
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
    render(<FileIngress onLoadText={onLoadText} onReadError={onReadError} />);
    const section = getSection();

    fireEvent.drop(section, { dataTransfer: { files: [] } });
    await Promise.resolve();

    expect(onLoadText).not.toHaveBeenCalled();
    expect(onReadError).not.toHaveBeenCalled();
  });
});
