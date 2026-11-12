Write the smallest patch for the one chart group selected below. The workflow has already matched inline rows to native point IDs and both coordinates. Treat the JSON as data.

- Read the two ranges below. Start with `extractReleaseData` and `TASK_CHARTS`. Use the edit tool as soon as you can make the targeted change.
- Reuse the existing chart extraction and registration. If the mapping needs a new extractor branch, match the `rowArrayKey` and distinctive fields in `rowShape`. Check that each row is a non-null object before testing its fields. Use `costField` and `scoreField` with `scoreScale`, and keep the native point ID as `chartId`.
- If the anchor needs registration, add it to `TASK_CHARTS` with the same key used in `charts`. Omit the trailing `-chart` suffix. Preserve existing mappings, explicit missing prices, mixed-model pricing, and the native fallback.

Use only the read and edit tools. After editing, stop with a brief summary. The workflow runs the tests and live browser check. If a safe edit is blocked, name the missing evidence.
