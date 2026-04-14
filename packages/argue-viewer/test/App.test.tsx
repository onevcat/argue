import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { createFixtureResult } from "./fixtures.js";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

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

async function dropJsonText(text: string, filename = "result.json") {
  const zone = getDropZone();
  const file = makeJsonFile(text, filename);
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  // flush file.text() microtasks
  await Promise.resolve();
  await Promise.resolve();
}

describe("App", () => {
  it("renders the landing hero on mount", () => {
    render(<App />);
    expect(screen.getByText("Argue")).toBeTruthy();
    expect(screen.getByText(/Follow the argument/)).toBeTruthy();
    expect(screen.getByText(/Drop result.json/)).toBeTruthy();
  });

  it("shows parse error for malformed JSON", async () => {
    render(<App />);
    await dropJsonText("{not json");
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Cannot parse JSON");
    });
  });

  it("shows schema error for unsupported resultVersion", async () => {
    render(<App />);
    const bad = JSON.stringify({ ...createFixtureResult(), resultVersion: 999 });
    await dropJsonText(bad);
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/Unsupported resultVersion/);
    });
  });

  it("shows schema error with path for structurally broken input", async () => {
    render(<App />);
    const bad = JSON.stringify({ ...createFixtureResult(), requestId: "" });
    await dropJsonText(bad);
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/Schema mismatch at requestId/);
    });
  });

  it("renders report after loading a valid result", async () => {
    render(<App />);
    const valid = JSON.stringify(createFixtureResult());
    await dropJsonText(valid);
    await waitFor(() => {
      // §00 headline is the task.title from the fixture.
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
      // status chip — fixture has status "consensus".
      expect(screen.getByText("consensus")).toBeTruthy();
      // representative reason
      expect(screen.getByText(/top-score/)).toBeTruthy();
    });
  });

  it("shows the Check Another Report button in loaded state and can reset", async () => {
    render(<App />);
    const valid = JSON.stringify(createFixtureResult());
    await dropJsonText(valid);
    await waitFor(() => {
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
    });

    const resetButton = screen.getByRole("button", { name: /Check Another Report/i });
    fireEvent.click(resetButton);

    await waitFor(() => {
      // Landing hero returns.
      expect(screen.getByText(/Follow the argument/)).toBeTruthy();
      // Report body is gone.
      expect(screen.queryByText("Strict schema validation in the viewer")).toBeNull();
    });
  });

  it("recovers from error to loaded when a new valid payload is loaded", async () => {
    render(<App />);
    await dropJsonText("not json");
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Cannot parse JSON");
    });

    const valid = JSON.stringify(createFixtureResult());
    await dropJsonText(valid);
    await waitFor(() => {
      // §00 headline is the task.title from the fixture.
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("reports empty dropped file as an error", async () => {
    render(<App />);
    await dropJsonText("   ", "empty.json");
    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("Input is empty");
    });
  });

  it("always renders the site footer", () => {
    render(<App />);
    expect(screen.getByText(/github.com\/onevcat\/argue/)).toBeTruthy();
    expect(screen.getByText(/@onevcat/)).toBeTruthy();
  });

  it("pushes /report to history after a successful file drop", async () => {
    render(<App />);
    const valid = JSON.stringify(createFixtureResult());
    await dropJsonText(valid);
    await waitFor(() => {
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
    });
    expect(window.location.pathname).toBe("/report");
  });

  it("returns to / on reset", async () => {
    render(<App />);
    await dropJsonText(JSON.stringify(createFixtureResult()));
    await waitFor(() => {
      expect(window.location.pathname).toBe("/report");
    });

    const resetButton = screen.getByRole("button", { name: /Check Another Report/i });
    fireEvent.click(resetButton);
    await waitFor(() => {
      expect(window.location.pathname).toBe("/");
      expect(screen.getByText(/Follow the argument/)).toBeTruthy();
    });
  });

  it("popstate from /report back to / restores the landing page", async () => {
    render(<App />);
    await dropJsonText(JSON.stringify(createFixtureResult()));
    await waitFor(() => {
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
    });
    expect(window.location.pathname).toBe("/report");

    // Simulate browser Back button: flip the URL and dispatch popstate.
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));

    await waitFor(() => {
      expect(screen.getByText(/Follow the argument/)).toBeTruthy();
      expect(screen.queryByText("Strict schema validation in the viewer")).toBeNull();
    });
  });

  it("popstate forward from / to /report restores the cached report", async () => {
    render(<App />);
    const fixture = createFixtureResult();
    await dropJsonText(JSON.stringify(fixture));
    await waitFor(() => {
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
    });

    // Back to landing
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => {
      expect(screen.getByText(/Follow the argument/)).toBeTruthy();
    });

    // Forward to /report — App should rehydrate from its in-memory cache.
    window.history.replaceState(null, "", "/report");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => {
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
    });
  });

  it("redirects to / when /report is opened directly without any loaded report", async () => {
    window.history.replaceState(null, "", "/report");
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/Follow the argument/)).toBeTruthy();
      expect(window.location.pathname).toBe("/");
    });
  });

  it("auto-loads the example when opened at /example", async () => {
    const fixture = createFixtureResult();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(fixture))
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/example");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("examples/spaces-vs-tabs.json");
    expect(window.location.pathname).toBe("/example");
  });

  it("pushes /example when the example button is clicked from landing", async () => {
    const fixture = createFixtureResult();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(fixture))
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const button = screen.getByRole("button", { name: /See example/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
    });
    expect(window.location.pathname).toBe("/example");
  });

  it("surfaces a fetch error when the example fails to load", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve("not found")
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const button = screen.getByRole("button", { name: /See example/i });
    fireEvent.click(button);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("HTTP 404");
    });
  });
});

function encodeFixtureForHash(): string {
  const gz = gzipSync(Buffer.from(JSON.stringify(createFixtureResult()), "utf8"));
  return gz.toString("base64url");
}

describe("App hash payload", () => {
  it("loads a report from the #v=1&d= fragment and clears the hash after render", async () => {
    window.history.replaceState(null, "", `/#v=1&d=${encodeFixtureForHash()}`);
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
    });
    expect(window.location.pathname).toBe("/report");
    expect(window.location.hash).toBe("");
  });

  it("surfaces a friendly error for malformed hash payloads", async () => {
    window.history.replaceState(null, "", "/#v=1&d=@@@not-base64@@@");
    render(<App />);

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toMatch(/report hash|decode|base64/i);
    });
    expect(window.location.hash).toBe("");
  });
});
