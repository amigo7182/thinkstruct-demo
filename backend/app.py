"""HTTP API for the search engine (FastAPI).

Run:   uv run uvicorn app:app --reload
Docs:  http://127.0.0.1:8000/docs   (interactive: try every parameter in the browser)
"""
import os
import threading
import time
from collections.abc import Callable
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from loader import load_patents
from passages import build_passages
from search import Filters, SearchEngine

# The Vite dev server's address. Override with FRONTEND_ORIGINS="http://a,http://b".
FRONTEND_ORIGINS = os.environ.get("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")

# The first embedding on a GPU (Apple MPS) takes hundreds of milliseconds while PyTorch prepares
# its kernels, and new input lengths can trigger more. Running a few queries of different
# lengths at startup means real users only ever see the warmed-up speed.
WARMUP_QUERIES = [
    "wheel",
    "bicycle spoke made by injection molding",
    "a pneumatic tire having a tread with circumferential grooves and sipes that improve wet grip",
]

# Accepts any classification level: "B", "B60", "B60B", "B60B 27" / "B60B27", or "Unclassified".
# An empty value is allowed and means "no classification filter".
CLASSIFICATION_PATTERN = r"^([A-Ha-h](\d{2}([A-Za-z]( ?\d{1,4})?)?)?|Unclassified)?$"


# --- Response shapes (Pydantic validates them and generates the /docs page) -------


class Match(BaseModel):
    kind: str  # "abstract", "claim" or "paragraph"
    number: int  # claim number or original paragraph number
    text: str
    spans: list[tuple[int, int]]  # [start, end) characters to highlight in `text`


class Result(BaseModel):
    doc_number: str
    title: str
    title_spans: list[tuple[int, int]]
    classification: str
    classification_levels: list[str]
    week: date
    score: float | None  # None in browse mode (no query)
    match: Match


class ClassificationNode(BaseModel):
    code: str
    count: int
    children: list["ClassificationNode"]


class WeekCount(BaseModel):
    week: date
    count: int


class Facets(BaseModel):
    classification: list[ClassificationNode]
    weeks: list[WeekCount]  # every week in the dataset, including empty ones


class AppliedFilters(BaseModel):
    classification: str | None
    week_from: date | None
    week_to: date | None
    title: str | None
    keywords: str | None


class SearchResponse(BaseModel):
    request_id: int | None  # echoed back so the client can tell which request this answers
    query: str
    filters: AppliedFilters
    total: int
    result_set_size: int | None
    results: list[Result]
    facets: Facets
    timing_ms: dict[str, float]


class Health(BaseModel):
    status: str
    patents: int
    passages: int
    first_week: date
    last_week: date


# --- App ---------------------------------------------------------------------------


def build_engine() -> SearchEngine:
    patents = load_patents()
    return SearchEngine(patents, build_passages(patents))


def create_app(engine_factory: Callable[[], SearchEngine] = build_engine) -> FastAPI:
    """Tests pass a factory that builds the engine with a fake model."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        engine = engine_factory()
        for query in WARMUP_QUERIES:
            engine.vectors.embed_query(query)
        app.state.engine = engine
        # FastAPI runs requests on several threads; PyTorch models aren't guaranteed to be
        # safe to call from many threads at once on a GPU, so searches run one at a time.
        # Filter-only searches take under a millisecond, so this costs almost nothing.
        app.state.lock = threading.Lock()
        yield

    app = FastAPI(title="Patent search", version="1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=FRONTEND_ORIGINS, allow_methods=["GET"], allow_headers=["*"])

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse("/docs")  # opening the server's address shows the API docs

    @app.get("/health", response_model=Health)
    def health(request: Request) -> dict:
        engine: SearchEngine = request.app.state.engine
        return {
            "status": "ok",
            "patents": len(engine.patents),
            "passages": len(engine.passages),
            "first_week": engine.all_weeks[0],
            "last_week": engine.all_weeks[-1],
        }

    @app.get("/search", response_model=SearchResponse)
    def search(
        request: Request,
        q: str = Query("", description="Natural-language query; empty means browse mode"),
        classification: str | None = Query(None, pattern=CLASSIFICATION_PATTERN, examples=["B60B"]),
        week_from: date | None = Query(None, description="Inclusive, YYYY-MM-DD"),
        week_to: date | None = Query(None, description="Inclusive, YYYY-MM-DD"),
        title: str | None = Query(None, description="Exact title, ignoring case and spacing"),
        keywords: str | None = Query(None, description="All words must appear in the title or abstract"),
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
        request_id: int | None = Query(None, description="Echoed back unchanged"),
        delay_ms: int = Query(0, ge=0, le=5000, description="TESTING ONLY: wait before answering, "
                              "to check the interface never shows stale results"),
    ) -> dict:
        if week_from and week_to and week_from > week_to:
            raise HTTPException(status_code=422, detail="week_from must be on or before week_to")

        filters = Filters(classification=classification or None, week_from=week_from, week_to=week_to,
                          title=title or None, keywords=keywords or None)
        with request.app.state.lock:
            response = request.app.state.engine.search(q, filters, limit=limit, offset=offset)
        if delay_ms:
            time.sleep(delay_ms / 1000)  # outside the lock, so a slow request doesn't block others
        response["request_id"] = request_id
        return response

    return app


app = create_app()