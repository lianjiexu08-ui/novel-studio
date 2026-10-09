# Novel service domain spike

This is an in-memory, standard-library-only proof of the core lifecycle agreed
for the long-form novel service. It deliberately has no real model API, web
server, database, queue, or publishing integration.

## Run

From this directory (or with an equivalent `PYTHONPATH`):

```bash
python -m unittest -v test_core.py
# From the repository root, the equivalent command is:
# python -m unittest discover -s novel-service-spike -p "test_*.py"

node --test test_queue.mjs
```

The Python tests cover twelve sequential chapters, candidate isolation,
unavailable quality gates, early-chapter impact marking, and checkpoint
recovery/idempotency. The Node tests cover persisted lease recovery, exactly-once
adoption, per-work serialization, cross-work concurrency, and enqueue dedupe.

## Main rules represented

* Model output is a `ChapterCandidate`. Its proposed events do not enter the
  story state until all checks pass and the candidate is adopted.
* Check statuses are explicit. `failed`, `inconclusive`, and `unavailable` all
  block adoption; a missing check also blocks adoption.
* Adoption is idempotent. Re-adopting an adopted candidate returns its existing
  version, and a run checkpoint reuses a generated candidate after a crash.
* Editing an adopted early chapter creates a revision, preserves history, marks
  later chapters/events stale, records an impact record, and rebuilds active
  character state from non-stale evidence.

## Next production steps

Move the `Work` aggregate to a relational store with optimistic concurrency,
persist checkpoints transactionally, and replace the fake provider/checkers with
versioned adapters. The event extraction should also be independently checked
against prose before production adoption. The Python aggregate is intentionally
in-memory; the JSON Node queue/checkpoint files demonstrate crash boundaries but
are not a production database or distributed queue.

