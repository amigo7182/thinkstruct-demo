# Patent search at 10 million patents

How to run the Part 1 search engine on the full patent database. Written so a new
engineer can start building it; every number below is either measured on the sample
or marked as an estimate.

## 1. What changes at scale

| | Sample (Part 1) | Full database |
|---|---|---|
| Patents | 640 | 10,000,000 |
| Passages (abstract, claims, paragraphs) | 36,125 (56.4 per patent, measured) | ~564 million |
| Parsed text | 15.9 MB (24 KB per patent, measured) | ~250 GB |
| Vectors (384 dims) | 55 MB, in memory | 867 GB float32 / ~217 GB quantized to 7 bits |
| Embedding time | 71 s on a laptop GPU (509 passages/s, measured) | ~308 GPU-hours at that speed |

Part 1 keeps everything in one process's memory. That stops working around a few
million passages, so the design splits the work into a batch ingestion pipeline and a
search service backed by a real search engine.

## 2. Components

```
USPTO weekly XML ─► Object storage (S3) ─► RabbitMQ ─► Workers ─► OpenSearch ◄─ Search API ◄─ UI
                                              │            │
                                              └─ Postgres: job + document status ─► Status dashboard
```

| Component | Role | Part 1 equivalent |
|---|---|---|
| **S3** | `raw/` USPTO weekly files; `parsed/` cleaned JSON per patent; `vectors/` embedding shards | the JSON files on disk |
| **RabbitMQ** | Work queues `parse`, `embed`, `index`, each with a dead-letter queue | none (one process) |
| **Parse workers** (CPU) | XML to clean patents, using the Part 1 cleaning rules | `loader.py` |
| **Embed workers** (GPU) | Patents to passages to vectors, batched | `passages.py`, `VectorIndex` |
| **Index workers** | Bulk-write passages + vectors + metadata into OpenSearch | building the indexes |
| **OpenSearch** | One index, one document per passage: text, HNSW vector (Lucene engine, 7-bit scalar quantization), classification levels, week, title + abstract text | `FilterIndex` + `VectorIndex` |
| **Postgres** | Patent metadata, plus a status row per job and per patent | none |
| **Search API** (FastAPI) | Same endpoint as Part 1; embeds queries on CPU; caches each query's result set | `app.py`, `search.py` |

Why OpenSearch: one system gives everything Part 1 hand-built: keyword matching on
title/abstract, filters on classification and week, vector search that accepts those
filters (the Lucene engine applies filters during the HNSW search), and aggregations for
the classification and timeline counts. One best passage per patent comes from
over-fetching passages and grouping them by `doc_number` (field collapsing or in the API).

## 3. Pipelines

**A. Backfill (one time, 10M patents)**
1. A scheduler lists every weekly file in `raw/` and enqueues one `parse` job per file.
2. Parse worker: stream the XML, clean each patent (canceled claims dropped, claim numbers
   inferred, empty paragraphs dropped with original numbering kept), write `parsed/` JSON
   and a Postgres row, then enqueue `embed` jobs in batches of ~500 patents.
   **Fix at the source:** keep the whitespace around inline tags when flattening XML.
   The sample's "element120and" text (67% of paragraphs) came from stripping it.
3. Embed worker: build passages (≤180 words; longer ones become 150-word windows with
   30 words of overlap), embed on GPU in batches, write a vector shard to `vectors/`,
   enqueue an `index` job.
4. Index worker: bulk-insert passages into OpenSearch; mark the patents `indexed`.

**B. Weekly update.** The same pipeline, triggered by each new weekly file. At ~190,000
patents a week (10M a year, estimate) that is ~5.9 GPU-hours a week at the measured speed.

**C. Model or cleaning change.** Every row stores a `pipeline_version` (a hash of the model
name and cleaning code, like Part 1's cache fingerprint). A new version is built into a
*new* index in the background; the search alias switches over only when it's complete,
so search never goes down and never mixes vectors from two models.

**D. Query path.** API validates parameters, embeds the query on CPU (~5 ms measured),
runs one OpenSearch request (filtered vector search + collapse + aggregations) and caches
the query's result set so filter changes don't re-run the vector search.

## 4. Errors

- **Idempotent jobs.** Every write is an upsert keyed by `doc_number` + `pipeline_version`, so
  rerunning any job is safe.
- **Ack after commit.** A worker acknowledges a message only after its writes are committed;
  if it crashes, RabbitMQ redelivers the message to another worker.
- **Retries, then dead-letter.** Up to 3 attempts with backoff; then the message goes to the
  dead-letter queue and the job's status becomes `failed` with the error text. Fixed jobs are
  replayed from the dead-letter queue.
- **Bad data isn't a crash.** Patents that fail a quality check (e.g. inconsistent claim
  numbering, which affected 4 of 640 sample patents) are indexed and flagged `needs_review`.

