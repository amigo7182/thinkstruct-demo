import { memo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { WeekCount } from "../api/types";
import { dateParts, formatDay, monthName, plural } from "../lib/format";
import { weekLabel } from "../state/search";

interface Props {
  weeks: WeekCount[]; // facets.weeks of the current response: every week, including empty ones
  from: string | null; // the week filter that response answers
  to: string | null;
  onSelect: (from: string | undefined, to: string | undefined) => void;
}

/**
 * One column per week. Click a week to filter to it (click it again to clear), shift-click
 * (or Shift+Enter) to select the range from the last clicked week. Arrow keys move between
 * weeks, so the 64 columns are a single tab stop.
 */
export const Timeline = memo(function Timeline({ weeks, from, to, onSelect }: Props) {
  const anchor = useRef<string | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const filtered = from !== null || to !== null;
  const inRange = (week: string) => filtered && (from === null || week >= from) && (to === null || week <= to);
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const selectedIndex = weeks.findIndex((w) => inRange(w.week));
  const tabIndex = focusIndex ?? (selectedIndex >= 0 ? selectedIndex : 0);

  function choose(week: string, extend: boolean) {
    const start = anchor.current ?? from;
    if (extend && start) {
      const [a, b] = start <= week ? [start, week] : [week, start];
      onSelect(a, b);
      return;
    }
    anchor.current = week;
    if (from === week && to === week) onSelect(undefined, undefined); // toggle off
    else onSelect(week, week);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(weeks.length - 1, index + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = weeks.length - 1;
    else if ((event.key === "Enter" || event.key === " ") && event.shiftKey) {
      event.preventDefault();
      choose(weeks[index].week, true);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    buttons.current[next]?.focus();
  }

  const columns = { "--weeks": weeks.length } as CSSProperties;
  const readoutIndex = hovered ?? focusIndex;
  const readout =
    readoutIndex !== null && weeks[readoutIndex]
      ? `${formatDay(weeks[readoutIndex].week)} · ${plural(weeks[readoutIndex].count, "patent", "patents")}`
      : weekLabel(from ?? undefined, to ?? undefined);

  return (
    <section className="panel timeline" aria-labelledby="timeline-heading">
      <div className="panel-head">
        <h2 id="timeline-heading" className="panel-title">
          Published by week
        </h2>
        <p className="timeline-readout mono" aria-hidden="true">
          {readout}
        </p>
      </div>
      <div className="timeline-scroll">
        <div
          className="timeline-bars"
          role="group"
          aria-label="Weeks"
          aria-describedby="timeline-hint"
          style={columns}
          onMouseLeave={() => setHovered(null)}
        >
          {weeks.map((w, index) => (
            <button
              key={w.week}
              ref={(el) => {
                buttons.current[index] = el;
              }}
              type="button"
              className="week"
              tabIndex={index === tabIndex ? 0 : -1}
              aria-pressed={inRange(w.week)}
              aria-label={`${formatDay(w.week)}: ${plural(w.count, "patent", "patents")}`}
              onClick={(event: MouseEvent<HTMLButtonElement>) => choose(w.week, event.shiftKey)}
              onKeyDown={(event) => onKeyDown(event, index)}
              onFocus={() => setFocusIndex(index)}
              onBlur={() => setFocusIndex((current) => (current === index ? null : current))}
              onMouseEnter={() => setHovered(index)}
            >
              <span
                className={`week-bar${w.count === 0 ? " week-bar--empty" : ""}`}
                style={{ height: w.count === 0 ? undefined : `${(w.count / max) * 100}%` }}
              />
            </button>
          ))}
        </div>
        <div className="timeline-labels mono" aria-hidden="true" style={columns}>
          {weeks.map((w, index) => {
            const { year, month } = dateParts(w.week);
            const previous = index > 0 ? dateParts(weeks[index - 1].week) : null;
            if (previous && previous.month === month) return <span key={w.week} />;
            const showYear = !previous || previous.year !== year;
            const minor = month % 3 !== 1 && !showYear; // hidden when narrow; quarters and years stay
            return (
              <span
                key={w.week}
                className={`timeline-label${minor ? " timeline-label--minor" : ""}${index >= weeks.length - 3 ? " timeline-label--end" : ""}`}
              >
                <span>{monthName(month)}</span>
                {showYear && <span>{year}</span>}
              </span>
            );
          })}
        </div>
      </div>
      <p id="timeline-hint" className="panel-hint">
        Click a week to filter. Shift-click to select a range.
      </p>
    </section>
  );
});
