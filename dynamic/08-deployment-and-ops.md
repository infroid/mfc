# Deployment & Operations

> How the dynamic stack is built, deployed, monitored, and recovered.

---

## Topology Recap

```
[Browser]
   │
   ├─ HTML/CSS/JS  ──▶ Cloudflare CDN ──▶ GitHub Pages (existing)
   ├─ /api/v1/*    ──▶ Cloudflare CDN ──▶ Fly.io (FastAPI, 2 regions × 2 replicas)
   └─ /media/*     ──▶ Cloudflare CDN ──▶ Supabase Storage (S3-compatible)

FastAPI ──▶ Postgres 16 (Supabase / Neon)
        ──▶ Redis 7 (Upstash)
        ──▶ Supabase Auth (OAuth providers)
        ──▶ Resend (transactional email)
        ──▶ Sentry (errors)
        ──▶ Better Stack (logs + uptime)

arq workers ──▶ same DB / Redis (image processing, digests, view rollups)
```

A single domain hosts everything via Cloudflare path routing — no CORS, first-party cookies.

---

## Local Development

```yaml
# docker-compose.yml
services:
  api:
    build: ./backend
    env_file: .env
    ports: ["8000:8000"]
    depends_on: [postgres, redis, minio]
    volumes: ["./backend:/app"]
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

  worker:
    build: ./backend
    env_file: .env
    depends_on: [postgres, redis]
    command: arq app.tasks.WorkerSettings

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: mfc
      POSTGRES_USER: mfc
      POSTGRES_PASSWORD: mfc
    volumes: ["pgdata:/var/lib/postgresql/data"]
    ports: ["5432:5432"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: mfc
      MINIO_ROOT_PASSWORD: mfcsecret
    ports: ["9000:9000", "9001:9001"]
    volumes: ["miniodata:/data"]

volumes:
  pgdata:
  miniodata:
```

`make dev` brings everything up. `make seed` runs `import_recipes.py` against MinIO. The static frontend uses `python3 -m http.server 8080` (existing dev workflow); a `<meta name="mfc-flags">` injected via a pre-commit hook flips API mode.

---

## Configuration

All config via environment variables, parsed by `pydantic-settings` in [backend/core/config.py](backend/core/config.py).

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Async DSN: `postgresql+asyncpg://...` |
| `REDIS_URL` | `rediss://...` in prod |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | RS256 keypair (rotated quarterly) |
| `JWT_ACCESS_TTL_SECONDS` | 900 |
| `JWT_REFRESH_TTL_SECONDS` | 2592000 |
| `OAUTH_GOOGLE_CLIENT_ID` / `_SECRET` | |
| `OAUTH_APPLE_CLIENT_ID` / `_TEAM_ID` / `_KEY_ID` / `_PRIVATE_KEY` | |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Supabase Storage in prod, MinIO in dev |
| `RESEND_API_KEY` | |
| `SENTRY_DSN` | |
| `LOG_LEVEL` | `info` in prod, `debug` in dev |
| `ALLOWED_ORIGINS` | `["https://myfoodcraving.com"]` |
| `CSRF_SECRET` | random 32 bytes |
| `CDN_PURGE_TOKEN` | for cache-bust on recipe edits |

Secrets stored in Doppler (or Fly.io secrets); never committed. `.env.example` checked in for shape only.

---

## CI/CD

### Pipelines

`.github/workflows/`:

| Workflow | Trigger | Steps |
|----------|---------|-------|
| `backend-ci.yml` | PR / push to `master` (paths: `backend/**`) | install → ruff → mypy → pytest (with services: postgres, redis) → docker build |
| `backend-deploy.yml` | push to `master` after CI green | docker push to GHCR → fly deploy → run alembic upgrade → smoke check |
| `frontend-snapshot.yml` | nightly cron + manual | curl live `/api/v1/recipes` → write to `data/recipes.json` → open PR if diff |
| `e2e.yml` | PR to `master` | spin up docker-compose → run Playwright spec set against staging |
| `visual-diff.yml` | PR | render index/search/recipe pages → compare to baseline (Percy or pixelmatch) |
| `openapi-drift.yml` | PR | start API → fetch `/openapi.json` → diff against `dynamic/openapi.snapshot.json` (fails on unintended drift) |

### Deploy strategy

- **Blue/green** on Fly.io via two app names (`mfc-api`, `mfc-api-canary`) + Cloudflare weighted routing. Canary takes 5% then 25% then 100%.
- **Migrations run before the new image becomes primary**. Backwards-compatible migrations only (additive columns / tables; never drop in same release as code that reads them).
- **Rollback** = flip Cloudflare weights back to the previous app version. Old DB columns kept ≥ 1 release for rollback safety.

---

## Database Migrations Discipline

| Rule | Why |
|------|-----|
| Every migration is reversible (`alembic downgrade` works). | Lets us roll back fast. |
| **No** `DROP COLUMN` in the same release that ships code which stops writing it. Drop in N+1. | Old replicas still write it during a partial deploy. |
| Index creation uses `CREATE INDEX CONCURRENTLY` in prod migrations. | No table locks. |
| Long-running data migrations move to background jobs, not Alembic. | Alembic should be sub-second. |
| `alembic upgrade --sql` output is reviewed in PR. | Catch surprise statements before they run. |

A pre-deploy CI job runs `alembic upgrade --sql > /tmp/plan.sql` and posts the SQL to the PR for human review.

---

## Background Jobs (arq)

