import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { createFixtureResult } from "./fixtures.js";

afterEach(cleanup);

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
});
