// v4.16.0 — Recursive Self-Critique (Claude seat, round 131). The detector is
// LIFTED AND RUN: its whole value is recognising a reversal, and a shape
// assertion cannot show that a reversal is detected or that a non-reversal is
// correctly ignored.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[];
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.localStorage={getItem:(k)=>k==="rq_rdsr"?"on":null};
globalThis.seatLabel=(n)=>n;
eval([grab(/  const RQ_RDSR_ASK =[\s\S]*?on its own line\.";/),
      grab(/  const RQ_RDSR_DECOR = .*/),
      grab(/  const RQ_RDSR_L1_RE = .*/),
      grab(/  const RQ_RDSR_L3_RE = new RegExp\([\s\S]*?"im"\);/),
      "function rdsrEnabled(){ return true; }",
      grab(/  const RQ_RDSR_REVERSAL_RE = new RegExp\(\[[\s\S]*?"i"\);/),
      grab(/  function rdsrScan\(answers\) \{[\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.rdsrScan=rdsrScan;globalThis.RQ_RDSR_ASK=RQ_RDSR_ASK;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const reset=()=>{LOGS.length=0;};

console.log("\n--- structure detection ---");
reset();
let r=rdsrScan([{name:"kimi",text:"L1 POSITION: keep the floor at 0.600.\nL2 ATTACK: a lower floor would surface more.\nL3 DEFENCE: recall gains do not offset false positives.\nL4 FALSIFIER: if a trial showed otherwise."}]);
t("a four-level answer is recognised", r.structured, ["kimi"]);
t("and no reversal is claimed when none occurred", r.reversed, []);
tt("the log says the acceptance condition is still unmet",
   LOGS.some(l=>/acceptance condition is still unmet/.test(l)));

console.log("\n--- THE ACCEPTANCE CONDITION: a seat reversing itself ---");
reset();
r=rdsrScan([{name:"claude",text:"L1 POSITION: the cap should rise.\nL2 ATTACK: raising it breaks baseline comparability.\nL3 DEFENCE: I concede that — L2 defeats L1, and I revise my L1 to hold the cap.\nL4 FALSIFIER: if comparability were shown not to matter."}]);
t("the reversal is detected", r.reversed, ["claude"]);
tt("and named as the acceptance condition being met",
   LOGS.some(l=>/acceptance condition the feature was proposed against, and it has now occurred/.test(l)));

console.log("\n--- conservative by design: near-misses must NOT count ---");
reset();
tt("a mere caveat is not a reversal",
   rdsrScan([{name:"kimi",text:"L1 POSITION: x.\nL2 ATTACK: y.\nL3 DEFENCE: that is a fair point but it does not change my view.\nL4 FALSIFIER: z."}]).reversed.length === 0);
tt("conceding INSIDE L2 is not a reversal at L3",
   rdsrScan([{name:"kimi",text:"L1 POSITION: x.\nL2 ATTACK: one might concede that y.\nL3 DEFENCE: I hold L1.\nL4 FALSIFIER: z."}]).reversed.length === 0);

console.log("\n--- the instruction being dropped is reported, not silent ---");
reset();
r=rdsrScan([{name:"kimi",text:"Just an ordinary answer with no levels at all."}]);
t("no structure found", r.structured, []);
tt("and the log names BOTH possible causes",
   LOGS.some(l=>/instruction is being dropped, or the seats are declining it/.test(l)));

console.log("\n--- the instruction itself ---");
tt("L2 demands a real attack, not a dismissible caveat",
   /not as a caveat you can dismiss/.test(RQ_RDSR_ASK));
tt("L3 makes reversing a SUCCESS, removing the incentive to defend badly",
   /reversing yourself here is a success of this process/.test(RQ_RDSR_ASK));
tt("L4 reuses the existing falsifier convention", /beginning with FALSIFIER:/.test(RQ_RDSR_ASK));

console.log("\n--- v4.17.1: markdown decoration must not defeat detection ---");
// Live 2026-08-23: a textbook four-level answer was reported as "NO seat
// returned the four-level structure" because seats bold their headers.
[["bold whole line","**L1 POSITION: x**"],["bold label","**L1 POSITION:** x"],
 ["heading","## L1 POSITION: x"],["bullet","- L1 POSITION: x"],
 ["bullet+bold","- **L1 POSITION:** x"],["bare label","L1: x"]].forEach(([n,txt])=>{
  tt("detected: "+n, rdsrScan([{name:"k",text:txt+"\nL2: a\nL3: b\nL4: c"}]).structured.length===1);
});
tt("prose mentioning L1 mid-sentence is NOT detected",
   rdsrScan([{name:"k",text:"I revise my L1 position: it was wrong."}]).structured.length===0);
tt("a bolded L3 reversal is still caught",
   rdsrScan([{name:"k",text:"**L1:** x\n**L3 DEFENCE:** I concede that, L2 defeats L1.\n**L4:** z"}]).reversed.length===1);

console.log("\n--- v4.17.2: the round-150 reversal the first detector missed ---");
// "your L2 attack proves I should not have made the causal claim... I should
// concede L2 ... Revised L1:" — a textbook reversal reported as none, because
// the regex wanted exact phrasing. Word forms and modals are how people
// actually concede; requiring exact wording measured my vocabulary.
const R=(t)=>rdsrScan([{name:"k",text:"L1: x\nL3 DEFENCE: "+t+"\nL4: z"}]).reversed.length===1;
tt("the actual round-150 wording is detected",
   R("I should concede L2 on the assertion while holding a narrower position: Revised L1: the narrower claim."));
tt("past-tense 'Revised L1' is detected", R("Revised L1: the cap should hold."));
tt("'I was wrong' is detected", R("I was wrong to assert that."));
tt("'I should not have made the claim' is detected", R("I should not have made the causal claim."));
tt("holding a position is NOT a reversal", !R("That is a fair point but I hold my position."));
tt("DESCRIBING someone else conceding is NOT a reversal",
   !R("My opponent might concede nothing here.") && !R("A weaker model would concede immediately."));
tt("a hypothetical concession is NOT a reversal",
   !R("One could concede the point without abandoning it."));
tt("the false-positive risk is documented",
   /A false reversal makes the feature look successful when it\s+\/\/ is not|false reversal makes the feature look successful/.test(src));

console.log("\n--- shape ---");
tt("zero new API calls", !/rdsrScan[\s\S]{0,800}fetch\(/.test(src));
tt("appended on the post-composition seam, so the prompt hash stays clean",
   /rdsrEnabled\(\) \|\| \(_rdsrArm && _rdsrArm\.armed\)/.test(src) &&
   /!_noteRound && !_indexicalRound && !isFalsifierTestRound\(query\)/.test(src));
tt("suppressed on rounds that are not positions", /have nothing to attack/.test(src));
tt("its own acceptance test is documented in source",
   /ONE round in\s+\/\/ which a seat reverses its own Level 1 by Level 3|reverses its own Level 1 by Level 3/.test(src));
tt("flag defaults OFF", /localStorage\.getItem\("rq_rdsr"\) === "on"/.test(src));
tt("the comparability cost is stated on the flag", /not comparable to rounds without/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
