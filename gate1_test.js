// v3.9.10 Gate 1 banner-skip suite.
// Lifts the REAL functions out of app.js verbatim — no reimplementation.
const fs = require("fs");
const src = fs.readFileSync("app.js", "utf8");
// v4.3.0 — was lines.slice(699,749): a HARDCODED offset that broke the moment
// an edit above line 699 shifted the file. Anchor on content instead.
const _s = src.indexOf("const STOPWORDS = new Set(");
const _e = src.indexOf("// ==================== v3.3: CONCEPT-BASED COMPARATOR");
const COMPARATOR = src.slice(_s, _e > _s ? _e : _s + 3000);
const lines = src.split("\n");

function lift(startNeedle, endNeedle) {
  const s = lines.findIndex((l) => l.includes(startNeedle));
  if (s < 0) throw new Error("start not found: " + startNeedle);
  const e = lines.findIndex((l, i) => i > s && l.includes(endNeedle));
  if (e < 0) throw new Error("end not found: " + endNeedle);
  return lines.slice(s, e + 1).join("\n");
}

const block = [
  COMPARATOR,                       // STOPWORDS..similarity, verbatim
  lift("const CS_BANNER_MAX", "    return csFirstLineMeta(a).line;"),
  "}",
].join("\n");

// eslint-disable-next-line no-eval
eval(block + "\nglobalThis.csFirstLine = csFirstLine; globalThis.csIsBannerLine = csIsBannerLine;" +
     "globalThis.csFirstLineMeta = csFirstLineMeta; globalThis.similarity = similarity;");

let pass = 0, fail = 0;
function t(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + "\n        got  " + JSON.stringify(got) + "\n        want " + JSON.stringify(want)); }
}
function tt(name, cond) { t(name, !!cond, true); }

console.log("\n--- banner detection ---");
tt("**GEMINI SEAT — POSITION STATEMENT**", csIsBannerLine("**GEMINI SEAT — POSITION STATEMENT**"));
tt("bare all-caps nameplate", csIsBannerLine("CLAUDE SEAT"));
tt("## heading", csIsBannerLine("## Position Statement"));
tt("mixed-case nameplate", csIsBannerLine("Gemini Seat"));
tt("section label with colon", csIsBannerLine("Answer:"));
tt("horizontal rule", csIsBannerLine("---"));
tt("empty", csIsBannerLine("   "));

console.log("\n--- NOT banners (bias toward keeping) ---");
tt("shouted real answer NO.", !csIsBannerLine("NO."));
tt("shouted real answer YES, WITH CAVEATS.", !csIsBannerLine("YES, WITH CAVEATS."));
tt("normal prose", !csIsBannerLine("The council should not lower the similarity floor."));
tt("long all-caps prose keeps", !csIsBannerLine(
  "WE SHOULD NOT LOWER THE FLOOR BECAUSE IT WOULD ADMIT HUB ROUNDS RATHER THAN RELEVANT ONES AND THAT IS WORSE"));
tt("sentence containing the word seat", !csIsBannerLine("The Kimi seat is wrong about saturation."));
tt("bold real position", !csIsBannerLine("**I hold that option 3 is correct.**"));

console.log("\n--- first-line extraction ---");
t("skips banner, takes proposition",
  csFirstLine({ text: "**GEMINI SEAT — POSITION STATEMENT**\n\nI choose option 3 because it preserves provenance." }),
  "I choose option 3 because it preserves provenance.");
t("reports skip count",
  csFirstLineMeta({ text: "**GEMINI SEAT**\n## Position\nOption 3." }).skipped, 2);
t("no banner: unchanged from v3.9.9",
  csFirstLine({ text: "Option 2 is safer.\nSecond line." }), "Option 2 is safer.");
t("all-banner input falls back to line 1",
  csFirstLine({ text: "**SEAT**\nCLAUDE SEAT" }), "**SEAT**");
