// P7 F1 Governor — logic + shape suite. computeDistress is lifted VERBATIM
// from app.js; the rest are shape assertions, because the doctrine failures
// this feature can have (a missing fail-open exit, a raw RQ_TOP_K site) are
// absences, which behaviour tests cannot see.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const L=src.split("\n");
const grab = (re) => { const m = src.match(re); if (!m) throw new Error("lift failed: " + re); return m[0]; };
const consts = grab(/  const RQ_GOV_TIMEOUT_MS[\s\S]*?FINAL DIRECTIVE required\.";/);
const fn = grab(/  function computeDistress\(v, malformedNames\) \{[\s\S]*?\n  \}/);
eval(consts + "\n" + fn + "\nglobalThis.computeDistress=computeDistress;globalThis.RQ_GOV_RED=RQ_GOV_RED;globalThis.RQ_GOV_YELLOW=RQ_GOV_YELLOW;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)+" want "+JSON.stringify(w)));};
const tt=(n,c)=>t(n,!!c,true);

console.log("\n--- computeDistress (R-P7-7 reweight rule) ---");
t("healthy round scores 0", computeDistress({fallback_used:false,edge_errors:0,latency_ms:3000,seat_health:{gemini:"live",kimi:"live",claude:"live"}},[]), 0);
t("fallback alone = 0.3", computeDistress({fallback_used:true,edge_errors:0,seat_health:{}},[]), 0.3);
t("one seat down alone = 0.25", computeDistress({fallback_used:false,edge_errors:0,seat_health:{gemini:"down",kimi:"live"}},[]), 0.25);
t("slow round alone = 0.2", computeDistress({fallback_used:false,edge_errors:0,latency_ms:15000,seat_health:{}},[]), 0.2);
t("edge errors scale linearly", computeDistress({fallback_used:false,edge_errors:2,seat_health:{}},[]), 0.4);
t("capped at 1.0", computeDistress({fallback_used:true,edge_errors:9,latency_ms:99999,seat_health:{a:"down"}},[]), 1);

console.log("\n--- the reweight rule: unavailable signals contribute ZERO ---");
t("no seat_health => seat signal absent, not guessed", computeDistress({fallback_used:false,edge_errors:0,seat_health:{}},[]), 0);
t("latency absent => no latency weight", computeDistress({fallback_used:false,edge_errors:0,seat_health:{}},[]), 0);
t("queue never fires without queue_available", computeDistress({fallback_used:false,edge_errors:0,retrieval_queue_depth:500,seat_health:{}},[]), 0);
t("queue fires only on explicit availability", computeDistress({fallback_used:false,edge_errors:0,queue_available:true,retrieval_queue_depth:500,seat_health:{}},[]), 0.15);

console.log("\n--- malformed side channel (health map stays honest) ---");
t("malformed-but-live counts degraded for the SCORE", computeDistress({fallback_used:false,edge_errors:0,seat_health:{kimi:"live"}},["kimi"]), 0.25);
t("malformed on an already-degraded seat does not double-count", computeDistress({fallback_used:false,edge_errors:0,seat_health:{kimi:"down"}},["kimi"]), 0.25);

console.log("\n--- the real 2026-08-07 rounds, replayed ---");
// Claude on openrouter t2, Gemini on cerebras t1, Kimi primary, 1 adjudication unavailable.
const real = computeDistress({fallback_used:true,edge_errors:1,latency_ms:65000,
  seat_health:{gemini:"fallback",kimi:"live",claude:"fallback"}},[]);
t("degraded-roster round lands in the red band", real >= RQ_GOV_RED, true);
console.log("        (computed " + real + " vs red " + RQ_GOV_RED + ")");

console.log("\n--- shape: fail-open doctrine (R-P7-2) ---");
const gc = src.slice(src.indexOf("async function governorCheck()"), src.indexOf("async function applyGovernorMode"));
tt("flag-off exits before any network", gc.indexOf("!governorEnabled()") < gc.indexOf("fetch("));
tt("timeout exit returns proceed:true", /__timeout__[\s\S]{0,400}proceed: true/.test(gc));
tt("http-error exit returns proceed:true", /res\.err\) return \{ proceed: true/.test(gc));
tt("empty window returns proceed:true", /!scores\.length[\s\S]{0,120}proceed: true/.test(gc));
tt("window is session-scoped", /session_id=eq\./.test(gc));
tt("BLOCKER 3 closed: server filters operation=eq.round", /operation=eq\.round/.test(gc));
tt("BLOCKER 3 closed: client also drops null distress rows", /distress_score !== null/.test(gc));
tt("race is capped by RQ_GOV_TIMEOUT_MS", /Promise\.race\([\s\S]{0,200}RQ_GOV_TIMEOUT_MS/.test(gc));

console.log("\n--- shape: cross-spec contract (BLOCKER 1) ---");
tt("accessor is defined", /window\.__rqGovernorMode = function/.test(src));
tt("domain is normal|caution|distress", /"normal" \| "caution" \| "distress"/.test(src));
tt("literal 'red' never used as a mode", !/_govMode === "red"|=== "red"/.test(src));

console.log("\n--- shape: knobs are real, and complete ---");
tt("no raw RQ_TOP_K consumption site survives",
   L.filter(l=>/RQ_TOP_K/.test(l) && !/const RQ_TOP_K|govTopK|\/\/|TOP_K " \+/.test(l)).length === 0);
tt("all three TOP_K sites use govTopK()", (src.match(/govTopK\(\)/g)||[]).length >= 4);
tt("budgets halve behind the same var", /_govInjectHalf \? RQ_GOV_INJECT_FRAC : 1/.test(src));
tt("P3 skip is one-cycle consume", /_govSkipP3Next = false;   \/\/ one-cycle consume/.test(src));
tt("adjudication-unavailable is counted", /_govAdjUnavailable\+\+/.test(src));
tt("counter resets per round", /_govAdjUnavailable = 0;/.test(src));

console.log("\n--- shape: never-does (R-P7-11) ---");
tt("no supabase-js SDK", !/from ['"]@supabase/.test(src) && !/createClient\(/.test(src));
tt("no service-role key anywhere", !/SERVICE_ROLE/.test(src));
tt("rqModal gets a static literal only", /rqModal\("<h3>System under stress<\/h3><p><\/p>"\)/.test(src));
tt("modal failure resolves proceed:true", /catch \(_\) \{ finish\(\{ proceed: true \}\); \}/.test(src));
tt("repair pre-fills, never dispatches", /NEVER auto-dispatched/.test(src) && !/repair[\s\S]{0,300}dispatch\(/.test(src));
tt("vitals write is not awaited in dispatch", !/await recordVitals/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
