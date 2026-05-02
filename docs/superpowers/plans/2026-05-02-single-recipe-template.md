# Single Recipe Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 10 per-recipe HTML files with a single `recipe.html` template that fetches recipe data from `data/recipes/{id}.json` based on `?id=` URL param.

**Architecture:** `recipe.html` reads `?id=butter-chicken` from URL params, sets `window.MFC_RECIPE_ID`, and renders using a fetch-capable `RecipeApp`. `recipe-search.html` links are updated to the new URL format. The 10 per-recipe HTML files and the `recipe.jsx` sample data file are deleted.

**Tech Stack:** React 18 (CDN), Babel Standalone (in-browser), static JSON files, GitHub Pages

---

### Task 1: Update `recipe.html` to be the single template

**Files:**
- Modify: `recipe.html`

- [ ] **Step 1: Replace `recipe.html` with the template version**

Replace the entire contents of `recipe.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Recipe — MyFoodCraving</title>
<meta name="description" content="Guided, voice-led cooking on MyFoodCraving — step timers, smart ingredient list, and cozy kitchen radio." />

<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&family=Caveat:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />

<link rel="stylesheet" href="recipe-base.css" />
<link rel="stylesheet" href="recipe-styles.css" />

<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='15' fill='%23FF6D2E'/><text x='50%25' y='62%25' text-anchor='middle' fill='%23FFFCF3' font-family='Georgia,serif' font-style='italic' font-weight='400' font-size='22'>m</text></svg>" />
</head>

<body>

<script>
window.MFC_RECIPE_ID = new URLSearchParams(location.search).get('id') || '';
</script>

<script src="shared/auth.js"></script>
<script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
<script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
<script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>

<div id="root"></div>

<script type="text/babel" src="tweaks-panel.jsx"></script>
<script type="text/babel" src="recipe-app.jsx"></script>
<script type="text/babel" src="recipe-components.jsx"></script>

<script type="text/babel" data-presets="react">
const RECIPE_TWEAK_DEFAULTS = {
  "accent": "#FF6D2E",
  "secondAccent": "#7A9C5A",
  "bg": "#F7F1E3",
  "factIntervalMin": 3
};

function RecipeApp() {
  const [t, setTweak] = useTweaks(RECIPE_TWEAK_DEFAULTS);
  const [recipe, setRecipe] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [stepIdx, setStepIdx] = React.useState(0);
  const [doneSteps, setDoneSteps] = React.useState(new Set());

  React.useEffect(() => {
    const id = window.MFC_RECIPE_ID;
    if (!id) { setLoading(false); return; }
    fetch('data/recipes/' + id + '.json')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(data => {
        document.title = data.name + ' — MyFoodCraving';
        setRecipe(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--orange", t.accent);
    root.style.setProperty("--matcha", t.secondAccent);
    root.style.setProperty("--cream", t.bg);
  }, [t]);

  if (loading) return (
    <>
      <RecipeNav />
      <div style={{ height: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-muted)", fontSize: 22 }}>loading recipe…</p>
      </div>
    </>
  );

  if (!recipe) return (
    <>
      <RecipeNav />
      <div style={{ height: "80vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-muted)", fontSize: 22 }}>recipe not found</p>
      </div>
    </>
  );

  const progress = Math.round(
    ((doneSteps.size + (stepIdx < recipe.steps.length ? 0.5 : 0)) / recipe.steps.length) * 100
  );

  return (
    <>
      <RecipeNav />
      <main className="recipe-page">
        <div className="wrap">
          <RecipeHero recipe={recipe} progress={progress} />
          <HealthMarquee
            facts={recipe.healthFacts}
            intervalMs={(t.factIntervalMin || 3) * 60 * 1000}
          />
          <div className="r-stage" style={{ marginTop: 32 }}>
            <StepCard
              recipe={recipe}
              stepIdx={stepIdx}
              setStepIdx={setStepIdx}
              doneSteps={doneSteps}
              setDoneSteps={setDoneSteps}
            />
            <aside className="r-side">
              <IngredientsCard recipe={recipe} />
              <UtensilsCard recipe={recipe} />
            </aside>
          </div>
        </div>
      </main>

      <CookingPlayer recipe={recipe} stepIdx={stepIdx} setStepIdx={setStepIdx} />

      <TweaksPanel>
        <TweakSection label="Palette" />
        <TweakColor label="Primary accent" value={t.accent} onChange={(v) => setTweak("accent", v)} />
        <TweakColor label="Health accent" value={t.secondAccent} onChange={(v) => setTweak("secondAccent", v)} />
        <TweakColor label="Background" value={t.bg} onChange={(v) => setTweak("bg", v)} />
        <TweakSection label="Behavior" />
        <TweakSlider
          label="Health-fact interval (min)"
          value={t.factIntervalMin}
          min={1} max={10} step={1}
          onChange={(v) => setTweak("factIntervalMin", v)}
        />
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<RecipeApp />);
</script>

</body>
</html>
```

