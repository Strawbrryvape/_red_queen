// P7 F2 + F3 suite. Scoring math is lifted VERBATIM; the rest are shape
// assertions on the doctrine that the audit's five blockers were about —
// every one of those was an ABSENCE (a missing bound, a missing filter, a
// missing strip, a phantom accessor), which no behavioural test can see.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed: "+re);return m[0];};
eval(grab(/  function _cosine384\(a, b\) \{[\s\S]*?\n  \}/) + "\nglobalThis._cosine384=_cosine384;");
const RQ_PRED_SURPRISE = 0.7;
let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)+" want "+JSON.stringify(w)));};
const tt=(n,c)=>t(n,!!c,true);
const score=(sim)=>{const e=Math.round((1-sim)*1000)/1000;return{error:e,surprise:e>(1-RQ_PRED_SURPRISE)};};

console.log("\n--- F3 scoring: error is a DISTANCE, not a similarity ---");
t("identical => error 0, not surprise", score(1.0), {error:0,surprise:false});
t("orthogonal => error 1", score(0.0), {error:1,surprise:true});
t("opposite => error 2", score(-1.0), {error:2,surprise:true});
console.log("\n--- F3 surprise boundary (stated once, strictly greater) ---");
t("sim 0.700 => error 0.300 => NOT surprise", score(0.7), {error:0.3,surprise:false});
t("sim 0.699 => surprise", score(0.699).surprise, true);
t("sim 0.701 => not surprise", score(0.701).surprise, false);

console.log("\n--- F3 dense cosine (the sparse cosineVec is the wrong shape) ---");
const a=[1,0,0],b=[1,0,0],c=[0,1,0];
t("identical vectors => 1", Math.round(_cosine384(a,b)*1000)/1000, 1);
t("orthogonal => 0", _cosine384(a,c), 0);
t("zero vector never divides by zero", _cosine384([0,0,0],a), 0);

console.log("\n--- BLOCKER 5: control-byte strip on F3's own writes ---");
tt("_predStrip exists", /function _predStrip\(obj\)/.test(src));
tt("uses the same rqStripControls sbInsert uses", /_predStrip[\s\S]{0,400}rqStripControls/.test(src));
tt("insert body is stripped", /body: JSON\.stringify\(_predStrip\(obj\)\)/.test(src));
tt("PATCH body is stripped too", /body: JSON\.stringify\(_predStrip\(body\)\)/.test(src));

console.log("\n--- BLOCKER 3: no P7 writer can dilute the distress window ---");
tt("F2 vitals row is operation='consolidation'", /operation: "consolidation"/.test(src));
tt("F3 vitals row is operation='prediction_scoring'", /operation: "prediction_scoring"/.test(src));
tt("neither writes a distress_score",
   !/operation: "consolidation"[\s\S]{0,400}distress_score/.test(src) &&
   !/operation: "prediction_scoring"[\s\S]{0,400}distress_score/.test(src));
tt("F1 window filters to round rows only", /operation=eq\.round/.test(src));

console.log("\n--- BLOCKER 2: the Phase-A2 filter is BOUNDED ---");
const filt = src.slice(src.indexOf("async function filterConsolidatedFromRetrieval"), src.indexOf("async function consumeSelfPromptBanner"));
tt("carries its own Promise.race", /Promise\.race/.test(filt));
tt("bounded by RQ_CONS_FILTER_TIMEOUT_MS", /RQ_CONS_FILTER_TIMEOUT_MS/.test(filt));
tt("timeout fails OPEN (returns the unfiltered shape)", /__timeout__[\s\S]{0,400}return shaped/.test(filt));
tt("flag off returns immediately", /!consFilterEnabled\(\)[\s\S]{0,40}return shaped/.test(filt));

console.log("\n--- BLOCKER 1: F2 reads the Governor only through the frozen accessor ---");
const spb = src.slice(src.indexOf("async function consumeSelfPromptBanner"), src.indexOf("window.__rqConsolidationKick"));
tt("uses window.__rqGovernorMode()", /window\.__rqGovernorMode\(\)/.test(spb));
tt("compares to 'distress', not 'red'", /=== "distress"/.test(spb) && !/=== "red"/.test(spb));
tt("never touches F1 internals", !/_govMode/.test(spb));

