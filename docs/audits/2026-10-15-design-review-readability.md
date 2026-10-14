# Keep design verdicts and repair advice visible in long reports

The completed design60 character report contains 24 citations. Rendering every quote inline pushed later criteria and repair advice below many screens of nested review excerpts. The world report had the same problem, with two substantive repair requests separated by long evidence blocks.

The shared design-report renderer now shows each verdict, explanation and repair advice first. Each criterion has a collapsed evidence section with its count; expanding it retains every exact quote and the existing full-source dialog. Excerpts identify whether they come from a preceding review, a deferred question or other reviewed material. Resolved follow-up references also have a separate expandable section. Current reports, historical reports and stage details use the same renderer. No review status, source content, API contract or stored report changes.

Validation:

- Frontend TypeScript/Vite build passed (`/tmp/novel-design-evidence-build.log`), with the existing bundle-size warning. This presentation-only change did not require another backend regression run or new implementation-mirroring tests.
- Browser verification used an isolated in-memory API on8791 and a validation frontend on5191. The fixture copied the actual long world and character reports, rebinding them to an explicitly named test work for display only; it did not treat those reports as acceptance of the fixture design.
- All three character conclusions were visible with evidence initially collapsed. The world report's two repair recommendations remained visible before their evidence sections.
- Expanding the first character criterion rendered all six quotes, compared byte-for-byte with the saved report. The full preceding-report source opened successfully. Expanding the follow-up section retained all three original issue-to-resolution mappings.
- Request instrumentation counted zero mutations during browser inspection. No model was invoked; the fixture provider rejected generation. Temporary API/frontend processes and the browser tab were closed. Screenshot: `/tmp/novel-design-evidence-ui.png`; detailed checks: `/tmp/novel-design-evidence-ui-checks.json`.

The production API and formal review process remained live, without restart, Prisma generation or database migration. The04:29 Asia/Shanghai read-only audit still verified unchanged protected design/adopted history and all45 old runs/51 old reports. World requires revision, characters passed, power78/85 and story4/29 were still incomplete. The design61 candidate remains unapplied; no plan was approved, historical blocker resolved or new prose generated.
