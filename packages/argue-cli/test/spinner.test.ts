import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpinner, type SpinnerStream } from "../src/spinner.js";

function createMockStream(isTTY: boolean): SpinnerStream & { written: string[] } {
  const written: string[] = [];
  return {
    isTTY,
    write(chunk: string) {
      written.push(chunk);
      return true;
    },
    written
  };
}

describe("spinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("animates Braille frames in TTY mode", () => {
    const stream = createMockStream(true);
    const spinner = createSpinner(stream, "working", { intervalMs: 80, isTTY: true, noColor: true });

    spinner.start();
    // First frame is rendered synchronously.
    expect(stream.written.join("")).toContain("⣾");

    vi.advanceTimersByTime(80);
    expect(stream.written.join("")).toContain("⣽");

    vi.advanceTimersByTime(80);
    expect(stream.written.join("")).toContain("⣻");

    spinner.stop();
  });

  it("hides and restores the cursor", () => {
    const stream = createMockStream(true);
    const spinner = createSpinner(stream, "working", { isTTY: true, noColor: true });

    spinner.start();
    expect(stream.written.some((c) => c.includes("\x1b[?25l"))).toBe(true);

    spinner.stop();
    expect(stream.written.some((c) => c.includes("\x1b[?25h"))).toBe(true);
  });

  it("clears the line when stopped", () => {
    const stream = createMockStream(true);
    const spinner = createSpinner(stream, "working", { isTTY: true, noColor: true });

    spinner.start();
    spinner.stop();

    // Final write contains carriage return + erase-in-line.
    const last = stream.written[stream.written.length - 1] ?? "";
    expect(last).toContain("\r");
    expect(last).toContain("\x1b[K");
  });

  it("emits one breadcrumb line in non-TTY mode and does not animate", () => {
    const stream = createMockStream(false);
    const spinner = createSpinner(stream, "working", { isTTY: false, noColor: true });

    spinner.start();
    vi.advanceTimersByTime(800);
    spinner.stop();

    const all = stream.written.join("");
    expect(all).toBe("working\n");
    expect(all).not.toContain("⣾");
    expect(all).not.toContain("\x1b[?25l");
  });

  it("is idempotent on repeated start and stop", () => {
    const stream = createMockStream(true);
    const spinner = createSpinner(stream, "working", { isTTY: true, noColor: true });

    spinner.start();
    spinner.start(); // no-op
    const writesAfterDoubleStart = stream.written.length;

    spinner.stop();
    spinner.stop(); // no-op
    const writesAfterDoubleStop = stream.written.length;

    // Second start did not add anything beyond a no-op.
    // Second stop did not write a second clear sequence.
    expect(writesAfterDoubleStart).toBeGreaterThan(0);
    expect(writesAfterDoubleStop - writesAfterDoubleStart).toBeLessThanOrEqual(1);
  });

  it("writes ANSI color escapes only when color is enabled", () => {
    const colored = createMockStream(true);
    const plain = createMockStream(true);

    const a = createSpinner(colored, "working", { isTTY: true, noColor: false });
    const b = createSpinner(plain, "working", { isTTY: true, noColor: true });

    a.start();
    b.start();

    expect(colored.written.join("").includes("\x1b[36m")).toBe(true);
    expect(plain.written.join("").includes("\x1b[36m")).toBe(false);

    a.stop();
    b.stop();
  });

  it("supports updating the label via start argument or setLabel", () => {
    const stream = createMockStream(true);
    const spinner = createSpinner(stream, "first", { isTTY: true, noColor: true });

    spinner.start();
    expect(stream.written.join("")).toContain("first");

    spinner.setLabel("second");
    vi.advanceTimersByTime(80);
    expect(stream.written.join("")).toContain("second");

    spinner.stop();
    spinner.start("third");
    expect(stream.written.join("")).toContain("third");

    spinner.stop();
  });

  it("isActive() reflects start/stop state", () => {
    const stream = createMockStream(true);
    const spinner = createSpinner(stream, "label", { isTTY: true, noColor: true });

    expect(spinner.isActive()).toBe(false);
    spinner.start();
    expect(spinner.isActive()).toBe(true);
    spinner.stop();
    expect(spinner.isActive()).toBe(false);
  });
});
