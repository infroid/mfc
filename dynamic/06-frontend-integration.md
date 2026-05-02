# Frontend Integration Plan

> Concrete file-by-file changes to wire the existing static frontend into the dynamic API. **No CSS, JSX, or component structure changes** unless explicitly noted as one-line additions reusing existing styles.

---

## Change Surface Summary

| File | Change | Phase |
|------|--------|-------|
| [shared/auth.js](../shared/auth.js) | Replace internals; keep public contract | 2 |
| [shared/api.js](../shared/api.js) (new) | Tiny fetch wrapper: cookies, CSRF, auto-refresh, retries | 1 |
| [shared/flags.js](../shared/flags.js) (new) | Reads `<meta name="mfc-flags">` and exposes `window.MFC_FLAGS` | 1 |
| [recipe-search.html](../recipe-search.html) | Swap `fetch('data/recipes.json')` → `fetch('/api/v1/recipes')` | 1 |
| [recipe.html](../recipe.html) | Swap `fetch('data/recipe-bundles/.../recipe.json')` → `fetch('/api/v1/recipes/{id}')` | 1 |
| [recipe-app.jsx](../recipe-app.jsx) | Add `useAuth` + cooking-session hook | 4 |
| [recipe-components.jsx](../recipe-components.jsx) | StepCard logs `event:'complete'`; bookmark + rating sheet | 3, 4 |
| [index.html](../index.html) | `Personalize` reads from API when logged in; tweak panel hydrates from API | 3, 5 |
| [tweaks-panel.jsx](../tweaks-panel.jsx) | Add `useTweaks` API hydrate + debounced PUT (preserves `postMessage`) | 3 |

Total net code added is small (~250 LOC across all files). No file is rewritten.

---

## 1. New: `shared/api.js`

A 60-line fetch wrapper. All API calls funnel through it.

```js
// shared/api.js — tiny helper, no dependencies
window.MFC = window.MFC || {};
window.MFC.api = (function () {
  const BASE = (window.MFC_API_BASE || '/api/v1').replace(/\/$/, '');

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^|; )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : null;
  }

  let refreshing = null;

  async function call(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = new Headers(opts.headers || {});
    if (opts.body && typeof opts.body !== 'string' && !(opts.body instanceof FormData)) {
      headers.set('Content-Type', 'application/json');
      opts = { ...opts, body: JSON.stringify(opts.body) };
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const csrf = getCookie('mfc_csrf');
      if (csrf) headers.set('X-CSRF-Token', csrf);
    }
    const res = await fetch(BASE + path, {
      ...opts,
      method,
      headers,
      credentials: 'include',
    });
    if (res.status === 401 && !opts._retry && path !== '/auth/refresh' && path !== '/auth/me') {
      try {
        if (!refreshing) refreshing = call('/auth/refresh', { method: 'POST', _retry: true }).finally(() => { refreshing = null; });
        await refreshing;
        return call(path, { ...opts, _retry: true });
      } catch { /* fall through to error */ }
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({ detail: res.statusText }));
      const err = new Error(detail.detail || res.statusText);
      err.status = res.status;
      err.detail = detail;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  return { call };
})();
```

**Properties**:
- Same-origin via Cloudflare path routing → no CORS preflight on GETs.
- Auto-refresh once on 401 (deduped via `refreshing` promise).
- CSRF header on mutations.
- Single source of truth for the base URL — flip `window.MFC_API_BASE` to point at staging.

---

## 2. Rewrite: `shared/auth.js`

Public contract is unchanged. Internals swap from localStorage to API + memory cache.

