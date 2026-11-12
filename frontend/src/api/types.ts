// Mirrors the backend's /openapi.json (FastAPI models in backend/app.py).
// Dates are ISO strings ("2024-07-18"); spans are [start, end) character offsets.

export type Span = [start: number, end: number];

export interface Match {
  kind: string; // "abstract", "claim" or "paragraph"
  number: number; // claim number or original paragraph number
  text: string;
  spans: Span[];
}

export interface Result {
  doc_number: string;
  title: string;
  title_spans: Span[];
  classification: string; // raw code, e.g. "B60B3300FI"
  classification_levels: string[]; // broadest first: ["B", "B60", "B60B", "B60B 33"]
  week: string;
  score: number | null; // null in browse mode
  match: Match;
}

export interface ClassificationNode {
  code: string;
  count: number;
  children: ClassificationNode[];
}

export interface WeekCount {
  week: string;
  count: number;
}

export interface Facets {
  classification: ClassificationNode[];
  weeks: WeekCount[]; // every week in the dataset, including empty ones
}

export interface AppliedFilters {
  classification: string | null;
  week_from: string | null;
  week_to: string | null;
  title: string | null;
  keywords: string | null;
}

export interface SearchResponse {
  request_id: number | null; // echoed back so the client can tell which request this answers
  query: string;
  filters: AppliedFilters;
  total: number; // patents left after filters
  result_set_size: number | null; // how many patents a query matches before filters; null in browse mode
  results: Result[];
  facets: Facets;
  timing_ms: Record<string, number>;
}

/** Query parameters of GET /search. Empty values are left out of the URL. */
export interface SearchParams {
  q?: string;
  classification?: string;
  week_from?: string;
  week_to?: string;
  title?: string;
  keywords?: string;
  limit?: number;
  offset?: number;
  request_id?: number;
  delay_ms?: number; // testing only: the server waits this long before answering
}

export interface ValidationErrorBody {
  detail?: { loc: (string | number)[]; msg: string; type: string }[] | string;
}
