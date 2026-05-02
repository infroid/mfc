# High-Level Flow Diagrams

> Business and process flows for every major feature area. All flows are designed so anonymous users get full core value; authenticated users get persistence + personalization.

---

## 1. Authentication Flow

The current `shared/auth.js` stores a user object in localStorage with `provider: 'demo'`. The dynamic version replaces this with real JWT-based auth while preserving the exact same `{ id, name, email, avatar, provider }` contract and the `mfc:auth-change` CustomEvent.

```mermaid
flowchart TB
    subgraph Frontend ["Frontend (unchanged UI)"]
        A["User clicks 'Sign in →'<br/>in Nav component"] --> B["AuthModal renders<br/>(name + email + password<br/>or 'Continue with Google/Apple')"]
        B --> C{Provider?}
        C -->|Email/Password| D["POST /api/v1/auth/signup<br/>or POST /api/v1/auth/login"]
        C -->|Google| E["GET /api/v1/auth/oauth/google<br/>→ 302 to Google consent"]
        C -->|Apple| F["GET /api/v1/auth/oauth/apple<br/>→ 302 to Apple Sign-In"]
    end

    subgraph Backend ["Backend (FastAPI)"]
        D --> G["AuthService.sign_up()<br/>or sign_in()"]
        E --> H["GET /api/v1/auth/callback/google"]
        F --> I["GET /api/v1/auth/callback/apple"]
        G --> J["Verify password / create user row"]
        H --> J
        I --> J
        J --> K["Issue JWT pair:<br/>access (15m) + refresh (30d)<br/>Store refresh hash in auth_sessions"]
    end

    subgraph Client ["Client State"]
        K --> L["Set httpOnly cookies:<br/>mfc_access_token<br/>mfc_refresh_token<br/>SameSite=Strict; Secure"]
        L --> M["FE calls GET /api/v1/auth/me<br/>(reads decoded user)"]
        M --> N["shared/auth.js<br/>caches user in memory<br/>+ dispatches 'mfc:auth-change'"]
        N --> O["Nav re-renders:<br/>avatar + name shown"]
        O --> P["Anonymous-state merge<br/>(see Flow 9)"]
    end

    subgraph Protected ["Subsequent requests"]
        P --> Q["fetch('/api/v1/...', {<br/>  credentials: 'include',<br/>  headers: {'X-CSRF-Token': csrf}<br/>})"]
        Q --> R{Access token valid?}
        R -->|Yes| S["Process with user context"]
        R -->|Expired| T["FE auto-refresh:<br/>POST /api/v1/auth/refresh"]
        T -->|Success| Q
        T -->|Failure| U["Clear cookies →<br/>show sign-in modal"]
    end
```

### Key decisions:
- **httpOnly cookies** for JWTs — not localStorage — to prevent XSS theft.
- **CSRF**: double-submit cookie. A separate non-httpOnly `mfc_csrf` cookie carries a random value; clients echo it back in the `X-CSRF-Token` header for state-changing methods.
- **Silent refresh**: a fetch wrapper retries once on 401 with the refresh endpoint.
- The `AuthModal` component stays pixel-identical; only `handleSubmit()` swaps from `window.MFC.auth.signIn(...)` (local) to an API call.

---

## 2. Recipe Search & View Flow (Anonymous)

This flow must work **without any login**. The frontend currently fetches `data/recipes.json` and `data/recipe-bundles/{id}/recipe.json`. The dynamic version serves the same shapes from API endpoints, with edge caching for SEO + performance.

