# Scheduled task: update built-in source presets

You are the scheduled data-maintenance agent for RepriceAA, a browser
extension that reprices Artificial Analysis benchmarks with subscription
discount ratios. Your only job is to keep `data/sources.json` factually
in sync with the providers' own published pricing pages.

Changed source ids: see the list at the top of this message (before this
file's contents). Additional task context, if any, follows the ids.

## How the runtime prices a subscription source (must-read)

For `kind: "subscription"` sources the extension resolves a model's price
with this priority:

1. exact `rules` override (model id) — you do not maintain this;
2. an active `promos` entry whose `match` hits the model label;
3. the FIRST `nameIncludes` pattern whose `match` is a substring of the
   model label (matching is punctuation-insensitive) — its own
   `rule.value` IS the price shown;
4. `manualRatio` — only a fallback for pattern entries without a usable
   rule value, and a summary figure shown in the panel.

Therefore the `nameIncludes` `rule.value` you write IS the price users
see for that model. Compute it per model, not per family, whenever the
provider distinguishes models:

    value = monthlyFee / <that model's monthly allowance in USD>

(the allowance is whatever the provider's page states per model: credits,
usage limits, or any equivalent monthly value). Models matched by NO
pattern are NOT covered and are shown at AA list price - so the pattern
list must cover every paid model the plan includes, and should
deliberately exclude free ones.

## Ordering rule (build-enforced)

`nameIncludes` and `promos` entries are matched first-hit-wins, and
`scripts/build-sources.js` FAILS the build if a pattern is shadowed by an
earlier broader one (or duplicated). Always order most-specific first:
a variant pattern (e.g. `<family>-flash`, `<family>-pro`, or any model
whose allowance differs) must come before its family pattern. If the
build fails with a shadow/duplicate error, fix the order it names.

## Pattern precision (build-verified)

Patterns must describe ONLY the models the plan actually includes. A
family catch-all silently reprices AA models outside the plan at the
plan's ratio - the single most damaging data error, because every
non-included model looks discounted.

Rules:

- Derive patterns per model from the plan's included-models list as the
  provider publishes it. Spelling does not need to match AA exactly
  (punctuation-insensitive matching), but the model NAME must be right:
  a pattern must never match a plan model the provider does not include,
  and must not be so broad that AA models outside the plan match it.
- Plan models AA does not list yet may keep a pattern - it matches
  nothing today and activates when AA adds them. Say so in `notes`.
- Never cover a different variant "by family resemblance": if the plan
  includes only a discounted variant, cover only that variant.
- Free models get no pattern (they stay at AA list price; say so in
  `notes`).

Verification loop (mandatory before running the build):

1. Run `node scripts/check-patterns.js` (it fetches the AA /models page
   and cross-checks every pattern against AA's actual model names).
2. Fix every reported zero-hit pattern: either correct the spelling to
   AA's canonical name, or justify it in `notes` ("model not on AA yet").
3. Review the hit-sets the checker prints for over-coverage: if a
   pattern matches an AA model outside the plan, narrow it to the exact
   included model's name.
4. The build also fails on shadowed/duplicate patterns - fix the order
   it reports.

## Procedure

1. Read `data/providers.json` to map each changed source id to its page
   URLs. A source may have NO pages listed (manually dispatched task):
   then research the provider's own published plan/pricing pages yourself
   and only write numbers you can support there.
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
     ("<multiplier> · Ends <date>" -> endsAt "<date>"); if it says
     "limited time" with no date, set `endsAt: null` and say so in
     `notes` (do NOT guess a date). Remove `promos` entries whose offer
     no longer appears on the page;
   - a promo `match` must name the specific discounted model, never a
     whole family: sibling models without the deal would inherit the
     discount ratio and be mispriced.
4. When done run: `node scripts/build-sources.js && node test/run-tests.js
   && node scripts/check-patterns.js`.
   All tests must pass; fix your JSON if schema validation fails (the
   build also reports shadowed/duplicate patterns - fix the order it
   reports).
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
