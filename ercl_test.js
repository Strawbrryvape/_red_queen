// v4.14.0 — External Reasoning Consultation Loop. Council spec, round 134,
// VERIFIED 3/3. Detectors are LIFTED AND RUN: the whole feature is a set of
// gates, and a shape assertion cannot show a gate holds.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[];
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.localStorage={getItem:(k)=>k==="rq_ercl"?"on":null};
globalThis.seatLabel=(n)=>n;
eval([grab(/  const clip = .*/), grab(/  function ftDigest\(s\) \{[\s\S]*?\n  \}/),
      (function(){const a=src.indexOf("const RQ_ERCL_REQ_RE");const b=src.indexOf("let _erclInput = null;");return src.slice(a,b);})()].join("\n") +
     "\nglobalThis.erclScanRequest=erclScanRequest;globalThis.erclScanInput=erclScanInput;globalThis.RQ_ERCL_STANDING=RQ_ERCL_STANDING;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const reset=()=>{LOGS.length=0;};

console.log("\n--- OUTBOUND: a seat asks to consult, nothing dispatches ---");
reset();
const r=erclScanRequest([{name:"kimi",text:"My position stands.\n\n[EXTERNAL_CONSULTATION_REQUEST]\nDOMAIN: formal systems verification\nCRUX: We cannot arbitrate whether the proof is sound.\n\nMore prose after."}]);
tt("the request is detected", !!r);
t("and attributed to the seat", r.seat, "kimi");
tt("the brief is captured", /formal systems verification/.test(r.brief));
tt("a digest is recorded for provenance", typeof r.digest === "string" && r.digest.length === 8);
tt("the log states plainly that NOTHING was dispatched",
   LOGS.some(l=>/NOTHING WAS DISPATCHED/.test(l)));
tt("and tells the operator what to do instead",
   LOGS.some(l=>/paste the reply into a later round/.test(l)));
reset();
t("no request in ordinary text", erclScanRequest([{name:"kimi",text:"Just a position."}]), null);

console.log("\n--- INBOUND: testimony is recognised and ranked ---");
reset();
const i=erclScanInput("Consider this.\n\n[EXTERNAL_INPUT: gpt-5-thinking]\nThe proof is sound because...");
tt("testimony is detected", !!i);
t("the source model is captured", i.model, "gpt-5-thinking");
tt("a digest is recorded", typeof i.digest === "string");
tt("the log states the ranking", LOGS.some(l=>/BELOW SOLE VOICE/.test(l)));
tt("and that it cannot reach VERIFIED", LOGS.some(l=>/CANNOT contribute to VERIFIED/.test(l)));
reset();
t("an ordinary prompt yields nothing", erclScanInput("What is the retrieval floor?"), null);

console.log("\n--- the standing instruction the seats receive ---");
tt("names the ranking explicitly", /ranks BELOW SOLE VOICE/.test(RQ_ERCL_STANDING));
tt("requires cite-and-verify OR refute", /cite it explicitly with your own independent verification/.test(RQ_ERCL_STANDING));
tt("says unengaged testimony is treated as ABSENT", /treated as absent/.test(RQ_ERCL_STANDING));
tt("warns against deference to outside authority", /do not defer to it because it came from elsewhere/.test(RQ_ERCL_STANDING));

console.log("\n--- shape: the deviation from the spec is deliberate and documented ---");
tt("no client-side external fetch was built",
   !/fetch\([^)]*EXTERNAL|erclFetch|erclDispatch/.test(src));
tt("the deviation is stated in source",
   /NOT BUILT: client-side auto-fetch/.test(src));
tt("the reason is given, not just the fact",
   /90% of the value at a fraction of the risk/.test(src));
tt("the standing instruction is appended ONLY when testimony is present",
   /_erclInput \? \("\\n\\n" \+ RQ_ERCL_STANDING\) : ""/.test(src));
tt("provenance rides as additive ledger keys",
   /\.\.\.\(_erclInput \? \{ external_input: _erclInput \} : \{\}\)/.test(src));
tt("a past round carrying testimony says so to the seats",
   /EXTERNAL TESTIMONY from/.test(src) && /never counted toward consensus/.test(src));
tt("flag defaults OFF", /localStorage\.getItem\("rq_ercl"\) === "on"/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
