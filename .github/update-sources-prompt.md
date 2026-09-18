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

## Pattern precision (must-verify step)

Patterns must describe ONLY the models the plan actually includes, as they
appear on Artificial Analysis. A family catch-all (`"muse"`, `"gpt"`,
`"hy"`, `"qwen"`) silently reprices unrelated AA models and is the single
most damaging data error - e.g. `"muse"` prices Muse Glimmer and the
regular Muse Spark 1.3 (not in the plan) at the plan's ratio, and `"gpt"`
covers GPT-5.6 Sol even when the plan only includes Luna.

Rules:

- Derive patterns per model from the plan page's included-models list,
  matching the AA label (which often carries suffixes like `(max)`,
  `(0902)`, `(high)` - your substring must sit before those). A
  family-level pattern is acceptable ONLY when every AA model it can match
  is in the plan AND shares the same allowance (e.g. `"claude"` for a
  Claude plan that covers all Claude models).
- If the plan includes only a discounted variant (e.g. Muse Spark 1.3
  **Contributor**) while AA also lists the regular model, cover ONLY the
  variant (`"muse spark 1.3 contributor"`); the regular model must stay
  uncovered. Models absent from AA entirely stay uncovered too -
  uncovered = AA list price; never approximate by family resemblance.
- Free models (e.g. Union Alpha Free, Laguna S 2.1) get no pattern.

Verification loop (mandatory before running the build):

1. Fetch `https://artificialanalysis.ai/models` and read the ld+json
   `<script type="application/ld+json">` blocks; collect the `label`
   values - these are the exact strings your patterns run against.
2. For each pattern, list every AA label whose lowercase contains it.
3. Every matched label must be a plan-included model (ignoring the
   label's bracket/date suffixes). Any hit outside the plan list means the
   pattern is too broad: narrow it to the exact included model's name.
4. The build also prints warnings for short or digit-less patterns
   (`broad pattern ...`): treat each one as a prompt to double-check the
   pattern's hit-set, not just noise.

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