```js
// shared/auth.js — POST-MIGRATION VERSION
// Public surface is identical: getUser, setUser (deprecated externally), clearUser, isLoggedIn, signIn, signOut
// Event: 'mfc:auth-change' on window with { detail: { user } } — unchanged
window.MFC = window.MFC || {};
window.MFC.auth = (function () {
  let user = null;
  let hydrated = false;

  function _emit(u) {
    user = u;
    window.dispatchEvent(new CustomEvent('mfc:auth-change', { detail: { user: u } }));
  }

  async function _hydrate() {
    if (hydrated) return user;
    hydrated = true;
    try {
      user = await window.MFC.api.call('/auth/me');
    } catch (e) {
      user = null;
    }
    _emit(user);
    return user;
  }

  function getUser() { return user; }
  function isLoggedIn() { return !!user; }

  async function signIn({ name, email, password, provider } = {}) {
    if (provider === 'google' || provider === 'apple') {
      window.location.href = `/api/v1/auth/oauth/${provider}`;
      return null;
    }
    // Email/password — distinguish signup vs login by presence of name
    const path = name ? '/auth/signup' : '/auth/login';
    const body = name ? { name, email, password } : { email, password };
    const res = await window.MFC.api.call(path, { method: 'POST', body });
    _emit(res.user);
    await _maybeMergeAnonymous();
    return res.user;
  }

  async function signOut() {
    try { await window.MFC.api.call('/auth/logout', { method: 'POST' }); } catch {}
    _emit(null);
  }

  async function _maybeMergeAnonymous() {
    const snapshot = _readAnonSnapshot();
    if (!snapshot) return;
    try {
      await window.MFC.api.call('/auth/merge-anonymous', { method: 'POST', body: snapshot });
      _clearAnonSnapshot();
    } catch (e) { console.warn('merge-anonymous failed; will retry on next sign-in', e); }
  }

  function _readAnonSnapshot() {
    try {
      const saved = JSON.parse(localStorage.getItem('mfc.anon.saved') || 'null');
      const prefs = JSON.parse(localStorage.getItem('mfc.anon.prefs') || 'null');
      const sessions = JSON.parse(sessionStorage.getItem('mfc.anon.sessions') || 'null');
      if (!saved && !prefs && !sessions) return null;
      return { saved: saved || [], preferences: prefs || {}, sessions: sessions || [] };
    } catch { return null; }
  }
  function _clearAnonSnapshot() {
    localStorage.removeItem('mfc.anon.saved');
    localStorage.removeItem('mfc.anon.prefs');
    sessionStorage.removeItem('mfc.anon.sessions');
  }

  // Hydrate on script load — non-blocking
  _hydrate();

  return {
    getUser, isLoggedIn, signIn, signOut,
    // Removed: setUser, clearUser (were leaky — internal-only now)
  };
})();
```

**Migration notes**:
- `setUser` and `clearUser` are removed from the public API. Verified by `grep -rn "MFC.auth.setUser\|MFC.auth.clearUser"` returning zero hits across `*.html`/`*.js`/`*.jsx` — only the internal `_emit` path used them.
- Existing callers of `getUser()` / `isLoggedIn()` continue to work; values become populated asynchronously after first load (initially `null` until `_hydrate` resolves).
- The `useAuth()` React hook (defined in `index.html:721` and `recipe-search.html:517`) already listens to `mfc:auth-change`, so it picks up the hydrated user automatically.

---

## 3. New: `shared/flags.js`

```js
window.MFC_FLAGS = (function () {
  const meta = document.querySelector('meta[name="mfc-flags"]');
  const fromMeta = meta ? JSON.parse(meta.content || '{}') : {};
  return Object.assign({
    useApi: false,
    useAuth: false,
    useHealth: false,
    useSaved: false,
    useRatings: false,
    useCooking: false,
    useRecommend: false,
    useMealPlan: false,
  }, fromMeta);
})();
```

A single `<meta name="mfc-flags" content='{"useApi":true,...}'>` tag injected at deploy time controls every flag. No rebuild needed for flag flips — Cloudflare HTML rewrite injects the meta.

---

## 4. `recipe-search.html` changes

Existing fetch (line ~736):

```js
fetch('data/recipes.json').then(...)
```

Becomes:

```js
const recipesUrl = window.MFC_FLAGS.useApi ? '/api/v1/recipes' : 'data/recipes.json';
window.MFC.api.call('/recipes')
  .then(res => setRecipes(window.MFC_FLAGS.useApi ? res.items : res))
  .catch(() => { /* keep RECIPES inline fallback */ });
```

The inline `RECIPES` const (line ~295) stays as the hard fallback. CI updates it nightly via `scripts/build_emergency_fallback.py`.

Filter logic (line ~742) stays client-side initially; can move to server once we observe load. Server already supports the same filter param names.

---

## 5. `recipe.html` changes

The bundle/legacy probe in [recipe-app.jsx](../recipe-app.jsx):

```js
fetch(`data/recipe-bundles/${id}/recipe.json`)
  .then(...)
  .catch(() => fetch(`data/recipes/${id}.json`))
```

