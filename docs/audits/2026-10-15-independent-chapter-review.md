# Independent chapter review gate

The previous chapter policy checked rules, references, extracted events and length, but had no separate assessment of narrative quality. Policy v3 requires an independent model review covering causality, character choices and knowledge, power and costs, continuity, chapter obligations, and prose. Missing, invalid, failed or insufficient reviews block both manual adoption and sequential runs. Only the existing length check remains overridable.

Each review is bound by hash to the exact candidate text, event proposals/extraction, covenant, full current world/bible/approved plan, candidate brief, prior active facts and the most recent eight adopted chapters. All six criteria must be present, and citations must match source text exactly. Passing character, power and obligation checks require evidence from the bible, world and brief respectively; continuity requires factual, prior-prose or initial-state evidence. Neither event extraction nor a generic world citation can substitute for fulfillment of the chapter brief.

The model runs outside database transactions. A pending check invalidates an earlier pass; changed inputs, late concurrent responses or missing providers cannot authorize adoption. Batch reviews renew their lease, preserve usage and honor pause/cancel before adoption. The adoption gate recomputes the material hash. Failed attempts and valid stale reports remain in append-only check history. Review metadata uses the existing CheckExecution JSON column, with no database migration. The quality page displays all six conclusions, repair advice and expandable citations.

Validation:

- 336 tests passed in the isolated checkout; frontend TypeScript check and Vite build passed (existing bundle-size warning remains).
- Tests cover malformed reports, missing/duplicate dimensions, wrong binding, invented quotations, unrelated obligation evidence, missing reviewer, failed/insufficient verdicts, model errors and usage, pending-review adoption, changed design/facts, sequential pause, and SQLite reload with old failures and citations retained.
- Browser verification used an in-memory fixture on ports 8791/5191. The six rows, negative verdict and expanded evidence rendered correctly. Screenshot: `/tmp/novel-chapter-review-ui.png` (test data).
- A real `gpt-5.6-luna` call reviewed an intentionally contradictory in-memory fixture, without writing production data or generating book chapters. It returned six revision verdicts and identified the deliberately impossible power action. The first response cited the two-character empty facts array and failed citation validation; one repair produced valid evidence. Both raw responses, requests and usage are preserved in `2026-10-15-chapter-review-negative-fixture.json`. Two calls used 10,154 input tokens and 4,507 output tokens; monetary cost was not reported. No fallback was used.

Limits and next work:

- This negative fixture does not establish reviewer recall, precision or acceptable prose quality. The model also overreached by discussing spiritual-stone usage conditions when the fixture only stated possession; retain that finding for calibration rather than treating the report as infallible.
- Review currently has a 300,000-character request cap and does not truncate sources. Larger inputs fail closed and need a staged review implementation. Prior prose beyond eight chapters is represented by active facts; if those facts cannot support a judgment, the reviewer must return insufficient. Full long-book review coverage and targeted source retrieval remain necessary before scaling writing.
- Existing archived chapter checks are not retroactively promoted to independent reviews. No adopted chapter was changed or reapproved.
- Production API PID 3668 was not restarted, root Prisma was not regenerated, and the design60 formal writer PID 4194 continues on its frozen runtime. These code changes are not yet deployed to that API. World30/bible60/proposed plan60 remain unapproved; the original 41 blockers are retained. Formal design review is still in progress, not accepted.
