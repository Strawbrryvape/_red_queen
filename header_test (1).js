// Pillar VI Round Header suite. Logic lifted verbatim; the rest are shape
// assertions, because this build's real risks are absences and orderings:
// a header that silently omits an absent seat, an ask that leaks into the
// composed body, a column written without a migration.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
eval(grab(/  const RQ_META_RE = [\s\S]*?\n  \}/) + "\nglobalThis.classifyEpistemic=classifyEpistemic;");
eval(grab(/  const RQ_CONFIRMATION_RE = [\s\S]*?\n  \}/) + "\nglobalThis.isConfirmationRound=isConfirmationRound;");
eval(grab(/  const RQ_FALSIFIER_RE = .*/) + "\nglobalThis.RQ_FALSIFIER_RE=RQ_FALSIFIER_RE;");
let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);

console.log("\n--- epistemic_class (Decision 3) ---");
t("council question => META", classifyEpistemic("Should the council keep the similarity floor at 0.600?"), "META");
t("spine question => META", classifyEpistemic("Where should the Spine live?"), "META");
t("world question => EVIDENCE", classifyEpistemic("What causes coastal fog in summer?"), "EVIDENCE");
t("recipe => EVIDENCE", classifyEpistemic("Best way to braise short ribs?"), "EVIDENCE");
tt("null-safe", classifyEpistemic(null) === "EVIDENCE");

console.log("\n--- CONFIRMATION round type ---");
tt("'Confirm:' opener detected", isConfirmationRound("Confirm: we are going with Kimi's build order."));
tt("'Council, confirm' detected", isConfirmationRound("Council, confirm you accept this directive."));
tt("ordinary question is NOT a confirmation", !isConfirmationRound("Should we lower the floor?"));
tt("the word confirm mid-sentence does not trigger", !isConfirmationRound("Can you confirm whether fog forms at night?"));

console.log("\n--- falsifier parsing (never synthesised) ---");
const m1 = RQ_FALSIFIER_RE.exec("I hold position B.\nFALSIFIER: show me offline writes are a core workflow.");
t("parses the seat's own sentence", m1 && m1[1].trim(), "show me offline writes are a core workflow.");
t("absent falsifier yields no match", RQ_FALSIFIER_RE.exec("I hold position B, no more."), null);
tt("case-insensitive", !!RQ_FALSIFIER_RE.exec("falsifier: anything"));

console.log("\n--- shape: the header records ABSENCE as a datum ---");
tt("absent seats get an explicit receipt", /\[ABSENT \\u2014 no receipt\]|\[ABSENT — no receipt\]/.test(src));
tt("expected is derived from the CONFIGURED roster, not from answers",
   /const configured = Object\.keys\(seatProvider\)/.test(src));
tt("seats_expected and seats_recorded are separate fields",
   /seats_expected:/.test(src) && /seats_recorded:/.test(src));
tt("divergence_type is null rather than guessed when unknown",
   /function headerDivergenceType[\s\S]{0,700}return null;/.test(src));

console.log("\n--- shape: the falsifier ask does not contaminate the prompt hash ---");
const comp = src.slice(src.indexOf("const composedQuery ="), src.indexOf("const composedQuery =") + 400);
tt("ask is appended AFTER _composedBody", comp.indexOf("_composedBody") < comp.indexOf("RQ_FALSIFIER_ASK"));
tt("ask is gated on its OWN flag, not the header flag", /falsifierAskEnabled\(\) && !_noteRound/.test(comp));
tt("two independent flags exist",
   /localStorage\.getItem\("rq_round_header"\) === "on"/.test(src) &&
   /localStorage\.getItem\("rq_falsifier_ask"\) === "on"/.test(src));

console.log("\n--- shape: nothing unmigrated is written ---");
tt("epistemic_class is NOT sent as an rq_events column",
   !/epistemic_class:\s*_evEpistemic/.test(src) && !/_evEpistemic/.test(src));
tt("header rides the ledger as an additive spread",
   /\.\.\.\(_roundHeader \? \{ header: _roundHeader \} : \{\}\)/.test(src));

console.log("\n--- shape: no phantom identifiers ---");
tt("the Cyrillic typo is gone", !/isConfirmation\u0420Round/.test(src));
// The name survives in a COMMENT documenting the near-miss, which is wanted.
// Assert there is no CODE reference — that is the thing typeof would have hidden.
tt("no code reference to the phantom _csLastVerdict", !/typeof _csLastVerdict/.test(src));
tt("csVerdict is passed as an explicit null, not a hopeful lookup",
   /buildRoundHeader\(query, result, allAnswers, dispatchId, null\)/.test(src));
tt("buildRoundHeader returns null when the flag is off",
   /if \(!roundHeaderEnabled\(\)\) return null;/.test(src));

console.log("\n--- verdict reporting accuracy (v4.2.1) ---");
// The partition detector used to label a MIXED set of engaged verdicts with
// the first one's noun. A record that miscounts its own verdicts is worse
// than one that reports nothing.
tt("engaged verdicts are tallied, not generalised from the first",
   !/engaged\.length \+ " counted " \+ engaged\[0\]\.verdict/.test(src));
tt("each verdict type is counted separately",
   /engaged\.forEach\(\(v\) => \{ tally\[v\.verdict\] = \(tally\[v\.verdict\] \|\| 0\) \+ 1; \}\)/.test(src));
tt("the live mislabelling is documented in source",
   /silently relabelling two refutations as concessions/.test(src));

console.log("\n--- resolution honesty (v4.2.2) ---");
// RESOLVED used to assert that "every other seat conceded" even when seats
// were excluded as infrastructure and never spoke. The rule was right; the
// sentence was not.
tt("drawer line no longer asserts every other seat conceded",
   !/survived cross-examination; every other seat located a specific error in its own position and conceded\. Won by/.test(src));
tt("readable and unavailable counts are computed",
   /const _readable = positions\.length - _unavail;/.test(src) &&
   /verdicts\.filter\(\(v\) => v\.unavailable\)\.length/.test(src));
tt("counts are carried to the operator banner",
   /resolvedReadable: adj\.resolvedReadable/.test(src) && /result\.resolvedUnavailable/.test(src));
tt("banner names unavailable seats when there are any",
   /seat\(s\) were unavailable and never spoke/.test(src));
tt("the live overstatement is documented in source",
   /the sentence describing it was a lie/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
