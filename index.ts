// supabase/functions/consolidate/index.ts
// Pillar VII F2 — SELECTION + ORCHESTRATION ONLY (hybrid default, R-P7-5).
//
// This function never generates a summary and never embeds anything. It cannot:
// provider keys live in rq_settings_v21 and are never exported. So it selects
// clusters and writes job rows; the CLIENT executes them.
//
// Security contract (R-P7-1):
//   1. SUPABASE_SERVICE_ROLE_KEY exists ONLY as this function's env secret.
//   2. Every invocation must present x-rq-cron === RQ_CRON_SECRET, else 401.
//      The brief's anon-key-only cron was a privilege hole: anyone holding the
//      public anon key could trigger consolidation. This header closes it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RQ_CONS_STALE_H = 24;   // FROZEN — staleness window on created_at
const RQ_CONS_SIM     = 0.9;  // FROZEN — greedy cosine clustering threshold
const RQ_CONS_BATCH   = 50;   // FROZEN — max stale rows examined per run

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// pgvector over PostgREST arrives as a bracketed string "[0.1,0.2,...]".
function parseVec(v: unknown): number[] | null {
  try {
    if (Array.isArray(v)) return v as number[];
    if (typeof v === "string") {
      const a = JSON.parse(v);
      if (Array.isArray(a) && a.every((n) => typeof n === "number" && isFinite(n))) return a;
    }
  } catch (_) { /* fall through */ }
  return null;
}

