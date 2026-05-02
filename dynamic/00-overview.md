# MyFoodCraving — Static → Dynamic Conversion Plan

> **Goal**: Convert the current static marketing + recipe site into a fully dynamic, personalized application — **without altering any UI/UX components**.

---

## Executive Summary

| Aspect | Decision |
|--------|----------|
| **UI/UX** | Frozen. No DOM, CSS, or component changes beyond endpoint wiring. |
| **Anonymous experience** | First-class: search + view recipes + use timers/voiceover/checklist all work without login. |
| **Auth experience** | Additive: unlocks personalization, saved recipes, history, preferences, meal planner. |
| **Backend** | FastAPI + PostgreSQL 16 + Redis + Supabase Auth + S3-compatible storage. |
| **Frontend changes** | One-time `shared/auth.js` swap, `fetch()` URL rewiring, feature gates on auth state. |
| **Delivery** | 6 phases over ~10 weeks (see [05-migration-plan.md](05-migration-plan.md)). |

---

## Guiding Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **UI/UX parity** | Every pixel, animation, font, and interaction stays identical. The frontend React components (`index.html`, `recipe-search.html`, `recipe.html`, `recipe-components.jsx`) remain the source of truth for presentation. |
| 2 | **Anonymous-first** | Browsing, searching, and full guided cooking work without auth. Auth never blocks core utility — only enhances it. The `?id=...` URL contract is preserved so existing links continue to work. |
| 3 | **Progressive enhancement** | Auth unlocks personalization, saved recipes, health profiles, ratings, meal planner, and preference sync. Anonymous local state (cooking progress, tweak panel) is preserved client-side and **migrated into the account on first sign-in**. |
| 4 | **API-first, shape-preserving** | A versioned REST API (`/api/v1`) sits between the frontend and all data. Response shapes match the existing JSON files exactly. The frontend swaps `fetch('data/...')` for `fetch('/api/v1/...')` — same JSON, no component rewrites. |
| 5 | **Thin auth migration** | `shared/auth.js` already defines the `{ id, name, email, avatar, provider }` contract. We honor that shape; only the internals swap from localStorage to JWT-cookie + API calls. The `mfc:auth-change` event continues to fire. |
| 6 | **Data-driven personalization** | Today, `HEALTH_METRICS`, `PERSONA_MEALS`, and `microTargets()` are hardcoded arrays in `index.html`. The dynamic version moves the **mapping** to the database (so we can ship new metrics without redeploying frontend) while keeping the UI rendering identical. |

---

## Technology Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **Frontend** | React 18 + Babel Standalone (existing) | No change — keep CDN-loaded, in-browser JSX compilation. |
| **API** | **FastAPI** (Python 3.12, async) | Auto OpenAPI docs, pydantic validation, easy to deploy. |
| **Database** | **PostgreSQL 16** | Relational fits naturally: users → profiles → metrics; recipes → steps/ingredients. Native FTS via `tsvector`. |
| **ORM / Migrations** | **SQLAlchemy 2.0 (async) + Alembic** | Mature, typed, autogen migrations. |
| **Auth** | **Supabase Auth** (or self-hosted GoTrue) | Google + Apple Sign-In OOTB, JWT-based, hosted. Matches the "coming soon" provider chips in the current sign-in modal. |
| **Cache / rate-limit / sessions** | **Redis 7** | Hot recipe cache, refresh-token blacklist, sliding-window rate limiter. |
| **Object Storage / CDN** | **Supabase Storage** (S3-compatible) + **Cloudflare CDN** | Recipe hero images, step images, user avatars. Long-cache, public-read. |
| **Email** | **Resend** | Verification, password reset, weekly meal-plan digest (stretch). |
| **Background jobs** | **arq** (Redis-backed) | Image-processing, weekly digests, analytics rollups. |
| **Deployment** | **Docker Compose** (dev) → **Fly.io** or **Railway** (prod) | Single-command dev, cheap hobby deploy with zero-downtime regions. |
| **Observability** | **Sentry** (errors) + **Better Stack** (logs/uptime) | Free tiers cover early traffic. |

See [08-deployment-and-ops.md](08-deployment-and-ops.md) for the full topology.

---

## Feature Inventory by Auth State

