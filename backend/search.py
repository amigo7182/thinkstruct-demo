"""The search engine: one query plus filters in, one consistent response out.

How a request is answered
1. Query  -> the query's result set: its RESULT_SET_SIZE most relevant patents (cached per query).
   No query -> browse mode: every patent, newest first.
2. Filters (classification, weeks, title, keywords) narrow that result set.
3. Results, highlights, classification counts and the weekly timeline are ALL computed from
   that one narrowed set, so the three views of the interface can never disagree.

Because the result set is cached per query, changing a filter needs no new embedding or
scoring: just set lookups and counting. That keeps filter changes fast in the interface.
"""
import re
import time
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import date
from functools import lru_cache
from typing import Literal, NamedTuple

import numpy as np

from index import FilterIndex, PassageRows, VectorIndex, best_per_patent, normalize_word, tokenize, top_patents
from models import Passage, Patent

RESULT_SET_SIZE = 100  # how many patents a query "matches" before filters narrow them
POST_FILTER_OVERFETCH = 5  # post-filtering fetches k x this many patents before filtering
PRE_FILTER_MAX_FRACTION = 0.25  # "auto" pre-filters only when filters keep under 25% of patents


@dataclass(frozen=True)
class Filters:
    """Every filter is optional; None means "no constraint"."""

    classification: str | None = None  # any level: "B60", "B60B", "B60B 27"
    week_from: date | None = None  # inclusive
    week_to: date | None = None  # inclusive
    title: str | None = None  # exact title, ignoring case and spacing
    keywords: str | None = None  # all words must appear in the title or abstract

    def is_empty(self) -> bool:
        return all(value in (None, "") for value in asdict(self).values())

    def as_dict(self) -> dict:
        return {k: (v.isoformat() if isinstance(v, date) else v) for k, v in asdict(self).items()}


class Hit(NamedTuple):
    doc_number: str
    score: float | None  # None in browse mode
    row: int  # embedding row of the passage that matched best


_WORD_SPAN = re.compile(r"[A-Za-z0-9]+")


def highlight_spans(text: str, terms: set[str]) -> list[list[int]]:
    """[start, end] character positions of every word in `text` that matches a search term."""
    if not terms:
        return []
    return [[m.start(), m.end()] for m in _WORD_SPAN.finditer(text) if normalize_word(m.group().lower()) in terms]


