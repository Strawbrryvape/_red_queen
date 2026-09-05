// v4.28.0 — Write Courier v1 (Claude seat spec, round 50). The gates are LIFTED
// AND RUN. Every one of them is a refusal, and a refusal that only exists in a
// comment is not a refusal.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[]; const STORE={};
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.localStorage={getItem:(k)=>k==="rq_write_courier"?"on":(k in STORE?STORE[k]:null),
                         setItem:(k,v)=>{STORE[k]=String(v);}, removeItem:(k)=>{delete STORE[k];}};
globalThis.seatLabel=(n)=>n;
globalThis.ledger=[];
eval([grab(/  const clip = .*/), grab(/  function ftDigest\(s\) \{[\s\S]*?\n  \}/),
      grab(/  const RQ_WR_MAX_PAYLOAD[\s\S]*?const RQ_WR_RE = .*/).replace(/^\s*const /gm,"var "),
      grab(/  const RQ_WR_FORBIDDEN_HOST = .*/).replace(/^\s*const /,"var "),
      grab(/  function writeCourierEnabled\(\) \{.*\}/),
      "var _wrProposal = null;",
      grab(/  function wrScanProposal\(answers, roundTrust, agreedSeats\) \{[\s\S]*?\n  \}/),
      grab(/  function wrReview\(\) \{[\s\S]*?\n  \}/),
      grab(/  function wrCancel\(\) \{[\s\S]*?\n  \}/),
      grab(/  const RQ_WR_INSTRUCTION =[\s\S]*?out of scope\.";/).replace(/^\s*const /,"var ")].join("\n") +
     "\nglobalThis.wrScanProposal=wrScanProposal;globalThis.wrReview=wrReview;globalThis.wrCancel=wrCancel;" +
     "globalThis.INSTR=RQ_WR_INSTRUCTION;globalThis.getProp=()=>_wrProposal;globalThis.RE=RQ_WR_RE;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const reset=()=>{LOGS.length=0;};
const A=(txt)=>[{name:"kimi",text:txt}];
const REQ='[WRITE_REQUEST: POST https://api.github.com/gists | payload={"files":{}}]';

console.log("\n--- THE CONSENSUS GATE: VERIFIED 3/3 or nothing ---");
reset(); t("VERIFIED 3/3 produces a proposal", !!wrScanProposal(A(REQ),"verified",["a","b","c"]), true);
reset(); t("VERIFIED 2/3 does NOT", wrScanProposal(A(REQ),"verified",["a","b"]), null);
reset(); t("DIVIDED does NOT", wrScanProposal(A(REQ),"divided",[]), null);
reset(); t("PROVISIONAL does NOT", wrScanProposal(A(REQ),"provisional",["a","b","c"]), null);
reset(); wrScanProposal(A(REQ),"resolved",["a","b","c"]);
tt("RESOLVED does not qualify either, and says why",
   LOGS.some(l=>/a write requires VERIFIED 3\/3/.test(l)));
tt("and the refusal is logged as WRITE_REJECTED with no call made",
   LOGS.some(l=>/WRITE_REJECTED — no network call was made/.test(l)));

console.log("\n--- SCOPE: refused before the operator is ever asked ---");
reset();
t("a payments host is refused",
  wrScanProposal(A('[WRITE_REQUEST: POST https://api.stripe.com/v1/charges | payload={}]'),"verified",["a","b","c"]), null);
tt("and it never reaches a confirmation dialog",
   LOGS.some(l=>/financial endpoint, which is out of scope/.test(l)));
reset();
t("an oversized payload is refused",
  wrScanProposal(A('[WRITE_REQUEST: POST https://api.github.com/gists | payload='+"x".repeat(8100)+']'),"verified",["a","b","c"]), null);

console.log("\n--- DELETE cannot even be expressed ---");
const U="https://api.github.com/gists";
tt("the grammar accepts POST/PUT/PATCH",
   RE.test('[WRITE_REQUEST: POST '+U+']') && RE.test('[WRITE_REQUEST: PUT '+U+']') &&
   RE.test('[WRITE_REQUEST: PATCH '+U+']'));
tt("DELETE cannot be expressed", !RE.test('[WRITE_REQUEST: DELETE '+U+']'));
tt("GET cannot either \u2014 a read is not a write and belongs to the read Courier",
   !RE.test('[WRITE_REQUEST: GET '+U+']'));
tt("http:// is not accepted, only https",
   !RE.test('[WRITE_REQUEST: POST http://api.github.com/gists]'));
tt("the omission is deliberate and documented",
   /DELETE is absent from the grammar above by design, not oversight/.test(src));

console.log("\n--- the proposal is a PROPOSAL ---");
reset(); wrScanProposal(A(REQ),"verified",["a","b","c"]);
tt("nothing is sent", LOGS.some(l=>/NOTHING HAS BEEN SENT/.test(l)));
tt("the operator is named as the signature",
   LOGS.some(l=>/The council drafted this; you are the signature/.test(l)));
tt("the tally is captured AT PROPOSAL TIME for later re-checking",
   getProp().tally.agreed.length === 3 && getProp().tally.trust === "verified");
tt("a manifest digest is taken", typeof getProp().digest === "string");

console.log("\n--- review is plain language, and states reversibility ---");
reset(); wrReview();
tt("the host is named", LOGS.some(l=>/api\.github\.com/.test(l)));
tt("the authorising tally is shown", LOGS.some(l=>/authorised by: VERIFIED/.test(l)));
tt("reversibility is stated", LOGS.some(l=>/Reversibility/i.test(l)));
reset();
wrScanProposal(A('[WRITE_REQUEST: POST https://api.example.com/send-email | payload={}]'),"verified",["a","b","c"]);
wrReview();
tt("an unknown-undo target is flagged BEFORE execution, not after",
   LOGS.some(l=>/NO UNDO PATH IS KNOWN/.test(l) && /may not be\s*possible to take back|not be possible to take back/.test(l)));

console.log("\n--- the operator can always refuse ---");
reset(); t("cancel discards it", wrCancel(), true);
tt("logged as WRITE_REJECTED", LOGS.some(l=>/WRITE_REJECTED by the operator/.test(l)));
t("and nothing remains pending", getProp(), null);

console.log("\n--- shape: what was DECLINED from the rival spec ---");
// The only "tier 2" in the file is an unrelated fallback-provider comment.
tt("no autonomous execution path exists",
   !/bounded_autonomy|autoExecute|autoWrite|executeOnConsensus/i.test(src));
tt("every execution path requires the operator",
   /async function wrConfirm\(token, opts\)/.test(src) &&
   !/wrConfirm\(\)[\s\S]{0,200}setTimeout|setInterval[\s\S]{0,200}wrConfirm/.test(src));
tt("the decline is documented in SOURCE with its reason",
   /NOT BUILT, AND NOT DEFERRED — DECLINED/.test(src) &&
   /must not POST to the open internet/.test(src));
tt("and it cites the doctrine it would have contradicted",
   /OWN MEMORY unreviewed/.test(src) && /R-P7-10/.test(src));
tt("tokens are a parameter, never read from storage",
   /async function wrConfirm\(token, opts\)/.test(src) && !/getItem\("rq_write_token"\)/.test(src));
tt("and are zeroed after the call", /token = null;/.test(src));
tt("the atomicity check enforces the seat's own falsifier",
   /the authorising consensus is no longer the current verdict/.test(src) &&
   /would make the safety model illusory/.test(src));
tt("three outcomes are distinct, per the round-48/49 lesson",
   /WRITE_OK/.test(src) && /WRITE_BLOCKED/.test(src) && /WRITE_REJECTED/.test(src));
tt("a CORS refusal is called environmental, not a council failure",
   /ENVIRONMENTAL, not a council failure/.test(src));
tt("the receipt records who authorised it", /authorised_by=/.test(src) && /proposed_by=/.test(src));
tt("seats are told nothing fires automatically", /Nothing fires automatically, ever/.test(INSTR));
tt("and are asked for a falsifier ON THE ACTION", /falsifier for the action itself/.test(INSTR));
tt("flag defaults OFF", /localStorage\.getItem\("rq_write_courier"\) === "on"/.test(src));

console.log("\n--- v4.29.0: the signature must be reachable on a phone ---");
// Confirmation was console-only. A gate nobody can pass is not a safety
// feature, it is a dead feature.
tt("a panel is rendered when a proposal survives the gates",
   /function wrPanel\(\)/.test(src) && /wrPanelClose\(\); wrPanel\(\);/.test(src));
tt("it is built with DOM calls, not innerHTML, because every value is model-authored",
   /every value here is\s+\/\/ model-authored|const mk = \(cls, txt\)/.test(src) &&
   /e\.textContent = txt/.test(src));
tt("the gates are unchanged \u2014 the panel routes through wrConfirm",
   /await wrConfirm\(t, \{ irreversible: !reversible \}\)/.test(src));
tt("an irreversible target gets a different button and a warning class",
   /is-irreversible/.test(src) && /Send anyway/.test(src));
tt("the token field is cleared before the await, not after",
   /tok\.value = "";\s*\/\/ clear the field before the await/.test(src));
tt("a pending proposal EXPIRES when a new round starts",
   /the pending proposal expired/.test(src) && /no longer current\. WRITE_REJECTED/.test(src));
tt("the panel says nothing has been sent",
   /Nothing has been sent\. This proposal expires/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
