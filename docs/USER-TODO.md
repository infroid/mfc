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

In **SQL Editor**, run these in order:

1. Paste the entire contents of [data/db/schema.sql](data/db/schema.sql) and run.
2. Paste the entire contents of [data/db/seed_metrics.sql](data/db/seed_metrics.sql) and run.

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
user, enforced both in the UI ([shared/admin-gate.js](shared/admin-gate.js))
and at the database level via the RLS predicate `public.is_admin()` (defined
in [data/db/schema.sql](data/db/schema.sql) §8).

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

In each of [index.html](index.html), [recipe-search.html](recipe-search.html),
[recipe.html](recipe.html), find the meta tags in `<head>`:

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
`data/recipe-bundles/*/recipe.json`. Run from the repo root:

```bash
# install supabase-js once
npm i @supabase/supabase-js

# run the import (idempotent — safe to re-run after editing source JSON)
SUPABASE_URL="https://<your-project>.supabase.co" \
SUPABASE_SECRET_KEY="<secret key>" \
node scripts/import_recipes.mjs
```

Expected output:

```
✓ paneer-butter-masala
✓ butter-chicken
…
recipes table now has 10 rows.
```

The secret key bypasses RLS — keep it out of the browser, out of the repo,
out of any client-side bundle. Keep it in your local `.env` or shell only.
Never commit secret keys to version control.

After this, ongoing recipe edits happen via Supabase Studio's table editor — no
script needed.

---

## 7. Verify locally

```bash
python3 -m http.server 8080
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

GitHub Pages already serves the static repo. With the meta tags filled in,
pushing to `master` will deploy a Supabase-backed site.

Optional hardening:

- Restrict the publishable key by adding a domain whitelist in Supabase → Settings → API.
- Move the meta tags out of source-controlled HTML by using a build-time
  template substitution (only matters if you don't want the URL/key visible in
  git history — they're public-safe but obfuscation is fine).
