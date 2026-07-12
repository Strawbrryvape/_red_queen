# 🛑 SYNTROPY LLC: PROPRIETARY & CONFIDENTIAL
# This codebase and document are the intellectual property of Syntropy LLC.
# Unauthorized distribution is prohibited.

# PROJECT: RED QUEEN (Backend)
# VERSION: v2.0.1
# LAST EDITOR: Claude Fable 5
# DATE: 2026-07-12
# STATUS: IN_PROGRESS

---

## 1. SYNTROPY ECOSYSTEM CONTEXT
*Every model must read this before editing. Do not build in isolation.*

**Mission:** Eliminate entropy by developing govtech and public-utility software that solves micro-specific problems for agencies and citizens. No data farming. No subscriptions. Toll access only.

**The 4 Apps:**
- **LEDGER** — Dating/social protocol ($5 toll, zero-dwell, anti-swipe, 48h chat expiry, 60-day purge)
- **NEXUS** — P2P commerce rail ($5 toll, direct payments, immutable receipts)
- **MATRIX** — Housing protocol ($5 tenant / $50 landlord toll)
- **AXIS** — Transit & delivery layer ($15/annual)

**Support Systems:**
- **MAXWELL** — AI orchestrator (decomposition, routing, task management)
- **RED QUEEN** — Verification & consensus engine (state-machine logic, audit, cross-model validation)

**Current Build:** RED QUEEN backend (orchestrator + vector mesh). UI is in separate repo `red-queen-ui`.

---

## 2. PROJECT SNAPSHOT
- **App Name:** Red Queen (Backend)
- **Primary Domain:** n/a (backend). UI: zyn-redqueen.netlify.app
- **Type:** Backend-Heavy (Python)
- **Framework:** Python 3 / Docker / Supabase bridge
- **Design Language:** n/a (backend). UI repo uses: dark radial #0A0A0A→#1A0505, cherry red #E63946, agent colors #4285F4/#00D4AA/#D4A574, Space Grotesk + Inter

---

## 3. WHAT WAS JUST COMPLETED
- [x] v2.0.1 live debugging pass
- [x] UI v2.1 refactor shipped to separate `red-queen-ui` repo, deployed with demo mode
- [x] Backend repo cleaned for GitHub: secrets audit passed, .gitignore + README added

## 4. WHAT IS PENDING / NEXT IN QUEUE
| Task | Priority | Assigned To | Notes |
|------|----------|-------------|-------|
| Host backend (Render/Railway/Docker) | HIGH | TBD | Netlify cannot run this |
| Fund API credits, enter keys in UI Settings | HIGH | Founder | Unlocks live Council in UI |
| Wire UI → backend bridge (RQ_ENDPOINT_URL) | MED | Claude | After hosting chosen |
| v4 architecture planning (tiered autonomy charter) | MED | Kimi + Gemini | Charter finalized |

## 5. KNOWN BUGS & BLOCKERS
| Bug | Severity | Notes |
|-----|----------|-------|
| None open | — | v2.0.1 stable after live debug |

## 6. ARCHITECTURE & SECURITY
*⚠️ NEVER hardcode API keys, DB URIs, or secrets in frontend files.*

- **Frontend:** Netlify static (separate repo `red-queen-ui`)
- **Backend/DB:** Python orchestrator + Supabase (see supabase_migration.sql)
- **Required Env Variables:** See .env.example — RQ_NODE_ID, RQ_MESH_SECRET, SUPABASE_URL, SUPABASE_KEY, etc. Names only, values live in .env (gitignored)
- **External Integrations:** Supabase; optional webhook bridge; AI provider APIs called from UI, not backend
- **Schema Notes:** Consensus rounds logged to rq_consensus_log; mesh nodes broadcast on Docker subnet, similarity threshold 0.7, min 2 nodes

## 7. FILE STRUCTURE MAP
```text
/orchestrator/       ← consensus engine, vector mesh, node, bridge, config, logger
/docker/             ← Dockerfile, docker-compose.yml
/docs/               ← architecture & protocol docs (.docx)
/supabase_migration.sql
/test_rq_v2.py
/requirements.txt
/.env.example        ← template; real .env is gitignored
/MASTER_HANDOFF.md   ← This file
```

## 8. NETLIFY 7-STEP AUDIT (Mandatory Before Zip)
n/a for this repo (backend, not Netlify-deployed). Applies to `red-queen-ui` repo — already passing.

## 9. TRI-MODEL ROLE MAP
Who built what, who audits, who deploys.

- **Kimi (K2.6/K2.7)** — Lead Architect, Swarm Coordinator, Prompt Engineering, Systems Audit
- **Gemini Pro** — Legal/Strategic, Creative Briefs, Terms of Service, Competitive Analysis
- **Claude (Fable/Sonnet/Opus)** — Senior Frontend/Backend Engineer, Zip Build, Code Implementation

**Last Handoff:** Kimi spec'd UI v2.1 → Fable built + deployed → pending Gemini audit

## 10. MESSAGE FOR NEXT MODEL
UI v2.1 is LIVE at zyn-redqueen.netlify.app from repo `red-queen-ui` (flat structure, root-level files, NO build step — build command in Netlify must stay EMPTY). Demo mode active until founder funds API credits; keys go in the UI's Settings drawer, not env vars. This backend repo is storage-only until hosted — do NOT attempt to deploy it to Netlify. Do NOT merge either Red Queen repo into Maxwell's repo; Maxwell's Vite/workspaces config broke RQ deploys for 80 minutes on 2026-07-12.

## 11. OWNER / STRATEGIC NOTES
Red Queen is private and in development — not commercial or public. Mission: solving complex problems no single human or AI can solve, focused on AI research breakthroughs. API credit funding pending.
