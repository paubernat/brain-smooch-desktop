# Judges API notes (from official docs, fetched 2026-11-21)

Everything below is copied or paraphrased from the official docs at the URLs given. Anything the docs do not state is listed under "Open questions" at the end; nothing here is guessed.

All three products exist and are documented:
- Liquid AI d1.2 / d1.2-ultra decision models (hosted, Liquid API)
- OpenAI Decisions API (`POST /v1/decisions`, `gpt-6-luna`, generally available; it was a public beta before)
- Anthropic structured outputs (`output_config.format`) on Claude Sonnet 5.5 (`claude-sonnet-5-5`)

---

## 1. Liquid AI Decision Models (`d1.2-ultra`, `d1.2`)

Sources:
- Model page: https://docs.liquid.ai/lfm/models/d1 (markdown: `.../d1.md`)
- API guide: https://docs.liquid.ai/api/guides/decisions
- Endpoint reference (OpenAPI): https://docs.liquid.ai/api/reference/decision-models/make-decisions
- Rate limits: https://docs.liquid.ai/api/reference/rate-limits
- Error codes: https://docs.liquid.ai/api/reference/error-codes
- Launch post: https://www.liquid.ai/blog/d1-2

### Base URL, auth, endpoint
- Server: `https://api.liquid.ai`. Endpoint: **`POST /decisions/v1/systemone`**, so the full URL is `https://api.liquid.ai/decisions/v1/systemone`.
- The endpoint "implements TypeSafe's System One API, so the official TypeSafe SDKs work with the base URL `https://api.liquid.ai/decisions`" (Python `typesafe-sdk`, TS `@typesafe-ai/sdk`). The TS SDK needs `compression: false` because "the API doesn't accept zstd-compressed request bodies".
- Auth: `Authorization: Bearer $LIQUID_API_KEY`. Create keys in console.liquid.ai under Dashboard > API Keys. Keys are prefixed `liquid_`.
- SDK limitation: "Use the TypeSafe SDKs for Noul, Choice, and Score questions. They can't read the other answer types yet, so send typed questions, images, and audio over HTTP." The page also says the SDKs drop typed answers from the response, and a multiple-choice question makes the call fail.
- List models: `GET /decisions/v1/models` (https://docs.liquid.ai/api/reference/decision-models/list-decision-models). It reports `input_modalities`.

### Request fields
| Field | Meaning (from docs) |
|---|---|
| `model` (required) | `"d1.2"` or `"d1.2-ultra"`. The OpenAPI also mentions `d1:latest` / `d1-ultra:latest` aliases that always point to the newest model of their family. |
| `state` | "The content the questions are about: plain text, or structured JSON such as a chat log or record. Omit or send null when the questions stand alone." This is where instructions/context/rubric text goes. |
| `questions` (required) | Object keyed by question name (not an array). Up to 128. Answers come back under the same keys. |
| `images` | Optional. Up to 8 images (exactly 1 with a `box`/`boxes` question). |
| `audio` | Optional. Clips as base64 `data:audio/...` URLs or `{content_type, base64}`. WAV/MP3/FLAC/OGG. |

Question types: `noul` (boolean), `choice`, `score`, plus the d1.2-only typed answers `text`, `number`, `date`, `spans`, `box`, `boxes`, `number` with `range`, and `choice` with `"multiple": true`. Earlier models return `422` on the typed answers.
- **Choice:** `criteria` maps 2–255 option names to a description or null.
- **Score:** `criteria` is an ordered list of 2–10 level descriptions.
- **Noul (boolean auxiliary question):** `{"type": "noul", "instructions": "..."}`. It takes optional `criteria` of `{ "true": …, "false": … }`, "used only when both are given and say more than a bare yes and no".
- `instructions` is "a string or JSON".

Verbatim request: choice + boolean, from https://docs.liquid.ai/api/guides/decisions
```bash
curl https://api.liquid.ai/decisions/v1/systemone \
  -H "Authorization: Bearer $LIQUID_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "d1.2",
    "state": "Help! My payouts have been failing for 3 days.",
    "questions": {
      "department": {
        "type": "choice",
        "instructions": "Which team should handle this?",
        "criteria": { "billing": "Payments", "technical": "Bugs, outages", "sales": "Pricing" }
      },
      "is_urgent": { "type": "noul", "instructions": "Does this convey urgency?" }
    }
  }'
```

### Response shape
Verbatim example from the OpenAPI reference (https://docs.liquid.ai/api/reference/decision-models/make-decisions), converted from YAML to JSON:
```json
{
  "model": "$DECISION_MODEL_ID",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "technical",
      "probabilities": { "billing": 0.31, "technical": 0.67, "sales": 0.02 },
      "confidence": 0.5
    },
    "is_urgent": { "type": "noul", "noul": 0.95 },
    "frustration": {
      "type": "score",
      "score": 1.05,
      "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      "probabilities": { "0": 0, "1": 0.95, "2": 0.05 },
      "confidence": 0.92
    }
  },
  "usage": { "input_tokens": 912, "output_tokens": 0 }
}
```
Field meanings from the reference:
- **Choice:** `choice`, `probabilities` per option (an object keyed by option name), `confidence`.
- **Score:** `score` ("probability-weighted, may fall between levels"), `legend`, `probabilities` per level index (string keys), `confidence`.
- **Noul:** `noul`, "the probability of yes".
- **Confidence:** "runs from 0 (probability spread evenly) to 1 (all on one answer); for a Score it also counts how far the probability sits from the most likely level, so a split between the two ends of the scale is 0."
- **Multiple choice** (d1.2 page): `{"type": "choice", "choices": ["billing", "delivery"], "probabilities": {...}}`. Each probability is an independent yes/no, so they don't sum to 1.

### Token usage
- `usage: { input_tokens, output_tokens }`, "plus `cost` in USD when the model is priced". "Output is always 0."
- `input_tokens` counts the state, images and audio once, plus each question's own tokens (its instructions, options and answer slots).

### Images
- Each image is a base64 `data:image/...;base64,` URL or `{ "content_type": "image/jpeg", "base64": "<BASE64_ENCODED_IMAGE>" }`. "Remote image URLs are not accepted."
- Formats: JPEG, PNG, WebP. Limits: 5 MB per image, 4.5 MB for the whole JSON body, at most 10,000 32×32 patches per request, and an aspect ratio of at most 100:1.
- Images come before the state in the prompt, and every question sees all of them.
- As an alternative, an array `state` may hold OpenAI-style `{ "type": "image_url", "image_url": { "url": "data:…" } }` parts. You cannot send both that and `images` (422).
- Cost: `image_tokens = ceil(ceil(w/32) × ceil(h/32) × 1.5)`. A 1024×1024 image is 1,536 tokens, billed once per request.

Verbatim (https://docs.liquid.ai/lfm/models/d1, Image Inputs):
```json
{
  "model": "d1.2",
  "state": "Camera image of a circuit board on the production line.",
  "images": ["data:image/jpeg;base64,$IMAGE_BASE64"],
  "questions": {
    "defect": {
      "type": "noul",
      "instructions": "Does this circuit board have a visible defect?"
    }
  }
}
```

### Limits, pricing, rate limits, errors
- **Models and prices** (https://docs.liquid.ai/lfm/models/d1):

  | Model | Inputs | Input price per 1M tokens | Input limit per question |
  |---|---|---|---|
  | `d1.2-ultra` | Text, images, audio | $0.042 | 65,536 tokens |
  | `d1.2` | Text, images, audio | $0.02 | 65,536 tokens |

  Both are billed on input tokens only, and output is free. Each question is also limited to 250,000 bytes of text. A request may be up to 4.5 MB and 128 questions.
- **Rate limits** are per organization and per model, shown on the console Models page. They can cover requests per minute or second and estimated tokens per minute or second. Token estimates are "four characters of request text per token plus 1,500 per image and 10 per second of audio".
  - Rate-limit headers: `x-ratelimit-limit|remaining|reset-requests` and `x-ratelimit-limit|remaining|reset-tokens`.
  - Over the limit: `429` + `Retry-After` (seconds). A model at capacity returns `503` `server_is_overloaded` + `Retry-After`.
- **Errors** use the OpenAI shape:
  ```json
  { "error": { "message": "...", "type": "rate_limit_error", "param": null, "code": "rate_limit_exceeded" } }
  ```

  | Status | Meaning |
  |---|---|
  | 400 | Invalid request |
  | 401 | Bad key |
  | 402 | Insufficient quota |
  | 403 | Permission error |
  | 404 | Unknown model |
  | 413 | Request body over 4.5 MB for decisions |
  | **422** | Decisions validation failure |
  | 429 | Rate limit exceeded |
  | 499 | Client closed the request |
  | 502 | Backend error |
  | 503 | Model at capacity or unavailable |
  | 504 | Backend timeout |

  Retry `429` and `5xx`, and don't retry other `4xx`.
- **Few-shot examples:** there is no documented few-shot field. The only hook is that `state` and `instructions` accept free text or JSON.
- **Per-question refusals:** none documented for Liquid. Not-found typed answers return `found` ≈ 0 and a `null` value.

---

## 2. OpenAI Decisions API (`POST /v1/decisions`, `gpt-6-luna`)

Sources:
- Guide: https://developers.openai.com/api/docs/guides/decisions (markdown: `.../decisions.md`)
- Reference: https://developers.openai.com/api/reference/resources/decisions/methods/create
- Model page: https://developers.openai.com/api/docs/models/gpt-6-luna

### Base URL, auth, endpoint
- `POST https://api.openai.com/v1/decisions`, with `Authorization: Bearer $OPENAI_API_KEY`.
- SDKs: `client.decisions.create(...)` (Python, TS, Ruby, Java) and `client.Decisions.New` (Go).
- "`gpt-6-luna`, the only currently supported model." The API is generally available now; before that it was a public beta.

### Request fields (from the reference)
- **`model`:** `"gpt-6-luna"`.
- **`input`:** a string, or an ordered array of items. Supported items:
  - `user` messages: `input_text`, `input_image`, `input_json` parts
  - `developer` / `system` messages: text only ("system messages are treated as developer messages")
  - `assistant` messages: `output_text` or `refusal` parts
  - `function_call` / `function_call_output` and `custom_tool_call` / `custom_tool_call_output`, matched by `call_id`

  "Files, audio, and item references aren't supported." The instructions/state/rubric goes here, for example as a developer message plus user content.
- **`questions`:** an **array** of 1–400 items. "Answers come back in the same order." Each item has `type`, `instructions` and an optional `name`; the guide says to give each question a unique `name`.
  - **`predicate`:** a yes/no question. This is the boolean auxiliary question.
  - **`choice`:** `choices: [{ "value": string|boolean, "description"?: string }]`, 2–255 unique values. "Include a fallback option such as `"other"`."
  - **`score`:** `levels: [{ "label", "description"? }]`, 2–10 levels ordered lowest to highest. Indices start at 0.
  - `instructions` can be a string or a non-empty array of `input_text` / `input_image` / `input_json` parts. These are per-question images.
- **Optional fields:**
  - `prompt_cache_key`
  - `prompt_cache_options { mode: "implicit"|"explicit", ttl: "30m" }`
  - `prompt_cache_breakpoint: {"mode":"explicit"}` on input parts (not in question instructions); the minimum cacheable prefix is 1,024 tokens
  - `safety_identifier`
- **Images:** `{"type": "input_image", "image_url": "data:...|https://...", "detail"?: "low"|"high"|"auto"|"original"}`. "This endpoint doesn't support `file_id` inputs."
- **Few-shot examples:** there is no dedicated field. The guide only says "Use labeled examples from your application to set thresholds".

Verbatim choice request (guide):
```bash
curl https://api.openai.com/v1/decisions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-6-luna",
    "input": "I was charged twice for my order.",
    "questions": [{
      "type": "choice",
      "name": "department",
      "instructions": "Which department should handle this complaint?",
      "choices": [
        {"value": "billing", "description": "Payments, invoices, and refunds."},
        {"value": "technical", "description": "Problems using the product."},
        {"value": "shipping", "description": "Delivery and tracking."},
        {"value": "other", "description": "Requests outside these categories."}
      ]
    }]
  }'
```
Verbatim image + predicate request (guide):
```json
{
  "model": "gpt-6-luna",
  "input": [{
    "role": "user",
    "content": [
      {"type": "input_text", "text": "Inspect the product in this photo."},
      {"type": "input_image", "image_url": "data:image/png;base64,$IMAGE_BASE64"}
    ]
  }],
  "questions": [{
    "type": "predicate",
    "name": "visible_damage",
    "instructions": "Does the product have visible damage, such as a crack, tear, or dent? Ignore shadows and damage to the packaging."
  }]
}
```

### Response shape
`Decision { answers, model, usage }`. `answers` is an **array** in question order. Verbatim excerpts:

Choice (guide):
```json
{
  "answers": [
    {
      "type": "choice",
      "name": "department",
      "choice": "billing",
      "probabilities": [
        { "value": "billing", "probability": 0.95 },
        { "value": "technical", "probability": 0.02 },
        { "value": "shipping", "probability": 0.01 },
        { "value": "other", "probability": 0.02 }
      ],
      "confidence": 0.93
    }
  ]
}
```
Score (guide):
```json
{
  "answers": [
    {
      "type": "score",
      "name": "severity",
      "score": 1.1,
      "probabilities": [
        { "value": 0, "label": "Cosmetic", "probability": 0.1 },
        { "value": 1, "label": "Workaround available", "probability": 0.7 },
        { "value": 2, "label": "Fully blocked", "probability": 0.2 }
      ],
      "confidence": 0.55
    }
  ]
}
```
Full response with usage (reference):
```json
{
  "model": "gpt-6-luna",
  "answers": [
    {"type": "predicate", "name": "damaged", "probability": 0.95}
  ],
  "usage": {
    "input_tokens": 42,
    "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0},
    "output_tokens": 0,
    "output_tokens_details": {"reasoning_tokens": 0},
    "total_tokens": 42
  }
}
```
- A predicate answer returns `probability` (0–1).

### Per-question refusals
From the reference: "Any question can return a refusal instead of an answer; other questions can still receive answers. A refusal has `type: "refusal"` and the question's `name`, or `null` if it was unnamed." The refusal object is `{ "name": string|null, "type": "refusal" }`. It has no reason field. The SDK samples check `answer.type === "refusal"` before reading the other fields.

### Usage, pricing, rate limits, errors
- **Usage fields:**
  - `input_tokens`
  - `input_tokens_details.cached_tokens`
  - `input_tokens_details.cache_write_tokens`
  - `output_tokens`
  - `output_tokens_details.reasoning_tokens`
  - `total_tokens`

  The cache counts are included in `input_tokens` ("don't add them to that total").
- **Org usage:** `GET /v1/organization/usage/decisions` (admin key with `api.usage.read`). `num_model_requests` counts requests, not questions.
- **Pricing (guide):** "uncached input costs **$0.10 per 1M tokens**". Cache hits are discounted, and cache writes are charged at standard `gpt-6-luna` caching rates. "Output tokens are not charged." Regional processing premiums and long-context multipliers apply.
  - The model page lists cached input at $0.01/1M and cache writes at $0.125/1M.
  - The model page also says prompts over 272K input tokens cost 2x for input and cache tokens, and regional processing adds 10%.
- **Rate limits:** the Decisions guide doesn't give any. The gpt-6-luna model page lists general limits (Build 5,000 RPM / 2M TPM; Launch 10,000 / 10M; Grow 30,000 / 180M), but its endpoint table does not list `v1/decisions`.
- **Errors:** the Decisions guide and reference don't give an error list.
- **Other:** ZDR, HIPAA, data residency and regional processing (US, EU) are supported for eligible customers.

---

## 3. Anthropic structured outputs on Claude Sonnet (brief)

Sources:
- https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- https://platform.claude.com/docs/en/build-with-claude/vision
- https://platform.claude.com/docs/en/about-claude/models/overview

### Model and pricing
- The latest Sonnet is **Claude Sonnet 5.5**, with API ID **`claude-sonnet-5-5`**. It has a 1M context window and 128K max output, and costs $2 / MTok input and $10 / MTok output.

### Request
- `POST https://api.anthropic.com/v1/messages` with these headers:
  - `x-api-key: $ANTHROPIC_API_KEY`
  - `anthropic-version: 2026-10-21`
  - `content-type: application/json`
- The schema goes in `output_config.format`. No beta header is needed; the older `output_format` parameter is deprecated.

Verbatim from the docs (which use `claude-opus-5-5`; swap in `claude-sonnet-5-5`):
```json
"output_config": {
  "format": {
    "type": "json_schema",
    "schema": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "email": {"type": "string"},
        "plan_interest": {"type": "string"},
        "demo_requested": {"type": "boolean"}
      },
      "required": ["name", "email", "plan_interest", "demo_requested"],
      "additionalProperties": false
    }
  }
}
```
- The JSON comes back in the response's `text` content block.

### Schema rules and limits
- **Schema limitations:**
  - `additionalProperties` must be `false`.
  - No `minimum`/`maximum`, no `minLength`/`maxLength`, no recursion, no `oneOf`.
  - `enum` is supported, but its capitalization isn't guaranteed: "compare enum values case-insensitively".
  - Limits: 24 optional parameters and 16 union-typed parameters across all strict schemas.
- **Invalid outputs:**
  - `stop_reason: "refusal"`: HTTP 200, billed, and the output may not match the schema.
  - `stop_reason: "max_tokens"`: the output may be truncated.
- **Incompatible features:** citations and prefill.

### Image input
Verbatim block from the vision docs:
```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/jpeg",
    "data": "$BASE64_IMAGE_DATA"
  }
}
```
- Other sources: `{"type": "url", "url": "https://..."}` or a Files API `file_id`. Only base64 is available on Bedrock and on Google-managed Google Cloud.
- Formats: JPEG, PNG, GIF, WebP.
- Limits: up to 600 images per request and 8000×8000 px per image. Request size is capped at 128 MB on the first-party API.
- The docs recommend putting images before text.

---

## Open questions (not found or ambiguous in the docs)

1. **Liquid, stale reference:** the OpenAPI reference still describes older models. It says the endpoint is "for typed Choice, Score, and Noul decisions from decision models such as `d1.1` and `d1-ultra`", and gives `d1-ultra` a 32,768-token limit. The d1.2 page gives 65,536 tokens for both d1.2 models. The d1.2 page should be the one to trust, but this is not stated.
2. **Liquid, few-shot:** there is no documented few-shot or examples mechanism. Whether putting examples in `state` or `instructions` helps is not documented.
3. **Liquid, refusals:** there is no per-question refusal or failure answer type documented. What happens when the model can't answer one question (beyond `found` for typed answers) is unspecified.
4. **Liquid, rate limits:** the default per-org numbers for d1.2 / d1.2-ultra aren't published; they appear only in the console.
5. **Liquid, image limit wording:** the per-image 5 MB limit is larger than the 4.5 MB body limit, so the body limit binds in practice.
6. **Liquid, `cost` field:** `usage.cost` is present only "when the model is priced". Whether d1.2 responses include it is not shown in any d1.2 example.
7. **OpenAI, image limits:** the guide mentions "the request's image limits" but doesn't state the numbers (count, size, dimensions).
8. **OpenAI, rate limits:** no Decisions-specific rate limits are documented. Whether the gpt-6-luna model-page RPM/TPM apply to `/v1/decisions` is unclear, since that page's endpoint table omits Decisions.
9. **OpenAI, errors:** no Decisions-specific error codes are documented (for example, the status for more than 400 questions or invalid choices). The generic OpenAI error format presumably applies, but this is not stated on these pages.
10. **OpenAI, few-shot:** there is no documented few-shot mechanism. Putting labeled examples in developer or user messages in `input` is not described.
11. **OpenAI, refusal details:** a refusal carries no reason or category, and whether a refused question is billed is not stated.
12. **OpenAI, confidence:** there is no formula or definition for `confidence` on choice and score answers. Liquid does define its own.
13. **Anthropic, Sonnet 5.5 specifics:** the structured-outputs examples use `claude-opus-5-5`. Its availability section says the feature works on all models, but there is no Sonnet-specific example.
