// v4.32.0 — read aloud. The cleaner and the seat-voice mapping are LIFTED AND
// RUN: both make claims about what a listener actually hears, which a shape
// assertion cannot show.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[]; const STORE={};
globalThis.logError=(m)=>LOGS.push(String(m));
globalThis.localStorage={getItem:(k)=>k==="rq_voice"?"on":(k in STORE?STORE[k]:null),
                         setItem:(k,v)=>{STORE[k]=String(v);}, removeItem:(k)=>{delete STORE[k];}};
globalThis.window={};
eval([grab(/  const RQ_VOICE_RATE_K = .*/).replace(/^\s*const /,"var "),
      grab(/  function voiceEnabled\(\) \{.*\}/),
      grab(/  function voiceRate\(\) \{[\s\S]*?\n  \}/),
      "var _voices=[];function voiceLoad(){return _voices;}",
      grab(/  function voiceForSeat\(seat\) \{[\s\S]*?\n  \}/),
      grab(/  function voiceClean\(text\) \{[\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.voiceClean=voiceClean;globalThis.voiceForSeat=voiceForSeat;" +
     "globalThis.voiceRate=voiceRate;globalThis.setVoices=(v)=>{_voices=v;};");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);

console.log("\n--- what a listener actually hears ---");
const raw="FALSIFIER: I would change my mind if X.\n\n**My position** is that the `floor` should stay at 0.600.";
const c=voiceClean(raw);
tt("the falsifier line is not read aloud", !/FALSIFIER/i.test(c));
tt("markdown symbols are stripped, not spoken", !/[*`#]/.test(c));
tt("the actual position survives", /My position is that the floor should stay/.test(c));
tt("a RECKONING line is stripped too", !/RECKONING/.test(voiceClean("RECKONING: NO\nreal text here")));
tt("a fetch receipt block is stripped",
   !/FETCH RECEIPT/.test(voiceClean("[FETCH RECEIPT] url=x | sha256=y]\nthe position")));
t("empty after stripping returns empty", voiceClean("FALSIFIER: only this"), "");

console.log("\n--- one voice per seat, stable across rounds ---");
setVoices([{name:"A",lang:"en-US"},{name:"B",lang:"en-GB"},{name:"C",lang:"en-AU"},{name:"D",lang:"fr-FR"}]);
const g1=voiceForSeat("gemini"), g2=voiceForSeat("gemini");
tt("the same seat gets the same voice every time", g1 === g2);
tt("different seats get different voices",
   new Set(["gemini","kimi","claude"].map(s=>voiceForSeat(s).name)).size > 1);
tt("non-English voices are skipped when English exists",
   ["gemini","kimi","claude"].every(s=>/^en/.test(voiceForSeat(s).lang)));
setVoices([]);
t("no voices available returns null rather than throwing", voiceForSeat("gemini"), null);
setVoices([{name:"Only",lang:"fr-FR"}]);
tt("falls back to any voice when no English one exists", voiceForSeat("gemini").name === "Only");

console.log("\n--- rate ---");
t("defaults to 1x", voiceRate(), 1);
STORE["rq_voice_rate"]="1.5"; t("reads a stored rate", voiceRate(), 1.5);
STORE["rq_voice_rate"]="9"; t("rejects an out-of-range rate", voiceRate(), 1);
STORE["rq_voice_rate"]="junk"; t("rejects a non-numeric rate", voiceRate(), 1);

console.log("\n--- shape ---");
tt("no API, no key, no network — browser speech only",
   /new SpeechSynthesisUtterance/.test(src) && !/voiceSpeak[\s\S]{0,600}fetch\(/.test(src));
tt("a play control appears on each divided seat card",
   /voiceButton\(a\.name, \(\) => String\(a\.text/.test(src));
tt("and on the consensus answer", /vb\.classList\.add\("is-consensus"\)/.test(src));
tt("speech stops when a new round starts", /try \{ voiceStop\(\); \} catch \(_\) \{\}/.test(src));
tt("a missing speechSynthesis is reported, not silently ignored",
   /this browser has no speech synthesis/.test(src));
tt("flag defaults OFF", /localStorage\.getItem\("rq_voice"\) === "on"/.test(src));

console.log("\n--- v4.32.1: Android-specific defects ---");
// Chrome stops speech at ~15s unless poked, and does it SILENTLY — a long
// verdict ends mid-sentence with no error and no onend.
tt("a keep-alive watchdog exists", /function voiceKeepAlive\(\)/.test(src));
tt("it pokes the engine below the 15s cutoff", /\}, 10000\);/.test(src));
tt("it clears itself once speech ends", /if \(!s \|\| !s\.speaking\) \{ clearInterval/.test(src));
tt("and voiceStop clears it, so no timer runs against a dead queue",
   /function voiceStop\(\) \{\s*try \{ clearInterval\(_voiceWatchdog\)/.test(src));
tt("speech stops when the tab is backgrounded",
   /visibilitychange/.test(src) && /document\.hidden/.test(src));
tt("the silent-failure reason is documented", /and it does so SILENTLY/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
