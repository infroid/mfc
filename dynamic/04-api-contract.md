# API Contract

> All endpoints are prefixed with `/api/v1`. Responses are JSON.
> Auth: short-lived JWT in `httpOnly` cookie `mfc_access_token`; opaque refresh token in `httpOnly` cookie `mfc_refresh_token`.
> CSRF: double-submit pattern — non-httpOnly cookie `mfc_csrf` echoed in `X-CSRF-Token` header on mutations.

---

## Conventions

| Aspect | Convention |
|--------|-----------|
| **Versioning** | URL prefix `/api/v1`. Breaking changes ship as `/api/v2`; v1 stays alive ≥ 90 days. |
| **Base URL** | Dev: `http://localhost:8000/api/v1`. Prod: `https://api.myfoodcraving.com/api/v1` (or behind same domain via CDN). |
| **Auth** | Cookies; clients send with `credentials: 'include'`. Mutations require `X-CSRF-Token` header. |
| **Pagination** | `?page=1&limit=20` → `{ items, total, page, pages }`. |
| **Errors** | `{ "detail": "..." | [...] }` with appropriate HTTP status. |
| **Dates** | ISO 8601 UTC (`2026-05-02T17:30:00Z`). |
| **IDs** | UUIDs for user-scoped entities; slugs for recipes (preserves URL contract). |
| **Casing** | Response field names **mirror existing static JSON shapes** (mixed `totalMinutes`, `colorSoft`, `media.hero`). |
| **OpenAPI** | Auto-generated at `/api/v1/openapi.json`; Swagger UI at `/api/v1/docs` (gated behind admin auth in prod). |
| **Caching** | Public GETs return `Cache-Control` + `ETag`; client should send `If-None-Match` on revalidation. |
| **Rate limits** | Sliding window in Redis; `X-RateLimit-*` headers on every response. |
| **Request IDs** | Server reads `X-Request-Id` if provided; otherwise generates one. Echoed back on every response and logged for correlation. |

---

## 1. Auth

### `POST /api/v1/auth/signup`

Create a new account with email/password. Sends verification email.

```json
// Request
{
  "name": "Aman Rai",
  "email": "aman@example.com",
  "password": "securepass123"
}

// Response 201
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Aman Rai",
    "email": "aman@example.com",
    "avatar": null,
    "provider": "email"
  }
}
// + Set-Cookie: mfc_access_token=...; mfc_refresh_token=...; mfc_csrf=...
```

> Response shape mirrors `shared/auth.js` `getUser()` (`avatar` not `avatar_url`).

### `POST /api/v1/auth/login`

```json
// Request
{ "email": "aman@example.com", "password": "securepass123" }

// Response 200 — same shape as signup
```

### `GET /api/v1/auth/oauth/{provider}`

302 redirect to OAuth consent. `provider` ∈ `google`, `apple`. Generates state nonce, persists in Redis (5 min TTL).

### `GET /api/v1/auth/callback/{provider}`

OAuth callback. Verifies state nonce, exchanges code for tokens, creates/links user, sets cookies, 302 to `/`.

### `POST /api/v1/auth/refresh`

Exchanges a refresh cookie for a new access+refresh pair. **Rotates** the refresh token; old session row revoked. Reuse of a revoked refresh triggers `sign_out_all`.

```json
// Response 200
{ "user": { /* current user */ } }
// + new Set-Cookie pair
```

### `POST /api/v1/auth/logout`

Clears auth cookies + revokes the current session row. `204`.

### `POST /api/v1/auth/logout-all`

Revokes every active session for the current user. `204`.

### `GET /api/v1/auth/me`

Returns current user from access token.

```json
// Response 200
{ "id": "...", "name": "Aman Rai", "email": "aman@example.com", "avatar": null, "provider": "email" }

// Response 401 — { "detail": "Not authenticated" }
```

### `POST /api/v1/auth/verify-email`

```json
// Request
{ "token": "..." }

// Response 204
```

### `POST /api/v1/auth/forgot-password`

