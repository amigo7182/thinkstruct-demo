"""Tests for turning patents into searchable passages."""

import pytest

from loader import load_patents
from passages import MAX_WORDS, OVERLAP, WINDOW_SIZE, build_passages, split_into_windows


@pytest.fixture(scope="module")
def patents():
    return load_patents()


@pytest.fixture(scope="module")
def passages(patents):
    return build_passages(patents)


def test_short_text_stays_whole():
    assert split_into_windows("a short claim") == ["a short claim"]


def test_long_text_is_split_into_overlapping_windows():
    words = [f"w{i}" for i in range(400)]
    windows = [w.split() for w in split_into_windows(" ".join(words))]

    assert all(len(w) <= WINDOW_SIZE for w in windows)
    assert (
        windows[0][0] == "w0" and windows[-1][-1] == "w399"
    )  # nothing lost at the ends
    for left, right in zip(windows, windows[1:]):
        assert left[-OVERLAP:] == right[:OVERLAP]  # neighbours share 30 words


def test_passage_count(passages):
    assert len(passages) == 36125


def test_no_passage_is_too_long_for_the_model(passages):
    assert max(len(p.text.split()) for p in passages) <= MAX_WORDS


def test_first_passage_is_the_abstract(patents, passages):
    first = passages[0]
    assert (first.doc_number, first.kind, first.number) == (
        patents[0].doc_number,
        "abstract",
        1,
    )
