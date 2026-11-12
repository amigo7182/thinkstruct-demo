"""Search indexes.

- FilterIndex:  metadata (classification, week, title) and keywords (title + abstract) -> patents
- PassageRows:  which rows of the embedding matrix belong to which patent
- VectorIndex:  one embedding per passage, cached on disk, scored by cosine similarity
"""
import hashlib
import json
import re
import time
from collections import defaultdict
from collections.abc import Iterable
from datetime import date
from pathlib import Path

import numpy as np

from models import UNCLASSIFIED, Passage, Patent

# --- Classification codes ------------------------------------------------------

# "B60B2700FI" = section B, class 60, subclass B, group digits 2700, suffix FI
_CODE = re.compile(r"^([A-H])(\d{2})([A-Z])(\d+)([A-Z]{2})?$")


def classification_levels(code: str) -> list[str]:
    """Every level of a code, broadest first: ["B", "B60", "B60B", "B60B 27"].

    The source codes have no separator between main group and subgroup, so the main
    group is a heuristic: 1 digit when there are 3 digits ("104" -> 1/04), otherwise
    2 digits ("2700" -> 27/00, "11032" -> 11/032). B60 main groups never exceed 2 digits.
    """
    match = _CODE.match(code or "")
    if not match:
        return [UNCLASSIFIED]
    section, cls, subclass, digits, _suffix = match.groups()
    main_group = digits[:1] if len(digits) <= 3 else digits[:2]
    return [section, f"{section}{cls}", f"{section}{cls}{subclass}",
            f"{section}{cls}{subclass} {int(main_group)}"]


def normalize_prefix(prefix: str) -> str:
    """Accept "b60b", "B60B 27" or "B60B27" and return the label used in the index."""
    compact = prefix.replace(" ", "").upper()
    return compact if len(compact) <= 4 else f"{compact[:4]} {int(compact[4:])}"


# --- Text normalization --------------------------------------------------------

# Common English words plus patent boilerplate that appears in almost every patent
# (e.g. "wherein" is in 96% of them). Negations are deliberately kept: "with a valve"
# and "without a valve" mean opposite things.
STOP_WORDS = frozenset("""
a an and are as at be by for from has have in into is it its of on or that the their
then there these this those to was were which with
wherein whereby thereof therein thereon claim claims comprising comprises comprise
including includes having said least according configured plurality
""".split())

_WORD = re.compile(r"[a-z0-9]+")


def normalize_word(word: str) -> str:
    """Very light plural folding so "spokes" matches "spoke" ("axis", "glass" unchanged)."""
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def tokenize(text: str) -> list[str]:
    """Lowercase words with stop words removed and plurals folded."""
    return [normalize_word(w) for w in _WORD.findall(text.lower()) if w not in STOP_WORDS]


def normalize_title(title: str) -> str:
    return " ".join(title.lower().split())


# --- Metadata and keyword filters ----------------------------------------------


class FilterIndex:
    """Each method returns the set of document numbers that pass one filter."""

    def __init__(self, patents: list[Patent]):
        self.all_docs: set[str] = {p.doc_number for p in patents}
        self.levels_by_doc: dict[str, list[str]] = {}
        self.week_by_doc: dict[str, date] = {}
        self._by_level: dict[str, set[str]] = defaultdict(set)
        self._by_week: dict[date, set[str]] = defaultdict(set)
        self._by_title: dict[str, set[str]] = defaultdict(set)
        self._by_word: dict[str, set[str]] = defaultdict(set)

        for p in patents:
            levels = classification_levels(p.classification)
            self.levels_by_doc[p.doc_number] = levels
            self.week_by_doc[p.doc_number] = p.week
            for level in levels:
                self._by_level[level].add(p.doc_number)
            self._by_week[p.week].add(p.doc_number)
            self._by_title[normalize_title(p.title)].add(p.doc_number)
            for word in set(tokenize(f"{p.title} {p.abstract}")):
                self._by_word[word].add(p.doc_number)

    def classification(self, prefix: str) -> set[str]:
        """Patents under a classification prefix at any level, e.g. "B60", "B60B", "B60B 27"."""
        label = UNCLASSIFIED if prefix == UNCLASSIFIED else normalize_prefix(prefix)
        return set(self._by_level.get(label, set()))

    def weeks(self, start: date | None = None, end: date | None = None) -> set[str]:
        """Patents published between start and end (inclusive). Either end may be open."""
        return {
            doc
            for week, docs in self._by_week.items()
            if (start is None or week >= start) and (end is None or week <= end)
            for doc in docs
        }

    def title(self, title: str) -> set[str]:
        """Patents whose title matches exactly (ignoring case and extra spaces)."""
        return set(self._by_title.get(normalize_title(title), set()))

    def keywords(self, text: str) -> set[str]:
        """Patents whose title or abstract contains ALL the keywords.

        Stop words are ignored, so a query of only stop words places no constraint.
        """
        words = set(tokenize(text))
        if not words:
            return set(self.all_docs)
        # Intersect the smallest sets first: the result can only shrink.
        sets = sorted((self._by_word.get(w, set()) for w in words), key=len)
        result = set(sets[0])
        for s in sets[1:]:
            result &= s
        return result


