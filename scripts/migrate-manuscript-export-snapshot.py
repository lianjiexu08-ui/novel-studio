"""Add frozen export metadata to existing SQLite manuscripts, with backup.

Usage: python3 scripts/migrate-manuscript-export-snapshot.py data/novel-studio.db
Stop API and review/writing workers before migration. Legacy metadata stays NULL.
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
    columns = {row[1] for row in db.execute('PRAGMA table_info("ManuscriptRevision")')}
    if not columns:
        raise SystemExit('ManuscriptRevision table missing; expected an existing Novel Studio database.')
    if 'exportSnapshot' in columns:
        print('exportSnapshot already exists; no change.')
    else:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        backup = path.parent / 'audit-backups' / f'{stamp}-before-manuscript-export-snapshot.db'
        backup.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(backup) as destination:
            db.backup(destination)
        db.execute('ALTER TABLE "ManuscriptRevision" ADD COLUMN "exportSnapshot" TEXT')
        db.commit()
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit(f'Integrity check failed; backup: {backup}')
        print(f'Added exportSnapshot; legacy metadata remains unknown. Backup: {backup}')