Becomes:

```js
const url = window.MFC_FLAGS.useApi ? `/api/v1/recipes/${id}` : `data/recipe-bundles/${id}/recipe.json`;
window.MFC.api.call(`/recipes/${id}`)
  .then(setRecipe)
  .catch(legacyFallback);
```

The full-recipe response shape is identical to the bundle JSON (verified by snapshot tests in CI), so `RecipeApp` and all child components work without modification.

---

## 6. `recipe-components.jsx` — StepCard hooks

The current StepCard (line ~157) tracks `doneSteps` in local state. Add an opt-in callback:

```jsx
function StepCard({ step, stepIdx, total, doneSteps, onAdvance, ...rest }) {
  // existing code...
  const advance = () => {
    onAdvance?.(stepIdx);  // NEW — parent decides whether to POST
    setStepIdx(i => i + 1);
  };
  // ...
}
```

`RecipeApp` provides `onAdvance` only when authenticated + cooking flag on:

```jsx
const session = useCookingSession({
  recipeId: recipe.id,
  servings: serv,
  enabled: window.MFC_FLAGS.useCooking && user,
});

<StepCard
  step={recipe.steps[stepIdx]}
  stepIdx={stepIdx}
  total={recipe.steps.length}
  onAdvance={session.advance}
  // ...other unchanged props
/>
```

`useCookingSession` is a new hook (~40 LOC) defined inline in `recipe-app.jsx`:

```jsx
function useCookingSession({ recipeId, servings, enabled }) {
  const [sessionId, setSessionId] = React.useState(null);
  React.useEffect(() => {
    if (!enabled || !recipeId) return;
    window.MFC.api.call('/cooking/sessions', { method: 'POST', body: { recipe_id: recipeId, servings } })
      .then(s => setSessionId(s.id));
  }, [enabled, recipeId]);

  // Heartbeat every 30s with keepalive-on-unload guarantee (uses the same PATCH endpoint)
  React.useEffect(() => {
    if (!sessionId) return;
    const tick = setInterval(() => {
      window.MFC.api.call(`/cooking/sessions/${sessionId}`, { method: 'PATCH', body: { last_step: lastStepRef.current + 1 } });
    }, 30000);
    const onUnload = () => {
      // fetch with keepalive lets the request finish after page unloads — same endpoint, same auth/CSRF
      const csrf = document.cookie.match(/(?:^|; )mfc_csrf=([^;]+)/)?.[1] ?? '';
      fetch(`/api/v1/cooking/sessions/${sessionId}`, {
        method: 'PATCH',
        credentials: 'include',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(csrf) },
        body: JSON.stringify({ last_step: lastStepRef.current + 1 }),
      });
    };
    window.addEventListener('beforeunload', onUnload);
    return () => { clearInterval(tick); window.removeEventListener('beforeunload', onUnload); };
  }, [sessionId]);

  const lastStepRef = React.useRef(0);
  const advance = (stepIdx) => {
    lastStepRef.current = stepIdx + 1;
    if (sessionId) {
      window.MFC.api.call(`/cooking/sessions/${sessionId}/steps`, { method: 'POST', body: { step_number: stepIdx + 1, event: 'complete', timer_used: false } });
    }
  };

  return { sessionId, advance };
}
```

For anonymous + flag-off users, `enabled=false` → no API calls → existing local-only behavior. The `sessionStorage` fallback for anonymous resume is added inside the hook with one extra branch.

---

## 7. `recipe-components.jsx` — Bookmark button