# --- Mapping between patents and embedding rows --------------------------------


class PassageRows:
    """Passages are built patent by patent, so each patent owns one contiguous block of rows."""

    def __init__(self, passages: list[Passage]):
        self.order: list[str] = []  # doc numbers in row order
        self.position: dict[str, int] = {}
        starts = []
        for row, passage in enumerate(passages):
            if not self.order or self.order[-1] != passage.doc_number:
                if passage.doc_number in self.position:
                    raise ValueError(f"Passages of {passage.doc_number} are not contiguous")
                self.position[passage.doc_number] = len(self.order)
                self.order.append(passage.doc_number)
                starts.append(row)
        self.starts = np.array(starts, dtype=np.int64)
        self.ends = np.append(self.starts[1:], len(passages))
        self._all_rows = np.arange(len(passages), dtype=np.int64)  # the no-filter case, computed once

    def rows_for(self, docs: Iterable[str] | None = None) -> tuple[np.ndarray, np.ndarray, list[str]]:
        """Embedding rows for the given patents (all patents if None).

        Returns (rows, offsets, doc_numbers): `offsets[i]` is where patent i's block starts
        inside `rows`, which is exactly what np.maximum.reduceat needs.
        """
        if docs is None:
            return self._all_rows, self.starts, self.order
        idx = np.array(sorted(self.position[d] for d in docs if d in self.position), dtype=np.int64)
        if len(idx) == 0:
            empty = np.array([], dtype=np.int64)
            return empty, empty, []
        lengths = self.ends[idx] - self.starts[idx]
        offsets = np.concatenate(([0], np.cumsum(lengths)[:-1]))
        # Row j of patent i is starts[i] + (j - offsets[i]); built for all patents at once.
        rows = np.arange(lengths.sum()) + np.repeat(self.starts[idx] - offsets, lengths)
        return rows, offsets, [self.order[i] for i in idx]


def best_per_patent(scores: np.ndarray, offsets: np.ndarray) -> np.ndarray:
    """Each patent's best passage score, computed for all patents at once (no Python loop)."""
    if len(offsets) == 0:
        return np.array([], dtype=scores.dtype)
    return np.maximum.reduceat(scores, offsets)


# --- Vector index ----------------------------------------------------------------

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
BATCH_SIZE = 64
CACHE_DIR = Path(__file__).parent / "cache"
EMBEDDINGS_PATH = CACHE_DIR / "embeddings.npy"
INFO_PATH = CACHE_DIR / "embeddings.json"


def load_model():
    """Load the embedding model (imported here so tests can use a fake model without PyTorch)."""
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL_NAME)


def fingerprint(passages: list[Passage]) -> str:
    """A hash of the model name and every passage. If anything changes, the hash changes."""
    digest = hashlib.sha256(MODEL_NAME.encode())
    for p in passages:
        digest.update(f"{p.doc_number}|{p.kind}|{p.number}|{p.text}\n".encode())
    return digest.hexdigest()


