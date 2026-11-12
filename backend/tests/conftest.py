"""Shared test helpers. pytest loads this file automatically."""
import zlib

import numpy as np
import pytest

from index import VectorIndex, tokenize
from loader import load_patents
from passages import build_passages
from search import SearchEngine


class FakeModel:
    """Bag-of-words "embeddings": fast, no download, and never touches the real cache."""

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


@pytest.fixture(scope="session")
def fake_engine() -> SearchEngine:
    patents = load_patents()
    passages = build_passages(patents)
    model = FakeModel()
    vectors = VectorIndex(passages, model=model, embeddings=model.encode([p.text for p in passages]))
    return SearchEngine(patents, passages, vectors=vectors)
