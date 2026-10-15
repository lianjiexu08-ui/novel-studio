# Design63 live failure and evidence UI verification

Inspected the currently deployed frontend `c9907d982464bbb10a080376d1b7a0706eee5176` at `http://127.0.0.1:5180` through a temporary browser tab. The API and formal review continued using the frozen design63 runtime.

The plan page showed proposal 63, 100 target chapters, three volumes, and 50 detailed outlines, while explicitly identifying plan 10 as the currently approved plan. Its approval control was disabled. The design page showed world 33 and bible 63, and distinguished the failed world run from the running power review. It explained that completed batches do not constitute whole-area acceptance and that refresh only reads progress.

Expanded the failed world `cross-2-4` stage and its “原文与结果” detail. The page displayed its incomplete status and exact criterion-coverage error. Expanding “模型原答与失败记录（执行 1 次）” exposed both the original response and the attempted repair, including the current request ID and the omitted-criteria responses.

Opened “查看返修证据：原文批次 2” for power. The detail displayed the `costs` negative finding, labelled the advice “模型返修建议（待核对）”, and exposed all six source quotations, including `review-unit/135` and `review-unit/157`. This is the disputed spring-quantity finding documented separately; the UI does not mark it resolved or silently replace the model's judgment with the independent interpretation.

Saved screenshots and accessibility text:

- `data/audit-ui/design63/failure-details/world-failed.png`
- `data/audit-ui/design63/failure-details/world-failed.txt`
- `data/audit-ui/design63/failure-details/power-revise.png`
- `data/audit-ui/design63/failure-details/power-revise.txt`

Their hashes and verified fields are recorded in `2026-10-15-design63-failure-ui.json`. The power screenshot was visually inspected and displays the negative finding, pending-verification advice, and expanded source evidence without overlap. No review, continue, retry, save, or approval action was clicked. The temporary tab was closed. This verifies visibility of the current failure and negative evidence, not design acceptance or manuscript quality.