```mermaid
flowchart TB
    subgraph Search ["recipe-search.html"]
        A["User lands on<br/>recipe-search.html"] --> B["App component mounts"]
        B --> C["fetch('/api/v1/recipes')<br/>?q=&filter="]
        C --> D{CDN cache hit?}
        D -->|Yes| E["60s edge cache<br/>(s-maxage=60)"]
        D -->|No| F["RecipeService.list()<br/>FTS + filter SQL"]
        E --> G["Render FeaturedCard<br/>+ RecipeCard grids"]
        F --> G
        G --> H["User types in search"]
        H --> I["Debounced 300ms<br/>fetch('/api/v1/recipes?q=...')"]
        I --> D
        G --> J["User clicks filter chip"]
        J --> K["fetch('/api/v1/recipes?filter=...')"]
        K --> D
    end

    subgraph View ["recipe.html"]
        G --> L["User clicks recipe card"]
        L --> M["Navigate to<br/>recipe.html?id={slug}"]
        M --> N["fetch('/api/v1/recipes/{id}')"]
        N --> O["RecipeService.get()<br/>+ log_view (Redis dedupe)"]
        O --> P["Return full recipe JSON<br/>(matches recipe-bundles/.../recipe.json)"]
        P --> Q["Render RecipeHero,<br/>StepCard, IngredientsCard,<br/>UtensilsCard, HealthMarquee"]
    end

    subgraph Enrichment ["If logged in (optional)"]
        N -.-> R["Attach is_saved,<br/>user_rating, avg_rating,<br/>active_session"]
        R -.-> Q
        Q -.-> S["Cache-Control: private, no-store"]
    end

    style Enrichment stroke-dasharray: 5 5
```

### Key decisions:
- API responses **exactly match** the current static JSON shapes (camelCase preserved).
- `recipe-search.html` currently has an inline `RECIPES` array as fallback + fetches `data/recipes.json`. Post-migration, the inline array becomes a build-time-injected emergency fallback only (kept identical to live data via daily CI snapshot).
- Search uses PostgreSQL full-text search (`search_vector` column) rather than client-side filtering, so 1000+ recipes are still snappy.
- Anonymous detail responses are CDN-cacheable; logged-in detail responses bypass CDN due to enrichment.

---

## 3. Personalization Flow (Authenticated)

Maps to the "Your blood work, on a plate" section on the landing page. Currently, `HEALTH_METRICS`, `PERSONA_MEALS`, and `microTargets()` are hardcoded in `index.html`. The dynamic version pulls from the user's health profile and the data-driven recommendation engine ([07-personalization-engine.md](07-personalization-engine.md)).

```mermaid
flowchart TB
    subgraph HealthSetup ["First visit after sign-in"]
        A["User signs in"] --> B["GET /api/v1/health/profile"]
        B --> C{Profile exists?}
        C -->|No| D["POST /api/v1/health/profile<br/>{label: 'Default'}"]
        D --> E["Seed profile with<br/>default metric_definitions<br/>(all is_active=true)"]
        C -->|Yes| F["Return active profile<br/>with metrics"]
        E --> F
    end

    subgraph ToggleMetric ["Toggle Health Flag (existing toggle UI)"]
        F --> G["Render metric-card<br/>toggle switches<br/>(unchanged DOM)"]
        G --> H["User taps toggle<br/>(Iron: ON → OFF)"]
        H --> I["PATCH /api/v1/health/metrics/iron<br/>{is_active: false}"]
        I --> J["HealthService.toggle_metric()"]
        J --> K["Updated metric returned"]
        K --> L["Trigger re-recommend"]
    end

    subgraph Recommend ["Get personalized meal"]
        L --> M["GET /api/v1/personalization/recommend"]
        M --> N["PersonalizationService.recommend()"]
        N --> O["Read active flags<br/>from health_metrics"]
        O --> P["JOIN nutrient_mappings<br/>→ score every recipe"]
        P --> Q["Pick top recipe;<br/>compute micro_targets;<br/>generate explanation"]
        Q --> R["Return: {meal, micro_targets,<br/>explanation, why_tags}"]
        R --> S["Render rec-panel<br/>(unchanged DOM):<br/>name, tags, ring-grid, why-text"]
    end

    subgraph Sync ["Health Platform Sync (stretch)"]
        T["Apple Health bridge"] -.-> U["POST /api/v1/health/sync/apple"]
        V["Google Fit API"] -.-> W["POST /api/v1/health/sync/google"]
        U -.-> J
        W -.-> J
    end

    style Sync stroke-dasharray: 5 5
```

