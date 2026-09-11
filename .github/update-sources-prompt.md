# Scheduled task: update built-in source presets

You are the scheduled data-maintenance agent for RepriceAA, a browser
extension that reprices Artificial Analysis benchmarks with subscription
discount ratios. The provider pages listed below changed since the last
run. Your only job is to keep `data/sources/*.json` factually in sync.

Changed source ids: see the list at the top of this message (before this
file's contents).

## Procedure

1. Read `data/providers.json` to map each changed source id to its page URLs.
2. Fetch each page for the changed sources (use the webfetch tool).
3. Update `data/sources.json` - and ONLY the entries whose `id` matches a
   changed source id (array order must be preserved; other entries stay
   byte-identical):
   - keep `id` and `name` stable; bump `asOf` to today (YYYY-MM-DD);
   - rewrite `notes` with the concrete numbers you used;
   - adjust `nameIncludes` patterns so every model family the plan covers
     matches (add new families, drop removed ones);
   - recompute the multiplier as `monthlyFee / API-equivalent monthly
     value`. Do not invent a ratio you cannot support with numbers from
     the page: if the page does not provide enough data, keep the existing
     ratio and say why in `notes`.
   - limited-time offers: use a stated end date when the page gives one;
     if it says "limited time" with no date, say so in `notes` (do NOT
     guess a date).
   - model-specific quota multipliers (e.g. "4x usage for model X") are
     handled via the `promos` array: add/update one entry
     `{ "match": "<pattern>", "rule": { "type": "multiplier", "value":
     <base ratio divided by the quota multiplier> }, "reason": "<what the
     page says>", "startsAt": "<date or null>", "endsAt": "<date or null>" }`.
     Remove `promos` entries whose offer no longer appears on the page.
4. When done run: `node scripts/build-sources.js && node test/run-tests.js`.
   All tests must pass; fix your JSON if schema validation fails.
5. Never modify anything outside `data/sources.json`. Never commit.

## Entry schema (data/sources.json sources[])

- `id`: kebab-case string, must stay stable
- `name`: human-readable display name
- `kind`: `"subscription"` | `"usage"`
- `monthlyFee`: number > 0 (subscription monthly price in USD)
- `manualRatio`: amortized multiplier, 0 < r <= 1
- `defaultRule`: `{ "type": "multiplier", "value": <same as manualRatio> }`
- `rules`: `{}` (per-model id overrides; keep empty)
- `nameIncludes`: `[{ "match": "<lowercase substring>", "rule": { "type":
  "multiplier", "value": <ratio> } }]`
- `asOf`: `"YYYY-MM-DD"`
- `notes`: one-paragraph justification citing the page numbers
- `promos` (optional): array as described in step 3; entries whose
  `endsAt` is a past date are ignored automatically by the runtime