t("empty answer", csFirstLine({ text: "" }), "");
t("null answer", csFirstLine(null), "");

console.log("\n--- the round-172 regression (the reason this edit exists) ---");
const gem = { text: "**GEMINI SEAT — POSITION STATEMENT**\nI support option 3: keep the floor at 0.600 and fix retrieval structurally." };
const kim = { text: "I support option 3 as well: the floor is not the defect, hubness is." };
const cla = { text: "I support option 2: lower the floor and observe what surfaces." };

const before = similarity(
  String(gem.text).split("\n")[0].trim(),      // v3.9.9 behavior: raw line 1
  String(kim.text).split("\n")[0].trim());
const after = similarity(csFirstLine(gem), csFirstLine(kim));
console.log("  v3.9.9 gemini-vs-kimi overlap: " + before.toFixed(4) + "  (floor 0.12)");
console.log("  v3.9.10 gemini-vs-kimi overlap: " + after.toFixed(4));
tt("v3.9.9 scored below the Gate 1 floor (false PARALLEL)", before < 0.12);
tt("v3.9.10 clears the Gate 1 floor", after >= 0.12);
tt("dissenting seat still compared on its real line", csFirstLine(cla).startsWith("I support option 2"));

console.log("\n--- v4.7.1: the FALSIFIER line is not a position ---");
// v4.1.0's composer-appended falsifier ask made every seat open with
// "FALSIFIER: ...", so Gate 1 began comparing conditionals about what would
// change a seat's mind instead of the positions themselves. Live 2026-08-13:
// three substantive answers scored 0.118 against a 0.12 floor — a false
// PARALLEL by two thousandths. Same class as the banner defect this function
// was written for, reintroduced by a later feature.
tt("a FALSIFIER opener is skipped", csIsBannerLine("FALSIFIER: If X were shown, I would concede the point entirely."));
tt("lowercase and spaced variants too", csIsBannerLine("falsifier : if X then Y"));
t("csFirstLine returns the POSITION, not the falsifier",
  csFirstLine({text:"FALSIFIER: If X were demonstrated I would concede.\n\nMy position is that the floor should stay at 0.600."}),
  "My position is that the floor should stay at 0.600.");
tt("a position merely MENTIONING falsifiers is not skipped",
  !csIsBannerLine("The falsifier discipline is what keeps this council honest."));
t("falsifier-only text still falls back rather than returning nothing",
  csFirstLine({text:"FALSIFIER: If X then Y."}), "FALSIFIER: If X then Y.");


console.log("\n--- v4.8.7: the TWO-LINE falsifier form ---");
// v4.7.1 covered "FALSIFIER: <text>" on one line. Seats also write the label
// alone with the body underneath, and the body was then scored as the
// position. Live 2026-08-15 valuation round: two of three first lines were
// falsifier bodies, PARALLEL at 0.076.
t("bare label + blank line + body returns the POSITION",
  csFirstLine({text:"FALSIFIER:\n\nIf X were shown I would concede.\n\nMy position is that the floor should stay at 0.600."}),
  "My position is that the floor should stay at 0.600.");
t("bare label with no blank line also skips the body",
  csFirstLine({text:"FALSIFIER:\nIf X then Y.\nMy actual position here."}),
  "My actual position here.");
t("the one-line form still works (v4.7.1 regression guard)",
  csFirstLine({text:"FALSIFIER: If X then Y.\n\nMy actual position here."}),
  "My actual position here.");
tt("the skip is counted, so the gate can report it",
   csFirstLineMeta({text:"FALSIFIER:\n\nIf X then Y.\n\nPosition."}).skipped === 2);
t("only ONE line is carried — a second body line is a position",
  csFirstLine({text:"FALSIFIER:\nIf X then Y.\nSecond line is the position.\nThird line."}),
  "Second line is the position.");
tt("a line merely containing the word falsifier is not a bare label",
   !/^\s*falsifier\s*:?\s*$/i.test("The falsifier discipline keeps this honest."));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
