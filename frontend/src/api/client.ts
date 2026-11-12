import type { SearchParams, SearchResponse, ValidationErrorBody } from "./types";

export const API_BASE = (import.meta.env.VITE_API_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

export function buildSearchUrl(base: string, params: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const qs = query.toString();
  return `${base}/search${qs ? `?${qs}` : ""}`;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

export async function fetchSearch(
  fetchImpl: typeof fetch,
  base: string,
  params: SearchParams,
  signal: AbortSignal,
): Promise<SearchResponse> {
  let response: Response;
  try {
    response = await fetchImpl(buildSearchUrl(base, params), { signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(`Can't reach the search service at ${base}. Is the backend running?`);
  }
  if (!response.ok) {
    throw new Error(`The search service answered ${response.status}: ${await errorDetail(response)}`);
  }
  return (await response.json()) as SearchResponse;
}

async function errorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ValidationErrorBody;
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((d) => `${d.loc.at(-1)}: ${d.msg}`).join("; ");
  } catch {
    // not JSON
  }
  return response.statusText || "unknown error";
}
