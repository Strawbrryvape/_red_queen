// v4.24.0 — Forced reckoning (Claude seat, round 27). The bank, the prompt and
// the resolver are LIFTED AND RUN. The whole feature turns on a seat being
// asked about ITS OWN condition and being recorded honestly when it ignores
// one; neither can be shown by inspecting shapes.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[]; const STORE={};
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.localStorage={getItem:(k)=>k==="rq_reckoning"?"on":(k in STORE?STORE[k]:null),
                         setItem:(k,v)=>{STORE[k]=String(v);}, removeItem:(k)=>{delete STORE[k];}};
globalThis.seatLabel=(n)=>n;
globalThis.ledger=[];
eval([grab(/  const clip = .*/),
      grab(/  const RQ_FALSIFIER_RE = .*/),
      grab(/  const RQ_RECK_KEY[\s\S]*?const RQ_RECK_MIN_AGE = .*/).replace(/^\s*const /gm,"var "),
      grab(/  function reckoningEnabled\(\) \{.*\}/),
      grab(/  function reckLoad\(\) \{[\s\S]*?\n  \}/),
      grab(/  function reckSave\(rows\) \{[\s\S]*?\n  \}/),
      grab(/  function reckPrompt\(hit\) \{[\s\S]*?\n  \}/),
      grab(/  const RQ_RECK_RE = .*/),
      grab(/  function reckResolve\(answers, hits\) \{[\s\S]*?\n  \}/),
      grab(/  function reckRecord\(\) \{[\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.reckLoad=reckLoad;globalThis.reckSave=reckSave;globalThis.reckPrompt=reckPrompt;" +
     "globalThis.reckResolve=reckResolve;globalThis.reckRecord=reckRecord;globalThis.RQ_RECK_RE=RQ_RECK_RE;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const reset=()=>{Object.keys(STORE).forEach(k=>delete STORE[k]);LOGS.length=0;};
const hit=(seat,round,text)=>({[seat]:{entry:{seat,round,text,status:"UNTESTED",triggered:0},sim:0.81}});

console.log("\n--- the alert quotes the seat's OWN words, verbatim ---");
const cond="I would change my position if the retrieval floor were shown to miss relevant rounds at 0.6.";
const pr=reckPrompt({entry:{text:cond,round:14},sim:0.8});
tt("the condition is quoted, not paraphrased", pr.includes(cond));
tt("it demands one of three verdicts", /RECKONING: YES/.test(pr) && /RECKONING: NO/.test(pr) && /RECKONING: PARTIAL/.test(pr));
tt("holding is explicitly as good an answer as revising",
   /Holding your position with a stated reason is as good an\s+answer|as good an answer as revising it/.test(pr));
tt("and ignoring it is what is ruled out", /not acceptable is ignoring the condition you set yourself/.test(pr));
tt("it comes BEFORE the question", /answer this BEFORE the question below/i.test(pr));

console.log("\n--- resolution records what the seat actually did ---");
const seed=(status)=>{STORE["rq_falsifier_bank_v1"]=JSON.stringify([{seat:"kimi",round:14,text:cond,status:status||"UNTESTED",triggered:0}]);};
reset(); seed();
reckResolve([{name:"kimi",text:"RECKONING: YES\n\nUpdated position: the floor should drop to 0.55."}], hit("kimi",14,cond));
t("YES becomes TRIGGERED-UPDATED", reckLoad()[0].status, "TRIGGERED-UPDATED");
reset(); seed();
reckResolve([{name:"kimi",text:"RECKONING: NO\n\nThe evidence concerns a different corpus."}], hit("kimi",14,cond));
t("NO becomes TRIGGERED-HELD", reckLoad()[0].status, "TRIGGERED-HELD");
reset(); seed();
reckResolve([{name:"kimi",text:"RECKONING: PARTIAL\n\nI would need a second corpus."}], hit("kimi",14,cond));
t("PARTIAL becomes TRIGGERED-PARTIAL", reckLoad()[0].status, "TRIGGERED-PARTIAL");

console.log("\n--- ignoring the alert is the finding, not a bug ---");
reset(); seed();
reckResolve([{name:"kimi",text:"Here is my answer to your question, with no mention of the alert."}], hit("kimi",14,cond));
t("no RECKONING line becomes TRIGGERED-IGNORED", reckLoad()[0].status, "TRIGGERED-IGNORED");
tt("and it is called a finding about the seat, not a defect",
   LOGS.some(l=>/a finding about the seat, not a bug in this check/.test(l)));

console.log("\n--- consumed once, whatever the answer ---");
reset(); seed();
reckResolve([{name:"kimi",text:"RECKONING: NO\n\nreason"}], hit("kimi",14,cond));
t("status leaves UNTESTED so it cannot re-fire", reckLoad()[0].status !== "UNTESTED", true);
t("and the trigger count increments", reckLoad()[0].triggered, 1);

console.log("\n--- the track record ---");
reset();
STORE["rq_falsifier_bank_v1"]=JSON.stringify([
 {seat:"kimi",round:1,text:"a".repeat(40),status:"TRIGGERED-UPDATED"},
 {seat:"kimi",round:2,text:"b".repeat(40),status:"TRIGGERED-HELD"},
 {seat:"kimi",round:3,text:"c".repeat(40),status:"UNTESTED"},
]);
const rec=reckRecord();
t("stated counted", rec.kimi.stated, 3);
t("updated counted", rec.kimi.updated, 1);
t("held counted", rec.kimi.held, 1);
t("never-triggered counted separately", rec.kimi.untested, 1);
tt("the record refuses to over-read a small sample",
   LOGS.some(l=>/distinguish those only over many rounds, not in one/.test(l)));
reset();
t("an empty bank returns null rather than a fake record", reckRecord(), null);

console.log("\n--- shape: the guards that matter ---");
tt("a seat is only asked about ITS OWN falsifier",
   /_reckHits\[c\.name\]/.test(src) && /Putting\s+\/\/ one seat's condition to another would be an accusation/.test(src));
tt("matching is advisory, never a decision",
   /The match is ADVISORY/.test(src) && /the seat decides whether the condition is met/.test(src));
tt("no embed worker means UNKNOWN, not 'nothing matched'",
   /That is UNKNOWN, not 'nothing matched'/.test(src));
tt("resolve runs BEFORE deposit, so a fresh falsifier cannot self-resolve",
   src.indexOf("reckResolve(allAnswers") < src.indexOf("reckDeposit(allAnswers"));
tt("a falsifier must age before it can trigger", /RQ_RECK_MIN_AGE/.test(src));
tt("the threshold is marked unfitted", /TUNE-AFTER-DATA/.test(src) && /RQ_RECK_SIM/.test(src));
tt("the proposing seat's own falsifier is recorded in source",
   /unobservable from outside/.test(src) && /PROPOSING SEAT.S OWN FALSIFIER/.test(src));
tt("flag defaults OFF", /localStorage\.getItem\("rq_reckoning"\) === "on"/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
