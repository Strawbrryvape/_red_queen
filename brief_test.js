// v4.17.0 — the operator brief. Written LAST among the recent features and the
// only one that had shipped without a suite, which is precisely backwards: a
// reporting layer is where this project has found eleven of its twelve defects.
// briefFor and rqState are lifted and RUN.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[];
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.ledger=[];
eval([grab(/  const clip = .*/),
      grab(/  const CS_VERDICT_STYLE = \{[\s\S]*?\n  \};/),
      grab(/  function csLabel\(cs\) \{[\s\S]*?\n  \}/),
      grab(/  const RQ_BRIEF_TRUST = \{[\s\S]*?\n  \};/),
      grab(/  const RQ_BRIEF_CS = \{[\s\S]*?\n  \};/),
      grab(/  function briefFor\(e, idx\) \{[\s\S]*?\n  \}/),
      grab(/  function rqState\(\) \{[\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.briefFor=briefFor;globalThis.rqState=rqState;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const reset=()=>{LOGS.length=0;};

console.log("\n--- it must not use jargon the operator would have to decode ---");
const b=briefFor({prompt:"Should the floor stay at 0.600?",outcome:"divided",counts:"0/3",
  cs:{verdict:"FIELD SKEW",gate:2,shadow:false}},7);
tt("FIELD SKEW is translated, not printed", !/FIELD SKEW/.test(b));
tt("and the translation names equipment, not disagreement", /equipment|not a disagreement/i.test(b));
const b2=briefFor({prompt:"Q",outcome:"divided",cs:{verdict:"PARALLEL",gate:1,shadow:false}},8);
tt("PARALLEL is translated too", !/PARALLEL/.test(b2) && /different/i.test(b2));

console.log("\n--- a SHADOW verdict must never be presented as settled ---");
const bs=briefFor({prompt:"Q",outcome:"divided",cs:{verdict:"TRUE SPLIT",gate:3,shadow:true}},9);
tt("a shadow sub-verdict is withheld", !/Why:/.test(bs));

console.log("\n--- skipped rounds are not failed rounds ---");
tt("roll-call says so plainly",
   /roll-call/i.test(briefFor({prompt:"Q",outcome:"divided",round_type:"indexical"},1)) &&
   /Not a disagreement/i.test(briefFor({prompt:"Q",outcome:"divided",round_type:"indexical"},1)));
tt("an operator note is distinguished",
   /note to the council/i.test(briefFor({prompt:"Q",outcome:"divided",round_type:"note"},2)));
tt("a narrator pass is distinguished",
   /narrator writing a summary/i.test(briefFor({prompt:"Q",outcome:"divided",round_type:"narrator"},3)));

console.log("\n--- every reason to discount a round is surfaced ---");
const doubted=briefFor({prompt:"Q",outcome:"verified",counts:"2/3",
  counterfoils:[{declared_seat:"gemini",proxy:true,actual_model:"ling-3.0-tiny"},
                {declared_seat:"kimi",proxy:false},{declared_seat:"claude",proxy:false}],
  header:{receipts:[{seat:"claude",absent:true}]},
  retrieval_hit:false, dispatch_source:"auto",
  external_input:{model:"gpt-5"}},10);
tt("a stand-in model is named, with who it stood in for",
   /ling-3\.0-tiny for gemini/.test(doubted));
tt("an absent seat is reported", /never answered at all/.test(doubted));
tt("empty retrieval warns about claims on older rounds",
   /treat any claim about older rounds with suspicion/.test(doubted));
tt("a timer-started round says so", /a timer started this round, not you/.test(doubted));
tt("outside testimony is flagged as not counting",
   /does not count toward agreement/.test(doubted));

console.log("\n--- a clean round carries no false caveats ---");
const clean=briefFor({prompt:"Q",outcome:"verified",counts:"3/3",
  counterfoils:[{declared_seat:"kimi",proxy:false}],retrieval_hit:true},11);
tt("no stand-in warning", !/stand-in/.test(clean));
tt("no timer warning", !/timer started/.test(clean));
tt("no retrieval warning", !/memory search found nothing/.test(clean));

console.log("\n--- rqState reports what is OPEN, not a score ---");
reset();
globalThis.ledger=[
  {outcome:"verified"},{outcome:"divided",cs:{verdict:"FIELD SKEW",gate:2,shadow:false}},
  {outcome:"divided"},{outcome:"divided",round_type:"indexical"},
  {outcome:"resolved"},
];
const st=rqState();
tt("it returns a result", !!st);
tt("skipped rounds are counted separately from open ones",
   st.skipped === 1 && st.open === 2);
tt("settled counts both verified and resolved", st.settled === 2);
tt("degraded rounds are identified within the open set", st.degraded === 1);
tt("it does NOT report a bare percentage that invites the 80%-divided misreading",
   !LOGS.some(l=>/^\[STATE\][\s\S]*\d+% (divided|disagreement)/.test(l)));

console.log("\n--- degradation ---");
t("a null entry does not throw", briefFor(null, 1), "No round found.");
reset(); globalThis.ledger=[];
t("an empty ledger reports nothing to summarise", rqState(), null);
tt("and says so", LOGS.some(l=>/no rounds recorded yet/.test(l)));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
