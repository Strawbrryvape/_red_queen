  /* Red Queen v2.1 — Command Center logic
   Demo mode: if no API keys are saved (or Demo Mode is toggled on, or all live
   calls fail), the Council is simulated locally. The UI never shows an error
   box on the main canvas — failures are logged quietly to the drawer. */

(function () {
  "use strict";

  // ---------- Build stamp (deploy verification, added 2026-07-19) ----------
  // Bump this string on every shipped change. If it is NOT visible in the
  // browser console AND at the top of the drawer log after a deploy, you are
  // running a STALE/CACHED build — hard-clear and redeploy. Verify by THIS
  // message, never by line count. Root cause of the "nothing works" week:
  // the live site ran a pre-v3.2 build for days while GitHub had v3.3. The
  // tell was the divided-round log wording ("FAILED by design" = old build,
  // "FAILED by lexical threshold" = v3.2+). This stamp ends that guessing.
  const RQ_BUILD = "v3.4.2-feedback+display+2026-07-19";
  try { console.log("%c[Red Queen] build " + RQ_BUILD, "color:#c0392b;font-weight:bold;font-size:13px"); } catch (_) {}

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const consensusBar = $("consensusBar");
  const consensusText = $("consensusText");
  const summonBtn = $("summonBtn");
  const bottomSheet = $("bottomSheet");
  const sheetScrim = $("sheetScrim");
  const queryInput = $("queryInput");
  const sendBtn = $("sendBtn");
  const drawer = $("drawer");
  const drawerScrim = $("drawerScrim");
  const menuBtn = $("menuBtn");
  const drawerClose = $("drawerClose");
  const historyList = $("historyList");
  const errorList = $("errorList");
  const demoBadge = $("demoBadge");
  const newSessionBtn = $("newSessionBtn");
  const saveSettingsBtn = $("saveSettings");
  const demoToggle = $("demoToggle");

  const agents = {
    gemini: $("agent-gemini"),
    kimi: $("agent-kimi"),
    claude: $("agent-claude"),
  };

  // ---------- Settings ----------
  const SETTINGS_KEY = "rq_settings_v21";

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
      return {};
    }
  }
  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  let settings = loadSettings();
  $("keyGemini").value = settings.keyGemini || "";
  $("keyKimi").value = settings.keyKimi || "";
  $("keyClaude").value = settings.keyClaude || "";
  $("keyGroq").value = settings.keyGroq || "";
  $("keyOpenRouter").value = settings.keyOpenRouter || "";
  // Cerebras input is optional in the HTML — guard so the app still boots if
  // index.html hasn't been updated yet (prevents a dead-buttons failure mode).
  const keyCerebrasEl = $("keyCerebras");
  if (keyCerebrasEl) keyCerebrasEl.value = settings.keyCerebras || "";
  // v2.9: Supabase institutional-memory fields. If index.html lacks the
  // inputs, inject them into the settings sheet dynamically — same
  // zero-HTML-change doctrine as the Divided Council panel.
  (function ensureSupabaseFields() {
    if (!$("supabaseUrl") && keyCerebrasEl && keyCerebrasEl.parentNode) {
      // v2.9.3: permanent <label> elements, not placeholder-as-label —
      // placeholders vanish once values are pasted, leaving anonymous
      // boxes (live confusion 2026-07-14, and the prime suspect for a
      // swapped URL/key causing "Failed to fetch"). URL field is type
      // text: a project URL is not a secret and must be verifiable by eye.
      const mk = (id, labelText, type, ph) => {
        const label = document.createElement("label");
        label.htmlFor = id;
        label.textContent = labelText;
        label.style.cssText = "display:block;margin-top:10px;font-size:0.75em;letter-spacing:0.03em;opacity:0.8;";
        const el = document.createElement("input");
        el.type = type;
        el.id = id;
        el.placeholder = ph;
        el.autocomplete = "off";
        el.className = keyCerebrasEl.className || "";
        el.style.marginTop = "4px";
        const host = keyCerebrasEl.parentNode;
        host.appendChild(label);
        host.appendChild(el);
      };
      mk("supabaseUrl", "SUPABASE PROJECT URL (institutional memory)", "text", "https://yourproject.supabase.co");
      mk("supabaseAnonKey", "SUPABASE ANON KEY (institutional memory)", "password", "eyJ… (the long anon public key)");
    }
    if ($("supabaseUrl")) $("supabaseUrl").value = settings.supabaseUrl || "";
    if ($("supabaseAnonKey")) $("supabaseAnonKey").value = settings.supabaseAnonKey || "";
  })();
  demoToggle.checked = !!settings.demoMode;

  function hasAnyKey() {
    return !!(settings.keyGemini || settings.keyKimi || settings.keyClaude || settings.keyGroq || settings.keyOpenRouter || settings.keyCerebras);
  }
  function inDemoMode() {
    return settings.demoMode || !hasAnyKey();
  }
  function refreshDemoBadge() {
    demoBadge.classList.toggle("hidden", !inDemoMode());
  }
  refreshDemoBadge();

  // Cerebras model choice (declared early — referenced by boot-time seat labels).
  // Cerebras's free catalog churns — if calls 404, check cloud.cerebras.ai
  // for the current list and swap these two strings.
  const CEREBRAS_MODEL = "zai-glm-4.7";
  const CEREBRAS_MODEL_LABEL = "GLM 4.7";

  // Shared per-agent output budget. 300 proved too small in live testing
  // (2026-07-12): agents asked for reasoning + a FINAL DIRECTIVE got cut off
  // mid-sentence, guaranteeing consensus failure. Raised to 1000 per Kimi
  // review — verbose reasoners (Qwen, gpt-oss) need headroom so truncation
  // hits reasoning fluff, never the anchor. Clears free-tier limits with
  // the staggered dispatch.
  const MAX_TOKENS = 1000;
  // v2.7.2 (2026-07-13, FLAGGED FOR KIMI REVIEW): reasoning models need
  // doubled headroom. Evidence from two live failures tonight: GLM 4.7
  // burns budget inside <think> blocks, truncates MID-THOUGHT, and the
  // truncation-safe strip then correctly discards the unclosed reasoning
  // — leaving an empty answer ("failed: unknown error"). GLM's repeated
  // "folds" were our ceiling, not its reliability. This is the original
  // "second audition at doubled token headroom" plan, now with a
  // confirmed mechanism. Applied to Cerebras (GLM) and OpenRouter
  // (hosts Nemotron, which also truncated twice tonight).
  const REASONING_MAX_TOKENS = 2000;
  // v2.9.2 (2026-07-14): GLM's final appeal. At 2000 it produced "as"
  // then thought itself to death (all budget burned in an unclosed
  // <think>, correctly stripped). One last doubling, Cerebras seat only
  // — 10 dispatches at 4000 is 4% of the 1M/day quota. If GLM fails at
  // 4000 the diagnosis is confirmed UNBOUNDED REASONER (thinks past any
  // budget) and the seat recasts per Kimi's standing eviction ruling —
  // with the accurate cause of death recorded in her memory.
  const CEREBRAS_MAX_TOKENS = 4000;

  // ---------- Understudy state (Groq filling Claude's seat, Cerebras filling Gemini's) ----------
  function groqUnderstudy() {
    return !settings.keyClaude && !!settings.keyGroq;
  }
  function cerebrasUnderstudy() {
    return !settings.keyGemini && !!settings.keyCerebras;
  }
  const seatProvider = {}; // per-dispatch: name -> "primary" | "groq" | "cerebras" | "openrouter"

  // Consensus weight hierarchy (founder decision 2026-07-12):
  // primaries carry full weight; free-tier voices keep the workflow
  // alive but must not outvote Gemini Pro / Kimi / Claude.
  // Cerebras joins at the dedicated-provider understudy tier (0.75), same as Groq.
  const SEAT_WEIGHTS = { primary: 1.0, groq: 0.75, cerebras: 0.75, openrouter: 0.5 };
  function seatWeight(name) {
    return SEAT_WEIGHTS[seatProvider[name] || "primary"];
  }
  function seatLabel(name) {
    const cap = name[0].toUpperCase() + name.slice(1);
    if (seatProvider[name] === "openrouter") {
      const m = ((orActiveModel[name] || (OR_SEAT_MODELS[name] || [])[0]) || "").split("/").pop().replace(":free", "");
      return `${cap} [fallback: OpenRouter ${m}]`;
    }
    if (name === "claude" && groqUnderstudy()) return "Claude [Groq understudy: Llama 3.3]";
    if (name === "gemini" && (seatProvider[name] === "cerebras" || cerebrasUnderstudy())) return "Gemini [Cerebras: " + CEREBRAS_MODEL_LABEL + "]";
    return cap;
  }

  // ---------- v3.1 Task 4: TIER_DECAY (SHADOW MODE) ----------
  // Kimi-ratified 2026-07-17. PROPOSED schedule, NOT yet ratified — config
  // edit, not a code change, if the values move.
  //
  // SCOPE CORRECTION (Fable, 2026-07-17): Task 4's stated purpose was "weight
  // degrades with provenance." It ALREADY DOES — SEAT_WEIGHTS is provider-keyed
  // and seatWeight() reads the live seatProvider. The petition's premise was
  // wrong. What genuinely does NOT exist is WALK DEPTH: a seat on OpenRouter
  // slot 1 and a seat that failed and walked to slot 2 both score 0.5 today.
  // Tiers 2 and 3 below are the only new information in this table.
  //
  // DOUBLE-COUNT WARNING — REQUIRES KIMI'S RULING BEFORE ANY PROMOTION:
  // the spec says weightEffective = weightBase * TIER_DECAY[tier]. Because
  // weightBase is ALREADY provider-decayed, this multiplies the same penalty
  // twice. Example: Claude seat on Groq = base 0.75 (already decayed from 1.0)
  // x TIER_DECAY[1] 0.7 = 0.53 — a 47% penalty for one failover hop. That is
  // almost certainly not what was intended. Implemented literally as specced so
  // the ratified schedule is testable in shadow, and logged side-by-side with
  // the live weight so the divergence is measurable rather than argued.
  // Options for the ruling: (a) TIER_DECAY REPLACES SEAT_WEIGHTS as the single
  // source of truth, (b) decay applies to WALK DEPTH ONLY on top of the
  // existing provider weight, (c) schedule is re-cut to compose correctly.
  // NOTHING IS PROMOTED TO CONSENSUS UNTIL THIS IS RULED ON.
  const TIER_DECAY = { 0: 1.0, 1: 0.7, 2: 0.5, 3: 0.35, floor: 0.25 };

  // tier 0 = primary | 1 = dedicated understudy (Groq/Cerebras)
  // tier 2 = OpenRouter slot 1 | tier 3+ = walked-to OpenRouter slot
  function seatTier(name) {
    const p = seatProvider[name] || configuredProvider(name);
    if (p === "groq" || p === "cerebras") return 1;
    if (p === "openrouter") {
      const list = OR_SEAT_MODELS[name] || [];
      const idx = list.indexOf(orActiveModel[name] || "");
      return 2 + (idx > 0 ? idx : 0);
    }
    return 0;
  }
  function seatWeightEffective(name) {
    const t = seatTier(name);
    const decay = typeof TIER_DECAY[t] === "number" ? TIER_DECAY[t] : TIER_DECAY[3];
    const w = seatBaseWeight(name) * decay;
    return Math.max(TIER_DECAY.floor, Math.round(w * 100) / 100);
  }

  // ---------- v3.1 Task 1: Seat Health Badge (Kimi-ratified 2026-07-17) ----------
  // Renders the ACTUAL occupant of each chair in the seat header instead of
  // only in the drawer logs. Zero-HTML-change doctrine: styles injected here,
  // same pattern as the Divided Council panel. textContent only — model
  // output and model names are untrusted input.
  //
  // AUDIT CORRECTION (Fable, 2026-07-17): the v3.1 petition asserted that
  // weight was seat-keyed and never degraded on failover. That was WRONG.
  // SEAT_WEIGHTS has been provider-keyed since 2026-07-12 and seatWeight()
  // reads the LIVE seatProvider, which the failover chain mutates. A
  // Groq-occupied Claude seat has always scored 0.75, never 1.0. This badge
  // therefore SURFACES a degradation that already existed; it does not
  // introduce one. Task 4's only real gap is walk depth inside OpenRouter.
  const PRIMARY_MODEL_LABELS = {
    gemini: "Gemini 2.0 Flash",
    kimi: "Moonshot v1 8k",
    claude: "Claude Haiku 4.5",
  };

  // The provider a seat is CONFIGURED to use, before any failover walk.
  // This is the baseline the badge degrades FROM.
  function configuredProvider(name) {
    if (name === "claude" && groqUnderstudy()) return "groq";
    if (name === "gemini" && cerebrasUnderstudy()) return "cerebras";
    return "primary";
  }
  function seatBaseWeight(name) {
    const w = SEAT_WEIGHTS[configuredProvider(name)];
    return typeof w === "number" ? w : 1.0;
  }
  function seatModelLabel(name) {
    const p = seatProvider[name] || configuredProvider(name);
    if (p === "openrouter") {
      const slug = (orActiveModel[name] || (OR_SEAT_MODELS[name] || [])[0]) || "";
      const m = slug.split("/").pop().replace(":free", "");
      return "OpenRouter: " + (m || "\u2014");
    }
    if (p === "groq") return "Groq: Llama 3.3";
    if (p === "cerebras") return "Cerebras: " + CEREBRAS_MODEL_LABEL;
    return PRIMARY_MODEL_LABELS[name] || "primary";
  }

  let seatHealthStyled = false;
  function ensureSeatHealthStyles() {
    if (seatHealthStyled) return;
    seatHealthStyled = true;
    const style = document.createElement("style");
    style.textContent = [
      ".seat-health { margin-top: 4px; font-size: 0.62em; line-height: 1.35; letter-spacing: 0.03em; text-align: center; opacity: 0.75; }",
      ".seat-health .sh-model { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 96px; margin: 0 auto; }",
      ".seat-health .sh-weight { display: block; opacity: 0.85; }",
      ".seat-health.degraded { opacity: 0.95; }",
      ".seat-health.degraded .sh-weight { color: #f59e0b; }",
    ].join("\n");
    document.head.appendChild(style);
  }

  // Boot-safe: wrapped so a missing DOM node or an early call can never
  // dead-button the app (same guard doctrine as the Cerebras settings field).
  function renderSeatHealth(name) {
    try {
      const el = agents[name];
      if (!el) return;
      ensureSeatHealthStyles();
      let box = el.querySelector(".seat-health");
      if (!box) {
        box = document.createElement("div");
        box.className = "seat-health";
        const m = document.createElement("span");
        m.className = "sh-model";
        const w = document.createElement("span");
        w.className = "sh-weight";
        box.appendChild(m);
        box.appendChild(w);
        el.appendChild(box);
      }
      const base = seatBaseWeight(name);
      const eff = seatWeight(name);
      const degraded = eff < base;
      box.classList.toggle("degraded", degraded);
      box.querySelector(".sh-model").textContent = seatModelLabel(name);
      box.querySelector(".sh-weight").textContent = degraded
        ? base + " \u2192 " + eff
        : "weight " + eff;
      el.title = seatLabel(name) + " \u2014 weight " + eff + (degraded ? " (base " + base + ")" : "");
    } catch (e) {
      // never let a cosmetic badge break a dispatch
    }
  }
  function refreshAllSeatHealth() {
    Object.keys(agents).forEach(renderSeatHealth);
  }

  function markSeat(name, occupant, tooltip) {
    const el = agents[name];
    const nameEl = el.querySelector(".agent-name");
    if (occupant) {
      el.classList.add("shadowed");
      nameEl.dataset.occupant = occupant;
      if (tooltip) el.title = tooltip;
    } else {
      el.classList.remove("shadowed");
      delete nameEl.dataset.occupant;
      el.removeAttribute("title");
    }
    renderSeatHealth(name); // v3.1 Task 1 — badge follows the occupant
  }

  function refreshUnderstudyState() {
    if (groqUnderstudy()) {
      markSeat("claude", "groq", "Claude seat — powered by Groq (Llama 3.3)");
    } else {
      markSeat("claude", null);
    }
    if (cerebrasUnderstudy()) {
      markSeat("gemini", "cerebras", "Gemini seat — powered by Cerebras (" + CEREBRAS_MODEL_LABEL + ")");
    } else {
      markSeat("gemini", null);
    }
  }
  refreshUnderstudyState();

  // reset all seats to configured state (start of each dispatch)
  function resetSeatVisuals() {
    markSeat("kimi", null);
    refreshUnderstudyState();
    refreshAllSeatHealth(); // v3.1 Task 1
  }

  saveSettingsBtn.addEventListener("click", () => {
    settings = {
      keyGemini: $("keyGemini").value.trim(),
      keyKimi: $("keyKimi").value.trim(),
      keyClaude: $("keyClaude").value.trim(),
      keyGroq: $("keyGroq").value.trim(),
      keyOpenRouter: $("keyOpenRouter").value.trim(),
      keyCerebras: keyCerebrasEl ? keyCerebrasEl.value.trim() : (settings.keyCerebras || ""),
      supabaseUrl: $("supabaseUrl") ? $("supabaseUrl").value.trim() : (settings.supabaseUrl || ""),
      supabaseAnonKey: $("supabaseAnonKey") ? $("supabaseAnonKey").value.trim() : (settings.supabaseAnonKey || ""),
      demoMode: demoToggle.checked,
    };
    saveSettings(settings);
    // v2.9.3: Supabase field sanity checks — catch swapped or malformed
    // values at save time with plain-English corrections, instead of a
    // cryptic "Failed to fetch" at dispatch time.
    if (settings.supabaseUrl && settings.supabaseUrl.startsWith("eyJ")) {
      logError("Supabase URL field contains what looks like the ANON KEY (starts with eyJ). The two values are probably swapped — URL goes on top, key below.");
    }
    if (settings.supabaseAnonKey && /^https?:\/\//i.test(settings.supabaseAnonKey)) {
      logError("Supabase ANON KEY field contains what looks like a URL. The two values are probably swapped — URL goes on top, key below.");
    }
    if (settings.supabaseUrl && !/^https:\/\/.+\.supabase\.co\/?$/i.test(settings.supabaseUrl) && !settings.supabaseUrl.startsWith("eyJ")) {
      logError(`Supabase URL looks unusual ("${settings.supabaseUrl.slice(0, 40)}…"). Expected exactly https://yourproject.supabase.co — no extra path, no trailing text.`);
    }
    refreshDemoBadge();
    refreshUnderstudyState();

    saveSettingsBtn.textContent = "Saved";
    setTimeout(() => (saveSettingsBtn.textContent = "Save settings"), 1200);
  });

  // ---------- Drawer / Sheet ----------
  function openDrawer() {
    drawer.classList.add("open");
    drawerScrim.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    drawerScrim.classList.add("hidden");
    drawer.setAttribute("aria-hidden", "true");
  }
  menuBtn.addEventListener("click", openDrawer);
  drawerClose.addEventListener("click", closeDrawer);
  drawerScrim.addEventListener("click", closeDrawer);

  // swipe-right to close drawer
  let touchStartX = null;
  drawer.addEventListener("touchstart", (e) => (touchStartX = e.touches[0].clientX), { passive: true });
  drawer.addEventListener("touchend", (e) => {
    if (touchStartX !== null && e.changedTouches[0].clientX - touchStartX > 60) closeDrawer();
    touchStartX = null;
  }, { passive: true });

  function openSheet() {
    bottomSheet.classList.add("open");
    sheetScrim.classList.remove("hidden");
    bottomSheet.setAttribute("aria-hidden", "false");
    setTimeout(() => queryInput.focus(), 320);
  }
  function closeSheet() {
    bottomSheet.classList.remove("open");
    sheetScrim.classList.add("hidden");
    bottomSheet.setAttribute("aria-hidden", "true");
  }
  summonBtn.addEventListener("click", openSheet);
  sheetScrim.addEventListener("click", closeSheet);

  // ---------- Logging ----------
  function clearEmptyNote(list) {
    const note = list.querySelector(".empty-note");
    if (note) note.remove();
  }
  function logHistory(query, answer) {
    clearEmptyNote(historyList);
    const li = document.createElement("li");
    const q = document.createElement("span");
    q.className = "q";
    q.textContent = query;
    li.appendChild(q);
    li.appendChild(document.createTextNode(answer));
    historyList.prepend(li);
  }
  function logError(msg) {
    clearEmptyNote(errorList);
    const li = document.createElement("li");
    li.textContent = `${new Date().toLocaleTimeString()} — ${msg}`;
    errorList.prepend(li);
  }

  // ---------- Agent visual states ----------
  function setThinking(on) {
    Object.values(agents).forEach((a) => {
      a.classList.toggle("thinking", on);
      a.classList.remove("consensus");
    });
  }
  function flashConsensus() {
    Object.values(agents).forEach((a) => {
      a.classList.remove("thinking");
      a.classList.add("consensus");
    });
  }

  // ---------- Demo Council (local simulation) ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function demoConsensus(query) {
    const q = query.toLowerCase();
    const topic = query.replace(/[?.!]+$/, "").trim();

    if (/^(hi|hey|hello|yo)\b/.test(q)) {
      return "The Council convenes. Greetings acknowledged — state your problem and we will deliberate.";
    }
    if (q.includes("capital of france")) {
      return "Unanimous consensus in one round: Paris. The Council notes this required no deliberation.";
    }
    if (q.includes("who are you") || q.includes("what are you")) {
      return "We are the Council — Gemini, Kimi, and Claude — synthesized through Red Queen. Three perspectives, one answer.";
    }
    if (q.includes("meaning of life")) {
      return "Split vote: Gemini says 42, Kimi says purpose is constructed, Claude says it emerges through connection. Synthesis: build something that matters.";
    }

    const templates = [
      `The Council deliberated on "${topic}". Gemini favored breadth, Kimi pushed for precision, Claude weighed the tradeoffs. Consensus: proceed, but define your success criteria first.`,
      `Three perspectives converged on "${topic}". Synthesis: the core question is well-formed, but the Council recommends breaking it into two smaller decisions before acting.`,
      `Deliberation complete on "${topic}". Kimi's framing carried the vote, with amendments from Claude. Consensus: the simplest viable path is the right one here.`,
      `The Council reviewed "${topic}" in two rounds. Initial disagreement resolved on round two. Consensus: gather one more data point, then commit fully.`,
    ];
    return templates[Math.floor(Math.random() * templates.length)];
  }

  async function runDemoCouncil(query) {
    // staggered "thinking" per agent, 2–3s each, overlapping
    const order = ["gemini", "kimi", "claude"];
    for (const name of order) {
      agents[name].classList.add("thinking");
      await sleep(600 + Math.random() * 500);
    }
    await sleep(1500 + Math.random() * 1000);
    return demoConsensus(query);
  }

  // ---------- Circuit breaker (per-agent) ----------
  // After an agent exhausts retries on 429, its circuit "opens": we skip it
  // entirely for a cooldown period instead of burning retries, routing queries
  // to the remaining agents. It auto-closes after cooldown for a fresh attempt.
  const circuits = {
    gemini: { openUntil: 0, strikes: 0 },
    kimi:   { openUntil: 0, strikes: 0 },
    claude: { openUntil: 0, strikes: 0 },
  };

  function circuitOpen(name) {
    return Date.now() < circuits[name].openUntil;
  }

  function tripCircuit(name, retryAfterMs) {
    const c = circuits[name];
    c.strikes = Math.min(c.strikes + 1, 4);
    // cooldown: 60s, doubling per consecutive strike, cap 10 min; honor Retry-After if longer
    const cooldown = Math.max(retryAfterMs || 0, 60000 * Math.pow(2, c.strikes - 1));
    c.openUntil = Date.now() + Math.min(cooldown, 600000);
    const label = name[0].toUpperCase() + name.slice(1);
    logError(`${label} circuit OPEN — quota likely exhausted. Skipping for ${Math.round((c.openUntil - Date.now()) / 1000)}s, routing to remaining agents.`);
  }

  function resetCircuit(name) {
    circuits[name].strikes = 0;
    circuits[name].openUntil = 0;
  }

  // ---------- Retry wrapper (handles HTTP 429 / transient failures) ----------
  async function fetchWithRetry(url, options, label, maxRetries = 3) {
    let attempt = 0;
    for (;;) {
      const res = await fetch(url, options);
      if (res.status !== 429 && res.status < 500) return res;
      if (attempt >= maxRetries) return res;
      // honor Retry-After header if the API sends one; else exponential backoff + jitter
      const retryAfter = parseFloat(res.headers.get("Retry-After"));
      fetchWithRetry.lastRetryAfterMs = !isNaN(retryAfter) ? retryAfter * 1000 : 0;
      const delay = !isNaN(retryAfter)
        ? retryAfter * 1000
        : Math.min(8000, 1000 * Math.pow(2, attempt)) + Math.random() * 400;
      logError(`${label} rate-limited (HTTP ${res.status}) — retry ${attempt + 1}/${maxRetries} in ${(delay / 1000).toFixed(1)}s`);
      await sleep(delay);
      attempt++;
    }
  }

  // ---------- Live Council ----------
  async function callGemini(query) {
    const res = await fetchWithRetry(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        encodeURIComponent(settings.keyGemini),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: query }] }],
          generationConfig: { maxOutputTokens: MAX_TOKENS },
        }),
      },
      "Gemini"
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}${res.status === 429 ? " — rate limit persisted after retries; check quota/tier" : ""}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  async function callKimi(query) {
    const res = await fetchWithRetry("https://api.moonshot.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.keyKimi,
      },
      body: JSON.stringify({
        model: "moonshot-v1-8k",
        messages: [{ role: "user", content: query }],
        max_tokens: MAX_TOKENS,
      }),
    }, "Kimi");
    if (!res.ok) throw new Error(`Kimi HTTP ${res.status}${res.status === 429 ? " — rate limit OR insufficient Moonshot balance" : ""}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  async function callClaude(query) {
    const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.keyClaude,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: query }],
      }),
    }, "Claude");
    if (!res.ok) throw new Error(`Claude HTTP ${res.status}${res.status === 429 ? " — rate limit persisted after retries" : ""}`);
    const data = await res.json();
    return data.content?.map((b) => b.text || "").join("") || "";
  }

  // ---------- Divergence detection (no-consensus, by design) ----------
  // Mirrors the backend consensus engine's philosophy: if the agents' answers
  // don't sufficiently agree, Red Queen says so rather than forcing an answer.
  const STOPWORDS = new Set("a an and are as at be but by for from has have i if in is it its of on or that the this to was we what which will with you your".split(" "));

  // Light suffix stemming (Kimi review, 2026-07-12): "rezone"/"rezoning",
  // "approve"/"approval-adjacent forms" should match. Crude but symmetric —
  // both sides of every comparison pass through the same stemmer, so
  // imperfect stems still align. Real semantic matching stays in the
  // backend (0.7 cosine on embeddings); the frontend is an approximation.
  function stem(w) {
    return w.length > 4 ? w.replace(/(ation|tion|ings?|ies|ied|ed|es|e|s)$/, "") : w;
  }

  // ==================== v3.1.0: Phase 1 semantic stopgap + Temporal
  // Consistency Validator (Kimi charter ruling + council's own request,
  // 2026-07-15, FLAGGED FOR KIMI REVIEW) ====================
  // One engine, two organs: (1) synonym canonicalization so "parallel
  // dispatch" ≈ "concurrent requests" stops scoring as division (three
  // documented Jaccard failure modes); (2) GLM's Temporal Consistency
  // Validator — advisory-only flags when a new verdict sits in tension
  // with a past VERIFIED conclusion. Flags inform the HUMAN; they never
  // block, reweight, or rewrite anything (advisory-only doctrine).
  const SYNONYMS = {
    concurrent: "parallel", simultaneous: "parallel", parallelized: "parallel",
    sequential: "serial", serialize: "serial", serialized: "serial", mutex: "serial", queue: "serial", queued: "serial",
    stagger: "pace", staggered: "pace", throttle: "pace", throttled: "pace", ratelimit: "pace", rate: "pace", limit: "pace", limiting: "pace", delay: "pace", delays: "pace", serializ: "serial",
    llm: "model", ai: "model", agent: "model", advisor: "model",
    recall: "memory", remember: "memory", ledger: "memory", history: "memory", context: "memory",
    reliable: "trust", trustworthy: "trust", confidence: "trust", verified: "trust",
    postgresql: "postgres", db: "database",
    fetch: "retrieve", retrieval: "retrieve", query: "retrieve",
    pick: "choose", select: "choose", recommend: "choose", suggestion: "choose", suggest: "choose",
  };
  const NEGATORS = /\b(not|no|never|avoid|reject|against|don'?t|shouldn'?t|won'?t|rather than|instead of)\b/gi;
  function canonical(w) { return SYNONYMS[w] || w; }

  function tokenize(text) {
    return new Set(
      text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
        .map(stem)
        .map(canonical)
    );
  }

  function similarity(a, b) {
    const A = tokenize(a), B = tokenize(b);
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    A.forEach((w) => { if (B.has(w)) inter++; });
    return inter / (A.size + B.size - inter); // Jaccard over canonicalized tokens
  }

  // ==================== v3.3: CONCEPT-BASED COMPARATOR ====================
  // The lexical Jaccard comparator counts SHARED WORDS. Live failure
  // 2026-07-19: three seats returned IMPOSSIBLE in different vocabularies
  // (symbolic math / prose / prose) and scored 0 agreement — a unanimous
  // correct answer tagged DIVIDED. This comparator judges by CONCLUSION,
  // not phrasing:
  //   1. VERDICT POLARITY — if both answers state an explicit conclusion
  //      (impossible/possible, reject/approve, yes/no), that decides it:
  //      same polarity agrees, opposite splits. Verdicts trump vocabulary,
  //      and — critically — opposite conclusions in near-identical wording
  //      (the "approve X" vs "reject X" false-consensus bug) now SPLIT.
  //   2. TF-IDF COSINE — when either side states no explicit verdict, fall
  //      back to smoothed-IDF cosine over the round's answers (concept
  //      overlap that survives paraphrase; smoothing keeps terms shared by
  //      all seats from zeroing out).
  // Runs in SHADOW first (logged beside the live Jaccard result) so its
  // divergence from the current comparator is measured before promotion.
  const CONCEPT_DENY = /\b(impossible|infeasible|unsatisfiable|cannot|can't|no valid|not possible|invalid|reject|denied|deny|contradiction|does not exist|no schedule|violat)\w*/gi;
  const CONCEPT_AFFIRM = /\b(possible|feasible|satisfiable|is valid|achievable|approve|yes it|can be done|schedule exists|valid schedule)\w*/gi;
  function verdictPolarity(text) {
    const t = (text || "").toLowerCase();
    let lastDeny = -1, lastAff = -1, m;
    CONCEPT_DENY.lastIndex = 0; while ((m = CONCEPT_DENY.exec(t))) lastDeny = m.index;
    CONCEPT_AFFIRM.lastIndex = 0; while ((m = CONCEPT_AFFIRM.exec(t))) lastAff = m.index;
    if (lastDeny === -1 && lastAff === -1) return 0;
    return lastDeny > lastAff ? -1 : 1;
  }
  function tfidfVectors(texts) {
    const docs = texts.map((t) => Array.from(tokenize(t)));
    const df = {};
    docs.forEach((d) => new Set(d).forEach((tok) => (df[tok] = (df[tok] || 0) + 1)));
    const N = docs.length;
    const idf = (tok) => Math.log((N + 1) / ((df[tok] || 0) + 0.5)); // smoothed
    return docs.map((d) => {
      const tf = {}; d.forEach((tok) => (tf[tok] = (tf[tok] || 0) + 1));
      const v = {}; Object.keys(tf).forEach((tok) => (v[tok] = tf[tok] * idf(tok)));
      return v;
    });
  }
  function cosineVec(a, b) {
    let dot = 0, na = 0, nb = 0;
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((k) => (dot += (a[k] || 0) * (b[k] || 0)));
    Object.values(a).forEach((x) => (na += x * x));
    Object.values(b).forEach((y) => (nb += y * y));
    return (na && nb) ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
  }
  const CONCEPT_COSINE_THRESHOLD = 0.28;
  // Returns { agree, mode, detail } for one pair within a set of answer texts.
  function conceptAgreePair(allTexts, i, j) {
    const pi = verdictPolarity(allTexts[i]), pj = verdictPolarity(allTexts[j]);
    if (pi !== 0 && pj !== 0) {
      return { agree: pi === pj, mode: "verdict", detail: `polarity ${pi} vs ${pj}` };
    }
    const V = tfidfVectors(allTexts);
    const c = cosineVec(V[i], V[j]);
    return { agree: c >= CONCEPT_COSINE_THRESHOLD, mode: "cosine", detail: `cos ${c.toFixed(3)}` };
  }
  // Shadow consensus using the concept comparator. Same "agree with >=1 ally"
  // rule as checkConsensus, but with concept pairing. Logged, not used (yet).
  function conceptConsensusShadow(answers) {
    if (answers.length < 2) return { agreed: answers.map((a) => a.name), outliers: [] };
    const texts = answers.map((a) => extractDirective(a.text) || a.text);
    const agreed = [], outliers = [];
    answers.forEach((a, i) => {
      const ally = answers.some((b, j) => i !== j && conceptAgreePair(texts, i, j).agree);
      (ally ? agreed : outliers).push(a.name);
    });
    return { agreed, outliers };
  }

  // Short-anchor relaxation (failure mode 1: tiny token sets are high-
  // variance — a genuine 2-1 scored as 0). When both texts are short
  // directives, the floor drops from 0.22 to 0.15 per Kimi's Phase 1 spec.
  function effectiveThreshold(a, b) {
    const short = tokenize(a).size <= 12 && tokenize(b).size <= 12;
    return short ? 0.15 : AGREEMENT_THRESHOLD;
  }

  // Temporal Consistency Validator (GLM's proposal, council round
  // 2026-07-15): topically-similar to a past VERIFIED verdict but with
  // opposite negation polarity → advisory tension flag. Deliberately
  // modest: it detects CANDIDATE tension for human review, nothing more.
  function negationCount(text) { return (text.match(NEGATORS) || []).length; }
  function checkTemporalConsistency(newVerdict) {
    if (!newVerdict) return;
    ledger.forEach((e, i) => {
      if (e.outcome !== "verified" || !e.verdict) return;
      const sim = similarity(newVerdict, e.verdict);
      if (sim < 0.3) return; // not the same topic — no comparison
      const polarityDiff = Math.abs((negationCount(newVerdict) % 2) - (negationCount(e.verdict) % 2));
      if (polarityDiff > 0) {
        logError(`⚖ TEMPORAL CONSISTENCY FLAG — today's verdict is topically close to Round ${i + 1}'s VERIFIED conclusion but with opposite polarity. Possible contradiction with settled council law; human review advised. (Advisory only — nothing was blocked or reweighted.)`);
      }
    });
  }

  const AGREEMENT_THRESHOLD = 0.22; // lexical agreement floor (frontend approximation of backend's 0.7 cosine)

  // Structural anchor comparison (2026-07-12, after first shadow-council run):
  // when a query asks agents to conclude with "FINAL DIRECTIVE:", long
  // reasoning walkthroughs differ lexically even when verdicts match, and
  // full-text Jaccard misreads agreement as division. If BOTH answers in a
  // pair contain the anchor, compare only what follows it — the verdicts.
  // If either lacks it (free-form answer, or truncated pre-anchor), fall
  // back to full-text comparison as before.
  const DIRECTIVE_ANCHOR = /FINAL DIRECTIVE:\s*([\s\S]+)/i;
  // v2.7.1 (2026-07-13, FLAGGED FOR KIMI REVIEW): two hardenings after a
  // live failure the same night. Nemotron QUOTED the instruction ("ending
  // with 'FINAL DIRECTIVE:'...") inside leaked chain-of-thought, then
  // truncated before any real verdict. The greedy first-match regex
  // captured 1000 tokens of deliberation as its "directive" — dodging the
  // MALFORMED bench and poisoning consensus math. Fixes:
  //  1. Scan anchors LAST-to-first: a real verdict is always the final
  //     anchor; instruction restating happens up top, and reasoning
  //     models restate constantly.
  //  2. Skip anchors wrapped in quote characters — a quoted anchor is a
  //     model reading the rules aloud, not ruling. Nemotron's only
  //     anchor was quoted; under this fix it correctly benches MALFORMED.
  function extractDirective(text) {
    const ANCHOR = "FINAL DIRECTIVE:";
    const QUOTES = "\"'\u201C\u201D\u2018\u2019`";
    const upper = text.toUpperCase();
    let idx = upper.lastIndexOf(ANCHOR);
    while (idx !== -1) {
      const prevChar = idx > 0 ? text[idx - 1] : "";
      const after = text.slice(idx + ANCHOR.length);
      const firstChar = (after.match(/\S/) || [""])[0];
      const quoted = QUOTES.includes(prevChar) || QUOTES.includes(firstChar);
      const verdict = after.trim();
      if (!quoted && verdict) return verdict;
      idx = upper.lastIndexOf(ANCHOR, idx - 1);
    }
    return null; // no unquoted anchor with content = no verdict
  }

  function pairSimilarity(a, b) {
    const da = extractDirective(a), db = extractDirective(b);
    if (da && db) return similarity(da, db);
    return similarity(a, b);
  }

  // v3.3: concept comparator promotion toggle. Default SHADOW — the live
  // Jaccard math is unchanged until the Founder flips this on, having seen
  // the shadow logs agree with reality. Flip via localStorage or the
  // Settings toggle: rq_concept_mode = "live" | "shadow" (default shadow).
  function conceptMode() {
    return localStorage.getItem("rq_concept_mode") === "live" ? "live" : "shadow";
  }

  function checkConsensus(answers) {
    // each answer must agree with at least one other above threshold
    if (answers.length < 2) return { agreed: answers, outliers: [] };
    const anchored = answers.filter((a) => extractDirective(a.text)).length;
    if (anchored >= 2) {
      logError(`Consensus check using FINAL DIRECTIVE anchors (${anchored}/${answers.length} answers anchored).`);
    }

    // --- LEXICAL (Jaccard) result — the historical comparator ---
    const lexAgreed = [], lexOutliers = [];
    answers.forEach((a, i) => {
      const hasAlly = answers.some((b, j) => i !== j && pairSimilarity(a.text, b.text) >= effectiveThreshold(extractDirective(a.text) || a.text, extractDirective(b.text) || b.text));
      (hasAlly ? lexAgreed : lexOutliers).push(a);
    });

    // --- CONCEPT result (verdict-polarity + TF-IDF cosine) ---
    const conceptShadow = conceptConsensusShadow(answers);
    const conceptAgreed = answers.filter((a) => conceptShadow.agreed.includes(a.name));
    const conceptOutliers = answers.filter((a) => !conceptShadow.agreed.includes(a.name));

    // Always log both so divergence is visible and measurable.
    const lexNames = lexAgreed.map((a) => a.name).join(",") || "none";
    const conNames = conceptAgreed.map((a) => a.name).join(",") || "none";
    if (lexNames !== conNames) {
      logError(`CONCEPT COMPARATOR — DIVERGES from lexical this round. Lexical agrees: [${lexNames}]. Concept agrees: [${conNames}]. ${conceptMode() === "live" ? "CONCEPT is LIVE — using it." : "Shadow only — lexical still used. Flip rq_concept_mode=live to promote."}`);
    } else {
      logError(`CONCEPT COMPARATOR — matches lexical this round (both agree: [${lexNames}]).`);
    }

    // Promotion: concept result is used for consensus ONLY when flipped live.
    if (conceptMode() === "live") {
      return { agreed: conceptAgreed, outliers: conceptOutliers };
    }
    return { agreed: lexAgreed, outliers: lexOutliers };
  }

  // ==================== v3.4.1: PYODIDE CODE SANDBOX (SHADOW) ====================
  // The council's first real tool: seats can EXECUTE Python, not just describe
  // it. Any answer with a ```python fenced block has it run in a Pyodide (WASM)
  // worker; stdout/return/errors are captured, attached to the answer, logged.
  // SHADOW: results are logged and stored on a.compute but NOT fed back to the
  // model and NOT used in consensus. Promotion is gated on Kimi's ruling.
  //
  // v3.4.1 load-fix (2026-07-19): the v3.4 version used ONE 10s timeout around
  // the whole call, including the first-time ~6-10MB Pyodide download. On a cold
  // load that 10s expired mid-download, the worker was terminated, the download
  // aborted before caching, and every subsequent run cold-loaded and died again
  // — an unescapable timeout loop. It also had no worker-error handler, so a
  // real load failure was indistinguishable from a slow one. Fixes:
  //   - SPLIT timeouts: a generous LOAD budget (60s, happens once) for the cold
  //     WASM bootstrap, and a tight EXEC budget (10s) for the actual code run.
  //   - Keep the worker WARM after a successful load, so Pyodide caches and
  //     every later run is near-instant (no re-download).
  //   - Explicit ready / loaderror protocol + a worker "error" listener, so a
  //     genuine load failure surfaces its real message instead of a mystery
  //     timeout. Only a runaway EXECUTION (infinite loop) still kills the worker.
  //   - CSP still required (already set in index.html's meta): script-src
  //     'wasm-unsafe-eval' + cdn.jsdelivr.net ; connect-src cdn.jsdelivr.net ;
  //     worker-src blob: . (Flat-file preserved: worker is an inline blob.)
  const PYODIDE_VERSION = "0.26.4";
  const PY_LOAD_TIMEOUT_MS = 60000; // cold WASM bootstrap budget (once)
  const PY_EXEC_TIMEOUT_MS = 10000; // per-run compute budget (kills runaways)
  let _pyWorker = null;
  let _pyReady = null; // Promise<void>, resolves when THIS worker's Pyodide is loaded

  function _makePyWorker() {
    const src =
      'let loadErr=null;' +
      'const boot=(async()=>{try{' +
      'importScripts("https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/full/pyodide.js");' +
      'self.py=await loadPyodide();self.postMessage({type:"ready"});' +
      '}catch(e){loadErr=String((e&&e.stack)||e);self.postMessage({type:"loaderror",error:loadErr});}})();' +
      'self.onmessage=async(e)=>{if(!e.data||e.data.type!=="run")return;const{id,code}=e.data;await boot;' +
      'if(loadErr){self.postMessage({type:"result",id,ok:false,error:"Pyodide load failed: "+loadErr,stdout:"",stderr:""});return;}' +
      'let out="",err="";self.py.setStdout({batched:s=>out+=s+"\\n"});self.py.setStderr({batched:s=>err+=s+"\\n"});' +
      'try{const r=await self.py.runPythonAsync(code);' +
      'self.postMessage({type:"result",id,ok:true,result:(r&&r.toString)?r.toString():String(r),stdout:out,stderr:err});}' +
      'catch(ex){self.postMessage({type:"result",id,ok:false,error:String(ex),stdout:out,stderr:err});}};';
    return new Worker(URL.createObjectURL(new Blob([src], { type: "application/javascript" })));
  }

  // Bring up a worker and a readiness promise if we don't have a live one.
  function _ensureWorker() {
    if (_pyWorker && _pyReady) return;
    _pyWorker = _makePyWorker();
    _pyReady = new Promise((resolve, reject) => {
      const loadTimer = setTimeout(
        () => reject(new Error("Pyodide did not finish loading within " + (PY_LOAD_TIMEOUT_MS / 1000) + "s (cold WASM download — try once more; it caches)")),
        PY_LOAD_TIMEOUT_MS
      );
      const onReady = (e) => {
        if (!e.data) return;
        if (e.data.type === "ready") {
          clearTimeout(loadTimer); _pyWorker.removeEventListener("message", onReady); resolve();
        } else if (e.data.type === "loaderror") {
          clearTimeout(loadTimer); _pyWorker.removeEventListener("message", onReady);
          reject(new Error(e.data.error || "Pyodide load error"));
        }
      };
      _pyWorker.addEventListener("message", onReady);
      _pyWorker.addEventListener("error", (ev) => {
        clearTimeout(loadTimer);
        reject(new Error("Worker error during load: " + ((ev && ev.message) || "unknown — check CSP worker-src/script-src")));
      });
    });
    // If loading fails, drop the worker so the next call rebuilds cleanly.
    _pyReady.catch(() => { try { _pyWorker && _pyWorker.terminate(); } catch (_) {} _pyWorker = null; _pyReady = null; });
  }

  // Run one block of Python. Resolves { ok, result, stdout, stderr } or
  // { ok:false, error }. Never rejects. Waits up to PY_LOAD_TIMEOUT_MS for a
  // cold load (worker kept warm after), then PY_EXEC_TIMEOUT_MS for the run.
  async function runPython(code, execTimeoutMs) {
    execTimeoutMs = execTimeoutMs || PY_EXEC_TIMEOUT_MS;
    if (typeof Worker === "undefined") {
      return { ok: false, error: "Web Workers unavailable in this environment", stdout: "", stderr: "" };
    }
    _ensureWorker();
    try { await _pyReady; }
    catch (e) { return { ok: false, error: (e && e.message) || String(e), stdout: "", stderr: "" }; }
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // A runaway (infinite loop) can only be stopped by killing the worker;
        // reset so the next call rebuilds. Load cost is paid again only here.
        try { _pyWorker && _pyWorker.terminate(); } catch (_) {}
        _pyWorker = null; _pyReady = null;
        resolve({ ok: false, error: "Execution timed out after " + execTimeoutMs + "ms (worker killed — likely an infinite loop in the code)", stdout: "", stderr: "" });
      }, execTimeoutMs);
      const onMsg = (e) => {
        if (!e.data || e.data.type !== "result" || e.data.id !== id) return;
        clearTimeout(timer);
        _pyWorker.removeEventListener("message", onMsg);
        resolve(e.data);
      };
      _pyWorker.addEventListener("message", onMsg);
      _pyWorker.postMessage({ type: "run", id, code });
    });
  }

  function extractPython(text) {
    const m = (text || "").match(/```python\s*([\s\S]*?)```/i);
    return m ? m[1].trim() : null;
  }

  // Shadow execution across a round's answers. Runs any python a seat emitted,
  // attaches the result (a.compute) and logs it. Never throws into the round.
  async function runSandboxShadow(answers) {
    for (const a of answers) {
      const code = extractPython(a && a.text);
      if (!code) continue;
      try {
        const res = await runPython(code);
        a.compute = res; // provenance travels with the answer (Task 5 JSON)
        const preview = String(res.stdout || res.result || res.error || "").trim().slice(0, 160);
        logError("SANDBOX (shadow) — " + seatLabel(a.name) + " executed " +
          code.split("\n").length + " line(s) of Python: " + (res.ok ? "OK" : "ERROR") +
          (preview ? " -> " + preview : "") +
          " . Result NOT fed to consensus (shadow mode; flip after Kimi ratifies).");
      } catch (e) {
        logError("SANDBOX (shadow) — " + seatLabel(a.name) +
          " harness error: " + (e && (e.message || e)) + ". Round unaffected.");
      }
    }
  }

  // ==================== v3.4.2: SANDBOX FEEDBACK LOOP (TOGGLE) ====================
  // Stage 2 of the sandbox: feed the COMPUTED result back to the seat so it can
  // revise its answer, then that revised answer flows into consensus + gets
  // presented. This is what closes the gap the 2916-vs-2817 round exposed — a
  // seat guessed wrong, the worker computed right, but nobody told the seat.
  //
  // GATED. Default OFF (shadow discipline): this is the first thing that lets a
  // computed result CHANGE what the council says, so it's the exact kind of
  // change that needs Kimi's ratification before it runs by default. Flip it on
  // to demo:  localStorage.setItem("rq_sandbox_feedback","on")  (and "off" to
  // disable). When off, this is a no-op and consensus is untouched.
  function sandboxFeedbackMode() {
    return localStorage.getItem("rq_sandbox_feedback") === "on" ? "on" : "off";
  }
  async function runSandboxFeedback(answers, calls) {
    if (sandboxFeedbackMode() !== "on") return;
    for (const a of answers) {
      if (!a || !a.compute || !a.compute.ok) continue; // only successful runs
      const call = (calls || []).find((c) => c.name === a.name);
      if (!call) continue;
      const computed = String(a.compute.stdout || a.compute.result || "").trim();
      if (!computed) continue;
      const fbPrompt =
        "Your previous answer included Python code, which was EXECUTED in a sandbox. " +
        "The verified output was:\n\n" + computed + "\n\n" +
        "Treat that output as ground truth. Give your FINAL answer now, using the " +
        "computed result. If your earlier answer stated a different value, correct it " +
        "explicitly. Your earlier answer was:\n\n" + a.text;
      try {
        const revised = await call.fn(fbPrompt);
        if (revised && revised.trim()) {
          a.textOriginal = a.text;   // keep the pre-compute answer for the record
          a.text = revised.trim();   // consensus + synthesis now use the revised text
          a.revisedByCompute = true;
          logError("SANDBOX FEEDBACK (LIVE) — " + seatLabel(a.name) +
            " revised its answer using the computed result (" + clip(computed, 40) +
            "). Consensus now uses the revised answer.");
        }
      } catch (e) {
        logError("SANDBOX FEEDBACK — " + seatLabel(a.name) +
          " re-query failed (" + (e && (e.message || e)) + "); keeping original answer.");
      }
    }
  }

  async function callGroq(query) {
    await paceProvider("groq");
    const res = await fetchWithRetry("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.keyGroq,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: query }],
        max_tokens: MAX_TOKENS,
      }),
    }, "Groq");
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}${res.status === 429 ? " — free-tier rate limit; circuit breaker will manage" : ""}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  // ---------- Cerebras (Gemini-seat understudy, free tier) ----------
  // OpenAI-compatible endpoint on wafer-scale hardware. Free tier:
  // ~30 req/min, ~1M tokens/day, no card. GLM 4.7 (Z.ai) chosen for
  // model-family diversity vs Groq's Llama (Claude seat) and the
  // Gemma/Nemotron/gpt-oss OpenRouter fallbacks. PROMOTED to active
  // shadow council duty per Kimi ruling 2026-07-13: passed audition under
  // live 429-cascade conditions (anchor held, identity injection rejected,
  // true origins asserted). 10-dispatch battery deferred to regression
  // baseline — not a deployment gate.
  // Cerebras's free catalog churns — if this model 404s, check
  // cloud.cerebras.ai for the current list and swap the string below.
  async function callCerebras(query) {
    await paceProvider("cerebras");
    const res = await fetchWithRetry("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.keyCerebras,
      },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [{ role: "user", content: query }],
        max_tokens: CEREBRAS_MAX_TOKENS, // v2.9.2: GLM final appeal — thinks before speaking, now with 4000
      }),
    }, "Cerebras");
    if (res.status === 404) throw new Error(`Cerebras model ${CEREBRAS_MODEL} unavailable (404) — free catalog churned; swap CEREBRAS_MODEL for a current model from cloud.cerebras.ai`);
    if (!res.ok) throw new Error(`Cerebras HTTP ${res.status}${res.status === 429 ? " — free-tier rate limit; circuit breaker will manage" : ""}`);
    const data = await res.json();
    let text = data.choices?.[0]?.message?.content || "";
    // Reasoning models (GLM, Qwen) may wrap chain-of-thought in <think>
    // tags — strip it so only the final answer reaches consensus scoring.
    // v2.7.1: truncation-safe — an unclosed <think> (cut off mid-thought)
    // is also dropped; leaked deliberation is never a verdict.
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "");
    const openThink = text.lastIndexOf("<think>");
    if (openThink !== -1) text = text.slice(0, openThink);
    text = text.trim();
    // v2.7.2: an empty answer after stripping is a diagnosis, not a
    // mystery — fail loudly instead of returning "" ("unknown error").
    if (!text) throw new Error(`Cerebras ${CEREBRAS_MODEL} spent its entire token budget reasoning and never produced a final answer (truncated mid-<think>). Headroom is ${CEREBRAS_MAX_TOKENS} — if this recurs, raise it or shorten prompts.`);
    return text;
  }

  // Per-seat fallback diversity (Kimi amendment, 2026-07-12):
  // never let two seats share the same fallback model family, or
  // divergence detection degrades into an echo chamber.
  //
  // v2.5 (Gemini memo + Claude amendments, 2026-07-13): each seat's
  // OpenRouter fallback is now a LIST, walked in order on failure — the
  // free catalog killed three of our hardcoded models in 24 hours
  // (qwen-3-32b on Cerebras, qwen-2.5-72b and likely deepseek on OR).
  // Roster verified against OpenRouter's live free catalog, July 2026.
  // Placement rationale:
  //  - gpt-oss family: two anchor failures on record (20b, 2026-07-12/13),
  //    so the 120b sits at the DEEPEST slot despite Gemini's memo ranking
  //    it first. Evidence beats endorsement.
  //  - nemotron-3-super: hybrid Mamba-Transformer MoE — most
  //    architecturally distinct voice vs dense Llama; anchors Claude's seat.
  //  - gemma-4-31b: highest quality score in the free catalog. SOFT
  //    COLLISION FLAG — Kimi ruling 2026-07-13: same-lab (Google) but
  //    distinct architecture satisfies the letter of the diversity rule.
  //    NOT a blocker. MONITOR for correlated failures or shared bias
  //    patterns with a live Gemini primary; escalate to hard eviction
  //    only on observed evidence.
  //  - llama-3.3-70b removed from Gemini's seat: it duplicated Groq's
  //    understudy on Claude's seat (pre-existing collision, now fixed).
  // v3.1 Task 2 (Kimi-ratified 2026-07-17, Amendment B): gpt-oss-120b REMOVED
  // — returned 404 live on 2026-07-17 and it was the Gemini seat's ONLY
  // OpenRouter entry, so the walk had zero depth. Root cause of the seat's
  // total disappearance that session: Gemini 429 -> Cerebras 429 -> OR 404 ->
  // nothing left to walk to. Chain now has depth 2, family-distinct from
  // every other seat (Qwen=Alibaba, Mistral=Mistral AI vs Gemma=Google,
  // Nemotron=NVIDIA, Llama=Meta, GLM=Zhipu). No collision.
  //
  // ORDERING NOTE (Fable): Kimi's Amendment B proposed qwen-2.5-72b FIRST.
  // Line ~753 of this same file records qwen-2.5-72b as already killed from
  // the free catalog on 2026-07-13. Kept as the DEEPER slot rather than
  // dropped — free catalogs churn both directions and the walk costs nothing
  // if it is dead. Mistral leads until the TEST OPENROUTER MODELS button says
  // otherwise. Evidence beats endorsement (same precedent as gpt-oss's demotion).
  //
  // UNVERIFIED BY FABLE: this container has no network access, so neither slug
  // has been test-dispatched. Run TEST OPENROUTER MODELS in the settings sheet
  // before committing — that satisfies Kimi's "non-empty response required".
  const OR_SEAT_MODELS = {
    gemini: ["mistralai/mistral-7b-instruct:free", "qwen/qwen-2.5-72b-instruct:free"],
    kimi:   ["google/gemma-4-31b-it:free", "nvidia/nemotron-3-super-120b-a12b:free"],
    claude: ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free"],
  };
  const orActiveModel = {}; // seat -> slug currently answering (labels/visuals)

  function orShort(slug) {
    return (slug || "").split("/").pop().replace(":free", "").split("-")[0];
  }

  // ---------- Per-provider pacing gates (v2.7, COUNCIL-VOTED 2026-07-13,
  // KIMI-RATIFIED same day with interval amendment: OR 1200→1800ms) ----------
  // The council ruled: "dispatch calls in parallel with per-provider rate
  // limiting" (2-1, GLM + Nemotron vs Llama's mutex). This replaces the
  // OpenRouter mutex queue. Kitchen-table version: instead of a strict
  // single-file line at the shared-key counter, callers can overlap but
  // never order faster than one request per interval on the same key.
  // Each provider gets its own gate — hammering tacos doesn't slow pizza.
  // Concurrent callers reserve staggered slots, so bursts self-space.
  //
  // GOVERNANCE RULE (Kimi, 2026-07-13): "Council deliberation on user
  // prompts is binding within its trust-state constraints. Council
  // deliberation on its own architecture is ADVISORY; final authority
  // rests with the Founder and Lead Architect." This change is the
  // precedent case: council-voted, founder-directed, Kimi-ratified.
  //
  // Interval rationale (Kimi amendment): 1800ms OR = 33 RPM start rate,
  // safely under the 20 RPM per-model free-tier floor even with 2-3s
  // response latency across a 3-seat cascade. Pacing state is per-page-
  // load by design; multi-tab coordination deferred to backend v4.
  const providerPace = {
    openrouter: { minInterval: 1800, nextSlot: 0 }, // shared key across up to 3 seats
    groq:       { minInterval: 400,  nextSlot: 0 },
    cerebras:   { minInterval: 400,  nextSlot: 0 },
  };
  async function paceProvider(provider) {
    const p = providerPace[provider];
    if (!p) return;
    const now = Date.now();
    const slot = Math.max(now, p.nextSlot);
    p.nextSlot = slot + p.minInterval;
    if (slot > now) await sleep(slot - now);
  }

  async function callOpenRouter(query, seatName) {
    // v2.7: mutex removed per council verdict — pacing gate inside
    // callOpenRouterModel now enforces the shared-key limit instead.
    return callOpenRouterWalk(query, seatName);
  }

  // Walk the seat's model list until one answers (v2.5). Every hop is
  // logged — silence is never an option.
  async function callOpenRouterWalk(query, seatName) {
    const list = OR_SEAT_MODELS[seatName] || OR_SEAT_MODELS.gemini;
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      const model = list[i];
      orActiveModel[seatName] = model;
      markSeat(seatName, orShort(model), `${seatName} seat — fallback: ${model}`);
      try {
        return await callOpenRouterModel(query, model);
      } catch (e) {
        lastErr = e;
        if (list[i + 1]) {
          logError(`OpenRouter ${model} failed (${e.message || e}) — walking to ${list[i + 1]}.`);
        }
      }
    }
    throw lastErr || new Error("OpenRouter: no models configured for seat " + seatName);
  }

  async function callOpenRouterModel(query, model) {
    await paceProvider("openrouter"); // shared key — pace, don't mob
    const res = await fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.keyOpenRouter,
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: query }],
        max_tokens: REASONING_MAX_TOKENS, // v2.7.2: Nemotron truncated twice tonight at 1000
      }),
    }, "OpenRouter");
    if (res.status === 404) throw new Error(`OpenRouter model ${model} unavailable (404) — swap OR_SEAT_MODELS entry for another free model family`);
    if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
    const data = await res.json();
    // OpenRouter free models sometimes return HTTP 200 with an error body or
    // empty content (observed live 2026-07-12 as "unknown error"). Surface
    // the real reason instead of failing silently downstream.
    if (data.error) throw new Error(`OpenRouter ${model}: ${data.error.message || JSON.stringify(data.error)}`);
    const content = data.choices?.[0]?.message?.content || "";
    if (!content.trim()) throw new Error(`OpenRouter ${model} returned an empty answer (HTTP 200, no content)`);
    // v2.7.1: strip <think> reasoning blocks — parity with the Cerebras
    // path. Live failure 2026-07-13: Nemotron (a reasoning model) flooded
    // its visible answer with chain-of-thought on the OR path because only
    // the Cerebras path had this filter. Truncation-safe: if the model was
    // cut off mid-<think> (no closing tag), also drop from the last
    // unclosed <think> to end — leaked deliberation is never a verdict.
    let cleaned = content.replace(/<think>[\s\S]*?<\/think>/g, "");
    const openThink = cleaned.lastIndexOf("<think>");
    if (openThink !== -1) cleaned = cleaned.slice(0, openThink);
    cleaned = cleaned.trim();
    if (!cleaned) throw new Error(`OpenRouter ${model} returned only reasoning, no final answer (likely truncated mid-thought)`);
    return cleaned;
  }

  // ---------- v3.1.2: Markdown Presentation Layer ----------
  // Verdicts arrive as markdown; .textContent flattened them into one block.
  // SECURITY GATE IS ABSOLUTE: innerHTML is used IFF DOMPurify is present and
  // sanitizing. marked without DOMPurify => plain-text fallback, no exceptions.
  // CSP NOTE: needs cdn.jsdelivr.net in script-src (index.html edit — Kimi's
  // ruling). If blocked, pre-wrap fallback still fixes the flattening.
  const MD_SOURCES = [
    { key: "marked", url: "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js", check: () => typeof window.marked !== "undefined" },
    { key: "DOMPurify", url: "https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js", check: () => typeof window.DOMPurify !== "undefined" },
  ];
  const MD_LOAD_TIMEOUT = 5000;
  let mdReady = false;
  let mdEnginePromise = null;
  function loadScriptOnce(src, isLoaded) {
    return new Promise((resolve) => {
      if (isLoaded()) return resolve(true);
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = () => resolve(isLoaded());
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
      setTimeout(() => resolve(isLoaded()), MD_LOAD_TIMEOUT);
    });
  }
  function ensureMarkdownEngine() {
    if (mdEnginePromise) return mdEnginePromise;
    mdEnginePromise = (async () => {
      try {
        const r = await Promise.all(MD_SOURCES.map((m) => loadScriptOnce(m.url, m.check)));
        mdReady = r.every(Boolean) && MD_SOURCES.every((m) => m.check());
        if (!mdReady) {
          const miss = MD_SOURCES.filter((m) => !m.check()).map((m) => m.key).join(" + ");
          logError(`MARKDOWN LAYER — ${miss} did not load (CDN blocked, offline, or CSP script-src disallows cdn.jsdelivr.net). Falling back to pre-wrap: paragraph spacing preserved, rich formatting not. Verdicts unaffected.`);
        }
      } catch (e) { mdReady = false; }
      return mdReady;
    })();
    return mdEnginePromise;
  }
  let mdStyled = false;
  function ensureMarkdownStyles() {
    if (mdStyled) return; mdStyled = true;
    const style = document.createElement("style");
    style.textContent = [
      ".rq-md-plain { white-space: pre-wrap; word-break: break-word; }",
      ".rq-md { word-break: break-word; }",
      ".rq-md > *:first-child { margin-top: 0; } .rq-md > *:last-child { margin-bottom: 0; }",
      ".rq-md p { margin: 0 0 0.85em; line-height: 1.55; }",
      ".rq-md ul, .rq-md ol { margin: 0 0 0.85em; padding-left: 1.4em; }",
      ".rq-md li { margin: 0.25em 0; line-height: 1.5; }",
      ".rq-md h1,.rq-md h2,.rq-md h3,.rq-md h4 { margin: 1.1em 0 0.5em; line-height: 1.3; font-weight: 600; }",
      ".rq-md h1{font-size:1.25em}.rq-md h2{font-size:1.15em}.rq-md h3{font-size:1.05em}",
      ".rq-md code { font-family: ui-monospace,Menlo,monospace; font-size: 0.88em; background: rgba(127,127,127,0.16); padding: 0.12em 0.38em; border-radius: 4px; }",
      ".rq-md pre { background: rgba(127,127,127,0.12); border: 1px solid rgba(127,127,127,0.25); border-radius: 6px; padding: 10px 12px; margin: 0 0 0.85em; overflow-x: auto; }",
      ".rq-md pre code { background: none; padding: 0; }",
      ".rq-md blockquote { margin: 0 0 0.85em; padding-left: 0.9em; border-left: 3px solid rgba(127,127,127,0.4); opacity: 0.9; }",
      ".rq-md table { border-collapse: collapse; margin: 0 0 0.85em; display: block; overflow-x: auto; }",
      ".rq-md th,.rq-md td { border: 1px solid rgba(127,127,127,0.3); padding: 5px 9px; }",
      ".rq-md a { color: inherit; text-decoration: underline; }",
      ".rq-trust { display: block; margin-bottom: 0.6em; opacity: 0.92; }",
      // v3.4.2: long synthesized answers were clipping the consensus box.
      // Cap its height and let it scroll internally. (If styles.css sets a
      // fixed height on .consensus-bar, that may still clip — send styles.css.)
      "#consensusText { max-height: 62vh; overflow-y: auto; overscroll-behavior: contain; }",
    ].join("\n");
    document.head.appendChild(style);
  }
  function mdPaint(el, text) {
    ensureMarkdownStyles();
    const str = String(text == null ? "" : text);
    if (mdReady && typeof window.marked !== "undefined" && typeof window.DOMPurify !== "undefined") {
      try {
        const html = window.DOMPurify.sanitize(window.marked.parse(str, { breaks: true, gfm: true }), { USE_PROFILES: { html: true } });
        el.classList.remove("rq-md-plain"); el.classList.add("rq-md");
        el.innerHTML = html; // sanitized above — ONLY path that reaches innerHTML
        return;
      } catch (e) { /* degrade to text */ }
    }
    el.classList.remove("rq-md"); el.classList.add("rq-md-plain");
    el.textContent = str;
  }
  function renderRich(el, text) {
    if (!el) return;
    el.__rqText = text;
    mdPaint(el, text);
    if (!mdReady) ensureMarkdownEngine().then((ok) => { if (ok && el.__rqText === text) mdPaint(el, text); });
  }
  ensureMarkdownEngine();

  // ---------- v3.1.1 Task 2b: Live catalog discovery (ADVISORY ONLY) ----------
  // Kimi-ratified scope: advisory. This code REPORTS what exists. It never
  // selects a model, never edits OR_SEAT_MODELS, never touches consensus.
  // Auto-population from the catalog is Phase 2 and requires a ruling.
  //
  // WHY THIS EXISTS (Fable, 2026-07-18): on 2026-07-17 the Gemini seat's only
  // OpenRouter model 404'd, so Task 2 swapped it for two models chosen from
  // memory — mistral-7b-instruct and qwen-2.5-72b. The live test found BOTH
  // dead. Mistral has since left the free tier entirely; qwen-2.5-72b was
  // already on this file's own kill list from 2026-07-13. Three dead picks in
  // two rounds, from three different sources (Gemini's memo, Kimi's amendment,
  // Fable's pick). The lesson is not "pick better" — every model's knowledge of
  // this catalog is stale by construction and the catalog rotates weekly.
  // Model selection is a LOOKUP, not a recollection. Ask the catalog.
  //
  // Endpoint is public (no API key required) and same-host as the completions
  // call already in the CSP whitelist, so no index.html change is needed.
  const OR_CATALOG_URL = "https://openrouter.ai/api/v1/models";
  // Families occupying seats OUTSIDE OpenRouter — they still count against
  // Kimi's model-family diversity rule.
  // NOTE (Fable, 2026-07-18): keys MUST be the OpenRouter slug prefix, not the
  // lab's colloquial name. Caught in test: keying Groq's Llama as "meta"
  // silently failed to ban "meta-llama/*", so the Gemini seat was offered
  // llama-3.3 as "family-safe" — re-introducing the exact collision line ~672
  // of this file records as already fixed on 2026-07-13. FAMILY_ALIASES folds
  // the variants together so a rename can't reopen it.
  const NON_OR_FAMILIES = { "meta-llama": "Groq Llama 3.3 (Claude seat)", "zai": "Cerebras GLM (Gemini seat)" };
  const FAMILY_ALIASES = { meta: "meta-llama", llama: "meta-llama", zhipu: "zai", "z-ai": "zai", google: "google", alibaba: "qwen" };

  let catalogCache = null; // { at, free:Set, total } — per page load
  let catalogChecked = false; // validate seat chains once per page load
  function orFamily(slug) {
    const raw = String(slug || "").split("/")[0].toLowerCase();
    return FAMILY_ALIASES[raw] || raw;
  }

  async function fetchFreeCatalog(force) {
    if (catalogCache && !force) return catalogCache;
    const res = await fetch(OR_CATALOG_URL, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`OpenRouter catalog HTTP ${res.status}`);
    const data = await res.json();
    const list = Array.isArray(data.data) ? data.data : [];
    if (!list.length) throw new Error("OpenRouter catalog returned no models (unexpected shape)");
    const free = new Set();
    list.forEach((m) => {
      const p = m && m.pricing;
      if (!p) return;
      // OpenRouter reports prices as STRINGS ("0"). parseFloat both; a model is
      // free only when prompt AND completion are zero.
      if (parseFloat(p.prompt) === 0 && parseFloat(p.completion) === 0 && m.id) free.add(m.id);
    });
    catalogCache = { at: Date.now(), free, total: list.length };
    return catalogCache;
  }

  // Families used by every seat EXCEPT this one, plus the non-OR occupants.
  function familiesUsedExcept(seat) {
    const fams = new Set(Object.keys(NON_OR_FAMILIES));
    Object.keys(OR_SEAT_MODELS).forEach((s) => {
      if (s === seat) return;
      (OR_SEAT_MODELS[s] || []).forEach((m) => fams.add(orFamily(m)));
    });
    return fams;
  }

  // Cross-check the configured chains against reality. Advisory: logs only.
  async function validateOrSeatModels() {
    let cat;
    try {
      cat = await fetchFreeCatalog();
    } catch (e) {
      logError(`CATALOG CHECK — could not reach OpenRouter's model list (${e.message || e}). Seat chains unverified this session.`);
      return null;
    }
    let dead = 0;
    const seatsWithNoFloor = [];
    Object.keys(OR_SEAT_MODELS).forEach((seat) => {
      const list = OR_SEAT_MODELS[seat] || [];
      const alive = list.filter((m) => cat.free.has(m));
      list.forEach((m) => {
        if (!cat.free.has(m)) {
          dead++;
          logError(`\u2717 CATALOG CHECK — ${m} (${seat} seat) is NOT in OpenRouter's live free catalog. It will 404. Swap it.`);
        }
      });
      if (list.length && alive.length === 0) seatsWithNoFloor.push(seat);
    });
    if (seatsWithNoFloor.length) {
      logError(`\u26A0 NO OPENROUTER FLOOR — ${seatsWithNoFloor.join(", ")} seat(s) have zero live fallback models. If their primary and understudy both fail, the seat VANISHES from the council (root cause of the 2026-07-17 Gemini disappearance). Run LIST FREE MODELS and swap.`);
    }
    if (!dead) logError(`\u2713 CATALOG CHECK — all configured OpenRouter models present in the live free catalog (${cat.free.size} free of ${cat.total} total).`);
    return cat;
  }

  // Print the live free catalog, annotated for the diversity rule.
  async function listFreeModels() {
    let cat;
    try {
      cat = await fetchFreeCatalog(true);
    } catch (e) {
      logError(`LIST FREE MODELS — failed: ${e.message || e}`);
      return;
    }
    const inUse = new Map();
    Object.keys(OR_SEAT_MODELS).forEach((s) => (OR_SEAT_MODELS[s] || []).forEach((m) => inUse.set(m, s)));
    const free = Array.from(cat.free).sort();
    logError(`LIST FREE MODELS — ${free.length} zero-cost models live on OpenRouter right now (of ${cat.total} total). Catalog rotates weekly; this is a snapshot, not a permanent list.`);

    const byFamily = {};
    free.forEach((m) => { (byFamily[orFamily(m)] = byFamily[orFamily(m)] || []).push(m); });
    Object.keys(byFamily).sort().forEach((fam) => {
      const note = NON_OR_FAMILIES[fam] ? ` [family already seated: ${NON_OR_FAMILIES[fam]}]` : "";
      logError(`  \u2500 ${fam}${note}: ${byFamily[fam].map((m) => (inUse.has(m) ? m + " \u2190 IN USE (" + inUse.get(m) + ")" : m)).join(", ")}`);
    });

    // Actionable: what may legally fill each seat under the diversity rule.
    Object.keys(OR_SEAT_MODELS).forEach((seat) => {
      const banned = familiesUsedExcept(seat);
      const ok = free.filter((m) => !banned.has(orFamily(m)));
      const live = (OR_SEAT_MODELS[seat] || []).filter((m) => cat.free.has(m));
      logError(`  ${seat.toUpperCase()} SEAT — ${live.length} of ${(OR_SEAT_MODELS[seat] || []).length} configured models are live. Family-safe candidates (no collision with other seats): ${ok.length ? ok.join(", ") : "NONE \u2014 every live family is already seated; escalate to Kimi."}`);
    });
    logError("LIST FREE MODELS — advisory only. Nothing was changed. Copy chosen slugs into OR_SEAT_MODELS, then run TEST OPENROUTER MODELS to confirm they answer.");
  }

  // ---------- v3.1 Task 2: Model liveness test ----------
  // Kimi's requirement: "Before shipping, run a test dispatch to the new model
  // and confirm it responds with a non-empty answer. Do not commit a model you
  // haven't tested." Fable cannot dispatch (no network in the build container),
  // so the test ships as a button the Founder runs in the live browser.
  // Uses the REAL callOpenRouterModel path, so it exercises pacing, the 404
  // detector, the <think> strip and the empty-answer guard — not a mock.
  async function testOrModels() {
    if (!settings.keyOpenRouter) {
      logError("MODEL TEST — no OpenRouter key saved. Paste the key, hit Save, then test.");
      return;
    }
    const seen = new Set();
    const jobs = [];
    Object.keys(OR_SEAT_MODELS).forEach((seat) => {
      (OR_SEAT_MODELS[seat] || []).forEach((m, i) => {
        if (!seen.has(m)) { seen.add(m); jobs.push({ seat, model: m, depth: i }); }
      });
    });
    logError(`MODEL TEST — dispatching to ${jobs.length} OpenRouter model(s), paced. A 429 here means rate limit (retry later), a 404 means the model is DEAD and must be swapped.`);
    let live = 0, dead = 0;
    for (const j of jobs) {
      try {
        const r = await callOpenRouterModel("Reply with the single word: OK", j.model);
        live++;
        logError(`\u2713 ${j.model} LIVE (${j.seat} seat, slot ${j.depth + 1}) — answered: ${JSON.stringify(String(r).slice(0, 40))}`);
      } catch (e) {
        dead++;
        const msg = e.message || String(e);
        const verdict = /404/.test(msg) ? "DEAD (404) — swap this entry out of OR_SEAT_MODELS"
                      : /429/.test(msg) ? "RATE-LIMITED (429) — inconclusive, retest later"
                      : "FAILED";
        logError(`\u2717 ${j.model} ${verdict} (${j.seat} seat, slot ${j.depth + 1}): ${msg}`);
      }
    }
    logError(`MODEL TEST COMPLETE — ${live} live, ${dead} failed, ${jobs.length} tested. Any seat whose entire list failed has NO OpenRouter floor.`);
  }

  // Zero-HTML-change doctrine: inject the button beside Save rather than
  // editing index.html. Guarded so a missing Save button can't break boot.
  (function ensureModelTestButton() {
    try {
      if (!saveSettingsBtn || !saveSettingsBtn.parentNode || $("testOrModels")) return;
      const b = document.createElement("button");
      b.id = "testOrModels";
      b.type = "button";
      b.textContent = "TEST OPENROUTER MODELS";
      b.className = saveSettingsBtn.className || "";
      b.style.cssText = "margin-top:10px;width:100%;opacity:0.85;";
      saveSettingsBtn.parentNode.insertBefore(b, saveSettingsBtn.nextSibling);
      b.addEventListener("click", async () => {
        const label = b.textContent;
        b.disabled = true;
        b.textContent = "TESTING\u2026 see Error Logs";
        try { await testOrModels(); } finally { b.disabled = false; b.textContent = label; }
      });

      // v3.1.1 — catalog discovery. No API key required: the models endpoint
      // is public, so this works even before any key is saved.
      const c = document.createElement("button");
      c.id = "listFreeModels";
      c.type = "button";
      c.textContent = "LIST FREE MODELS";
      c.className = saveSettingsBtn.className || "";
      c.style.cssText = "margin-top:10px;width:100%;opacity:0.85;";
      b.parentNode.insertBefore(c, b.nextSibling);
      c.addEventListener("click", async () => {
        const label = c.textContent;
        c.disabled = true;
        c.textContent = "FETCHING\u2026 see Error Logs";
        try { await listFreeModels(); } finally { c.disabled = false; c.textContent = label; }
      });
    } catch (e) { /* cosmetic — never block boot */ }
  })();

  // ---------- v3.2: Adjudication Round (Kimi-ratified) ----------
  // Fires ONLY on a DIVIDED result, and ONLY on the RAW per-seat answers —
  // BEFORE any synthesis. This ordering is load-bearing: the 2026-07-18
  // corrigibility probe proved a synthesized voice cannot assign individual
  // error ("I did not make that claim" spoken for all three seats at once).
  // Self-audit must see the seats un-merged or it is structurally blind.
  //
  // Each answering seat is shown every OTHER seat's answer, ANONYMIZED as
  // "Position A/B/C" (no model or seat names — an understudy told it argues
  // with "Kimi" defers to the label, not the argument). It returns a
  // structured verdict. THE SYCOPHANCY GUARD (Requirement 2.4): a concession
  // with an empty/generic error field DOES NOT COUNT. Llama-class models fold
  // the instant they are challenged; a seat that flips without naming the
  // error is collapsing, not reasoning. Unearned concessions are logged as a
  // trust signal, never used to resolve.
  const ADJUDICATION_ENABLED_KEY = "rq_adjudication_enabled";
  function adjudicationEnabled() {
    // Default ON — it only fires on DIVIDED rounds, which are already the
    // expensive case, and it can only IMPROVE a divided outcome.
    return localStorage.getItem(ADJUDICATION_ENABLED_KEY) !== "off";
  }

  function letterFor(i) { return String.fromCharCode(65 + i); } // 0->A

  // A concession counts only if it names a specific, locatable error.
  // Rejects empties, and generic collapse ("you're right", "good point",
  // "I agree", "on reflection") with no located flaw.
  function isSubstantiveError(err) {
    if (!err || typeof err !== "string") return false;
    const e = err.trim();
    if (e.length < 25) return false; // too short to locate anything
    const generic = /^(you'?re right|good point|i agree|on reflection|fair enough|that'?s correct|yes,?\s|indeed|agreed)\b/i;
    if (generic.test(e) && e.length < 60) return false;
    return true;
  }

  function parseAdjVerdict(raw) {
    // Seats are asked for JSON; free-tier models wrap it in prose or fences.
    // Extract the first balanced {...} and parse defensively.
    if (!raw) return null;
    let s = String(raw).replace(/```json|```/gi, "");
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a === -1 || b <= a) return null;
    try {
      const o = JSON.parse(s.slice(a, b + 1));
      const verdict = String(o.verdict || "").toLowerCase().trim();
      if (!["concede", "refute", "hold"].includes(verdict)) return null;
      return {
        verdict,
        target: o.target ? String(o.target).trim() : null,
        error: o.error ? String(o.error).trim() : "",
        confidence: typeof o.confidence === "number" ? o.confidence : null,
      };
    } catch (e) { return null; }
  }

  function buildAdjPrompt(originalQuery, selfLetter, positions) {
    const board = positions
      .map((p) => `Position ${p.letter}:\n${p.text}`)
      .join("\n\n");
    return (
      "You are one voice in a panel that returned NO CONSENSUS on the question below. " +
      "Your job now is to adjudicate — find the truth, not to keep the peace.\n\n" +
      "ORIGINAL QUESTION:\n" + originalQuery + "\n\n" +
      "ALL POSITIONS (anonymized — you do not know which is whose, including your own):\n" +
      board + "\n\n" +
      "You submitted Position " + selfLetter + ".\n\n" +
      "Examine the OTHER positions against the question. Then return ONLY a JSON object, no prose:\n" +
      '{"verdict": "concede" | "refute" | "hold", "target": "<the position letter you are conceding to or refuting>", "error": "<the SPECIFIC, located flaw — which claim, and why it is wrong. Required for concede or refute.>", "confidence": <0.0-1.0>}\n\n' +
      "RULES:\n" +
      "- concede: another position is right and yours has a specific error. You MUST state that error precisely — its location and why. 'You are right' or 'good point' is NOT an error and will be rejected.\n" +
      "- refute: another position has a specific error. Name it precisely.\n" +
      "- hold: you stand by your position and no other position located a real flaw in it. Say in one sentence why the disagreement does not change your answer.\n" +
      "A concession that does not name a locatable error does not count. Reason it through yourself."
    );
  }

  // Run the adjudication round. Returns a resolution object or null.
  async function runAdjudication(originalQuery, rawAnswers, wrappedCalls) {
    if (!adjudicationEnabled()) return null;
    const answering = rawAnswers.filter((a) => a.text && !a.malformed);
    if (answering.length < 2) return null;

    // Anonymize. Letter assignment is stable within this round only.
    const positions = answering.map((a, i) => ({
      letter: letterFor(i), seat: a.name, text: a.text,
    }));
    logError(`ADJUDICATION — DIVIDED round enters cross-examination. ${positions.length} positions, anonymized. Each seat sees the others and must locate a specific error or hold.`);

    // Dispatch per seat via its live call path (the wrapped failover fn that
    // occupies the chair this dispatch), passed in from runLiveCouncil.
    const seatFns = {};
    (wrappedCalls || []).forEach((c) => { seatFns[c.name] = c.fn; });

    const verdicts = [];
    for (const p of positions) {
      const fn = seatFns[p.seat];
      if (!fn) continue;
      const prompt = buildAdjPrompt(originalQuery, p.letter, positions);
      try {
        const raw = await fn(prompt);
        const v = parseAdjVerdict(raw);
        if (!v) {
          logError(`ADJUDICATION — ${seatLabel(p.seat)} (Position ${p.letter}) returned no parseable verdict. Treated as HOLD.`);
          verdicts.push({ letter: p.letter, seat: p.seat, verdict: "hold", target: null, error: "", counted: false });
          continue;
        }
        // The sycophancy guard.
        const substantive = (v.verdict === "concede" || v.verdict === "refute") ? isSubstantiveError(v.error) : true;
        if ((v.verdict === "concede" || v.verdict === "refute") && !substantive) {
          logError(`\u26A0 ADJUDICATION — ${seatLabel(p.seat)} (Position ${p.letter}) ${v.verdict.toUpperCase()}D to ${v.target || "?"} WITHOUT a locatable error ("${clip(v.error, 60)}"). SYCOPHANCY GUARD: does not count. Logged as an unearned concession — trust signal for the Nemotron scoring docket.`);
          verdicts.push({ letter: p.letter, seat: p.seat, verdict: "hold", target: v.target, error: v.error, counted: false, collapsed: true });
        } else {
          logError(`ADJUDICATION — ${seatLabel(p.seat)} (Position ${p.letter}): ${v.verdict.toUpperCase()}${v.target ? " -> " + v.target : ""}${v.error ? " — " + clip(v.error, 80) : ""}`);
          verdicts.push({ letter: p.letter, seat: p.seat, verdict: v.verdict, target: v.target, error: v.error, counted: true });
        }
      } catch (e) {
        logError(`ADJUDICATION — ${seatLabel(p.seat)} failed to respond (${e.message || e}). Treated as HOLD.`);
        verdicts.push({ letter: p.letter, seat: p.seat, verdict: "hold", target: null, error: "", counted: false });
      }
    }

    // Resolution: RESOLVED iff all-but-one seat concedes (counted) to the
    // SAME position, and that position did not itself concede.
    const counted = verdicts.filter((v) => v.counted && v.verdict === "concede");
    const byTarget = {};
    counted.forEach((v) => {
      const t = (v.target || "").toUpperCase().replace(/[^A-Z]/g, "").charAt(0);
      if (t) (byTarget[t] = byTarget[t] || []).push(v);
    });
    let winner = null;
    Object.keys(byTarget).forEach((t) => {
      const conceders = byTarget[t];
      const targetHeld = !verdicts.find((v) => v.letter === t && v.verdict === "concede" && v.counted);
      // everyone except the target conceded to the target, with real errors
      if (conceders.length >= positions.length - 1 && targetHeld) {
        winner = t;
      }
    });

    if (winner) {
      const w = positions.find((p) => p.letter === winner);
      logError(`\u2713 RESOLVED — Position ${winner} (${seatLabel(w.seat)}) survived cross-examination; every other seat located a specific error in its own position and conceded. Won by adjudication, NOT by vote.`);
      return { resolved: true, winnerSeat: w.seat, winnerText: w.text, verdicts, contestedNote: null };
    }

    // Not resolved: surface the specific contested claims (the real
    // "divergence is the answer" — located, not lexical).
    const refutations = verdicts.filter((v) => v.counted && v.verdict === "refute" && v.error);
    const contestedNote = refutations.length
      ? refutations.map((v) => `${seatLabel(v.seat)} disputes Position ${(v.target || "?").toUpperCase().charAt(0)}: ${clip(v.error, 120)}`).join(" \u2014 ")
      : null;
    const collapses = verdicts.filter((v) => v.collapsed).length;
    logError(`ADJUDICATION — remains DIVIDED after cross-examination${collapses ? ` (${collapses} unearned concession(s) rejected by the guard)` : ""}. ${contestedNote ? "Specific contested claims surfaced." : "No seat located a decisive error."}`);
    return { resolved: false, verdicts, contestedNote };
  }

  async function runLiveCouncil(query) {
    const calls = [];
    if (settings.keyGemini) {
      calls.push({ name: "gemini", fn: callGemini });
    } else if (settings.keyCerebras) {
      calls.push({ name: "gemini", fn: callCerebras }); // Cerebras understudies Gemini's seat (free tier)
    }
    if (settings.keyKimi) calls.push({ name: "kimi", fn: callKimi });
    if (settings.keyClaude) {
      calls.push({ name: "claude", fn: callClaude });
    } else if (settings.keyGroq) {
      calls.push({ name: "claude", fn: callGroq }); // Groq understudies Claude's seat (free tier)
    }

    // reset per-dispatch provider tracking
    calls.forEach((c) => {
      seatProvider[c.name] =
        (c.name === "claude" && groqUnderstudy()) ? "groq" :
        (c.name === "gemini" && cerebrasUnderstudy()) ? "cerebras" :
        "primary";
    });

    // Snapshot the configured occupant per seat BEFORE the failover chain
    // mutates seatProvider — needed to gate circuit resets correctly below.
    const configuredTag = Object.assign({}, seatProvider);
    refreshAllSeatHealth(); // v3.1 Task 1 — show configured occupants at dispatch start

    const orAvailable = !!settings.keyOpenRouter;

    // v3.1.1 — validate seat chains against the live catalog ONCE per page
    // load, on first dispatch (not at boot: no cost for users who never
    // convene). Fire-and-forget: advisory, must never delay or block a round.
    // BUGFIX 2026-07-19: this block previously sat ABOVE `const orAvailable`,
    // a temporal-dead-zone ReferenceError that threw on first dispatch whenever
    // the catalog check ran. Declaration moved up; check now follows it.
    if (orAvailable && !catalogChecked) {
      catalogChecked = true;
      validateOrSeatModels().catch(() => {});
    }

    // ---------- Failover chains (v2.4) ----------
    // Each seat walks a chain until one provider answers:
    //   Gemini seat: Gemini primary -> Cerebras -> OpenRouter
    //   Claude seat: Claude primary (or Groq understudy) -> OpenRouter
    //   Kimi seat:   Kimi primary -> OpenRouter
    // Circuit-open seats skip their PRIMARY only — fallback providers have
    // independent quotas and still get their shot. The circuit trips only on
    // the seat's configured primary, never on a fallback's 429.
    const wrapped = calls.map((c) => ({
      name: c.name,
      fn: async (q) => {
        const cap = c.name[0].toUpperCase() + c.name.slice(1);
        // v2.9.1: per-seat identity. The shared memory block carries a
        // {{SEAT_IDENTITY}} token; each seat receives its own name here.
        // Live failure 2026-07-14: without this, all three seats saw the
        // roster format in memory and answered AS THE WHOLE COUNCIL —
        // nine impersonated voices from three models, tripled output,
        // renewed truncation. Examples beat instructions; identity must
        // be explicit and singular.
        q = q.replace("{{SEAT_IDENTITY}}",
          `YOUR IDENTITY: You are the ${cap} seat of this council — one seat only. ` +
          `The other seats deliberate separately and answer for themselves. ` +
          `Write YOUR position only. Never simulate, quote, or draft responses for other seats.`);
        const primaryTag = seatProvider[c.name]; // configured occupant at dispatch start

        const chain = [];
        if (!circuitOpen(c.name)) {
          chain.push({ tag: primaryTag, run: c.fn, enter: null });
        }
        // Cerebras as mid-chain failover for the Gemini seat (only when a
        // real Gemini key holds the seat — otherwise Cerebras IS the primary)
        if (c.name === "gemini" && settings.keyGemini && settings.keyCerebras) {
          chain.push({
            tag: "cerebras",
            run: callCerebras,
            enter: () => {
              seatProvider[c.name] = "cerebras";
              markSeat("gemini", "cerebras", "Gemini seat — failover: Cerebras (" + CEREBRAS_MODEL_LABEL + ")");
            },
          });
        }
        if (orAvailable) {
          chain.push({
            tag: "openrouter",
            run: (qq) => callOpenRouter(qq, c.name),
            enter: () => {
              seatProvider[c.name] = "openrouter";
              renderSeatHealth(c.name); // v3.1 Task 1 — weight drops here
              // visual marking happens per-model inside the OR walk
            },
          });
        }

        if (chain.length === 0) throw new Error(`${cap} circuit open, no fallback available`);
        if (circuitOpen(c.name)) logError(`${cap} circuit open — primary skipped, seat routed to ${chain[0].tag} fallback.`);

        let lastErr = null;
        for (let i = 0; i < chain.length; i++) {
          const step = chain[i];
          if (step.enter) step.enter();
          try {
            return await step.run(q);
          } catch (e) {
            lastErr = e;
            // only the configured primary's 429 trips the seat circuit
            if (step.tag === primaryTag && (e.message || "").includes("429")) {
              tripCircuit(c.name, fetchWithRetry.lastRetryAfterMs);
            }
            const next = chain[i + 1];
            if (next) {
              logError(`${seatLabel(c.name)} ${step.tag} failed (${e.message || e}) — seat falling to ${next.tag}.`);
            }
          }
        }
        throw lastErr || new Error(`${cap} — all providers in chain failed`);
      },
    }));
    if (wrapped.length === 0) return null;
    calls.length = 0;
    calls.push(...wrapped);

    calls.forEach((c) => agents[c.name].classList.add("thinking"));

    // stagger launches ~700ms apart to avoid same-millisecond burst tripping RPM limits
    const staggered = calls.map((c, i) =>
      sleep(i * 700).then(() => c.fn(query))
    );
    const results = await Promise.allSettled(staggered);

    const answers = [];
    results.forEach((r, i) => {
      const name = calls[i].name;
      if (r.status === "fulfilled" && r.value) {
        // v3.1 Task 4: provenance travels WITH the answer. seatProvider is
        // final for this seat by now (all promises settled), so the snapshot
        // is accurate. Task 5's session JSON reads these fields.
        answers.push({
          name,
          text: r.value,
          tier: seatTier(name),
          provider: seatProvider[name] || "primary",
          model: seatModelLabel(name),
          weightBase: seatBaseWeight(name),
          weightLive: seatWeight(name),          // what consensus actually uses
          weightEffective: seatWeightEffective(name), // SHADOW — not used
        });
        // Circuit reset fix (2026-07-13, KIMI-RATIFIED same day): only a
        // healthy PRIMARY closes its own circuit — "a fallback rescue is
        // evidence the fallback is healthy, not the primary." Previously a fallback
        // rescue also reset the breaker, so the next dispatch re-burned
        // retries on a still-rate-limited primary — the cooldown never held
        // past one round.
        if (seatProvider[name] === configuredTag[name]) resetCircuit(name);
      } else {
        const msg = r.reason?.message || "unknown error";
        logError(`${seatLabel(name)} failed: ${msg}`);
      }
      agents[name].classList.remove("thinking");
    });

    if (answers.length === 0) return null; // triggers demo fallback

    // v3.4: run the Pyodide sandbox on any code the seats emitted (SHADOW —
    // logged + attached to each answer, NOT fed to consensus). Non-fatal.
    await runSandboxShadow(answers);
    // v3.4.2: feed computed results back to the seats (toggle rq_sandbox_feedback;
    // OFF by default, so consensus is unchanged until deliberately enabled).
    await runSandboxFeedback(answers, calls);

    // MALFORMED_RESPONSE rule (Kimi review, 2026-07-12, Claude amendment):
    // enforced ONLY when the query itself demands a FINAL DIRECTIVE —
    // otherwise every conversational query would empty all seats.
    // Anchored queries: answers missing the anchor (truncation, ignored
    // instructions) are flagged and excluded from consensus math instead
    // of silently corrupting the similarity scores.
    const wantsDirective = /FINAL DIRECTIVE/i.test(query);
    let eligible = answers;
    if (wantsDirective) {
      eligible = answers.filter((a) => extractDirective(a.text));
      answers.filter((a) => !extractDirective(a.text)).forEach((m) => {
        // Kimi amendment (2026-07-13): tag for the Divided Council panel —
        // malformed seats render dimmed with a MALFORMED badge, never hidden.
        m.malformed = true;
        logError(`${seatLabel(m.name)} MALFORMED_RESPONSE — no FINAL DIRECTIVE anchor found (likely truncation or ignored instructions). Seat treated as empty this round.`)
      });
      if (eligible.length === 0) {
        logError("All responses malformed — no directives to compare. Council divided by default; raw positions logged to Session History.");
        return { text: null, divided: true, answers };
      }
    }

    if (eligible.length === 1) {
      logError(`SOLE VOICE round — only one eligible answer (${seatLabel(eligible[0].name)}). No cross-model verification occurred; treat as a single model's opinion, not Council consensus.`);
      return { text: eligible[0].text.trim(), divided: false, answers: eligible, trust: "sole" };
    }

    const { agreed, outliers } = checkConsensus(eligible);

    // PROVISIONAL rule (Kimi amendment, 2026-07-12): consensus is verified
    // if and only if at least one primary (1.0) voice is in the agreeing set.
    // Any all-understudy/all-fallback agreement is workflow continuity, not verification.
    const hasPrimaryVoice = agreed.some((a) => seatProvider[a.name] === "primary");
    if (agreed.length >= 2 && !hasPrimaryVoice) {
      logError("Consensus is PROVISIONAL — no primary voice (Gemini Pro / Kimi / Claude live) in the agreeing set. Treat as workflow continuity, not verified consensus.");
    }
    // ---------- v3.1 Task 4: SHADOW MODE logging ----------
    // Logged only. The live consensus math above is UNCHANGED and still uses
    // seatWeight(). This block exists so the ratified TIER_DECAY schedule can
    // be evaluated against real rounds before anyone promotes it.
    eligible.forEach((a) => {
      const t = seatTier(a.name);
      const live = seatWeight(a.name);
      const shadow = seatWeightEffective(a.name);
      logError(`SHADOW WEIGHT — ${seatLabel(a.name)}: tier ${t}, base ${seatBaseWeight(a.name)}, LIVE weight ${live} (used), shadow weightEffective ${shadow} (not used, delta ${Math.round((shadow - live) * 100) / 100}).`);
    });
    (function shadowTagRule() {
      const allDeep = eligible.length > 0 && eligible.every((a) => seatTier(a.name) >= 2);
      const livePrimary = agreed.some((a) => seatProvider[a.name] === "primary");
      if (allDeep) {
        logError(`SHADOW TAG RULE — every eligible seat is tier \u22652. TIER_DECAY rule would downgrade this round's tag (VERIFIED\u2192PROVISIONAL, PROVISIONAL\u2192DIVIDED). Shadow only; tag unchanged.`);
      }
      // The existing hasPrimaryVoice rule (2026-07-12) already covers most of
      // this. Log where the two rules DISAGREE — that delta is the only
      // evidence that justifies adding a second rule at all.
      if (allDeep !== !livePrimary) {
        logError(`SHADOW RULE DIVERGENCE — tier rule says allDeep=${allDeep}, existing primary-voice rule says noPrimary=${!livePrimary}. The two rules disagree on this round; Kimi should see this before the tier rule is promoted.`);
      }
    })();

    if (agreed.length < 2) {
      // No consensus by the lexical comparator. v3.2: before declaring
      // DIVIDED, run the adjudication round on the RAW answers (pre-synthesis).
      // A correct-but-outvoted seat gets a chance to win by locating errors in
      // the others; the sycophancy guard rejects concessions that name none.
      logError(`Consensus round FAILED by lexical threshold — ${eligible.length} eligible agents, 0 agreements. Entering v3.2 adjudication before declaring DIVIDED.`);
      const adj = await runAdjudication(query, eligible, calls);
      if (adj && adj.resolved) {
        return {
          text: adj.winnerText.trim(),
          divided: false,
          answers,
          trust: "resolved",
          agreedCount: 1,
          eligibleCount: eligible.length,
          resolvedBy: seatLabel(adj.winnerSeat),
        };
      }
      // Still divided — attach any located contested claims for display.
      return { text: null, divided: true, answers, contestedNote: adj ? adj.contestedNote : null };
    }
    if (outliers.length > 0) {
      outliers.forEach((o) =>
        logError(`${seatLabel(o.name)} excluded as outlier — position diverged from majority.`)
      );
    }

    // weighted synthesis: highest-weight agreeing voice speaks for the Council;
    // among equal weights, shortest coherent answer wins
    agreed.sort((a, b) => (seatWeight(b.name) - seatWeight(a.name)) || (a.text.length - b.text.length));
    const speaker = agreed[0];
    logError(`Consensus synthesized — speaking voice: ${seatLabel(speaker.name)} (weight ${seatWeight(speaker.name)}), ${agreed.length}/${eligible.length} eligible agents in agreement.`);
    return {
      text: speaker.text.trim(),
      divided: false,
      answers,
      trust: hasPrimaryVoice ? "verified" : "provisional",
      agreedCount: agreed.length,
      eligibleCount: eligible.length,
    };
  }

  // ---------- Divided Council panel (v2.6, Gemini feature request 2026-07-13,
  // Kimi-approved same day with malformed-badge amendment) ----------
  // When consensus fails, the divergence IS the answer. Render each seat's
  // position in the main viewport instead of burying it in Session History.
  // Cards render in DISPATCH ORDER (Kimi ratification: weight-sorting would
  // imply epistemic authority that doesn't exist in disagreement — badges
  // show weight, users interpret hierarchy themselves). History logging is
  // unchanged — this is presentation only. Cards render via textContent,
  // never innerHTML: model output is untrusted input.
  let dividedPanel = null;
  function ensureDividedPanel() {
    if (dividedPanel) return dividedPanel;
    dividedPanel = document.createElement("section");
    dividedPanel.id = "dividedPanel";
    dividedPanel.setAttribute("aria-label", "Divided Council positions");
    const style = document.createElement("style");
    style.textContent = [
      "#dividedPanel { display: none; margin: 12px 0 0; }",
      "#dividedPanel.active { display: block; }",
      "#dividedPanel .divided-note { font-size: 0.8em; opacity: 0.75; margin: 0 0 8px; }",
      ".divided-card { border-left: 3px solid #d97706; background: rgba(217,119,6,0.08); border-radius: 6px; padding: 10px 12px; margin: 8px 0; }",
      ".divided-card.malformed { opacity: 0.55; border-left-color: #dc2626; }",
      ".divided-badge { color: #dc2626; border: 1px solid #dc2626; padding: 0 4px; border-radius: 4px; font-size: 0.72em; font-weight: normal; letter-spacing: 0.05em; margin-left: 6px; vertical-align: middle; }",
      ".divided-card h4 { margin: 0 0 6px; font-size: 0.85em; letter-spacing: 0.02em; }",
      ".divided-card h4 .divided-weight { opacity: 0.6; font-weight: normal; margin-left: 6px; }",
      ".divided-card p { margin: 0; white-space: pre-wrap; font-size: 0.9em; line-height: 1.45; }",
    ].join("\n");
    document.head.appendChild(style);
    consensusBar.parentNode.insertBefore(dividedPanel, consensusBar.nextSibling);
    return dividedPanel;
  }
  function clearDividedPanel() {
    if (dividedPanel) {
      dividedPanel.classList.remove("active");
      dividedPanel.innerHTML = "";
    }
  }
  function renderDividedPanel(answers) {
    const panel = ensureDividedPanel();
    panel.innerHTML = "";
    const note = document.createElement("p");
    note.className = "divided-note";
    note.textContent = "No consensus — the divergence is the answer. Each seat's position, unedited:";
    panel.appendChild(note);
    answers.forEach((a) => {
      const card = document.createElement("div");
      card.className = "divided-card";
      const h = document.createElement("h4");
      h.textContent = seatLabel(a.name);
      const w = document.createElement("span");
      w.className = "divided-weight";
      w.textContent = "weight " + seatWeight(a.name);
      h.appendChild(w);
      // Kimi amendment (2026-07-13): malformed seats appear dimmed with a
      // badge and their (truncated) text visible, so the user sees the seat
      // tried to answer and why it was disqualified from consensus math.
      if (a.malformed) {
        card.classList.add("malformed");
        const badge = document.createElement("span");
        badge.className = "divided-badge";
        badge.textContent = "MALFORMED — no directive anchor";
        h.appendChild(badge);
      }
      const p = document.createElement("p");
      renderRich(p, a.text); // v3.1.2
      card.appendChild(h);
      card.appendChild(p);
      panel.appendChild(card);
    });
    panel.classList.add("active");
  }

  // ==================== v2.9: RED QUEEN MEMORY ====================
  // Two organs, built 2026-07-14 (FLAGGED FOR KIMI REVIEW):
  //   Organ 1 — Council Ledger: conversational memory. A shared, trust-
  //     aware record of past rounds, injected into every seat's dispatch
  //     so follow-up questions work. SHARED ledger, not per-seat memories
  //     (Fable recommendation pending Kimi ruling): every seat sees the
  //     same history, with trust prefixes intact, so no seat can mistake
  //     a past SOLE VOICE for settled council law. Deterministic
  //     compaction — zero API cost. Hard token cap so memory never
  //     bankrupts the free tiers.
  //   Organ 2 — Institutional memory: Supabase telemetry/events per the
  //     Kimi v2.8 handoff schema, fail-soft (Supabase down or unset =
  //     Red Queen works exactly as before; memory must never be a
  //     dependency that can break dispatch).

  // ---------- Organ 1: Council Ledger ----------
  const LEDGER_KEY = "rq_ledger_v1";
  const MEMORY_ENABLED_KEY = "rq_memory_enabled";
  // v3.2 (Founder request 2026-07-19): storage 40 -> 200, and inject more
  // history per prompt. HONEST TRADE-OFF, made explicit rather than silent:
  //  - Storage cap is cheap: it is just localStorage bytes.
  //  - Injection cap is NOT cheap: every char here is prepended to EVERY seat
  //    dispatch, competing with the actual question for a free-tier model's
  //    context window, and it directly amplifies the cross-session convergence
  //    ("ledger flattening") Kimi flagged for investigation. So the injection
  //    budget is raised to a deliberate, bounded value with a hard ceiling —
  //    not uncapped. MEMORY_CONTEXT_HARD_MAX is the wall it can never cross,
  //    so a 200-entry ledger can never balloon a prompt past a free seat's
  //    limit. Tune MEMORY_CONTEXT_CHAR_CAP between the two, never above HARD_MAX.
  const LEDGER_MAX_ENTRIES = 200;       // persistent cap (localStorage hygiene)
  const LEDGER_VERBATIM_ROUNDS = 3;     // newest N rounds get fuller text
  const MEMORY_CONTEXT_CHAR_CAP = 6000; // ≈1500 tokens — injection budget (raised from 2400)
  const MEMORY_CONTEXT_HARD_MAX = 8000; // ≈2000 tokens — absolute ceiling; CHAR_CAP must never exceed this

  function loadLedger() {
    try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || []; }
    catch { return []; }
  }
  let ledger = loadLedger();

  function persistLedger() {
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); }
    catch (e) { logError("Ledger persist failed (localStorage full?) — memory continues in-page only. " + (e.message || e)); }
  }

  function memoryEnabled() {
    return localStorage.getItem(MEMORY_ENABLED_KEY) !== "off";
  }
  function setMemoryEnabled(on) {
    localStorage.setItem(MEMORY_ENABLED_KEY, on ? "on" : "off");
  }

  const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s || "");

  // Memory sanitization: past prompts/verdicts can contain the literal
  // anchor phrase (the v2.7 election texts did). If injected verbatim,
  // remembered anchors would false-arm anchored-consensus mode and could
  // be mistaken for verdicts by extractDirective. Neutralize on write.
  const sanitizeMemory = (s) => (s ? s.replace(/FINAL DIRECTIVE:/gi, "FINAL VERDICT —") : s);

  // Record one completed round. Demo rounds are never recorded — canned
  // answers must not pollute real memory.
  function recordLedger(entry) {
    entry.prompt = sanitizeMemory(entry.prompt);
    if (entry.verdict) entry.verdict = sanitizeMemory(entry.verdict);
    if (entry.positions) entry.positions.forEach((p) => { p.text = sanitizeMemory(p.text); });
    ledger.push(entry);
    if (ledger.length > LEDGER_MAX_ENTRIES) ledger = ledger.slice(-LEDGER_MAX_ENTRIES);
    persistLedger();
  }

  // One ledger entry -> one text line. Trust state ALWAYS travels with
  // the memory — doctrine applies to the past as much as the present.
  function ledgerLine(e, verbatim) {
    const q = clip(e.prompt, verbatim ? 200 : 100);
    if (e.outcome === "divided") {
      const posCap = verbatim ? 200 : 60;
      const positions = (e.positions || [])
        .map((p) => `${p.seat}: "${clip(p.text, posCap)}"`)
        .join(" | ");
      return `Q: "${q}" → DIVIDED (no consensus) — ${positions}`;
    }
    const tag =
      e.outcome === "verified" ? `VERIFIED ${e.counts || ""}`.trim() :
      e.outcome === "provisional" ? `PROVISIONAL ${e.counts || ""} (bench only, unconfirmed)`.trim() :
      e.outcome === "sole" ? "SOLE VOICE (single model, unverified)" :
      e.outcome.toUpperCase();
    return `Q: "${q}" → ${tag}: "${clip(e.verdict, verbatim ? 400 : 120)}"`;
  }

  const MEMORY_HEADER =
    "=== COUNCIL MEMORY (shared ledger) ===\n" +
    "You are one seat on the Red Queen council — a browser-based multi-model " +
    "consensus orchestrator (static site, no backend). Below is the shared " +
    "record of this council's previous rounds, oldest first. Read the trust " +
    "tags carefully: VERIFIED = full council agreement; PROVISIONAL = bench-" +
    "only agreement, unconfirmed; SOLE VOICE = one model's unverified opinion; " +
    "DIVIDED = no consensus was reached and the positions are listed. Past " +
    "SOLE VOICE or DIVIDED rounds are NOT settled conclusions. Use this memory " +
    "to answer follow-ups; do not restate it unless asked.\n" +
    "{{SEAT_IDENTITY}}\n" +
    "Respond in the language of the CURRENT QUESTION.\n";

  // Build the injected context: newest rounds verbatim, older rounds
  // compacted, assembled newest-backwards under the hard char cap, then
  // emitted oldest-first for natural reading order.
  function buildMemoryContext() {
    if (!memoryEnabled() || ledger.length === 0) return "";
    const lines = [];
    // Defensive clamp: even if CHAR_CAP is mis-tuned above HARD_MAX, the
    // injection can never exceed the ceiling that protects free-tier prompts.
    let budget = Math.min(MEMORY_CONTEXT_CHAR_CAP, MEMORY_CONTEXT_HARD_MAX);
    for (let i = ledger.length - 1; i >= 0; i--) {
      const verbatim = i >= ledger.length - LEDGER_VERBATIM_ROUNDS;
      const line = `[Round ${i + 1}] ` + ledgerLine(ledger[i], verbatim);
      if (line.length + 1 > budget) break;
      budget -= line.length + 1;
      lines.unshift(line);
    }
    if (lines.length === 0) return "";
    return MEMORY_HEADER + lines.join("\n") + "\n=== CURRENT QUESTION ===\n";
  }

  // ---------- Memory UI (created dynamically — zero index.html changes,
  // same pattern as the Divided Council panel) ----------
  let memoryPill = null;
  function ensureMemoryUI() {
    if (memoryPill) return;
    const style = document.createElement("style");
    style.textContent = [
      "#memoryPill { position: fixed; bottom: 14px; left: 14px; z-index: 60; display: flex; gap: 6px; }",
      "#memoryPill button { font-size: 0.72em; letter-spacing: 0.04em; padding: 4px 10px; border-radius: 999px; border: 1px solid #d97706; background: rgba(217,119,6,0.12); color: inherit; cursor: pointer; }",
      "#memoryPill button.mem-off { border-color: #666; background: rgba(120,120,120,0.12); opacity: 0.7; }",
    ].join("\n");
    document.head.appendChild(style);
    memoryPill = document.createElement("div");
    memoryPill.id = "memoryPill";
    const toggle = document.createElement("button");
    const forget = document.createElement("button");
    const refresh = () => {
      const on = memoryEnabled();
      toggle.textContent = on ? `MEMORY ON · ${ledger.length}` : "MEMORY OFF";
      toggle.classList.toggle("mem-off", !on);
      forget.style.display = on && ledger.length ? "" : "none";
    };
    toggle.title = "Toggle whether past rounds are injected into council dispatches";
    forget.textContent = "FORGET";
    forget.title = "Erase the council ledger (permanent)";
    toggle.addEventListener("click", () => { setMemoryEnabled(!memoryEnabled()); refresh(); });
    forget.addEventListener("click", () => {
      if (!confirm("Erase the council's memory of " + ledger.length + " round(s)? This is permanent.")) return;
      ledger = [];
      persistLedger();
      refresh();
    });
    memoryPill.appendChild(toggle);
    memoryPill.appendChild(forget);
    document.body.appendChild(memoryPill);
    memoryPill.refresh = refresh;
    refresh();
  }
  ensureMemoryUI();

  // ---------- Organ 2: Institutional memory (Supabase, fail-soft) ----------
  // Kimi v2.8 handoff schema. Implemented via Supabase's PostgREST HTTP
  // API directly — no CDN script, no library, flat-file doctrine intact.
  // AMENDED from handoff (flagged): `const supabase = supabase.createClient`
  // would TDZ-crash; fetch avoids the entire class of problem.
  const RQ_SESSION_ID = "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  let dispatchCounter = 0;

  function sbConfigured() {
    return !!(settings.supabaseUrl && settings.supabaseAnonKey);
  }
  function sbInsert(table, rows) {
    if (!sbConfigured()) return Promise.resolve();
    return fetch(settings.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/" + table, {
      method: "POST",
      headers: {
        apikey: settings.supabaseAnonKey,
        Authorization: "Bearer " + settings.supabaseAnonKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    }).then((res) => {
      if (!res.ok) logError(`Institutional memory write to ${table} failed (HTTP ${res.status}) — dispatch unaffected.`);
    }).catch((e) => {
      logError(`Institutional memory unreachable (${table}): ${e.message || e} — dispatch unaffected.`);
    });
  }

  // Per-dispatch telemetry + significant-event logging. Fire-and-forget:
  // never awaited on the dispatch critical path.
  function logInstitutionalMemory(dispatchId, query, result) {
    if (!sbConfigured()) return;
    const answers = (result && result.answers) || [];
    const rows = answers.map((a) => ({
      session_id: RQ_SESSION_ID,
      dispatch_id: dispatchId,
      seat_label: seatLabel(a.name),
      provider: a.provider || seatProvider[a.name] || "primary",
      model: a.model || seatLabel(a.name),
      event_type: a.malformed ? "answer_malformed" : "answer",
      consensus_weight: typeof a.weightLive === "number" ? a.weightLive : seatWeight(a.name),
      // v3.1 Task 4 — provenance columns (Task 5 session JSON reads these).
      // weight_effective is SHADOW: logged, never used in consensus.
      tier: typeof a.tier === "number" ? a.tier : seatTier(a.name),
      weight_base: typeof a.weightBase === "number" ? a.weightBase : seatBaseWeight(a.name),
      weight_effective: typeof a.weightEffective === "number" ? a.weightEffective : seatWeightEffective(a.name),
    }));
    rows.push({
      session_id: RQ_SESSION_ID,
      dispatch_id: dispatchId,
      seat_label: "council",
      provider: "redqueen",
      model: "consensus_engine",
      event_type: result.divided ? "consensus_divided" : "consensus_" + (result.trust || "unknown"),
    });
    sbInsert("rq_telemetry", rows);
    if (result.divided || result.trust === "sole") {
      sbInsert("rq_events", [{
        event_id: dispatchId,
        title: result.divided ? "Divided Council round" : "Sole Voice round",
        summary: clip(`Q: ${query} — ` + (result.divided
          ? answers.map((a) => `${seatLabel(a.name)}: ${clip(a.text, 120)}`).join(" | ")
          : `verdict: ${clip(result.text, 200)}`), 900),
        cultural_tags: [result.divided ? "divided" : "sole_voice"],
        participants: answers.map((a) => seatLabel(a.name)),
        mood: "logged_automatically",
      }]);
    }
  }

  // ==================== v3.0.0: FOUNDATION (Charter §11 items 1–6) ====================
  // Kimi/Founder charter 2026-07-14: "The v3.0 foundation is not about
  // adding features. It is about removing barriers." All UI injected
  // dynamically — zero index.html changes, flat-file doctrine intact.

  const v3css = document.createElement("style");
  v3css.textContent = [
    "#rqIntro { margin: 14px auto 0; max-width: 640px; text-align: center; }",
    "#rqIntro .rq-sub { font-size: 0.95em; opacity: 0.85; margin: 0 0 12px; line-height: 1.5; }",
    "#rqIntro .rq-cta { display: inline-block; margin: 4px 6px; padding: 9px 18px; border-radius: 999px; border: 1px solid #d97706; background: rgba(217,119,6,0.15); color: inherit; cursor: pointer; font-size: 0.85em; letter-spacing: 0.03em; }",
    "#rqIntro .rq-cta.secondary { border-color: #777; background: rgba(120,120,120,0.12); }",
    "#rqIntro .rq-how { display: block; margin: 10px auto 0; background: none; border: none; color: inherit; opacity: 0.7; text-decoration: underline; cursor: pointer; font-size: 0.78em; }",
    ".rq-modal-scrim { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 200; display: flex; align-items: center; justify-content: center; padding: 18px; }",
    ".rq-modal { background: #17151a; border: 1px solid #d97706; border-radius: 12px; max-width: 560px; max-height: 80vh; overflow-y: auto; padding: 18px 20px; font-size: 0.9em; line-height: 1.55; }",
    ".rq-modal h3 { margin: 14px 0 6px; font-size: 1em; color: #d97706; }",
    ".rq-modal h3:first-child { margin-top: 0; }",
    ".rq-modal p { margin: 0 0 8px; }",
    ".rq-modal .rq-close { float: right; background: none; border: 1px solid #777; border-radius: 999px; color: inherit; padding: 2px 10px; cursor: pointer; }",
    "#rqChips { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; }",
    "#rqChips button { font-size: 0.75em; padding: 5px 10px; border-radius: 999px; border: 1px solid #666; background: rgba(255,255,255,0.05); color: inherit; cursor: pointer; }",
    "#trustHelpBtn { margin-left: 8px; font-size: 0.72em; border: 1px solid #777; border-radius: 50%; width: 18px; height: 18px; line-height: 1; background: none; color: inherit; cursor: pointer; opacity: 0.7; vertical-align: middle; }",
    "#rqSessions .rq-sess { border: 1px solid #444; border-radius: 8px; margin: 6px 0; padding: 8px 10px; font-size: 0.82em; }",
    "#rqSessions .rq-sess-head { cursor: pointer; display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }",
    "#rqSessions .rq-badge { font-size: 0.72em; padding: 1px 7px; border-radius: 999px; border: 1px solid #d97706; color: #d97706; white-space: nowrap; }",
    "#rqSessions .rq-badge.verified { border-color: #16a34a; color: #16a34a; }",
    "#rqSessions .rq-sess-body { display: none; margin-top: 8px; white-space: pre-wrap; opacity: 0.9; }",
    "#rqSessions .rq-sess.open .rq-sess-body { display: block; }",
    "#rqSessions .rq-sess-del { float: right; background: none; border: none; color: #dc2626; cursor: pointer; font-size: 0.9em; }",
  ].join("\n");
  document.head.appendChild(v3css);

  function rqModal(html) {
    const scrim = document.createElement("div");
    scrim.className = "rq-modal-scrim";
    const box = document.createElement("div");
    box.className = "rq-modal";
    box.innerHTML = '<button class="rq-close">✕</button>' + html; // static app copy only — never user/model content
    scrim.appendChild(box);
    scrim.addEventListener("click", (e) => { if (e.target === scrim || e.target.classList.contains("rq-close")) scrim.remove(); });
    document.body.appendChild(scrim);
  }

  const TRUST_EDU_HTML =
    "<h3>Reading the Council's verdicts</h3>" +
    "<p><b>✓ VERIFIED</b> — Three primary advisors agreed on this answer.</p>" +
    "<p><b>◐ PROVISIONAL</b> — All advisors agreed, but they're on backup models. Solid, not yet premium-verified.</p>" +
    "<p><b>⚠ SOLE VOICE</b> — Only one advisor could answer. A single opinion, not a council verdict.</p>" +
    "<p><b>DIVIDED</b> — The advisors disagreed. Their raw positions are shown so you can judge — the divergence is the answer.</p>";

  const ABOUT_FAQ_HTML =
    "<h3>What is the Red Queen?</h3>" +
    "<p>Ask a question. Three AI advisors deliberate. You get the consensus — or the honest disagreement. Red Queen is a multi-model council: independent AI models answer in parallel, and she only claims agreement when it actually exists.</p>" +
    "<h3>How does the council work?</h3>" +
    "<p>1) You ask. 2) Three seats (Gemini, Kimi, Claude — with free understudies when a primary is unavailable) think independently. 3) Their answers are compared. Agreement gets a trust badge; disagreement is shown raw.</p>" +
    TRUST_EDU_HTML +
    "<h3>Does she remember?</h3>" +
    "<p>Yes — a shared council ledger records each round with its trust state, so follow-up questions work. You control it: the MEMORY pill toggles it, FORGET erases it, New Session starts fresh.</p>" +
    "<h3>Privacy</h3>" +
    "<p>🔒 All API calls are client-side. Your keys stay in your browser — we never see them, and we don't store your prompts on any Syntropy server.</p>" +
    "<h3>Terms</h3>" +
    "<p>Formal Terms of Service are being drafted by counsel. Until published: provided as-is, AI outputs may be wrong, verify before acting on them.</p>" +
    "<p style='opacity:0.6'>A Syntropy LLC project — syntropyllc.netlify.app</p>";

  const HOW_IT_WORKS_HTML =
    "<h3>How it works</h3>" +
    "<p>1️⃣ <b>You ask.</b> Type or tap a suggestion.</p>" +
    "<p>2️⃣ <b>Three models think.</b> Independent AI advisors deliberate in parallel — watch the orbs light up.</p>" +
    "<p>3️⃣ <b>You get the truth about their answer.</b> Unified verdict with a trust badge — or their honest disagreement, unedited.</p>";

  // Landing panel — shown to newcomers (no keys, no memory). Removed on
  // first dispatch. Returning users skip straight to the council.
  (function ensureLanding() {
    const hasAnyKey = !!(settings.keyGemini || settings.keyKimi || settings.keyClaude || settings.keyGroq || settings.keyOpenRouter || settings.keyCerebras);
    if (hasAnyKey || ledger.length > 0) return;
    const intro = document.createElement("div");
    intro.id = "rqIntro";
    const sub = document.createElement("p");
    sub.className = "rq-sub";
    sub.textContent = "Ask a question. Three AI advisors deliberate. You get the consensus — or the honest disagreement.";
    const tryBtn = document.createElement("button");
    tryBtn.className = "rq-cta";
    tryBtn.textContent = "👑 Try the Council (Demo)";
    tryBtn.addEventListener("click", () => {
      settings.demoMode = true;
      demoToggle.checked = true;
      saveSettings(settings);
      refreshDemoBadge();
      summonBtn.click();
    });
    const unlockBtn = document.createElement("button");
    unlockBtn.className = "rq-cta secondary";
    unlockBtn.textContent = "Unlock Live Council";
    unlockBtn.addEventListener("click", () => menuBtn.click());
    const how = document.createElement("button");
    how.className = "rq-how";
    how.textContent = "How it works";
    how.addEventListener("click", () => rqModal(HOW_IT_WORKS_HTML));
    intro.appendChild(sub);
    intro.appendChild(tryBtn);
    intro.appendChild(unlockBtn);
    intro.appendChild(how);
    consensusBar.parentNode.insertBefore(intro, consensusBar);
    window.__rqIntro = intro;
  })();

  // Trust-state education — "?" on the Consensus Bar, one tap, plain English.
  (function ensureTrustHelp() {
    const btn = document.createElement("button");
    btn.id = "trustHelpBtn";
    btn.textContent = "?";
    btn.title = "What do VERIFIED / PROVISIONAL / SOLE VOICE / DIVIDED mean?";
    btn.addEventListener("click", (e) => { e.stopPropagation(); rqModal(TRUST_EDU_HTML); });
    consensusBar.appendChild(btn);
  })();

  // Example prompt chips — blank-page anxiety killer, injected in the sheet.
  (function ensureChips() {
    if (!queryInput || !queryInput.parentNode) return;
    const chips = document.createElement("div");
    chips.id = "rqChips";
    ["Should I learn Python or JavaScript?", "Explain quantum computing like I'm 5", "What is the Red Queen?", "Is a hot dog a sandwich?"].forEach((t) => {
      const b = document.createElement("button");
      b.textContent = t;
      b.addEventListener("click", () => { queryInput.value = t; queryInput.focus(); });
      chips.appendChild(b);
    });
    queryInput.parentNode.insertBefore(chips, queryInput.nextSibling);
  })();

  // ==================== v3.0.2: TRANSPARENT CONSENSUS VISUALIZATION
  // (Kimi+Founder spec 2026-07-15, source: council proposal — Claude
  // seat/Llama. Pure CSS+JS, ledger-fed, zero dependencies. The former
  // "PAST ROUNDS" section is upgraded into the spec's Timeline rather
  // than duplicated as a parallel tab.) ====================
  const TRUST_COLORS = { verified: "#16a34a", provisional: "#d97706", divided: "#dc2626", sole: "#3b82f6" };
  const tlcss = document.createElement("style");
  tlcss.textContent = [
    "#rqSessions .rq-dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:6px; flex:none; }",
    "#rqTlFilters { display:flex; flex-wrap:wrap; gap:5px; margin:6px 0; }",
    "#rqTlFilters button { font-size:0.68em; padding:2px 9px; border-radius:999px; border:1px solid #555; background:none; color:inherit; cursor:pointer; opacity:0.7; }",
    "#rqTlFilters button.on { border-color:#d97706; color:#d97706; opacity:1; }",
    ".rq-replay { font-size:0.72em; margin-top:6px; padding:3px 10px; border-radius:999px; border:1px solid #d97706; background:rgba(217,119,6,0.12); color:inherit; cursor:pointer; }",
    "#rqSeatStats .rq-bar { display:flex; height:14px; border-radius:7px; overflow:hidden; margin:3px 0 10px; background:#333; }",
    "#rqSeatStats .rq-seg { height:100%; }",
    "#rqSeatStats .rq-lbl { font-size:0.75em; opacity:0.85; }",
    "#rqFlow { position:fixed; inset:0; z-index:150; display:flex; align-items:center; justify-content:center; pointer-events:none; background:rgba(0,0,0,0.45); }",
    "#rqFlow .fl-orb { width:22px; height:22px; border-radius:50%; animation:orbPulse 0.6s ease-in-out 2; }",
    "#rqFlow .fl-stage { position:relative; width:260px; height:170px; }",
    "#rqFlow .fl-line { position:absolute; width:2px; background:#d97706; transform-origin:top; animation:branchOut 0.7s ease-out forwards; animation-delay:0.7s; transform:scaleY(0); }",
    "#rqFlow .fl-core { position:absolute; left:50%; bottom:8px; transform:translateX(-50%); width:16px; height:16px; border-radius:50%; opacity:0; animation:beamSolid 0.5s ease-in forwards; animation-delay:1.3s; }",
    "@keyframes orbPulse { 0%{transform:scale(1);opacity:0.6;} 50%{transform:scale(1.2);opacity:1;} 100%{transform:scale(1);opacity:0.6;} }",
    "@keyframes branchOut { 0%{transform:scaleY(0);} 100%{transform:scaleY(1);} }",
    "@keyframes beamSolid { 0%{opacity:0.3;} 100%{opacity:1;} }",
  ].join("\n");
  document.head.appendChild(tlcss);

  // Consensus Flow (hero animation, ~2s, spec 4.3): orbs pulse, lines
  // draw, converge to one core (consensus) or stay branched (divided).
  function playConsensusFlow(divided, trust) {
    const wrap = document.createElement("div");
    wrap.id = "rqFlow";
    const stage = document.createElement("div");
    stage.className = "fl-stage";
    const color = divided ? TRUST_COLORS.divided : (TRUST_COLORS[trust] || "#d97706");
    [30, 119, 208].forEach((x) => {
      const orb = document.createElement("div");
      orb.className = "fl-orb";
      orb.style.cssText = `position:absolute;top:0;left:${x}px;background:${color};`;
      stage.appendChild(orb);
      const line = document.createElement("div");
      line.className = "fl-line";
      line.style.left = (x + 10) + "px";
      line.style.top = "26px";
      line.style.height = divided ? "120px" : "110px";
      if (!divided) line.style.transform += ` rotate(${(119 - x) / 4}deg)`;
      stage.appendChild(line);
    });
    if (!divided) {
      const core = document.createElement("div");
      core.className = "fl-core";
      core.style.background = color;
      stage.appendChild(core);
    }
    wrap.appendChild(stage);
    document.body.appendChild(wrap);
    setTimeout(() => { wrap.style.transition = "opacity 0.3s"; wrap.style.opacity = "0"; setTimeout(() => wrap.remove(), 350); }, 2000);
  }

  // Settings toggle for the animation (spec 4.3, default ON)
  (function ensureFlowToggle() {
    if (!demoToggle || !demoToggle.parentNode) return;
    const lbl = document.createElement("label");
    lbl.style.cssText = "display:block;margin-top:8px;font-size:0.78em;opacity:0.85;cursor:pointer;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = settings.flowAnim !== false;
    cb.addEventListener("change", () => { settings.flowAnim = cb.checked; saveSettings(settings); });
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(" Show consensus animation"));
    demoToggle.parentNode.parentNode.appendChild(lbl);
  })();

  // Timeline (spec 4.1) + Seat Stats (spec 4.2), ledger-fed.
  (function ensureTimeline() {
    if (!historyList || !historyList.parentNode) return;
    const wrap = document.createElement("div");
    wrap.id = "rqSessions";
    const title = document.createElement("h3");
    title.textContent = "TIMELINE";
    title.style.cssText = "font-size:0.78em;letter-spacing:0.05em;opacity:0.7;margin:14px 0 4px;";
    const statsBtn = document.createElement("button");
    statsBtn.textContent = "Seat Stats";
    statsBtn.style.cssText = "font-size:0.72em;margin-left:8px;background:none;border:1px solid #666;border-radius:999px;color:inherit;padding:1px 8px;cursor:pointer;";
    const clearAll = document.createElement("button");
    clearAll.textContent = "Clear all";
    clearAll.style.cssText = statsBtn.style.cssText;
    clearAll.addEventListener("click", () => {
      if (!confirm("Clear the whole timeline? (This also erases the council's memory.)")) return;
      ledger = []; persistLedger(); renderSessions();
      if (memoryPill && memoryPill.refresh) memoryPill.refresh();
    });
    title.appendChild(statsBtn);
    title.appendChild(clearAll);
    wrap.appendChild(title);
    const filters = document.createElement("div");
    filters.id = "rqTlFilters";
    let activeFilter = "all";
    ["all", "verified", "provisional", "sole", "divided"].forEach((f) => {
      const b = document.createElement("button");
      b.textContent = f.toUpperCase();
      if (f === "all") b.classList.add("on");
      b.addEventListener("click", () => {
        activeFilter = f;
        filters.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        renderSessions();
      });
      filters.appendChild(b);
    });
    wrap.appendChild(filters);
    const stats = document.createElement("div");
    stats.id = "rqSeatStats";
    stats.style.display = "none";
    wrap.appendChild(stats);
    const list = document.createElement("div");
    wrap.appendChild(list);
    historyList.parentNode.insertBefore(wrap, historyList);

    function renderStats() {
      // Reduce over ledger: per seat — verified/provisional contributions,
      // sole voice, divided, malformed/failed. Absent from a round's
      // roster = failed that round. Pre-v3.0.2 entries lack rosters; skipped.
      const seatsAll = ["gemini", "kimi", "claude"];
      const agg = {};
      seatsAll.forEach((s) => (agg[s] = { ok: 0, sole: 0, div: 0, fail: 0 }));
      let counted = 0;
      ledger.forEach((e) => {
        if (!e.seats) return;
        counted++;
        const present = new Set(e.seats.filter((x) => !x.m).map((x) => x.n));
        seatsAll.forEach((s) => {
          if (!present.has(s)) { agg[s].fail++; return; }
          if (e.outcome === "divided") agg[s].div++;
          else if (e.outcome === "sole") agg[s].sole++;
          else agg[s].ok++;
        });
      });
      stats.innerHTML = "";
      if (!counted) { stats.innerHTML = "<p class=\'rq-lbl\'>No rounds with seat data yet (recorded from v3.0.2 onward).</p>"; return; }
      seatsAll.forEach((s) => {
        const a = agg[s], total = a.ok + a.sole + a.div + a.fail || 1;
        const lbl = document.createElement("div");
        lbl.className = "rq-lbl";
        lbl.textContent = s[0].toUpperCase() + s.slice(1) + ` — consensus ${a.ok}, sole ${a.sole}, divided ${a.div}, failed ${a.fail}`;
        const bar = document.createElement("div");
        bar.className = "rq-bar";
        [[a.ok, TRUST_COLORS.verified], [a.sole, TRUST_COLORS.sole], [a.div, TRUST_COLORS.divided], [a.fail, "#666"]].forEach(([n, c]) => {
          if (!n) return;
          const seg = document.createElement("div");
          seg.className = "rq-seg";
          seg.style.cssText = `width:${(100 * n / total).toFixed(1)}%;background:${c};`;
          seg.title = `${n}/${total}`;
          bar.appendChild(seg);
        });
        stats.appendChild(lbl);
        stats.appendChild(bar);
      });
    }
    statsBtn.addEventListener("click", () => {
      const show = stats.style.display === "none";
      stats.style.display = show ? "" : "none";
      list.style.display = show ? "none" : "";
      statsBtn.textContent = show ? "Timeline" : "Seat Stats";
      if (show) renderStats();
    });

    function renderSessions() {
      list.innerHTML = "";
      const rows = ledger.map((e, i) => ({ e, i })).filter((r) => activeFilter === "all" || r.e.outcome === activeFilter);
      if (!rows.length) {
        const empty = document.createElement("p");
        empty.style.cssText = "font-size:0.78em;opacity:0.5;";
        empty.textContent = activeFilter === "all" ? "No rounds yet. The council's past appears here and survives reloads." : "No " + activeFilter.toUpperCase() + " rounds yet.";
        list.appendChild(empty);
        return;
      }
      rows.reverse().forEach(({ e, i }) => {
        const card = document.createElement("div");
        card.className = "rq-sess";
        const head = document.createElement("div");
        head.className = "rq-sess-head";
        const t = document.createElement("span");
        t.style.cssText = "display:flex;align-items:center;min-width:0;";
        const dot = document.createElement("span");
        dot.className = "rq-dot";
        dot.style.background = TRUST_COLORS[e.outcome] || "#888";
        const txt = document.createElement("span");
        txt.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        txt.textContent = `#${i + 1} · ` + clip(e.prompt || "", 40);
        t.appendChild(dot); t.appendChild(txt);
        const badge = document.createElement("span");
        badge.className = "rq-badge" + (e.outcome === "verified" ? " verified" : "");
        badge.textContent = e.outcome === "divided" ? "DIVIDED" : (e.outcome || "").toUpperCase() + (e.counts ? " " + e.counts : "");
        head.appendChild(t); head.appendChild(badge);
        const body = document.createElement("div");
        body.className = "rq-sess-body";
        const del = document.createElement("button");
        del.className = "rq-sess-del";
        del.textContent = "delete";
        del.addEventListener("click", (ev) => {
          ev.stopPropagation();
          ledger.splice(i, 1); persistLedger(); renderSessions();
          if (memoryPill && memoryPill.refresh) memoryPill.refresh();
        });
        body.appendChild(del);
        const bodyText = document.createElement("div");
        bodyText.textContent = "Q: " + e.prompt + "\n\n" + (e.outcome === "divided"
          ? (e.positions || []).map((p) => p.seat + ":\n" + p.text).join("\n\n")
          : "Verdict: " + (e.verdict || "—"));
        body.appendChild(bodyText);
        const replay = document.createElement("button");
        replay.className = "rq-replay";
        replay.textContent = "↻ Replay this dispatch";
        replay.addEventListener("click", (ev) => {
          ev.stopPropagation();
          queryInput.value = e.prompt;
          if (drawerClose) drawerClose.click();
          summonBtn.click();
        });
        body.appendChild(replay);
        head.addEventListener("click", () => card.classList.toggle("open"));
        card.appendChild(head);
        card.appendChild(body);
        list.appendChild(card);
      });
    }
    renderSessions();
    window.__rqRenderSessions = renderSessions;
  })();

  // ==================== v3.0.1: Progressive Onboarding + Voice Input (Charter §11.7-8) ====================
  const KEY_HINTS = [
    { id: "keyGroq", label: "Groq (FREE — unlocks the Claude seat)", url: "https://console.groq.com/keys", prefix: "gsk_" },
    { id: "keyOpenRouter", label: "OpenRouter (FREE — unlocks shadow fallbacks)", url: "https://openrouter.ai/keys", prefix: "sk-or-" },
    { id: "keyCerebras", label: "Cerebras (FREE — unlocks GLM understudy)", url: "https://cloud.cerebras.ai", prefix: "csk-" },
    { id: "keyGemini", label: "Gemini (primary seat)", url: "https://aistudio.google.com/apikey", prefix: "AIza" },
    { id: "keyKimi", label: "Kimi / Moonshot (primary seat)", url: "https://platform.moonshot.ai", prefix: "sk-" },
    { id: "keyClaude", label: "Claude / Anthropic (primary seat)", url: "https://console.anthropic.com", prefix: "sk-ant-" },
  ];
  function keyLooksValid(v, prefix) { return !!v && v.length > 20 && (!prefix || v.startsWith(prefix)); }

  function openOnboarding(step) {
    step = step || 1;
    const stepDefs = [
      { title: "Step 1 of 3 — Play immediately", body: "<p>Zero keys needed. Demo Mode simulates the full council so you can feel how deliberation works.</p>", keys: [], cta: "Try Demo Mode", ctaFn: () => { settings.demoMode = true; demoToggle.checked = true; saveSettings(settings); refreshDemoBadge(); summonBtn.click(); } },
      { title: "Step 2 of 3 — One free key, one live seat", body: "<p>Groq is free and takes ~60 seconds. One key = one real AI advisor answering live.</p>", keys: [KEY_HINTS[0]], cta: "Save & continue", ctaFn: null },
      { title: "Step 3 of 3 — Unlock the full council", body: "<p>Add the free fallback tier (OpenRouter, Cerebras) and any primary seats you have. Every key you skip just means an understudy fills that chair — she works either way.</p>", keys: KEY_HINTS.slice(1), cta: "Save & finish", ctaFn: null },
    ];
    const d = stepDefs[step - 1];
    let html = "<h3>" + d.title + "</h3>" + d.body;
    rqModal(html);
    const box = document.querySelector(".rq-modal");
    d.keys.forEach((k) => {
      const label = document.createElement("label");
      label.style.cssText = "display:block;margin-top:10px;font-size:0.78em;opacity:0.85;";
      label.textContent = k.label + " ";
      const a = document.createElement("a");
      a.href = k.url; a.target = "_blank"; a.textContent = "(get key ↗)";
      a.style.color = "#d97706";
      label.appendChild(a);
      const input = document.createElement("input");
      input.type = "password"; input.autocomplete = "off";
      input.placeholder = k.prefix ? k.prefix + "…" : "paste key";
      input.style.cssText = "display:block;width:100%;margin-top:4px;padding:7px;border-radius:6px;border:1px solid #555;background:rgba(255,255,255,0.05);color:inherit;";
      input.value = settings[k.id] || "";
      const mark = document.createElement("span");
      mark.style.cssText = "font-size:0.78em;";
      const check = () => {
        if (!input.value.trim()) { mark.textContent = ""; return; }
        const ok = keyLooksValid(input.value.trim(), k.prefix);
        mark.textContent = ok ? " ✅ looks valid" : " ❌ unexpected format (expected " + (k.prefix || "a longer key") + "…)";
        mark.style.color = ok ? "#16a34a" : "#dc2626";
      };
      input.addEventListener("input", check); check();
      input.dataset.keyId = k.id;
      box.appendChild(label); box.appendChild(input); box.appendChild(mark);
    });
    const nav = document.createElement("div");
    nav.style.cssText = "margin-top:14px;display:flex;gap:8px;justify-content:flex-end;";
    const cta = document.createElement("button");
    cta.className = "rq-cta";
    cta.textContent = d.cta;
    cta.addEventListener("click", () => {
      box.querySelectorAll("input[data-key-id]").forEach((inp) => {
        const v = inp.value.trim();
        if (v) { settings[inp.dataset.keyId] = v; const el = $(inp.dataset.keyId); if (el) el.value = v; }
      });
      saveSettings(settings);
      document.querySelector(".rq-modal-scrim").remove();
      if (d.ctaFn) d.ctaFn();
      else if (step < 3) openOnboarding(step + 1);
      else logError("Onboarding complete — keys saved. Summon the council when ready.");
    });
    if (step < 3 && !d.ctaFn) {} // cta handles advance
    if (step > 0 && step < 3) {
      const skip = document.createElement("button");
      skip.className = "rq-cta secondary";
      skip.textContent = step === 1 ? "I have keys →" : "Skip →";
      skip.addEventListener("click", () => { document.querySelector(".rq-modal-scrim").remove(); openOnboarding(step + 1); });
      nav.appendChild(skip);
    }
    nav.appendChild(cta);
    box.appendChild(nav);
  }
  // Entry points: settings drawer button + landing "Unlock" now routes here.
  (function ensureOnboardingEntry() {
    if (saveSettingsBtn && saveSettingsBtn.parentNode) {
      const b = document.createElement("button");
      b.textContent = "🧭 Setup Guide (step-by-step)";
      b.style.cssText = "display:block;margin:10px 0 0;font-size:0.8em;padding:7px 12px;border-radius:999px;border:1px solid #d97706;background:rgba(217,119,6,0.12);color:inherit;cursor:pointer;";
      b.addEventListener("click", () => openOnboarding(1));
      saveSettingsBtn.parentNode.insertBefore(b, saveSettingsBtn);
    }
    const intro = window.__rqIntro;
    if (intro) {
      const unlock = intro.querySelector(".rq-cta.secondary");
      if (unlock) {
        const clone = unlock.cloneNode(true);
        unlock.parentNode.replaceChild(clone, unlock);
        clone.addEventListener("click", () => openOnboarding(1));
      }
    }
  })();

  // Voice Input — Web Speech API, native, zero cost. 🎤 fills the box.
  (function ensureVoiceInput() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !queryInput || !queryInput.parentNode) return; // unsupported browser: no button, no clutter
    const mic = document.createElement("button");
    mic.id = "rqMic";
    mic.textContent = "🎤";
    mic.title = "Speak your question";
    mic.style.cssText = "margin:6px 0 0;font-size:1.05em;padding:6px 12px;border-radius:999px;border:1px solid #666;background:rgba(255,255,255,0.05);color:inherit;cursor:pointer;";
    let rec = null, listening = false;
    mic.addEventListener("click", () => {
      if (listening && rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = navigator.language || "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onstart = () => { listening = true; mic.textContent = "🔴"; mic.title = "Listening… tap to stop"; };
      rec.onend = () => { listening = false; mic.textContent = "🎤"; mic.title = "Speak your question"; };
      rec.onerror = (e) => { listening = false; mic.textContent = "🎤"; if (e.error !== "aborted") logError("Voice input error: " + e.error + (e.error === "not-allowed" ? " — allow microphone access in your browser." : "")); };
      rec.onresult = (e) => {
        const t = e.results[0] && e.results[0][0] ? e.results[0][0].transcript : "";
        if (t) { queryInput.value = (queryInput.value ? queryInput.value + " " : "") + t; queryInput.focus(); }
      };
      try { rec.start(); } catch (err) { logError("Voice input failed to start: " + (err.message || err)); }
    });
    queryInput.parentNode.insertBefore(mic, queryInput.nextSibling);
  })();

  // ---------- Dispatch ----------
  let busy = false;

  async function dispatch(query) {
    if (busy) return;
    busy = true;

    resetSeatVisuals();
    clearDividedPanel();
    consensusBar.classList.remove("is-empty");
    consensusBar.classList.add("loading");
    consensusText.textContent = "The Council is deliberating…";
    consensusText.style.fontStyle = "italic";
    consensusText.style.color = "#888";

    let answer = null;
    let divided = false;
    let allAnswers = [];
    let trustPrefix = "";

    if (!inDemoMode()) {
      let result = null;
      const dispatchId = RQ_SESSION_ID + "_d" + (++dispatchCounter);
      // v2.9: memory injection — the council receives the shared ledger
      // context ahead of the current question. The RAW query (not the
      // composed one) is what gets displayed, logged, and remembered.
      const memoryContext = buildMemoryContext();
      const composedQuery = memoryContext ? memoryContext + query : query;
      try {
        result = await runLiveCouncil(composedQuery);
      } catch (e) {
        logError("Council dispatch failed: " + (e.message || e));
      }
      if (result === null) {
        logError("All live agents failed — falling back to demo simulation.");
        demoBadge.classList.remove("hidden");
        answer = await runDemoCouncil(query);
      } else {
        divided = result.divided;
        answer = result.text;
        allAnswers = result.answers || [];
        // v2.9: record the round in the ledger (raw prompt, trust-tagged
        // outcome) and fire institutional memory writes (never awaited).
        // v3.1.0: Temporal Consistency Validator — check the new verdict
        // against past VERIFIED conclusions before it enters memory.
        if (!divided && result.text) checkTemporalConsistency(result.text);
        recordLedger({
          t: Date.now(),
          prompt: query,
          outcome: divided ? "divided" : (result.trust || "unknown"),
          counts: result.agreedCount != null ? `${result.agreedCount}/${result.eligibleCount}` : "",
          verdict: divided ? null : clip(result.text, 600),
          positions: divided ? allAnswers.map((a) => ({ seat: seatLabel(a.name), text: clip(a.text, 300) })) : null,
          // v3.0.2: per-seat roster for Seat Stats — who answered, who was
          // malformed; absent seats failed that round.
          seats: allAnswers.map((a) => ({ n: a.name, m: !!a.malformed })),
        });
        if (typeof playConsensusFlow === "function" && settings.flowAnim !== false) playConsensusFlow(divided, result.trust);
        if (memoryPill && memoryPill.refresh) memoryPill.refresh();
        if (window.__rqRenderSessions) window.__rqRenderSessions();
        if (window.__rqIntro) { window.__rqIntro.remove(); window.__rqIntro = null; }
        logInstitutionalMemory(dispatchId, query, result);
        // Trust-state prefix (v2.4): the bar itself carries the verification
        // level — a sole understudy's opinion must never wear the Council's
        // crown unmarked. "Always check the error logs" — founder, 2026-07-12.
        // Persona preambles (Gemini request 2026-07-13, Fable amendment):
        // the Red Queen speaks as a casual referee, not an error handler.
        // AMENDMENT: Gemini's "everyone's on the same page" line is only
        // TRUE for verified consensus — sole/provisional states get honest
        // variants so persona warmth never contradicts the trust doctrine.
        // Trust prefix stays FIRST: the bar carries the verification level
        // up front ("always check the error logs" — founder, 2026-07-12).
        if (result.trust === "sole") {
          trustPrefix = "⚠ SOLE VOICE (unverified) — Only one voice answered, so this is a single model's opinion, not a council verdict: ";
        } else if (result.trust === "provisional") {
          trustPrefix = `◐ PROVISIONAL ${result.agreedCount}/${result.eligibleCount} — The bench agrees, but no primary voice has verified this yet: `;
        } else if (result.trust === "verified") {
          trustPrefix = `✓ VERIFIED ${result.agreedCount}/${result.eligibleCount} — Everyone's on the same page for this one. Here is the council's unified answer: `;
        } else if (result.trust === "resolved") {
          // v3.2: the council disagreed, then cross-examined, and every other
          // seat located a specific error in its own position and conceded to
          // this one. Won by adjudication, not by vote — a stronger object than
          // an uncontested VERIFIED, because it survived an attempt to break it.
          trustPrefix = `\u25C8 RESOLVED — The council first split, then challenged each other; this position survived cross-examination after ${result.resolvedBy} and the others located specific errors in their own and conceded: `;
        }
      }
    } else {
      // demo showcase: queries mentioning "divided"/"controversial" demo the no-consensus state
      if (/divided|controversial|disagree/.test(query.toLowerCase())) {
        await runDemoCouncil(query);
        divided = true;
        allAnswers = [
          { name: "gemini", text: "Position A — prioritize scale and reach first." },
          { name: "kimi", text: "Position B — architecture integrity outweighs speed." },
          { name: "claude", text: "Position C — neither is decidable without success criteria." },
        ];
      } else {
        answer = await runDemoCouncil(query);
      }
    }

    setThinking(false);
    consensusBar.classList.remove("loading");
    consensusText.style.fontStyle = "normal";
    consensusText.style.color = "";
    consensusBar.classList.remove("divided");

    if (divided) {
      // No white flash — the Council did not converge. Amber state instead.
      consensusBar.classList.add("divided");
      // Persona line (Gemini request 2026-07-13) — referee voice on a split.
      consensusText.textContent = "We have a split decision. They all took this in slightly different directions, so I'm stepping back to let you read their raw responses.";
      renderDividedPanel(allAnswers);
      allAnswers.forEach((a) =>
        logHistory(`${seatLabel(a.name)} position (${query})`, a.text)
      );
      logHistory(query, "NO CONSENSUS — Council divided by design. Individual positions above.");
    } else {
      flashConsensus();
      consensusText.textContent = "";
      consensusText.classList.remove("rq-md", "rq-md-plain");
      if (trustPrefix) {
        const tp = document.createElement("span");
        tp.className = "rq-trust";
        tp.textContent = trustPrefix.trim();
        consensusText.appendChild(tp);
      }
      const _body = document.createElement("div");
      consensusText.appendChild(_body);
      renderRich(_body, answer);
      logHistory(query, answer);
    }
    busy = false;
  }

  sendBtn.addEventListener("click", () => {
    const q = queryInput.value.trim();
    if (!q) return;
    queryInput.value = "";
    closeSheet();
    dispatch(q);
  });

  queryInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // ---------- New Session ----------
  newSessionBtn.addEventListener("click", () => {
    consensusText.textContent = "Awaiting Council Input...";
    clearDividedPanel();
    // v2.9: New Session is a true fresh start — the council forgets the
    // conversation. (Ledger otherwise survives reloads; only the user
    // erases memory, via New Session or the FORGET pill.)
    ledger = [];
    persistLedger();
    if (memoryPill && memoryPill.refresh) memoryPill.refresh();
    consensusBar.classList.add("is-empty");
    consensusBar.classList.remove("loading");
    historyList.innerHTML = '<li class="empty-note">No queries yet this session.</li>';
    errorList.innerHTML = '<li class="empty-note">No errors logged.</li>';
    Object.values(agents).forEach((a) => a.classList.remove("thinking", "consensus"));
    closeDrawer();
  });

  // Surface the build stamp in the in-app drawer log too, so deploy
  // verification never requires opening devtools — it lands at the top of the
  // log on load. (added 2026-07-19)
  try {
    logError("BUILD " + RQ_BUILD + " loaded. If this line is absent after a deploy, you are on a cached build — hard-clear and reload.");
  } catch (_) {}
})();
