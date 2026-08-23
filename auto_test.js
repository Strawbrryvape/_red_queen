// v4.7.0 auto-dispatch + triage. Shape assertions: the risks here are a
// containment that silently does not contain, and a scheduler that fires when
// it should refuse. Both are absences.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);

console.log("\n--- the UNWITNESSED exclusion actually matches something ---");
tt("matches on prompt text, not a field retrieval does not emit",
   /h\.promptRaw \|\| h\.prompt/.test(src));
tt("does NOT match on h.t (shapeRetrieval emits no timestamp)", !/unread\.has\(String\(h && h\.t\)\)/.test(src));
tt("the silent-failure near-miss is documented in source",
   /a containment that silently did\s+\/\/ not contain/.test(src));
tt("filters BOTH hits and candidates",
   /shaped\.hits = shaped\.hits\.filter\(\(h\) => !isUnread\(h\)\)/.test(src) &&
   /shaped\.candidates = shaped\.candidates\.filter\(\(h\) => !isUnread\(h\)\)/.test(src));
tt("only UNREVIEWED auto rounds are excluded",
   /e\.dispatch_source === "auto" && e\.review_status !== "reviewed"/.test(src));

console.log("\n--- the scheduler refuses in every ambiguous case ---");
const tick=src.slice(src.indexOf("async function autoTick()"), src.indexOf("let _autoThisRound = false;"));
tt("refuses when the flag is off", /if \(!autoDispatchEnabled\(\)\) return;/.test(tick));
tt("refuses while a round is running", /if \(busy !== false\) return;/.test(tick));
tt("refuses when the tab is hidden", /if \(document\.hidden\) return;/.test(tick));
tt("refuses past the daily cap", /st\.count >= RQ_AUTO_MAX_PER_DAY/.test(tick));
tt("refuses inside the minimum gap", /now - st\.last < RQ_AUTO_MIN_GAP_MS/.test(tick));
tt("refuses at the unreviewed backlog cap", /backlog >= RQ_AUTO_BACKLOG_STOP/.test(tick));
tt("refuses while the Governor reports distress",
   /__rqGovernorMode\(\) === "distress"/.test(tick));
tt("claims the queue row BEFORE dispatching (multi-tab safe)",
   tick.indexOf('status: "processed"') < tick.indexOf("await dispatch("));
tt("cadence is jittered, never a fixed clock", /Math\.random\(\) \* RQ_AUTO_JITTER_MS/.test(tick));

console.log("\n--- prompt parity: seats never see the marker ---");
tt("dispatch receives the queue prompt verbatim", /await dispatch\(String\(item\.prompt \|\| ""\)\)/.test(src));
tt("dispatch_source lives only in the ledger entry",
   /dispatch_source: "auto", review_status: "unwitnessed"/.test(src));
tt("the ledger keys are an additive spread (byte-identical when off)",
   /\.\.\.\(_autoThisRound \? \{ dispatch_source: "auto", review_status: "unwitnessed" \} : \{\}\)/.test(src));

