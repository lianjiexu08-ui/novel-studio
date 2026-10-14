# Inspect rewritten and historical chapter candidates

The quality endpoint previously always chose the candidate behind the adopted chapter whenever one existed. A rewritten candidate's review and stage history were therefore inaccessible on the quality page even after the author generated and checked it.

The chapter state endpoint now accepts an optional candidate ID and returns a list of candidates for that same work and chapter. The default still selects the current adopted manuscript; explicit selection exposes the chosen draft's complete prose, current checks and append-only review history. IDs belonging to another work or chapter return 404. Candidate selection does not change adopted events, character states, relationships or the selected chapter's adopted version.

The quality page offers a labeled draft selector, distinguishes the current adopted draft from historical adopted drafts, pending candidates and demo drafts, and expands the selected prose. Refresh retains the selection; responses from older page requests cannot replace a newer selection. The page states that factual projections continue to use adopted prose. The review banner now derives its authoritative heading and color from check status while retaining the original report message, so a contradictory model summary cannot turn a failed result into a green pass.

Validation:

- All 23 API tests passed (`/tmp/novel-quality-candidate-tests.log`). The new integration regression exercises a failed rewrite beside a passing adopted draft, exact prose/history selection, unchanged adopted projections, foreign/mismatched candidate rejection, read-only state preservation, and inspection of an older candidate after adopting its replacement.
- Frontend TypeScript and Vite build passed (`/tmp/novel-quality-candidate-final-build.log`) with the existing bundle-size warning.
- Browser verification used isolated in-memory fixtures on ports 8791/5191. The page initially showed the adopted draft, switched to the rewrite's revision finding, expanded the correct rewrite prose, and retained the selection after refresh. The factual power value remained 1 despite the unadopted rewrite proposing 2. Screenshot: `/tmp/novel-quality-candidate-ui.png`. The fixture deliberately retained a contradictory 'test review passed' summary; the status-derived banner correctly showed that revision was required. These are UI fixtures, not literary-quality evaluations.
- The temporary browser tab and both fixture servers were closed. Production API PID 3668 and formal review PID 4194 stayed running; no migration, Prisma generation, production design edit or manuscript generation occurred.

The design60 world review still requires revision. The independent formal power and character reviews continue, with story queued behind the available worker. The design61 draft remains unapplied; this code change is pushed but not deployed during the active formal review.
