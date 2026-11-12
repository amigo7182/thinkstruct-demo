"""Tests for the HTTP API, run against the engine with a fake model (see conftest.py)."""
import pytest
from fastapi.testclient import TestClient

from app import create_app


@pytest.fixture(scope="module")
def client(fake_engine):
    with TestClient(create_app(engine_factory=lambda: fake_engine)) as client:  # `with` runs startup
        yield client


def test_health(client):
    body = client.get("/health").json()
    assert body["status"] == "ok"
    assert body["patents"] == 640
    assert (body["first_week"], body["last_week"]) == ("2024-02-15", "2025-05-01")


def test_browse_mode(client):
    body = client.get("/search").json()
    assert body["total"] == 640
    assert len(body["results"]) == 20
    assert len(body["facets"]["weeks"]) == 64


def test_query_with_filters(client):
    params = {"q": "bicycle spoke", "classification": "b60b", "keywords": "bicycle", "limit": 100}
    body = client.get("/search", params=params).json()
    assert body["filters"]["classification"] == "b60b"
    assert body["results"]
    assert all(r["classification"].startswith("B60B") for r in body["results"])
    assert sum(w["count"] for w in body["facets"]["weeks"]) == body["total"]


def test_request_id_is_echoed(client):
    assert client.get("/search", params={"request_id": 42}).json()["request_id"] == 42


@pytest.mark.parametrize(
    "params",
    [
        {"classification": "not a code"},
        {"week_from": "2025-01-01", "week_to": "2024-01-01"},
        {"limit": 1000},
        {"week_from": "yesterday"},
    ],
)
def test_bad_input_is_rejected(client, params):
    assert client.get("/search", params=params).status_code == 422


def test_frontend_origin_is_allowed(client):
    response = client.options(
        "/search",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"