console.log("\n--- BLOCKER 4 / queue coexistence: prefix-scoped dedup ---");
tt("F3 dedups on its EXACT prompt", /prompt=eq\." \+ encodeURIComponent\(qPrompt\)/.test(src));
tt("F3's prompt prefix is SURPRISE AUDIT", /"SURPRISE AUDIT: "/.test(src));

console.log("\n--- ADVISORY 9: no stale-round misattribution ---");
tt("listener gate matches the collection gate", /predictionsEnabled\(\) && !_noteRound && !_indexicalRound &&/.test(src));
tt("stale _predRoundId is expired", /_predRoundId !== dispatchId[\s\S]{0,400}_predRoundId = null/.test(src));
// v4.0.1 reshaped this block (a roundPrompt capture now sits between the read
// and the clear). Assert the PROPERTY rather than the exact two lines: both
// module vars are read into locals and nulled at entry, before any await.
// Window must EXTEND PAST the first await, or the ordering check has nothing to
// compare against (the first version sliced up TO it and always failed).
const _fnStart = src.indexOf("async function scorePredictionsClient");
const scoreHead = src.slice(_fnStart, _fnStart + 3000);
const _firstAwait = scoreHead.indexOf("await ");
tt("scoring reads and clears _predRoundId at entry, before any await",
   /const roundId = _predRoundId;/.test(scoreHead) && /_predRoundId = null;/.test(scoreHead) &&
   _firstAwait > -1 && scoreHead.indexOf("_predRoundId = null;") < _firstAwait);
tt("the round prompt is captured and cleared the same way",
   /const roundPrompt = _predRoundPrompt;/.test(scoreHead) && /_predRoundPrompt = null;/.test(scoreHead));
tt("the audit prompt carries a referent (round id + question + magnitude)",
   /SURPRISE AUDIT: " \+ row\.seat_name \+ " seat, round " \+ roundId/.test(src) &&
   /clip\(String\(roundPrompt/.test(src) && /errorScore \+/.test(src));
// v4.0.2 REPLACES this assertion rather than dropping it. The old invariant
// ("no prediction text in the queue prompt") was deliberately broken on the
// operator's direction, so the guard MOVES to the risk that now matters: the
// evidence may be read once, but must never become retrievable memory.
tt("audit prompt now carries the verbatim evidence (intended deviation)",
   /WHAT YOU PREDICTED \(verbatim\)/.test(src) && /WHAT YOU ACTUALLY ANSWERED/.test(src));
tt("CONTAINMENT: audit rounds are excluded from the embedding corpus",
   /\/\^SURPRISE AUDIT:\/\.test\(String\(prompt/.test(src));
tt("that exclusion is unconditional — ahead of the episodic mode check",
   src.indexOf('if (/^SURPRISE AUDIT:/.test(String(prompt') <
   src.indexOf('const mode = episodicFilterMode();\n    if (mode === "off") return true;'));
tt("the prompt tells the seat the evidence is injected, not remembered",
   /OPERATOR-INJECTED evidence/.test(src) && /not as something you remember/.test(src));
tt("and names the artifact reading as a legitimate answer",
   /MEASUREMENT ARTIFACT rather than a miss/.test(src));

console.log("\n--- ADVISORY 10: endogenous marker survives a governor veto ---");
tt("marker read lands AFTER the gate",
   src.indexOf("const _gov = await governorCheck()") < src.indexOf("const _endogenous = (_rqEndogenousPrompt"));
tt("ledger key is an additive spread (still absent when the path never fires)",
   /\.\.\.\(_endogenous \? \{ endogenous: true, provenance: _endogenousKind \} : \{\}\)/.test(src));
tt("provenance distinguishes audit from reconciliation from plain endogenous",
   /OPERATOR-INJECTED-AUDIT/.test(src) && /OPERATOR-INJECTED-RECONCILIATION/.test(src));

console.log("\n--- R-P7-3 cost consent / R-P7-11 never-does ---");
tt("predictions never awaited in dispatch", !/await collectPredictions/.test(src));
// Scope to the FUNCTION BODY. The first version of this assertion matched the
// dispatch-hook call site instead and reported a leak that did not exist —
// the window ran into dispatch's own memory assembly. Fixed by extraction.
const predBody = grab(/  function collectPredictions\(dispatchId, seats, prompt\) \{[\s\S]*?\n  \}\n/);
tt("prediction prompt body carries no memory/ledger/identity content",
   !/buildMemoryContext|_vectorBlock|composedQuery|SEAT_IDENTITY|ledger/.test(predBody));
tt("the hook passes the RAW query, not the composed prompt",
   /collectPredictions\(dispatchId, predictionSeats\(\), query\)/.test(src));
tt("exactly one call per seat: no failover walk in predictionSeats",
   !/predictionSeats[\s\S]{0,900}tripCircuit/.test(src));
tt("self-prompt Inject never dispatches", /NEVER auto-dispatched/.test(src));
tt("all four P7 flags default OFF (=== \"on\" semantics)",
   (src.match(/localStorage\.getItem\("rq_(governor|consolidation|consolidation_filter|predictions)"\) === "on"/g)||[]).length === 4);
tt("no supabase-js in the client", !/createClient\(/.test(src));
tt("no service-role literal in the client", !/SERVICE_ROLE/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
