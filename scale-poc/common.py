"""Shared settings for the proof of concept (rough on purpose)."""
import os
import sys
from pathlib import Path

import pika
import psycopg

# Reuse the Part 1 cleaning code directly (no model or numpy needed).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

AMQP_URL = os.environ.get("AMQP_URL", "amqp://guest:guest@localhost:5672/%2F")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://poc:poc@localhost:5433/poc")
QUEUE = "parse"
DEAD_LETTER_QUEUE = "parse.dead"
MAX_ATTEMPTS = 3
PIPELINE_VERSION = "poc-1"

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    week_file  text PRIMARY KEY,
    status     text NOT NULL,              -- queued, running, done, retrying, failed
    attempts   int  NOT NULL DEFAULT 0,
    patents    int,
    error      text,
    worker     text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documents (
    doc_number       text PRIMARY KEY,
    week             date NOT NULL,
    week_file        text NOT NULL,
    claims           int  NOT NULL,
    paragraphs       int  NOT NULL,
    status           text NOT NULL,        -- parsed (next stages: embedded, indexed)
    pipeline_version text NOT NULL,
    updated_at       timestamptz NOT NULL DEFAULT now()
);
"""


def channel():
    connection = pika.BlockingConnection(pika.URLParameters(AMQP_URL))
    ch = connection.channel()
    ch.queue_declare(queue=QUEUE, durable=True)
    ch.queue_declare(queue=DEAD_LETTER_QUEUE, durable=True)
    return connection, ch


def database():
    conn = psycopg.connect(DATABASE_URL, autocommit=True)
    conn.execute(SCHEMA)
    return conn


def publish(ch, queue: str, body: str) -> None:
    ch.basic_publish(exchange="", routing_key=queue, body=body,
                     properties=pika.BasicProperties(delivery_mode=2))  # persistent
