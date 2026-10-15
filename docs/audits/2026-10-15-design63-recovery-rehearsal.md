# Design63 serial recovery rehearsal

Prepared `data/audit-runtimes/design63-control/resume.mjs` for the failed world step after the original serial worker finishes. Production execution is not started. The script refuses the currently running checkpoint before opening the repository or configuring a model. It also requires the original process to have exited, an exact persisted checkpoint match, unchanged frozen source hashes and design hash, and no active production review lease.

Recovery reuses frozen commit `6c505a3d6afae5bb275f8cd509e2455a48753857`, schedule 23, the original runner's exact dispatch suffix, the existing run IDs, and the current connection. It uses one worker and subtracts prior calls from the original 400-call allowance. It creates a new output checkpoint exclusively, stops on another failure, and never starts prose generation. Main's newer prompt and validation changes are not used in this recovery.

An online SQLite backup was used for a failure rehearsal while the real worker continued. The rehearsal explicitly scoped its copied checkpoint to the failed world run; the other copied runs were preserved and separately hashed. The model provider was replaced only in this isolated rehearsal with an immediate simulated failure. A fresh repository connection verified the result:

- Resumed the same world run at `cross-2-4`, with one attempt added.
- Preserved all 10 completed stages byte-for-byte under JSON hashing.
- Preserved the existing failed attempt and its original model responses; appended exactly one simulated failure.
- Kept the step incomplete and released its lease after failure.
- Preserved all 58 other review runs, old reports, design, plans, chapter versions, events, manuscripts, and candidates.
- Verified all 130 frozen runtime files unchanged.
- Made zero real model calls and zero production database writes.

The exact recovery script hash and independent readback proof are in `2026-10-15-design63-recovery-rehearsal.json`. The running-worker refusal was also exercised against the live checkpoint and returned the expected assertion before repository access.

This verifies safe failure recovery, not a successful model review or design acceptance. Once the original queue is terminal, run the production preflight against its final checkpoint, then execute serial recovery using the same frozen runtime. If that final state differs, inspect it before dispatch. Do not substitute the rehearsal checkpoint, approve the proposal, clear blockers, or skip the world's missing results.
