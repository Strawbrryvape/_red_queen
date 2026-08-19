// v4.11.0 — Ledger Diff Engine (Kimi seat, round 91) + the non-answer guard
// (Kimi seat, round 97). Logic is LIFTED AND RUN against synthetic ledgers:
// both features make claims about history, and a shape assertion cannot show
// that a finding fires on the case it was built for.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const _s=src.indexOf("const STOPWORDS = new Set(");
const _e=src.indexOf("// ==================== v3.3: CONCEPT-BASED COMPARATOR");
const LOGS=[];
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.ledger=[];
eval([src.slice(_s,_e), grab(/  const clip = .*/),
      grab(/  const RQ_FALSIFIER_RE = .*/),
      grab(/  const RQ_LDE_STALE_ROUNDS[\s\S]*?\n  function ldeRunAll\(\) \{[\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.ldeAuditFalsifiers=ldeAuditFalsifiers;globalThis.ldeAuditTags=ldeAuditTags;globalThis.ldeFalsifiers=ldeFalsifiers;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const reset=()=>{LOGS.length=0;};

console.log("\n--- FALSIFIER_LEDGER: is a stated falsifier ever tested? ---");
reset();
globalThis.ledger=[
  { t:1, prompt:"Should the similarity floor stay at 0.600?", outcome:"divided",
    header:{ receipts:[{seat:"kimi",falsifier:"If a controlled trial at 0.550 showed better recall without admitting redundant near-duplicate entries, I would lower it."}]},
    positions:[{seat:"kimi",text:"Keep 0.600."}] },
  { t:2, prompt:"Unrelated question about arc narration cadence.", outcome:"divided",
    header:{receipts:[]}, positions:[{seat:"kimi",text:"Arcs every ten rounds."}] },
];
let r = ldeAuditFalsifiers();
t("one falsifier extracted from the receipts", r.length, 1);
t("never revisited => UNTESTED", r[0].status, "UNTESTED");
reset();
globalThis.ledger.push({ t:3, outcome:"divided",
  prompt:"Run the controlled trial at 0.550 and report recall against redundant near-duplicate entries.",
  header:{receipts:[]}, positions:[{seat:"kimi",text:"Trial showed lower recall and admitted redundant entries."}] });
r = ldeAuditFalsifiers();
t("a later round sharing its distinctive terms => ADDRESSED", r[0].status, "ADDRESSED");
tt("and it names which round", r[0].hits.includes(3));
tt("'addressed' is explicitly NOT claimed as proof of testing",
   LOGS.some(l=>/topical overlap, NOT proof the condition was actually tested/.test(l)));

console.log("\n--- an EARLIER round cannot test a LATER falsifier ---");
reset();
globalThis.ledger=[
  { t:1, outcome:"divided", prompt:"controlled trial recall redundant duplicate entries threshold",
    header:{receipts:[]}, positions:[{seat:"kimi",text:"x"}] },
  { t:2, outcome:"divided", prompt:"q",
    header:{receipts:[{seat:"kimi",falsifier:"If a controlled trial showed better recall without admitting redundant duplicate entries at that threshold, I would lower it."}]},
    positions:[{seat:"kimi",text:"y"}] },
];
r = ldeAuditFalsifiers();
t("round 1 does not count as testing round 2's falsifier", r[0].status, "UNTESTED");

console.log("\n--- TAG_AUDIT: a rejected position resurfacing ---");
reset();
const phrase="the asynchronous mirror is a sync engine wearing a disguise entirely";
globalThis.ledger=[
  { t:1, outcome:"divided", prompt:"Where should the Spine live?",
    positions:[{seat:"claude",text:"Position A: "+phrase+" and therefore local must be the record."}] },
  { t:2, outcome:"verified", prompt:"Unrelated arc question.",
    positions:[{seat:"kimi",text:"Arcs should run every ten rounds with quality scoring enabled."}] },
  { t:3, outcome:"divided", prompt:"What retrieval floor?",
    positions:[{seat:"claude",text:"Given "+phrase+", the floor should be lower."}] },
];
let a = ldeAuditTags();
t("the echo from the DIVIDED round is found", a.length, 1);
t("and it names source and destination", [a[0].from,a[0].to], [1,3]);
tt("it is labelled a CANDIDATE, not a verdict",
   LOGS.some(l=>/CANDIDATES ONLY; the council adjudicates/.test(l)));

console.log("\n--- a VERIFIED round resurfacing is NOT a finding ---");
reset();
globalThis.ledger[0].outcome="verified";
a = ldeAuditTags();
t("settled rounds may be cited freely", a.length, 0);
tt("and a null result declines to claim cleanliness",
   LOGS.some(l=>/NOT a clean bill of health/.test(l)));

console.log("\n--- boilerplate cannot masquerade as an echo ---");
reset();
const boiler="every seat must state what would change its mind before arguing";
globalThis.ledger=[1,2,3,4].map((n)=>({ t:n, outcome:"divided", prompt:"q"+n,
  positions:[{seat:"kimi",text:boiler+" and here is position "+n}] }));
a = ldeAuditTags();
t("a phrase in every round is filtered by document frequency", a.length, 0);

console.log("\n--- shape: the non-answer guard (round 97) ---");
tt("a request-only reply is excluded from consensus",
   /a\.nonAnswer = true;/.test(src) && /!a\.nonAnswer\)/.test(src));
tt("the exclusion is announced, not silent", /\[ABSTENTION\]/.test(src));
tt("it says why an abstention must not score as dissent",
   /an\s+\/\/\s+"?abstention is not a dissent|abstention is not a dissent/.test(src));
tt("a seat that asks AND answers is not excluded", /bare\.length < 40/.test(src));
tt("the text is still recorded", /The text is still recorded and rendered/.test(src));

console.log("\n--- shape: nothing here adjudicates ---");
tt("DIGEST_VERIFY deliberately not built (Pillar 2 owns hashing)",
   /Pillar 2 already hash-chains rows/.test(src) && /a real HMAC/.test(src));
tt("the non-adjudication non-goal is documented",
   /false-consensus pressure instrument/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