```json
// Request
{ "email": "..." }

// Response 204 (always, to avoid email enumeration)
```

### `POST /api/v1/auth/reset-password`

```json
// Request
{ "token": "...", "password": "..." }

// Response 204
```

### `POST /api/v1/auth/merge-anonymous`

Migrate anonymous-state into the freshly-signed-in account. See [03-flow-diagrams.md §9](03-flow-diagrams.md).

```json
// Request
{
  "saved": [{ "recipe_id": "paneer-butter-masala", "saved_at": "2026-05-01T...", "notes": null }],
  "preferences": { "tweak.accent": "#FF6D2E", "tweak.density": "compact" },
  "sessions": [
    { "recipe_id": "paneer-butter-masala", "last_step": 3, "completion_pct": 42, "started_at": "...", "servings_cooked": 4 }
  ]
}

// Response 204
```

### `DELETE /api/v1/auth/account`

Soft-deletes the account. Hard delete after 30-day grace.

```json
// Request
{ "password": "current-password" }   // omitted for OAuth-only users

// Response 204
```

### `GET /api/v1/auth/sessions`

List active sessions (for "Signed in on N devices" UI).

```json
{
  "items": [
    { "id": "...", "user_agent": "Chrome on macOS", "ip_inet": "1.2.3.4", "created_at": "...", "last_used_at": "...", "current": true }
  ]
}
```

### `DELETE /api/v1/auth/sessions/{id}`

Revoke a specific session. `204`.

---

## 2. Recipes (Public)

### `GET /api/v1/recipes`

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Full-text search query |
| `filter` | string | `vegetarian`, `non-veg`, `easy`, `quick`, `south` (matches existing chips) |
| `cuisine` | string | Filter by cuisine |
| `tag` | string (repeatable) | Tag intersection |
| `featured` | boolean | Only featured recipes |
| `sort` | string | `relevance` (default with `q`), `popular`, `newest`, `time-asc` |
| `page` | int | default 1 |
| `limit` | int | default 20, max 50 |

