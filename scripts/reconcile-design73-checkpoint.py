"""Reconcile a dead worker checkpoint with already persisted review progress."""
import json
import sqlite3
from pathlib import Path

checkpoint_path = Path('data/audit-runtimes/design73-review/result.json')
checkpoint = json.loads(checkpoint_path.read_text())
if checkpoint['status'] == 'running':
    try:
        import os
        os.kill(checkpoint['pid'], 0)
    except ProcessLookupError:
        checkpoint['status'] = 'stopped_after_failure'
        checkpoint.setdefault('errors', []).append({
            'step': checkpoint.get('activeStep'),
            'error': 'Worker terminated while reconciling a persisted stage after a transaction-bound read failure',
        })
    else:
        raise AssertionError('The checkpoint worker is still live')
assert checkpoint['status'] == 'stopped_after_failure'
with sqlite3.connect('data/novel-studio.db') as connection:
    connection.text_factory = str
    raw = connection.execute(
        'SELECT designReviewRuns FROM Project WHERE id = ?',
        ('work_8b6c9133e13d404083ca33acc63f4f61',),
    ).fetchone()[0]
persisted = {run['id']: run for run in json.loads(raw)}
synced = []
for index, run in enumerate(checkpoint['runs']):
    stored = persisted[run['id']]
    stored_by_id = {stage['id']: stage for stage in stored['stages']}
    checkpoint_by_id = {stage['id']: stage for stage in run['stages']}
    assert set(checkpoint_by_id) == set(stored_by_id)
    for stage_id, stage in checkpoint_by_id.items():
        if stage.get('result'):
            assert stage == stored_by_id[stage_id], f'Persisted completed stage diverged: {stage_id}'
    stored_completed = sum(bool(stage.get('result')) for stage in stored['stages'])
    checkpoint_completed = sum(bool(stage.get('result')) for stage in run['stages'])
    if stored_completed > checkpoint_completed:
        checkpoint['runs'][index] = stored
        synced.append({'runId': run['id'], 'from': checkpoint_completed, 'to': stored_completed})
temporary_path = checkpoint_path.with_suffix('.json.pending')
temporary_path.write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2) + '\n')
temporary_path.replace(checkpoint_path)
print(json.dumps({'status': checkpoint['status'], 'synced': synced, 'totalCalls': checkpoint['totalCalls']}))
