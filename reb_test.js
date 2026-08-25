// v4.20.0 — the rebuttal pass and novelty detection (Kimi seat, round 157).
// The prompt builder and parsers are LIFTED AND RUN: this feature's entire
// safety rests on holding being free and revision being attributed, and a shape
// assertion cannot show either.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
globalThis.clipX=null;
eval([grab(/  const clip = .*/),
      grab(/  function letterFor\(i\) \{.*\}/),
      grab(/  const RQ_REB_TIMEOUT_MS[\s\S]*?const RQ_REB_HOLD_RE = .*/),
      grab(/  function rebuttalPrompt\(originalQuery, positions, selfLetter\) \{[\s\S]*?\n  \}/)].join("\n")
     .replace(/^\s*const RQ_REB/gm,"var RQ_REB")
     + "\nglobalThis.rebuttalPrompt=rebuttalPrompt;globalThis.HOLD=RQ_REB_HOLD_RE;globalThis.CITE=RQ_REB_CITE_RE;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);

console.log("\n--- the instruction must not create a gradient toward agreement ---");
const pr=rebuttalPrompt("Should the floor stay at 0.600?",
  [{letter:"A",seat:"gemini",text:"Keep it."},{letter:"B",seat:"kimi",text:"Lower it."}],"A");
tt("HOLDING is stated as the default", /HOLDING IS THE DEFAULT AND COSTS NOTHING/.test(pr));
tt("surviving contact is framed as the STRONGER result",
   /stronger result than one that moves/.test(pr));
tt("revising to reduce disagreement is explicitly forbidden",
   /Do not revise to reduce disagreement/.test(pr));
tt("an uncited revision is named as drift, not reasoning",
   /recorded as UNATTRIBUTED, which is treated as drift rather than reasoning/.test(pr));
tt("the seat sees its OWN position", /You submitted Position A/.test(pr));
tt("and the others, anonymised by letter", /Position B/.test(pr) && !/kimi/.test(pr));
tt("it is told the others answered blind", /without seeing yours/.test(pr));

console.log("\n--- HOLD detection ---");
tt("[HOLD] is recognised", HOLD.test("[HOLD]"));
tt("bare HOLD is recognised", HOLD.test("HOLD"));
tt("a revision is not mistaken for a hold", !HOLD.test("MOVED BY POSITION B: their point about recall."));

console.log("\n--- attribution is mandatory for a revision ---");
const m=CITE.exec("MOVED BY POSITION B: the recall argument.\nMy revised position...");
tt("the citing line is parsed", !!m);
t("and the source letter captured", m[1].toUpperCase(), "B");
tt("a revision with no citation does not parse",
   !CITE.exec("I have changed my mind after reading the others."));

console.log("\n--- shape: openings survive, and the herding guard is real ---");
tt("openings are frozen BEFORE the pass runs",
   src.indexOf("_openingPositions = eligible.map") < src.indexOf("runRebuttalPass(query"));
tt("and stored SEPARATELY from positions", /opening_positions: \(_openingPositions \|\| \[\]\)/.test(src));
tt("uncited revisions are flagged in the log",
   /UNATTRIBUTED/.test(src) && /herding signature this pass was designed against/.test(src));
tt("the round-87 herding warning is cited as the design constraint",
   /Convergence isn't correctness/.test(src));
tt("the pass is skipped on note and indexical rounds",
   /rebuttalEnabled\(\) && eligible\.length >= 2 && !_noteRound && !_indexicalRound/.test(src));
tt("a failed pass does not fail the round",
   /round continues on the opening positions/.test(src));

console.log("\n--- novelty detection is conservative by construction ---");
tt("a claim counts as novel only if far from EVERY opening",
   /if \(nearest >= RQ_NOVEL_FAR\)/.test(src));
tt("no embed worker means UNKNOWN, not 'no novelty'",
   /result is UNKNOWN, not 'no novelty found'/.test(src));
tt("the deflationary result is stated as EXPECTED, not as failure",
   /That is the\s+\/\/|DEFLATIONARY result and it is the expected one/.test(src));
tt("findings are labelled CANDIDATE with the threshold's status",
   /CANDIDATE ONLY — the threshold is fitted to nothing/.test(src));
tt("flag defaults OFF", /localStorage\.getItem\("rq_rebuttal"\) === "on"/.test(src));
tt("the +1 call per seat cost is on the flag", /\+1 CALL PER SEAT/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
