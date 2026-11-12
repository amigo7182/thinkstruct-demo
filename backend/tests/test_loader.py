"""Tests for loading and cleaning the patent data."""
from datetime import date
from pathlib import Path

import pytest

from loader import (
    clean_claims,
    clean_paragraphs,
    fix_spacing,
    load_patents,
    path_to_week,
    record_to_patent,
)
from models import UNCLASSIFIED, UNTITLED

WEEK = date(2024, 2, 15)


@pytest.fixture(scope="module")
def patents():
    """Load the dataset once and share it across all tests in this file."""
    return load_patents()


# --- Small unit tests: one function, hand-made input ---------------------------


def test_path_to_week():
    assert path_to_week(Path("patents_ipa240215.json")) == date(2024, 2, 15)


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("element120and", "element 120 and"),
        ("refer toFIGS.2,3and4together", "refer to FIGS. 2,3 and 4 together"),
        ("the 1st and 2nd wheels", "the 1st and 2nd wheels"),  # ordinals untouched
        ("a 2.5 mm gap", "a 2.5 mm gap"),  # decimals untouched
        ("1,000 rpm", "1,000 rpm"),  # thousands untouched
    ],
)
def test_fix_spacing(raw, expected):
    assert fix_spacing(raw) == expected


def test_clean_paragraphs_drops_empty_and_keeps_original_numbers():
    paragraphs = clean_paragraphs(["Intro.", "", "   ", "Second."])
    assert [(p.number, p.text) for p in paragraphs] == [(1, "Intro."), (4, "Second.")]


def test_clean_claims_handles_canceled_numbered_and_unnumbered():
    claims = clean_claims(
        [
            "1 - 3 . (canceled)",  # canceled range: numbering continues at 4
            "a wheel rim and a tire",  # unnumbered: inferred as claim 4
            "5 . The wheel of claim 4 , wherein the rim is steel.",  # numbered: prefix removed
        ],
        doc_number="TEST",
    )
    assert [c.number for c in claims] == [4, 5]
    assert claims[1].text == "The wheel of claim 4 , wherein the rim is steel."


def test_clean_claims_does_not_read_decimals_as_claim_numbers():
    claims = clean_claims(["1 . A rubber composition", "0.5 phr to 6.0 phr of accelerator"], "TEST")
    assert [c.number for c in claims] == [1, 2]
    assert claims[1].text.startswith("0.5 phr")


def test_record_without_searchable_text_is_skipped():
    record = {"doc_number": "1", "title": "Only a title"}
    assert record_to_patent(record, WEEK) is None


def test_record_without_doc_number_is_skipped():
    record = {"abstract": "A wheel.", "claims": ["1 . A wheel."]}
    assert record_to_patent(record, WEEK) is None


def test_missing_title_and_classification_get_placeholders():
    patent = record_to_patent({"doc_number": "1", "abstract": "A wheel."}, WEEK)
    assert patent.title == UNTITLED
    assert patent.classification == UNCLASSIFIED
    assert patent.subclass == UNCLASSIFIED


# --- Dataset tests: the real numbers measured during exploration ---------------


def test_loads_all_patents(patents):
    assert len(patents) == 640


def test_weeks(patents):
    weeks = {p.week for p in patents}
    assert len(weeks) == 64
    assert min(weeks) == date(2024, 2, 15)
    assert max(weeks) == date(2025, 5, 1)


def test_empty_paragraphs_are_dropped(patents):
    paragraphs = [para for p in patents for para in p.paragraphs]
    assert len(paragraphs) == 21221
    assert all(para.text for para in paragraphs)


def test_paragraphs_keep_original_positions(patents):
    assert [p.number for p in patents[0].paragraphs] == [1, 3, 5, 7, 9, 11, 13, 15]


def test_canceled_claims_are_dropped(patents):
    claims = [c for p in patents for c in p.claims]
    assert len(claims) == 10411
    assert not any("(canceled)" in c.text.lower() for c in claims)


def test_first_claim_number_is_inferred(patents):
    first = patents[0].claims[0]
    assert first.number == 1
    assert first.text.startswith("an axle body")