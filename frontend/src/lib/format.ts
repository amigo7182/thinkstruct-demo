// Dates are formatted from their ISO parts directly, so time zones can never shift a week.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dateParts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? "";
}

/** "2024-07-18" -> "18 Jul 2024" */
export function formatDay(iso: string): string {
  const { year, month, day } = dateParts(iso);
  return `${day} ${monthName(month)} ${year}`;
}

/** "7 Mar – 4 Apr 2024", "7–28 Mar 2024" or "26 Dec 2024 – 9 Jan 2025". */
export function formatRange(from: string, to: string): string {
  if (from === to) return formatDay(from);
  const a = dateParts(from);
  const b = dateParts(to);
  if (a.year !== b.year) return `${formatDay(from)} – ${formatDay(to)}`;
  if (a.month !== b.month) return `${a.day} ${monthName(a.month)} – ${b.day} ${monthName(b.month)} ${b.year}`;
  return `${a.day}–${b.day} ${monthName(b.month)} ${b.year}`;
}

export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/** "41 of the top 100 matches", or "41 patents" in browse mode. */
export function resultSummary(total: number, resultSetSize: number | null): string {
  if (resultSetSize === null) return plural(total, "patent", "patents");
  if (total === resultSetSize) return `The top ${resultSetSize} matches`;
  return `${total.toLocaleString("en-US")} of the top ${resultSetSize} matches`;
}

/** "Abstract", "Claim 12", "Paragraph 31" */
export function passageLabel(kind: string, number: number): string {
  if (kind === "abstract") return "Abstract";
  const word = kind.charAt(0).toUpperCase() + kind.slice(1);
  return `${word} ${number}`;
}

export function formatMs(ms: number): string {
  if (ms < 1) return "<1 ms";
  return `${Math.round(ms)} ms`;
}
