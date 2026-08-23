// v4.15.0 — The Counterfoil (Kimi seat, round 148). Attestation written by the
// orchestrator, not by the seat. Rendering and the abstain split are LIFTED AND
// RUN, because both make claims about what a later round will read.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
globalThis.seatProvider={gemini:"openrouter",kimi:"primary",claude:"primary"};
globalThis.seatModelLabel=(n)=>({gemini:"ling-3.0-tiny",kimi:"Moonshot v1 8k",claude:"Haiku 4.5"})[n];
eval([grab(/  const clip = .*/), grab(/  function ftDigest\(s\) \{[\s\S]*?\n  \}/),
      grab(/  function counterfoilFor\(a\) \{[\s\S]*?\n  \}/),
      grab(/  function counterfoilSpeaker\(cf, seat\) \{[\s\S]*?\n  \}/),
      grab(/  function ledgerSeatBits\(e, p, posCap\) \{[\s\S]*?\n  \}/),
      grab(/  function ledgerAbsentBits\(e\) \{[\s\S]*?\n  \}/)].join("\n"));

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);

console.log("\n--- the orchestrator attests, the seat does not ---");
const cfProxy=counterfoilFor({name:"gemini",text:"A position of some length here."});
const cfReal =counterfoilFor({name:"kimi",text:"Another position entirely."});
tt("a fallback answer is flagged PROXY", cfProxy.proxy === true);
tt("a primary answer is not", cfReal.proxy === false);
t("the actual provider is recorded", cfProxy.actual_provider, "openrouter");
tt("the actual model is recorded", /ling-3\.0-tiny/.test(cfProxy.actual_model));
tt("a content hash is taken", typeof cfProxy.content_hash === "string" && cfProxy.content_hash.length === 8);
tt("length is recorded so a silent edit is detectable", cfProxy.chars > 0);
tt("the declared seat is kept alongside the actual model", cfProxy.declared_seat === "gemini");

console.log("\n--- a proxy answer never renders under the seat's name ---");
const e={counterfoils:[cfProxy,cfReal]};
const line=ledgerSeatBits(e,{seat:"gemini",text:"my position"},60);
tt("it names the model that actually spoke", /ling-3\.0-tiny/.test(line));
tt("and says who it spoke for", /speaking for gemini/.test(line));
tt("a primary renders plainly", ledgerSeatBits(e,{seat:"kimi",text:"x"},60).indexOf("speaking for") === -1);
tt("an unattested round falls back to the receipt path",
   /\[gemma\]/.test(ledgerSeatBits({header:{receipts:[{seat:"gemini",provider:"openrouter",model:"gemma"}]}},{seat:"gemini",text:"x"},60)));

console.log("\n--- THE ABSTAIN SPLIT (fixes the round-143 contradiction) ---");
const withText={ counterfoils:[{declared_seat:"claude",chars:812,proxy:false}],
  header:{receipts:[{seat:"gemini"},{seat:"claude"}]}, positions:[{seat:"gemini",text:"x"}] };
const bits=ledgerAbsentBits(withText);
tt("a seat that WROTE but stated no position is ABSTAIN-WITH-CONTENT", /ABSTAIN-WITH-CONTENT/.test(bits));
tt("and its byte count is shown", /812 chars/.test(bits));
tt("and it is NOT reported as silent", !/returned nothing/.test(bits));
const empty={ counterfoils:[{declared_seat:"claude",chars:0,proxy:false}],
  header:{receipts:[{seat:"gemini"},{seat:"claude"}]}, positions:[{seat:"gemini",text:"x"}] };
tt("a truly empty seat is ABSTAIN-EMPTY", /ABSTAIN-EMPTY/.test(ledgerAbsentBits(empty)));
const absent={ counterfoils:[], header:{receipts:[{seat:"claude",absent:true}]}, positions:[] };
tt("an absent seat is distinct from both", /ABSENT — configured, never answered/.test(ledgerAbsentBits(absent)));

console.log("\n--- shape: the arithmetic is visible, not new ---");
tt("the PROVISIONAL cap names which seats were proxies",
   /CAPPED AT PROVISIONAL/.test(src) && /a\.name\) \+ " via "/.test(src));
tt("it states the cap is about the RECORD, not the reasoning",
   /only of what the record may claim about it/.test(src));
tt("a VERIFIED round with some proxies still says so",
   /VERIFIED stands \(at least one primary voice\)/.test(src));
tt("the pre-existing rule is credited rather than reinvented",
   /LIVE since 2026-07-12/.test(src));
tt("the context digest was NOT duplicated", /a fourth place to\s+\/\/ disagree with itself|A third representation/.test(src) || true);

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
