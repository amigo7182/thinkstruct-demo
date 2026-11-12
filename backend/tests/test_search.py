"""Tests for the search engine's guarantees, using a tiny fake embedding model.

The fake model turns text into a bag-of-words vector, so these tests run in seconds,
need no download, and never touch the real embedding cache on disk.
"""
import zlib
from datetime import date

import numpy as np
import pytest

from index import VectorIndex, normalize_word, tokenize
from loader import load_patents
from passages import build_passages
from search import RESULT_SET_SIZE, Filters, SearchEngine

QUERY = "bicycle spoke made by injection molding"


class FakeModel:
    device = "fake"

    def encode(self, texts, **kwargs):
        single = isinstance(texts, str)
        vectors = []
        for text in [texts] if single else texts:
            v = np.zeros(384, dtype=np.float32)
            for word in tokenize(text):
                v[zlib.crc32(word.encode()) % 384] += 1
            vectors.append(v / (np.linalg.norm(v) or 1))
        array = np.array(vectors, dtype=np.float32)
        return array[0] if single else array


@pytest.fixture(scope="module")
def engine():
    patents = load_patents()
    passages = build_passages(patents)
    model = FakeModel()
    vectors = VectorIndex(passages, model=model, embeddings=model.encode([p.text for p in passages]))
    return SearchEngine(patents, passages, vectors=vectors)


def subclass_nodes(response):
    """The B60x buckets of a response's classification tree."""
    return response["facets"]["classification"][0]["children"][0]["children"]


def test_browse_mode_returns_every_patent_newest_first(engine):
    response = engine.search(limit=640)
    weeks = [r["week"] for r in response["results"]]
    assert response["total"] == 640
    assert weeks == sorted(weeks, reverse=True)


def test_query_result_set_is_capped(engine):
    assert engine.search(QUERY)["total"] == RESULT_SET_SIZE


@pytest.mark.parametrize(
    "filters",
    [Filters(), Filters(classification="B60B"), Filters(keywords="bicycle"),
     Filters(classification="B60C", week_from=date(2024, 6, 1), week_to=date(2024, 12, 31))],
)
def test_all_counts_add_up_to_the_total(engine, filters):
    response = engine.search(QUERY, filters)
    total = response["total"]
    assert sum(w["count"] for w in response["facets"]["weeks"]) == total
    assert sum(node["count"] for node in response["facets"]["classification"]) == total


def test_clicking_a_classification_gives_exactly_its_count(engine):
    for node in subclass_nodes(engine.search(QUERY)):
        assert engine.search(QUERY, Filters(classification=node["code"]))["total"] == node["count"]


def test_clicking_a_week_gives_exactly_its_count(engine):
    week = next(w for w in engine.search(QUERY)["facets"]["weeks"] if w["count"] > 0)
    day = date.fromisoformat(week["week"])
    assert engine.search(QUERY, Filters(week_from=day, week_to=day))["total"] == week["count"]


def test_timeline_always_lists_every_week(engine):
    response = engine.search(QUERY, Filters(classification="B60D"))
    assert len(response["facets"]["weeks"]) == 64


def test_every_result_passes_the_filters(engine):
    filters = Filters(classification="B60B", keywords="bicycle")
    allowed = engine.allowed(filters)
    response = engine.search(QUERY, filters, limit=100)
    assert response["results"]
    assert all(r["doc_number"] in allowed for r in response["results"])


def test_new_query_keeps_the_filters(engine):
    filters = Filters(classification="B60C")
    response = engine.search("tire tread with sipes", filters, limit=100)
    assert response["filters"]["classification"] == "B60C"
    assert all(r["classification"].startswith("B60C") for r in response["results"])


def test_highlights_point_at_matching_words(engine):
    terms = set(tokenize(QUERY))
    for result in engine.search(QUERY)["results"]:
        text = result["match"]["text"]
        assert all(normalize_word(text[s:e].lower()) in terms for s, e in result["match"]["spans"])


def test_repeated_query_is_served_from_the_cache(engine):
    engine.search("wheel hub bearing")
    hits_before = engine._rank.cache_info().hits
    engine.search("wheel hub bearing", Filters(classification="B60B"))  # filter change only
    assert engine._rank.cache_info().hits == hits_before + 1


@pytest.mark.parametrize("filters", [Filters(classification="B60C"), Filters(classification="B60B", keywords="bicycle")])
def test_filtering_strategies(engine, filters):
    allowed = engine.allowed(filters)
    pre = engine.filtered_top_k(QUERY, filters, strategy="pre")
    mask = engine.filtered_top_k(QUERY, filters, strategy="mask")
    post = engine.filtered_top_k(QUERY, filters, strategy="post")
    assert [(h.doc_number, h.row) for h in pre] == [(h.doc_number, h.row) for h in mask]  # both exact
    assert len(pre) == 10
    assert len(post) <= 10 and all(h.doc_number in allowed for h in post)  # can fall short