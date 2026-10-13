"""Add durable review checkpoints to an existing SQLite database, with backup.

Usage: python3 scripts/migrate-design-review-runs.py data/novel-studio.db
Stop the API before migration. No tables or existing values are replaced.
"""
import argparse
import datetime
import pathlib
import sqlite3

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('database', type=pathlib.Path)
args = parser.parse_args()
path = args.database.resolve(strict=True)
with sqlite3.connect(path.as_uri() + '?mode=rw', uri=True) as db:
    columns = {row[1] for row in db.execute('PRAGMA table_info("Project")')}
    if not columns:
        raise SystemExit('Project table missing; this migration only supports an existing Novel Studio database.')
    if 'designReviewRuns' in columns:
        print('designReviewRuns already exists; no change.')
    else:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = path.parent / 'audit-backups' / f'{stamp}-before-design-review-runs.db'
        backup.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(backup) as destination:
            db.backup(destination)
        db.execute('ALTER TABLE "Project" ADD COLUMN "designReviewRuns" TEXT NOT NULL DEFAULT \'[]\'')
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit(f'Integrity check failed; backup: {backup}')
        print(f'Added designReviewRuns. Backup: {backup}')
