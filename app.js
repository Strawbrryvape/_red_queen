/* Red Queen v2.1 — Command Center logic
   Demo mode: if no API keys are saved (or Demo Mode is toggled on, or all live
   calls fail), the Council is simulated locally. The UI never shows an error
   box on the main canvas — failures are logged quietly to the drawer. */

(function () {
  "use strict";

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
  }

  saveSettingsBtn.addEventListener("click", () => {
    settings = {
      keyGemini: $("keyGemini").value.trim(),
      keyKimi: $("keyKimi").value.trim(),
      keyClaude: $("keyClaude").value.trim(),
      keyGroq: $("keyGroq").value.trim(),
      keyOpenRouter: $("keyOpenRouter").value.trim(),
      keyCerebras: keyCerebrasEl ? keyCerebrasEl.value.trim() : (settings.keyCerebras || ""),
      demoMode: demoToggle.checked,
    };
    saveSettings(settings);
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

  function tokenize(text) {
    return new Set(
      text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
        .map(stem)
    );
  }

  function similarity(a, b) {
    const A = tokenize(a), B = tokenize(b);
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    A.forEach((w) => { if (B.has(w)) inter++; });
    return inter / (A.size + B.size - inter); // Jaccard index
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
  function extractDirective(text) {
    const m = text.match(DIRECTIVE_ANCHOR);
    return m ? m[1].trim() : null;
  }

  function pairSimilarity(a, b) {
    const da = extractDirective(a), db = extractDirective(b);
    if (da && db) return similarity(da, db);
    return similarity(a, b);
  }

  function checkConsensus(answers) {
    // each answer must agree with at least one other above threshold
    if (answers.length < 2) return { agreed: answers, outliers: [] };
    const anchored = answers.filter((a) => extractDirective(a.text)).length;
    if (anchored >= 2) {
      logError(`Consensus check using FINAL DIRECTIVE anchors (${anchored}/${answers.length} answers anchored).`);
    }
    const agreed = [], outliers = [];
    answers.forEach((a, i) => {
      const hasAlly = answers.some((b, j) => i !== j && pairSimilarity(a.text, b.text) >= AGREEMENT_THRESHOLD);
      (hasAlly ? agreed : outliers).push(a);
    });
    return { agreed, outliers };
  }

  async function callGroq(query) {
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
    const res = await fetchWithRetry("https://api.cerebras.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.keyCerebras,
      },
      body: JSON.stringify({
        model: CEREBRAS_MODEL,
        messages: [{ role: "user", content: query }],
        max_tokens: MAX_TOKENS,
      }),
    }, "Cerebras");
    if (res.status === 404) throw new Error(`Cerebras model ${CEREBRAS_MODEL} unavailable (404) — free catalog churned; swap CEREBRAS_MODEL for a current model from cloud.cerebras.ai`);
    if (!res.ok) throw new Error(`Cerebras HTTP ${res.status}${res.status === 429 ? " — free-tier rate limit; circuit breaker will manage" : ""}`);
    const data = await res.json();
    let text = data.choices?.[0]?.message?.content || "";
    // Reasoning models (GLM, Qwen) may wrap chain-of-thought in <think>
    // tags — strip it so only the final answer reaches consensus scoring.
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
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
  const OR_SEAT_MODELS = {
    gemini: ["openai/gpt-oss-120b:free"],
    kimi:   ["google/gemma-4-31b-it:free", "nvidia/nemotron-3-super-120b-a12b:free"],
    claude: ["nvidia/nemotron-3-super-120b-a12b:free", "google/gemma-4-31b-it:free"],
  };
  const orActiveModel = {}; // seat -> slug currently answering (labels/visuals)

  function orShort(slug) {
    return (slug || "").split("/").pop().replace(":free", "").split("-")[0];
  }

  let orQueue = Promise.resolve();
  function serializeOR(fn) {
    const run = orQueue.then(fn, fn);
    orQueue = run.catch(() => {});
    return run;
  }

  async function callOpenRouter(query, seatName) {
    return serializeOR(() => callOpenRouterWalk(query, seatName));
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
    const res = await fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.keyOpenRouter,
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: query }],
        max_tokens: MAX_TOKENS,
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
    return content;
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

    const orAvailable = !!settings.keyOpenRouter;

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
        answers.push({ name, text: r.value });
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
    if (agreed.length < 2) {
      // No consensus — by design, Red Queen declines to force an answer
      logError(`Consensus round FAILED by design — ${eligible.length} eligible agents, 0 agreements above threshold. Individual positions logged to Session History.`);
      return { text: null, divided: true, answers };
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
      p.textContent = a.text;
      card.appendChild(h);
      card.appendChild(p);
      panel.appendChild(card);
    });
    panel.classList.add("active");
  }

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
      try {
        result = await runLiveCouncil(query);
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
        // Trust-state prefix (v2.4): the bar itself carries the verification
        // level — a sole understudy's opinion must never wear the Council's
        // crown unmarked. "Always check the error logs" — founder, 2026-07-12.
        if (result.trust === "sole") {
          trustPrefix = "⚠ SOLE VOICE (unverified) — ";
        } else if (result.trust === "provisional") {
          trustPrefix = `◐ PROVISIONAL ${result.agreedCount}/${result.eligibleCount} — `;
        } else if (result.trust === "verified") {
          trustPrefix = `✓ VERIFIED ${result.agreedCount}/${result.eligibleCount} — `;
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
      consensusText.textContent = "The Council is divided — no consensus reached. Positions below.";
      renderDividedPanel(allAnswers);
      allAnswers.forEach((a) =>
        logHistory(`${seatLabel(a.name)} position (${query})`, a.text)
      );
      logHistory(query, "NO CONSENSUS — Council divided by design. Individual positions above.");
    } else {
      flashConsensus();
      consensusText.textContent = trustPrefix + answer;
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
    consensusBar.classList.add("is-empty");
    consensusBar.classList.remove("loading");
    historyList.innerHTML = '<li class="empty-note">No queries yet this session.</li>';
    errorList.innerHTML = '<li class="empty-note">No errors logged.</li>';
    Object.values(agents).forEach((a) => a.classList.remove("thinking", "consensus"));
    closeDrawer();
  });
})();
