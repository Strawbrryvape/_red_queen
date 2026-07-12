-- Red Queen v2 — Supabase Table Schema
-- Run this in Supabase SQL Editor to create the consensus log table

CREATE TABLE IF NOT EXISTS rq_consensus_log (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),

    -- Consensus metadata
    round_id TEXT NOT NULL,
    timestamp DOUBLE PRECISION NOT NULL,
    agreement_score DOUBLE PRECISION NOT NULL,
    convergence_time_ms DOUBLE PRECISION,

    -- Participants
    participating_nodes TEXT[] NOT NULL,
    excluded_nodes TEXT[],
    total_nodes_in_round INTEGER,

    -- Vector data (stored as JSON arrays)
    consensus_vector JSONB,
    raw_vectors JSONB,

    -- Experiment tracking
    experiment_id TEXT,
    hypothesis TEXT,

    -- Node metadata
    reporting_node TEXT,
    metadata JSONB DEFAULT '{}'
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_rq_round_id ON rq_consensus_log(round_id);
CREATE INDEX IF NOT EXISTS idx_rq_timestamp ON rq_consensus_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_rq_experiment ON rq_consensus_log(experiment_id);
CREATE INDEX IF NOT EXISTS idx_rq_agreement ON rq_consensus_log(agreement_score);

-- Row Level Security (RLS) — enable if you want authenticated inserts only
ALTER TABLE rq_consensus_log ENABLE ROW LEVEL SECURITY;

-- Policy: allow inserts from service role
CREATE POLICY "Allow service inserts" ON rq_consensus_log
    FOR INSERT TO service_role
    WITH CHECK (true);

-- Policy: allow authenticated reads
CREATE POLICY "Allow authenticated reads" ON rq_consensus_log
    FOR SELECT TO authenticated
    USING (true);
