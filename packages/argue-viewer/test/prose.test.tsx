import { cleanup, render } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { InlineProse, Prose } from "../src/lib/prose.js";

afterEach(cleanup);

describe("InlineProse", () => {
  it("renders plain text unchanged", () => {
    const { container } = render(<InlineProse text="hello world" />);
    expect(container.textContent).toBe("hello world");
    expect(container.querySelectorAll("strong, em, code")).toHaveLength(0);
  });

  it("renders **bold** as <strong>", () => {
    const { container } = render(<InlineProse text="this is **bold** text" />);
    expect(container.textContent).toBe("this is bold text");
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("bold");
  });

  it("renders __bold__ as <strong>", () => {
    const { container } = render(<InlineProse text="__double underscore__ bold" />);
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("double underscore");
  });

  it("renders *italic* as <em>", () => {
    const { container } = render(<InlineProse text="an *italic* word" />);
    const em = container.querySelector("em");
    expect(em?.textContent).toBe("italic");
  });

  it("renders _italic_ as <em> but leaves snake_case words alone", () => {
    const { container } = render(<InlineProse text="use foo_bar_baz and _italic_ together" />);
    const ems = container.querySelectorAll("em");
    expect(ems).toHaveLength(1);
    expect(ems[0]?.textContent).toBe("italic");
    expect(container.textContent).toContain("foo_bar_baz");
  });

  it("renders `code` as <code>", () => {
    const { container } = render(<InlineProse text="call `foo()` here" />);
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("foo()");
  });

  it("renders bold and italic together", () => {
    const { container } = render(<InlineProse text="**bold** and *italic*" />);
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
  });

  it("keeps unmatched asterisks as literal text", () => {
    const { container } = render(<InlineProse text="2 * 3 = 6" />);
    expect(container.textContent).toBe("2 * 3 = 6");
    expect(container.querySelector("em")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("renders a single newline as a <br/>", () => {
    const { container } = render(<InlineProse text={"line one\nline two"} />);
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.textContent).toBe("line oneline two");
  });

  it("does not produce HTML from angle brackets", () => {
    const { container } = render(<InlineProse text="<script>alert(1)</script>" />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toBe("<script>alert(1)</script>");
  });

  it("handles nested emphasis conservatively", () => {
    // bold wrapping plain text works; nested italic inside bold also renders.
    const { container } = render(<InlineProse text="**bold with *italic* inside**" />);
    const strong = container.querySelector("strong");
    expect(strong).not.toBeNull();
    expect(strong?.querySelector("em")?.textContent).toBe("italic");
  });
});

describe("Prose", () => {
  it("renders a single paragraph as one <p>", () => {
    const { container } = render(<Prose text="hello world" />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe("hello world");
  });

  it("splits on blank lines", () => {
    const text = "first paragraph\n\nsecond paragraph\n\nthird paragraph";
    const { container } = render(<Prose text={text} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.textContent).toBe("first paragraph");
    expect(paragraphs[1]?.textContent).toBe("second paragraph");
    expect(paragraphs[2]?.textContent).toBe("third paragraph");
  });

  it("preserves single-newline soft breaks inside a paragraph", () => {
    const text = "first line\nsecond line\n\nnext paragraph";
    const { container } = render(<Prose text={text} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.querySelector("br")).not.toBeNull();
  });

  it("applies markdown emphasis inside each paragraph", () => {
    const text = "this is **bold**\n\nthis is *italic*";
    const { container } = render(<Prose text={text} />);
    expect(container.querySelector("p:nth-of-type(1) strong")?.textContent).toBe("bold");
    expect(container.querySelector("p:nth-of-type(2) em")?.textContent).toBe("italic");
  });

  it("returns nothing for an empty string", () => {
    const { container } = render(<Prose text="" />);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
