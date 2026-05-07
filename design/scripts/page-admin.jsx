/* global React */
const Da = window.MFC_DATA;
const { useUser: useUserA, useRoute: useRouteA, navigate: navA } = window.MFC_CHROME;
const { useState: useStateA, useMemo: useMemoA } = React;

// ============================================================
// Admin shell + tab pages
// ============================================================
function AdminLayout({ active, children }) {
  const user = useUserA();
  if (!user || user.role !== "admin") {
    return (
      <div style={{ padding: "120px 28px", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 24, color: "var(--ink-soft)" }}>
          Admin only. Sign in as admin from the auth modal.
        </p>
      </div>
    );
  }
  const tabs = [
    { key: "recipes", label: "Recipes", path: "/admin/recipes", count: Da.RECIPES.length },
    { key: "ingredients", label: "Ingredients", path: "/admin/ingredients", count: Da.INGREDIENTS.length },
    { key: "utensils", label: "Utensils", path: "/admin/utensils", count: Da.UTENSILS.length },
    { key: "markers", label: "Markers", path: "/admin/markers", count: Da.METRIC_DEFS.length },
  ];
  return (
    <>
      <section className="admin-hero">
        <div className="wrap">
          <div className="admin-hero-row">
            <div>
              <div className="admin-tag">// admin · content studio</div>
              <h1 style={{ fontFamily: "var(--sans)", fontWeight: 500, fontSize: "clamp(38px,4.6vw,58px)", lineHeight: 1, letterSpacing: "-0.035em", marginTop: 6 }}>
                What are we <em style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, color: "var(--orange)" }}>cooking up?</em>
              </h1>
              <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--ink-soft)", marginTop: 10 }}>
                Recipes, library, markers — manage what powers the home experience.
              </p>
            </div>
            <div className="admin-stats">
              <div className="admin-stat"><b>{Da.RECIPES.length}</b><span>recipes</span></div>
              <div className="admin-stat"><b>{Da.INGREDIENTS.length}</b><span>ingredients</span></div>
              <div className="admin-stat"><b>{Da.UTENSILS.length}</b><span>utensils</span></div>
              <div className="admin-stat"><b>{Da.METRIC_DEFS.length}</b><span>markers</span></div>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="admin-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={"admin-tab" + (active === t.key ? " active" : "")}
              onClick={() => navA(t.path)}
            >
              <span>{t.label}</span>
              <span className="admin-tab-count">{t.count}</span>
            </button>
          ))}
        </div>
        <div style={{ paddingBottom: 60 }}>
          {children}
        </div>
      </div>
    </>
  );
}

// ---------------- Admin Recipes List ----------------
function AdminRecipesPage() {
  const [q, setQ] = useStateA("");
  const list = useMemoA(() => {
    if (!q.trim()) return Da.RECIPES;
    const qq = q.toLowerCase();
    return Da.RECIPES.filter(r =>
      r.name.toLowerCase().includes(qq) || r.cuisine.toLowerCase().includes(qq)
    );
  }, [q]);

  return (
    <AdminLayout active="recipes">
      <div className="admin-toolbar">
        <input
          className="input"
          style={{ flex: 1, minWidth: 260, maxWidth: 420 }}
          placeholder="Search recipes by name or cuisine…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="btn ghost sm">Filter</button>
        <button className="btn ghost sm">Sort: Updated</button>
        <span style={{ flex: 1 }} />
        <span className="pill">{list.length} of {Da.RECIPES.length}</span>
        <button className="btn primary" onClick={() => navA("/admin/recipe/new")}>+ New recipe</button>
      </div>

      <div className="admin-table card flat">
        <div className="atbl-head">
          <div>Recipe</div>
          <div>Cuisine</div>
          <div>Difficulty</div>
          <div>Time</div>
          <div>Steps</div>
          <div>Diet</div>
          <div>Updated</div>
          <div></div>
        </div>
        {list.map(r => (
          <div className="atbl-row" key={r.id}>
            <div className="atbl-cell-recipe">
              <span className="atbl-thumb" style={{ background: r.colorSoft }}>
                <img src={r.image} alt="" />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="atbl-name">{r.name}</div>
                <div className="atbl-tagline">{r.tagline}</div>
              </div>
            </div>
            <div className="atbl-mono">{r.cuisine}</div>
            <div>
              <span className="data-pill">{r.difficulty}</span>
            </div>
            <div className="atbl-mono">{r.minutes} min</div>
            <div className="atbl-mono">{r.stepCount}</div>
            <div>
              <span className={"tag-pill " + (r.diet === "non-veg" ? "nonveg" : "veg")}>{r.diet === "non-veg" ? "non-veg" : "veg"}</span>
            </div>
            <div className="atbl-mono">{Da.fmtAgo(r.updatedAt)}</div>
            <div className="atbl-actions">
              <button className="btn ghost sm" onClick={() => navA("/admin/recipe/" + r.id)}>Edit →</button>
            </div>
          </div>
        ))}
      </div>
    </AdminLayout>
  );
}