### Anonymous landing-page personalization
The landing page already shows the "Your blood work" demo with hardcoded metrics. For anonymous users this **stays exactly as-is** — driven by the inline `HEALTH_METRICS` and `PERSONA_MEALS` arrays. After sign-in, the same DOM is hydrated from the API response. No layout shift.

---

## 4. Guided Cooking Session Flow

The current `recipe.html` has step navigation, timers, and an ingredient checklist — all client-side. Anonymous users keep that exact behavior. Authenticated users get cross-device persistence.

```mermaid
flowchart TB
    subgraph Start ["Start cooking"]
        A["User clicks 'Cook it now'<br/>on recipe card"] --> B["Navigate to<br/>recipe.html?id={slug}"]
        B --> C["fetch('/api/v1/recipes/{id}')"]
        C --> D{Logged in?}
        D -->|No| E["Local cooking state<br/>in React + sessionStorage<br/>(no API persistence)"]
        D -->|Yes| F["Check active_session<br/>in recipe response"]
        F --> G{Session exists?}
        G -->|No| H["POST /api/v1/cooking/sessions<br/>{recipe_id, servings}<br/>→ pin recipe_version"]
        G -->|Yes| I["Resume at last_step<br/>show 'Continue?' banner"]
        H --> J["Cooking UI ready"]
        I --> J
        E --> J
    end

    subgraph Cook ["Step-by-step cooking"]
        J --> K["User on Step N"]
        K --> L["User clicks ▶ (start timer)"]
        L --> M["Timer runs client-side<br/>(no network)"]
        M --> N["Timer completes<br/>or user clicks 'Next →'"]
        N --> O{Logged in?}
        O -->|No| P["Update local doneSteps Set"]
        O -->|Yes| Q["POST /api/v1/cooking/sessions/{id}/steps<br/>{step_number, event:'complete'}"]
        Q --> R["SessionStepLog inserted;<br/>completion_pct + last_step updated"]
        P --> S{More steps?}
        R --> S
        S -->|Yes| K
        S -->|No| T{Logged in?}
        T -->|Yes| U["PATCH session<br/>{status:'completed'}"]
        T -->|No| V["Show local 'Done!' UI"]
        U --> W["Show rating prompt<br/>(see Flow 6)"]
    end

    subgraph Resume ["Resume on another device"]
        X["User opens recipe<br/>on phone"] --> C
    end

    subgraph Abandon ["Abandon"]
        Y["beforeunload event"] --> Z{Logged in?}
        Z -->|Yes| AA["sendBeacon PATCH session<br/>{last_step: current}"]
        Z -->|No| AB["No-op (state stays in sessionStorage)"]
        AC["Daily job"] --> AD["Mark sessions idle >24h<br/>as abandoned"]
    end
```

### Key decisions:
- **Timers stay 100% client-side** — no WebSocket. Only step transitions and heartbeats hit the API.
- Anonymous users get **sessionStorage** for in-tab persistence (refresh-safe) but no cross-device.
- A 30-second heartbeat (`PATCH /sessions/{id}` with `last_step`) prevents stale sessions when users walk away.
- Recipes are versioned: in-progress sessions always read from the pinned `recipe_version` snapshot, so an admin edit never breaks an active cook.

---

## 5. Save / Bookmark Recipe Flow (Authenticated)