class SearchEngine:
    def __init__(self, patents: list[Patent], passages: list[Passage],
                 vectors: VectorIndex | None = None, model=None):
        self.patents = {p.doc_number: p for p in patents}
        self.passages = passages
        self.filters = FilterIndex(patents)
        self.rows = PassageRows(passages)
        self.vectors = vectors if vectors is not None else VectorIndex(passages, model=model)
        self.all_weeks = sorted(set(self.filters.week_by_doc.values()))
        # Browse mode order: newest first, then by document number
        self._browse_order = sorted(self.patents, key=lambda d: (-self.patents[d].week.toordinal(), d))
        self._rank = lru_cache(maxsize=128)(self._rank_uncached)

    # --- Step 1: which patents does the query match? --------------------------------

    def _rank_uncached(self, query: str) -> tuple[Hit, ...]:
        return tuple(Hit(*hit) for hit in
                     top_patents(self.vectors, self.rows, query, docs=None, top_k=RESULT_SET_SIZE))

    def _browse_hit(self, doc: str) -> Hit:
        start = int(self.rows.starts[self.rows.position[doc]])  # first passage = the abstract
        return Hit(doc, None, start)

    # --- Step 2: which patents pass the filters? -------------------------------------

    def allowed(self, filters: Filters) -> set[str] | None:
        """Patents passing every active filter, or None when no filter is active."""
        sets = []
        if filters.classification:
            sets.append(self.filters.classification(filters.classification))
        if filters.week_from or filters.week_to:
            sets.append(self.filters.weeks(filters.week_from, filters.week_to))
        if filters.title:
            sets.append(self.filters.title(filters.title))
        if filters.keywords:
            sets.append(self.filters.keywords(filters.keywords))
        if not sets:
            return None
        sets.sort(key=len)  # intersect the smallest first; the result can only shrink
        result = set(sets[0])
        for s in sets[1:]:
            result &= s
        return result

    # --- Step 3: one consistent response ----------------------------------------------

    def search(self, query: str = "", filters: Filters | None = None, limit: int = 20, offset: int = 0) -> dict:
        start = time.perf_counter()
        filters = filters or Filters()
        query = query.strip()

        allowed = self.allowed(filters)
        t_filter = time.perf_counter()

        if query:
            hits = [h for h in self._rank(query) if allowed is None or h.doc_number in allowed]
        else:
            docs = self._browse_order if allowed is None else [d for d in self._browse_order if d in allowed]
            hits = [self._browse_hit(d) for d in docs]
        t_rank = time.perf_counter()

        matched = [h.doc_number for h in hits]
        facets = {"classification": self._classification_tree(matched), "weeks": self._week_counts(matched)}
        terms = set(tokenize(f"{query} {filters.keywords or ''}"))
        results = [self._result(h, terms) for h in hits[offset: offset + limit]]
        end = time.perf_counter()

        return {
            "query": query,
            "filters": filters.as_dict(),
            "total": len(hits),
            "result_set_size": RESULT_SET_SIZE if query else None,
            "results": results,
            "facets": facets,
            "timing_ms": {
                "filter": round((t_filter - start) * 1000, 3),
                "rank": round((t_rank - t_filter) * 1000, 3),  # ~0 when the query is cached
                "facets_and_results": round((end - t_rank) * 1000, 3),
                "total": round((end - start) * 1000, 3),
            },
        }

    def _result(self, hit: Hit, terms: set[str]) -> dict:
        patent = self.patents[hit.doc_number]
        passage = self.passages[hit.row]
        return {
            "doc_number": patent.doc_number,
            "title": patent.title,
            "title_spans": highlight_spans(patent.title, terms),
            "classification": patent.classification,
            "classification_levels": self.filters.levels_by_doc[patent.doc_number],
            "week": patent.week.isoformat(),
            "score": None if hit.score is None else round(hit.score, 4),
            "match": {
                "kind": passage.kind,
                "number": passage.number,
                "text": passage.text,
                "spans": highlight_spans(passage.text, terms),
            },
        }

    def _classification_tree(self, docs: list[str]) -> list[dict]:
        """Nested counts, e.g. B (100) > B60 (100) > B60B (40) > B60B 27 (6)."""
        counts: Counter[str] = Counter()
        children: dict[str | None, set[str]] = defaultdict(set)
        for doc in docs:
            parent = None
            for level in self.filters.levels_by_doc[doc]:
                counts[level] += 1
                children[parent].add(level)
                parent = level

        def build(code: str) -> dict:
            kids = sorted(children.get(code, ()), key=lambda c: (-counts[c], c))
            return {"code": code, "count": counts[code], "children": [build(k) for k in kids]}

        return [build(code) for code in sorted(children[None], key=lambda c: (-counts[c], c))]

    def _week_counts(self, docs: list[str]) -> list[dict]:
        """Every week in the dataset, including empty ones, so the timeline never shifts."""
        counts = Counter(self.filters.week_by_doc[d] for d in docs)
        return [{"week": w.isoformat(), "count": counts.get(w, 0)} for w in self.all_weeks]

    # --- Hybrid search strategies (used by benchmark.py for Part 1's timing) -----------

    def filtered_top_k(self, query: str | np.ndarray, filters: Filters, k: int = 10,
                       strategy: Literal["auto", "pre", "post", "mask"] = "auto") -> list[Hit]:
        """Top k patents that pass the filters, using one of four strategies.

        pre:  filter first, then score only the candidates' passages. Fastest when filters are
              selective, but copying the candidates' rows costs more than it saves when they're broad.
        post: score everything, take the top k x OVERFETCH patents, then filter. As fast as no
              filter, but can return FEWER than k results when filters are selective.
        mask: score everything, then rule out patents that fail the filters before ranking.
              Always complete, and costs about the same as an unfiltered search.
        auto: pre when filters keep under PRE_FILTER_MAX_FRACTION of patents, otherwise mask.
        """
        allowed = self.allowed(filters)
        if allowed is None:
            return [Hit(*h) for h in top_patents(self.vectors, self.rows, query, top_k=k)]
        if strategy == "auto":
            strategy = "pre" if len(allowed) < PRE_FILTER_MAX_FRACTION * len(self.patents) else "mask"
        if strategy == "pre":
            return [Hit(*h) for h in top_patents(self.vectors, self.rows, query, docs=allowed, top_k=k)]
        if strategy == "post":
            fetched = top_patents(self.vectors, self.rows, query, top_k=k * POST_FILTER_OVERFETCH)
            return [Hit(*h) for h in fetched if h[0] in allowed][:k]
        return self._masked_top_k(query, allowed, k)

    def _masked_top_k(self, query: str | np.ndarray, allowed: set[str], k: int) -> list[Hit]:
        query_vector = query if isinstance(query, np.ndarray) else self.vectors.embed_query(query)
        scores = self.vectors.score_rows(query_vector)  # every passage, no row copying
        best = best_per_patent(scores, self.rows.starts)
        keep = np.zeros(len(best), dtype=bool)
        keep[[self.rows.position[d] for d in allowed if d in self.rows.position]] = True
        best = np.where(keep, best, -np.inf)  # patents failing the filters can never rank
        k = min(k, int(keep.sum()))
        if k == 0:
            return []
        top = np.argsort(-best, kind="stable")[:k]  # same tie-breaking as top_patents
        hits = []
        for i in top:
            start, end = int(self.rows.starts[i]), int(self.rows.ends[i])
            hits.append(Hit(self.rows.order[i], float(best[i]), start + int(np.argmax(scores[start:end]))))
        return hits


if __name__ == "__main__":
    from loader import load_patents
    from passages import build_passages

    patents = load_patents()
    engine = SearchEngine(patents, build_passages(patents))

    def show(response: dict) -> None:
        top = response["facets"]["classification"][0] if response["facets"]["classification"] else None
        print(f"  total={response['total']}  timing={response['timing_ms']}")
        if top:
            print("  classification:", [(c["code"], c["count"]) for c in top["children"][0]["children"]])
        for r in response["results"][:3]:
            m = r["match"]
            words = [m["text"][s:e] for s, e in m["spans"]][:6]
            print(f"   {r['score']}  {r['doc_number']}  {r['title'][:40]!r}  {m['kind']} {m['number']}  highlights={words}")

    print("\nBrowse mode (no query, no filters):")
    show(engine.search())

    query = "bicycle spoke made by injection molding"
    print(f"\nQuery {query!r}:")
    first = engine.search(query)
    show(first)

    b60b = next(c["count"] for c in first["facets"]["classification"][0]["children"][0]["children"] if c["code"] == "B60B")
    print(f"\nClick B60B (count shown: {b60b}):")
    clicked = engine.search(query, Filters(classification="B60B"))
    show(clicked)
    print(f"  count shown == results after clicking: {b60b == clicked['total']}")

    print("\nNew query keeps the B60B filter:")
    show(engine.search("tire tread with sipes", Filters(classification="B60B")))