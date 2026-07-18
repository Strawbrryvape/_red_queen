# Red Queen v3.1.2 — Markdown Presentation Layer
Cumulative: v3.0.2 + Task 1 + Task 2 + Task 4 + v3.1.1 catalog + v3.1.2 markdown.
**This single file supersedes everything.** 2,162 (live) → 2,465 lines.
Includes the OpenRouter dead-model fix tooling. One paste, one commit.

## The bug
Council verdicts arrive as markdown — models write paragraphs, lists, fenced
code. `consensusText.textContent = trustPrefix + answer` flattened all of it
into one wall of text. Same for the Divided Council seat cards.

## What ships
- **Self-bootstrapping loader** — appends `marked@12.0.2` + `dompurify@3.1.6`
  to `document.head` at boot, 5s timeout, never blocks or delays a verdict.
- **Injected CSS** (`.rq-md`) — margins on `<p>`, padded/bordered `<pre>`,
  inline `<code>` chips, lists, headings, tables, blockquotes, `<hr>`.
- **Both render sites routed** through `renderRich()`:
  - the consensus verdict (`consensusText`)
  - Divided Council seat cards
- **Paint-then-upgrade** — plain text renders instantly, repaints rich when
  the engine lands. A verdict never waits on a CDN.

## ⚠ CSP — LIKELY BLOCKER. VERIFY BEFORE ASSUMING THIS WORKS.
index.html carries a CSP meta tag (amended 2026-07-13 for the Cerebras host).
**No CDN script is loaded anywhere else in app.js**, so `script-src` almost
certainly does not allow jsdelivr. If so the browser blocks both libraries and
this layer falls back permanently — silently, except for one log line.

To enable, `script-src` in index.html's CSP needs:

    https://cdn.jsdelivr.net

**This is an index.html edit, which BREAKS the zero-HTML-change doctrine.**
That is a ruling for Kimi, not a decision Fable can make. Options:
- **(a)** amend the CSP — one host, well-scoped, two audited libraries
- **(b)** accept the fallback — see below; it is not a consolation prize
- **(c)** write a native markdown renderer in app.js — no CDN, no CSP change,
  no innerHTML at all (build DOM via createElement/textContent). Strictly
  safer and fully doctrine-compliant. ~150 lines. Fable recommends this as
  the real answer if (a) is refused.

## The fallback fixes your actual complaint
Reported bug: *"flattens all paragraph spacing."* `white-space: pre-wrap`
fixes exactly that — zero dependencies, zero CSP change, zero XSS surface.
If the CDNs are blocked you still get paragraph spacing; you lose rich
bullets and styled code blocks. **Ship it either way.**

## SECURITY — the doctrine tension, stated plainly
app.js line ~1528 declared: *"Cards render via textContent, never innerHTML:
model output is untrusted input."* This layer deliberately introduces
innerHTML for model output. That is a real XSS surface — a seat is a
rate-limited free-tier stranger that can emit `<img onerror=...>`.

DOMPurify is the entire mitigation, so the gate is absolute:

    innerHTML is used IF AND ONLY IF DOMPurify is present and sanitizing.
    marked without DOMPurify => NO HTML. Fall back. No exceptions.

Tested: with marked loaded and DOMPurify missing, the code **refuses** to use
innerHTML and reverts to text. `onerror` payloads are stripped. A throwing
parser degrades to text, never to a blank card. The stale doctrine comment at
line ~1528 has been amended rather than left lying in the file.

Exactly **one** new innerHTML site (line ~1048), inside the gate. Every other
innerHTML in the file is pre-existing (clearing containers, static app copy).

## Not touched
`checkConsensus`, `AGREEMENT_THRESHOLD` (0.22), `hasPrimaryVoice`, seat
dispatch, failover, history logging. Presentation only — no verdict can
change. Note this layer makes the broken comparator's output *prettier*, not
more correct; the §2 petition still stands.

## Tests
13/13 pass: no-libraries fallback, the marked-without-DOMPurify security gate,
both-loaded rich path, XSS strip, parser-throws degradation, and
upgrade-in-place. `node --check` clean, 32/32 features present.

## Upload
Extract → open app.js → select all → copy → GitHub → app.js → pencil → select
all → paste → commit. **Only app.js.** If anything suggests editing
index.html, that is the CSP question above — rule on it first.

After upload: Settings → **LIST FREE MODELS** → paste two family-safe slugs
into `OR_SEAT_MODELS.gemini` → **TEST OPENROUTER MODELS** → confirm ✓ LIVE.
That closes the Gemini seat's missing floor.