The recipe header today has no bookmark icon (it's an eligibility hook for V1). One small additive component:

```jsx
function BookmarkButton({ recipeId }) {
  const user = useAuth();
  const [saved, setSaved] = React.useState(null);

  React.useEffect(() => {
    if (!window.MFC_FLAGS.useSaved || !user) { setSaved(null); return; }
    window.MFC.api.call(`/saved/${recipeId}`, { method: 'GET' })
      .then(() => setSaved(true))
      .catch(e => setSaved(e.status === 404 ? false : null));
  }, [recipeId, user]);

  if (!window.MFC_FLAGS.useSaved) return null;
  if (!user) return <button className="r-bookmark" onClick={() => window.MFC?.auth?.signIn()}>Save ★</button>;

  const toggle = () => {
    const next = !saved;
    setSaved(next);  // optimistic
    const p = next
      ? window.MFC.api.call('/saved', { method: 'POST', body: { recipe_id: recipeId } })
      : window.MFC.api.call(`/saved/${recipeId}`, { method: 'DELETE' });
    p.catch(() => setSaved(!next));
  };
  return <button className={"r-bookmark" + (saved ? " is-saved" : "")} onClick={toggle}>{saved ? "★" : "☆"}</button>;
}
```

CSS class `r-bookmark` reuses existing button tokens — defined in `recipe-styles.css` as one block of ~6 lines (mirrors `r-meta-pill` styling).

---

## 8. `index.html` — Personalize component

Currently `Personalize` (line ~1095) computes everything from constants:

```jsx
const [active, setActive] = useState(HEALTH_METRICS.filter(m => m.default).map(m => m.id));
const meal = pickMeal(active);
const targets = microTargets(active);
```

Change to data-source dispatch:

```jsx
const user = useAuth();
const useApi = window.MFC_FLAGS.useRecommend && user;

const [profile, setProfile] = useState(null);   // null until loaded
const [recommend, setRecommend] = useState(null);

useEffect(() => {
  if (!useApi) return;
  window.MFC.api.call('/health/profile').then(setProfile);
}, [useApi]);

useEffect(() => {
  if (!useApi) return;
  window.MFC.api.call('/personalization/recommend').then(setRecommend);
}, [useApi, profile?.metrics]);

// Static defaults for anonymous (existing path)
const fallbackActive = HEALTH_METRICS.filter(m => m.default).map(m => m.id);
const fallbackMeal = pickMeal(fallbackActive);
const fallbackTargets = microTargets(fallbackActive);

const active = useApi ? (profile?.metrics?.filter(m => m.is_active).map(m => m.metric_id) ?? []) : fallbackActive;
const meal = useApi ? (recommend?.meal ?? fallbackMeal) : fallbackMeal;
const targets = useApi ? (recommend?.micro_targets ?? fallbackTargets) : fallbackTargets;

// Toggle handler
const toggle = (metricId) => {
  if (useApi) {
    const cur = profile.metrics.find(m => m.metric_id === metricId);
    window.MFC.api.call(`/health/metrics/${metricId}`, { method: 'PATCH', body: { is_active: !cur.is_active } })
      .then(updated => setProfile(p => ({ ...p, metrics: p.metrics.map(m => m.metric_id === metricId ? updated : m) })));
  } else {
    setActive(a => a.includes(metricId) ? a.filter(x => x !== metricId) : [...a, metricId]);
  }
};
```

Render JSX is **byte-for-byte unchanged** — it consumes `active`, `meal`, `targets`, and `toggle`.

---

## 9. `tweaks-panel.jsx` — Persistence

Current hook:

```jsx
function useTweaks(defaults) {
  const [values, setValues] = useState(defaults);
  const setTweak = useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === "object" && keyOrEdits !== null ? keyOrEdits : { [keyOrEdits]: val };
    setValues(prev => ({ ...prev, ...edits }));
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits }, "*");
  }, []);
  return [values, setTweak];
}
```

Becomes (additive — editor postMessage path preserved). `useAuth` is defined inline per-page (`index.html:721`, `recipe-search.html:517`) and is **not** exposed on `window`, so `useTweaks` accepts the user as an argument from the calling page:

```jsx
function useTweaks(defaults, user /* pass useAuth() result; null for anonymous */) {
  const [values, setValues] = useState(defaults);
  const persistRef = useRef(null);

  // Hydrate from API or anonymous localStorage
  useEffect(() => {
    if (window.MFC_FLAGS.useApi && user) {
      window.MFC.api.call('/preferences').then(prefs => {
        const tweaks = Object.fromEntries(Object.entries(prefs).filter(([k]) => k.startsWith('tweak.')).map(([k,v]) => [k.slice(6), v]));
        setValues(prev => ({ ...prev, ...tweaks }));
      }).catch(() => {});
    } else {
      try {
        const local = JSON.parse(localStorage.getItem('mfc.anon.prefs') || '{}');
        const tweaks = Object.fromEntries(Object.entries(local).filter(([k]) => k.startsWith('tweak.')).map(([k,v]) => [k.slice(6), v]));
        setValues(prev => ({ ...prev, ...tweaks }));
      } catch {}
    }
  }, [user]);

  const setTweak = useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === "object" && keyOrEdits !== null ? keyOrEdits : { [keyOrEdits]: val };
    setValues(prev => {
      const next = { ...prev, ...edits };
      // Debounced persistence
      clearTimeout(persistRef.current);
      persistRef.current = setTimeout(() => {
        const namespaced = Object.fromEntries(Object.entries(edits).map(([k,v]) => [`tweak.${k}`, v]));
        if (window.MFC_FLAGS.useApi && user) {
          window.MFC.api.call('/preferences', { method: 'PUT', body: namespaced }).catch(() => {});
        } else {
          const cur = JSON.parse(localStorage.getItem('mfc.anon.prefs') || '{}');
          localStorage.setItem('mfc.anon.prefs', JSON.stringify({ ...cur, ...namespaced }));
        }
      }, 800);
      return next;
    });
    window.parent.postMessage({ type: "__edit_mode_set_keys", edits }, "*");  // unchanged editor channel
  }, [user]);

  return [values, setTweak];
}
```

Caller change in `index.html:1294`:

```jsx
// before
const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
// after
const user = useAuth();
const [t, setTweak] = useTweaks(TWEAK_DEFAULTS, user);
```

The DOM and visual presentation stay identical; only the hook gains an effect + a debounce, and the caller passes `user`.

---

## 10. Component-by-Component Change Matrix

| Component | File | Change | Phase |
|-----------|------|--------|-------|
| `Nav` | `index.html` `recipe-search.html` `recipe.html` | None — already uses `useAuth` + `MFC.auth.signIn/Out` | 2 |
| `AuthModal` | `index.html` (~861) | Add password input, swap submit handler | 2 |
| `Personalize` | `index.html` (~1095) | Source dispatch (above) | 5 |
| `Hero` / `Featured` | `index.html` | None | — |
| `RecipeCard` | `recipe-search.html` | Add `<BookmarkButton>` slot when `useSaved` | 3 |
| `App` (search page) | `recipe-search.html` (~720) | Swap fetch URL | 1 |
| `RecipeApp` | `recipe-app.jsx` | Add `useCookingSession` | 4 |
| `StepCard` | `recipe-components.jsx` | Add `onAdvance?.()` callback hook | 4 |
| `IngredientsCard` | `recipe-components.jsx` | None | — |
| `UtensilsCard` | `recipe-components.jsx` | None | — |
| `HealthMarquee` | `recipe-components.jsx` | None | — |
| `RecipeHero` | `recipe-components.jsx` | Optional rating sticker reads `avg_rating` from API response (already in shape) | 3 |
| `TweaksPanel` | `tweaks-panel.jsx` | `useTweaks` hydrate + debounced persist | 3 |

---

## Anonymous-State Capture Implementation

When the user is not logged in, mutations write to local storage namespaces. On sign-in, `_maybeMergeAnonymous` ships them server-side and clears.

| State | Anonymous storage | Schema |
|-------|------------------|--------|
| Saved recipes | `localStorage.mfc.anon.saved` | `[{recipe_id, saved_at, notes}]` |
| Tweak prefs | `localStorage.mfc.anon.prefs` | `{ "tweak.accent": "...", ... }` |
| Cooking sessions | `sessionStorage.mfc.anon.sessions` | `[{recipe_id, last_step, completion_pct, started_at, servings_cooked}]` (one entry per active recipe) |

> Tweaks chosen: `localStorage` for things the user expects to persist across tabs/days; `sessionStorage` for in-progress cooking which is tied to a specific tab.

---

## Smoke-Test Script

For every phase, the following Playwright spec must pass before flag-flip:

```
test('anonymous can search and view a recipe', ...);
test('anonymous can run a timer + check ingredients', ...);
test('logged-in user can sign in via email', ...);
test('logged-in user can save and unsave a recipe', ...);
test('logged-in user can toggle a health flag and see new recommendation', ...);
test('logged-in user can start cooking, refresh, and resume', ...);
test('cross-device resume: start cooking on viewport A, open viewport B, see "Continue?"', ...);
test('tweak panel preference survives logout/login', ...);
test('anonymous→auth merge: save 2 recipes anon, sign in, library has both', ...);
```

Tests are `npm run e2e` and gated by CI on every PR that touches `index.html` / `recipe-*.html` / `shared/*`.
