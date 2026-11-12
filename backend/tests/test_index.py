"""Tests for the filter indexes and the patent-to-row mapping (no embedding model needed)."""
from datetime import date

import numpy as np
import pytest

from index import (
    FilterIndex,
    PassageRows,
    best_per_patent,
    classification_levels,
    normalize_prefix,
    tokenize,
)
from loader import load_patents
from models import UNCLASSIFIED
from passages import build_passages


@pytest.fixture(scope="module")
def patents():
    return load_patents()


@pytest.fixture(scope="module")
def filters(patents):
    return FilterIndex(patents)


@pytest.fixture(scope="module")
def passages(patents):
    return build_passages(patents)


@pytest.mark.parametrize(
    "code, expected",
    [
        ("B60B2700FI", ["B", "B60", "B60B", "B60B 27"]),
        ("B60B104FI", ["B", "B60", "B60B", "B60B 1"]),
        ("B60C11032FI", ["B", "B60", "B60C", "B60C 11"]),
        (UNCLASSIFIED, [UNCLASSIFIED]),
    ],
)
def test_classification_levels(code, expected):
    assert classification_levels(code) == expected


def test_normalize_prefix_accepts_any_spacing_and_case():
    assert normalize_prefix("b60b") == "B60B"
    assert normalize_prefix("B60B27") == normalize_prefix("B60B 27") == "B60B 27"


def test_tokenize_drops_stop_words_and_folds_plurals():
    assert tokenize("The spokes, wherein the tires") == ["spoke", "tire"]
    assert tokenize("without a valve") == ["without", "valve"]  # negations are kept


def test_classification_filter(filters):
    assert len(filters.classification("B60")) == 640
    assert len(filters.classification("B60B")) == 298
    assert len(filters.classification("B60C")) == 318
    assert filters.classification("B60B 27") <= filters.classification("B60B")  # drill-down narrows


def test_title_filter_ignores_case_and_spacing(filters):
    assert len(filters.title("  TIRE ")) == 47


def test_keyword_filter(filters):
    assert filters.keywords("spokes") == filters.keywords("spoke")
    assert filters.keywords("bicycle spoke") <= filters.keywords("bicycle")  # AND only narrows
    assert len(filters.keywords("the wherein")) == 640  # only stop words: no constraint


def test_week_filter(filters):
    assert len(filters.weeks()) == 640
    assert len(filters.weeks(end=date(2024, 12, 31))) == 460


def test_rows_cover_every_passage_once(passages):
    rows, offsets, docs = PassageRows(passages).rows_for()
    assert list(rows) == list(range(len(passages)))
    assert len(docs) == 640


def test_rows_for_subset_only_returns_those_patents(passages):
    passage_rows = PassageRows(passages)
    wanted = set(passage_rows.order[:3])
    rows, offsets, docs = passage_rows.rows_for(wanted)
    assert set(docs) == wanted
    assert {passages[r].doc_number for r in rows} == wanted


def test_best_per_patent_matches_a_plain_loop(passages):
    passage_rows = PassageRows(passages)
    rows, offsets, docs = passage_rows.rows_for()
    scores = np.random.default_rng(0).random(len(rows)).astype(np.float32)

    expected = {}
    for row, score in zip(rows, scores):
        doc = passages[row].doc_number
        expected[doc] = max(expected.get(doc, -1.0), score)

    best = best_per_patent(scores, offsets)
    assert all(best[i] == expected[doc] for i, doc in enumerate(docs))