// ---------------- Admin Recipe Editor ----------------
function AdminRecipeEditPage() {
  const route = useRouteA();
  const id = route.seg[2]; // /admin/recipe/:id
  const isNew = id === "new";
  const recipe = isNew
    ? { id: "new", name: "", tagline: "", cuisine: "", difficulty: "Easy", minutes: 20, servings: 2, diet: "veg", tags: [], image: "" }
    : Da.recipeById(id);

  if (!recipe) {
    return (
      <AdminLayout active="recipes">
        <p style={{ padding: 40, textAlign: "center", fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-soft)" }}>
          Recipe not found.
        </p>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout active="recipes">
      <div className="editor-toolbar">
        <a className="back-link" href="#/admin/recipes" onClick={(e) => { e.preventDefault(); navA("/admin/recipes"); }}>
          ← All recipes
        </a>
        <span style={{ flex: 1 }} />
        <span className="pill">draft · last saved {Da.fmtAgo(recipe.updatedAt)}</span>
        <button className="btn ghost sm">Preview</button>
        <button className="btn primary">Save changes</button>
      </div>

      <div className="editor-grid">
        {/* LEFT: Basics + ingredients + steps */}
        <div className="editor-main">
          <Section title="Recipe basics" sub="Name, cuisine, difficulty">
            <div className="form-grid">
              <Field label="Name" full>
                <input className="input" defaultValue={recipe.name} placeholder="e.g. Lemon ricotta spaghetti" />
              </Field>
              <Field label="Tagline" full>
                <input className="input" defaultValue={recipe.tagline} placeholder="One short, evocative line" />
              </Field>
              <Field label="Cuisine">
                <input className="input" defaultValue={recipe.cuisine} />
              </Field>
              <Field label="Diet">
                <select className="input" defaultValue={recipe.diet}>
                  <option value="veg">Vegetarian</option>
                  <option value="non-veg">Non-veg</option>
                  <option value="vegan">Vegan</option>
                </select>
              </Field>
              <Field label="Difficulty">
                <select className="input" defaultValue={recipe.difficulty}>
                  <option>Easy</option><option>Medium</option><option>Hard</option>
                </select>
              </Field>
              <Field label="Minutes">
                <input className="input" type="number" defaultValue={recipe.minutes} />
              </Field>
              <Field label="Servings">
                <input className="input" type="number" defaultValue={recipe.servings} />
              </Field>
            </div>
          </Section>

          <Section title="Ingredients" sub="Drag to reorder. Pull from the library to keep things consistent." action={<button className="btn ghost sm">+ From library</button>}>
            <div className="ing-list">
              {[
                { name: "Spaghetti", qty: "200", unit: "g" },
                { name: "Whole-milk ricotta", qty: "0.5", unit: "cup" },
                { name: "Lemon", qty: "1", unit: "ea" },
                { name: "Parmesan, grated", qty: "0.25", unit: "cup" },
                { name: "Black pepper", qty: "to taste", unit: "" },
              ].map((i, idx) => (
                <div key={idx} className="ing-row">
                  <span className="ing-handle">⋮⋮</span>
                  <input className="input" defaultValue={i.qty} style={{ width: 80 }} />
                  <input className="input" defaultValue={i.unit} style={{ width: 80 }} />
                  <input className="input" defaultValue={i.name} style={{ flex: 1 }} />
                  <button className="ing-del" title="Remove">✕</button>
                </div>
              ))}
              <button className="btn ghost sm" style={{ alignSelf: "flex-start", marginTop: 4 }}>+ Add ingredient</button>
            </div>
          </Section>

          <Section title="Steps" sub="Numbered, conversational. Each step is one screen during guided cook." action={<button className="btn ghost sm">+ Add step</button>}>
            <div className="step-list">
              {[
                "Bring a large pot of well-salted water to a rolling boil.",
                "Zest one lemon into a bowl, then juice it. Set both aside.",
                "Cook spaghetti to just shy of al dente. Reserve 1/2 cup pasta water before draining.",
                "Whisk ricotta with lemon zest, 2 tbsp pasta water, salt, and lots of black pepper.",
                "Toss spaghetti with the ricotta sauce, finish with parmesan and extra zest.",
              ].map((s, idx) => (
                <div className="step-row" key={idx}>
                  <span className="step-num">{idx + 1}</span>
                  <textarea className="input" defaultValue={s} rows={2} />
                  <div className="step-meta">
                    <input className="input" placeholder="timer (min)" type="number" style={{ width: 100 }} />
                    <button className="step-del">✕</button>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* RIGHT: hero, tags, nutrition */}
        <aside className="editor-side">
          <Section title="Hero image" sub="What people see first">
            <div className="hero-uploader" style={{ background: recipe.colorSoft || "var(--cream-deep)" }}>
              {recipe.image ? (
                <img src={recipe.image} alt="" />
              ) : (
                <div style={{ textAlign: "center", padding: 40 }}>
                  <div className="footer-scribble" style={{ fontSize: 32, marginBottom: 4 }}>✎</div>
                  <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-muted)" }}>Drop an image here</p>
                </div>
              )}
            </div>
            <button className="btn ghost sm" style={{ width: "100%", marginTop: 10 }}>Replace image</button>
          </Section>

          <Section title="Tags">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(recipe.tags || []).map(t => (
                <span key={t} className={"tag-pill " + (t === "non-veg" ? "nonveg" : "veg")}>{t} ✕</span>
              ))}
              <button className="btn ghost sm">+ Tag</button>
            </div>
          </Section>

          <Section title="Nutrition" sub="Auto-estimated from ingredients">
            <div className="nutri-grid">
              <NutriCell label="Calories" value="540" unit="kcal" />
              <NutriCell label="Protein" value="22" unit="g" />
              <NutriCell label="Carbs" value="68" unit="g" />
              <NutriCell label="Fat" value="18" unit="g" />
              <NutriCell label="Fiber" value="4" unit="g" />
              <NutriCell label="Iron" value="3.2" unit="mg" />
            </div>
          </Section>

          <Section title="Marker fit" sub="What this recipe helps with">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="mk-mini"><span className="mk-mini-name">Calcium</span><span className="mk-mini-pill ok">helpful</span></div>
              <div className="mk-mini"><span className="mk-mini-name">Vit. D</span><span className="mk-mini-pill ok">helpful</span></div>
            </div>
          </Section>

          <button className="btn ghost sm" style={{ width: "100%", color: "var(--alert)" }}>Delete recipe</button>
        </aside>
      </div>
    </AdminLayout>
  );
}

function Section({ title, sub, action, children }) {
  return (
    <section className="ed-section">
      <div className="ed-section-head">
        <div>
          <div className="eyebrow-comment">{title.toLowerCase()}</div>
          <h3 className="ed-section-title">{title}</h3>
          {sub && <p className="ed-section-sub">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="ed-section-body">{children}</div>
    </section>
  );
}

function Field({ label, full, children }) {
  return (
    <label className={"field" + (full ? " full" : "")}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function NutriCell({ label, value, unit }) {
  return (
    <div className="nutri-cell">
      <div className="nutri-val">{value}<span>{unit}</span></div>
      <div className="nutri-label">{label}</div>
    </div>
  );
}

// ---------------- Admin Library (Ingredients / Utensils / Markers) ----------------
function AdminLibraryPage({ kind }) {
  const [q, setQ] = useStateA("");

  if (kind === "markers") {
    const list = Da.METRIC_DEFS.filter(m => !q || m.name.toLowerCase().includes(q.toLowerCase()));
    return (
      <AdminLayout active="markers">
        <div className="admin-toolbar">
          <input className="input" placeholder="Search markers…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, maxWidth: 420 }} />
          <span style={{ flex: 1 }} />
          <span className="pill">{list.length} of {Da.METRIC_DEFS.length}</span>
          <button className="btn primary">+ New marker</button>
        </div>
        <div className="admin-table card flat">
          <div className="atbl-head" style={{ gridTemplateColumns: "2fr 1fr 1fr 1.4fr 1fr" }}>
            <div>Marker</div><div>Category</div><div>Unit</div><div>Normal range</div><div></div>
          </div>
          {list.map(m => (
            <div key={m.id} className="atbl-row" style={{ gridTemplateColumns: "2fr 1fr 1fr 1.4fr 1fr" }}>
              <div className="atbl-cell-recipe">
                <span className="atbl-thumb" style={{ background: "var(--cream-deep)", display: "grid", placeItems: "center", fontFamily: "var(--mono)", color: "var(--ink-muted)", fontSize: 16 }}>~</span>
                <div><div className="atbl-name">{m.name}</div><div className="atbl-tagline">id: {m.id}</div></div>
              </div>
              <div className="atbl-mono">{m.category}</div>
              <div className="atbl-mono">{m.unit}</div>
              <div className="atbl-mono">{m.normal_min ?? "—"}{m.normal_min != null && m.normal_max != null ? "–" : ""}{m.normal_max ?? ""}</div>
              <div className="atbl-actions"><button className="btn ghost sm">Edit →</button></div>
            </div>
          ))}
        </div>
      </AdminLayout>
    );
  }

  const list = (kind === "ingredients" ? Da.INGREDIENTS : Da.UTENSILS)
    .filter(x => !q || x.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <AdminLayout active={kind}>
      <div className="admin-toolbar">
        <input className="input" placeholder={"Search " + kind + "…"} value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, maxWidth: 420 }} />
        <button className="btn ghost sm">Filter: All categories</button>
        <span style={{ flex: 1 }} />
        <span className="pill">{list.length} of {(kind === "ingredients" ? Da.INGREDIENTS : Da.UTENSILS).length}</span>
        <button className="btn primary">+ New {kind === "ingredients" ? "ingredient" : "utensil"}</button>
      </div>

      <div className="lib-grid">
        {list.map(item => (
          <div key={item.id} className="lib-card card lift">
            <div className="lib-thumb">
              <span style={{ fontFamily: "var(--mono)", fontSize: 13, color: "var(--ink-muted)" }}>{item.category}</span>
            </div>
            <div className="lib-body">
              <h4 className="lib-name">{item.name}</h4>
              <div className="lib-meta">
                {kind === "ingredients" ? (
                  <>default unit · <b>{item.default_unit}</b></>
                ) : (
                  <>{item.essential ? "essential" : "optional"}</>
                )}
              </div>
              <div className="lib-foot">
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-faint)" }}>used in {item.usage}</span>
                <button className="btn ghost sm" style={{ padding: "5px 10px", fontSize: 11 }}>Edit</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </AdminLayout>
  );
}

window.MFC_PAGES.AdminRecipesPage = AdminRecipesPage;
window.MFC_PAGES.AdminRecipeEditPage = AdminRecipeEditPage;
window.MFC_PAGES.AdminLibraryPage = AdminLibraryPage;