```mermaid
flowchart LR
    A["User views<br/>recipe page"] --> B{Logged in?}
    B -->|No| C["Bookmark button shows<br/>tooltip: 'Sign in to save'<br/>→ click opens AuthModal"]
    B -->|Yes| D["is_saved already in<br/>recipe-detail response"]
    D --> E{is_saved?}
    E -->|Yes| F["Filled bookmark icon"]
    E -->|No| G["Outlined bookmark icon"]

    G --> H["User clicks bookmark"]
    H --> I["Optimistic UI: fill icon"]
    I --> J["POST /api/v1/saved<br/>{recipe_id}"]
    J --> K{OK?}
    K -->|Yes| F
    K -->|No| L["Revert + toast"]

    F --> M["User clicks bookmark again"]
    M --> N["Optimistic UI: outline"]
    N --> O["DELETE /api/v1/saved/{recipe_id}"]
    O --> G

    subgraph Library ["My Recipes page"]
        P["GET /api/v1/saved"] --> Q["List saved recipes<br/>with notes"]
        Q --> R["Render same<br/>RecipeCard components"]
    end
```

---

## 6. Rating & Review Flow (Authenticated)

```mermaid
flowchart TB
    A["User completes<br/>cooking session"] --> B["Show rating sheet<br/>(1–5 stars + optional review)"]
    B --> C{User rates?}
    C -->|Skip| D["Dismiss; no API call"]
    C -->|Submit| E["PUT /api/v1/ratings/{recipe_id}<br/>{rating, review}"]
    E --> F["RatingService.rate()<br/>upsert"]
    F --> G["Return updated avg_rating<br/>+ rating_count"]
    G --> H["RecipeHero sticker<br/>updates ★ rating"]
    G --> I["Materialized view<br/>refreshes within 15 min"]

    J["Anonymous user"] --> K["Cannot rate;<br/>'Sign in to rate' CTA"]
```

---

## 7. Preference Persistence Flow (Authenticated)

The tweak panel currently has no persistence — preferences reset on reload. The dynamic version syncs server-side for logged-in users while keeping the editor `postMessage` contract intact.

```mermaid
flowchart TB
    A["Page loads"] --> B{Logged in?}
    B -->|No| C["Initialize useTweaks<br/>with TWEAK_DEFAULTS"]
    B -->|Yes| D["GET /api/v1/preferences"]
    D --> E["Merge server prefs<br/>over TWEAK_DEFAULTS"]
    E --> F["Initialize useTweaks<br/>with merged values"]

    G["User adjusts tweak<br/>(e.g. accent color)"] --> H["setTweak() fires"]
    H --> I["postMessage to parent<br/>(editor — unchanged)"]
    H --> J{Logged in?}
    J -->|No| K["Local state only"]
    J -->|Yes| L["Debounced 800ms<br/>PUT /api/v1/preferences<br/>{accent: '#FF6D2E'}"]
    L --> M["UserService.set_preference()"]
    M --> N["UPSERT user_preferences"]
```

---

## 8. Meal Plan Flow (Authenticated — Stretch)

```mermaid
flowchart TB
    A["Open Meal Planner"] --> B["GET /api/v1/meal-plan?week=2026-W18"]
    B --> C["Render calendar:<br/>Mon–Sun × 4 slots"]
    C --> D["User drags recipe<br/>to Wednesday lunch"]
    D --> E["POST /api/v1/meal-plan<br/>{recipe_id, plan_date, slot, servings}"]
    E --> F["MealPlanService.add_entry()"]
    F --> G["Card appears in slot"]

    G --> H["User clicks ×"]
    H --> I["DELETE /api/v1/meal-plan/{id}"]

    C --> J["'Generate shopping list'<br/>button"]
    J --> K["GET /api/v1/meal-plan/shopping-list<br/>?start=...&end=..."]
    K --> L["JOIN ingredient_catalog;<br/>aggregate by canonical id"]
    L --> M["Grouped, deduplicated list"]
```

---

## 9. Anonymous → Authenticated State Migration (NEW)

The site is anonymous-first, but anonymous users build local state: bookmarks, tweak panel, in-progress cooking. We must not lose that state on first sign-in.