**Headers**:
- `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=300`
- `ETag: "recipes-v{N}-{hash}"`
- `Vary: Cookie` (logged-in responses don't get cached at edge)

```json
// Response 200
{
  "items": [
    {
      "id": "paneer-butter-masala",
      "name": "Paneer Butter Masala",
      "tagline": "Silky tomato-cashew gravy, restaurant-style at home",
      "cuisine": "North Indian",
      "difficulty": "Easy",
      "totalMinutes": 35,
      "servings": 4,
      "tags": ["vegetarian", "gluten-free"],
      "color": "#FF6D2E",
      "colorSoft": "rgba(255,109,46,0.15)",
      "featured": true,
      "highlight": "14g protein per serving from paneer",
      "media": {
        "emoji": "🧀",
        "card": {
          "src": "https://cdn.../paneer-butter-masala/{hash}-card.webp",
          "alt": "Paneer Butter Masala",
          "fit": { "scale": 1.15, "x": "0%", "y": "0%", "position": "50% 50%" }
        }
      },
      "is_saved": false,
      "avg_rating": 4.6,
      "rating_count": 23
    }
  ],
  "total": 10,
  "page": 1,
  "pages": 1
}
```

> Item shape matches `data/recipes.json` exactly, plus optional enrichment fields.

### `GET /api/v1/recipes/{id}`

Full recipe detail. Response shape matches `data/recipe-bundles/{id}/recipe.json`.

```json
// Response 200
{
  "id": "paneer-butter-masala",
  "name": "Paneer Butter Masala",
  "tagline": "creamy · tomato · 35 min",
  "cuisine": "North Indian",
  "difficulty": "Easy",
  "servings": 4,
  "totalMinutes": 35,
  "media": {
    "emoji": "🧀",
    "hero": {
      "src": "https://cdn.../paneer-butter-masala/{hash}-hero.webp",
      "palette": ["#FF6D2E", "#F4D67A", "#E2531A"],
      "alt": "Paneer Butter Masala plated dish",
      "caption": "paneer butter masala — overhead shot",
      "fit": { "scale": 1, "x": "0%", "y": "0%" }
    }
  },
  "healthFacts": ["Paneer adds ~14g protein per 100g...", "..."],
  "ingredients": [
    { "name": "Paneer", "amt": "300g", "group": "main" }
  ],
  "steps": [
    {
      "id": 1,
      "title": "Soak the cashews",
      "detail": "Drop cashews in ½ cup hot water...",
      "duration": 300,
      "tip": "Hot tap water works...",
      "media": { "src": "https://cdn.../step-1.webp", "caption": "Step 1 reference shot" }
    }
  ],
  "utensils": [{ "name": "Heavy-bottomed pan / kadhai", "essential": true }],

  // Enrichment for logged-in users (omitted/null for anonymous)
  "is_saved": true,
  "user_rating": 4,
  "avg_rating": 4.6,
  "rating_count": 23,
  "active_session": { "id": "...", "last_step": 3, "completion_pct": 42 }
}
```

### `POST /api/v1/recipes/{id}/view` (optional, fire-and-forget)

Idempotent view-counter ping. Anonymous users dedup via IP+day Redis key; logged-in via user+day. `204`.

---

## 3. Health Profile (Auth Required)

### `GET /api/v1/health/profile`

Returns active profile + metrics. If user has no profile, server **auto-creates** one seeded with default metrics.

```json
{
  "id": "...",
  "label": "Default",
  "is_active": true,
  "metrics": [
    {
      "metric_id": "iron",
      "name": "Iron",
      "sub": "Below range",
      "value": 9.2,
      "val": "9.2 g/dL",
      "unit": "g/dL",
      "target": 12.0,
      "is_active": true,
      "default": true,
      "source": "manual"
    },
    {
      "metric_id": "b12",
      "name": "B12",
      "sub": "Within range",
      "value": 412,
      "val": "412 pg/mL",
      "unit": "pg/mL",
      "target": 500,
      "is_active": true,
      "default": true,
      "source": "apple_health"
    }
  ]
}
```

> The `name`, `sub`, `val`, and `default` fields are **named to match** the existing `HEALTH_METRICS` array shape in `index.html:618` so the frontend `Personalize` component renders without changes.

### `POST /api/v1/health/profile`

```json
// Request
{ "label": "Cutting phase" }

// Response 201 — profile with empty metrics
```

### `GET /api/v1/health/profiles`

List all profiles. Used for the (future) profile-switcher UI. `200`.

### `PATCH /api/v1/health/profiles/{id}/activate`

Set the given profile as active. `204`.

### `PATCH /api/v1/health/metrics/{metric_id}`

Update a metric value, target, or active state. Upsert if not yet present.

```json
// Request — toggle only
{ "is_active": false }

// Request — full update
{ "value": 11.5, "target": 13.0, "is_active": true, "source": "manual" }

// Response 200 — updated metric
```

### `POST /api/v1/health/sync/{platform}`

Stretch. `platform` ∈ `apple`, `google`. Body is platform-specific payload; server normalizes and upserts. `204`.

---

## 4. Personalization (Auth Required)

### `GET /api/v1/personalization/recommend`

Returns the recommended meal for the user's current active flags.

```json
{
  "meal": {
    "name": "Mediterranean Quinoa Bowl",
    "recipe_id": "mediterranean-quinoa-bowl",
    "tags": ["+47% iron", "low sodium", "B12 boost"]
  },
  "micro_targets": [
    { "label": "Iron",   "pct": 84, "color": "berry",  "v": "4.2mg" },
    { "label": "B12",    "pct": 76, "color": "matcha", "v": "3.1µg" },
    { "label": "Fiber",  "pct": 48, "color": "butter", "v": "8g" },
    { "label": "Sodium", "pct": 28, "color": "orange", "v": "380mg", "inverted": true }
  ],
  "explanation": "Tuned for Iron · B12 · Sodium watch. Macros sit inside your goals, micros patch your gaps.",
  "active_flag_ids": ["iron", "b12", "sodium"]
}
```

> `micro_targets[].v` matches the `v` field used in `microTargets()` (`index.html:687`), not `value`. The `Personalize` component renders directly without remapping.

### `GET /api/v1/personalization/recommend/anonymous`

Returns the **same demo response** the landing page currently renders for anonymous browsers — driven by static `PERSONA_MEALS` defaults. Provided so the frontend can use a single code path for both auth states.

---

## 5. Cooking Sessions (Auth Required)

### `POST /api/v1/cooking/sessions`

```json
// Request
{ "recipe_id": "paneer-butter-masala", "servings": 4 }

// Response 201
{
  "id": "...",
  "recipe_id": "paneer-butter-masala",
  "recipe_version": 1,
  "status": "in_progress",
  "servings_cooked": 4,
  "completion_pct": 0,
  "last_step": 1,
  "started_at": "2026-05-02T18:00:00Z"
}
```

### `POST /api/v1/cooking/sessions/{id}/steps`

```json
// Request
{ "step_number": 3, "event": "complete", "timer_used": true }
// event ∈ "start" | "complete" | "skip"

// Response 200
{ "session_id": "...", "completion_pct": 42, "last_step": 3 }
```

### `PATCH /api/v1/cooking/sessions/{id}`

Heartbeat or status change. Used for resume + abandon.

```json
// Request — heartbeat
{ "last_step": 3 }

// Request — complete or abandon
{ "status": "completed" }
```

### `GET /api/v1/cooking/sessions`

| Param | Type | Description |
|-------|------|-------------|
| `recipe_id` | string | Filter by recipe |
| `status` | string | `in_progress` / `completed` / `abandoned` |
| `limit` | int | default 10 |

```json
{
  "items": [
    {
      "id": "...",
      "recipe_id": "paneer-butter-masala",
      "recipe_name": "Paneer Butter Masala",
      "status": "completed",
      "completion_pct": 100,
      "started_at": "2026-05-02T18:00:00Z",
      "completed_at": "2026-05-02T18:35:00Z"
    }
  ],
  "total": 5
}
```

---

## 6. Saved Recipes (Auth Required)

### `GET /api/v1/saved`

```json
{
  "items": [
    {
      "recipe_id": "paneer-butter-masala",
      "saved_at": "2026-05-01T10:00:00Z",
      "notes": "Make this for Diwali dinner",
      "recipe": { /* same shape as GET /api/v1/recipes list item */ }
    }
  ],
  "total": 3
}
```

### `POST /api/v1/saved`

```json
// Request
{ "recipe_id": "paneer-butter-masala", "notes": "..." }

// Response 201
```

### `DELETE /api/v1/saved/{recipe_id}` → `204`

### `PATCH /api/v1/saved/{recipe_id}`

Update note only.

```json
{ "notes": "Try with less cream next time" }
```

---

## 7. Ratings (Auth Required)

### `PUT /api/v1/ratings/{recipe_id}`

```json
// Request
{ "rating": 4, "review": "Loved the cashew gravy trick" }

// Response 200
{
  "rating": 4,
  "review": "Loved the cashew gravy trick",
  "avg_rating": 4.6,
  "rating_count": 24
}
```

### `GET /api/v1/ratings/{recipe_id}`

User's own rating. `200` or `404`.

### `DELETE /api/v1/ratings/{recipe_id}` → `204`

---

## 8. User Preferences (Auth Required)

### `GET /api/v1/preferences`

```json
{
  "tweak.accent": "#FF6D2E",
  "tweak.secondAccent": "#7A9C5A",
  "tweak.bg": "#F7F1E3",
  "tweak.wildcardFont": true,
  "tweak.density": "regular",
  "cook.default_servings": 4
}
```

### `PUT /api/v1/preferences`

Bulk upsert (debounced from frontend). Returns merged map.

```json
// Request
{ "tweak.accent": "#E2531A", "tweak.density": "compact" }

// Response 200 — full merged preferences
```

### `DELETE /api/v1/preferences/{key}` → `204`

---

## 9. Meal Plan (Auth Required — Stretch)

### `GET /api/v1/meal-plan`

| Param | Type | Description |
|-------|------|-------------|
| `week` | string | ISO week (`2026-W18`) |
| `start` | string | Date range start |
| `end` | string | Date range end |

```json
{
  "entries": [
    {
      "id": "...",
      "recipe_id": "paneer-butter-masala",
      "recipe_name": "Paneer Butter Masala",
      "plan_date": "2026-05-05",
      "meal_slot": "lunch",
      "servings": 2
    }
  ]
}
```

### `POST /api/v1/meal-plan`

```json
{ "recipe_id": "...", "plan_date": "2026-05-05", "meal_slot": "lunch", "servings": 2 }
```

### `DELETE /api/v1/meal-plan/{id}` → `204`

### `GET /api/v1/meal-plan/shopping-list?start=...&end=...`

```json
{
  "items": [
    { "ingredient_id": "paneer", "name": "Paneer", "total_amount": "600g", "recipes": ["Paneer Butter Masala", "Palak Paneer"] }
  ]
}
```

---

## 10. Account / GDPR

### `GET /api/v1/account/export`

Streams a JSON archive of all user data (profile, metrics, saved, sessions, ratings, prefs). Triggers an audit event.

### `DELETE /api/v1/auth/account`

Already documented above. Soft-deletes; hard-purge after 30 days.

---

## Error Responses

| Status | Meaning | Body |
|--------|---------|------|
| `400` | Bad request | `{ "detail": "Invalid email format" }` |
| `401` | Not authenticated | `{ "detail": "Not authenticated" }` |
| `403` | Forbidden / CSRF mismatch | `{ "detail": "CSRF token mismatch" }` |
| `404` | Not found | `{ "detail": "Recipe not found" }` |
| `409` | Conflict | `{ "detail": "Email already registered" }` |
| `412` | Precondition failed (ETag) | `{ "detail": "Resource changed" }` |
| `422` | Validation error | `{ "detail": [{"loc":[...],"msg":"...","type":"..."}] }` |
| `429` | Rate limited | `{ "detail": "Too many requests" }`, `Retry-After: 30` |
| `500` | Server error | `{ "detail": "Internal server error" }` (correlation via `X-Request-Id`) |
| `503` | Maintenance / read-only | `{ "detail": "Service temporarily unavailable" }` |

---

## Rate Limiting

Implemented as sliding-window counters in Redis, keyed by `user_id` (logged-in) or hashed IP (anonymous).

| Endpoint group | Limit |
|---------------|-------|
| Auth (signup/login/forgot/reset) | 5 req/min/IP |
| OAuth callback | 30 req/min/IP |
| Recipe read | 60 req/min/IP |
| Recipe view ping | 1 req/recipe/min/user-or-IP |
| Write (saved/ratings/cooking/prefs/meal-plan) | 30 req/min/user |
| Health metrics PATCH | 30 req/min/user |
| Health platform sync | 10 req/min/user |
| Account export | 1 req/hour/user |

Every response includes:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1714669200
```

---

## Versioning Policy

- Additive changes (new fields, new endpoints) ship in v1.
- Breaking changes (rename, remove, type change) require v2.
- v1 stays alive ≥ 90 days after v2 GA. Deprecated endpoints respond with `Deprecation: true` and `Sunset:` headers.
- The frontend reads `window.MFC_API_VERSION` (default `v1`) so flipping versions is a one-line change.

---

## OpenAPI / Tooling

- FastAPI auto-generates the spec at `/api/v1/openapi.json`.
- Spec is checked into the repo at `dynamic/openapi.snapshot.json` and validated in CI to catch unintended schema drift.
- Frontend can optionally consume a TS type bundle via `openapi-typescript` (kept out of the runtime — only used in editors / linting).
