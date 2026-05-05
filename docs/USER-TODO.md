# Setup TODO (Human)

The website code is wired to Supabase but cannot run until you do these steps. Each
section is independent — do them in order.

---

## 1. Create the Supabase project

- Go to <https://supabase.com> → New Project.
- Region: pick whatever's closest to your users.
- Save the database password somewhere durable (you won't need it for the website
  but you'll need it if you ever connect via `psql`).
- Once the project is provisioned, grab from **Settings → API**:
  - **Project URL** (e.g. `https://abcdef.supabase.co`)
  - **Publishable key** (format: `sb_publishable_...`, public-safe — goes in HTML)
  - **Secret key** (format: `sb_secret_...`, **secret** — only for the import script and
    your offline data pipeline)

---

## 2. Apply the schema

Two paths — pick one. The Python CLI is the recommended path.

### Option A — Python CLI (recommended)

One-time setup (uv handles the venv and Python version):

```bash
brew install uv         # or: curl -LsSf https://astral.sh/uv/install.sh | sh

cp automation/.env.sample automation/.env
# Open automation/.env and fill in:
#   SUPABASE_DB_URL          (Studio → Database → Connection string → URI; direct port 5432)
#   SUPABASE_URL             (Studio → API)
#   SUPABASE_SECRET_KEY      (Studio → API → service_role)

make sync              # creates automation/.venv and installs deps
```

Then, from the repo root:

```bash
make apply-schema      # runs automation/db/schema.sql
make seed-metrics      # loads the 54-marker catalog
make status            # prints table list + row counts to verify
```

Useful one-shot for a clean slate (drops everything, re-applies, re-seeds, re-imports):

```bash
make reset             # prompts "type 'reset' to confirm"
```

`make` (no args) lists every target. See §6 for `import-recipes`.

### Option B — Studio SQL Editor

1. Paste the entire contents of [automation/db/schema.sql](automation/db/schema.sql) and run.
2. Paste the entire contents of [automation/db/seed_metrics.sql](automation/db/seed_metrics.sql) and run.

Verify in **Table Editor**:

- 16 tables exist under `public` schema (catalog, library, health markers,
  recommendations, user-owned including `user_profiles`).
- `metric_definitions` has 54 rows across 10 categories (lipid, metabolic,
  iron-panel, inflammation, liver, kidney, vitamin, mineral, thyroid, other).
- Each table has descriptions visible in the Studio table view (hover the column
  names — comments come from the `COMMENT ON` statements).

---

## 3. Configure auth

In **Authentication → Providers**:

- **Email**: enable. Under "Email Auth" turn ON "Enable email confirmations" and
  "Enable magic link sign-in." Disable password sign-in (we don't use it).
- **Google**: enable. You'll need a Google Cloud OAuth client:
  - <https://console.cloud.google.com/apis/credentials> → Create Credentials → OAuth client ID → Web application.
  - Authorized JavaScript origins: `http://localhost:8080`, your production origin
    (e.g. `https://myfoodcraving.com`).
  - Authorized redirect URIs: `https://<your-project>.supabase.co/auth/v1/callback`
  - Paste the resulting client ID + client secret into Supabase's Google provider config.

In **Authentication → URL Configuration**:

- **Site URL**: your prod origin (e.g. `https://myfoodcraving.com`).
- **Redirect URLs**: add `http://localhost:8080/**` for local dev plus any other
  preview hosts.

---

## 4. Grant yourself the admin role

The admin pages are gated by `app_metadata.role = 'admin'` on your Supabase
user, enforced both in the UI ([web/assets/js/lib/admin-gate.js](web/assets/js/lib/admin-gate.js))
and at the database level via the RLS predicate `public.is_admin()` (defined
in [automation/db/schema.sql](automation/db/schema.sql) §8).

> **Why `app_metadata` and not `user_metadata`?** `user_metadata` can be
> written by the user themselves via the Supabase client — it is **not safe**
> for access control. `app_metadata` is mutable only via the service-role key
> (or SQL), which is why `public.is_admin()` reads from there.

### Prerequisite

**Sign in once on the public site first** (magic link or Google) so your row
exists in `auth.users`. The grant won't work until the row exists.

### Option A — copy-paste SQL (fastest)

Run any of these in **Studio → SQL Editor**, replacing the email. They use
`raw_app_meta_data || '...'::jsonb` so existing keys (e.g. `provider`) are
preserved.

**Grant admin to a single user:**
```sql
UPDATE auth.users
   SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
 WHERE email = 'you@example.com';
```

**Revoke admin (useful for testing the gate):**
```sql
UPDATE auth.users
   SET raw_app_meta_data = raw_app_meta_data - 'role'
 WHERE email = 'you@example.com';
```

**List all current admins:**
```sql
SELECT email, raw_app_meta_data->>'role' AS role, last_sign_in_at
  FROM auth.users
 WHERE raw_app_meta_data->>'role' = 'admin'
 ORDER BY last_sign_in_at DESC NULLS LAST;
```

**Check your own role right now (run while signed in):**
```sql
SELECT email, raw_app_meta_data->>'role' AS role
  FROM auth.users
 WHERE id = auth.uid();
```

### Option B — Supabase Studio UI

1. Studio → **Authentication → Users** → click your row.
2. Open the **Raw User Meta Data** tab. Two sections:
   - **User Metadata** — user-editable; not trusted for access control.
   - **App Metadata** — service-role-only; safe for roles.
3. Under **App Metadata**, merge in `"role": "admin"` (don't replace the whole
   object). E.g.:
   ```json
   { "provider": "email", "role": "admin" }
   ```
4. Save.

### ⚠️ Re-auth required

**The JWT only refreshes on a new session.** After granting, sign out + sign
back in — otherwise the gate will still block you with the old token.

### Verify

Once re-authenticated, visit each admin page and expect the editor (not the
"Not authorized" panel):

- <http://localhost:8080/admin/recipes.html> — recipe list
- <http://localhost:8080/admin/ingredients.html> — ingredient library
- <http://localhost:8080/admin/utensils.html> — utensil library
- <http://localhost:8080/admin/recipe.html?id=butter-chicken> — recipe editor
- <http://localhost:8080/admin/ingredient.html?id=paneer> — ingredient editor
- <http://localhost:8080/admin/utensil.html?id=kadhai-cast-iron-9> — utensil editor

If any page shows "Not authorized", check the console for the user's JWT
claims (`window.MFC.auth.getUser()`) and confirm `app_metadata.role` is
`'admin'`. If it isn't, you're still on the pre-grant token — sign out and
back in.

### Test the negative path (gate works)

Useful before shipping. Revoke yourself via the SQL above, sign out + sign
back in, and confirm the same URLs render the "Not authorized" panel rather
than the editors. Re-grant when done.

### Granting others

Same `UPDATE auth.users ... WHERE email = '<their email>'` SQL. They must
sign in to the site at least once first, then re-authenticate to pick up the
role.

---

## 5. Paste credentials into the HTML pages

In each of [index.html](web/index.html), [recipe-search.html](web/recipe-search.html),
[recipe.html](web/recipe.html), find the meta tags in `<head>`:

```html
<meta name="mfc-supabase-url" content="" />
<meta name="mfc-supabase-publishable-key" content="" />
```

Fill in `content`:

```html
<meta name="mfc-supabase-url" content="https://<your-project>.supabase.co" />
<meta name="mfc-supabase-publishable-key" content="<publishable key>" />
```

The publishable key is safe to commit / serve publicly — RLS protects all the
user-owned tables.

---

## 6. Import the recipes (one-time)

The recipe catalog lives in Supabase, seeded from
`web/assets/recipes/*/recipe.json`.

From the repo root:

```bash
make import-recipes
```

Idempotent — re-running after editing source JSON reconciles to the same
state. Reads credentials from `automation/.env` (set up in §2).

Expected output:

```
→ pass 1/3 · collecting library rows from 10 bundle(s)
  unique ingredients: 63 · utensils: 38
→ pass 2/3 · upserting library tables
  ✓ ingredients populated (63)
  ✓ utensils populated (38)
→ pass 3/3 · upserting 10 recipe(s)
  ✓ aloo-gobi
  ✓ butter-chicken
  …
```

The secret key in `automation/.env` bypasses RLS — keep it out of the
browser, out of the repo, out of any client-side bundle. Never commit
`automation/.env` (it's gitignored).

After this, ongoing recipe edits happen via Supabase Studio's table editor —
no script needed.

---

## 7. Verify locally

```bash
make serve     # http.server on port 8080
```

Visit:

- <http://localhost:8080/> — landing page renders.
- <http://localhost:8080/recipe-search.html> — recipe grid loads from Supabase.
- <http://localhost:8080/recipe.html?id=paneer-butter-masala> — full recipe loads.

Then verify auth flows:

1. Click the sign-in button in the nav. Modal opens with "Continue with Google" + magic link form.
2. Magic link: enter your email → Supabase sends a link → click it → you're back on the page, signed in.
3. Google: click "Continue with Google" → OAuth roundtrip → returned signed in.
4. Heart icon on a recipe card persists across reload (saved to `saved_recipes`).
5. On the recipe page, advance through steps; close tab; reopen — session resumes
   at the last step (saved to `cooking_sessions`).
6. Complete all steps → "Log this meal?" prompt appears → submit → row appears in
   `meal_logs`.
7. On the landing page (logged in), the "Personalize" section shows the blood
   markers panel. Enter a value (e.g. Iron = 95 µg/dL, today's date) → blur →
   row in `user_health_markers`.

---

## 8. Recommendations pipeline (your separate workstream)

The website only **reads** from `recommendations`. Your offline data pipeline
**writes** to it using the secret key.

Contract:

```sql
INSERT INTO public.recommendations (user_id, meal_type, recipe_id, rank, reason, generated_at)
VALUES ($user_id, $meal_type, $recipe_id, $rank, $reason, now())
ON CONFLICT (user_id, meal_type, recipe_id) DO UPDATE
  SET rank = EXCLUDED.rank,
      reason = EXCLUDED.reason,
      generated_at = EXCLUDED.generated_at;
```

- `meal_type` ∈ `breakfast | lunch | dinner | snack`
- `rank` is 1-based; 1 = top suggestion
- `reason` is the human-readable "why this recipe" string surfaced in the UI
- Run the pipeline whenever a user updates `user_health_markers` or whenever
  `recipes` / `meal_types` change in a way that affects matching

Recommended: a Postgres trigger on `user_health_markers` that posts to a queue
your pipeline drains, or a scheduled job that diffs recent updates.

---

## 9. Production deploy

The static site lives under `web/`. GitHub Pages can only publish from
`/` or `/docs` of a branch, so we use a GitHub Action
([.github/workflows/deploy-pages.yml](../.github/workflows/deploy-pages.yml))
that uploads `./web` and publishes it via `actions/deploy-pages`.

### One-time setup

In the GitHub repo:

1. **Settings → Pages → Build and deployment → Source**: switch to
   **GitHub Actions** (not "Deploy from a branch").
2. The workflow runs on every push to `master`. The first run will
   produce the live URL; subsequent runs replace the deployed artifact.
3. Custom domain: `web/CNAME` already contains `myfoodcraving.com` —
   the deploy action picks it up automatically. The duplicate root
   `CNAME` is harmless; leave it as a "Deploy from branch" fallback.

For other hosting options (Cloudflare Pages, Netlify, Vercel) see
[OPTIMIZATIONS.md → Hosting alternatives explored](OPTIMIZATIONS.md#hosting-alternatives-explored).

### Optional hardening

- Restrict the publishable key by adding a domain whitelist in Supabase → Settings → API.
- Move the meta tags out of source-controlled HTML by using a build-time
  template substitution (only matters if you don't want the URL/key visible in
  git history — they're public-safe but obfuscation is fine).
