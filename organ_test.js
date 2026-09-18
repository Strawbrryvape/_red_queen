// v4.35.0 — Plastic Organ slice 1 (spec v1.3.1, Component A data layer).
// The writer, the enum guard, the digest rules and the chain check are LIFTED
// AND RUN. Every one of them is a refusal or an assertion, and a refusal that
// exists only in a comment is not a refusal.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[]; const STORE={};
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.localStorage={getItem:(k)=>(k in STORE?STORE[k]:null),setItem:(k,v)=>{STORE[k]=String(v);},removeItem:(k)=>{delete STORE[k];}};
globalThis.ledger=[];
globalThis.RQ_BUILD="v4.35.0-test";
globalThis.RQ_SESSION_ID="sess_test";
globalThis.navigator={userAgent:"UA",platform:"P"};
globalThis.p2SecretRaw=()=>"secret";
globalThis.crypto={randomUUID:()=>"uuid-"+Math.random().toString(16).slice(2)};
// controllable sha256 so the null-digest path is exercisable
let SHA_OK=true;
globalThis.p2Sha256=async(t)=>SHA_OK?("h"+String(t).length+"_"+String(t).split("").reduce((a,c)=>(a*31+c.charCodeAt(0))>>>0,7).toString(16)):null;
eval([grab(/  const RQ_ORGAN_KEY[\s\S]*?const RQ_ORGAN_DIM      = .*/).replace(/^\s*const /gm,"var "),
      grab(/  const RQ_ORGAN_CAUSES = \[[\s\S]*?\n  \];/).replace(/^\s*const /,"var "),
      grab(/  function organMode\(\) \{[\s\S]*?\n  \}/),
      grab(/  function organEnabled\(\) \{.*\}/),
      "var _organSig=null,_organSelfTest=null,_organTrimWarned=false;",
      grab(/  async function organSelfTest\(\) \{[\s\S]*?\n  \}/),
      grab(/  async function organSignature\(\) \{[\s\S]*?\n  \}/),
      grab(/  function organLoad\(\) \{[\s\S]*?\n  \}/),
      grab(/  function organSave\(rows\) \{[\s\S]*?\n  \}/),
      grab(/  function organCanonical\(state\) \{[\s\S]*?\n  \}/),
      grab(/  function organL2Delta\(prior, post\) \{[\s\S]*?\n  \}/),
      grab(/  function organVectorLoad\(\) \{[\s\S]*?\n  \}/),
      grab(/  async function organWrite\([\s\S]*?\n  \}/),
      grab(/  function organVerifyChain\(component\) \{[\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.organWrite=organWrite;globalThis.organMode=organMode;globalThis.organLoad=organLoad;" +
     "globalThis.organVerifyChain=organVerifyChain;globalThis.organL2Delta=organL2Delta;" +
     "globalThis.organCanonical=organCanonical;globalThis.organVectorLoad=organVectorLoad;" +
     "globalThis.setSelfTest=(v)=>{_organSelfTest=v;};globalThis.CAUSES=RQ_ORGAN_CAUSES;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const reset=()=>{Object.keys(STORE).forEach(k=>delete STORE[k]);LOGS.length=0;SHA_OK=true;setSelfTest(null);};
const S=(v,r,tt_)=>({v:v,updated_rounds:r||0,last_round_t:tt_||null});

(async () => {
console.log("\n--- OFF is the default and means byte-identical ---");
reset();
t("no flag reads as off", organMode(), "off");
t("and the writer refuses", await organWrite("A","genesis",S([0]),S([1])), null);
t("nothing was stored", organLoad().length, 0);
STORE["rq_plastic_organ_a"]="junk"; t("an unknown value is off, not on", organMode(), "off");
STORE["rq_plastic_organ_a"]="shadow"; t("shadow is recognised", organMode(), "shadow");
STORE["rq_plastic_organ_a"]="live"; t("live is recognised", organMode(), "live");

console.log("\n--- \u00a74.4 the cause enum is CLOSED ---");
reset(); STORE["rq_plastic_organ_a"]="shadow";
t("an unknown cause is refused", await organWrite("A","vibes",S([0]),S([1])), null);
tt("and named as a bug, not a new state", LOGS.some(l=>/The enum is closed/.test(l) && /a bug, not a new state/.test(l)));
t("nothing written by the refusal", organLoad().length, 0);
tt("the three halt states are distinct enum values",
   CAUSES.includes("eval_halt") && CAUSES.includes("eval_infra_halt") && CAUSES.includes("kill_purge"));

console.log("\n--- \u00a74.2 a null digest is a chain break, never a pass ---");
reset(); STORE["rq_plastic_organ_a"]="shadow"; SHA_OK=false;
t("self-test failure refuses the write", await organWrite("A","genesis",S([0]),S([1])), null);
tt("and says a secure context is required", LOGS.some(l=>/secure context required/.test(l)));
t("no null-digest receipt was stored", organLoad().length, 0);

console.log("\n--- \u00a74.3 chain assertion ---");
reset(); STORE["rq_plastic_organ_a"]="shadow";
const r1 = await organWrite("A","genesis",S([0,0]),S([1,0]),{});
tt("a receipt is written", !!r1);
tt("digests are sha256-prefixed", /^sha256:/.test(r1.state_digest_prior) && /^sha256:/.test(r1.state_digest_post));
const r2 = await organWrite("A","fixed_rule_update",S([1,0]),S([1,1]),{});
t("a continuous chain produces no break", LOGS.filter(l=>/chain break/.test(l)).length, 0);
reset(); STORE["rq_plastic_organ_a"]="shadow";
await organWrite("A","genesis",S([0,0]),S([1,0]),{});
await organWrite("A","fixed_rule_update",S([9,9]),S([9,8]),{});   // prior != previous post
tt("a discontinuity IS reported", LOGS.some(l=>/chain break — expected/.test(l)));
tt("and explicitly NOT repaired", LOGS.some(l=>/Recorded, NOT repaired/.test(l)));

console.log("\n--- \u00a74.3 verification is WINDOWED, never overstated ---");
reset(); STORE["rq_plastic_organ_a"]="shadow";
await organWrite("A","genesis",S([0]),S([1]),{});
await organWrite("A","fixed_rule_update",S([1]),S([2]),{});
const v = organVerifyChain("A");
t("it reports the retained count", v.retained, 2);
t("no breaks on a clean chain", v.breaks, 0);
t("genesis reachable is reported", v.genesis_reachable, true);
reset(); STORE["rq_plastic_organ_a"]="shadow";
STORE["rq_organ_receipts_v1"]=JSON.stringify([
 {component:"A",mutation_cause:"fixed_rule_update",state_digest_prior:"sha256:a",state_digest_post:"sha256:b"},
 {component:"A",mutation_cause:"fixed_rule_update",state_digest_prior:"sha256:b",state_digest_post:"sha256:c"}]);
const v2 = organVerifyChain("A");
t("a chain without genesis says so", v2.genesis_reachable, false);
tt("and states the evicted prefix is uncovered",
   LOGS.some(l=>/evicted prefix is NOT covered/.test(l)));

console.log("\n--- \u00a74.2 normalized L2 delta ---");
t("identical states produce zero", organL2Delta([1,2,3],[1,2,3]), 0);
t("a zero vector is handled", organL2Delta([0,0],[0,0]), 0);
tt("pure scaling produces ~zero (direction unchanged)", organL2Delta([1,1],[2,2]) < 1e-6);
tt("a direction change is non-zero", organL2Delta([1,0],[0,1]) > 1);
tt("the range is bounded by 2", organL2Delta([1,0],[-1,0]) <= 2.000001);

console.log("\n--- canonical digest input is stable ---");
t("key order and precision are fixed",
  organCanonical({v:[0.1234567,2],updated_rounds:3,last_round_t:9}),
  JSON.stringify({v:["0.123457","2.000000"],updated_rounds:3,last_round_t:9}));

console.log("\n--- the vector store ---");
reset();
t("defaults to a zeroed 16-d vector", organVectorLoad().v.length, 16);
tt("all zeros", organVectorLoad().v.every(x=>x===0));

console.log("\n--- shape: what slice 1 deliberately does NOT do ---");
tt("ftDigest is forbidden for receipts and says why",
   /ftDigest is EXPLICITLY FORBIDDEN|ftDigest \(11591\) is explicitly forbidden|non-cryptographic by its own comment/.test(src));
tt("no retrieval influence is wired in this slice",
   !/organ[\s\S]{0,200}simFloor\(\)\s*=|organApplySeam/.test(src));
tt("the boot line states the seam is not built",
   /the seam is not built in\s+\/\/|The seam, retrieval influence, tripwires and the kill suite are NOT/.test(src));
tt("signature is named as client-identity, NOT hardware attestation",
   /hardware attestation/.test(src) && /determined operator can forge it/i.test(src));
tt("flag defaults OFF", /\(v === "shadow" \|\| v === "live"\) \? v : "off"/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
})();
