from datetime import date
from dataclasses import dataclass
from typing import Literal

UNCLASSIFIED = "Unclassified"
UNTITLED = "Untitled"


@dataclass
class Claim:
    number: int
    text: str


@dataclass
class Paragraph:
    number: int
    text: str


@dataclass
class Patent:
    title: str
    doc_number: str
    abstract: str
    paragraphs: list[Paragraph]
    bibtex: str
    classification: str

    @property
    def subclass(self) -> str:
        return (
            self.classification[:4]
            if self.classification != UNCLASSIFIED
            else UNCLASSIFIED
        )

    claims: list[Claim]
    week: date


PassageKind = Literal["abstract", "claim", "paragraph"]


@dataclass
class Passage:
    doc_number: int
    kind: PassageKind
    number: int
    text: str
