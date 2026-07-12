# 🔴👑 Red Queen v2 — Backend

**Syntropy LLC — Proprietary & Confidential**

Multi-agent orchestration backend: consensus engine, vector mesh, and node bridge for the Red Queen Council (Gemini / Kimi / Claude).

> **Note:** This is the *backend*. The live UI at zyn-redqueen.netlify.app lives in the separate `red-queen-ui` repo and runs standalone (demo mode, or live with browser-side API keys). This backend requires a Python server (Render / Railway / Docker host) — it cannot run on Netlify.

## Contents
- `orchestrator/` — consensus engine, vector mesh, node logic, config, logging, bridge
- `docker/` — Dockerfile + docker-compose for the mesh network
- `docs/` — architecture, deployment guide, research protocol (.docx)
- `supabase_migration.sql` — consensus log table schema
- `test_rq_v2.py` — test suite
- `.env.example` — config template (copy to `.env`, fill in, never commit)

## Quick start
```bash
pip install -r requirements.txt
cp .env.example .env   # fill in your values
python test_rq_v2.py   # verify
```

See `docs/Red_Queen_v2_Architecture_Deployment_Guide.docx` for full deployment.

Read `MASTER_HANDOFF.md` before editing. Every model. Every time.
