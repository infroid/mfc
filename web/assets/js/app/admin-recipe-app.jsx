// Recipe editor — create or update one recipe. Loads ?id=<slug> for edit, or
// ?new=1 for a blank draft. Library pickers (ingredients/utensils) read from
// the public catalog. Save writes to recipes + child tables under admin RLS.
const { useState, useEffect, useMemo } = React;

const BLANK = {
  id: "",
  name: "",
  short_tagline: "",
  tagline: "",
  cuisine: "North Indian",
  category: "Main",
  difficulty: "Easy",
  servings: 4,
  total_minutes: 30,
  prep_minutes: 10,
  cook_minutes: 20,
  description: "",
  hero_image: "",
  featured: false,
  highlight: "",
  meal_types: [],
  steps: [],
  ingredients: [], // { ingredient_id, amount, unit }
  utensils: [],    // { utensil_id, essential }
  tags: [],
  health: [],
};

function fromDb(row) {
  if (!row) return BLANK;
  const ingredients = (row.recipe_ingredients || [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({
      ingredient_id: i.ingredient_id,
      group_name: i.group_name,
      amount: i.amount || "",
      unit: i.unit || "",
    }));
  const steps = (row.recipe_steps || [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => ({
      title: s.title,
      detail: s.detail || "",
      duration_seconds: s.duration_seconds,
      tip: s.tip,
      media_caption: s.media_caption,
    }));
  const utensils = (row.recipe_utensils || [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((u) => ({
      utensil_id: u.utensil_id,
      essential: !!u.essential,
    }));
  const tags = (row.recipe_tags || []).map((t) => t.tag);
  const health = (row.recipe_health_facts || [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((h) => h.fact);
  return {
    id: row.id,
    name: row.name,
    short_tagline: row.short_tagline || "",
    tagline: row.tagline || "",
    cuisine: row.cuisine,
    category: "Main",
    difficulty: row.difficulty,
    servings: row.servings,
    total_minutes: row.total_minutes,
    prep_minutes: 0,
    cook_minutes: row.total_minutes,
    description: row.tagline || "",
    hero_image: row.media?.image || "",
    featured: !!row.featured,
    highlight: row.highlight || "",
    meal_types: row.meal_types || [],
    steps, ingredients, utensils, tags, health,
  };
}

function toDb(r) {
  const recipe = {
    name: r.name,
    tagline: r.tagline || null,
    short_tagline: r.short_tagline || null,
    cuisine: r.cuisine,
    difficulty: r.difficulty,
    servings: parseInt(r.servings, 10) || 0,
    total_minutes: parseInt(r.total_minutes, 10) || 0,
    media: { image: r.hero_image || null },
    featured: !!r.featured,
    highlight: r.highlight || null,
    meal_types: r.meal_types || [],
  };
  return {
    id: r.id,
    recipe,
    ingredients: r.ingredients.map((ing) => ({
      ingredient_id: ing.ingredient_id,
      group_name: ing.group_name || null,
      amount: ing.amount || null,
      unit: ing.unit || null,
    })),
    steps: r.steps.map((s) => ({
      title: s.title,
      detail: s.detail,
      duration_seconds: s.duration_seconds == null || s.duration_seconds === ""
        ? null : parseInt(s.duration_seconds, 10),
      tip: s.tip || null,
      media_caption: s.media_caption || null,
    })),
    utensils: r.utensils.map((u) => ({
      utensil_id: u.utensil_id,
      essential: !!u.essential,
    })),
    tags: r.tags,
    health: r.health.filter((h) => (h || "").trim()),
  };
}

function RecipeAdminApp() {
  const params = new URLSearchParams(location.search);
  const editId = params.get("id");
  const isNew = !editId;

  const [r, setR] = useState(BLANK);
  const [tab, setTab] = useState("basics");
  const [activeStep, setActiveStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [savedAgo, setSavedAgo] = useState(null);

  const [ingLib, setIngLib] = useState([]);
  const [utLib, setUtLib] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [ing, ut] = await Promise.all([
          window.MFC.adminDb.listIngredients(),
          window.MFC.adminDb.listUtensils(),
        ]);
        setIngLib(ing); setUtLib(ut);
      } catch (e) { console.warn("[lib load]", e); }
    })();
  }, []);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const row = await window.MFC.adminDb.getRecipe(editId);
        if (!row) { setErr(`No recipe with id "${editId}"`); return; }
        setR(fromDb(row));
        setDirty(false);
      } catch (e) { setErr(e.message); }
    })();
  }, [editId, isNew]);

  const update = (patch) => { setR((p) => ({ ...p, ...patch })); setDirty(true); };
  const updateStep = (i, patch) => update({ steps: r.steps.map((s, k) => k === i ? { ...s, ...patch } : s) });
  const removeStep = (i) => update({ steps: r.steps.filter((_, k) => k !== i) });
  const addStep = () => update({ steps: [...r.steps, { title: "New step", detail: "", duration_seconds: 300 }] });

  const updateIng = (i, patch) => update({ ingredients: r.ingredients.map((s, k) => k === i ? { ...s, ...patch } : s) });
  const removeIng = (i) => update({ ingredients: r.ingredients.filter((_, k) => k !== i) });
  const addIngFromLib = (lib) => {
    if (r.ingredients.some((x) => x.ingredient_id === lib.id)) return;
    update({ ingredients: [...r.ingredients, { ingredient_id: lib.id, amount: "", unit: lib.default_unit || "g" }] });
  };

  const updateUt = (i, patch) => update({ utensils: r.utensils.map((s, k) => k === i ? { ...s, ...patch } : s) });
  const removeUt = (i) => update({ utensils: r.utensils.filter((_, k) => k !== i) });
  const addUtFromLib = (lib) => {
    if (r.utensils.some((x) => x.utensil_id === lib.id)) return;
    update({ utensils: [...r.utensils, { utensil_id: lib.id, essential: true }] });
  };

  async function onPublish() {
    setErr(null); setBusy(true);
    try {
      let id = r.id;
      if (isNew || !id) {
        id = window.slugify(r.name);
        if (!id) throw new Error("Recipe needs a name before saving.");
      }
      const payload = toDb({ ...r, id });
      await window.MFC.adminDb.saveRecipe(payload);
      setDirty(false);
      setSavedAgo("just now");
      if (isNew) { location.href = `recipe.html?id=${encodeURIComponent(id)}`; return; }
    } catch (e) { setErr(e.message || String(e)); }
    finally { setBusy(false); }
  }

  function onDiscard() {
    if (!dirty) return;
    if (!confirm("Discard unsaved changes?")) return;
    location.reload();
  }

  if (err && !r.name) {
    return (
      <div className="admin-shell">
        <AdminSidebar active="recipes" />
        <div className="admin-main">
          <AdminTopbar crumb={[{ label: "Recipes", href: "recipes.html" }, { label: "Error" }]} />
          <div className="admin-page">
            <div className="form-card" style={{ borderColor: "var(--berry)" }}>
              <div className="form-card-body" style={{ color: "var(--berry)" }}>
                {err} · <a href="recipes.html" style={{ color: "var(--orange)" }}>Back to recipes</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <AdminSidebar active="recipes" />
      <div className="admin-main">
        <AdminTopbar
          crumb={[{ label: "Recipes", href: "recipes.html" }, { label: r.name || "Untitled" }]}
          status={r.featured ? "live" : "draft"}
          savedAgo={savedAgo}
          isNew={isNew}
          onPublish={onPublish}
          publishLabel={busy ? "Saving…" : (isNew ? "Publish" : "Update")}
        />

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h1>{isNew ? <>New <em>recipe</em></> : <>Edit <em>recipe</em></>}</h1>
              <p className="lede">Author the recipe, attach steps. Ingredients & utensils are picked from the library — they always pre-exist.</p>
            </div>
            <div className="admin-page-meta">
              {!isNew && <span><b>id</b> · {r.id}</span>}
              <span><b>{r.steps.length}</b> steps</span>
              <span><b>{r.ingredients.length}</b> ingredients</span>
            </div>
          </div>

          <FormTabs
            active={tab}
            onChange={setTab}
            tabs={[
              { id: "basics", label: "Basics" },
              { id: "steps", label: "Steps", badge: r.steps.length },
              { id: "ingredients", label: "Ingredients", badge: r.ingredients.length },
              { id: "utensils", label: "Utensils", badge: r.utensils.length },
              { id: "health", label: "Health" },
            ]}
          />

          <div className="workbench" style={{ marginTop: 20 }}>
            <div className="workbench-form">
              {tab === "basics" && <BasicsTab r={r} update={update} isNew={isNew} />}
              {tab === "steps" && <StepsTab r={r} updateStep={updateStep} removeStep={removeStep} addStep={addStep} activeStep={activeStep} setActiveStep={setActiveStep} />}
              {tab === "ingredients" && <IngredientsTab r={r} ingLib={ingLib} updateIng={updateIng} removeIng={removeIng} addIngFromLib={addIngFromLib} />}
              {tab === "utensils" && <UtensilsTab r={r} utLib={utLib} updateUt={updateUt} removeUt={removeUt} addUtFromLib={addUtFromLib} />}
              {tab === "health" && <HealthTab r={r} update={update} />}
            </div>

            <div className="workbench-preview">
              <PreviewFrame url={`/recipe.html?id=${r.id || "<new>"}`}>
                <RecipePreview r={r} ingLib={ingLib} utLib={utLib} activeStep={activeStep} />
              </PreviewFrame>
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 4px", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)" }}>
                <span>↻ Live preview</span>
                <span>·</span>
                <span>Updates as you type</span>
                <span style={{ marginLeft: "auto", fontFamily: "var(--hand)", textTransform: "none", letterSpacing: 0, fontSize: 18, color: "var(--orange)", transform: "rotate(-3deg)", display: "inline-block" }}>looks tasty!</span>
              </div>
            </div>
          </div>

          <SaveBar dirty={dirty} busy={busy} error={err} onDiscard={onDiscard} onPublish={onPublish} isNew={isNew} />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// BASICS
