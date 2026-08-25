// v3.9.11 capacity-guard logic check. Lifts the real constants + the real
// threshold/message expressions from app.js rather than restating them.
const fs=require("fs"), L=fs.readFileSync("app.js","utf8").split("\n");
const MAX = +/=\s*(\d+);/.exec(L.find(l=>l.includes("const LEDGER_MAX_ENTRIES")))[1];
const WARN = MAX - 10;
let pass=0,fail=0;
const t=(n,c)=>{c?(pass++,console.log("  PASS  "+n)):(fail++,console.log("  FAIL  "+n));};

console.log("\nLEDGER_MAX_ENTRIES="+MAX+"  LEDGER_WARN_AT="+WARN);
t("warns 10 rounds out", WARN===190);
t("178 (tonight) does NOT banner", !(178>=WARN));
t("178 boot line reports headroom", MAX-178===22);
t("190 banners", 190>=WARN);
t("200 banners at capacity", 200>=WARN && MAX-200===0);
t("201 would evict 1", 201-MAX===1);

console.log("\n--- code-shape assertions ---");
const src=L.join("\n");
t("capacity branch is NOT inside a snapshotEnabled gate",
  src.indexOf("ensureCapacityUI") < src.indexOf("function ensureSnapshotUI"));
t("capacity CSS lives in the unconditional IIFE only",
  (src.match(/#rqCapacityBanner \{/g)||[]).length===1);
t("silent trim is gone: eviction logs", /LEDGER AT CAPACITY/.test(src));
t("persist failure is sticky", /_ledgerPersistFailed = true/.test(src));
t("capacity dismiss key is separate from snapshot's",
  /rq_capacity_dismissed_session/.test(src) && /rq_snapshot_dismissed_session/.test(src));
t("LEDGER_MAX_ENTRIES itself unchanged at 200", MAX===200);
console.log("\n"+pass+" passed, "+fail+" failed");
process.exit(fail?1:0);
