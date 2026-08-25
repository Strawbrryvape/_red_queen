// v3.9.12 — asserts every ledger-clearing path is BOTH consented and audited.
// Shape assertions against the real source: this class of defect is invisible
// to unit tests, because the bug was an ABSENT guard, not a wrong one.
const fs=require("fs"), src=fs.readFileSync("app.js","utf8");
let pass=0,fail=0;
const t=(n,c)=>{c?(pass++,console.log("  PASS  "+n)):(fail++,console.log("  FAIL  "+n));};

// Every site that empties or shrinks the ledger, with the window of code after it.
const sites = [...src.matchAll(/ledger = \[\];|ledger\.splice\(i, 1\);/g)]
  .map(m => ({ at: m.index, tail: src.slice(m.index, m.index + 700), head: src.slice(Math.max(0,m.index-900), m.index) }));

console.log("\nledger-clearing sites found: " + sites.length);
t("all four wipe/delete sites present", sites.length === 4);

const wipes = sites.filter(s => s.tail.startsWith("ledger = [];"));
console.log("full-wipe sites: " + wipes.length);
t("three full-wipe paths (FORGET, Clear all, New Session)", wipes.length === 3);

t("EVERY full wipe is preceded by a confirm()",
  wipes.every(s => /confirm\(/.test(s.head)));
t("EVERY full wipe writes a breadcrumb",
  wipes.every(s => /noteLedgerCleared\(/.test(s.tail)));
t("every confirm names Supabase as unaffected",
  (src.match(/Supabase rows are NOT affected/g)||[]).length >= 3);

console.log("\n--- breadcrumb ---");
t("breadcrumb key is separate from the ledger key",
  /LEDGER_CLEARED_KEY = "rq_ledger_cleared_at"/.test(src) && !/rq_ledger_v1.*cleared_at/.test(src));
t("breadcrumb records source and count",
  /source: String\(source/.test(src) && /count: Number\(count\)/.test(src));
t("breadcrumb is read at boot", /last cleared /.test(src));
t("breadcrumb write is fail-soft", /localStorage\.setItem\(LEDGER_CLEARED_KEY[\s\S]{0,200}catch \(_\) \{\}/.test(src));

console.log("\n--- the specific regression ---");
const ns = src.slice(src.indexOf("newSessionBtn.addEventListener"), src.indexOf("newSessionBtn.addEventListener") + 1600);
t("New Session confirms before wiping", /confirm\(/.test(ns) && ns.indexOf("confirm(") < ns.indexOf("ledger = []"));
t("New Session guard fires only when there is something to lose", /if \(ledger\.length &&/.test(ns));
t("New Session names the round count in the prompt", /round\(s\) will be permanently deleted/.test(ns));

t("single-round delete stays unconfirmed but audible",
  /deleted 1 round/.test(src));

console.log("\n"+pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
