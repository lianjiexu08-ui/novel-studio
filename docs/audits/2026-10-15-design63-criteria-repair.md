# Design63 missing-criteria repair

The frozen design63 world review stopped at `cross-2-4`: both the original response and its one repair returned only `geography`, omitting `history` and `capacity`. The validator correctly rejected both. The worker continued serially with power; world has not passed and requires recovery after the current queue finishes.

The previous repair diagnostic said only that every criterion must be covered. Main now reports expected, received, missing, duplicate, and unexpected criterion keys, and supplies a dedicated repair instruction requiring the complete rubric with independently supported judgments. It does not fill missing checks, copy verdicts, turn failures into passes, or increase the single-repair limit. Custom rubrics also use their actual keys.

Validation:

- 393 tests passed, zero failures, using `node scripts/test-all.mjs` in the isolated validation workspace. Log: `/tmp/novel-criteria-repair-full.log`.
- Regression tests cover successful completion preserving an existing `revise`, repeated omission preserving both failed model responses, duplicate keys, and equal-length substitutions under custom rubrics.
- The two actual failed responses were replayed offline against the frozen and updated validators. Both remain rejected; the updated diagnostic identifies `history` and `capacity`. The actual repair replay retains the same source fragments, request ID, and previous output. See `2026-10-15-design63-criteria-repair-replay.json`.
- All 130 frozen runtime source hashes verified unchanged. Replay made no model calls or production database writes. No frontend or API contracts changed.

This change is committed for a future runtime, not deployed into the active formal review. It establishes actionable repair diagnostics, not proof that a future model response will comply. The current worker must finish before serial recovery of failed stages using its frozen runtime. Original failures and completed stages must remain preserved. Design63 remains proposed; no plan approval, blocker resolution, or prose generation was performed.