class VectorIndex:
    """Row i of `embeddings` is the embedding of `passages[i]`."""

    def __init__(self, passages: list[Passage], model=None, embeddings: np.ndarray | None = None):
        """Pass `embeddings` to skip the disk cache (used by tests and the scale benchmark)."""
        self.passages = passages
        self.model = model if model is not None else load_model()
        if embeddings is not None and len(embeddings) != len(passages):
            raise ValueError("embeddings must have one row per passage")
        self.embeddings = embeddings if embeddings is not None else self._load_or_build()

    def _load_or_build(self) -> np.ndarray:
        expected = fingerprint(self.passages)
        if EMBEDDINGS_PATH.exists() and INFO_PATH.exists():
            info = json.loads(INFO_PATH.read_text())
            if info.get("fingerprint") == expected:
                print(f"Loaded cached embeddings ({info['count']} passages)")
                return np.load(EMBEDDINGS_PATH)
            print("Cache is stale (passages or model changed); rebuilding embeddings")
        return self._build(expected)

    def _build(self, expected_fingerprint: str) -> np.ndarray:
        texts = [p.text for p in self.passages]
        start = time.perf_counter()
        embeddings = self.model.encode(
            texts,
            batch_size=BATCH_SIZE,
            normalize_embeddings=True,  # unit length, so a dot product is the cosine similarity
            convert_to_numpy=True,
            show_progress_bar=True,
        ).astype(np.float32)
        seconds = time.perf_counter() - start

        info = {
            "fingerprint": expected_fingerprint,
            "model": MODEL_NAME,
            "device": str(getattr(self.model, "device", "unknown")),
            "count": len(texts),
            "dimensions": int(embeddings.shape[1]),
            "seconds": round(seconds, 2),
            "passages_per_second": round(len(texts) / seconds, 1),
        }
        CACHE_DIR.mkdir(exist_ok=True)
        np.save(EMBEDDINGS_PATH, embeddings)
        INFO_PATH.write_text(json.dumps(info, indent=2))
        print(f"Embedded {info['count']} passages in {info['seconds']} s "
              f"({info['passages_per_second']} passages/s on {info['device']})")
        return embeddings

    def embed_query(self, text: str) -> np.ndarray:
        return self.model.encode(text, normalize_embeddings=True, convert_to_numpy=True).astype(np.float32)

    def score_rows(self, query_vector: np.ndarray, rows: np.ndarray | None = None) -> np.ndarray:
        """Cosine similarity of the query with the given rows (all rows if None)."""
        candidates = self.embeddings if rows is None else self.embeddings[rows]
        return candidates @ query_vector

    def search(self, query: str, top_k: int = 10, rows: np.ndarray | None = None) -> list[tuple[int, float]]:
        """Return (passage row, score) pairs, best first. `rows` limits the search to candidates."""
        scores = self.score_rows(self.embed_query(query), rows)
        k = min(top_k, len(scores))
        if k == 0:
            return []
        top = np.argpartition(-scores, k - 1)[:k]  # the k best, unordered (faster than a full sort)
        top = top[np.argsort(-scores[top])]  # now order just those k
        row_ids = top if rows is None else rows[top]
        return [(int(row), float(scores[i])) for row, i in zip(row_ids, top)]


def top_patents(vectors: VectorIndex, passage_rows: PassageRows, query: str | np.ndarray,
                docs: set[str] | None = None, top_k: int = 10) -> list[tuple[str, float, int]]:
    """Rank patents by their best passage. Returns (doc_number, score, best passage row).

    `query` can be text or an already-embedded query vector (the benchmark embeds once).
    """
    rows, offsets, doc_order = passage_rows.rows_for(docs)
    if len(rows) == 0:
        return []
    query_vector = query if isinstance(query, np.ndarray) else vectors.embed_query(query)
    # With no filter, score the whole matrix directly: indexing it with `rows` would copy
    # every embedding first (about 5x slower here).
    scores = vectors.score_rows(query_vector, None if docs is None else rows)
    best = best_per_patent(scores, offsets)
    k = min(top_k, len(best))
    top = np.argsort(-best, kind="stable")[:k]  # stable: ties keep patent order, so results are repeatable
    results = []
    for i in top:
        start = offsets[i]
        end = offsets[i + 1] if i + 1 < len(offsets) else len(rows)
        best_row = int(rows[start + np.argmax(scores[start:end])])  # which passage matched
        results.append((doc_order[i], float(best[i]), best_row))
    return results


if __name__ == "__main__":
    from loader import load_patents
    from passages import build_passages

    patents = load_patents()
    passages = build_passages(patents)
    filters = FilterIndex(patents)
    passage_rows = PassageRows(passages)
    vectors = VectorIndex(passages)

    print(f"\nB60B patents: {len(filters.classification('B60B'))}")
    print(f"Title 'tire': {len(filters.title('tire'))} patents")
    print(f"Keywords 'bicycle spoke': {len(filters.keywords('bicycle spoke'))} patents")

    query = "bicycle spoke made by injection molding"
    print(f"\nTop 5 patents for {query!r} (no filters):")
    for doc, score, row in top_patents(vectors, passage_rows, query, top_k=5):
        p = passages[row]
        print(f"  {score:.3f}  {doc}  best match: {p.kind} {p.number}")

    docs = filters.classification("B60B") & filters.keywords("bicycle")
    print(f"\nSame query, filtered to B60B + keyword 'bicycle' ({len(docs)} candidates):")
    for doc, score, row in top_patents(vectors, passage_rows, query, docs=docs, top_k=5):
        p = passages[row]
        print(f"  {score:.3f}  {doc}  best match: {p.kind} {p.number}")