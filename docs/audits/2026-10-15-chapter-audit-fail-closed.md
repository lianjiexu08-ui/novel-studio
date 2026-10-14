# Chapter extraction failure must block generation

Fixed an audit path that converted malformed model output into an empty successful event audit. Missing, null, non-array and malformed observedEvents now receive one schema-aware repair; a second invalid response fails generation without creating a candidate. Explicit empty arrays remain valid. Events must contain a value and nonempty evidence. Repair requests retain the original response and chapter; errors retain usage from all calls.

Validation: 329 tests passed in the isolated validation checkout, including nine invalid-audit cases, schema repair, explicit empty audit and writer-omitted fact extraction. No production database migration, Prisma regeneration, API restart or design change was performed. The live design60 review uses its frozen runtime.

This fixes an execution failure, not narrative quality: evidence is still permitted to be a synopsis and the extractor's event set remains authoritative. Independent assessment of causal logic, choices, plan fulfillment and prose needs a separate gate.
