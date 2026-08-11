// Claim-diff suite.
//
// HONEST LIMIT, STATED UP FRONT: alignment now runs on embeddings via the
// browser's local Xenova worker. Node has no worker, so this suite CANNOT
// validate the semantic-matching case — the one that matters most. It stubs
// embedText two ways: returning null (proving the lexical fallback triggers and
// is labelled), and returning planted vectors (proving thresholds and labels
// apply correctly to whatever scores come back). The real acceptance case, the
// 0.679 pair, is a BROWSER test and is written up in the handoff as such.
const fs=require("fs"),src=fs.readFileSync("app.js","utf8"),L=src.split("\n");
// v4.3.0 — was L.slice(699,749): a HARDCODED offset that broke the moment an
// edit above line 699 shifted the file. Anchor on content instead.
const _s = src.indexOf("const STOPWORDS = new Set(");
const _e = src.indexOf("// ==================== v3.3: CONCEPT-BASED COMPARATOR");
const COMPARATOR = src.slice(_s, _e > _s ? _e : _s + 3000);
const grab=(re)=>{const m=src.match(re);if(!m)throw new Error("lift failed "+re);return m[0];};
let _embedMode = "null";
let _planted = {};
globalThis.embedText = async (t) => (_embedMode === "null" ? null : (_planted[t] || [1,0,0]));
eval([
  COMPARATOR,
  grab(/  const CS_BANNER_MAX[\s\S]*?\n    return false;\n  \}/),
  grab(/  const clip = .*/),
  grab(/  function _cosine384[\s\S]*?\n  \}/),
  grab(/  const RQ_CLAIM_MATCH[\s\S]*?predicted_claims: P\.length, actual_claims: A\.length \};\n    \} catch \(_\) \{ return null; \}\n  \}/),
].join("\n") + "\nglobalThis.decomposeClaims=decomposeClaims;globalThis.claimSplit=claimSplit;globalThis.claimPolarityOpposed=claimPolarityOpposed;");

let p=0,f=0;
const t=(n,g,w)=>{const ok=JSON.stringify(g)===JSON.stringify(w);ok?(p++,console.log("  PASS  "+n)):(f++,console.log("  FAIL  "+n+"  got "+JSON.stringify(g)+" want "+JSON.stringify(w)));};
const tt=(n,c)=>t(n,!!c,true);

(async () => {
console.log("\n--- claim splitting ---");
t("sentences become claims", claimSplit("The floor should stay at 0.600. Lowering it admits noise into the corpus.").length, 2);
t("banner lines are dropped", claimSplit("**KIMI SEAT — POSITION**\nThe floor should stay at 0.600 for now.").length, 1);
t("fragments below the length floor are not claims", claimSplit("Yes. No. Maybe.").length, 0);
t("empty and null are safe", claimSplit("").length + claimSplit(null).length, 0);

console.log("\n--- polarity (conservative by design) ---");
tt("negation mismatch is opposed", claimPolarityOpposed("We should lower the floor.", "We should not lower the floor."));
tt("raise/lower antonym is opposed", claimPolarityOpposed("I would raise the threshold.", "I would lower the threshold."));
tt("same stance is NOT opposed", !claimPolarityOpposed("Keep the floor at 0.600.", "The floor should remain at 0.600."));
tt("elaboration is NOT opposed", !claimPolarityOpposed("Keep the floor.", "Keep the floor, because false positives corrupt the ledger."));

console.log("\n--- embed worker down => lexical fallback, and it SAYS so ---");
_embedMode = "null";
const fb = await decomposeClaims(
  "The floor should stay at 0.600 because lowering it admits redundant entries.",
  "Keep the floor at 0.600 because lowering it admits redundant entries.");
tt("still returns a decomposition", !!fb);
tt("fallback is flagged on the result", fb.lexical_fallback === true);
tt("the log line warns about under-matching", /LEXICAL FALLBACK/.test(src));

console.log("\n--- planted vectors: thresholds and labels ---");
_embedMode = "planted";
const near = [1,0,0], mid = [0.62,0.78,0], far = [0,0,1];
_planted = {
  "Hold the floor at 0.600 without further evidence to move it.": near,
  "Keep the floor at 0.600 until evidence justifies a move.": near,
  "Retrieval should prefer precision over recall in this council.": mid,
  "Something entirely unrelated about braising short ribs slowly.": far,
};
const strong = await decomposeClaims(
  "Hold the floor at 0.600 without further evidence to move it.",
  "Keep the floor at 0.600 until evidence justifies a move.");
t("identical-vector pair is RESTATED", strong.counts.restated, 1);
const gone = await decomposeClaims(
  "Hold the floor at 0.600 without further evidence to move it.",
  "Something entirely unrelated about braising short ribs slowly.");
t("orthogonal pair is REPLACED", gone.counts.replaced, 1);
tt("orthogonal pair does not read as elaboration", !/ELABORATION/.test(gone.reading));
const midp = await decomposeClaims(
  "Hold the floor at 0.600 without further evidence to move it.",
  "Retrieval should prefer precision over recall in this council.");
t("mid-band pair is EXTENDED", midp.counts.extended, 1);

console.log("\n--- degradation ---");
t("no predicted text => null", await decomposeClaims("", "some actual answer long enough to count"), null);
t("no actual text => null", await decomposeClaims("some predicted claim long enough here", ""), null);
t("NO PREDICTION sentinel => null", await decomposeClaims("NO PREDICTION", "a real answer of sufficient length"), null);

console.log("\n--- shape: shadow discipline ---");
tt("hook sits AFTER the surprise assignment",
   src.indexOf("surprise = errorScore >") < src.indexOf("if (claimDiffEnabled())"));
tt("hook never assigns errorScore", !/logClaimDiff[\s\S]{0,300}errorScore =/.test(src));
tt("flag defaults OFF", /localStorage\.getItem\("rq_claim_diff"\) === "on"/.test(src));
tt("no API call anywhere in the decomposer",
   !/async function decomposeClaims[\s\S]{0,2600}fetch\(/.test(src));
tt("embedding path uses the LOCAL worker", /pv = await Promise\.all\(P\.map\(\(x\) => embedText\(x\)\)\)/.test(src));
tt("log states it is shadow only", /SHADOW ONLY — error_score and surprise are unchanged/.test(src));
tt("the first-draft failure is documented in source, not hidden",
   /FIRST DRAFT USED THE LEXICAL JACCARD AND FAILED ITS OWN ACCEPTANCE/.test(src));

console.log("\n"+p+" passed, "+f+" failed");
process.exit(f?1:0);
})();
