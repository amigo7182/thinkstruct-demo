"""Status dashboard in the terminal: jobs by status, documents, queue depths."""
import sys
import time

from common import DEAD_LETTER_QUEUE, QUEUE, channel, database

db = database()
connection, ch = channel()


def show() -> None:
    jobs = dict(db.execute("SELECT status, count(*) FROM jobs GROUP BY status").fetchall())
    documents = db.execute("SELECT count(*), coalesce(sum(claims), 0), coalesce(sum(paragraphs), 0) "
                           "FROM documents").fetchone()
    waiting = ch.queue_declare(queue=QUEUE, passive=True).method.message_count
    dead = ch.queue_declare(queue=DEAD_LETTER_QUEUE, passive=True).method.message_count
    failed = db.execute("SELECT week_file, error FROM jobs WHERE status = 'failed' ORDER BY week_file").fetchall()

    print(f"jobs:      {jobs}")
    print(f"documents: {documents[0]} patents, {documents[1]} claims, {documents[2]} paragraphs")
    print(f"queues:    {waiting} waiting, {dead} dead-lettered")
    for week_file, error in failed:
        print(f"  failed: {week_file} ({error})")


if "--watch" in sys.argv:
    while True:
        print("\033[2J\033[H", end="")  # clear the terminal
        show()
        time.sleep(2)
else:
    show()
connection.close()
