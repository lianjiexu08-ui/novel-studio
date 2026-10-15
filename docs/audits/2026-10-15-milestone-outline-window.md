# Prevent partial outline windows from completing whole milestones

Design63 contains `ms_v2_fire` (“北三门前与各自的去路”), spanning chapters 47–53, while detailed outlines currently stop at chapter 50. This is valid rolling planning: the remaining chapters have macro arrangements and will receive detailed outlines before writing.

The realization code inferred milestone completion when all *currently outlined* chapters inside its range were adopted and marked realized. Thus, once chapters 47–50 were realized, it could mark the entire 47–53 milestone realized and satisfy a later dependency before chapters 51–53 were outlined or written. The same issue affected a hole inside the range. This finding is about the inference algorithm, not a claim that design63 has new accepted prose.

The inference now requires a complete, continuous, nonduplicated outline range as well as adopted chapters and their realized events. Evidence for completed chapters remains visible while the overall milestone remains unfinished. Explicit milestone events retain their existing handling; this change addresses completion inferred from chapter events.

Validation used a deterministic 60-chapter fixture with 50 initial outlines, a 47–53 milestone, and a dependent 54–55 milestone. It wrote and adopted the first 50 fixture chapters through the application workflow, expanded the outline window, then adopted chapters 51–53 sequentially. The tests confirm:

- Completing 47–50 alone does not realize 47–53 or satisfy the dependent milestone.
- Adding outlines does not substitute for prose adoption.
- Completion becomes realized only after the final required chapter's adopted realization evidence.
- A missing middle chapter or a duplicate standing in for it does not satisfy the range.

The regression failed on the original source with `actual: realized / expected: unrealized` and passed with the fix. All 394 tests passed in the isolated workspace via `node scripts/test-all.mjs`; log `/tmp/novel-milestone-window-full.log`. The failing original-source run is `/tmp/novel-milestone-window-before.log`.

No production data, design questions, approval statuses, frontend contracts, or current formal runtime changed. All 130 frozen design63 runtime file hashes were verified unchanged. The fix remains on main for the next deployment after the active formal review finishes.

The 41 design questions still require individual disposition after four-domain acceptance. Existing chapter briefs and their `obligations` review do not by themselves establish a per-question acceptance history; this fix does not automatically resolve those questions or convert them into prose obligations.
