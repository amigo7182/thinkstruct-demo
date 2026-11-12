"""Turn clean patents into the passages we embed and search."""

from collections.abc import Iterator

from models import Passage, Patent

# all-MiniLM-L6-v2 reads at most 256 word pieces; patent text averages a bit
# over one word piece per word, so ~180 words is the safe limit for one passage.
MAX_WORDS = 180
WINDOW_SIZE = 150  # words per window when a passage is too long
OVERLAP = 30  # words shared by neighbouring windows, so no phrase is cut in half


def split_into_windows(text: str) -> list[str]:
    """Return the text unchanged if it fits, otherwise overlapping word windows."""
    words = text.split()
    if len(words) <= MAX_WORDS:
        return [text]

    windows = []
    step = WINDOW_SIZE - OVERLAP
    for start in range(0, len(words), step):
        windows.append(" ".join(words[start : start + WINDOW_SIZE]))
        if start + WINDOW_SIZE >= len(words):
            break  # this window already reaches the end of the text
    return windows


def patent_passages(patent: Patent) -> Iterator[Passage]:
    """Yield every searchable passage of one patent: abstract, claims, paragraphs."""
    sections = [("abstract", 1, patent.abstract)]
    sections += [("claim", c.number, c.text) for c in patent.claims]
    sections += [("paragraph", p.number, p.text) for p in patent.paragraphs]

    for kind, number, text in sections:
        if not text:
            continue  # e.g. a patent with no abstract
        for window in split_into_windows(text):
            yield Passage(
                doc_number=patent.doc_number, kind=kind, number=number, text=window
            )


def build_passages(patents: list[Patent]) -> list[Passage]:
    """All passages for all patents, in a stable order (needed to line up with embeddings)."""
    return [passage for patent in patents for passage in patent_passages(patent)]


if __name__ == "__main__":
    from collections import Counter

    from loader import load_patents

    patents = load_patents()
    passages = build_passages(patents)
    print(f"{len(passages)} passages from {len(patents)} patents")
    print(Counter(p.kind for p in passages))
    longest = max(passages, key=lambda p: len(p.text.split()))
    print(f"longest passage: {len(longest.text.split())} words")