// ============================================================
function BasicsTab({ r, update, isNew }) {
  return (
    <>
      <FormCard title="Identity" scribble="the headline">
        <div className="field-grid">
          <Field label="Recipe name" required>
            <input className="input serif" value={r.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Paneer Butter Masala" />
          </Field>
          {isNew && r.name && (
            <div className="field-hint" style={{ fontFamily: "var(--mono)", fontStyle: "normal", fontSize: 11, color: "var(--ink-muted)" }}>
              id will be: <span style={{ color: "var(--orange)" }}>{window.slugify(r.name)}</span>
            </div>
          )}
          <Field label="Short tagline" hint="Shown on the recipe page hero (e.g. 'creamy · tomato · 35 min').">
            <input className="input" value={r.short_tagline} onChange={(e) => update({ short_tagline: e.target.value })} />
          </Field>
          <Field label="Listing tagline" hint="Shown on the search/listing card.">
            <input className="input" value={r.tagline} onChange={(e) => update({ tagline: e.target.value })} />
          </Field>
          <div className="field-grid cols-3">
            <Field label="Cuisine">
              <select className="select" value={r.cuisine} onChange={(e) => update({ cuisine: e.target.value })}>
                <option>North Indian</option><option>South Indian</option><option>Italian</option><option>Mexican</option><option>Thai</option><option>Japanese</option><option>Mediterranean</option><option>Other</option>
              </select>
            </Field>
            <Field label="Difficulty">
              <RadioPills value={r.difficulty} options={["Easy", "Medium", "Hard"]} onChange={(v) => update({ difficulty: v })} />
            </Field>
            <Field label="Featured">
              <Toggle value={r.featured} onChange={(v) => update({ featured: v })} />
            </Field>
          </div>
          <Field label="Highlight" hint="Optional one-liner callout on listing cards.">
            <input className="input" value={r.highlight} onChange={(e) => update({ highlight: e.target.value })} placeholder="14g protein per serving from paneer" />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Hero photograph" scribble="the money shot">
        <Field label="Hero image path" hint="Relative path under assets/recipes/{id}/hero.jpg or similar.">
          <input className="input mono" value={r.hero_image} onChange={(e) => update({ hero_image: e.target.value })} placeholder="assets/recipes/paneer-butter-masala/hero.jpg" />
        </Field>
      </FormCard>

      <FormCard title="Timing & yield">
        <div className="field-grid cols-3">
          <Field label="Servings"><div className="input-wrap has-suffix"><input className="input mono" value={r.servings} onChange={(e) => update({ servings: e.target.value })} /><span className="suffix">people</span></div></Field>
          <Field label="Total time"><div className="input-wrap has-suffix"><input className="input mono" value={r.total_minutes} onChange={(e) => update({ total_minutes: e.target.value })} /><span className="suffix">min</span></div></Field>
          <Field label="Meal types" hint="Comma-separated. Used for personalized recommendations.">
            <input className="input mono" value={(r.meal_types || []).join(", ")} onChange={(e) => update({ meal_types: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="lunch, dinner" />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Tags">
        <Field label="Search & recommendation tags" hint="Press enter or comma to add.">
          <ChipInput
            tags={r.tags}
            onAdd={(t) => update({ tags: [...r.tags, t] })}
            onRemove={(i) => update({ tags: r.tags.filter((_, k) => k !== i) })}
          />
        </Field>
      </FormCard>
    </>
  );
}

// ============================================================
// STEPS
// ============================================================
function StepsTab({ r, updateStep, removeStep, addStep, activeStep, setActiveStep }) {
  return (
    <FormCard title="Steps" scribble={`${r.steps.length} so far`}>
      <div className="step-list">
        {r.steps.map((s, i) => (
          <div
            key={i}
            className={"step-edit" + (activeStep === i ? " active" : "")}
            onClick={() => setActiveStep(i)}
          >
            <div className="step-edit-head">
              <div className="step-handle">{String(i + 1).padStart(2, "0")}</div>
              <input className="step-edit-title" value={s.title} onChange={(e) => updateStep(i, { title: e.target.value })} />
              <div className="step-edit-actions">
                <button className="step-icon-btn danger" onClick={(e) => { e.stopPropagation(); removeStep(i); }}>×</button>
              </div>
            </div>
            <div className="step-edit-body">
              <textarea
                className="step-edit-detail"
                value={s.detail}
                onChange={(e) => updateStep(i, { detail: e.target.value })}
                placeholder="What does the cook do?"
              />
              <div className="step-edit-side">
                <div className="step-mini">
                  <span className="lbl">Timer</span>
                  <input
                    value={s.duration_seconds == null ? "" : s.duration_seconds}
                    onChange={(e) => updateStep(i, { duration_seconds: e.target.value })}
                  />
                  <span style={{ color: "var(--ink-faint)" }}>sec</span>
                </div>
              </div>
            </div>
            {activeStep === i && (
              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                <input
                  className="input"
                  style={{ fontSize: 13, padding: "8px 12px" }}
                  placeholder="Optional pro-tip"
                  value={s.tip || ""}
                  onChange={(e) => updateStep(i, { tip: e.target.value })}
                />
                <input
                  className="input mono"
                  style={{ fontSize: 12, padding: "8px 12px" }}
                  placeholder="Optional reference image caption"
                  value={s.media_caption || ""}
                  onChange={(e) => updateStep(i, { media_caption: e.target.value })}
                />
              </div>
            )}
          </div>
        ))}
        <button className="add-step-btn" onClick={addStep}>+ Add step</button>
      </div>
    </FormCard>
  );
}

// ============================================================
// LIBRARY PICKER (shared shape)
// ============================================================
function LibraryPicker({ kind, library, picked, onPick, manageHref, manageLabel }) {
  const [q, setQ] = useState("");
  const isPicked = (id) => picked.some((p) => (kind === "ing" ? p.ingredient_id : p.utensil_id) === id);
  const filtered = useMemo(() => {
    const qq = q.toLowerCase().trim();
    return library.filter((x) => !qq || x.name.toLowerCase().includes(qq) || (x.category || "").toLowerCase().includes(qq));
  }, [q, library]);
  return (
    <div className="lib-picker">
      <div className="lib-search">
        <span className="glass">⌕</span>
        <input
          className="lib-search-input"
          placeholder={`Search ${kind === "ing" ? "ingredients" : "utensils"} library…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="ct">{filtered.length} of {library.length}</span>
      </div>
      <div className="lib-list">
        {library.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--ink-muted)" }}>
            <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, marginBottom: 6 }}>The library is empty</div>
            <div style={{ fontSize: 12 }}>Add some {kind === "ing" ? "ingredients" : "utensils"} first. <a href={manageHref} style={{ color: "var(--orange)", textDecoration: "underline" }}>{manageLabel}</a></div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "32px 20px", textAlign: "center", color: "var(--ink-muted)" }}>
            <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, marginBottom: 6 }}>Nothing matches "{q}"</div>
            <div style={{ fontSize: 12 }}>{kind === "ing" ? "Ingredients" : "Utensils"} can only be added from the library. <a href={manageHref} style={{ color: "var(--orange)", textDecoration: "underline" }}>{manageLabel}</a></div>
          </div>
        ) : filtered.map((item) => {
          const used = isPicked(item.id);
          return (
            <div key={item.id} className={"lib-row" + (used ? " disabled" : "")} onClick={() => !used && onPick(item)}>
              <div className={"lib-thumb " + (kind === "ing" ? "matcha" : "cream")} />
              <div>
                <div className="name">{item.name}</div>
                <div className="meta">{item.category || "—"}</div>
              </div>
              <span /><span />
              {used ? <span className="added">✓ added</span> : <button className="add-btn">+</button>}
            </div>
          );
        })}
      </div>
      <div className="lib-foot">
        <span>Library only</span>
        <span style={{ color: "var(--ink-faint)" }}>·</span>
        <a href={manageHref}>{manageLabel} →</a>
      </div>
    </div>
  );
}

// ============================================================
// INGREDIENTS
// ============================================================
function IngredientsTab({ r, ingLib, updateIng, removeIng, addIngFromLib }) {
  return (
    <>
      <FormCard title="Picked for this recipe" scribble={`${r.ingredients.length} items`}>
        {r.ingredients.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--ink-muted)", fontStyle: "italic", fontFamily: "var(--serif)", fontSize: 16 }}>
            None yet — add ingredients from the library below.
          </div>
        ) : (
          <div className="picked-list">
            {r.ingredients.map((ing, i) => {
              const lib = ingLib.find((x) => x.id === ing.ingredient_id) || { name: ing.ingredient_id || "(unknown)", category: "—" };
              return (
                <div key={i} className="picked-row">
                  <span className="handle">⋮⋮</span>
                  <div className="lib-thumb matcha" />
                  <div>
                    <div className="name">{lib.name}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{lib.category}</div>
                  </div>
                  <input
                    className="amt-input"
                    value={ing.amount}
                    onChange={(e) => updateIng(i, { amount: e.target.value })}
                    placeholder="—"
                  />
                  <select
                    style={{ background: "var(--cream-soft)", border: "1px solid var(--rule)", borderRadius: 6, padding: "6px 10px", fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-soft)", outline: "none" }}
                    value={ing.unit || ""}
                    onChange={(e) => updateIng(i, { unit: e.target.value })}
                  >
                    <option value="">—</option>
                    <option>g</option><option>kg</option><option>ml</option><option>l</option><option>tsp</option><option>tbsp</option><option>cup</option><option>medium</option><option>large</option><option>whole</option><option>pinch</option>
                  </select>
                  <button className="x" onClick={() => removeIng(i)}>×</button>
                </div>
              );
            })}
          </div>
        )}
      </FormCard>

      <FormCard title="Add from library" scribble="search & pick"
        headRight={<a href="ingredient.html?new=1" className="btn-sm ghost" style={{ textDecoration: "none" }}>+ New ingredient ↗</a>}>
        <LibraryPicker
          kind="ing"
          library={ingLib}
          picked={r.ingredients}
          onPick={addIngFromLib}
          manageHref="ingredients.html"
          manageLabel="Manage library"
        />
      </FormCard>
    </>
  );
}

// ============================================================
// UTENSILS
// ============================================================
function UtensilsTab({ r, utLib, updateUt, removeUt, addUtFromLib }) {
  return (
    <>
      <FormCard title="Picked for this recipe" scribble={`${r.utensils.length} items`}>
        {r.utensils.length === 0 ? (
          <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--ink-muted)", fontStyle: "italic", fontFamily: "var(--serif)", fontSize: 16 }}>
            None yet — add utensils from the library below.
          </div>
        ) : (
          <div className="picked-list">
            {r.utensils.map((u, i) => {
              const lib = utLib.find((x) => x.id === u.utensil_id) || { name: u.utensil_id || "(unknown)", category: "—" };
              return (
                <div key={i} className="picked-row" style={{ gridTemplateColumns: "auto 36px 1fr auto auto" }}>
                  <span className="handle">⋮⋮</span>
                  <div className="lib-thumb cream" />
                  <div>
                    <div className="name">{lib.name}</div>
                    <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>{lib.category}</div>
                  </div>
                  <span
                    className={"ut-tag " + (u.essential ? "must" : "nice")}
                    onClick={() => updateUt(i, { essential: !u.essential })}
                    title="Click to toggle"
                  >
                    {u.essential ? "must" : "nice"}
                  </span>
                  <button className="x" onClick={() => removeUt(i)}>×</button>
                </div>
              );
            })}
          </div>
        )}
      </FormCard>

      <FormCard title="Add from library" scribble="search & pick"
        headRight={<a href="utensil.html?new=1" className="btn-sm ghost" style={{ textDecoration: "none" }}>+ New utensil ↗</a>}>
        <LibraryPicker
          kind="ut"
          library={utLib}
          picked={r.utensils}
          onPick={addUtFromLib}
          manageHref="utensils.html"
          manageLabel="Manage library"
        />
      </FormCard>
    </>
  );
}

// ============================================================
// HEALTH
// ============================================================
function HealthTab({ r, update }) {
  return (
    <FormCard title="Health facts" scribble="rotates every 3 min">
      <Field label="Talking points" hint="Up to 6 facts. Surfaced one at a time during cooking.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {r.health.map((h, i) => (
            <div key={i} className="row-edit" style={{ gridTemplateColumns: "auto 1fr auto" }}>
              <span className="row-edit-handle">⋮⋮</span>
              <input value={h} onChange={(e) => {
                const health = [...r.health]; health[i] = e.target.value; update({ health });
              }} />
              <button className="row-edit-x" onClick={() => update({ health: r.health.filter((_, k) => k !== i) })}>×</button>
            </div>
          ))}
          <button className="add-step-btn" onClick={() => update({ health: [...r.health, ""] })}>+ Add fact</button>
        </div>
      </Field>
    </FormCard>
  );
}

// ============================================================
// PREVIEW
// ============================================================
function RecipePreview({ r, ingLib, utLib, activeStep }) {
  const step = r.steps[activeStep] || r.steps[0];
  const firstWord = (r.name || "").split(" ")[0];
  const rest = (r.name || "").split(" ").slice(1).join(" ");
  return (
    <div className="pv-recipe">
      <div className="pv-breadcrumb">
        <span>Home</span><span className="sep">›</span><span>{r.cuisine}</span><span className="sep">›</span><span style={{ color: "var(--ink)" }}>{r.name || "Untitled"}</span>
      </div>
      <div>
        <h1 className="pv-title"><em>{firstWord}</em> {rest}</h1>
        <div className="pv-tagline">{r.short_tagline}</div>
      </div>
      <div className="pv-meta">
        <span className="pv-pill"><span className="dot" /><b>{r.total_minutes}</b> min</span>
        <span className="pv-pill"><b>{r.servings}</b> servings</span>
        <span className="pv-pill"><b>{r.difficulty}</b></span>
        <span className="pv-pill"><b>{r.steps.length}</b> steps</span>
      </div>
      <div className="pv-image">
        <span className="corner-stick">{r.cuisine}</span>
        <span className="tag">[ overhead shot ]</span>
      </div>
      {step && (
        <div className="pv-step">
          <div className="num">Step {activeStep + 1} / {r.steps.length}</div>
          <h4>{step.title}</h4>
          <p>{step.detail}</p>
        </div>
      )}
      <div className="pv-sides">
        <div className="pv-card">
          <h5>Ingredients <span className="count">· {r.ingredients.length}</span></h5>
          <ul>
            {r.ingredients.slice(0, 6).map((ing, i) => {
              const lib = ingLib.find((x) => x.id === ing.ingredient_id) || { name: ing.ingredient_id };
              return (
                <li key={i}>
                  <span className="check" />
                  <span>{lib.name}</span>
                  <span className="amt">{ing.amount}{ing.unit ? " " + ing.unit : ""}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="pv-card">
          <h5>Utensils <span className="count">· {r.utensils.length}</span></h5>
          <ul>
            {r.utensils.slice(0, 6).map((u, i) => {
              const lib = utLib.find((x) => x.id === u.utensil_id) || { name: u.utensil_id };
              return (
                <li key={i}>
                  <span className="check" />
                  <span>{lib.name}</span>
                  {!u.essential && <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9, color: "var(--ink-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>nice</span>}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<RecipeAdminApp />);
});
