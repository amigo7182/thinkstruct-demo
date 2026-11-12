import { Fragment, useMemo } from "react";
import type { Span } from "../api/types";
import { splitHighlights } from "../lib/highlight";

/** Text with its matched words wrapped in <mark>, built from character spans (never innerHTML). */
export function Highlight({ text, spans }: { text: string; spans: readonly Span[] }) {
  const segments = useMemo(() => splitHighlights(text, spans), [text, spans]);
  return (
    <>
      {segments.map((segment, i) =>
        segment.marked ? <mark key={i}>{segment.text}</mark> : <Fragment key={i}>{segment.text}</Fragment>,
      )}
    </>
  );
}
