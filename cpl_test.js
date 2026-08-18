// v4.10.0 — Causal Provenance Layer. Kimi seat spec, round 46.
// The write API is LIFTED AND RUN, not merely inspected: its whole value is the
// refusal invariant, and a shape assertion cannot prove a refusal happens.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
let STORE="[]"; const LOGS=[];
globalThis.localStorage={ getItem:(k)=>k==="rq_cpl"?"on":(k==="rq_cpl_events_v1"?STORE:null),
                          setItem:(k,v)=>{ if(k==="rq_cpl_events_v1") STORE=v; },
                          removeItem:()=>{STORE="[]";} };
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.crypto={ randomUUID:()=>"id-"+(Math.random().toString(16).slice(2)) };
globalThis.window={};
eval(grab(/  function ftDigest\(s\) \{[\s\S]*?\n  \}/) + "\n" +
     grab(/  const RQ_CPL_KEY[\s\S]*?\n  \} catch \(_\) \{\}\n/).replace(/try \{\n    window\.__rqPuppetIndex[\s\S]*$/,"") +
     "\nglobalThis.cplWrite=cplWrite;globalThis.cplPuppetIndex=cplPuppetIndex;globalThis.cplLoad=cplLoad;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const reset=()=>{STORE="[]";LOGS.length=0;};

console.log("\n--- THE INVARIANT: no event without a cause (spec, verbatim) ---");
reset();
t("no causation object => REFUSED", cplWrite("seat_call", null, {}), null);
tt("and it says why", LOGS.some(l=>/REFUSED[\s\S]*no causation object/.test(l)));
reset();
t("unknown trigger_type => REFUSED",
  cplWrite("seat_call", {trigger_type:"vibes", detail:"x"}, {}), null);
reset();
t("empty detail => REFUSED (a type without a reason is not provenance)",
  cplWrite("seat_call", {trigger_type:"operator", detail:"   "}, {}), null);
reset();
t("unknown kind => REFUSED", cplWrite("telepathy", {trigger_type:"operator", detail:"x"}, {}), null);
reset();
t("nothing was written by any refusal", cplLoad().length, 0);

console.log("\n--- root inheritance ---");
reset();
const root = cplWrite("round_invoke", {trigger_type:"operator", parent_event_id:null, detail:"operator submitted a prompt"});
const seat = cplWrite("seat_call", {trigger_type:"internal_state", parent_event_id:root, detail:"dispatch asked gemini"});
const fb   = cplWrite("fallback",  {trigger_type:"internal_state", parent_event_id:seat, detail:"gemini fell to cerebras"});
const rows = cplLoad();
const byId = Object.fromEntries(rows.map(r=>[r.id,r]));
tt("a parentless event is its own root", byId[root].causation.root_event_id === root);
tt("a child inherits the root", byId[seat].causation.root_event_id === root);
tt("a GRANDCHILD inherits the same root (fallback -> seat_call -> round)",
   byId[fb].causation.root_event_id === root);
tt("the fallback names the failed seat_call as parent (spec acceptance test 2)",
   byId[fb].causation.parent_event_id === seat);

console.log("\n--- the puppet index ---");
reset();
cplWrite("round_invoke", {trigger_type:"operator", parent_event_id:null, detail:"operator submitted a prompt"});
const auto = cplWrite("round_invoke", {trigger_type:"schedule", parent_event_id:null, detail:"scheduler fired"});
cplWrite("seat_call", {trigger_type:"internal_state", parent_event_id:auto, detail:"dispatch asked kimi"});
const idx = cplPuppetIndex();
t("counts CHAINS, not events (3 events, 2 roots)", idx.chains, 2);
t("one operator-rooted chain", idx.counts.operator, 1);
t("one schedule-rooted chain", idx.counts.schedule, 1);
tt("percentages are reported", LOGS.some(l=>/operator-rooted: 50%/.test(l)));
tt("a high operator share is framed as a BASELINE, not a failing",
   LOGS.some(l=>/it is a baseline, not a failing/.test(l)));

console.log("\n--- an unresolvable root is UNRESOLVED, never assumed operator ---");
reset();
STORE = JSON.stringify([{ id:"a", ts:"t", kind:"seat_call",
  causation:{trigger_type:"internal_state", parent_event_id:"gone", root_event_id:"gone", detail:"orphan"} }]);
const orphan = cplPuppetIndex();
t("the orphan chain counts as unresolved", orphan.counts.unresolved, 1);
t("and is NOT counted as operator", orphan.counts.operator, 0);
tt("the log names the reason", LOGS.some(l=>/root outside the retained window/.test(l)));

console.log("\n--- shape: instrumentation and honesty ---");
tt("round_invoke derives schedule vs operator, never assumes",
   /trigger_type: _autoThisRound \? "schedule" : "operator"/.test(src));
tt("consolidation is SCHEDULE-rooted, not operator-rooted",
   /kind[\s\S]{0,80}consolidation[\s\S]{0,200}trigger_type: "schedule"/.test(src) ||
   /cplWrite\("consolidation", \{\s*\n\s*trigger_type: "schedule"/.test(src));
tt("the cap trims oldest-first and says so", /oldest event\(s\) dropped/.test(src));
tt("the digest is called a digest, not a hash chain",
   /payload_digest/.test(src) && !/payload_hash/.test(src));
tt("the D-B deviation is documented", /a second, weaker chain here would look like/.test(src) ||
   /calling this a hash chain would overstate it/.test(src));
tt("flag defaults OFF", /localStorage\.getItem\("rq_cpl"\) === "on"/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
