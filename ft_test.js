// v4.4.0 — targeted full-text request + CONFIRMATION round type.
// Parsers lifted verbatim; the rest are shape assertions, because the risks
// here are absences: an unbounded injection path, a request honoured from
// untrusted text, an operator closure stored as a council verdict.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
eval(grab(/  const RQ_FT_MAX_ROUNDS[\s\S]*?const RQ_FT_RE = .*/) +
     "\nglobalThis.RQ_FT_RE=RQ_FT_RE;globalThis.RQ_FT_MAX_ROUNDS=RQ_FT_MAX_ROUNDS;globalThis.RQ_FT_MAX_CHARS=RQ_FT_MAX_CHARS;");
eval(grab(/  function fiatPreFilter\(query\) \{[\s\S]*?\n  \}/).replace("function fiatPreFilter","globalThis.__fpf = function fiatPreFilter") +
     "\n" + grab(/  const FIAT_DIRECTIVE_PATTERNS = \[[\s\S]*?\];/) + "\nglobalThis.FIAT_DIRECTIVE_PATTERNS=FIAT_DIRECTIVE_PATTERNS;");
// fiatPreFilter reads module state and localStorage; re-implement the MATCHING
// rule alone, from the frozen pattern list lifted above, to test anchoring.
globalThis.fiatMatch = (q) => {
  const lines = String(q||"").split("\n");
  for (let i=0;i<lines.length;i++){ const l=lines[i].trimStart().toLowerCase(); if(!l) continue;
    for (const pat of FIAT_DIRECTIVE_PATTERNS) if (l.indexOf(pat)===0) return {pattern:pat,line:i};
  } return null; };

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
// v4.7.3 — truncation moved off the assembled block onto the BODY, so the
// receipt header can never be the thing that gets cut. A receipt truncated
// away would be the worst possible failure of this feature.
tt("the body is truncated, leaving room for the receipt",
   /const cap = RQ_FT_MAX_CHARS - 320;/.test(src) && /body\.slice\(0, cap - 1\)/.test(src));
tt("truncation is declared IN the receipt, not just the drawer",
   /TRUNCATED at the " \+ RQ_FT_MAX_CHARS \+ "-char cap/.test(src));
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
tt("the pending queue is cleared on use", /ftPendingSet\(\[\]\);\s+\/\/ consume once/.test(src));
tt("v4.7.3: the queue PERSISTS, so a reload cannot silently eat a request",
   /localStorage\.setItem\(RQ_FT_PEND_K/.test(src) && /const RQ_FT_PEND_K = "rq_ft_pending"/.test(src));
tt("a non-delivery gets its own receipt rather than silence",
   /NOT DELIVERED/.test(src) && /Do not infer content you were not given/.test(src));
tt("the receipt reaches the SEAT, not only the drawer",
   /return "\\n\\n" \+ none;/.test(src) && /receipt \+ "\\n\\n" \+ body/.test(src));
tt("the one-round lag is stated to the seats", /lag=1 round/.test(src));
tt("injection happens on the NEXT round, not the requesting one",
   /will be injected verbatim on the next round/.test(src));

console.log("\n--- SPEC-PS-F0: directive detection is LINE-ANCHORED ---");
tt("message-initial directive matches", !!fiatMatch("We will adopt the merged pipeline."));
tt("standalone-line directive matches", !!fiatMatch("Some preamble.\nAdopt the capture-trace-render order."));
tt("MID-SENTENCE mention never matches",
   !fiatMatch("The seats keep disagreeing — should we override the plan?"));
tt("a question containing 'adopt' mid-line never matches",
   !fiatMatch("Do you think we should adopt this?"));
tt("leading whitespace is tolerated", !!fiatMatch("   operator fiat: proceed."));

console.log("\n--- the four-test gate, and where it runs ---");
tt("the gate exists", /function fiatAcknowledgeTest\(/.test(src));
tt("it runs on the WOULD-BE-DIVIDED path, after adjudication",
   src.indexOf("const adj = await runAdjudication") < src.indexOf("if (_fiatCandidate && fiatRecognitionMode()"));
tt("a COUNTED REFUTE fails the gate",
   /v\.counted && v\.verdict === "refute"/.test(src) && /real dissent, staying divided/.test(src));
tt("NO verdict stream fails the gate (unverifiable != absent)",
   /acknowledgment UNVERIFIABLE, staying divided/.test(src));
tt("a thin first line fails the gate", /acknowledgment unreadable, staying divided/.test(src));
tt("the asymmetry is stated in the source",
   /False negatives are safe; false positives hide real\s+\/\/ dissent|false positives hide real/.test(src));

console.log("\n--- v4.4.0's bypass is GONE (it could tag over a refute) ---");
tt("no _confirmationRound anywhere", !/_confirmationRound/.test(src));
tt("no rq_confirmation flag", !/rq_confirmation/.test(src));
tt("the removal is documented, not silent", /bypass that stood here has been REMOVED/.test(src));

console.log("\n--- the tag never merges with adjudication's 'resolved' ---");
tt("separate trust literal", /trust: "resolved-by-operator"/.test(src));
tt("separate TRUST_COLORS entry", /"resolved-by-operator": "#0f766e"/.test(src));
tt("separate p2TrustTag case", /case "resolved-by-operator": return "RESOLVED-BY-OPERATOR"/.test(src));
tt("P4 records it rather than scoring fragility over an empty agreeing set",
   /verdict: "RESOLVED-BY-OPERATOR"/.test(src));
tt("seat stats exclude it from the consensus bucket",
   /not consensus — no bucket/.test(src));

console.log("\n--- default is SHADOW, not off and not live ---");
tt("unset key resolves to shadow", /\(v === "off" \? "off" : "shadow"\)/.test(src));
tt("shadow logs a would-tag and changes nothing", /WOULD tag RESOLVED-BY-OPERATOR/.test(src));
tt("shadow rides as an additive key only", /\.\.\.\(_fiatShadow \? \{ fiat: _fiatShadow \} : \{\}\)/.test(src));

console.log("\n--- both flags default OFF and say so at boot ---");
tt("rq_fulltext_retrieve defaults off",
   /localStorage\.getItem\("rq_fulltext_retrieve"\) === "on"/.test(src));
tt("rq_fiat_recognition is tri-state, not a binary flag",
   /localStorage\.getItem\("rq_fiat_recognition"\)/.test(src) && !/rq_fiat_recognition"\) === "on"/.test(src));
tt("full-text flag warns it changes seat context",
   /SEATS READ THIS[\s\S]{0,200}REQUEST_FULLTEXT/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
