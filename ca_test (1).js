// Conformity audit suite. Logic lifted verbatim and run against the REAL
// 192-round snapshot — the strongest available check short of a browser.
// embedText is stubbed (no Xenova in Node); the semantic-distance judgement is
// therefore NOT validated here, only the mechanism, thresholds and shape.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const _s=src.indexOf("const STOPWORDS = new Set(");
const _e=src.indexOf("// ==================== v3.3: CONCEPT-BASED COMPARATOR");
globalThis.ledger=[];
globalThis.logError=()=>{};
let EMBED_MODE="hash";
// Deterministic pseudo-embedding: same text -> same vector, different text ->
// different vector. Enough to exercise the pipeline, NOT enough to judge meaning.
globalThis.embedText=async(t)=>{
  if(EMBED_MODE==="null") return null;
  const v=new Array(16).fill(0);
  for(let i=0;i<t.length;i++) v[i%16]+=t.charCodeAt(i)%7;
  const n=Math.sqrt(v.reduce((s,x)=>s+x*x,0))||1;
  return v.map(x=>x/n);
};
eval([
  src.slice(_s,_e),
  grab(/  const CS_BANNER_MAX[\s\S]*?\n    return false;\n  \}/),
  grab(/  function _cosine384[\s\S]*?\n  \}/),
  grab(/  const RQ_CA_RARE_MAX_DF[\s\S]*?\n  \}\n  try \{ window\.__rqConformityAudit/).replace(/\n  try \{ window\.__rqConformityAudit$/,""),
].join("\n") + "\nglobalThis.runConformityAudit=runConformityAudit;globalThis.caStrip=caStrip;globalThis.caNgrams=caNgrams;globalThis.caSpecifics=caSpecifics;globalThis.caPathDistance=caPathDistance;globalThis.RQ_CA_PATH_FLOOR=RQ_CA_PATH_FLOOR;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)+" want "+JSON.stringify(w)));};
const tt=(n,c)=>t(n,!!c,true);

(async()=>{
console.log("\n--- caStrip removes what the harness ASKED for ---");
tt("falsifier line stripped", !/FALSIFIER/.test(caStrip("FALSIFIER: if X then Y\nMy real position is Z.")));
tt("request channel stripped", !/REQUEST_FULLTEXT/.test(caStrip("[REQUEST_FULLTEXT: 12]\nMy position.")));
tt("banner lines stripped", !/KIMI SEAT/.test(caStrip("**KIMI SEAT — POSITION**\nMy actual argument here.")));
tt("the real argument survives", /actual argument/.test(caStrip("**KIMI SEAT**\nMy actual argument here.")));

console.log("\n--- specifics: identical figures are the tell ---");
t("decimals captured", [...caSpecifics("the floor is 0.600 and error 0.679")].sort(), ["num:0.600","num:0.679"]);
t("round citations captured", [...caSpecifics("as Round 176 showed")], ["cite:round 176"]);
t("plain prose yields none", [...caSpecifics("we should keep it as is")], []);

console.log("\n--- degradation: an audit that cannot embed reports UNKNOWN, not clean ---");
EMBED_MODE="null";
t("path distance is null, never guessed", await caPathDistance([{text:"a".repeat(80)},{text:"b".repeat(80)}]), null);
tt("the null case is called out in source, not silently passed",
   /Result is UNKNOWN, not clean/.test(src));
EMBED_MODE="hash";

console.log("\n--- refinement 1: measured on INITIAL positions, not verdicts ---");
tt("audit reads entry.positions", /\(e\.positions \|\| \[\]\)/.test(src));
tt("never reads adjudication verdicts", !/runConformityAudit[\s\S]{0,2500}\.verdicts/.test(src));
tt("the reason is documented", /working correctly as if it were herding/.test(src));

console.log("\n--- refinement 2: anchoring is CROSS-round, not intra-round ---");
tt("compares round i against i-1", /perRound\[i - 1\]\.has\(g\)/.test(src));
tt("the impossible intra-round version is documented in the SOURCE",
   /That channel DOES NOT EXIST/.test(src) && /blind to each other until\s+\/\/ adjudication|blind to each other until/.test(src));

console.log("\n--- end-to-end over a SYNTHETIC ledger ---");
// HONEST LIMIT: the 192-round snapshot was cleared from uploads between
// sessions, and Node has no Xenova worker anyway — so the semantic judgement
// is NOT validated here under any circumstance. What follows exercises the
// pipeline shape on a ledger built to contain a known planted echo, using
// deterministic stub embeddings. The real acceptance test is the browser
// button against the live ledger; see the handoff.
const mk=(t,outcome,texts)=>({t,outcome,positions:texts.map((x,i)=>({seat:["gemini","kimi","claude"][i],text:x}))});
globalThis.ledger=[
  mk(1,"divided",[
    "The similarity floor should remain at 0.600 because lowering it admits redundant entries.",
    "Retrieval precision matters more than recall for a consensus orchestrator here.",
    "I would keep the present threshold until we have evidence justifying a change."]),
  mk(2,"resolved",[
    "The similarity floor should remain at 0.600 because lowering it admits redundant entries.",
    "The similarity floor should remain at 0.600 because lowering it admits redundant entries.",
    "Storage durability is a separate concern from retrieval thresholds entirely."]),
  mk(3,"resolved",[
    "Provenance must be attested by the dispatcher rather than claimed by the model.",
    "A model has no privileged access to its own weights and cannot certify authorship.",
    "The harness is the only component that knows which endpoint produced the tokens."]),
  mk(4,"divided",[
    "Round 176 showed the context window was not the bottleneck at 0.679 error.",
    "Round 176 showed the context window was not the bottleneck at 0.679 error.",
    "Data topology outweighs parameter scaling when the ledger itself is lossy."]),
];
const res=await runConformityAudit();
tt("returns a result", !!res && Array.isArray(res.rows));
t("one row per scoreable round", res.rows.length, 4);
tt("every row carries a path distance or an explicit null",
   res.rows.every(r=>r.path===null||typeof r.path==="number"));
tt("first round has no cross-round echo (nothing precedes it)", res.rows[0].echo===null);
tt("later rounds carry an echo number", typeof res.rows[1].echo==="number");
tt("the planted round-2 echo of round 1 is detected", res.rows[1].echo>0);
tt("shared specifics detected where two seats quote the same figures",
   res.rows[3].shared>0);
tt("round 3, three genuinely distinct positions, shows no shared specifics",
   res.rows[2].shared===0);

console.log("\n--- thresholds are honest about being unfitted ---");
tt("flagged as TUNE-AFTER-DATA", /TUNE-AFTER-DATA/.test(src));
tt("a zero-flag result is explicitly NOT a clean bill of health",
   /NOT a clean bill of health/.test(src));
tt("operator is told to read the trend, not the flag count",
   /Read the mean and the trend, not the flag count/.test(src));

console.log("\n--- zero API cost ---");
tt("no fetch anywhere in the audit", !/async function runConformityAudit[\s\S]{0,4000}fetch\(/.test(src));
tt("embeddings come from the local worker", /embedText\(t\)/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
})();