| Job | Schedule | Purpose |
|-----|----------|---------|
| `refresh_recipe_rating_stats` | every 15 min | Refresh materialized view for `avg_rating`. |
| `roll_up_recipe_popularity` | hourly | Aggregate `recipe_views` → `mv_recipe_popularity`. |
| `abandon_stale_sessions` | every 30 min | Mark `cooking_sessions` idle > 24 h as `abandoned`. |
| `purge_soft_deleted_users` | daily at 03:00 UTC | Hard-delete users where `deleted_at < now() - 30 days`. |
| `process_uploaded_image` | on-demand (queue) | Resize, encode WebP, compute palette, store under content-hashed key. |
| `weekly_meal_plan_digest` | weekly Sunday | Stretch — emails active meal-plan users a summary. |
| `nightly_emergency_fallback_snapshot` | daily | Calls live API; commits `data/recipes.json` if diff. (Driven by GH Action, not arq.) |

---

## Observability

### Errors — Sentry
- Frontend: `index.html` includes Sentry browser SDK behind `useApi` flag (silent in dev).
- Backend: ASGI middleware integration, breadcrumbs include `request_id`.

### Logs — Better Stack (or Grafana Loki)
- Structured JSON logs (`{ time, level, msg, request_id, user_id, route, status, ms }`).
- Retention 30 days hot, 1 year cold (S3 lifecycle).

### Uptime — Better Stack
- Synthetic checks every 60 s: `/api/v1/health/live`, `/api/v1/recipes`, an OAuth callback shape check, and a logged-in `/auth/me` (with a sentinel test account).

### Metrics — Prometheus + Grafana (Fly.io free tier)
Key dashboards:

| Dashboard | Metrics |
|-----------|---------|
| HTTP | Req/s, p50/p95/p99 latency per route, 4xx/5xx rates |
| DB | Active connections, p95 query time, replication lag (if read replica) |
| Cache | Redis hit ratio, eviction rate, cmd/s |
| Auth | Sign-ups/day, sign-ins/day, refresh failures, refresh-reuse alerts |
| Engagement | Cooking sessions started, completed, abandoned per day |
| Personalization | Recommend p95, cache hit ratio, score-zero rate |

### Alerts (PagerDuty / Email)

| Trigger | Severity |
|---------|----------|
| 5xx rate > 1% over 5 min | P1 |
| API p95 > 1s over 10 min | P2 |
| DB CPU > 85% over 10 min | P2 |
| Refresh-token reuse detected | P1 (security) |
| Storage > 80% full | P3 |
| Backup job failed | P1 |

---

## Backups & Disaster Recovery

| Asset | Backup | RPO | RTO |
|-------|--------|-----|-----|
| Postgres | Supabase PITR (7 days) + nightly `pg_dump` to S3 (30 days) | 1 min | 1 h |
| Object storage | Supabase versioning + nightly inventory to backup bucket | 24 h | 4 h |
| Redis | Not backed up (cache only — rebuildable) | n/a | n/a |
| App config / secrets | Doppler (versioned) | 0 | 5 min |
| Source code | GitHub | 0 | 5 min |

DR drill quarterly: restore last night's `pg_dump` to a fresh Supabase project, repoint a staging app, verify recipe list + a known user can sign in.

---

## Capacity Plan (V1 targets)

| Metric | Target | Notes |
|--------|--------|-------|
| MAU | 10k | Designs to scale 10x without re-architecture |
| Concurrent users | 200 | Fly.io 2x2 handles 5k req/s p99 |
| Recipes | 200 | FTS + GIN scales to 10k+ trivially |
| Saved recipes/user | < 100 | Bounded by UI |
| Cooking sessions/day | 2k | Each ≈ 6 step writes |
| DB rows after 1 year | 500k events / 50k sessions | Partitioned monthly |

Postgres: `db.t4g.medium` equivalent (2 vCPU, 4 GB) is sufficient. Move to `large` at 25k MAU.

---

## Security in Ops

- All ingress TLS 1.3 only (Cloudflare).
- Fly app accepts only Cloudflare IP ranges (or Fly proxy).
- DB allowlist: only Fly machines + admin bastion.
- Secrets rotated quarterly; JWT keypair rotated quarterly with overlap.
- DDoS: Cloudflare WAF + per-IP rate limit at edge before app.
- See [09-security-and-privacy.md](09-security-and-privacy.md) for the security posture in full.

---

## Cost Envelope (monthly, V1 hobby tier)

| Service | Tier | Cost |
|---------|------|------|
| Fly.io (2×2 + worker) | Pay-as-you-go | ~$15 |
| Supabase Pro (DB + Auth + Storage) | $25 | $25 |
| Upstash Redis | Free → $10 | $0–10 |
| Cloudflare | Free | $0 |
| Better Stack | Free | $0 |
| Sentry | Free | $0 |
| Resend | Free (3k emails) | $0 |
| Domain | $12/year | $1 |
| **Total** | | **~$45/mo** |

Plenty of runway before any of these tiers tip over.

---

## Runbooks

`docs/runbooks/`:

- `oncall.md` — escalation tree, dashboards, common issues.
- `incident-template.md` — postmortem skeleton.
- `deploy-rollback.md` — exact commands.
- `db-restore.md` — PITR + dump restore steps.
- `oauth-cred-rotation.md` — Google / Apple key rotation.
- `jwt-key-rotation.md` — overlap window protocol.
- `ddos-response.md` — Cloudflare under-attack mode toggle.
