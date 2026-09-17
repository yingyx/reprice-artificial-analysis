# Scheduled task: update built-in source presets

You are the scheduled data-maintenance agent for RepriceAA, a browser
extension that reprices Artificial Analysis benchmarks with subscription
discount ratios. The provider pages listed below changed since the last
run. Your only job is to keep `data/sources.json` factually in sync.

Changed source ids: see the list at the top of this message (before this
file's contents).

## How the runtime prices a subscription source (must-read)

For `kind: "subscription"` sources the extension resolves a model's price
with this priority:

1. exact `rules` override (model id) — you do not maintain this;
2. an active `promos` entry whose `match` hits the model label;
3. the FIRST `nameIncludes` pattern whose `match` is a substring of the
   model label (lowercase) — its own `rule.value` IS the price shown;
4. `manualRatio` — only a fallback for pattern entries without a usable
   rule value, and a summary figure shown in the panel.

Therefore the `nameIncludes` `rule.value` you write IS the price users
see for that model. Compute it per model, not per family, whenever the
page distinguishes models:

    value = monthlyFee / <that model's monthly allowance in USD>

(monthly credits on Command Code, monthly usage limit on OpenCode Go).
Models matched by NO pattern are NOT covered and are shown at AA list
price - so the pattern list must cover every paid model family the plan
includes, and should deliberately exclude free ones.

## Ordering rule (build-enforced)

`nameIncludes` and `promos` entries are matched first-hit-wins, and
`scripts/build-sources.js` FAILS the build if a pattern is shadowed by an
earlier broader one (or duplicated). Always order most-specific first:

- `"glm-5.3-flash"` must come before `"glm-5.3"` and `"glm"`;
- `"mimo-v2.5-pro"` must come before `"mimo"`;
- `"deepseek v4 flash vision"` before `"deepseek v4 flash"`.

If the build fails with a shadow/duplicate error, fix the order it names.

## Procedure

1. Read `data/providers.json` to map each changed source id to its page URLs.
2. Fetch each page for the changed sources (use the webfetch tool).
3. Update `data/sources.json` - and ONLY the entries whose `id` matches a
   changed source id (array order must be preserved; other entries stay
   byte-identical):
   - keep `id` and `name` stable; bump `asOf` to today (YYYY-MM-DD);
   - rewrite `notes` with the concrete numbers you used;
   - recompute every affected `nameIncludes` pattern value with the formula
     above. Do not invent a ratio you cannot support with numbers from the
     page: if the page does not state a per-model allowance, reuse the
     plan-level default and say so in `notes`;
   - limited-time offers: use a stated end date when the page gives one
     (e.g. "4x · Ends Sep 20" -> endsAt "2026-09-20"); if it says "limited
     time" with no date, set `endsAt: null` and say so in `notes` (do NOT
     guess a date). Remove `promos` entries whose offer no longer appears
     on the page;
   - a promo `match` must name the specific discounted model (e.g.
     "minimax m3", "mimo v2.5"), never a whole family: sibling models
     without the deal would inherit the discount ratio and be mispriced.
4. When done run: `node scripts/build-sources.js && node test/run-tests.js`.
   All tests must pass; fix your JSON if schema validation fails (the build
   also reports shadowed/duplicate patterns - fix the order it reports).
5. Never modify anything outside `data/sources.json`. Never commit.

## Entry schema (data/sources.json sources[])

- `id`: kebab-case string, must stay stable
- `name`: human-readable display name
- `kind`: `"subscription"` | `"usage"`
- `monthlyFee`: number > 0 (subscription monthly price in USD)
- `manualRatio`: summary multiplier = `monthlyFee / <most common monthly
  allowance>`, 0 < r <= 1
- `defaultRule`: `{ "type": "multiplier", "value": <same as manualRatio> }`
- `rules`: `{}` (per-model id overrides; keep empty)
- `nameIncludes`: `[{ "match": "<lowercase substring>", "rule": { "type":
  "multiplier", "value": <per-model ratio = monthlyFee / per-model
  monthly allowance> } }]`, ordered most-specific first
- `asOf`: `"YYYY-MM-DD"`
- `notes`: one-paragraph justification citing the page numbers
- `promos` (optional): array as described in step 3; entries whose
  `endsAt` is a past date are ignored automatically by the runtime
