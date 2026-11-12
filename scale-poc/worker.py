"""Consume parse jobs: clean each patent with the Part 1 loader and upsert its status.

FAIL_RATE (0-1) makes jobs fail on purpose to show retries and the dead-letter queue.
"""
import json
import os
import random
import socket

from common import DEAD_LETTER_QUEUE, MAX_ATTEMPTS, PIPELINE_VERSION, QUEUE, channel, database, publish
from loader import DATA_DIR, path_to_week, record_to_patent

FAIL_RATE = float(os.environ.get("FAIL_RATE", "0"))
WORKER = f"{socket.gethostname()}:{os.getpid()}"
db = database()


def process(week_file: str) -> int:
    if random.random() < FAIL_RATE:
        raise RuntimeError("simulated failure")
    path = DATA_DIR / week_file
    week = path_to_week(path)
    rows = []
    for record in json.loads(path.read_text(encoding="utf-8")):
        patent = record_to_patent(record, week)
        if patent is not None:
            rows.append((patent.doc_number, patent.week, week_file, len(patent.claims),
                         len(patent.paragraphs), "parsed", PIPELINE_VERSION))
    with db.transaction():  # all patents of the file, or none
        db.cursor().executemany(
            "INSERT INTO documents (doc_number, week, week_file, claims, paragraphs, status, pipeline_version) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (doc_number) DO UPDATE SET "
            "claims = EXCLUDED.claims, paragraphs = EXCLUDED.paragraphs, status = EXCLUDED.status, "
            "pipeline_version = EXCLUDED.pipeline_version, updated_at = now()",
            rows,
        )
    return len(rows)


def handle(ch, method, properties, body):
    job = json.loads(body)
    week_file, attempt = job["week_file"], job["attempt"]
    db.execute("UPDATE jobs SET status = 'running', attempts = %s, worker = %s, updated_at = now() "
               "WHERE week_file = %s", (attempt, WORKER, week_file))
    try:
        count = process(week_file)
        db.execute("UPDATE jobs SET status = 'done', patents = %s, error = NULL, updated_at = now() "
                   "WHERE week_file = %s", (count, week_file))
        print(f"done      {week_file}  ({count} patents, attempt {attempt})")
    except Exception as error:  # noqa: BLE001 - any failure is retried or dead-lettered
        status = "retrying" if attempt < MAX_ATTEMPTS else "failed"
        db.execute("UPDATE jobs SET status = %s, error = %s, updated_at = now() WHERE week_file = %s",
                   (status, str(error), week_file))
        if attempt < MAX_ATTEMPTS:
            publish(ch, QUEUE, json.dumps({"week_file": week_file, "attempt": attempt + 1}))
        else:
            publish(ch, DEAD_LETTER_QUEUE, body.decode())
        print(f"{status:9} {week_file}  (attempt {attempt}: {error})")
    ch.basic_ack(delivery_tag=method.delivery_tag)  # only after the database is updated


connection, ch = channel()
ch.basic_qos(prefetch_count=1)  # one job at a time per worker, so work spreads across workers
ch.basic_consume(queue=QUEUE, on_message_callback=handle)
print(f"Worker {WORKER} waiting for jobs (FAIL_RATE={FAIL_RATE}). Ctrl+C to stop.")
try:
    ch.start_consuming()
except KeyboardInterrupt:
    connection.close()