## 5. Tracking status

Postgres tables (the proof of concept implements the first two):

- `jobs(week_file, status, attempts, patents, error, worker, updated_at)`
- `documents(doc_number, week, claims, paragraphs, status, pipeline_version, updated_at)`
- `index_versions(version, model, created_at, documents, is_live)`

The status dashboard shows: jobs and patents by status, queue depths, dead-letter count,
throughput (patents/min, passages/s), and search latency (p50/p95). **Alerts:** dead-letter
queue not empty; throughput below half its average; data-quality metrics drifting from the
sample's baseline (claim-numbering consistency 99.4%, empty-paragraph rate ~50%).

## 6. Cost (AWS us-east-1, on-demand, November 2026 prices)

**One time: embedding 564M passages.** ~308 GPU-hours if a cloud L4 GPU is no faster than
the laptop GPU we measured (an upper bound). g6.xlarge (1× L4) is $0.8048/hr on demand:
**~$250** (~$110 on spot). 10 GPUs in parallel finish in ~31 hours.

**Monthly:**

| Item | Sizing | $/month |
|---|---|---|
| OpenSearch data nodes | ~217 GB quantized vectors + ~72 GB HNSW graph (estimate) ≈ 290 GB RAM → 2× r7g.8xlarge (256 GiB, $1.7136/hr) | ~2,500 |
| Search API | 2× r7g.xlarge ($0.2142/hr), CPU query embedding | ~310 |
| Postgres | 1× r7g.xlarge, self-managed | ~160 |
| RabbitMQ | 1× r7g.large ($0.1071/hr) | ~80 |
| S3 | ~1 TB raw + parsed + vector shards at $0.023/GB | ~25 |
| Weekly embedding | ~5.9 GPU-hours/week | ~20 |
| **Total** | single copy of the index, no replicas | **~$3,100** |

Not included: a replica for high availability (doubles the OpenSearch line), reserved or
spot discounts (roughly 30-60% less), extra disk (quantization keeps the raw vectors on disk
too), and staff time. Prices: g6 and r7g from
doit.com/compute/spot (us-east-1), S3 from AWS's published Standard tier.

**Cheaper option:** index only abstracts and claims in the vector index (18 per patent →
180M vectors, ~92 GB with the graph) on 1× r7g.4xlarge (~$625/month), and score description
paragraphs only for the top candidates. Trade-off: a match that exists only in a description
paragraph can be missed in the first stage.

## 7. Challenges (and what to do first)

1. **Filtered vector search loses recall when filters are selective.** HNSW walks a graph; if
   most neighbours fail the filter, good matches are missed. Part 1 measured the same trade-off
   (pre-filtering 5-7× faster for selective filters, *slower* for broad ones; post-filtering
   returned 0-1 of 10 results). Use the Lucene engine's efficient filtering, measure recall at
   realistic filter selectivity, and for very selective filters fall back to exact scoring of
   the candidates, mirroring Part 1's `auto` strategy.
2. **One patent, many passages.** Raw vector hits are dominated by a few patents (seen in
   Part 1). Over-fetch passages and collapse by `doc_number`.
3. **Counts over large result sets.** Keep the Part 1 model: a query matches its top N patents
   (N≈1,000 at scale) and aggregations run over that set, so counts stay exact and cheap.
4. **Data varies across decades.** Older patents use other XML formats and OCR text. Run the
   quality metrics per year and expect new cleaning rules.
5. **Near-duplicates.** The sample already has identical texts (two "SPOKE-STAR UNIT" patents).
   Hash passages to detect them; group them in results.
6. **Timeline at 20+ years.** ~1,000 weeks don't fit on screen: bucket by month or year and
   drill down.

## 8. Proof of concept (this folder)

Implements the ingestion queue and status tracking (pipeline A steps 1-2) locally:
RabbitMQ + Postgres in Docker, a producer that enqueues one job per weekly file, workers
that clean patents with the Part 1 loader and upsert their status, retries with a
dead-letter queue, and a live status view. Fast and rough by design.

```bash
cd scale-poc
docker compose up -d                       # RabbitMQ (UI: localhost:15672, guest/guest) + Postgres
uv run python producer.py                  # enqueue 64 weekly-file jobs
FAIL_RATE=0.2 uv run python worker.py      # run 1-3 of these in separate terminals
uv run python status.py --watch            # live counts
docker compose down -v                     # stop and delete everything
```

`FAIL_RATE` makes a share of jobs fail on purpose so retries and the dead-letter queue can
be seen working; run the producer again to see that reprocessing is idempotent.
