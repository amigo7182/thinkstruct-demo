# Patent search: Thinkstruct coding task

Semantic search over vehicle patent applications, with hybrid filters (Part 1), a design for
10 million patents plus a working ingestion-queue proof of concept (Part 2), and an
"Interface at Scale" frontend with three linked views (Part 3).

**Video walkthrough of Parts 2 and 3:** _[](https://youtu.be/yIL8nOI5PKE)_

| Part | Folder | What it is |
|---|---|---|
| 1 | [`backend/`](backend/) | Search engine and HTTP API (Python, FastAPI, sentence-transformers) |
| 2 | [`scale-poc/`](scale-poc/) | [`DESIGN.md`](scale-poc/DESIGN.md) for 10M patents, and the ingestion-queue proof of concept |
| 3 | [`frontend/`](frontend/) | The interface (React + TypeScript, no UI or chart library) |

## Problem statement

Describe an invention in plain words and find the patent applications most similar to it,
showing **which passage matched best** (a claim, a description paragraph, or the abstract)
with the query's words highlighted. Then narrow those results the way an examiner does: by
technology area (classification), publication week or range of weeks, keywords in the
title or abstract, and exact title, with every view of the results staying consistent
while you do.

- **Input:** a natural-language query, or none (browse all patents), plus optional filters.
- **Output:** patents ranked by their best-matching passage (a claim, a description
  paragraph or the abstract) with the matched words highlighted, plus counts by
  classification and by week for exactly the same set of patents.

## Part 1: Search engine

### Run it

Needs [uv](https://docs.astral.sh/uv/). It installs Python 3.14 and the dependencies on
first use.

```bash
cd backend
uv run pytest                    # 61 tests; uses a fake embedding model, so no download
uv run python search.py          # a short demo in the terminal: query, filter, new query
uv run uvicorn app:app           # the API on http://127.0.0.1:8000 (interactive docs at /docs)
uv run python benchmark.py       # the hybrid-search timing below
```

The first run downloads the embedding model (`sentence-transformers/all-MiniLM-L6-v2`)
and embeds all 36,125 passages. That took 71 s on an Apple M3 GPU; on a CPU-only machine
expect several minutes. The vectors are cached in `backend/cache/` with a fingerprint of
the model and every passage, so later starts load in seconds and any data or model change
rebuilds them. The data (64 weekly files, 640 patents) is committed in
`backend/data/patent_data_small/`.

### How it works

1. **Clean** each patent (`loader.py`; rules below).
2. **Split** it into passages (`passages.py`): the abstract, every claim and every
   description paragraph. Passages over 180 words become 150-word windows with 30 words
   of overlap.
3. **Embed** every passage (all-MiniLM-L6-v2, 384 dimensions) and score a query by cosine
   similarity (`index.py`). A patent's score is its best passage, which is the "why it
   matched" shown in the results. Queries are embedded on the CPU (about 3 ms), because the
   first embedding of each new input length on the Mac GPU took up to 936 ms.
4. **Match:** a query matches its top 100 patents (`search.py`). Filters narrow that set,
   and the results, classification tree and weekly counts are all computed from the same
   narrowed set. With no query, browse mode lists all 640 patents, newest first.

Hybrid filters (all optional, combined with AND):
- **Classification:** any level, e.g. `B60`, `B60B` or `B60B 27`.
- **Keywords:** every word must appear in the title or abstract.
- **Title:** an exact title, ignoring case and spacing.
- **Weeks:** an inclusive range of publication weeks.

### Missing fields and data cleaning

The choice: keep every patent that has something searchable, fill in placeholders for
missing metadata, and skip only records that can't be used.

- **Skipped:** a record with no document number, or with none of claims, abstract and
  description. None of the sample's 640 records is skipped.
- **Kept, with placeholders:**
  - **Title:** a missing title becomes "Untitled".
  - **Classification:** a missing code becomes "Unclassified", which is its own class in
    the filters and the drill-down.
  - **Abstract and citation:** a missing one becomes empty text.
- **What the sample actually contains** (checked with `scripts/explore_data.py`):
  - **Missing fields:** no field is ever missing.
  - **Empty paragraphs:** 20,819 of the 42,040 description paragraphs are empty, and 119
    patents have no description text at all. Empty paragraphs are dropped but the original
    numbers are kept, so "paragraph 31" matches the source. Those 119 patents are still
    searched by their abstract and claims.
  - **Canceled claims:** the 167 placeholders such as `1 - 15 . (canceled)` are dropped.
  - **Claim numbers:** the first claim of 509 patents and 2,712 later claims have lost
    their "N ." number, so the number is inferred from the order. The 4 patents whose
    numbering is inconsistent are kept and logged as warnings.
- **Spacing:** text that was glued together when tags were stripped ("element120and",
  "toFIG.2") is repaired to "element 120 and" and "to FIG. 2".

### Hybrid search timing

`uv run python benchmark.py` on an Apple M3 measures the time to find the top 10 patents,
not counting the query embedding (2.7 ms, the same at every size). Each figure is the
median of 20 runs for each of 5 queries. "10×" is the dataset copied ten times (speed
only; the copies are identical).

| Data | Filter | Candidates | Strategy | Median | Results (of 10) |
|---|---|---|---|---|---|
| 1× (640 patents, 36,125 passages) | none | 640 | semantic only | 0.85 ms | 10 |
| | broad: `B60C` | 318 | post-filter | 0.91 ms | 1 |
| | | | pre-filter | 1.44 ms | 10 |
| | | | mask | 0.89 ms | 10 |
| | selective: `B60B` + "bicycle" | 36 | post-filter | 0.90 ms | 0 |
| | | | pre-filter | 0.13 ms | 10 |
| | | | mask | 0.87 ms | 10 |
| 10× (6,400 patents, 361,250 passages) | none | 6,400 | semantic only | 8.48 ms | 10 |
| | broad: `B60C` | 3,180 | post-filter | 8.55 ms | 0 |
| | | | pre-filter | 16.08 ms | 10 |
| | | | mask | 8.81 ms | 10 |
| | selective: `B60B` + "bicycle" | 360 | post-filter | 8.55 ms | 0 |
| | | | pre-filter | 1.75 ms | 10 |
| | | | mask | 8.48 ms | 10 |

What this shows, and what the engine does about it:
- **Filters are cheap.** They are set intersections on inverted indexes (by classification
  level, week, normalized title and word), smallest set first: well under a millisecond.
- **Selective filters make search faster.** Filtering first and scoring only the
  candidates' passages is 6.5× faster than an unfiltered search at 1× and 4.8× at 10×.
- **Broad filters don't.** Copying half of the rows costs more than it saves (16.1 ms
  against 8.8 ms at 10×). "Mask" instead scores every passage in place and rules out the
  rest before ranking: the same cost as no filter, and always complete.
- **Post-filtering is fast but wrong.** It scores everything, keeps the top 50, then
  filters, and returns only 0–1 of the 10 results asked for.
- **So the engine picks automatically:** it filters first when the filters keep under 25%
  of patents, and masks otherwise.
- **The API skips scoring on filter changes.** It caches each query's top-100 set, so a
  filter change is set lookups and counting: about 0.2 ms on the server.
- **At 10 million patents** brute force stops working. The plan is an HNSW index that
  applies filters during the search (OpenSearch's Lucene engine), with quantized vectors.
  See [`scale-poc/DESIGN.md`](scale-poc/DESIGN.md).

## Part 2: Implementation at scale

[`scale-poc/DESIGN.md`](scale-poc/DESIGN.md) is the design for 10 million patents, written
for an intern to start from. It covers:
- **Components:** S3, RabbitMQ, parse, embed and index workers, OpenSearch, Postgres and
  the search API.
- **Pipelines:** the backfill, weekly updates, model or cleaning changes, and the query
  path.
- **Errors and status:** error handling (idempotent jobs, ack after commit, retries, a
  dead-letter queue) and status tracking.
- **Cost:** about $250 once for embeddings and about $3,100 a month.
- **Challenges**, with what to do first.

The proof of concept is the ingestion queue (pipeline A, steps 1–2):
- **Services:** RabbitMQ and Postgres in Docker.
- **Producer:** enqueues one job per weekly file.
- **Workers:** clean patents with the Part 1 loader and upsert each job's and patent's
  status.
- **Failures:** retried up to 3 times, then sent to a dead-letter queue.
- **Status:** a terminal status view.

```bash
cd scale-poc
docker compose up -d                       # RabbitMQ (UI: localhost:15672, guest/guest) + Postgres on host port 5433
                                           # give RabbitMQ ~15 s to start before the next steps
uv run python status.py --watch            # live counts; start this first, it also creates the tables
FAIL_RATE=0.5 uv run python worker.py      # in one or more other terminals
uv run python producer.py                  # enqueue the 64 weekly-file jobs
docker compose down -v                     # stop and delete everything
```

Verified end to end:
- **Clean run:** 64 of 64 jobs done, giving 640 patents, 10,411 claims and 21,221
  paragraphs (the same totals as the backend's tests).
- **`FAIL_RATE=0.5` with two workers:** jobs retry and then succeed, a few are
  dead-lettered after 3 attempts, and both workers share the work.
- **Running the producer again:** every job ends done and there are still exactly 640
  patents.

Known rough edge: on a fresh database, starting several workers at the same instant can
fail one of them while the tables are created. Start `status.py` or one worker first.

## Part 3: Interface at Scale

### Why this enhancement

I picked **Interface at Scale**, the enhancement recommended for frontend applicants, since
I'm applying for the Frontend Engineer role. It also builds directly on Part 1: the engine
already returns one consistent answer per request (results, classification counts, and
weekly counts, all computed from the same filtered set), and linked views match how
examiners actually work, narrowing a large result set step by step. It also brings real
engineering problems:
- keeping every count consistent across views,
- never showing a stale answer when filters change faster than responses arrive,
- keeping each update fast enough to feel instant, measured rather than assumed.

### Run it

Needs Node 20.19+ or 22.12+.

```bash
# Terminal 1: the API on http://127.0.0.1:8000
cd backend && uv run uvicorn app:app

# Terminal 2: the interface on http://localhost:5173
cd frontend && npm install && npm run dev
```

- **Production build:** `npm run build && npm run preview` serves it on the same port.
- **Checks:** `npm test` (41 tests: Vitest + Testing Library), `npm run typecheck`
  (`tsc --noEmit`) and `npm run build`.
- **API address:** the interface calls `VITE_API_URL` (default `http://127.0.0.1:8000`; see
  `frontend/.env.example`).
- **Port:** the dev server refuses to move off port 5173, because that is the origin the
  API's CORS settings allow.

### What it does

- **Results list:** shows why each patent matched: the highlighted title, document number,
  class, week, which passage matched ("Claim 12", "Paragraph 31", "Abstract") and the
  passage with its matched words highlighted.
- **Classification breakdown:** drill-down with count bars (B › B60 › B60B › B60B 27) and a
  breadcrumb to go back up.
- **Timeline:** all 64 weeks. Click a week to filter to it, shift-click for a range, or use
  the arrow keys.
- **Linked selection:** selecting in any view, including a result's class or week, filters
  all of them and every count updates. Active filters are chips you can remove in any
  order, plus "Clear all". A new query keeps the filters.
- **States:**
  - **Landing:** sharks animating behind the search box.
  - **No results:** "No patents in this part of the sea." with the chips that caused it.
    If a week filter caused it, the timeline stays, so a range can still start at an
    empty week.
  - **Saved searches:** saved in browser storage (the bonus).
- **Light and dark mode,** responsive down to phones, keyboard accessible, and every text
  colour passes WCAG AA.

### How the views stay linked

- **One source of truth.** `{ query, filters, limit }` lives in one state object
  (`src/state/search.ts`) and is mirrored in the URL, using the API's own parameter names
  (`?q=…&classification=B60B&week_from=…`). Links are shareable and back/forward work.
- **One request, one response, three views.** Every state change sends exactly one
  `GET /search`. The classification breakdown, the timeline and the results list all
  render from that one response object.
- **Chips show what you asked for; views show what you got.** Chips render from the state,
  so they update instantly. The views render from the response, including which class and
  weeks are highlighted.

### Stale results can't appear

- **Request ids:** each request gets an increasing id (sent as `request_id`, which the API
  echoes) and its own `AbortController`.
- **Only the latest is applied:** a new request aborts the previous one, and a response is
  applied only if its id is the latest. The abort saves work; the id check is what
  guarantees correctness.
- **While waiting:** the previous response stays on screen, slightly dimmed with a small
  "Updating" note. Both appear only after about 150 ms, so fast updates don't flash.
- **No double requests:** the store lives outside React (`src/state/store.ts`, read with
  `useSyncExternalStore`), so React StrictMode can't double-send requests.
- **Tested:** the tests' fetch mock ignores abort signals on purpose, so an older answer
  really does arrive after the newer one and must be dropped. Removing the id check makes
  all three stale-response tests fail.

To see it, open `?debug=1`:
1. Set a server delay.
2. Tick "Random delay" (answers then arrive out of order) and "Don't abort older requests".
3. Click filters quickly.

The counter line reports how many stale answers arrived and were dropped.

### Measuring latency

- **Start:** `performance.now()` is recorded in the handler that changes the state.
- **End:** once the response that answers that change has rendered, a `useEffect` waits for
  the next `requestAnimationFrame` and then one task, so the browser has painted.
- **What it covers:** the request, the server, JSON parsing, the React render and the paint.
- **What's left out:** the first page load, the no-results state (the sharks animate
  there), samples taken while a debug delay is set, and changes that a newer change
  replaced before their answer painted.

The page shows the latest value ("updated in 21 ms") and keeps the last 100 samples. With
`?debug=1`, a panel shows the count, median and p95 and copies the samples as JSON.

**Measured setup:**
- **Build and machine:** the production build (`npm run preview`) and the backend on the
  same Apple M3 MacBook Air (macOS 26.1).
- **Browser:** Chrome 157, headless, driven by a script through the DevTools protocol.
- **Pacing:** one change about 250 ms after the previous one painted.
- **Each row:** a fresh page load, read from the `?debug=1` panel.

| Scenario | Samples | Median | p95 |
|---|---|---|---|
| Classification filter on and off, query mode | 40 | 26 ms | 36 ms |
| Week and week-range filters, query mode | 38 | 21 ms | 36 ms |
| Filters in browse mode (all 640 patents) | 40 | 22 ms | 35 ms |
| New query, not yet cached by the server | 20 | 37 ms | 43 ms |
| Repeated query (served from the result-set cache) | 20 | 22 ms | 32 ms |

- **Where the time goes:** a filter change needs about 0.2 ms on the server. Most of the
  rest is the browser's frame timing, because the measurement deliberately waits for the
  paint.
- **New queries** add the query embedding and the vector search (about 5 ms on the
  server).
- **To reproduce in a normal browser:** open `/?q=tire%20tread%20with%20sipes&debug=1`, make
  about 40 filter changes, and read the panel.

### What changes at 10 million patents

- **Counts:** the classification and timeline counts would come from the search engine's
  aggregations, run in the same request as the filtered query, instead of being counted in
  Python.
- **Paging:** results would be paged on the server with a cursor, instead of raising
  `limit`.
- **Debouncing:** rapid changes would be debounced for about 150 ms (range drags, typing in
  the keyword filter), on top of abort and request ids, so bursts send one request.
- **Timeline:** with 1,000+ weeks, it would be bucketed by month or year, with drill-down to
  weeks.

### Light/dark toggle

The theme switch in the top bar is a glass knob drawn by one WebGL fragment shader
(`frontend/src/lib/glass/`):
- **Glass:** the bevel refracts and frosts what sits beneath it, with a little chromatic
  aberration.
- **Light strip:** it orbits the glass from the bottom (night) to the top (day). It scatters
  into the glass, washes the track and spills onto the page. The same glow model works
  everywhere: coloured light laid over the surface with alpha `1 − e^−intensity`, so it is
  as visible on the light page as on the dark one.
- **Icons:** a 9×9 pixel matrix. Each moon pixel is paired with a sun pixel by angle, and
  the morph is a pure function of the knob's position, with a per-pixel stagger, swirl and
  spring. Dragging halfway holds the swarm mid-flight, and the theme changes on release.

It is a real `<button aria-pressed>` (click, Enter or Space; drag or flick the knob). It
only renders while something moves, follows `prefers-reduced-motion` and falls back to a
plain switch without WebGL. Inspired by
[Glass Light Toggle](https://experiments.thisiswhitespace.com/glass-light-toggle); written
from scratch here.

## Credits

- **ASCII sharks** by stackedlol, MIT license: https://github.com/stackedlol/ascii-sharks.
  Vendored in `frontend/src/vendor/ascii-sharks/` with its LICENSE. The only change is an
  optional palette (background, grid, fish and wake colours) so the ocean matches light and
  dark mode. The changes are marked `thinkstruct:` in `renderer.ts`, `engine.ts` and
  `index.ts`, and the defaults keep the original colours.
- **Fonts:** Geist and Geist Mono (SIL Open Font License), bundled through
  `@fontsource-variable`, so they work offline.
