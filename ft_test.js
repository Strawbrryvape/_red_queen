// v4.4.0 — targeted full-text request + CONFIRMATION round type.
// Parsers lifted verbatim; the rest are shape assertions, because the risks
// here are absences: an unbounded injection path, a request honoured from
// untrusted text, an operator closure stored as a council verdict.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
eval(grab(/  const RQ_FT_MAX_ROUNDS[\s\S]*?const RQ_FT_RE = .*/) +
     "\nglobalThis.RQ_FT_RE=RQ_FT_RE;globalThis.RQ_FT_MAX_ROUNDS=RQ_FT_MAX_ROUNDS;globalThis.RQ_FT_MAX_CHARS=RQ_FT_MAX_CHARS;");
eval(grab(/  const RQ_CONFIRMATION_RE = [\s\S]*?\n  \}/) + "\nglobalThis.isConfirmationRound=isConfirmationRound;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)+" want "+JSON.stringify(w)));};
const tt=(n,c)=>t(n,!!c,true);
const ids=(s)=>{const m=RQ_FT_RE.exec(s);if(!m)return[];const out=[];
  String(m[1]).split(",").forEach(x=>{const n=parseInt(x.trim(),10);if(isFinite(n)&&n>0&&out.indexOf(n)===-1)out.push(n);});return out;};

console.log("\n--- request parsing (model output is UNTRUSTED: digits only) ---");
t("single round", ids("I need more. [REQUEST_FULLTEXT: 173]"), [173]);
t("multiple rounds", ids("[REQUEST_FULLTEXT: 173, 174, 9]"), [173,174,9]);
t("case-insensitive", ids("[request_fulltext: 12]"), [12]);
t("duplicates collapse", ids("[REQUEST_FULLTEXT: 5, 5, 5]"), [5]);
t("no request => nothing", ids("I have enough context, thanks."), []);
t("zero and negatives rejected", ids("[REQUEST_FULLTEXT: 0, -3, 7]"), [7]);
t("non-numeric junk is dropped, not executed",
  ids("[REQUEST_FULLTEXT: 12, DROP TABLE, ../../etc/passwd, 13]"), [12,13]);
t("prose inside the brackets cannot smuggle anything",
  ids("[REQUEST_FULLTEXT: all of them please]"), []);

console.log("\n--- bounds: 'exempt from the budget' must still be capped ---");
tt("a round cap exists", RQ_FT_MAX_ROUNDS === 3);
tt("a char cap exists", RQ_FT_MAX_CHARS === 6000);
tt("over-cap requests are truncated AND logged",
   /requested, cap is/.test(src) && /DROPPING/.test(src));
tt("the block is hard-truncated at the char cap",
   /block\.length > RQ_FT_MAX_CHARS/.test(src) && /block truncated at/.test(src));
tt("the measured Spine arithmetic is cited as the reason for the cap",
   /19,445/.test(src) && /measured 2026-08-11/.test(src) && /324% of the/.test(src));
tt("the first regex's fail-closed defect is documented",
   /FAILED CLOSED IN THE WRONG DIRECTION/.test(src));

console.log("\n--- misses fail VISIBLY, never as an empty round ---");
tt("out-of-ledger ordinals are reported", /are not in this browser's ledger/.test(src));
tt("missing verbatim copy is labelled, not silently blank",
   /full text unavailable on this device/.test(src));
tt("ordinal lookup is bounds-checked",
   /if \(idx < 0 \|\| idx >= ledger\.length\) return null;/.test(src));

console.log("\n--- a request is consumed once, not standing ---");
tt("_ftPending is cleared on use", /_ftPending = \[\];\s+\/\/ consume once/.test(src));
tt("injection happens on the NEXT round, not the requesting one",
   /will be injected verbatim on the next round/.test(src));

console.log("\n--- CONFIRMATION rounds ---");
tt("'Confirm:' opener detected", isConfirmationRound("Confirm: we go with Kimi's build order."));
tt("'Council, confirm' detected", isConfirmationRound("Council, confirm you accept this."));
tt("an ordinary question is not a confirmation", !isConfirmationRound("Should we lower the floor?"));
tt("the word confirm mid-sentence does not trigger",
   !isConfirmationRound("Can you confirm whether fog forms at night?"));
tt("bypasses adjudication like note rounds", /if \(_confirmationRound\) \{/.test(src));
tt("carries its own trust literal", /trust: "resolved-by-operator"/.test(src));
tt("that literal is NOT the 'resolved' branch",
   src.indexOf('result.trust === "resolved-by-operator"') < src.indexOf('} else if (result.trust === "resolved")'));
tt("the banner says plainly it is not verified",
   /NOT a council verdict and NOT verified/.test(src));
tt("seat caveats are preserved rather than scored as disagreement",
   /Caveats attached by seats are preserved, /.test(src) && /not scored as disagreement/.test(src));

console.log("\n--- both flags default OFF and say so at boot ---");
tt("rq_fulltext_retrieve defaults off",
   /localStorage\.getItem\("rq_fulltext_retrieve"\) === "on"/.test(src));
tt("rq_confirmation defaults off",
   /localStorage\.getItem\("rq_confirmation"\) === "on"/.test(src));
tt("full-text flag warns it changes seat context",
   /SEATS READ THIS[\s\S]{0,200}REQUEST_FULLTEXT/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
