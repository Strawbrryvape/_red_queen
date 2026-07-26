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
  const RQ_BUILD = "v3.5.4-indexical-audit";
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
  // v3.5.3 (2026-07-26): 4000 -> 8000. THIRD observed truncation, and the first
  // with a measured cost — on 2026-07-26 GLM burned its whole budget inside
  // <think> at 9:18:38 and again at 9:31:04, and because the Gemini seat's
  // OpenRouter floor was dead (both entries 404) the seat VANISHED mid-round and
  // was logged as HOLD in adjudication. That is the 2026-07-17 disappearance
  // replayed. GLM 4.7 is a reasoning model; 4000 was never headroom for one.
  // Edit 12 fixes the floor so a truncation stops being fatal either way.
  const CEREBRAS_MAX_TOKENS = 8000;

  // ---------- Kimi primary seat (Moonshot) ----------
  // moonshot-v1-8k is retired: unavailable to new accounts since 2026-07-17 and
  // scheduled for full platform sunset 2026-08-31. kimi-k3 is the flagship
  // replacement on the same OpenAI-compatible endpoint, so the swap is a model
  // string and a token ceiling — no new provider, no CSP change.
  const KIMI_MODEL = "kimi-k3";

  // K3 ALWAYS reasons; thinking mode cannot be switched off, and the reasoning
  // trace is billed and counted as output. The shared MAX_TOKENS of 1000 would
  // therefore be spent thinking, and the seat would return an empty answer —
  // exactly how Cerebras GLM 4.7 failed on 2026-07-24 ("spent its entire token
  // budget reasoning and never produced a final answer, truncated mid-<think>"),
  // and that had four times the headroom this seat currently gets.
  //
  // 8000 is a deliberate over-allocation, not a measurement. Council answers are
  // short; the budget exists for the reasoning trace in front of them. If the
  // seat starts truncating, raise this first — the diagnostic in callKimi names
  // it explicitly. If cost matters more than depth, lower it and watch for
  // finish_reason: length.
  const KIMI_MAX_TOKENS = 8000;

  // ---------- K3 spend gate ----------
  // K3 is metered and billed per token including its reasoning trace, and those
  // credits are also needed for other projects. This toggle decides who answers
  // for the Kimi seat WITHOUT touching the key, so nothing has to be deleted and
  // re-pasted to switch modes.
  //
  // DEFAULT OFF, deliberately. localStorage is per-device and starts empty, so
  // an ON default would mean every new device — and every device after a hard
  // cache clear — silently begins spending. Off is the safe failure.
  //
  //   ON  : Kimi seat = kimi-k3 via Moonshot, base weight 1.0 (primary voice,
  //         which is what makes a VERIFIED outcome reachable at all)
  //   OFF : Kimi seat = OpenRouter free-tier walk, base weight 0.5, exactly as
  //         it has been running. No Moonshot request is made, so no spend.
  function kimiK3Enabled() { return localStorage.getItem("rq_kimi_k3") === "on"; }

  // The seat is occupied whenever a Moonshot key is present; this decides only
  // who answers for it.
  function kimiOnOpenRouter() {
    return !!settings.keyKimi && !kimiK3Enabled() && !!settings.keyOpenRouter;
  }
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
    // With K3 off, OpenRouter is the seat's CONFIGURED occupant, not a failover
    // it degraded into. Without this the base weight would read 1.0 while a
    // free-tier model answered, and every shadow-weight line and A/B
    // weight_base would overstate the seat.
    if (name === "kimi" && kimiOnOpenRouter()) return "openrouter";
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
        model: KIMI_MODEL,
        messages: [{ role: "user", content: query }],
        // max_completion_tokens, not max_tokens: this is the parameter the
        // OpenAI-compatible reasoning path expects, and it is what Moonshot's
        // own K3 examples send. max_tokens is the legacy name and its handling
        // on reasoning models is not something to gamble a seat on.
        max_completion_tokens: KIMI_MAX_TOKENS,
        // reasoning_effort is supported ("max" appears in Moonshot's docs) and
        // would be the knob for trading depth against cost. Left unset on
        // purpose — the valid enum isn't confirmed, and an invalid value is a
        // 400 that drops the seat. Worth testing deliberately, not guessing.
      }),
    }, "Kimi");
    if (!res.ok) throw new Error(`Kimi HTTP ${res.status}${res.status === 429 ? " — rate limit OR insufficient Moonshot balance" : ""}`);
    const data = await res.json();
    const choice = data.choices?.[0];
    const text = choice?.message?.content || "";

    // An empty answer from a reasoning model is almost never "the model had
    // nothing to say" — it is the budget being consumed before the answer
    // started. Say so, rather than letting the seat fall back for an unnamed
    // reason and reappear as a fallback label in the ledger.
    if (!text) {
      const fin = choice?.finish_reason || "unknown";
      const hadReasoning = !!(choice?.message?.reasoning_content);
      if (fin === "length" || hadReasoning) {
        throw new Error(`Kimi ${KIMI_MODEL} returned no answer — finish_reason: ${fin}${hadReasoning ? ", reasoning present but truncated before the answer" : ""}. Raise KIMI_MAX_TOKENS (currently ${KIMI_MAX_TOKENS}).`);
      }
      throw new Error(`Kimi ${KIMI_MODEL} returned an empty response (finish_reason: ${fin}).`);
    }
    return text;
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

  // ==================== v3.4.7: VECTOR MEMORY — embedding layer (Stage 1) ====================
  // Kimi Ruling 2 (2026-07-22): the "one worker, two entry points" non-negotiable
  // is satisfied here as ONE SHARED LIFECYCLE FACTORY, TWO INSTANCES — not one
  // worker instance. A single instance would break Requirement #4 (no re-download
  // per round): runPython() TERMINATES its worker on exec timeout to kill runaway
  // loops, which would evict the 20-30MB embedding model and force re-download.
  // The factory below is the single lifecycle abstraction; the Pyodide path above
  // should be refactored onto it in a later pass. DO NOT recombine into one worker.
  const _EMBED_XFORMERS_URL = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2";
  const _EMBED_MODEL = "Xenova/all-MiniLM-L6-v2";
  const _EMBED_DIM = 384;                  // schema commitment — pgvector column is vector(384)
  const _EMBED_LOAD_TIMEOUT_MS = 90000;    // cold model download, once (bigger payload than Pyodide)
  const _EMBED_EXEC_TIMEOUT_MS = 15000;    // per-embed budget

  // Stage gate. Every other staged feature in this file is flagged
  // (rq_concept_mode / rq_sandbox_feedback / rq_json_envelope / rq_chim);
  // Stage 1 shipped without one, which made Kimi's own flag-OFF verification
  // ("behaviour byte-identical to v3.4.6") impossible to actually perform, and
  // started a 20-30MB model download unannounced on the first round.
  // Gates STORAGE only — the self-test button stays live either way, so a
  // CSP or model problem can still be diagnosed with the flag off.
  //   enable:  localStorage.setItem("rq_vector_memory","on")
  function vectorMemoryEnabled() { return localStorage.getItem("rq_vector_memory") === "on"; }

  // ---------- Stage 2 retrieval parameters (Kimi, amended rulings §3) ----------
  // Floor was ruled up from 0.3 to 0.6 once the real distribution was measured:
  // the first retrieval test returned 1.000 self then 0.674 / 0.657 / 0.647 /
  // 0.609, so 0.3 excluded nothing and was theatre. Top-K is "up to 5 ABOVE the
  // floor", never "exactly 5 regardless of relevance".
  //
  // Note for whoever tunes this next: on the 25-row corpus every non-self
  // neighbour measured so far sits above 0.6, so the floor returns ~4 rows, not
  // the 1-2 the ruling anticipated. Revisit past 100 rows.
  const RQ_TOP_K       = 5;
  const RQ_SIM_FLOOR   = 0.6;

  // ---------- Stage 3: injection ----------
  // Kimi's gate on Stage 3 was 20 clean A/B samples plus re-ratification. The
  // operator OVERRODE it 2026-07-26 to avoid a standstill. The gate was
  // protecting the COMPARISON, not the calendar, so injection ships behind its
  // own flag and `injected` records the real value per round: the control arm
  // survives, the standstill does not.
  //
  // DEFAULT OFF, same reasoning as every other flag here — localStorage is
  // per-device and starts empty, so an ON default would mean every new device,
  // and every device after a hard cache clear, silently changes what the seats
  // are reading. Off is the safe failure.
  function injectionEnabled() { return localStorage.getItem("rq_inject") === "on"; }

  // Ratified context budget: 40% vector / 40% CHIM / 20% verbatim recency.
  // Only the vector share is named here; the remaining 60% goes to
  // buildMemoryContext, which already splits CHIM against recency internally at
  // CHIM_DIGEST_BUDGET_FRAC. Applied ONLY when injection is on — with it off the
  // memory budget is untouched and behaviour is identical to v3.5.2a.
  const RQ_INJECT_VECTOR_FRAC = 0.40;

  // ---------- Floor diagnostic ----------
  // The shadow used to ask match_rounds to pre-filter at RQ_SIM_FLOOR, which made
  // "0 vector hits" indistinguishable from four rows sitting at 0.59. On
  // 2026-07-26 two consecutive council-topical rounds logged 0 hits at corpus
  // 50/51 and there was no way to tell which case they were — and that is the
  // one number Stage 3 depends on, because injecting zero rows is a no-op that
  // deploys cleanly and changes nothing. Ask for the top rows at floor 0, filter
  // locally, record the whole distribution.
  const RQ_DIAG_FLOOR  = 0;

  // ---------- prompt_class (Kimi Ruling 1) ----------
  // HARD CONSTRAINT from the ruling: this output is written to a database
  // column and NEVER rendered into any system prompt, seat context, or digest.
  // If this value is ever concatenated into a string a model will read, that is
  // the BSL state_update failure returning under a new name.
  //
  // Honest about what it is: a keyword heuristic. No model call, deterministic,
  // free. It will misfile things — "what is the smallest prime" and "what is
  // the Red Queen" are the same shape lexically and different classes
  // semantically. Good enough to spot a gross pattern across hundreds of future
  // rounds; NOT good enough to found a conclusion on. Hand-label the existing
  // 25 for the cross-tab.
  // ---------- Operator notes ----------
  // An operator note is not a question. On 2026-07-26 a thank-you round with no
  // question and no stakes was put through the full anonymised cross-examination:
  // seats were made to hunt errors in each other's acknowledgements, one conceded
  // that its acknowledgement was not a defensible position, and the round was
  // stamped DIVIDED. That is the machinery working correctly on input it should
  // never have been handed — and those tags are the denominator of every
  // DIVIDED-rate figure this project reports.
  //
  // EXPLICIT, not heuristic. classifyPrompt is a keyword guess; misreading a real
  // question as a note would silently skip consensus on it, which is a far worse
  // failure than typing five characters. Start the message with NOTE: or #note.
  const OPERATOR_NOTE_RE = /^\s*(?:#note\b|note\s*:)/i;
  function isOperatorNote(q) { return OPERATOR_NOTE_RE.test(String(q || "")); }

  // ---------- Indexical prompts (v3.5.4) ----------
  // A roll call asks each seat about ITSELF. Three seats then give three
  // DIFFERENT answers that are all CORRECT, and the lexical comparator scores
  // them as agreeing because they share vocabulary ("I am currently operating
  // as... seat... weight..."). Round 88: a roll call came back PROVISIONAL 3/3
  // with one seat's block on screen, because consensus was declared on a
  // question that structurally cannot have one, and the other two answers were
  // discarded from the render. Same class as the round-82 finding: divergence is
  // the correct output and the machine has no representation for it.
  //
  // Heuristic, and safe to be one. A false positive shows all three answers
  // instead of one; a false negative is the status quo. Neither can silently
  // fabricate agreement, which is the asymmetry that makes a heuristic fine here
  // and not fine for operator notes.
  const INDEXICAL_RE = new RegExp([
    "each seat", "every seat", "each of you", "all three of you",
    "answer independently", "independently", "speak for another", "speak for the",
    "roll call", "rollcall", "in (?:the )?first person", "your own (?:seat|weight|tier|model|endpoint)",
    "who are you", "identify yourself", "state your (?:seat|name|model|status)",
  ].join("|"), "i");
  function isIndexicalPrompt(q) { return INDEXICAL_RE.test(String(q || "")); }

  function classifyPrompt(prompt) {
    try {
      if (typeof prompt !== "string" || !prompt.trim()) return "open_ended";
      if (isOperatorNote(prompt)) return "operator_note";
      const p = prompt.toLowerCase();

      // meta_system first, deliberately. "What is the Red Queen?" is lexically a
      // factual question and is not one in practice, and this is the class most
      // worth measuring before retrieval goes live — whatever dominates the
      // corpus dominates what retrieval surfaces.
      const metaTerms = [
        "red queen", "the council", "your seat", "the seats", "this system",
        "the ledger", "consensus threshold", "your architecture", "yourself",
        "your memory", "sentience", "sentient", "conscious", "do you feel",
        "how are you", "what do you want", "your own",
      ];
      if (metaTerms.some((t) => p.indexOf(t) !== -1)) return "meta_system";

      const decisionTerms = [
        "should we", "should i", "which should", "pick ", "choose ", "rank ",
        "prioriti", "vote", "name the next", "what should we build",
        "recommend", "best option", "decide",
      ];
      if (decisionTerms.some((t) => p.indexOf(t) !== -1)) return "decision";

      // Arithmetic and units are the strong signals. A bare "what is" is not —
      // it collides with meta_system (already returned above) and with
      // open-ended definition requests.
      const hasMath   = /[0-9]\s*[\^*+\-/]|\*\*|\bdigit sum\b|\bprime\b|\bfactorial\b|\bsqrt\b/.test(p);
      const hasUnits  = /\b(how many|how much|what year|what date|percent|kg|km|miles|bytes)\b/.test(p);
      const isCompute = /\b(calculate|compute|solve|convert)\b/.test(p);
      if (hasMath || hasUnits || isCompute) return "factual";

      // Default. Deliberately the fallback: misfiling an open-ended prompt as
      // factual would inflate the factual DIVIDED rate and could manufacture
      // the "comparator is broken" signal — the one result that would redirect
      // the whole roadmap. Better to under-claim factual.
      return "open_ended";
    } catch (_) {
      return "open_ended";
    }
  }

  function _makeManagedWorker(opts) {
    let worker = null, ready = null;
    function ensure() {
      if (worker && ready) return;
      worker = new Worker(
        URL.createObjectURL(new Blob([opts.src], { type: "application/javascript" })),
        opts.workerOptions || undefined
      );
      ready = new Promise((resolve, reject) => {
        const t = setTimeout(
          () => reject(new Error(opts.label + " did not load within " + (opts.loadTimeoutMs / 1000) + "s")),
          opts.loadTimeoutMs
        );
        const onReady = (e) => {
          if (!e.data) return;
          if (e.data.type === "ready") {
            clearTimeout(t); worker.removeEventListener("message", onReady); resolve();
          } else if (e.data.type === "loaderror") {
            clearTimeout(t); worker.removeEventListener("message", onReady);
            reject(new Error(e.data.error || (opts.label + " load error")));
          }
        };
        worker.addEventListener("message", onReady);
        worker.addEventListener("error", (ev) => {
          clearTimeout(t);
          reject(new Error("Worker error during load: " + ((ev && ev.message) || "unknown — check CSP worker-src/script-src/connect-src")));
        });
      });
      ready.catch(() => { teardown(); });
    }
    function teardown() {
      try { worker && worker.terminate(); } catch (_) {}
      worker = null; ready = null;
    }
    return {
      teardown: teardown,
      warm: function () { try { ensure(); } catch (_) {} },
      call: function (payload, timeoutMs) {
        if (typeof Worker === "undefined") return Promise.resolve(null);
        try { ensure(); } catch (_) { return Promise.resolve(null); }
        return ready.then(() => new Promise((resolve) => {
          const id = Math.random().toString(36).slice(2);
          // terminateOnTimeout is Pyodide's policy, not a universal one: it
          // exists to kill a runaway user loop. An embed is a fixed forward
          // pass and cannot run away, so tearing its worker down on a slow
          // pass would evict the loaded model and force a re-init — exactly
          // the re-download the two-instance split was created to prevent.
          const timer = setTimeout(() => {
            if (opts.terminateOnTimeout !== false) teardown();
            resolve(null);
          }, timeoutMs);
          const onMsg = (e) => {
            if (!e.data || e.data.type !== "result" || e.data.id !== id) return;
            clearTimeout(timer);
            worker.removeEventListener("message", onMsg);
            resolve(e.data);
          };
          worker.addEventListener("message", onMsg);
          worker.postMessage(Object.assign({ id: id }, payload));
        })).catch(() => null);
      },
    };
  }

  // Module worker: transformers.js v2 is ESM, so importScripts() cannot load it.
  const _embedSrc =
    'let loadErr=null,extract=null;' +
    'const boot=(async()=>{try{' +
    'const m=await import("' + _EMBED_XFORMERS_URL + '");' +
    'm.env.allowLocalModels=false;m.env.useBrowserCache=true;' +
    'extract=await m.pipeline("feature-extraction","' + _EMBED_MODEL + '",{quantized:true});' +
    'self.postMessage({type:"ready"});' +
    '}catch(e){loadErr=String((e&&e.stack)||e);self.postMessage({type:"loaderror",error:loadErr});}})();' +
    'self.onmessage=async(e)=>{if(!e.data||e.data.type!=="embed")return;const{id,text}=e.data;await boot;' +
    'if(loadErr){self.postMessage({type:"result",id,ok:false,error:loadErr});return;}' +
    'try{const o=await extract(text,{pooling:"mean",normalize:true});' +
    'self.postMessage({type:"result",id,ok:true,vector:Array.from(o.data)});}' +
    'catch(ex){self.postMessage({type:"result",id,ok:false,error:String(ex)});}};';

  const _embedWorker = _makeManagedWorker({
    label: "Embedding model",
    src: _embedSrc,
    workerOptions: { type: "module" },
    loadTimeoutMs: _EMBED_LOAD_TIMEOUT_MS,
    terminateOnTimeout: false,   // keep the model warm; see the note in call()
  });

  // Embed one string. Returns number[384], or NULL on any failure whatsoever.
  // Fail-soft per ruling: never throws, never blocks a round. Null => caller
  // leaves the embedding column null => match_rounds filters that row out.
  async function embedText(text) {
    const s = (text == null ? "" : String(text)).trim();
    if (!s) return null;
    const clipped = s.length > 1200 ? s.slice(0, 1200) : s;   // MiniLM caps ~256 word-pieces
    const msg = await _embedWorker.call({ type: "embed", text: clipped }, _EMBED_EXEC_TIMEOUT_MS);
    if (!msg || !msg.ok || !Array.isArray(msg.vector)) return null;
    if (msg.vector.length !== _EMBED_DIM) return null;         // dimension guard
    for (let i = 0; i < msg.vector.length; i++) {
      if (typeof msg.vector[i] !== "number" || !isFinite(msg.vector[i])) return null;
    }
    return msg.vector;
  }

  // Drawer self-test (Kimi Ruling 3, non-optional). Explicit PASS/FAIL beats the
  // silent-null failure mode where vector memory is dead but everything "looks fine."
  async function runEmbedSelfTest() {
    logError("[EMBED] Self-test: running… (first run downloads the model, ~20-30MB, one time)");
    const t0 = Date.now();
    // Three strings, not one. A dimension check alone passes a model that has
    // loaded but is emitting garbage — 384 finite numbers that mean nothing.
    // The norm and ordering checks below are what actually prove the vectors
    // are usable, and both failures would otherwise stay invisible until
    // Stage 2 retrieval quietly returned nonsense.
    const a = await embedText("The council reached a divided verdict on the ledger.");
    const b = await embedText("The seats disagreed about what the ledger recorded.");
    const c = await embedText("Sourdough starter needs feeding twice a day.");
    if (!a || !b || !c) {
      logError("[EMBED] Self-test: FAIL — embedText returned null. Check CSP connect-src (huggingface.co) and the console for a 'Refused to connect' line.");
      return false;
    }
    // L2 norm ≈ 1. normalize:true is what makes the inner product a cosine
    // similarity; if pooling ever changes, this is the only thing that catches
    // it before every Stage 2 similarity score is silently wrong.
    let ss = 0;
    for (let i = 0; i < a.length; i++) ss += a[i] * a[i];
    const norm = Math.sqrt(ss);
    if (Math.abs(norm - 1) > 0.01) {
      logError("[EMBED] Self-test: FAIL — L2 norm " + norm.toFixed(4) + ", expected ~1. Vectors are not normalised; cosine similarity in Stage 2 would be meaningless.");
      return false;
    }
    // Semantic ordering: a related pair must score above an unrelated pair.
    let near = 0, far = 0;
    for (let i = 0; i < a.length; i++) { near += a[i] * b[i]; far += a[i] * c[i]; }
    if (!(near > far)) {
      logError("[EMBED] Self-test: FAIL — related pair " + near.toFixed(3) + " scored at or below unrelated pair " + far.toFixed(3) + ". Model loaded but output is not semantically meaningful.");
      return false;
    }
    logError("[EMBED] Self-test: PASS | Model: " + _EMBED_MODEL + " | Dim: " + a.length +
      " | norm " + norm.toFixed(3) + " | near " + near.toFixed(3) + " > far " + far.toFixed(3) +
      " | " + (Date.now() - t0) + "ms" +
      (vectorMemoryEnabled() ? "" : " | NOTE: rq_vector_memory is OFF — vectors are not being stored."));
    return true;
  }

  // Stage 1: store-only shadow. WRITE-THEN-UPDATE so a slow/cold embed never
  // delays the round's memory write. Row is inserted first (elsewhere); this
  // patches the embedding in afterward, best-effort. rowId is the uuid returned
  // by the insert. Fully fail-soft: any problem just leaves embedding null.
  // Shared PATCH path for both the live round and the backfill. Returns one of
  // "ok" | "rls" | "http" | "throw" so callers can report precisely instead of
  // just "it didn't work".
  async function _patchEmbedding(rowId, vec) {
    try {
      const res = await fetch(
        settings.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/rq_events?id=eq." + encodeURIComponent(rowId),
        {
          method: "PATCH",
          headers: {
            apikey: settings.supabaseAnonKey,
            Authorization: "Bearer " + settings.supabaseAnonKey,
            "Content-Type": "application/json",
            // representation, not minimal: an UPDATE blocked by RLS returns
            // 204 with no error, so "success" and "changed nothing" are
            // indistinguishable under return=minimal. Asking for the row back
            // makes a zero-row update visible.
            Prefer: "return=representation",
          },
          // pgvector's text input format is "[0.1,0.2,...]". A raw JSON array
          // happens to serialise to the same characters, but PostgREST decides
          // whether to cast json->vector by version and column type, and some
          // builds reject it outright. The bracketed string is accepted by all
          // of them, so it is the form to send.
          body: JSON.stringify({ embedding: "[" + vec.join(",") + "]" }),
        }
      );
      const body = await res.text().catch(() => "");
      if (!res.ok) return { state: "http", detail: res.status + " " + (body || "").slice(0, 300) };
      let n = null;
      try { const j = JSON.parse(body); n = Array.isArray(j) ? j.length : null; } catch (_) {}
      if (n === 0) return { state: "rls", detail: "PATCH matched zero rows" };
      return { state: "ok", detail: "" };
    } catch (e) {
      return { state: "throw", detail: (e && e.message) || String(e) };
    }
  }

  async function embedAndStore(rowId, text) {
    try {
      // Every early return below used to be silent, which is why a broken
      // PATCH looked identical to a working one. Stage 1 is a shadow stage
      // under active verification — it should be loud. Quiet these once
      // embeddings are landing reliably.
      if (!rowId) { logError("[EMBED] skipped — insert returned no row id (check Prefer: return=representation and the anon SELECT policy)."); return; }
      if (!sbConfigured()) { logError("[EMBED] skipped — Supabase not configured."); return; }
      if (!vectorMemoryEnabled()) { logError("[EMBED] skipped — rq_vector_memory is OFF on this origin."); return; }
      logError("[EMBED] embedding row " + String(rowId).slice(0, 8) + "…");
      const vec = await embedText(text);
      if (!vec) { logError("[EMBED] FAIL — embedText returned null for row " + String(rowId).slice(0, 8) + "… (worker cold, timed out, or CSP-blocked)."); return; }
      const r = await _patchEmbedding(rowId, vec);
      if (r.state === "http")  { logError("[EMBED] FAIL — PATCH rejected HTTP " + r.detail); return; }
      if (r.state === "rls")   { logError("[EMBED] FAIL — PATCH matched ZERO rows. The request succeeded but RLS blocked the update; rq_events needs a policy: for update to anon using (true) with check (true)."); return; }
      if (r.state === "throw") { logError("[EMBED] FAIL — PATCH threw: " + r.detail); return; }
      logError("[EMBED] OK — row " + String(rowId).slice(0, 8) + "… embedded (" + vec.length + "d).");
    } catch (e) {
      logError("[EMBED] FAIL — embedAndStore threw: " + ((e && e.message) || e));
    }
  }

  // ---------- Stage 2/3: retrieval (shadow log + injection) ----------
  // ONE retrieval path, TWO consumers. Stage 2 records what retrieval WOULD have
  // surfaced; Stage 3 injects it. They must not be two implementations — a
  // parallel one drifts the first time either changes, and the A/B would then be
  // comparing injection against a fiction. Same reason _lastMemorySelection is a
  // side effect of buildMemoryContext rather than a recomputation.
  //
  // Nothing here can delay or fail a round: the shadow runs fully detached after
  // the round, and the injection path is bounded by RQ_INJECT_TIMEOUT_MS and
  // degrades to recency/CHIM on any problem at all.
  let _retrievalCache = null;   // { key, candidates, hits, best, corpusSize, at }

  // Raw retrieval. Returns { rows, corpusSize } or null. Never throws.
  async function runRetrieval(queryText) {
    if (!vectorMemoryEnabled() || !sbConfigured()) return null;
    const base = settings.supabaseUrl.replace(/\/+$/, "");
    const hdrs = {
      apikey: settings.supabaseAnonKey,
      Authorization: "Bearer " + settings.supabaseAnonKey,
      "Content-Type": "application/json",
    };
    try {
      const vec = await embedText(queryText);
      if (!vec) { logError("[RETRIEVAL] skipped — query embed returned null."); return null; }

      // match_count is TOP_K + 1: the current round's own row would otherwise
      // self-match at ~1.000 and consume a slot before we can filter it.
      //
      // min_similarity is RQ_DIAG_FLOOR (0), NOT RQ_SIM_FLOOR. Asking the RPC to
      // pre-filter meant a "0 hits" log line was indistinguishable from four rows
      // sitting at 0.59, which is exactly the ambiguity that made 2026-07-26's two
      // zero-hit rounds unreadable. Filter to the real floor locally instead, and
      // record the whole distribution.
      const rpc = await fetch(base + "/rest/v1/rpc/match_rounds", {
        method: "POST",
        headers: hdrs,
        body: JSON.stringify({
          query_embedding: "[" + vec.join(",") + "]",
          match_count: RQ_TOP_K + 1,
          min_similarity: RQ_DIAG_FLOOR,
        }),
      });
      if (!rpc.ok) {
        const b = await rpc.text().catch(() => "");
        logError("[RETRIEVAL] FAIL — match_rounds RPC HTTP " + rpc.status + " " + b.slice(0, 300));
        return null;
      }
      let rows = await rpc.json().catch(() => []);
      if (!Array.isArray(rows)) rows = [];

      // corpus_size: how many rows retrieval could have drawn from. Cheap
      // count-only request — Range 0-0 returns the total in Content-Range
      // without transferring any rows.
      let corpusSize = null;
      try {
        const cres = await fetch(base + "/rest/v1/rq_events?select=id&embedding=not.is.null", {
          headers: Object.assign({}, hdrs, { Prefer: "count=exact", Range: "0-0" }),
        });
        const cr = cres.headers.get("content-range") || "";
        const n = parseInt(cr.split("/")[1], 10);
        if (!isNaN(n)) corpusSize = n;
      } catch (_) { /* count is diagnostic; never block */ }

      return { rows: rows, corpusSize: corpusSize };
    } catch (e) {
      logError("[RETRIEVAL] FAIL — threw: " + ((e && e.message) || e));
      return null;
    }
  }

  // Split the raw rows into everything we looked at (candidates) and what
  // actually cleared the floor (hits). The candidate list is the floor
  // diagnostic: without it, tuning RQ_SIM_FLOOR is guesswork.
  function shapeRetrieval(rows, excludeId) {
    const candidates = (rows || [])
      .filter((r) => r && r.id !== excludeId)      // self-match exclusion (ruled)
      .slice(0, RQ_TOP_K)
      .map((r) => ({
        id: r.id,
        prompt: clip(r.prompt || "", 100),
        response: r.response || "",
        consensus_status: r.consensus_status || null,
        similarity: typeof r.similarity === "number" ? Number(r.similarity.toFixed(4)) : null,
      }));
    const hits = candidates.filter((c) => typeof c.similarity === "number" && c.similarity >= RQ_SIM_FLOOR);
    const best = (candidates.length && typeof candidates[0].similarity === "number") ? candidates[0].similarity : null;
    return { candidates: candidates, hits: hits, best: best };
  }

  // The log row never carries response text — that is 900 chars per row of data
  // already stored in rq_events, and the A/B is reviewed on prompts and scores.
  function _logShape(list) {
    return (list || []).map((c) => ({
      id: c.id,
      prompt: c.prompt,
      consensus_status: c.consensus_status,
      similarity: c.similarity,
    }));
  }

  // ---------- Stage 3: pre-round retrieval for injection ----------
  const RQ_INJECT_TIMEOUT_MS = 12000;

  async function retrieveForInjection(queryText) {
    if (!injectionEnabled()) return null;
    const key = clip(queryText, 900);
    try {
      const res = await Promise.race([
        runRetrieval(key),
        new Promise((r) => setTimeout(() => r("__timeout__"), RQ_INJECT_TIMEOUT_MS)),
      ]);
      if (res === "__timeout__") {
        logError("[INJECT] retrieval exceeded " + (RQ_INJECT_TIMEOUT_MS / 1000) + "s — round proceeds on recency/CHIM only.");
        return null;
      }
      if (!res) return null;
      // excludeId is null on purpose: this round's row does not exist yet, so
      // there is nothing of its own to self-match against.
      const shaped = shapeRetrieval(res.rows, null);
      _retrievalCache = {
        key: key,
        candidates: shaped.candidates,
        hits: shaped.hits,
        best: shaped.best,
        corpusSize: res.corpusSize,
        at: Date.now(),
      };
      return _retrievalCache;
    } catch (e) {
      logError("[INJECT] retrieval threw (" + ((e && e.message) || e) + ") — round proceeds on recency/CHIM only.");
      return null;
    }
  }

  // The injected block. The wording is load-bearing, not decoration. The finding
  // behind Stage 3 is that a seat attributes correctly when a citable source sits
  // in context and substitutes a nearby number when it has to reach (probe 2 vs
  // probe 1). So this block states what these rows are, that they were chosen by
  // meaning rather than recency, and that they may be cited — and it says
  // explicitly that absence here is not evidence of absence, because "retrieval
  // returned nothing" must not become a fresh licence to invent.
  function buildVectorBlock(hits, charBudget) {
    if (!hits || !hits.length || charBudget < 200) return "";
    let out =
      "=== RETRIEVED EARLIER ROUNDS (semantic match — may predate the recent ledger below) ===\n" +
      "Selected by MEANING, not recency, from this council's stored history. Each row\n" +
      "carries its trust tag and a similarity score. You may cite these rows. Treat\n" +
      "DIVIDED and PROVISIONAL rows as unsettled, exactly as in the ledger.\n" +
      "If something is not in this block, that means retrieval did not surface it — it\n" +
      "does NOT mean it did not happen. Do not fill that gap with a plausible answer;\n" +
      "say you cannot know it from what you were given.\n";
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      const tag = String(h.consensus_status || "unknown").toUpperCase();
      const line = "[match " + (typeof h.similarity === "number" ? h.similarity.toFixed(3) : "?") +
        " | " + tag + "] Q: \"" + clip(h.prompt, 120) + "\"" +
        (h.response ? " \u2192 \"" + clip(h.response, 220) + "\"" : "") + "\n";
      if (out.length + line.length > charBudget) break;
      out += line;
    }
    return out + "\n";
  }

  // ---------- Stage 2: A/B log ----------
  // Runs after the round is already logged, fully detached. Cannot delay a round
  // and cannot fail one. `injected` now records the REAL value rather than a
  // hard-coded false — that is what keeps a control arm after the operator
  // overrode the 20-sample gate on 2026-07-26.
  async function runRetrievalShadow(roundId, queryText, promptClass, seatDegraded, injected) {
    if (!vectorMemoryEnabled() || !sbConfigured()) return;
    const base = settings.supabaseUrl.replace(/\/+$/, "");
    const hdrs = {
      apikey: settings.supabaseAnonKey,
      Authorization: "Bearer " + settings.supabaseAnonKey,
      "Content-Type": "application/json",
    };
    try {
      const key = clip(queryText, 900);
      let shaped, corpusSize;
      const cached = (_retrievalCache && _retrievalCache.key === key) ? _retrievalCache : null;
      if (cached) {
        // Injection already ran exactly this retrieval before the round. Redoing
        // it would re-embed the same text and could return a different corpus
        // count than the one actually injected — the log would then describe a
        // retrieval that never happened.
        shaped = { candidates: cached.candidates, hits: cached.hits, best: cached.best };
        corpusSize = cached.corpusSize;
      } else {
        const res = await runRetrieval(key);
        if (!res) return;
        shaped = shapeRetrieval(res.rows, roundId);
        corpusSize = res.corpusSize;
      }

      // What the memory context actually surfaced this round. Captured as a side
      // effect of buildMemoryContext rather than recomputed, so the two can never
      // drift apart.
      const sel = _lastMemorySelection || { chim: false, entries: [], digested: 0 };

      const row = {
        round_id: roundId || null,
        query_text: clip(queryText || "", 100),
        query_truncated: (queryText || "").length > 100,
        prompt_class: promptClass || null,
        chim_enabled: !!sel.chim,
        chim_rounds: sel.entries || [],
        vector_rounds: _logShape(shaped.hits),
        top_k: RQ_TOP_K,
        similarity_floor: RQ_SIM_FLOOR,
        seat_degraded: !!seatDegraded,
        corpus_size: corpusSize,
        injected: !!injected,
      };
      // Floor-diagnostic columns. Same doctrine as prompt_class: a diagnostic
      // must never cost the row it annotates, so if rq-stage3-setup.sql has not
      // been run the insert 400s and we retry once without them.
      const diag = {
        vector_candidates: _logShape(shaped.candidates),
        best_similarity: shaped.best,
      };

      const post = (body) => fetch(base + "/rest/v1/rq_retrieval_log", {
        method: "POST",
        headers: Object.assign({}, hdrs, { Prefer: "return=minimal" }),
        body: JSON.stringify(body),
      });

      let res = await post(Object.assign({}, row, diag));
      if (!res.ok) {
        const b = await res.text().catch(() => "");
        logError("[RETRIEVAL] log insert with floor diagnostics failed (HTTP " + res.status +
          ") — retrying without them. If this repeats, rq-stage3-setup.sql has not been run. " + b.slice(0, 200));
        res = await post(row);
        if (!res.ok) {
          const b2 = await res.text().catch(() => "");
          logError("[RETRIEVAL] FAIL — log insert HTTP " + res.status + " " + b2.slice(0, 300));
          return;
        }
      }

      logError("[RETRIEVAL] logged — " + shaped.hits.length + " hit(s) above " + RQ_SIM_FLOOR +
        " of " + shaped.candidates.length + " candidate(s)" +
        (typeof shaped.best === "number" ? ", best " + shaped.best.toFixed(3) : "") +
        ", " + (sel.entries ? sel.entries.length : 0) + " context round(s), corpus " +
        (corpusSize === null ? "?" : corpusSize) +
        (injected ? " [INJECTED]" : "") +
        (seatDegraded ? " [SEAT DEGRADED]" : ""));
    } catch (e) {
      logError("[RETRIEVAL] FAIL — threw: " + ((e && e.message) || e));
    }
  }
  // ---------- Stage 2 prep: backfill ----------
  // Stage 1 only embeds rounds going forward, so the ledger's existing history
  // stays invisible to retrieval. Retrieving against two rows is not a test of
  // anything — the whole premise of vector memory is surfacing an OLD round
  // that recency dropped, and that requires the old rounds to carry vectors.
  //
  // Runs in the browser deliberately: the vectors must come from the same
  // MiniLM instance that embeds live rounds, or the comparison space is
  // inconsistent and every similarity score is quietly wrong. Sequential by
  // design — one worker, and parallel calls would only queue behind it.
  let _backfillRunning = false;

  async function backfillEmbeddings(maxRows) {
    if (_backfillRunning) { logError("[BACKFILL] already running."); return; }
    if (!sbConfigured()) { logError("[BACKFILL] Supabase not configured."); return; }
    if (!vectorMemoryEnabled()) { logError("[BACKFILL] rq_vector_memory is OFF — turn it on first."); return; }
    _backfillRunning = true;
    const base = settings.supabaseUrl.replace(/\/+$/, "");
    const cap = Math.max(1, Math.min(maxRows || 200, 500));
    const hdrs = { apikey: settings.supabaseAnonKey, Authorization: "Bearer " + settings.supabaseAnonKey };
    let ok = 0, noText = 0, embedFail = 0, patchFail = 0;
    try {
      // Never select the embedding column itself — 384 floats per row for data
      // we are about to overwrite anyway.
      const res = await fetch(
        base + "/rest/v1/rq_events?embedding=is.null&select=id,prompt,response&order=created_at.asc&limit=" + cap,
        { headers: hdrs }
      );
      if (!res.ok) {
        const b = await res.text().catch(() => "");
        logError("[BACKFILL] FAIL — could not list rows, HTTP " + res.status + " " + b.slice(0, 200));
        return;
      }
      const rows = await res.json();
      if (!Array.isArray(rows) || rows.length === 0) {
        logError("[BACKFILL] nothing to do — every round already has an embedding.");
        return;
      }
      logError("[BACKFILL] " + rows.length + " unembedded rounds found. Starting (first one may be slow if the model is cold)…");
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const text = [(row.prompt || ""), (row.response || "")].join("\n\n").trim();
        if (!text) { noText++; continue; }
        const vec = await embedText(text);
        if (!vec) { embedFail++; continue; }
        const r = await _patchEmbedding(row.id, vec);
        if (r.state === "ok") ok++;
        else {
          patchFail++;
          // Report the first failure in full, then stop: if the PATCH path is
          // broken, every remaining row fails the same way and a hundred
          // identical lines bury the one that matters.
          logError("[BACKFILL] STOPPED at row " + String(row.id).slice(0, 8) + "… — " + r.state + ": " + r.detail);
          break;
        }
        if ((i + 1) % 10 === 0) logError("[BACKFILL] " + (i + 1) + "/" + rows.length + " processed…");
      }
      logError("[BACKFILL] done — " + ok + " embedded, " + embedFail + " embed failures, "
        + patchFail + " patch failures, " + noText + " skipped (no text).");
    } catch (e) {
      logError("[BACKFILL] FAIL — threw: " + ((e && e.message) || e));
    } finally {
      _backfillRunning = false;
    }
  }

  function extractPython(text) {
    const m = (text || "").match(/```python\s*([\s\S]*?)```/i);
    return m ? m[1].trim() : null;
  }

  // Shadow execution across a round's answers. Runs any python a seat emitted,
  // attaches the result (a.compute) and logs it. Never throws into the round.
  async function runSandboxShadow(answers) {
    for (const a of answers) {
      const code = (a && a.code) || extractPython(a && a.text);
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

  // ============ v3.4.4: STRUCTURED RESPONSE ENVELOPE + VALIDATOR ============
  // Council-reviewed next build. NOTE: the council VOTED for "Incremental
  // State-Diff Sync," which was DECLINED — it assumes a WebSocket/multi-node
  // network layer this static-site arch does not have (seats are parallel
  // fetch() calls, nothing to diff-sync). This is the buildable winner from the
  // same round instead: a structured response contract that fixes the real,
  // observed failures (bare-number answers, truncated code, chain-of-thought
  // leaks) that broke fragile ```python regex parsing.
  //
  // Seats optionally return a JSON envelope {seat,reasoning,guess,code,final};
  // the orchestrator extracts structured fields instead of scraping free text.
  // A VALIDATOR retries a seat once if the envelope is unparseable, then falls
  // back to raw text.
  //
  // GATED: default OFF (localStorage rq_json_envelope="on"). When OFF there is
  // ZERO change to behavior. When ON it is TOLERANT by design — a malformed
  // envelope NEVER hard-fails a round; the seat's raw text is used exactly as
  // before. Built for free-tier models that are unreliable at strict JSON
  // (prose before "{", ```json fences, trailing text, truncation mid-object).
  const ENVELOPE_FIELDS = ["seat", "reasoning", "guess", "code", "final"];
  function jsonEnvelopeEnabled() { return localStorage.getItem("rq_json_envelope") === "on"; }

  const ENVELOPE_INSTRUCTION =
    "\n\n=== RESPONSE FORMAT ===\n" +
    "Return ONE JSON object and NOTHING else, in exactly this shape:\n" +
    '{"seat":"<your seat name>","reasoning":"<brief reasoning>",' +
    '"guess":"<answer from reasoning alone, or empty>",' +
    '"code":"<python that computes/verifies the answer, or empty>",' +
    '"final":"<your final answer>"}\n' +
    'Put runnable Python in the "code" field, NOT in a markdown block. ' +
    "Escape newlines inside string values as \\n. Output only the JSON object, " +
    "with no prose or fences before or after it.\n";

  // Tolerant extractor: pull the first balanced {...} out of surrounding junk,
  // parse it, normalize expected fields. Returns a normalized envelope or null.
  // Brace matching is string-aware so braces inside Python code don't confuse it.
  function parseEnvelope(text) {
    if (!text) return null;
    let s = String(text).replace(/```(?:json)?/gi, "").trim();
    const start = s.indexOf("{");
    if (start === -1) return null;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return null; // unbalanced (e.g. truncated mid-object)
    let obj;
    try { obj = JSON.parse(s.slice(start, end + 1)); }
    catch (_) { return null; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    // require at least one usable answer field, else it isn't a real envelope
    if (!("final" in obj) && !("reasoning" in obj) && !("guess" in obj)) return null;
    const norm = {};
    ENVELOPE_FIELDS.forEach((f) => { norm[f] = obj[f] != null ? String(obj[f]) : ""; });
    return norm;
  }

  // Apply the envelope to each answer when the mode is on. Parse; on failure,
  // retry the seat ONCE with a stricter reminder; on second failure keep raw
  // text (full backward-compatible fallback). Sets a.envelope, a.code, and
  // replaces a.text with the clean final answer for consensus (a.rawText kept).
  async function applyEnvelope(answers, calls) {
    if (!jsonEnvelopeEnabled()) return;
    for (const a of answers) {
      if (!a) continue;
      let env = parseEnvelope(a.text);
      if (!env) {
        const call = (calls || []).find((c) => c.name === a.name);
        if (call) {
          try {
            const retry = await call.fn(
              "Your previous response was not valid JSON. Reply with ONLY a single " +
              'JSON object: {"seat":"","reasoning":"","guess":"","code":"","final":""}. ' +
              "No prose, no markdown fences, no text before or after the object."
            );
            env = parseEnvelope(retry);
            if (env) logError("ENVELOPE — " + seatLabel(a.name) + " recovered on validator retry.");
          } catch (e) { /* fall through to raw-text fallback */ }
        }
      }
      if (env) {
        a.rawText = a.text;
        a.envelope = env;
        if (env.code) a.code = env.code;                 // sandbox prefers this
        const clean = (env.final || env.reasoning || env.guess || "").trim();
        if (clean) a.text = clean;                        // consensus uses clean answer
        logError("ENVELOPE — " + seatLabel(a.name) + " parsed OK" +
          (env.code ? " (code field present)" : "") + ".");
      } else {
        logError("ENVELOPE — " + seatLabel(a.name) +
          " unparseable after retry; using raw text (fallback, round unaffected).");
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
    // v3.5.4 (2026-07-26): PERSISTED from a live repair. Both previous entries
    // were dead — qwen-2.5-72b was on this file's own kill list from 07-13 and
    // was still configured, mistral-7b left the free tier after. repairDeadFloors
    // found these two in the live catalog at 12:00:28 and they answered. ling
    // leads because north-mini-code is a CODE model and is a last-resort seat on
    // a deliberation council; see the deny-list in orPickScore.
    gemini: ["inclusionai/ling-3.0-flash:free", "cohere/north-mini-code:free"],
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
    repairDeadFloors(cat);
    return cat;
  }

  // ---------- v3.5.3: dead-floor self-repair ----------
  // Repairs ONLY a seat whose ENTIRE configured list is dead — zero floor, the
  // condition that made the Gemini seat vanish mid-deliberation on 2026-07-17 and
  // again on 2026-07-26. A seat with even one live entry is left alone.
  // Family-safe picks only, so Kimi's diversity rule is preserved. In-memory
  // only: a reload returns to whatever is written in OR_SEAT_MODELS.
  // Lower is better. Specialist models answer a deliberation prompt badly or
  // not at all; a general chat model is always the better floor. This does not
  // EXCLUDE anything — a bad floor still beats a vanished seat — it only orders.
  const OR_SPECIALIST = /(^|[-\/])(code|coder|vision|vl|embed|rerank|guard|math|ocr|audio|whisper|tts|image)([-\/]|$)/i;
  function orPickScore(slug) {
    var name = String(slug || "").split("/").pop();
    if (OR_SPECIALIST.test(name)) return 2;
    if (/instruct|chat|flash|mini|turbo/i.test(name)) return 0;
    return 1;
  }

  function repairDeadFloors(cat) {
    if (!cat || !cat.free) return;
    Object.keys(OR_SEAT_MODELS).forEach((seat) => {
      const list = OR_SEAT_MODELS[seat] || [];
      if (!list.length) return;
      if (list.some((m) => cat.free.has(m))) return;   // seat still has a floor
      const banned = familiesUsedExcept(seat);
      // v3.5.4: was .sort().slice(0,2) — alphabetical. That is how a CODE model
      // (cohere/north-mini-code) ended up seated on a deliberation council on
      // 2026-07-26. Rank by fitness first, alphabetically only to break ties.
      const picks = Array.from(cat.free)
        .filter((m) => !banned.has(orFamily(m)))
        .sort((a, b) => (orPickScore(a) - orPickScore(b)) || (a < b ? -1 : a > b ? 1 : 0))
        .slice(0, 2);
      if (!picks.length) {
        logError("\u26A0 FLOOR REPAIR — " + seat + " seat has no live models AND no family-safe replacement exists in the live free catalog. Escalate to Kimi; this seat will vanish if its primary fails.");
        return;
      }
      OR_SEAT_MODELS[seat] = picks;
      logError("\u2714 FLOOR REPAIR — " + seat + " seat had ZERO live fallback models (" + list.join(", ") +
        " \u2014 all 404). Repaired IN MEMORY from the live free catalog: " + picks.join(", ") +
        ". Family-safe. NOT persisted \u2014 paste these into OR_SEAT_MODELS to make it permanent.");
    });
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

      // v3.4.7 (Kimi Ruling 3) — embedding self-test. Explicit PASS/FAIL in the
      // Error Logs so a CSP-blocked or cold model can't fail silently.
      const d = document.createElement("button");
      d.id = "embedSelfTest";
      d.type = "button";
      d.textContent = "EMBED SELF-TEST";
      d.className = saveSettingsBtn.className || "";
      d.style.cssText = "margin-top:10px;width:100%;opacity:0.85;";
      c.parentNode.insertBefore(d, c.nextSibling);
      d.addEventListener("click", async () => {
        const label = d.textContent;
        d.disabled = true;
        d.textContent = "TESTING\u2026 see Error Logs";
        try { await runEmbedSelfTest(); } finally { d.disabled = false; d.textContent = label; }
      });

      // v3.4.7d — vector memory toggle. The flag lives in localStorage, which a
      // hard cache clear wipes; since every deploy is followed by a hard clear,
      // the flag was silently reverting to OFF after each one and rounds stopped
      // embedding with no visible cause. A control in Settings means restoring it
      // never needs a console, and its label states the current value out loud.
      const e2 = document.createElement("button");
      e2.id = "vectorMemoryToggle";
      e2.type = "button";
      e2.className = saveSettingsBtn.className || "";
      e2.style.cssText = "margin-top:10px;width:100%;opacity:0.85;";
      const paintVM = () => {
        e2.textContent = "VECTOR MEMORY: " + (vectorMemoryEnabled() ? "ON" : "OFF");
      };
      paintVM();
      d.parentNode.insertBefore(e2, d.nextSibling);
      e2.addEventListener("click", () => {
        try {
          const now = !vectorMemoryEnabled();
          localStorage.setItem("rq_vector_memory", now ? "on" : "off");
          paintVM();
          logError("[EMBED] Vector memory storage is now " + (now ? "ON" : "OFF") + ".");
        } catch (_) {
          logError("[EMBED] Could not write the flag — localStorage is unavailable (private browsing?).");
        }
      });
      // v3.5.0 — backfill trigger. Manual, never automatic: it walks the whole
      // ledger and should be a decision, not a surprise on page load.
      const f2 = document.createElement("button");
      f2.id = "backfillEmbeddings";
      f2.type = "button";
      f2.textContent = "BACKFILL EMBEDDINGS";
      f2.className = saveSettingsBtn.className || "";
      f2.style.cssText = "margin-top:10px;width:100%;opacity:0.85;";
      e2.parentNode.insertBefore(f2, e2.nextSibling);
      f2.addEventListener("click", async () => {
        // Kimi's v3.5.0 amendment: backfill walks the whole ledger and should be
        // a decision, not a fat-fingered Settings tap.
        let pending = "all";
        try {
          const cres = await fetch(
            settings.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/rq_events?select=id&embedding=is.null",
            { headers: { apikey: settings.supabaseAnonKey, Authorization: "Bearer " + settings.supabaseAnonKey, Prefer: "count=exact", Range: "0-0" } }
          );
          const n = parseInt((cres.headers.get("content-range") || "").split("/")[1], 10);
          if (!isNaN(n)) pending = String(n);
        } catch (_) { /* fall back to the vague wording rather than blocking */ }
        const est = (pending === "all") ? "about a second each" : (Math.max(1, Math.round(Number(pending) * 0.7)) + "s");
        if (!window.confirm("This will embed " + pending + " unembedded round(s).\nEstimated time: ~" + est + ".\n\nProceed?")) return;
        const label = f2.textContent;
        f2.disabled = true;
        f2.textContent = "BACKFILLING\u2026 see Error Logs";
        try { await backfillEmbeddings(200); } finally { f2.disabled = false; f2.textContent = label; }
      });
      // v3.5.2 — K3 spend gate. Sits next to the vector memory toggle so both
      // metered/heavy features are visible in one place, with their live state
      // stated on the button rather than assumed.
      const k3 = document.createElement("button");
      k3.id = "kimiK3Toggle";
      k3.type = "button";
      k3.className = saveSettingsBtn.className || "";
      k3.style.cssText = "margin-top:10px;width:100%;opacity:0.85;";
      const paintK3 = () => {
        k3.textContent = kimiK3Enabled()
          ? "KIMI SEAT: K3 (paid \u2014 spending credits)"
          : "KIMI SEAT: FREE TIER (OpenRouter)";
      };
      paintK3();
      f2.parentNode.insertBefore(k3, f2.nextSibling);
      k3.addEventListener("click", () => {
        try {
          const now = !kimiK3Enabled();
          localStorage.setItem("rq_kimi_k3", now ? "on" : "off");
          paintK3();
          refreshAllSeatHealth();
          logError(now
            ? "[K3] Kimi seat is now kimi-k3 (Moonshot, PAID). Base weight 1.0 — a primary voice, so VERIFIED consensus becomes reachable. Every round from here spends credits."
            : "[K3] Kimi seat is now the OpenRouter free-tier walk. Base weight 0.5. No Moonshot requests, no spend.");
        } catch (_) {
          logError("[K3] Could not write the toggle — localStorage is unavailable (private browsing?).");
        }
      });
      // v3.5.3 — Stage 3 injection toggle. Sits with the other two metered/
      // behaviour-changing flags. This is the first flag that changes what the
      // SEATS READ, so its state has to be visible without a console: a round run
      // with it silently on is not comparable to one run with it off, and the A/B
      // is the whole point.
      const inj = document.createElement("button");
      inj.id = "injectToggle";
      inj.type = "button";
      inj.className = saveSettingsBtn.className || "";
      inj.style.cssText = "margin-top:10px;width:100%;opacity:0.85;";
      const paintInj = () => {
        inj.textContent = "STAGE 3 INJECTION: " + (injectionEnabled() ? "ON" : "OFF");
      };
      paintInj();
      k3.parentNode.insertBefore(inj, k3.nextSibling);
      inj.addEventListener("click", () => {
        try {
          const now = !injectionEnabled();
          localStorage.setItem("rq_inject", now ? "on" : "off");
          paintInj();
          logError(now
            ? "[INJECT] Stage 3 injection is ON. Retrieved rounds above the " + RQ_SIM_FLOOR + " floor are now placed in every seat's context before the round. Requires VECTOR MEMORY to be ON."
            : "[INJECT] Stage 3 injection is OFF. Seats read recency/CHIM only \u2014 this is the A/B control arm.");
        } catch (_) {
          logError("[INJECT] Could not write the toggle \u2014 localStorage is unavailable (private browsing?).");
        }
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
        // v3.5.4: was "Treated as HOLD", which reads as a deliberate abstention
        // and was read that way in K3's 2026-07-26 handoff. An infrastructure
        // failure is not a position. counted:false always excluded it from the
        // resolution math; now the label says so and the seat is dropped from
        // the denominator below rather than silently blocking a RESOLVED.
        logError(`\u26A0 ADJUDICATION — ${seatLabel(p.seat)} UNAVAILABLE (${e.message || e}). Infrastructure failure, NOT an abstention. Excluded from the resolution denominator.`);
        verdicts.push({ letter: p.letter, seat: p.seat, verdict: "unavailable", target: null, error: "", counted: false, unavailable: true });
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
      // v3.5.4: seats that never rendered cannot concede, so counting them in
      // the denominator made RESOLVED unreachable whenever a provider 429'd.
      const _live = positions.length - verdicts.filter((v) => v.unavailable).length;
      if (conceders.length >= _live - 1 && targetHeld) {
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
    if (settings.keyKimi) {
      if (kimiK3Enabled()) {
        calls.push({ name: "kimi", fn: callKimi });
      } else if (settings.keyOpenRouter) {
        // Routed, not failed. No Moonshot request is made, so this costs nothing
        // and produces no "primary failed" noise in the log.
        calls.push({ name: "kimi", fn: (q) => callOpenRouter(q, "kimi") });
      } else {
        logError("[K3] Kimi K3 is OFF and no OpenRouter key is set — the Kimi seat has no free occupant and sits out this round. Settings \u2192 KIMI K3 to enable it, or add an OpenRouter key.");
      }
    }
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
        (c.name === "kimi" && kimiOnOpenRouter()) ? "openrouter" :
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
        const identityLine =
          `YOUR IDENTITY: You are the ${cap} seat of this council — one seat only. ` +
          `The other seats deliberate separately and answer for themselves. ` +
          `Write YOUR position only. Never simulate, quote, or draft responses for other seats.`;
        // v3.5.3: the token lives ONLY inside MEMORY_HEADER, so a round with
        // memory off or an empty ledger dispatched with NO identity block —
        // .replace() on an absent needle does nothing, silently. That is the
        // exact 2026-07-14 "answered as the whole council" condition, latent
        // since v2.9.1 and armed by every FORGET and New Session. Prepend when
        // the token is absent.
        q = q.indexOf("{{SEAT_IDENTITY}}") !== -1
          ? q.replace("{{SEAT_IDENTITY}}", identityLine)
          : identityLine + "\n\n" + q;
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
        // Skip when the seat's configured occupant IS OpenRouter (Kimi with K3
        // toggled off): failing over from a provider to itself would just walk
        // the same model list twice and log it as a failover that never was.
        if (orAvailable && primaryTag !== "openrouter") {
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

    // K3's B4 (round 78: one seat reported a work product absent from context
    // while another quoted it verbatim). The composed prompt is built ONCE in
    // dispatch and handed to every seat, so ASSEMBLY is identical by
    // construction — the only per-seat difference is the identity line. What
    // remains is DELIVERY: seats run on models with different context windows and
    // truncate differently. Log the size; the next occurrence is then decidable.
    logError("[CONTEXT] composed prompt " + query.length + " chars, identical for all " +
      calls.length + " seat(s). A seat reporting missing context at this size is hitting its own window, not an assembly bug.");

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
    // v3.4.4: parse structured envelopes (gated) BEFORE the sandbox, so it
    // can use the envelope's code field instead of regex-scraping ```python.
    await applyEnvelope(answers, calls);
    await runSandboxShadow(answers);
    // v3.4.2: feed computed results back to the seats (toggle rq_sandbox_feedback;
    // OFF by default, so consensus is unchanged until deliberately enabled).
    await runSandboxFeedback(answers, calls);

    // Operator note: the seats answered, but there is nothing to adjudicate.
    // _noteRound is read rather than testing `query`, because by this point
    // `query` is the COMPOSED prompt and the note prefix sits far inside it,
    // after the CURRENT QUESTION marker.
    if (_noteRound) {
      logError("[NOTE] Operator note — consensus and adjudication SKIPPED. Seat responses recorded; no verdict claimed and no DIVIDED tag issued.");
      return { text: null, divided: true, answers, note: true };
    }

    // v3.5.4 — COUNCIL HEALTH. One line per round, stated before any verdict is
    // computed, so "who actually rendered" is never something that has to be
    // reconstructed from adjacent log lines afterwards.
    (function councilHealth() {
      try {
        var configured = Object.keys(seatProvider).length || answers.length;
        var rendered = answers.length;
        var primaries = answers.filter(function (a) { return (a.provider || seatProvider[a.name]) === "primary"; }).length;
        var pct = configured ? Math.round((rendered / configured) * 100) : 0;
        logError("[HEALTH] " + rendered + "/" + configured + " seat(s) rendered (" + pct + "%), " +
          primaries + " primary voice(s): " + answers.map(function (a) { return seatLabel(a.name); }).join(", ") +
          (rendered < configured ? " \u2014 a seat is missing; any verdict below is over " + rendered + " voices, not " + configured + "." : ""));
      } catch (_) {}
    })();

    // Indexical round: every seat answers about ITSELF, so there is no shared
    // proposition to agree on. Render all of them; claim nothing.
    if (_indexicalRound) {
      logError("[INDEXICAL] Roll-call/self-report prompt — consensus and adjudication SKIPPED. Three correct answers about three different subjects is not disagreement, and it is not agreement either. All seat responses rendered verbatim.");
      return { text: null, divided: true, answers, indexical: true };
    }

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
    // v3.5.4 AUDIT TRAIL. "3/3" alone cannot be checked against anything, which
    // is how a mic-rotation round got read as a fabricated quorum on 2026-07-26.
    // Name the seats on both sides of the ratio, every time, in the log AND on
    // the badge. One seat speaking for an agreeing set is the ratified
    // mic-rotation model; it just has to be legible as that.
    const _agreedNames = agreed.map((a) => seatLabel(a.name));
    const _eligibleNames = eligible.map((a) => seatLabel(a.name));
    logError(`Consensus synthesized — speaking voice: ${seatLabel(speaker.name)} (weight ${seatWeight(speaker.name)}), ${agreed.length}/${eligible.length} eligible agents in agreement. AGREEING: [${_agreedNames.join(", ")}]. ELIGIBLE: [${_eligibleNames.join(", ")}]. The rendered answer is this ONE seat's text, not a merge of all ${agreed.length}.`);
    return {
      text: speaker.text.trim(),
      divided: false,
      answers,
      trust: hasPrimaryVoice ? "verified" : "provisional",
      agreedCount: agreed.length,
      eligibleCount: eligible.length,
      speakerSeat: seatLabel(speaker.name),
      agreedNames: _agreedNames,
      eligibleNames: _eligibleNames,
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

  // ==================== v3.4.3: CHIM — Concise History Injection Module ====================
  // Council-approved (round 27: Gemini Y, Claude AMEND, Kimi conceded no defect).
  // PROBLEM it fixes: buildMemoryContext fills the char budget newest-first and,
  // when it runs out, SILENTLY DROPS the oldest rounds. Once the ledger is long,
  // early SETTLED decisions (constitution, protocol rounds, roster changes) fall
  // off the cliff and the council "loses the plot." CHIM reserves a slice of the
  // budget for a compact STATE DIGEST of exactly those would-be-dropped rounds,
  // so long-term settled context survives in bounded form instead of vanishing.
  //
  // SPEC-VS-REALITY (the honest refinement of the round-26 proposal):
  //  - The proposal said "runs every 10 rounds." This architecture rebuilds the
  //    injected context FRESH every dispatch, so a periodic stored job is the
  //    wrong shape — CHIM runs CONTINUOUSLY at injection time (always current,
  //    no stored summary blob that can drift out of sync).
  //  - The proposal said "RESOLVED vs OUTSTANDING proposals / active protocols."
  //    The ledger stores free-text prompt/outcome/verdict, NOT structured
  //    proposal metadata. So CHIM summarizes what's ACTUALLY there — trust-tag
  //    counts + VERIFIED verdicts (safe to carry as settled) + recurring DIVIDED
  //    topics (open threads) — rather than asserting invented structure, which
  //    would just amplify confabulation.
  //
  // GATED: default OFF. Flip on: localStorage.setItem("rq_chim","on"). When off,
  // buildMemoryContext behaves EXACTLY as before (safe rollback + clean A/B).
  const CHIM_DIGEST_BUDGET_FRAC = 0.35; // share of the char budget reserved for the digest
  function chimEnabled() { return localStorage.getItem("rq_chim") === "on"; }

  // Compact the older entries (those the recent-budget couldn't fit) into a
  // bounded digest. VERIFIED verdicts are carried as settled fact; DIVIDED are
  // listed as open threads; PROVISIONAL/SOLE are counted only (never asserted).
  function buildStateDigest(olderEntries, charBudget) {
    if (!olderEntries.length || charBudget < 80) return "";
    const counts = { verified: 0, provisional: 0, sole: 0, divided: 0 };
    const settled = [];
    const openTopics = [];
    olderEntries.forEach((e) => {
      if (counts[e.outcome] !== undefined) counts[e.outcome]++;
      if (e.outcome === "verified" && e.verdict) settled.push(clip(e.verdict, 90));
      else if (e.outcome === "divided") openTopics.push(clip(e.prompt, 50));
    });
    let out = "=== EARLIER ROUNDS (compacted by CHIM) ===\n" +
      olderEntries.length + " older round(s): " + counts.verified + " VERIFIED, " +
      counts.provisional + " PROVISIONAL, " + counts.sole + " SOLE VOICE, " +
      counts.divided + " DIVIDED.\n";
    if (settled.length) out += "Settled (VERIFIED, treat as established): " +
      settled.slice(0, 8).map((s) => '"' + s + '"').join("; ") + "\n";
    if (openTopics.length) out += "Recurring open threads (were DIVIDED, NOT settled): " +
      openTopics.slice(0, 6).map((s) => '"' + s + '"').join("; ") + "\n";
    if (out.length > charBudget) out = clip(out, charBudget - 4) + "…\n";
    return out;
  }

  // Build the injected context: newest rounds verbatim, older rounds
  // compacted, assembled newest-backwards under the hard char cap, then
  // emitted oldest-first for natural reading order. With CHIM on, rounds that
  // don't fit are compacted into a state digest instead of being dropped.
  // Stage 2 A/B: what buildMemoryContext actually surfaced this round, recorded
  // as a side effect rather than recomputed by the harness. A parallel
  // reimplementation would drift from the real selection logic the first time
  // either changed, and then the A/B would be comparing retrieval against a
  // fiction. Read by runRetrievalShadow; never injected anywhere.
  let _lastMemorySelection = { chim: false, entries: [], digested: 0 };

  function _selEntry(entry, idx) {
    return {
      round: idx + 1,
      prompt: clip((entry && entry.prompt) || "", 100),
      outcome: (entry && entry.outcome) || null,
    };
  }

  // budgetOverride (v3.5.3): Stage 3 hands the vector block 40% of the context
  // budget and this function the remaining 60%. Omitted, behaviour is unchanged.
  function buildMemoryContext(budgetOverride) {
    _lastMemorySelection = { chim: chimEnabled(), entries: [], digested: 0 };
    if (!memoryEnabled() || ledger.length === 0) return "";
    const lines = [];
    const picked = [];
    // Defensive clamp: even if CHAR_CAP is mis-tuned above HARD_MAX, the
    // injection can never exceed the ceiling that protects free-tier prompts.
    let budget = Math.min(
      (typeof budgetOverride === "number" && budgetOverride > 0) ? budgetOverride : MEMORY_CONTEXT_CHAR_CAP,
      MEMORY_CONTEXT_HARD_MAX
    );

    if (chimEnabled()) {
      // Reserve a slice for the digest so old rounds never fall off the cliff.
      const digestBudget = Math.floor(budget * CHIM_DIGEST_BUDGET_FRAC);
      let recentBudget = budget - digestBudget;
      let oldestShown = ledger.length; // index of the oldest round shown in full
      for (let i = ledger.length - 1; i >= 0; i--) {
        const verbatim = i >= ledger.length - LEDGER_VERBATIM_ROUNDS;
        const line = `[Round ${i + 1}] ` + ledgerLine(ledger[i], verbatim);
        if (line.length + 1 > recentBudget) break;
        recentBudget -= line.length + 1;
        lines.unshift(line);
        picked.unshift(_selEntry(ledger[i], i));
        oldestShown = i;
      }
      const older = ledger.slice(0, oldestShown); // everything not shown in full
      const digest = buildStateDigest(older, digestBudget);
      _lastMemorySelection = { chim: true, entries: picked, digested: older.length };
      if (lines.length === 0 && !digest) return "";
      const body = (digest ? digest + "\n" : "") + lines.join("\n");
      return MEMORY_HEADER + body + "\n=== CURRENT QUESTION ===\n";
    }

    // CHIM off — original behaviour: newest-first until budget runs out.
    for (let i = ledger.length - 1; i >= 0; i--) {
      const verbatim = i >= ledger.length - LEDGER_VERBATIM_ROUNDS;
      const line = `[Round ${i + 1}] ` + ledgerLine(ledger[i], verbatim);
      if (line.length + 1 > budget) break;
      budget -= line.length + 1;
      lines.unshift(line);
      picked.unshift(_selEntry(ledger[i], i));
    }
    _lastMemorySelection = { chim: false, entries: picked, digested: 0 };
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
  // v3.4.5 — normalize heterogeneous rows for PostgREST bulk insert.
  // PostgREST rejects a batch whose objects do not all share identical keys
  // (the "council" summary row omits the numeric seat columns).
  // CRITICAL: undefined -> null. JSON.stringify silently strips undefined keys,
  // which re-introduces the very mismatch this function exists to remove.
  function rqNormalizeRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return rows;
    const keys = new Set();
    for (const r of rows) {
      if (r) for (const k of Object.keys(r)) keys.add(k);
    }
    const template = {};
    keys.forEach((k) => { template[k] = null; });
    return rows.map((r) => {
      const out = Object.assign({}, template);
      for (const k of Object.keys(r || {})) {
        out[k] = (r[k] === undefined ? null : r[k]);
      }
      return out;
    });
  }

  function sbInsert(table, rows) {
    if (!sbConfigured()) return Promise.resolve();
    const payload = rqNormalizeRows(rows);
    return fetch(settings.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/" + table, {
      method: "POST",
      headers: {
        apikey: settings.supabaseAnonKey,
        Authorization: "Bearer " + settings.supabaseAnonKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (res.ok) return;
      // v3.4.5 — surface the PostgREST error body. A bare status code cannot
      // distinguish key mismatch / unknown column / RLS / type error.
      return res.text().catch(() => "").then((body) => {
        const detail = (body || "").slice(0, 500);
        try { console.warn("[RQ][telemetry] insert rejected", "table:", table, "status:", res.status, "body:", detail); } catch (_) {}
        logError(`Institutional memory write to ${table} failed (HTTP ${res.status}) — dispatch unaffected. ${detail}`);
      });
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
    // v3.4.6 (Kimi Ruling 1, 2026-07-22) — rq_events is now a FULL LEDGER.
    // Was: if (result.divided || result.trust === "sole") { ... }
    // That conditional made rq_events a log of DISAGREEMENTS. Vector memory
    // built on it would index the council's arguments while every settled
    // decision stayed invisible to retrieval — the opposite of what the
    // confabulation fix needs. result.divided is READ here, never written,
    // so removing the guard cannot affect consensus weighting.
    // v3.4.7 — the response text is what Stage 1 embeds, so build it once and
    // reuse it for both the row and the embedding (embed the fuller prompt+response
    // so retrieval matches on question AND verdict, not verdict alone).
    const _evPrompt = clip(query, 900);
    // v3.5.4: a consensus round used to embed ONLY the speaking seat's text, so
    // the corpus recorded the merged voice and lost the fact that other seats
    // said something different. Stage 4 measures divergence; the corpus it reads
    // from must contain it. Verdict stays first and keeps the larger share —
    // retrieval should still match on the conclusion.
    const _evResponse = clip(result.divided
      ? answers.map((a) => `${seatLabel(a.name)}: ${clip(a.text, 120)}`).join(" | ")
      : (clip(result.text || "", 560) +
         (answers.length > 1
           ? " || SEATS: " + answers.map((a) => `${seatLabel(a.name)}: ${clip(a.text, 90)}`).join(" | ")
           : "")), 900);
    const _evStatus = result.divided ? "divided" : (result.trust || "unknown");
    const _evClass = classifyPrompt(query);

    // seat_degraded for the A/B log. Reuses warnSeatDiversity's identity rule
    // (a.model || seatModelLabel) rather than a second implementation, so the
    // flag and the warning can never disagree about what counts as degraded.
    let _seatDegraded = false;
    try {
      const seen = {};
      ((result && result.answers) || []).forEach((a) => {
        const m = a.model || seatModelLabel(a.name) || "unknown";
        seen[m] = (seen[m] || 0) + 1;
        if (seen[m] > 1) _seatDegraded = true;
      });
    } catch (_) { _seatDegraded = true; }   // unknown means assume degraded

    // WRITE-THEN-UPDATE: insert returns the row id, then embedding is patched in
    // asynchronously. A slow/cold/failed embed never delays or blocks this write.
    //
    // prompt_class is a diagnostic column and must never be able to cost a
    // ledger row. If the migration has not been run yet the insert 400s on an
    // unknown column, so a failure retries once WITHOUT it. The ledger is source
    // of truth; the classification is an index on top of it, and v3.4.6 exists
    // precisely so every round lands.
    sbInsertReturning("rq_events", {
      prompt: _evPrompt,
      response: _evResponse,
      consensus_status: _evStatus,
      prompt_class: _evClass,
    }).then((row) => {
      if (row && row.id) return row;
      // sbInsertReturning also returns null when Supabase simply isn't
      // configured. Don't report a schema problem in that case, and don't
      // retry — there is nothing to retry against.
      if (!sbConfigured()) return null;
      logError("[CLASS] insert with prompt_class returned no row — retrying without it. If this repeats, rq-stage2-setup.sql has not been run.");
      return sbInsertReturning("rq_events", {
        prompt: _evPrompt,
        response: _evResponse,
        consensus_status: _evStatus,
      });
    }).then((row) => {
      // A missing row here is the other silent failure: the insert succeeded
      // but returned nothing to attach an embedding to. Name it explicitly
      // rather than letting the chain end quietly.
      if (row && row.id) {
        embedAndStore(row.id, _evPrompt + "\n\n" + _evResponse);
        // Detached on purpose — shadow retrieval must not delay the round or
        // the embedding write, and its failures are diagnostic only.
        runRetrievalShadow(row.id, _evPrompt, _evClass, _seatDegraded, _injectedThisRound);
      } else if (vectorMemoryEnabled()) {
        logError("[EMBED] no row id returned from the rq_events insert — nothing to embed. Insert itself may have failed; see any preceding institutional-memory error.");
      }
    });
  }

  // Like sbInsert but returns the inserted row (Prefer: return=representation)
  // so callers can chain on the generated id. Resolves the first row or null;
  // never rejects. Single-object insert only.
  function sbInsertReturning(table, obj) {
    if (!sbConfigured()) return Promise.resolve(null);
    const payload = rqNormalizeRows([obj]);
    return fetch(settings.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/" + table, {
      method: "POST",
      headers: {
        apikey: settings.supabaseAnonKey,
        Authorization: "Bearer " + settings.supabaseAnonKey,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(payload),
    }).then((res) => {
      if (res.ok) return res.json().then((rows) => (Array.isArray(rows) ? rows[0] : rows) || null).catch(() => null);
      return res.text().catch(() => "").then((body) => {
        const detail = (body || "").slice(0, 500);
        try { console.warn("[RQ][telemetry] insert rejected", "table:", table, "status:", res.status, "body:", detail); } catch (_) {}
        logError(`Institutional memory write to ${table} failed (HTTP ${res.status}) — dispatch unaffected. ${detail}`);
        return null;
      });
    }).catch((e) => {
      logError(`Institutional memory unreachable (${table}): ${e.message || e} — dispatch unaffected.`);
      return null;
    });
  }

  // v3.4.6 (Kimi, 2026-07-22) — surface the routing artifact that makes
  // agreement look stronger than it is. When two seats fall back to the same
  // model, "3/3 consensus" is two models wearing three hats. Advisory only:
  // never blocks a round, never alters weights.
  function warnSeatDiversity(result) {
    try {
      const answers = (result && result.answers) || [];
      if (answers.length < 2) return;
      const byModel = {};
      answers.forEach((a) => {
        const m = a.model || seatModelLabel(a.name) || "unknown";
        (byModel[m] = byModel[m] || []).push(seatLabel(a.name));
      });
      Object.keys(byModel).forEach((m) => {
        const seats = byModel[m];
        if (seats.length > 1) {
          logError(`[SEAT] Diversity warning: ${seats.length}/${answers.length} seats routed to identical model (${m}) — ${seats.join(", ")}. Consensus weights may be inflated; agreement between them is not independent verification.`);
        }
      });
    } catch (_) { /* advisory only — never break a round */ }
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
  // Per-round state set in dispatch and read further down the call chain.
  // Module-scoped rather than threaded through as parameters because both are
  // read in functions several frames deep (runLiveCouncil, logInstitutionalMemory)
  // that already take five arguments each.
  let _injectedThisRound = false;   // did a vector block actually reach the seats
  let _noteRound = false;           // was this an operator note (skip consensus)
  let _indexicalRound = false;      // roll call — every seat renders, never synthesize

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
      // ---------- Stage 3: retrieve first, then split the context budget ----------
      // 40% vector / 40% CHIM / 20% verbatim recency, per Kimi's ratified split.
      // With injection OFF this path is byte-identical to v3.5.2a: same call, same
      // budget, and no retrieval request is made at all.
      _noteRound = isOperatorNote(query);
      _indexicalRound = isIndexicalPrompt(query);
      let _vectorBlock = "";
      let _memBudget = MEMORY_CONTEXT_CHAR_CAP;
      _injectedThisRound = false;
      if (injectionEnabled()) {
        const vecBudget = Math.floor(MEMORY_CONTEXT_CHAR_CAP * RQ_INJECT_VECTOR_FRAC);
        _memBudget = MEMORY_CONTEXT_CHAR_CAP - vecBudget;
        const inj = await retrieveForInjection(query);
        _vectorBlock = inj ? buildVectorBlock(inj.hits, vecBudget) : "";
        if (inj && !inj.hits.length) {
          logError("[INJECT] retrieval returned 0 row(s) above " + RQ_SIM_FLOOR +
            (typeof inj.best === "number" ? " (best candidate " + inj.best.toFixed(3) + " of " + inj.candidates.length + ")" : "") +
            " — nothing injected; context is recency/CHIM only. If this repeats with a healthy best score, the FLOOR is the suspect, not retrieval.");
        }
        _injectedThisRound = !!_vectorBlock;
      }
      const memoryContext = buildMemoryContext(_memBudget);
      // The vector block goes INSIDE the memory envelope, immediately before the
      // CURRENT QUESTION marker, so the marker stays adjacent to the question.
      // Putting it in front of MEMORY_HEADER would separate the two and leave the
      // seat reading retrieved history before it has been told what history is.
      let _composedBody;
      if (memoryContext) {
        const _mark = "=== CURRENT QUESTION ===\n";
        const _at = memoryContext.lastIndexOf(_mark);
        _composedBody = (_at === -1)
          ? _vectorBlock + memoryContext + query
          : memoryContext.slice(0, _at) + _vectorBlock + memoryContext.slice(_at) + query;
      } else {
        _composedBody = _vectorBlock + query;
      }
      const composedQuery = _composedBody + (jsonEnvelopeEnabled() ? ENVELOPE_INSTRUCTION : "");
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
          // v3.5.4: positions are now recorded on EVERY round, not only divided
          // ones. Previously a consensus round kept only the speaking seat's
          // text, so the ledger — and the embedded corpus built from it —
          // systematically under-represented divergence, which is the one thing
          // Stage 4 exists to measure.
          positions: allAnswers.map((a) => ({ seat: seatLabel(a.name), text: clip(a.text, 300) })),
          // v3.0.2: per-seat roster for Seat Stats — who answered, who was
          // malformed; absent seats failed that round.
          seats: allAnswers.map((a) => ({ n: a.name, m: !!a.malformed })),
        });
        if (typeof playConsensusFlow === "function" && settings.flowAnim !== false) playConsensusFlow(divided, result.trust);
        if (memoryPill && memoryPill.refresh) memoryPill.refresh();
        if (window.__rqRenderSessions) window.__rqRenderSessions();
        if (window.__rqIntro) { window.__rqIntro.remove(); window.__rqIntro = null; }
        warnSeatDiversity(result);
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
          trustPrefix = `◐ PROVISIONAL ${result.agreedCount}/${result.eligibleCount} (${(result.agreedNames || []).join(", ")}) — The bench agrees, but no primary voice has verified this yet. Spoken by ${result.speakerSeat} on behalf of the agreeing seats \u2014 this is one seat's wording, not a merge: `;
        } else if (result.trust === "verified") {
          trustPrefix = `✓ VERIFIED ${result.agreedCount}/${result.eligibleCount} (${(result.agreedNames || []).join(", ")}) — Everyone's on the same page for this one. Spoken by ${result.speakerSeat} on behalf of the agreeing seats \u2014 this is one seat's wording, not a merge: `;
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
      // v3.5.4: a note round and a roll call are not split decisions, and saying
      // so put DIVIDED-shaped language on rounds that were never in contention.
      consensusText.textContent = _noteRound
        ? "Noted \u2014 no question asked, so no verdict claimed. Each seat's acknowledgement:"
        : _indexicalRound
          ? "Roll call \u2014 each seat answers for itself. No consensus is claimed or possible here; three correct answers about three different subjects is not disagreement:"
          : "We have a split decision. They all took this in slightly different directions, so I'm stepping back to let you read their raw responses.";
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
      // v3.5.4: the non-speaking seats' answers used to vanish from the visible
      // record on a consensus round. They are the evidence for whether the
      // comparator was right to call it agreement.
      if (allAnswers.length > 1) {
        allAnswers.forEach((a) => logHistory(`${seatLabel(a.name)} raw position (${query})`, a.text));
      }
    }
    busy = false;
  }

  sendBtn.addEventListener("click", () => {
    const q = queryInput.value.trim();
    if (!q) return;
    queryInput.value = "";
    // v2.2 UI package (K3 Swarm spec §3). Setting .value in code does NOT fire an
    // input event, so ui-plus.js's char counter and auto-grow textarea would stay
    // frozen at the pre-send size after every dispatch. Harmless no-op when
    // ui-plus.js is absent — nothing is listening.
    try { queryInput.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
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
    // The flag lives in localStorage, which a hard cache clear wipes — and every
    // deploy here is followed by a hard clear. It has silently reverted to OFF
    // three separate times, each costing a debugging session, because nothing
    // announced it. State it at boot, next to the build stamp, every time.
    try {
      logError(vectorMemoryEnabled()
        ? "[EMBED] Vector memory is ON — rounds will be embedded and stored."
        : "[EMBED] Vector memory is OFF — rounds will NOT be embedded. Settings → VECTOR MEMORY to enable. (A hard cache clear resets this.)");
      // Spend state gets the same treatment as the flag that cost three
      // sessions: stated at boot, never assumed.
      if (settings.keyKimi) {
        logError(kimiK3Enabled()
          ? "[K3] Kimi seat is on kimi-k3 (PAID — this session spends Moonshot credits). Settings → KIMI SEAT to switch to free tier."
          : "[K3] Kimi seat is on the free tier (OpenRouter). No Moonshot spend. Settings → KIMI SEAT to enable K3.");
      }
      // Injection changes what the seats READ, so it gets the same boot line as
      // the flag that cost three debugging sessions by reverting silently.
      logError(injectionEnabled()
        ? "[INJECT] Stage 3 injection is ON — retrieved rounds will be placed in seat context. A/B rows this session record injected:true."
        : "[INJECT] Stage 3 injection is OFF — control arm. Settings → STAGE 3 INJECTION to enable.");
      // Catalog check moved forward to boot when a key exists. It used to fire on
      // first dispatch, fire-and-forget — which meant Edit 12's floor repair could
      // not land until AFTER that round had already walked a dead list. Still
      // fire-and-forget: advisory work must never delay a round or a page load.
      if (settings.keyOpenRouter && !catalogChecked) {
        catalogChecked = true;
        validateOrSeatModels().catch(() => {});
      }
    } catch (_) {}
  } catch (_) {}
})();
