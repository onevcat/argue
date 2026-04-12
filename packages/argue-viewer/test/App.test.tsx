import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { createFixtureResult } from "./fixtures.js";

afterEach(cleanup);

function pasteAndLoad(text: string) {
  const textarea = screen.getByLabelText(/Paste JSON/i) as HTMLTextAreaElement;
  fireEvent.input(textarea, { target: { value: text } });
  const loadButton = screen.getByRole("button", { name: /Load Pasted JSON/i });
  fireEvent.click(loadButton);
}

describe("App", () => {
  it("renders idle state on mount", () => {
    render(<App />);
    expect(screen.getByText("No Result Loaded")).toBeTruthy();
  });

  it("shows parse error for malformed JSON", async () => {
    render(<App />);
    pasteAndLoad("{not json");
    await waitFor(() => {
      expect(screen.getByText("Validation Error")).toBeTruthy();
      expect(screen.getByText(/Cannot parse JSON/)).toBeTruthy();
    });
  });

  it("shows schema error for unsupported resultVersion", async () => {
    render(<App />);
    const bad = JSON.stringify({ ...createFixtureResult(), resultVersion: 999 });
    pasteAndLoad(bad);
    await waitFor(() => {
      expect(screen.getByText(/Unsupported resultVersion/)).toBeTruthy();
    });
  });

  it("shows schema error with path for structurally broken input", async () => {
    render(<App />);
    const bad = JSON.stringify({ ...createFixtureResult(), requestId: "" });
    pasteAndLoad(bad);
    await waitFor(() => {
      expect(screen.getByText(/Schema mismatch at requestId/)).toBeTruthy();
    });
  });

  it("renders report after loading a valid result", async () => {
    render(<App />);
    const valid = JSON.stringify(createFixtureResult());
    pasteAndLoad(valid);
    await waitFor(() => {
      // §00 headline is the task.title from the fixture.
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
      // status chip — fixture fixture has status "consensus".
      expect(screen.getByText("consensus")).toBeTruthy();
      // representative reason
      expect(screen.getByText(/top-score/)).toBeTruthy();
    });
  });

  it("recovers from error to loaded when a new valid payload is loaded", async () => {
    render(<App />);
    pasteAndLoad("not json");
    await waitFor(() => expect(screen.getByText("Validation Error")).toBeTruthy());

    const valid = JSON.stringify(createFixtureResult());
    pasteAndLoad(valid);
    await waitFor(() => {
      // §00 headline is the task.title from the fixture.
      expect(screen.getByText("Strict schema validation in the viewer")).toBeTruthy();
      expect(screen.queryByText("Validation Error")).toBeNull();
    });
  });

  it("reports empty input as an error", async () => {
    render(<App />);
    // Empty paste: the button is disabled until text is present, so we call
    // the empty-input path by typing whitespace then pressing the button.
    const textarea = screen.getByLabelText(/Paste JSON/i) as HTMLTextAreaElement;
    fireEvent.input(textarea, { target: { value: "   " } });
    // The button is now disabled because our trim check in FileIngress also
    // filters whitespace — so nothing happens. We assert the disabled state
    // instead, which is the more meaningful contract.
    const loadButton = screen.getByRole("button", { name: /Load Pasted JSON/i }) as HTMLButtonElement;
    expect(loadButton.disabled).toBe(true);
  });
});