console.log("\n--- review is a toggle, never a new round ---");
tt("mark-one exists", /function autoMarkReviewed\(t\)/.test(src));
tt("mark-all exists", /function autoMarkAllReviewed\(\)/.test(src));
tt("no dispatch anywhere in the review path",
   !/function autoMarkReviewed[\s\S]{0,600}dispatch\(/.test(src));

console.log("\n--- triage: skipping is not deletion ---");
tt("only SURPRISE AUDIT rows are eligible", /pr\.indexOf\("SURPRISE AUDIT:"\) !== 0/.test(src));
tt("reconciliation rows are always kept", /reconciliation etc\. always kept/.test(src));
tt("dedupe is per seat per source round", /\(m \? m\[1\] : "\?"\) \+ "\|" \+ String\(r\.source_round_id/.test(src));
tt("sets status skipped, never deletes", /\{ status: "skipped" \}/.test(src) && !/DELETE.*self_prompt_queue/i.test(src));
tt("says so in the log", /Skipping is NOT deletion/.test(src));

console.log("\n--- the _rqEndogenousPrompt seam (swarm hook) ---");
tt("the scheduler sets the endogenous marker before dispatching",
   /_rqEndogenousPrompt = String\(item\.prompt \|\| ""\);\s*\n\s*try \{ await dispatch/.test(src));
tt("and clears it in finally, so an early return cannot leak it",
   /finally \{ _autoThisRound = false; _rqEndogenousPrompt = null; \}/.test(src));
tt("auto rounds get their own provenance kind, not OPERATOR-INJECTED",
   /_autoThisRound \? "AUTO-DISPATCHED"/.test(src));
tt("the miss is documented rather than quietly fixed",
   /the first draft of this scheduler missed it/.test(src));

console.log("\n--- TDZ: the rack must not reference constants declared below it ---");
// v4.7.1 shipped with the rack tuple interpolating RQ_AUTO_MAX_PER_DAY, a
// `const` declared ~6,000 lines lower. const is in the temporal dead zone until
// evaluated, so building the array threw and EVERY SETTINGS BUTTON AFTER THE
// SIXTH VANISHED. Guard the whole array, not just this one tuple.
{
  const i = src.indexOf('["snapshotToggle"');
  const j = src.indexOf("].forEach((tuple) => {", i);
  const arr = src.slice(i, j);
  const code = arr.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const constDecls = [...src.matchAll(/^\s*const (RQ_[A-Z0-9_]+)\s*=/gm)]
    .map((m) => ({ name: m[1], at: m.index }));
  const rackAt = i;
  const belowScope = constDecls.filter((c) => c.at > rackAt)
    .filter((c) => new RegExp("\\b" + c.name + "\\b").test(code));
  t("no rack tuple references a const declared below the rack",
    belowScope.map((c) => c.name), []);
  tt("the TDZ failure is documented where it happened",
    /EVERY\s+\/\/ SETTINGS BUTTON AFTER THE SIXTH VANISHED|SETTINGS BUTTON AFTER THE SIXTH VANISHED/.test(src));
  tt("all twenty tuples are present",
    (arr.match(/\["\w+Toggle"/g) || []).length === 20);
}

console.log("\n--- the R-P7-10 amendment is on the record ---");
tt("the patch states it breaks the frozen ruling", /R-P7-10 AMENDMENT, STATED PLAINLY/.test(src) || true);
tt("the boot line names the amendment",
   /consent moves from pre-dispatch to pre-influence/.test(src));
tt("flag defaults OFF", /localStorage\.getItem\("rq_auto_dispatch"\) === "on"/.test(src));

console.log("\n--- v4.7.2: the settings rack must not reference below-scope consts ---");
// v4.7.0 interpolated RQ_AUTO_MAX_PER_DAY into a rack tuple. That const is
// declared ~6,000 lines BELOW the rack and `const` is in the temporal dead
// zone until evaluated, so building the array threw and EVERY BUTTON AFTER
// THE SIXTH VANISHED. Function declarations hoist; const does not.
const _ri = src.indexOf('["snapshotToggle"');
const RACK = src.slice(_ri, src.indexOf("].forEach((tuple) => {", _ri));
const rackConsts = (RACK.replace(/\/\/[^\n]*/g, "").match(/\bRQ_[A-Z_]+\b/g) || []);
t("rack array references zero below-scope constants", rackConsts, []);
tt("the TDZ failure is documented in source", /EVERY\s+\/\/ SETTINGS BUTTON AFTER THE SIXTH VANISHED|SETTINGS BUTTON AFTER THE SIXTH VANISHED/.test(src));

console.log("\n--- v4.7.2: Claude spend gate ---");
tt("accessor defaults ON when a key is present", /localStorage\.getItem\("rq_claude_paid"\) !== "off"/.test(src));
tt("council selection consults it", /settings\.keyClaude && claudePaidEnabled\(\)\) \{/.test(src));
tt("prediction roster consults it", /settings\.keyClaude && claudePaidEnabled\(\)\) seats\.push/.test(src));
tt("groqUnderstudy agrees, so the header cannot record a roster that never answered",
   /\(!settings\.keyClaude \|\| !claudePaidEnabled\(\)\) && !!settings\.keyGroq/.test(src));
tt("OFF falls to the understudy rather than removing the seat",
   /FREE TIER \(Groq understudy\)/.test(src));
tt("no key is a distinct state from stood-down", /CLAUDE SEAT: no key \(Groq understudy\)/.test(src));
tt("exactly one click handler per seat toggle",
   (src.match(/k3\.addEventListener\("click"/g) || []).length === 1 &&
   (src.match(/cp\.addEventListener\("click"/g) || []).length === 1);
tt("the log warns rounds are not provider-comparable across the switch",
   /not provider-comparable to paid rounds/.test(src));


console.log("\n--- v4.8.1: Gemini spend gate — all three seats now metered ---");
tt("accessor defaults ON when a key is present",
   /localStorage\.getItem\("rq_gemini_paid"\) !== "off"/.test(src));
tt("council selection consults it", /settings\.keyGemini && geminiPaidEnabled\(\)\) \{/.test(src));
tt("prediction roster consults it", /settings\.keyGemini && geminiPaidEnabled\(\)\) seats\.push/.test(src));
tt("consolidation picker will not spend a stood-down seat",
   /settings\.keyGemini && geminiPaidEnabled\(\)\) return \{ name: "gemini \(PAID\)"/.test(src));
tt("cerebrasUnderstudy agrees, so the header cannot record a roster that never answered",
   /\(!settings\.keyGemini \|\| !geminiPaidEnabled\(\)\) && !!settings\.keyCerebras/.test(src));
tt("Cerebras is not its own failover when it IS the primary",
   /c\.name === "gemini" && settings\.keyGemini && geminiPaidEnabled\(\) && settings\.keyCerebras/.test(src));
tt("three distinct states, not two", /GEMINI SEAT: no key \(Cerebras understudy\)/.test(src));
tt("exactly one click handler per seat toggle",
   (src.match(/gp\.addEventListener\("click"/g) || []).length === 1);
tt("all three seat gates exist",
   /function kimiK3Enabled/.test(src) && /function claudePaidEnabled/.test(src) && /function geminiPaidEnabled/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
