import { Fragment, type ComponentChildren } from "preact";

/**
 * Minimal markdown renderer for agent-authored prose fields in the
 * viewer. Supports the narrow subset of Markdown that LLM outputs
 * actually use: **bold** / __bold__, *italic* / _italic_, `inline code`,
 * paragraph splits on blank lines, and single-newline soft breaks.
 *
 * Intentionally not supported: headings, lists, links, images, tables,
 * blockquotes, HTML passthrough. If an output needs those, we'd switch
 * to a real markdown library — for now the 80% case is emphasis.
 *
 * Safety: the renderer builds JSX nodes directly (never
 * dangerouslySetInnerHTML), so agent text remains inert. The only risk
 * is a crafted string that confuses the tokenizer into producing
 * mismatched pairs, which would still render as plain text, not HTML.
 */

type Segment = { kind: "text"; value: string } | { kind: "strong" | "em" | "code"; value: string };

const INLINE_RE =
  /(\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|(?<![*\w])\*([^*\n]+?)\*(?!\w)|(?<![_\w])_([^_\n]+?)_(?!\w)|`([^`\n]+?)`)/g;

function tokenize(input: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  INLINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_RE.exec(input)) !== null) {
    if (match.index > cursor) {
      segments.push({ kind: "text", value: input.slice(cursor, match.index) });
    }
    const [full, , bold1, bold2, italic1, italic2, code] = match;
    if (bold1 != null) {
      segments.push({ kind: "strong", value: bold1 });
    } else if (bold2 != null) {
      segments.push({ kind: "strong", value: bold2 });
    } else if (italic1 != null) {
      segments.push({ kind: "em", value: italic1 });
    } else if (italic2 != null) {
      segments.push({ kind: "em", value: italic2 });
    } else if (code != null) {
      segments.push({ kind: "code", value: code });
    }
    cursor = match.index + full.length;
  }
  if (cursor < input.length) {
    segments.push({ kind: "text", value: input.slice(cursor) });
  }
  return segments;
}

function renderTextWithBreaks(value: string): ComponentChildren {
  if (!value.includes("\n")) {
    return value;
  }
  const parts = value.split("\n");
  const nodes: ComponentChildren[] = [];
  parts.forEach((part, index) => {
    if (index > 0) {
      nodes.push(<br key={`br-${index}`} />);
    }
    if (part.length > 0) {
      nodes.push(part);
    }
  });
  return nodes;
}

function renderSegments(segments: Segment[]): ComponentChildren {
  return segments.map((segment, index) => {
    switch (segment.kind) {
      case "text":
        return <Fragment key={index}>{renderTextWithBreaks(segment.value)}</Fragment>;
      case "strong":
        return <strong key={index}>{renderInner(segment.value)}</strong>;
      case "em":
        return <em key={index}>{renderInner(segment.value)}</em>;
      case "code":
        return <code key={index}>{segment.value}</code>;
    }
  });
}

function renderInner(value: string): ComponentChildren {
  return renderSegments(tokenize(value));
}

/**
 * Render a short prose fragment as inline nodes. Safe to place inside
 * an existing <p>, <span>, <blockquote>, or table cell. Paragraph
 * splits in the source are collapsed to soft breaks because the caller
 * owns a single inline container.
 */
export function InlineProse({ text }: { text: string }) {
  return <>{renderInner(text)}</>;
}

/**
 * Render a prose block as one or more <p> elements, splitting on
 * blank lines. Caller must place this inside a block-level container
 * (e.g. <div>, <blockquote>, <section>) — never inside another <p>.
 */
export function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((chunk) => chunk.length > 0);
  if (paragraphs.length === 0) {
    return null;
  }
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{renderInner(paragraph)}</p>
      ))}
    </>
  );
}
