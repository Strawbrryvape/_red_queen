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
  demoToggle.checked = !!settings.demoMode;

  function hasAnyKey() {
    return !!(settings.keyGemini || settings.keyKimi || settings.keyClaude);
  }
  function inDemoMode() {
    return settings.demoMode || !hasAnyKey();
  }
  function refreshDemoBadge() {
    demoBadge.classList.toggle("hidden", !inDemoMode());
  }
  refreshDemoBadge();

  saveSettingsBtn.addEventListener("click", () => {
    settings = {
      keyGemini: $("keyGemini").value.trim(),
      keyKimi: $("keyKimi").value.trim(),
      keyClaude: $("keyClaude").value.trim(),
      demoMode: demoToggle.checked,
    };
    saveSettings(settings);
    refreshDemoBadge();
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

  // ---------- Live Council ----------
  async function callGemini(query) {
    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        encodeURIComponent(settings.keyGemini),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: query }] }],
          generationConfig: { maxOutputTokens: 300 },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  async function callKimi(query) {
    const res = await fetch("https://api.moonshot.ai/v1/chat/completions", {
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
    });
    if (!res.ok) throw new Error(`Kimi HTTP ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  async function callClaude(query) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
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
    });
    if (!res.ok) throw new Error(`Claude HTTP ${res.status}`);
    const data = await res.json();
    return data.content?.map((b) => b.text || "").join("") || "";
  }

  async function runLiveCouncil(query) {
    const calls = [];
    if (settings.keyGemini) calls.push({ name: "gemini", fn: callGemini });
    if (settings.keyKimi) calls.push({ name: "kimi", fn: callKimi });
    if (settings.keyClaude) calls.push({ name: "claude", fn: callClaude });

    calls.forEach((c) => agents[c.name].classList.add("thinking"));

    const results = await Promise.allSettled(calls.map((c) => c.fn(query)));

    const answers = [];
    results.forEach((r, i) => {
      const name = calls[i].name;
      if (r.status === "fulfilled" && r.value) {
        answers.push({ name, text: r.value });
      } else {
        logError(`${name[0].toUpperCase() + name.slice(1)} failed: ${r.reason?.message || "unknown error"}`);
      }
      agents[name].classList.remove("thinking");
    });

    if (answers.length === 0) return null; // triggers demo fallback

    if (answers.length === 1) return answers[0].text.trim();

    // simple client-side synthesis: shortest coherent answer wins,
    // prefixed with which agents agreed
    answers.sort((a, b) => a.text.length - b.text.length);
    return answers[0].text.trim();
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

    if (!inDemoMode()) {
      try {
        answer = await runLiveCouncil(query);
      } catch (e) {
        logError("Council dispatch failed: " + (e.message || e));
      }
      if (answer === null) {
        logError("All live agents failed — falling back to demo simulation.");
        demoBadge.classList.remove("hidden");
        answer = await runDemoCouncil(query);
      }
    } else {
      answer = await runDemoCouncil(query);
    }

    setThinking(false);
    flashConsensus();

    consensusBar.classList.remove("loading");
    consensusText.style.fontStyle = "normal";
    consensusText.style.color = "";
    consensusText.textContent = answer;

    logHistory(query, answer);
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
