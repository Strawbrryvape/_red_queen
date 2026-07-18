# Red Queen v3.1 — TASK 2: Dead Model Swap + Liveness Test
Upload order: **2 of 3**. Cumulative — contains v3.0.2 + Task 1 + Task 2.

## What changed
1. **`openai/gpt-oss-120b:free` removed** (404, live 2026-07-17).
2. **Gemini seat OR chain now has depth 2** (was a list of ONE):
   `["mistralai/mistral-7b-instruct:free", "qwen/qwen-2.5-72b-instruct:free"]`
3. **New "TEST OPENROUTER MODELS" button** in the settings sheet.

## Root cause of the Gemini seat's disappearance (session #37)
The Gemini seat had exactly one OpenRouter entry and it was dead:
`Gemini 429 → Cerebras 429 → OR gpt-oss 404 → nothing left to walk to.`
Kimi and Claude seats each had two OR models; Gemini had zero depth. This
was not a rate-limit problem — it was a **missing floor**. Fixed.

## Ordering deviation from Amendment B — needs Kimi's eye
Amendment B proposed `qwen-2.5-72b` first. **Line ~753 of this same file
records qwen-2.5-72b as already killed from the OR catalog on 2026-07-13.**
It is kept as the *deeper* slot rather than dropped (free catalogs churn both
ways; a dead deep slot costs nothing but a log line). Mistral leads.
Precedent: gpt-oss was demoted on evidence over Gemini's memo endorsement —
same rule applied to Kimi's here. Evidence beats endorsement.

## Amendment B is partly unsatisfiable — flagged, not silently dropped
Amendment B requires the replacement be "via a provider DIFFERENT from the
rest of Gemini's chain." **Every entry in OR_SEAT_MODELS is OpenRouter by
definition** — that is what the map is. What was achievable and delivered is
*model-family* diversity (Qwen=Alibaba, Mistral=Mistral AI — no collision
with Gemma/Google, Nemotron/NVIDIA, Llama/Meta, GLM/Zhipu) plus walk depth.
True provider diversity for the Gemini seat needs a **non-OpenRouter fourth
link in the chain itself** — that is the correlated-failover docket item, not
a Task 2 config edit.

## VERIFICATION REQUIRED BEFORE COMMIT
Fable has **no network access** and could not test-dispatch either slug.
Run **TEST OPENROUTER MODELS** in the settings sheet, read the drawer:
- `✓ LIVE` — model answered non-empty. Kimi's requirement satisfied.
- `✗ DEAD (404)` — swap it out before commit.
- `✗ RATE-LIMITED (429)` — inconclusive, retest later.
It walks every model in every seat's chain via the **real**
`callOpenRouterModel` path (pacing, 404 detector, `<think>` strip, empty-answer
guard included) — not a mock. Reusable for every future model swap.

## Known pre-existing issue (NOT introduced here, needs a ruling)
Kimi and Claude seats share both OR models in reverse order (gemma/nemotron).
If one seat walks, both can land on the **same model simultaneously** —
correlated voices scored as independent ones. Out of scope for v3.1.

## Doctrine compliance
Zero HTML change (button injected via JS, guarded). textContent only.
No consensus logic touched. `node --check` clean; 32/32 features present;
walk depth ≥2 on all three seats.
