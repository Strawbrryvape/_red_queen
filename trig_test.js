// v4.18.0 — trigger-based RDSR arming (Kimi seat, round 152). The arming logic
// is LIFTED AND RUN, because the failure two seats caught in a rival spec was a
// CAUSALITY error, and only execution can show that arming never sees an
// outcome it could not have.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[]; const STORE={};
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.localStorage={getItem:(k)=>k==="rq_rdsr_auto"?"on":(k in STORE?STORE[k]:null),
                         setItem:(k,v)=>{STORE[k]=String(v);}, removeItem:(k)=>{delete STORE[k];}};
globalThis.ledger=[];
globalThis.seatLabel=(n)=>n;
globalThis.classifyEpistemic=(q)=>/council|seat|ledger|consensus|architecture|falsifier/i.test(q)?"META":"EVIDENCE";
eval([grab(/  const RQ_RDSR_MACHINERY = .*/),
      grab(/  const RQ_RDSR_MIN_HITS[\s\S]*?const RQ_RDSR_PEND_K    = .*/),
      grab(/  function rdsrTriggerEnabled\(\) \{.*\}/),
      grab(/  function rdsrNormalize\(q\) \{[\s\S]*?\n  \}/),
      grab(/  function rdsrPriorDivides\(query\) \{[\s\S]*?\n  \}/),
      grab(/  function rdsrShouldArm\(query\) \{[\s\S]*?\n  \}/),
      grab(/  function rdsrScanRequest\(answers\) \{[\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.rdsrShouldArm=rdsrShouldArm;globalThis.rdsrScanRequest=rdsrScanRequest;globalThis.rdsrPriorDivides=rdsrPriorDivides;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const reset=()=>{Object.keys(STORE).forEach(k=>delete STORE[k]);LOGS.length=0;globalThis.ledger=[];};

console.log("\n--- THE CAUSALITY CONSTRAINT (the error two seats caught) ---");
tt("arming reads only the question and PRIOR rounds",
   /rdsrShouldArm\(query\)/.test(src) &&
   !/rdsrShouldArm[\s\S]{0,1500}(?:result\.trust|result\.divided|agreed\.length)/.test(src));
tt("and it is invoked BEFORE dispatch, not after",
   src.indexOf("_rdsrArm = rdsrShouldArm(query)") < src.indexOf("result = await runLiveCouncil(composedQuery)"));
tt("the refuted spec's error is documented", /THE CAUSALITY ERROR/.test(src));

console.log("\n--- T1 architecture: tag alone is NOT enough ---");
reset();
t("META with 3+ machinery terms arms",
  rdsrShouldArm("How should the council ledger and consensus comparator interact?").armed, true);
t("META with too few terms does NOT arm",
  rdsrShouldArm("What is consensus, philosophically speaking?").armed, false);
t("a non-META question does not arm",
  rdsrShouldArm("Should cities ban cars from downtown areas entirely?").armed, false);
tt("distinct terms are counted, not repetitions",
   rdsrShouldArm("council council council council council").armed === false);

console.log("\n--- T2 repeated divide: prior rounds only, and clean ones ---");
reset();
const q="Should the similarity floor stay at 0.600 for retrieval?";
const clean=(extra)=>Object.assign({outcome:"divided",prompt:q,counterfoils:[{proxy:false}],header:{receipts:[]}},extra||{});
globalThis.ledger=[clean(),clean()];
t("two prior clean DIVIDED rounds arm it", rdsrShouldArm(q).armed, true);
reset(); globalThis.ledger=[clean()];
t("one is not enough", rdsrShouldArm(q).armed, false);
reset(); globalThis.ledger=[clean({cs:{verdict:"PARALLEL"}}),clean({cs:{verdict:"PARALLEL"}})];
t("PARALLEL rounds are EXCLUDED — merge failures need a re-ask, not depth",
  rdsrShouldArm(q).armed, false);
reset(); globalThis.ledger=[clean({counterfoils:[{proxy:true}]}),clean({counterfoils:[{proxy:true}]})];
t("rounds with a fallback seat do not count", rdsrShouldArm(q).armed, false);
reset(); globalThis.ledger=[clean({header:{receipts:[{absent:true}]}}),clean({header:{receipts:[{absent:true}]}})];
t("rounds with an absent seat do not count", rdsrShouldArm(q).armed, false);
reset(); globalThis.ledger=[clean({round_type:"indexical"}),clean({round_type:"indexical"})];
t("roll-call rounds are not questions", rdsrShouldArm(q).armed, false);

console.log("\n--- T3 seat request: outranks the heuristics, never stacks ---");
reset();
rdsrScanRequest([{name:"kimi",text:"My position.\n[RSDR_REQUEST]\nmore text"}]);
tt("the council's own spelling RSDR is accepted", STORE["rq_rdsr_pending"] === "1");
STORE["rq_rdsr_pending"]=undefined; delete STORE["rq_rdsr_pending"];
rdsrScanRequest([{name:"kimi",text:"[RDSR_REQUEST]"}]);
tt("and this codebase's spelling RDSR is too", STORE["rq_rdsr_pending"] === "1");
delete STORE["rq_rdsr_pending"];
rdsrScanRequest([{name:"kimi",text:"I might write [RSDR_REQUEST] inline but not on its own line"}]);
tt("a marker mid-sentence does NOT arm", STORE["rq_rdsr_pending"] !== "1");
rdsrScanRequest([{name:"kimi",text:"My position.\n[RSDR_REQUEST]\nmore text"}]);
tt("the request is recorded", STORE["rq_rdsr_pending"] === "1");
const armed=rdsrShouldArm("An ordinary question about the weather today.");
t("it arms the NEXT round even on a plain question", armed.armed, true);
tt("and names itself as the reason", /T3 seat request/.test(armed.reason));
t("consumed once — the round after does not re-arm",
  rdsrShouldArm("An ordinary question about the weather today.").armed, false);

console.log("\n--- OFF conditions: inertia is the thing being guarded against ---");
reset();
STORE["rq_rdsr_run"]="3";
t("the hard cap forces off", rdsrShouldArm("council ledger consensus comparator").armed, false);
tt("and says why", LOGS.some(l=>/CAPPED/.test(l) && /must not become permanent by accident/.test(l)));
reset();
globalThis.ledger=[{outcome:"verified",counterfoils:[{proxy:true}]}];
t("a degraded roster skips arming", rdsrShouldArm("council ledger consensus comparator").armed, false);
tt("and explains that armed rounds stay comparable",
   LOGS.some(l=>/Armed rounds are kept comparable/.test(l)));

console.log("\n--- the addition the council did not specify ---");
tt("the trigger REASON is stored on the round",
   /rdsr_trigger: _rdsrArm\.reason/.test(src));
tt("and the rationale is in source",
   /nobody can tell later unless it\s+\/\/ is recorded|under auto-arming nobody can tell/i.test(src));
tt("auto-arm has its own flag, separate from the manual toggle",
   /localStorage\.getItem\("rq_rdsr_auto"\) === "on"/.test(src));
tt("the manual toggle still forces it on independently",
   /rdsrEnabled\(\) \|\| \(_rdsrArm && _rdsrArm\.armed\)/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
