import { memo, useState } from "react";
import type { Result } from "../api/types";
import { formatDay, passageLabel } from "../lib/format";
import { excerpt } from "../lib/highlight";
import { MAX_LIMIT } from "../state/search";
import { Highlight } from "./Highlight";

interface Props {
  results: Result[];
  total: number;
  limit: number;
  onShowMore: () => void;
  onFilterClass: (code: string) => void;
  onFilterWeek: (week: string) => void;
}

export const ResultsList = memo(function ResultsList({ results, total, limit, onShowMore, onFilterClass, onFilterWeek }: Props) {
  const more = results.length < total;
  return (
    <section className="results" aria-labelledby="results-heading">
      <h2 id="results-heading" className="visually-hidden">
        Results
      </h2>
      <ol className="result-list">
        {results.map((result) => (
          <ResultRow key={result.doc_number} result={result} onFilterClass={onFilterClass} onFilterWeek={onFilterWeek} />
        ))}
      </ol>
      {more && (
        <div className="results-footer">
          <span className="muted">
            Showing <span className="mono">{results.length}</span> of <span className="mono">{total}</span>
          </span>
          {limit < MAX_LIMIT ? (
            <button type="button" className="button" onClick={onShowMore}>
              Show more
            </button>
          ) : (
            <span className="muted">Add a filter to see the rest.</span>
          )}
        </div>
      )}
    </section>
  );
});

function ResultRow({
  result,
  onFilterClass,
  onFilterWeek,
}: {
  result: Result;
  onFilterClass: (code: string) => void;
  onFilterWeek: (week: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { match } = result;
  const short = excerpt(match.text, match.spans);
  const clipped = short.clippedStart || short.clippedEnd;
  const shown = expanded ? { text: match.text, spans: match.spans, clippedStart: false, clippedEnd: false } : short;
  const group = result.classification_levels.at(-1) ?? result.classification;

  return (
    <li className="result">
      <h3 className="result-title">
        <Highlight text={result.title} spans={result.title_spans} />
      </h3>
      <div className="result-meta">
        <span className="mono doc-number">{result.doc_number}</span>
        <button
          type="button"
          className="meta-button mono"
          title={result.classification}
          aria-label={`Filter to class ${group}`}
          onClick={() => onFilterClass(group)}
        >
          {group}
        </button>
        <button
          type="button"
          className="meta-button"
          aria-label={`Filter to the week of ${formatDay(result.week)}`}
          onClick={() => onFilterWeek(result.week)}
        >
          {formatDay(result.week)}
        </button>
      </div>
      <p className="passage">
        <span className="passage-label">{passageLabel(match.kind, match.number)}</span>
        {shown.clippedStart && "… "}
        <Highlight text={shown.text} spans={shown.spans} />
        {shown.clippedEnd && " …"}
      </p>
      {clipped && (
        <button type="button" className="text-button passage-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? "Show less" : "Show the full passage"}
        </button>
      )}
    </li>
  );
}