### Anonymous (no login required)
- Browse landing page (`index.html`) — full marketing content + craving picker preview.
- Search & filter recipes (`recipe-search.html`) — full-text search, cuisine/diet filters, deep-linkable URLs.
- View full recipe detail + guided cooking (`recipe.html`) — step timers, ingredient checklist with serving-size scaling, voiceover player, utensils panel, health-fact marquee.
- Adjust tweak panel (session-only persistence).
- All recipe images cached at the edge (CDN).

### Authenticated (login unlocks)
- **Health Profile**: CRUD health metrics (iron, B12, sodium, fiber, custom). Toggle flags.
- **Personalized Recommendations**: Meal suggestions tuned to active health flags using a data-driven scoring engine ([07-personalization-engine.md](07-personalization-engine.md)).
- **Save / Bookmark Recipes**: Persist to user library with personal notes.
- **Cooking History**: Track which recipes were cooked, when, completion %; resume sessions across devices.
- **Ratings & Reviews**: 1–5 stars + optional review text.
- **Preference Sync**: Tweak panel settings, default servings, last-cooked step persisted server-side.
- **Meal Planner** (stretch): Assign recipes to days; auto-generate aggregated shopping list.
- **Health Platform Sync** (stretch): Apple Health / Google Fit metric ingestion.
- **Account Lifecycle**: Email verification, password reset, GDPR data export, hard-delete.

---

## Success Metrics (V1 ship criteria)

| Category | Metric | Target |
|----------|--------|--------|
| **Performance** | p95 recipe-list TTFB | < 200 ms (cached); < 500 ms (cold) |
| **Performance** | p95 recipe-detail TTFB | < 250 ms (cached) |
| **Performance** | Lighthouse perf score (recipe page) | ≥ 90 (no regression vs static) |
| **Reliability** | API availability (30-day rolling) | ≥ 99.5% |
| **Auth** | Sign-up → first cook conversion | ≥ 25% |
| **Personalization** | % logged-in users with ≥ 1 active health flag | ≥ 60% |
| **Engagement** | % cooking sessions completed (logged-in) | ≥ 55% |
| **SEO** | Indexed recipe pages within 14 days | 100% (anonymous-readable) |

---

## Document Index

| File | Contents |
|------|----------|
| [01-database-schema.md](01-database-schema.md) | Full PostgreSQL schema: tables, relationships, indexes, constraints, FTS. |
| [02-class-diagram.md](02-class-diagram.md) | UML domain models, service layer, sequence diagrams, deployment topology. |
| [03-flow-diagrams.md](03-flow-diagrams.md) | High-level business/process flows: auth, search, personalization, cooking, save, rate, prefs, anonymous→auth merge, media delivery. |
| [04-api-contract.md](04-api-contract.md) | REST API endpoints, request/response shapes, auth, caching, rate limits. |
| [05-migration-plan.md](05-migration-plan.md) | Phased rollout, data migration scripts, risks, rollback strategy. |
| [06-frontend-integration.md](06-frontend-integration.md) | Frontend changes: `shared/auth.js` swap, `fetch()` rewiring, feature gates, anonymous-state hand-off. |
| [07-personalization-engine.md](07-personalization-engine.md) | Nutrient-mapping schema, scoring algorithm, explanation generation, cold-start. |
| [08-deployment-and-ops.md](08-deployment-and-ops.md) | Docker, CI/CD, monitoring, secrets, backups, scaling. |
| [09-security-and-privacy.md](09-security-and-privacy.md) | PII inventory, GDPR, JWT lifecycle, CSRF, CSP, rate limiting, retention. |

---

## Non-Goals (Explicitly Out of Scope for V1)

- Rewriting the frontend framework (no Next.js, no Vite, no SSR).
- Changing any CSS, design tokens, or visual components.
- CMS or admin panel (recipes managed via Alembic seed scripts in V1; admin UI is V2).
- Native mobile app (the web app is already responsive and PWA-ready).
- Payment / subscription (no monetization in V1).
- Real-time collaborative cooking (no WebSockets in V1; HTTP polling is sufficient for resume-on-device).
- LLM-generated recipes (curation is human-driven; LLM is used only for ingredient normalization tooling at import time).