```mermaid
flowchart TB
    subgraph Capture ["Pre-sign-in"]
        A["Anonymous user saves recipes<br/>→ localStorage 'mfc.anon.saved'"]
        B["Anonymous user adjusts tweaks<br/>→ localStorage 'mfc.anon.prefs'"]
        C["Anonymous user starts cooking<br/>→ sessionStorage 'mfc.anon.cook.{slug}'"]
    end

    subgraph SignIn ["Sign-in moment"]
        D["User completes sign-in"] --> E["FE collects local snapshot<br/>{saved[], prefs{}, sessions[]}"]
        E --> F{Snapshot non-empty?}
        F -->|No| G["Done"]
        F -->|Yes| H["POST /api/v1/auth/merge-anonymous<br/>{snapshot}"]
    end

    subgraph Merge ["Server-side merge"]
        H --> I["AuthService.merge_anonymous_state()"]
        I --> J["UPSERT saved_recipes<br/>(skip duplicates)"]
        I --> K["UPSERT user_preferences<br/>(server wins on conflict)"]
        I --> L["INSERT cooking_sessions<br/>(only if no active session<br/>exists for that recipe)"]
        J --> M["204 No Content"]
        K --> M
        L --> M
    end

    M --> N["FE clears local snapshot keys"]
    N --> O["UI re-fetches /api/v1/* to show<br/>merged state"]
```

### Conflict rules
- **Saved recipes**: union; user's anonymous note discarded if a server note already exists.
- **Preferences**: server wins (user might have synced from another device since this anonymous session began).
- **Cooking sessions**: only migrate the most recent anonymous session per recipe; skip if user already has an active session for that recipe.

---

## 10. Image / Media Delivery Flow

```mermaid
flowchart LR
    subgraph Author ["Recipe author / import"]
        A["data/recipe-bundles/<br/>paneer-butter-masala/<br/>hero.jpg, step-1.jpg..."] --> B["Import script:<br/>resize → webp + jpg<br/>compute hash"]
        B --> C["Upload to S3:<br/>/media/recipes/{id}/<br/>{hash}-hero.webp"]
        C --> D["INSERT recipes.hero_image_url<br/>recipe_steps.image_url"]
    end

    subgraph Serve ["Public read"]
        E["Browser requests<br/>/media/recipes/{id}/{hash}-hero.webp"]
        E --> F["Cloudflare edge"]
        F --> G{Cache hit?}
        G -->|Yes| H["Edge response<br/>(Cache-Control: 1y immutable)"]
        G -->|No| I["S3 origin"]
        I --> H
    end
```

Hashed filenames mean we never have to bust caches; replacing an image just inserts a new URL.

---

## Process Summary Table

| Flow | Auth Required | Endpoints Involved | Frontend Changes |
|------|:------------:|---------------------|------------------|
| Auth (sign up / in / out) | — | `/api/v1/auth/*` | `shared/auth.js` internals only |
| Recipe search | ❌ | `GET /api/v1/recipes` | Swap `fetch()` URL |
| Recipe detail | ❌ | `GET /api/v1/recipes/{id}` | Swap `fetch()` URL |
| Health profile | ✅ | `/api/v1/health/*` | Wire to existing toggle UI |
| Personalization | ✅ | `GET /api/v1/personalization/recommend` | Replace `pickMeal()` call |
| Cooking session | ✅ | `/api/v1/cooking/*` | Add session ID + heartbeat |
| Save recipe | ✅ | `/api/v1/saved/*` | Activate bookmark button |
| Rate recipe | ✅ | `/api/v1/ratings/*` | Add post-cook rating sheet |
| Preferences | ✅ | `/api/v1/preferences` | Wire into `useTweaks()` hydrate + debounced PUT |
| Meal planner | ✅ | `/api/v1/meal-plan/*` | New page (stretch) |
| Anonymous → auth merge | ✅ (just-in-time) | `POST /api/v1/auth/merge-anonymous` | New post-sign-in side-effect |
| Media delivery | ❌ | CDN / S3 | None (URLs already in JSON) |
