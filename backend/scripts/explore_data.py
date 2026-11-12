"""Quick data check: counts missing fields, empty fields, empty list items, and claim quirks."""

import json
import re
from collections import Counter
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data" / "patent_data_small"
FIELDS = [
    "title",
    "doc_number",
    "filename",
    "abstract",
    "detailed_description",
    "claims",
    "bibtex",
    "classification",
]
LIST_FIELDS = ["claims", "detailed_description"]

CANCELED = re.compile(r"\(cancell?ed\)", re.IGNORECASE)  # matches both spellings
NUMBERED = re.compile(r"\s*\d+\s*\.")  # "2 ." or "2." at the start

missing = Counter()  # key not in the record at all
empty = Counter()  # key exists, but value is "", [] or None
empty_items = Counter()  # blank strings inside claims / detailed_description
total_items = Counter()
canceled = 0
first_unnumbered = 0
later_unnumbered = 0
total = 0

files = sorted(DATA_DIR.glob("patents_ipa*.json"))
for path in files:
    records = json.loads(path.read_text(encoding="utf-8"))
    for record in records:
        total += 1

        for field in FIELDS:
            if field not in record:
                missing[field] += 1
            elif not record[field]:
                empty[field] += 1

        for field in LIST_FIELDS:
            for item in record.get(field) or []:
                total_items[field] += 1
                if not item or not item.strip():
                    empty_items[field] += 1

        # Claim-only checks: canceled placeholders and claims missing their number
        for i, claim in enumerate(record.get("claims") or []):
            if not claim or not claim.strip():
                continue
            if CANCELED.search(claim):
                canceled += 1
            elif not NUMBERED.match(claim):
                if i == 0:
                    first_unnumbered += 1
                else:
                    later_unnumbered += 1

print(f"{len(files)} files, {total} records\n")
for field in FIELDS:
    print(f"{field:22} missing: {missing[field]:4}   empty: {empty[field]:4}")
print()
for field in LIST_FIELDS:
    print(f"{field:22} empty items: {empty_items[field]:6} of {total_items[field]}")
print()
print(f"canceled claim placeholders:  {canceled}")
print(f"first claim unnumbered:       {first_unnumbered} of {total} patents")
print(f"later claims unnumbered:      {later_unnumbered}")
