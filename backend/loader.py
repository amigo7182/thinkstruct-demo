import re
from datetime import datetime, date
from pathlib import Path
import json
from collections.abc import Iterator
from models import Patent, UNCLASSIFIED, UNTITLED, Paragraph, Claim

DATA_DIR = Path(__file__).parent / "data" / "patent_data_small"
_WORD_FIG = re.compile(r"(?<=[a-z.])(?=FIGS?\b)")  # to|FIGS
_FIG_NUMBER = re.compile(r"(?:(?<=\bFIG\.)|(?<=\bFIGS\.))(?=\d)")  # FIGS.|2
_LETTER_DIGIT = re.compile(r"(?<=[A-Za-z])(?=\d)")  # element|120
_DIGIT_LETTER = re.compile(
    r"(?<=\d)(?=[A-Za-z])(?!(?:st|nd|rd|th)\b)"
)  # 120|and, keeps "1st"
CANCELED = re.compile(r"\(cancell?ed\)", re.IGNORECASE)
NUMBER = re.compile(r"\d+")
NUMBERED = re.compile(r"\s*(\d+)\s*\.(?!\d)\s*")


def fix_spacing(text: str) -> str:
    for pattern in (_WORD_FIG, _FIG_NUMBER, _LETTER_DIGIT, _DIGIT_LETTER):
        text = pattern.sub(" ", text)
    return text


def path_to_week(path: Path) -> date:
    digits = path.name.removeprefix("patents_ipa").removesuffix(".json")
    week = datetime.strptime(digits, "%y%m%d").date()
    return week


def read_records() -> Iterator[tuple[dict, date]]:
    files = sorted(DATA_DIR.glob("patents_ipa*.json"))
    for path in files:
        week = path_to_week(path)
        records = json.loads(path.read_text(encoding="utf-8"))
        for record in records:
            yield (record, week)


def clean_paragraphs(paragraphs: list[str]) -> list[Paragraph]:
    new_paragraphs = []
    for number, text in enumerate(paragraphs, start=1):
        paragraph = (fix_spacing(text) or "").strip()
        if not paragraph:
            continue
        new_paragraph = Paragraph(number=number, text=paragraph)
        new_paragraphs.append(new_paragraph)
    return new_paragraphs


def clean_claims(claims: list[str], doc_number: str) -> list[Claim]:
    cleaned = []
    last_number = 0
    for raw in claims:
        text = (raw or "").strip()
        if not text:
            continue

        # Canceled claims ("1 - 15 . (canceled)"): remember the last number, then skip
        canceled = CANCELED.search(text)
        if canceled:
            numbers = NUMBER.findall(text[: canceled.start()])
            if numbers:
                last_number = int(numbers[-1])
            continue

        # Numbered claims ("2 . The spoke..."): trust the written number, drop the prefix
        numbered = NUMBERED.match(text)
        if numbered:
            number = int(numbered.group(1))
            text = text[numbered.end() :]
        else:
            # Unnumbered claims lost their "N ." prefix in the source data
            number = last_number + 1

        if number != last_number + 1:
            print(
                f"Warning: {doc_number}: claim numbering jumps from {last_number} to {number}"
            )

        cleaned.append(Claim(number=number, text=text))
        last_number = number
    return cleaned


def record_to_patent(record: dict, week: date) -> Patent | None:

    if (
        not record.get("claims")
        and not record.get("abstract")
        and not record.get("detailed_description")
        or not record.get("doc_number")
    ):
        return None

    title = record.get("title") or UNTITLED
    doc_number = record.get("doc_number")
    abstract = record.get("abstract") or ""
    classification = record.get("classification") or UNCLASSIFIED
    bibtex = record.get("bibtex") or ""
    paragraphs = clean_paragraphs(record.get("detailed_description") or [])
    claims = claims = clean_claims(record.get("claims") or [], doc_number)

    patent = Patent(
        title=title,
        doc_number=doc_number,
        abstract=abstract,
        paragraphs=paragraphs,
        bibtex=bibtex,
        classification=classification,
        claims=claims,
        week=week,
    )
    return patent


def load_patents() -> list[Patent]:
    patents = []
    for record, week in read_records():
        patent = record_to_patent(record=record, week=week)
        if patent is not None:
            patents.append(patent)
    return patents
