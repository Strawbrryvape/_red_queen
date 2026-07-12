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
  demoToggle.checked = !!settings.demoMode;

  function hasAnyKey() {
    return !!(settings.keyGemini || settings.keyKimi || settings.keyClaude || settings.keyGroq);
  }
  function inDemoMode() {
    return settings.demoMode || !hasAnyKey();
  }
  function refreshDemoBadge() {
    demoBadge.classList.toggle("hidden", !inDemoMode());
  }
  refreshDemoBadge();

  // ---------- Understudy state (Groq filling Claude's seat) ----------
  function groqUnderstudy() {
    return !settings.keyClaude && !!settings.keyGroq;
  }
  function seatLabel(name) {
    if (name === "claude" && groqUnderstudy()) return "Claude [Groq understudy: Llama 3.3]";
    return name[0].toUpperCase() + name.slice(1);
  }
  function refreshUnderstudyState() {
    const el = agents.claude;
    if (groqUnderstudy()) {
      el.classList.add("understudy");
      el.title = "Claude seat — powered by Groq (Llama 3.3)";
    } else {
      el.classList.remove("understudy");
      el.removeAttribute("title");
    }
  }
  refreshUnderstudyState();

  saveSettingsBtn.addEventListener("click", () => {
    settings = {
      keyGemini: $("keyGemini").value.trim(),
      keyKimi: $("keyKimi").value.trim(),
      keyClaude: $("keyClaude").value.trim(),
      keyGroq: $("keyGroq").value.trim(),
      demoMode: demoToggle.checked,
    };
    saveSettings(settings);
    refreshDemoBadge();
    refreshUnderstudyState();

  // ---------- Understudy state (Groq filling Claude's seat) ----------
  function groqUnderstudy() {
    return !settings.keyClaude && !!settings.keyGroq;
  }
  function seatLabel(name) {
    if (name === "claude" && groqUnderstudy()) return "Claude [Groq understudy: Llama 3.3]";
    return name[0].toUpperCase() + name.slice(1);
  }
  function refreshUnderstudyState() {
    const el = agents.claude;
    if (groqUnderstudy()) {
      el.classList.add("understudy");
      el.title = "Claude seat — powered by Groq (Llama 3.3)";
    } else {
      el.classList.remove("understudy");
      el.removeAttribute("title");
    }
  }
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
          generationConfig: { maxOutputTokens: 300 },
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
        max_tokens: 300,
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
        max_tokens: 300,
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

  function tokenize(text) {
    return new Set(
      text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w))
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

  function checkConsensus(answers) {
    // each answer must agree with at least one other above threshold
    if (answers.length < 2) return { agreed: answers, outliers: [] };
    const agreed = [], outliers = [];
    answers.forEach((a, i) => {
      const hasAlly = answers.some((b, j) => i !== j && similarity(a.text, b.text) >= AGREEMENT_THRESHOLD);
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
        max_tokens: 300,
      }),
    }, "Groq");
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}${res.status === 429 ? " — free-tier rate limit; circuit breaker will manage" : ""}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  async function runLiveCouncil(query) {
    const calls = [];
    if (settings.keyGemini) calls.push({ name: "gemini", fn: callGemini });
    if (settings.keyKimi) calls.push({ name: "kimi", fn: callKimi });
    if (settings.keyClaude) {
      calls.push({ name: "claude", fn: callClaude });
    } else if (settings.keyGroq) {
      calls.push({ name: "claude", fn: callGroq }); // Groq understudies Claude's seat (free tier)
    }

    // circuit breaker: skip agents whose quota circuit is open
    const skipped = calls.filter((c) => circuitOpen(c.name));
    skipped.forEach((c) => {
      const secs = Math.round((circuits[c.name].openUntil - Date.now()) / 1000);
      logError(`${c.name[0].toUpperCase() + c.name.slice(1)} skipped — circuit open for ${secs}s more.`);
    });
    const active = calls.filter((c) => !circuitOpen(c.name));
    if (active.length === 0) {
      logError("All agent circuits open — quotas exhausted. Falling back to demo until cooldowns expire.");
      return null;
    }
    calls.length = 0;
    calls.push(...active);

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
        resetCircuit(name);
      } else {
        const msg = r.reason?.message || "unknown error";
        logError(`${seatLabel(name)} failed: ${msg}`);
        if (msg.includes("429")) tripCircuit(name, fetchWithRetry.lastRetryAfterMs);
      }
      agents[name].classList.remove("thinking");
    });

    if (answers.length === 0) return null; // triggers demo fallback

    if (answers.length === 1) return { text: answers[0].text.trim(), divided: false, answers };

    const { agreed, outliers } = checkConsensus(answers);

    if (agreed.length < 2) {
      // No consensus — by design, Red Queen declines to force an answer
      logError(`Consensus round FAILED by design — ${answers.length} agents, 0 agreements above threshold. Individual positions logged to Session History.`);
      return { text: null, divided: true, answers };
    }

    if (outliers.length > 0) {
      outliers.forEach((o) =>
        logError(`${seatLabel(o.name)} excluded as outlier — position diverged from majority.`)
      );
    }

    // synthesis among agreeing agents: shortest coherent answer wins
    agreed.sort((a, b) => a.text.length - b.text.length);
    return { text: agreed[0].text.trim(), divided: false, answers };
  }

  // ---------- Dispatch ----------
  let busy = false;

  async function dispatch(query) {
    if (busy) return;
    busy = true;

    consensusBar.classList.remove("is-empty");
    consensusBar.classList.add("loading");
    consensusText.textContent = "The Council is deliberating…";
    consensusText.style.fontStyle = "italic";
    consensusText.style.color = "#888";

    let answer = null;
    let divided = false;
    let allAnswers = [];

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
      consensusText.textContent = "The Council is divided — no consensus reached.";
      allAnswers.forEach((a) =>
        logHistory(`${seatLabel(a.name)} position (${query})`, a.text)
      );
      logHistory(query, "NO CONSENSUS — Council divided by design. Individual positions above.");
    } else {
      flashConsensus();
      consensusText.textContent = answer;
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
    consensusBar.classList.add("is-empty");
    consensusBar.classList.remove("loading");
    historyList.innerHTML = '<li class="empty-note">No queries yet this session.</li>';
    errorList.innerHTML = '<li class="empty-note">No errors logged.</li>';
    Object.values(agents).forEach((a) => a.classList.remove("thinking", "consensus"));
    closeDrawer();
  });
})();
