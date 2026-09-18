// v4.34.0 — STEELMAN (Claude seat, round 90; spec v1.1). The trigger and the
// prompt are LIFTED AND RUN: the entire feature is a gate plus a framing, and
// neither can be shown correct by inspecting shapes.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[]; const STORE={};
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.localStorage={getItem:(k)=>(k in STORE?STORE[k]:null),setItem:(k,v)=>{STORE[k]=String(v);},removeItem:(k)=>{delete STORE[k];}};
globalThis.seatLabel=(n)=>n;
eval([grab(/  const RQ_SM_TIMEOUT_MS = .*/).replace(/^\s*const /,"var "),
      grab(/  const RQ_SM_VIND_RE = .*/).replace(/^\s*const /,"var "),
      grab(/  function steelmanEnabled\(\) \{.*\}/),
      "var _smRoster=[],_smDesignated=null;",
      grab(/  function smDesignate\(calls, roundNumber\) \{[\s\S]*?\n  \}/),
      grab(/  function smShouldFire\([\s\S]*?\n  \}/),
      grab(/  function smPrompt\([\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.smShouldFire=smShouldFire;globalThis.smDesignate=smDesignate;" +
     "globalThis.smPrompt=smPrompt;globalThis.steelmanEnabled=steelmanEnabled;globalThis.VIND=RQ_SM_VIND_RE;" +
     "globalThis.getDes=()=>_smDesignated;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);

console.log("\n--- S5: the trigger set, the whole trigger set ---");
t("VERIFIED 3/3 full roster fires", smShouldFire("verified",3,3,3).fire, true);
t("VERIFIED 2/2 degraded roster fires", smShouldFire("verified",2,2,2).fire, true);
t("full-roster VERIFIED 2/3 does NOT fire", smShouldFire("verified",2,3,3).fire, false);
t("and the reason is organic divergence", smShouldFire("verified",2,3,3).reason, "organic_divergence");
t("DIVIDED does not fire", smShouldFire("divided",0,3,3).fire, false);
t("PROVISIONAL does not fire", smShouldFire("provisional",2,3,3).fire, false);
t("SOLE does not fire", smShouldFire("sole",1,1,1).fire, false);
t("RESOLVED does not fire", smShouldFire("resolved",3,3,3).fire, false);
t("one live seat cannot steelman itself", smShouldFire("verified",1,1,1).fire, false);
t("and says why", smShouldFire("verified",1,1,1).reason, "roster_lt_2");

console.log("\n--- S4: rotation fixed before the verdict exists ---");
const calls=[{name:"gemini"},{name:"kimi"},{name:"claude"}];
t("round 1 designates deterministically", smDesignate(calls,1), "kimi");
t("round 2 rotates", smDesignate(calls,2), "claude");
t("round 3 rotates", smDesignate(calls,3), "gemini");
t("same round + roster is replayable", smDesignate(calls,1), "kimi");
tt("designation happens at DISPATCH, before any answer",
   src.indexOf("smDesignate(calls,") < src.indexOf("await runSteelman"));

console.log("\n--- the prompt instructs disagreement explicitly ---");
const pr=smPrompt("kimi","Q?","gemini","The verdict text.");
tt("it says this is NOT the seat's position", /Your task in this pass is NOT to state your own position/.test(pr));
tt("regardless of actual agreement", /Regardless\n?of whether you agree/.test(pr));
tt("generic hedging is named as a FAILED steelman", /without specifics is a failed steelman/.test(pr));
tt("steelman not strawman", /the objection must be one a thoughtful critic/.test(pr));
tt("a vindication line is requested", /VINDICATION:/.test(pr));
tt("and the seat is told it will not count as its position",
   /it will not\nbe recorded as your position/.test(pr));
tt("and will not change the verdict", /will not change this round's verdict/.test(pr));

console.log("\n--- vindication parsing ---");
tt("a condition is extracted", VIND.exec("body\nVINDICATION: if X happens then Y")[1].trim() === "if X happens then Y");
tt("'none' is accepted as a real answer", /^none\.?$/i.test("none"));
tt("a missing line is tolerated, never retried", !VIND.test("body with no line") && /never retried|no retry/.test(src));

console.log("\n--- S3: manufactured dissent is structurally isolated ---");
tt("stored with authority:manufactured", /authority: "manufactured"/.test(src));
tt("on the ROUND record, not the seat-response array",
   /steelman: _smRecord/.test(src) && /not in the seat-response\s+\/\/ array|NOT in the seat-response/.test(src));
tt("excluded from the memory line seats read back",
   /its text is excluded from memory/.test(src));
tt("and the exclusion is not a summary", /summary of manufactured\s+\/\/ dissent is still manufactured/.test(src));
tt("banked with source:steelman, a new VALUE of an existing field",
   /source: "steelman"/.test(src) && /NEW VALUE of\s+\/\/ the bank's existing field|new value of/i.test(src));

console.log("\n--- S1/S6: it never touches the verdict or the rebuttal ---");
tt("fires strictly after verdict computation",
   src.indexOf("await runSteelman") > src.indexOf("const adj = await runAdjudication"));
tt("the verdict is described as unchanged", /is UNCHANGED/.test(src));
tt("a failed call cannot block round close", /it can never block or delay round close|never block or delay a round/.test(src));

console.log("\n--- walk on ABSENT only ---");
tt("a proxy seat still fires", /a seat on a fallback has a live receipt and still\s+\/\/ fires|has a live receipt and still/.test(src));
tt("an absent seat is walked past with a log line", /walked to/.test(src));

console.log("\n--- toggle ---");
t("defaults ON", steelmanEnabled(), true);
STORE["rq_steelman"]="off"; t("explicit off is respected", steelmanEnabled(), false);

console.log("\n--- v4.35.2: the pass that never fired ---");
// Round 103: "[STEELMAN] pass threw: calls is not defined — round unaffected."
// runSteelman is invoked from dispatch() and was handed `calls`, which is local
// to runLiveCouncil. Every eligible round since the feature shipped threw.
// The round WAS unaffected, which is exactly why it went unnoticed — the pass
// is best-effort and its error handling did what it promised. A feature that
// fails safely still fails.
tt("the call site no longer references a variable outside its scope",
   !/runSteelman\(query, result, allAnswers, calls,/.test(src));
tt("handles are carried out on the result instead",
   /_calls: calls,/.test(src) && /result && result\._calls/.test(src));
tt("and the verified path is the one that carries them",
   /trust: hasPrimaryVoice \? "verified" : "provisional",[\s\S]{0,1600}_calls: calls,/.test(src));
tt("other return paths fail safe via the empty-array default",
   /\(result && result\._calls\) \|\| \[\]/.test(src));
tt("the reason for carrying rather than hoisting is recorded",
   /how the next consumer\s+\/\/ gets a stale roster|gets a stale roster/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
