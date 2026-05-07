/* INGREDIENTS — list + FDC-density detail page.
   The detail handles 50+ rows of nutrition without breaking. */

function AdminIngredientsPage() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const cats = ["all", ...Array.from(new Set(window.INGREDIENTS.map(i => i.category)))];
  const filtered = window.INGREDIENTS.filter(i => {
    if (cat !== "all" && i.category !== cat) return false;
    if (query && !i.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <AdminShell active="ingredients">
      <PageHeader
        eyebrow="library"
        title='<em>Ingredients</em>'
        sub="Backed by USDA FoodData Central. Recipes pick from this list."
        actions={<a className="btn btn-orange" href="#admin-ingredient">+ New ingredient</a>}
      />

      <Toolbar>
        <SearchInput value={query} onChange={setQuery} placeholder="search ingredients…" />
        <div className="toolbar-divider" />
        <select className="cuisine-select" value={cat} onChange={e => setCat(e.target.value)}>
          {cats.map(c => <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <span className="toolbar-stat">{filtered.length} of {window.INGREDIENTS.length}</span>
      </Toolbar>

      <div className="list">
        <div className="list-row head" style={{ gridTemplateColumns: "60px 1fr 130px 200px 90px 50px" }}>
          <span></span><span>Ingredient</span><span>Category</span><span>Allergens</span>
          <span style={{ textAlign: "right" }}>Used in</span><span></span>
        </div>
        {filtered.map(i => (
          <a key={i.id} href="#admin-ingredient" className="list-row" style={{ gridTemplateColumns: "60px 1fr 130px 200px 90px 50px", textDecoration: "none" }}>
            <ImgPh label={i.emoji} ratio="1/1" style={{ width: 44, height: 44, borderRadius: 8 }} />
            <div>
              <div className="list-name">{i.name}</div>
              <div className="list-sub">FDC linked</div>
            </div>
            <span><TagChip>{i.category}</TagChip></span>
            <span>
              {i.allergens.length === 0
                ? <span className="muted mono">none</span>
                : i.allergens.map(a => <TagChip key={a} tone="warn">{a}</TagChip>)}
            </span>
            <span className="mono" style={{ textAlign: "right", color: "var(--ink-muted)" }}>{i.usage} recipes</span>
            <span style={{ textAlign: "right", color: "var(--ink-faint)" }}>→</span>
          </a>
        ))}
      </div>
    </AdminShell>
  );
}

function MacroDonut({ macros }) {
  const total = macros.protein * 4 + macros.fat * 9 + macros.carbs * 4;
  const segs = [
    { label: "Protein", value: macros.protein * 4 / total, color: "#7A9C5A" },
    { label: "Fat",     value: macros.fat * 9 / total,     color: "#FF6D2E" },
    { label: "Carbs",   value: macros.carbs * 4 / total,   color: "#F4D67A" },
  ];
  const r = 60, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="macro-donut">
      <svg viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={r} stroke="var(--rule)" strokeWidth="14" fill="none" />
        {segs.map((s, i) => {
          const len = c * s.value;
          const off = c * acc;
          acc += s.value;
          return (
            <circle key={i} cx="80" cy="80" r={r}
              stroke={s.color} strokeWidth="14" fill="none"
              strokeDasharray={`${len} ${c}`}
              strokeDashoffset={-off}
              strokeLinecap="butt" />
          );
        })}
      </svg>
      <div className="label">
        <div>
          <b>23</b>
          <div className="u">kcal / 100g</div>
        </div>
      </div>
    </div>
  );
}

function NutritionGroup({ group }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div className="card-eyebrow" style={{ marginBottom: 10 }}>{group.name}</div>
      <div className="nut-grid">
        {group.rows.map(([name, val, unit, dv, flag]) => (
          <div key={name} className={"nut-cell " + (flag === "high" ? "high" : flag === "warn" ? "warn" : "")}>
            <div className="name">
              <span>{name}</span>
              <span className="unit">{unit}</span>
            </div>
            <div className="val">{val}</div>
            {dv != null && (
              <>
                <div className="dv">{dv}% DV{flag === "warn" ? " · over upper limit" : flag === "high" ? " · excellent source" : ""}</div>
                <div className="dv-bar">
                  <span
                    className={flag === "warn" ? "over" : ""}
                    style={{ width: Math.min(100, dv) + "%" }} />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AdminIngredientPage() {
  const data = window.SPINACH_NUTRITION;
  const [tab, setTab] = useState("All");
  const tabs = ["All", ...data.groups.map(g => g.name)];
  const visibleGroups = tab === "All" ? data.groups : data.groups.filter(g => g.name === tab);
  const [toast, setToast] = useToast();

  return (
    <AdminShell active="ingredients">
      <PageHeader
        breadcrumb={[
          { label: "admin", href: "#admin" },
          { label: "ingredients", href: "#admin-ingredients" },
          { label: "spinach, raw" },
        ]}
        eyebrow="editing — wysiwyg"
        title='<em>Spinach</em>, raw'
        actions={<>
          <button className="btn btn-ghost btn-sm">Re-pull from FDC</button>
          <button className="btn btn-orange btn-sm" onClick={() => setToast("✓ saved")}>Save</button>
        </>}
      />

      <PublishBar pct={100} missing={[]} status="published" label="Ingredient" onPublish={() => setToast("✓ updated")} />

      {/* HERO */}
      <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
        <div className="resp-2col" style={{ gridTemplateColumns: "260px 1fr", gap: 0, alignItems: "stretch" }}>
          <div style={{ borderRight: "1px solid var(--rule)", padding: 20 }}>
            <ImgPh label="🥬 ingredient" ratio="1/1" style={{ marginBottom: 12 }} />
            <EditPill onClick={() => setToast("replace photo")}>replace photo</EditPill>
          </div>
          <div style={{ padding: 24 }}>
            <div className="card-eyebrow" style={{ marginBottom: 6 }}>Vegetable · leafy green
              <EditPill onClick={() => setToast("category picker")}>category</EditPill>
            </div>
            <h2 style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 36, lineHeight: 1.05 }}>
              Spinach, raw
              <EditPill onClick={() => setToast("inline title")}>name</EditPill>
            </h2>
            <p style={{ color: "var(--ink-soft)", marginTop: 6, fontSize: 15.5 }}>
              An iron-rich leafy green with significant vitamin K, folate, and vitamin A.
              <EditPill onClick={() => setToast("inline description")}>desc</EditPill>
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 14 }}>
              <TagChip tone="veg">vegetarian</TagChip>
              <TagChip tone="veg">vegan</TagChip>
              <TagChip tone="veg">gluten-free</TagChip>
              <TagChip tone="veg">iron-rich</TagChip>
              <TagChip>low-calorie</TagChip>
              <EditPill onClick={() => setToast("tag editor")}>edit tags</EditPill>
            </div>

            <div style={{ marginTop: 18, padding: 12, background: "var(--cream-soft)", borderRadius: 8, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>
              📊 {data.source} · basis: {data.basis}
              <EditPill onClick={() => setToast("re-pull from FDC by ID")}>relink</EditPill>
            </div>
          </div>
        </div>
      </div>

      {/* MACRO + LIST */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head">
          <div>
            <div className="card-eyebrow">macros at a glance</div>
            <h3 className="card-title">per {data.basis}</h3>
          </div>
          <span className="mono" style={{ color: "var(--ink-muted)" }}>%DV based on 2,000 kcal diet</span>
        </div>
        <div className="resp-2col" style={{ gridTemplateColumns: "200px 1fr", gap: 24, alignItems: "center" }}>
          <div>
            <MacroDonut macros={data.macros} />
            <div className="legend">
              <span className="legend-item"><span className="sw" style={{ background: "#7A9C5A" }} />Protein</span>
              <span className="legend-item"><span className="sw" style={{ background: "#FF6D2E" }} />Fat</span>
              <span className="legend-item"><span className="sw" style={{ background: "#F4D67A" }} />Carbs</span>
            </div>
          </div>
          <div className="nut-grid" style={{ alignSelf: "stretch" }}>
            <div className="nut-cell essential"><div className="name">Protein <span className="unit">g</span></div><div className="val">{data.macros.protein}</div></div>
            <div className="nut-cell essential"><div className="name">Fat <span className="unit">g</span></div><div className="val">{data.macros.fat}</div></div>
            <div className="nut-cell essential"><div className="name">Carbs <span className="unit">g</span></div><div className="val">{data.macros.carbs}</div></div>
            <div className="nut-cell essential"><div className="name">Fiber <span className="unit">g</span></div><div className="val">{data.macros.fiber}</div></div>
            <div className="nut-cell essential"><div className="name">Sugars <span className="unit">g</span></div><div className="val">{data.macros.sugars}</div></div>
            <div className="nut-cell essential"><div className="name">Water <span className="unit">g</span></div><div className="val">{data.macros.water}</div></div>
          </div>
        </div>
      </div>

      {/* DEEP NUTRITION (handles 50+ rows) */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-eyebrow">full nutrition</div>
            <h3 className="card-title">FDC complete</h3>
          </div>
          <EditPill onClick={() => setToast("FDC re-pull")}>re-pull</EditPill>
        </div>

        <div className="nut-tabs">
          {tabs.map(t => (
            <button key={t} className={"nut-tab " + (t === tab ? "active" : "")} onClick={() => setTab(t)}>
              {t}
              {t !== "All" && (
                <span style={{ marginLeft: 6, color: "var(--ink-faint)" }}>
                  {data.groups.find(g => g.name === t).rows.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {visibleGroups.map(g => <NutritionGroup key={g.name} group={g} />)}
      </div>

      <div className="spacer" />
      {toast && <div className="toast">{toast}</div>}
      <div className="wysiwyg-flag">
        <span className="pulse" />
        WYSIWYG editing — what you see is what's published
      </div>
    </AdminShell>
  );
}

window.AdminIngredientsPage = AdminIngredientsPage;
window.AdminIngredientPage = AdminIngredientPage;
