"""Part 1 timing: search with and without hybrid filters, comparing three filtering strategies.

Run:  uv run python benchmark.py            (1x and 10x data)
      uv run python benchmark.py --scales 1 10 20

Larger scales are made by copying the dataset (with new document numbers) and tiling the
cached embeddings, so no re-embedding is needed. The copies are identical, so this measures
SPEED only, not search quality. Memory: each 1x copy of the embeddings is about 55 MB.
"""
import argparse
import statistics
import time
from dataclasses import replace

import numpy as np

from index import VectorIndex
from loader import load_patents
from passages import build_passages
from search import Filters, SearchEngine

QUERIES = [
    "bicycle spoke made by injection molding",
    "tire tread pattern with sipes for wet grip",
    "trailer hitch coupling for a towing vehicle",
    "non-pneumatic tire with flexible spokes",
    "wheel hub bearing assembly",
]
SCENARIOS = {
    "no filters": Filters(),
    "broad: B60C": Filters(classification="B60C"),
    "selective: B60B + 'bicycle'": Filters(classification="B60B", keywords="bicycle"),
}
REPEATS = 20
K = 10


def median_ms(fn, repeats: int = REPEATS) -> float:
    times = []
    for _ in range(repeats):
        start = time.perf_counter()
        fn()
        times.append((time.perf_counter() - start) * 1000)
    return statistics.median(times)


def scaled_engine(patents, passages, vectors: VectorIndex, factor: int) -> SearchEngine:
    if factor == 1:
        return SearchEngine(patents, passages, vectors=vectors)
    copies = range(factor)
    big_patents = [replace(p, doc_number=f"{p.doc_number}-{i}") for i in copies for p in patents]
    big_passages = [replace(p, doc_number=f"{p.doc_number}-{i}") for i in copies for p in passages]
    big_vectors = VectorIndex(big_passages, model=vectors.query_model, embeddings=np.tile(vectors.embeddings, (factor, 1)))
    return SearchEngine(big_patents, big_passages, vectors=big_vectors)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scales", type=int, nargs="+", default=[1, 10])
    args = parser.parse_args()

    patents = load_patents()
    passages = build_passages(patents)
    base = SearchEngine(patents, passages)

    query_vectors = [base.vectors.embed_query(q) for q in QUERIES]  # warm up the model
    embed_ms = statistics.median(median_ms(lambda q=q: base.vectors.embed_query(q), 5) for q in QUERIES)
    print(f"\nEmbedding one query: {embed_ms:.2f} ms (same at every scale, excluded below)\n")

    print("| Data | Filter | Candidates | Strategy | Median ms | Results (of 10) |")
    print("|---|---|---|---|---|---|")
    for factor in args.scales:
        engine = scaled_engine(patents, passages, base.vectors, factor)
        size = f"{factor}x ({len(engine.patents):,} patents, {len(engine.passages):,} passages)"
        for name, filters in SCENARIOS.items():
            allowed = engine.allowed(filters)
            candidates = len(engine.patents) if allowed is None else len(allowed)
            strategies = ["none"] if allowed is None else ["post", "pre", "mask"]
            for strategy in strategies:
                times, counts = [], []
                for qv in query_vectors:
                    run = lambda qv=qv: engine.filtered_top_k(qv, filters, k=K, strategy="pre" if strategy == "none" else strategy)
                    times.append(median_ms(run))
                    counts.append(len(run()))
                label = {"none": "semantic only", "pre": "pre-filter", "post": "post-filter", "mask": "mask"}[strategy]
                print(f"| {size} | {name} | {candidates:,} | {label} | {statistics.median(times):.2f} | {min(counts)} |")


if __name__ == "__main__":
    main()