function cosine(a: number[], b: number[]): number {
  // The client embedder L2-normalizes, so the dot product IS the cosine.
  // Compute the full form anyway: rows from older backfills are not guaranteed
  // normalized, and a wrong cluster is worse than a slow one.
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Greedy single-pass clustering. Chaining is accepted on purpose: a row joins
// the cluster of the FIRST seed it clears the threshold against. Deterministic
// given row order, and order is created_at ASC so the oldest memory seeds.
function clusterBySimilarity(
  rows: { id: string; vec: number[] }[], threshold: number,
): { id: string; vec: number[] }[][] {
  const used = new Set<string>();
  const clusters: { id: string; vec: number[] }[][] = [];
  for (const row of rows) {
    if (used.has(row.id)) continue;
    const cluster = [row];
    used.add(row.id);
    for (const other of rows) {
      if (used.has(other.id)) continue;
      if (cosine(row.vec, other.vec) >= threshold) { cluster.push(other); used.add(other.id); }
    }
    clusters.push(cluster);
  }
  return clusters;
}

Deno.serve(async (req: Request) => {
  // 401 gate BEFORE any work, including logging.
  const cronHeader = req.headers.get("x-rq-cron");
  const cronSecret = Deno.env.get("RQ_CRON_SECRET");
  if (!cronSecret || cronHeader !== cronSecret) return json(401, { error: "unauthorized" });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!serviceKey || !supabaseUrl) return json(500, { error: "edge env not provisioned" });

  const supabase = createClient(supabaseUrl, serviceKey);
  const runId = crypto.randomUUID();
  const staleCutoff = new Date(Date.now() - RQ_CONS_STALE_H * 3600 * 1000).toISOString();
  const results = {
    run_id: runId, rows_processed: 0, clusters_seeded: 0, rows_queued: 0,
    self_prompt: null as string | null, notes: [] as string[],
  };

  // ================= PHASE A: COMPRESSION (selection only) =================
  // row_type='round' excludes CONSOLIDATED summaries from re-selection, so a
  // summary-of-summaries chain can never form silently.
  const { data: staleRows, error: staleErr } = await supabase
    .from("rq_events")
    .select("id, prompt, response, embedding, created_at")
    .eq("row_type", "round").eq("consolidated", false)
    .not("embedding", "is", null)
    .lt("created_at", staleCutoff)
    .order("created_at", { ascending: true })
    .limit(RQ_CONS_BATCH);
  if (staleErr) results.notes.push("phase A select failed: " + staleErr.message);

  const parsed = (staleRows || [])
    .map((r) => ({ id: r.id as string, vec: parseVec(r.embedding) }))
    .filter((r): r is { id: string; vec: number[] } => r.vec !== null);
  results.rows_processed = (staleRows || []).length;

  if (parsed.length >= 2) {
    // Dedupe against OPEN jobs so duplicate cron fires never double-queue.
    const { data: openJobs } = await supabase
      .from("rq_consolidation_jobs").select("payload").in("status", ["pending", "running"]);
    const alreadyQueued = new Set<string>();
    (openJobs || []).forEach((j) => {
      const ids = (j.payload && j.payload.cluster_event_ids) || [];
      ids.forEach((id: string) => alreadyQueued.add(id));
    });
    const eligible = parsed.filter((r) => !alreadyQueued.has(r.id));
    const clusters = clusterBySimilarity(eligible, RQ_CONS_SIM);
    const jobRows = clusters
      .filter((c) => c.length >= 2)              // a cluster of 1 is never a job
      .map((c) => ({
        job_type: "compression",
        payload: { cluster_event_ids: c.map((r) => r.id), run_id: runId, seeded_at: new Date().toISOString() },
        run_id: runId,
      }));
    if (jobRows.length) {
      const { error: jobErr } = await supabase.from("rq_consolidation_jobs").insert(jobRows);
      if (jobErr) results.notes.push("job insert failed: " + jobErr.message);
      else {
        results.clusters_seeded = jobRows.length;
        results.rows_queued = jobRows.reduce((n, j) => n + (j.payload.cluster_event_ids as string[]).length, 0);
      }
    }
  }

  // ================= PHASE B: RECONCILIATION =================
  // 'divided' is the exact lowercase literal the client writes. The brief's
  // 'DIVIDED' matches nothing. Fragility lives on rq_meta_consensus, so this is
  // a two-query merge, not a join the schema can assume.
  const { data: dividedRows, error: divErr } = await supabase
    .from("rq_events").select("id, prompt, response, created_at")
    .eq("row_type", "round").eq("consolidated", false).eq("consensus_status", "divided")
    .order("created_at", { ascending: false }).limit(25);
  if (divErr) results.notes.push("phase B select failed: " + divErr.message);

  if (dividedRows && dividedRows.length) {
    const ids = dividedRows.map((r) => r.id);
    const [{ data: metaRows }, { data: pendingRecons }] = await Promise.all([
      supabase.from("rq_meta_consensus").select("round_event_id, fragility_score")
        .in("round_event_id", ids).order("fragility_score", { ascending: false }).limit(1),
      // Dedupe scoped to RECONCILIATION prompts ONLY. F3's SURPRISE AUDIT rows
      // share this queue but must never block reconciliation, and vice versa.
      supabase.from("rq_self_prompt_queue").select("id")
        .eq("status", "pending").like("prompt", "RECONCILIATION TARGET%"),
    ]);
    const reconciliationPending = (pendingRecons || []).length > 0;
    const target = reconciliationPending ? null : (metaRows || [])[0];
    if (target) {
      const row = dividedRows.find((r) => r.id === target.round_event_id);
      if (row) {
        const clip = String(row.prompt || "").slice(0, 200);
        results.self_prompt =
          `RECONCILIATION TARGET [${row.id}]: ${clip}${clip.length >= 200 ? "…" : ""} Re-examine with fresh context.`;
        const { error: qErr } = await supabase.from("rq_self_prompt_queue").insert({
          source_round_id: String(row.id), prompt: results.self_prompt, status: "pending",
        });
        if (qErr) { results.notes.push("queue insert failed: " + qErr.message); results.self_prompt = null; }
      }
    } else {
      results.notes.push("phase B: no scored DIVIDED round available (or one already pending)");
    }
  }

  results.notes.push("hybrid mode: jobs left pending for client execution (R-P7-5)");

  // ================= VITALS SNAPSHOT + LOG ROW =================
  // One log row per run, ALWAYS, including zero-work runs — a zero-row log is
  // how the operator tells "cron dead" from "cron idle".
  let vitalsSnapshot: unknown = null;
  try {
    const { data: vrows } = await supabase.from("rq_vitals").select("*")
      .order("created_at", { ascending: false }).limit(1);
    vitalsSnapshot = vrows && vrows.length ? vrows[0] : null;
  } catch (_) { vitalsSnapshot = null; }

  await supabase.from("rq_consolidation_log").insert({
    run_id: runId,
    run_type: results.self_prompt ? "self_prompt" : "compression",
    rows_processed: results.rows_processed,
    // Honest accounting: in hybrid mode these rows are QUEUED, not yet merged.
    rows_consolidated: results.rows_queued,
    new_memory_id: null,
    self_prompt_queued: results.self_prompt,
    vitals_snapshot: { vitals: vitalsSnapshot, notes: results.notes },
  });

  return json(200, results);
});
