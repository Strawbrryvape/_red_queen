// v4.30/4.31 — artifact generation (council round 61, Claude seat's revised
// spec). artBuild is LIFTED AND RUN. The invariant — no prose is generated,
// every body byte is a seat's verbatim text — cannot be shown by inspecting
// shapes. Async since v4.31.3, because the body is now hydrated from the
// full-text store rather than the ledger's 600-char clip.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8");
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
const LOGS=[];
globalThis.logError=(m)=>LOGS.push(String(m));
let FT=null;                                  // what the full-text store returns
globalThis.readFullText=()=>Promise.resolve(FT);
eval([grab(/  const clip = .*/),
      grab(/  function artifactsEnabled\(\) \{.*\}/),
      grab(/  function artTag\(e\) \{[\s\S]*?\n  \}/),
      grab(/  function artProvenance\(e, tag, seats\) \{[\s\S]*?\n  \}/),
      grab(/  const ART_MEANING = \{[\s\S]*?\n  \};/).replace(/^\s*const /,"var "),
      grab(/  function artHeader\(e, tag, title\) \{[\s\S]*?\n  \}/),
      grab(/  function artSignature\(e, seats\) \{[\s\S]*?\n  \}/),
      grab(/  async function artBuild\(e\) \{[\s\S]*?\n  \}/)].join("\n") +
     "\nglobalThis.artBuild=artBuild;globalThis.artTag=artTag;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)));};
const tt=(n,c)=>t(n,!!c,true);
const R=(o,extra)=>Object.assign({t:1234,prompt:"Should the floor stay at 0.600?",outcome:o,counts:"3/3",speaker:"gemini",
  positions:[{seat:"gemini",text:"GEMINI_TEXT_ALPHA"},{seat:"kimi",text:"KIMI_TEXT_BETA"},{seat:"claude",text:"CLAUDE_TEXT_GAMMA"}]},extra||{});

(async () => {
console.log("\n--- v4.31.3: THE 600-CHAR TRUNCATION ---");
// The ledger stores verdict: clip(result.text, 600) for the TIMELINE. The
// export read that field, so every VERIFIED artifact was cut at 600 chars while
// the full text sat in IndexedDB untouched. A truncated export is worse than a
// missing one: it looks complete and ends mid-sentence with no marker.
const LONG = "FULL_VERBATIM_" + "x".repeat(2000) + "_END";
FT = { gemini: LONG, kimi: "KIMI_FULL", claude: "CLAUDE_FULL" };
let v = (await artBuild(R("verified",{verdict:"SHORT_CLIP_600"})))[0].body;
tt("the body is the VERBATIM full text, not the ledger clip",
   v.includes("FULL_VERBATIM_") && v.includes("_END") && !v.includes("SHORT_CLIP_600"));
tt("and it is not cut short", v.length > 2000);
tt("no truncation warning when the full text was found", !/TRUNCATED/.test(v));

FT = null;   // full-text store empty (F1 off, or the row aged out)
v = (await artBuild(R("verified",{verdict:"SHORT_CLIP_600"})))[0].body;
// With no stored full text, positions are clipped too — so the body is a
// fragment whichever field it came from, and the warning is what matters.
tt("falls back to stored (clipped) text when the full-text store is empty",
   v.includes("GEMINI_TEXT_ALPHA") || v.includes("SHORT_CLIP_600"));
tt("and SAYS SO in the file rather than shipping a silent fragment",
   /TRUNCATED: the full-text store had no record/.test(v));
tt("the fallback names the fix", /Turn on FULL-TEXT LEDGER/.test(v));

console.log("\n--- the speaking seat is the one exported ---");
FT = { gemini: "LEAD_SEAT_TEXT", kimi: "OTHER", claude: "OTHER2" };
v = (await artBuild(R("verified",{verdict:"clip",speaker:"gemini"})))[0].body;
tt("VERIFIED exports the SPEAKING seat's text", v.includes("LEAD_SEAT_TEXT"));

console.log("\n--- the verdict mapping, unchanged ---");
FT = null;
t("VERIFIED -> one file", (await artBuild(R("verified",{verdict:"X"}))).length, 1);
t("PROVISIONAL -> one file", (await artBuild(R("provisional",{verdict:"X"}))).length, 1);
t("SOLE -> one file", (await artBuild(R("sole",{verdict:"X"}))).length, 1);
t("DIVIDED-PARALLEL -> one file PER SEAT",
  (await artBuild(R("divided",{cs:{verdict:"PARALLEL"}}))).length, 3);
t("DIVIDED not parallel -> ONE file, labelled sections",
  (await artBuild(R("divided",{cs:{verdict:"TRUE SPLIT"}}))).length, 1);

console.log("\n--- divided positions are hydrated too ---");
FT = { gemini: "GEM_FULL_LONG", kimi: "KIMI_FULL_LONG", claude: "CLAUDE_FULL_LONG" };
const d = (await artBuild(R("divided",{cs:{verdict:"TRUE SPLIT"}})))[0].body;
tt("every position is the verbatim stored text",
   d.includes("GEM_FULL_LONG") && d.includes("KIMI_FULL_LONG") && d.includes("CLAUDE_FULL_LONG"));
tt("with NO connecting prose between them",
   /no connecting prose has been written/i.test(d) && /no resolution is implied/i.test(d));
const par = await artBuild(R("divided",{cs:{verdict:"PARALLEL"}}));
tt("parallel files hold exactly ONE seat each",
   par[0].body.includes("GEM_FULL_LONG") && !par[0].body.includes("KIMI_FULL_LONG"));

console.log("\n--- THE INVARIANT: no prose is generated ---");
FT = null;
v = (await artBuild(R("verified",{verdict:"SPOKEN"})))[0].body;
tt("the signature block LISTS seats, it does not summarise them",
   /CONFIRMING SEATS/.test(v) && /- gemini/.test(v) && /- kimi/.test(v));
tt("and says so explicitly", /No text above it was generated by this tool/.test(v));

console.log("\n--- the tag rides everywhere (Kimi's constraint) ---");
for (const o of ["verified","provisional","sole"]) {
  const files = await artBuild(R(o,{verdict:"X"}));
  tt(o+": tag in the FILENAME", /^\[[A-Z-]+\]/.test(files[0].name));
  tt(o+": tag in the body", /\[[A-Z-]+\]/.test(files[0].body));
}
tt("each tag carries plain-language meaning for an outside reader",
   /NOT authoritative advice/.test((await artBuild(R("verified",{verdict:"X"})))[0].body) &&
   /ONE SEAT ONLY/.test((await artBuild(R("sole",{verdict:"X"})))[0].body));

console.log("\n--- provenance travels INSIDE the file ---");
v = (await artBuild(R("verified",{verdict:"X"})))[0].body;
tt("YAML frontmatter is present", /^---\ngenerator: Red Queen/.test(v));
tt("the sign-off notice is embedded",
   /UNAUDITED MULTI-MODEL DRAFT — REQUIRES OPERATOR SIGN-OFF BEFORE USE/.test(v));
tt("a proxy seat is disclosed",
   /proxy_warning/.test((await artBuild(R("verified",{verdict:"X",counterfoils:[{declared_seat:"kimi",proxy:true,actual_model:"minimax"}]})))[0].body));
tt("partial agreement is stated rather than implied",
   /2 of 3 seats agreed/.test((await artBuild(R("verified",{verdict:"X",counts:"2/3"})))[0].body));

console.log("\n--- shape ---");
tt("artBuild is async so it can read the full-text store",
   /async function artBuild\(e\)/.test(src));
tt("the mobile panel awaits it", /const files = await artBuild\(e\)/.test(src));
tt("and builds at CLICK time, not at panel render",
   /Building at CLICK time rather\s+\/\/\s+than at panel render|building at CLICK time/i.test(src));
tt("the truncation defect is documented in source",
   /THE 600-CHAR TRUNCATION|a summary for the TIMELINE, not the answer/i.test(src));
tt("no merge step or generative call in the export path",
   !/artBuild[\s\S]{0,3000}(?:callGemini|callKimi|callClaude)/.test(src));
tt("docx is real OOXML", /word\/document\.xml/.test(src) && /\[Content_Types\]\.xml/.test(src));
tt("flag defaults OFF", /localStorage\.getItem\("rq_artifacts"\) === "on"/.test(src));

console.log("\n--- v4.31.4: the speaker field the export was reading did not exist ---");
tt("the ledger now stores the speaking seat",
   /result && result\.speakerSeat \? \{ speaker: result\.speakerSeat \}/.test(src));
tt("and the defect is named: it read a field that was never written",
   /reading a field that did not exist/.test(src));
tt("older rounds fall back to the longest stored response",
   /longest stored/.test(src) && /guessedLead = true/.test(src));
tt("and the inference is DISCLOSED in the file, not presented as recorded",
   /INFERRED rather\s+\/\/|which seat spoke is INFERRED/.test(src));
FT = { gemini:"SHORT", kimi:"THE_LONGEST_STORED_RESPONSE_"+"y".repeat(400), claude:"MID" };
const g = (await artBuild({t:1,prompt:"q",outcome:"verified",counts:"3/3",verdict:"clip",
  positions:[{seat:"gemini",text:"a"},{seat:"kimi",text:"b"},{seat:"claude",text:"c"}]}))[0].body;
tt("a speakerless round still exports the full verbatim text",
   g.includes("THE_LONGEST_STORED_RESPONSE_") && g.length > 400);
tt("and says the speaker was inferred", /INFERRED rather than recorded/.test(g));

console.log("\n--- Copy replaces Word for the Google Docs path ---");
tt("the middle button is Copy", /\["Copy", "clip"\]/.test(src));
tt("clipboard writes the joined body", /navigator\.clipboard\.writeText\(joined\)/.test(src));
tt("multiple positions are separated by a visible rule, not concatenated",
   /join\("\\n\\n" \+ "\\u2500"\.repeat\(40\)/.test(src));
tt("Word is still reachable", /window\.__rqExportDocx/.test(src));
tt("the reason for the swap is documented",
   /three steps on a phone|does not have Word/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
})();
