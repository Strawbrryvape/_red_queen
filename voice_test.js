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
      grab(/  const RQ_VOICE_SEAT_ORDER = .*/).replace(/^\s*const /,"var "),
      grab(/  const RQ_VOICE_SEAT_PITCH = .*/).replace(/^\s*const /,"var "),
      grab(/  function voiceSeatIndex\(seat\) \{[\s\S]*?\n  \}/),
      grab(/  function voiceForSeat\(seat\) \{[\s\S]*?\n  \}/),
      grab(/  function voicePitchForSeat\(seat\) \{[\s\S]*?\n  \}/),
      grab(/  function voiceClean\(text\) \{[\s\S]*?\n  \}/),
      grab(/  const RQ_VOICE_CHUNK = .*/).replace(/^\s*const /,"var "),
      grab(/  function voiceChunks\(text\) \{[\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.voiceChunks=voiceChunks;globalThis.CHUNK=RQ_VOICE_CHUNK;globalThis.voiceClean=voiceClean;globalThis.voiceForSeat=voiceForSeat;globalThis.voicePitchForSeat=voicePitchForSeat;" +
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

console.log("\n--- v4.32.1 -> v5.0.1: the Android story, superseded ---");
// v4.32.1 added a pause/resume watchdog for Chrome's ~15s cutoff. v5.0.1
// removed it: with chunking no utterance reaches 15s, and pause()/resume() can
// itself terminate speech on some Android engines. The superseding is asserted
// rather than the assertions being deleted, so a later reader can see the
// workaround existed and why it went.
tt("the watchdog is gone", !/setInterval\([\s\S]{0,200}pause\(\); s\.resume\(\)/.test(src));
tt("speech still stops when the tab is backgrounded",
   /visibilitychange/.test(src) && /document\.hidden/.test(src));
tt("chunking replaced it as the real fix",
   /RQ_VOICE_CHUNK/.test(src) && /THE FIRST-SENTENCE CUT/.test(src));

console.log("\n--- v5.0.1: THE FIRST-SENTENCE CUT ---");
// Chrome's default TTS engine truncates a single utterance around 200-300
// chars on many Android devices, not only iOS. A council answer is 2,000+, so
// playback stopped after the first sentence on every seat. The 15s watchdog
// could not help: the cut happens in three seconds.
const long = "My position is that the floor should stay at 0.600. Lowering it admits near-duplicates that crowd out relevant rounds. The council divided on this twice, and both times the argument was about recall rather than precision. I would change my mind given a measured trial.";
const ch = voiceChunks(long);
tt("a long answer is split", ch.length > 1);
tt("every chunk is under the engine cap", ch.every(c => c.length <= CHUNK));
tt("splitting is lossless",
   ch.join(" ").replace(/\s+/g," ").trim() === long.replace(/\s+/g," ").trim());
tt("it prefers sentence boundaries", /\.$/.test(ch[0]));
tt("a short answer stays a single chunk", voiceChunks("Short answer.").length === 1);
// text with no punctuation at all must still respect the cap and not cut words
const nopunc = voiceChunks("word ".repeat(120));
tt("unpunctuated text still respects the cap", nopunc.every(c => c.length <= CHUNK));
tt("and does not cut a word in half", nopunc.every(c => !/\bwor$|\bwo$/.test(c)));
t("empty input yields nothing", voiceChunks(""), []);

console.log("\n--- the queue cannot resurrect itself ---");
tt("a sequence counter invalidates late callbacks", /if \(seq !== _voiceSeq\) return;/.test(src));
tt("and stop increments it", /_voiceSeq\+\+;\s*\/\/ orphans every pending onend/.test(src));
tt("an error stops the run rather than grinding through remaining chunks",
   /rather than grinding through every remaining\s+\/\/ chunk|playback failed at part/.test(src));

console.log("\n--- the watchdog is removed, not disabled ---");
tt("voiceKeepAlive no longer exists", !/function voiceKeepAlive/.test(src));
tt("and the removal is explained", /A workaround that is no longer needed and can cause the fault/.test(src));

console.log("\n--- v5.0.5: every seat sounded the same ---");
// The picker hashed the seat name modulo the voice count. With 3 or 4 voices
// that COLLIDES — exactly the counts where three distinct seats should fit.
// And a device with one English voice had nothing to vary at all.
const SEATS=["gemini","kimi","claude"];
const distinct=(n)=>{
  setVoices(Array.from({length:n},(_,i)=>({name:"V"+i,lang:"en-US"})));
  return new Set(SEATS.map(s=>voiceForSeat(s).name+"|"+voicePitchForSeat(s))).size;
};
[1,2,3,4,5,8].forEach(n=>t("three seats distinguishable with "+n+" voice(s)", distinct(n), 3));
setVoices([{name:"V0",lang:"en-US"},{name:"V1",lang:"en-US"},{name:"V2",lang:"en-US"}]);
tt("with exactly three voices, each seat gets its own",
   new Set(SEATS.map(s=>voiceForSeat(s).name)).size===3);
tt("pitch differs per seat — the lever that works on a one-voice device",
   new Set(SEATS.map(s=>voicePitchForSeat(s))).size===3);
tt("a fallback-labelled seat still resolves to its own pitch",
   voicePitchForSeat("Kimi [fallback: OpenRouter x]") === voicePitchForSeat("kimi"));
tt("pitch is applied to the utterance", /u\.pitch = pitch;/.test(src));
tt("the hash is gone", !/h % pool\.length/.test(src));

console.log("\n--- v5.0.6: the verdict speaks in the voice of the seat holding the mic ---");
// SOLE returned no speakerSeat, so the button fell back to "council" and spoke
// in Gemini's voice whichever seat answered.
tt("a SOLE round names its speaker",
   /trust: "sole",\s*speakerSeat: seatLabel\(eligible\[0\]\.name\)/.test(src));
tt("\"council\" would have resolved to Gemini's pitch — the defect",
   voicePitchForSeat("council") === voicePitchForSeat("gemini"));
tt("the speaking seat's own label resolves to its own pitch",
   voicePitchForSeat("Kimi") === voicePitchForSeat("kimi") &&
   voicePitchForSeat("Kimi") !== voicePitchForSeat("gemini"));
tt("the verdict button is labelled with whose voice it uses",
   /"\\u25b6 Listen \\u00b7 " \+ who/.test(src));
tt("the fallback suffix is stripped from the label",
   /split\(" \["\)\[0\]/.test(src));
tt("idle resets restore the label instead of a bare glyph",
   (src.match(/dataset\.label \|\| "\\u25b6"/g) || []).length >= 2);
tt("while playing it says what is playing",
   /replace\("\\u25b6 Listen", "\\u25a0 Stop"\)/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
