"""Enqueue one parse job per weekly file (the scheduler in DESIGN.md, pipeline A step 1)."""
import json

from common import QUEUE, channel, database, publish
from loader import DATA_DIR

db = database()
connection, ch = channel()
files = sorted(DATA_DIR.glob("patents_ipa*.json"))
for path in files:
    db.execute(
        "INSERT INTO jobs (week_file, status, attempts) VALUES (%s, 'queued', 0) "
        "ON CONFLICT (week_file) DO UPDATE SET status = 'queued', attempts = 0, error = NULL, updated_at = now()",
        (path.name,),
    )
    publish(ch, QUEUE, json.dumps({"week_file": path.name, "attempt": 1}))
print(f"Enqueued {len(files)} jobs")
connection.close()