- [ ] **Step 2: Verify the file saved correctly**

```bash
wc -l recipe.html
grep "MFC_RECIPE_ID" recipe.html
grep "recipe.jsx" recipe.html
```

Expected: line count ~115, `MFC_RECIPE_ID` found, `recipe.jsx` NOT found.

- [ ] **Step 3: Start dev server and test**

```bash
kill -9 $(lsof -t -i :8080) 2>/dev/null; python3 -m http.server 8080 &
```

Open `http://localhost:8080/recipe.html?id=butter-chicken` in browser.
Expected: "loading recipe…" briefly, then full Butter Chicken recipe page with correct title in browser tab.

Open `http://localhost:8080/recipe.html?id=aloo-gobi`.
Expected: Aloo Gobi recipe page.

Open `http://localhost:8080/recipe.html` (no id param).
Expected: "recipe not found" state with nav bar.

- [ ] **Step 4: Commit**

```bash
git add recipe.html
git commit -m "feat: convert recipe.html to single dynamic template"
```

---

### Task 2: Update `recipe-search.html` links

**Files:**
- Modify: `recipe-search.html` (lines 638 and 685)

- [ ] **Step 1: Update FeaturedCard href**

In `recipe-search.html` line 638, change:
```jsx
<a href={`recipes/${recipe.id}.html`} className="featured-card">
```
to:
```jsx
<a href={`recipe.html?id=${recipe.id}`} className="featured-card">
```

- [ ] **Step 2: Update RecipeCard href**

In `recipe-search.html` line 685, change:
```jsx
<a href={`recipes/${recipe.id}.html`} className="recipe-card">
```
to:
```jsx
<a href={`recipe.html?id=${recipe.id}`} className="recipe-card">
```

- [ ] **Step 3: Verify no remaining old-style links**

```bash
grep "recipes/.*\.html" recipe-search.html
```

Expected: no output.

- [ ] **Step 4: Test in browser**

Open `http://localhost:8080/recipe-search.html`.
Click any recipe card. Expected: navigates to `recipe.html?id=<recipe-id>` and loads that recipe correctly.

- [ ] **Step 5: Commit**

```bash
git add recipe-search.html
git commit -m "feat: update recipe-search links to single template URL"
```

---

### Task 3: Delete per-recipe HTML files and `recipe.jsx`

**Files:**
- Delete: `recipes/aloo-gobi.html`, `recipes/butter-chicken.html`, `recipes/chicken-biryani.html`, `recipes/chole-bhature.html`, `recipes/dal-makhani.html`, `recipes/masala-dosa.html`, `recipes/palak-paneer.html`, `recipes/paneer-butter-masala.html`, `recipes/rajma-chawal.html`, `recipes/tandoori-chicken.html`
- Delete: `recipe.jsx`

- [ ] **Step 1: Delete all per-recipe HTML files**

```bash
rm recipes/aloo-gobi.html recipes/butter-chicken.html recipes/chicken-biryani.html \
   recipes/chole-bhature.html recipes/dal-makhani.html recipes/masala-dosa.html \
   recipes/palak-paneer.html recipes/paneer-butter-masala.html recipes/rajma-chawal.html \
   recipes/tandoori-chicken.html
```

- [ ] **Step 2: Delete recipe.jsx**

```bash
rm recipe.jsx
```

- [ ] **Step 3: Verify recipes directory**

```bash
ls recipes/
```

Expected: only `recipe-components.jsx`, `recipe-app.jsx`, `tweaks-panel.jsx` remain (the shared source files that were used by the now-deleted HTML files — these are now unused but can be cleaned up in a follow-up).

- [ ] **Step 4: Confirm site still works**

Open `http://localhost:8080/recipe-search.html`. Click a recipe. Expected: recipe loads correctly from `recipe.html?id=...`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove per-recipe HTML files and recipe.jsx sample data"
```

---

### Task 4: Clean up now-unused files in `recipes/`

The `recipes/` folder still has `recipe-components.jsx`, `recipe-app.jsx`, and `tweaks-panel.jsx` — copies that were only used by the deleted HTML files. The root-level versions are authoritative.

**Files:**
- Delete: `recipes/recipe-components.jsx`, `recipes/recipe-app.jsx`, `recipes/tweaks-panel.jsx`

- [ ] **Step 1: Delete unused copies**

```bash
rm recipes/recipe-components.jsx recipes/recipe-app.jsx recipes/tweaks-panel.jsx
```

- [ ] **Step 2: Verify recipes directory is now empty**

```bash
ls recipes/
```

Expected: empty (or the directory itself can be removed).

- [ ] **Step 3: Remove empty directory**

```bash
rmdir recipes/
```

- [ ] **Step 4: Confirm no broken references**

```bash
grep -r "recipes/" --include="*.html" --include="*.jsx" --include="*.js" .
```

Expected: no output (or only docs/spec references).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove now-unused recipes/ directory"
```
