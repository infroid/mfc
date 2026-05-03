// Ingredient editor — create or update one library entry. ?id=<slug> or ?new=1.
const { useState, useEffect } = React;

const BLANK = {
  id: "",
  name: "",
  tagline: "",
  category: "Dairy",
  default_unit: "g",
  photo: "",
  show: { nutrition: true, healthFact: true, storage: false, substitutes: false },
  nutrition: { calories: 0, protein: 0, fat: 0, carbs: 0 },
  health_fact: "",
  storage: "",
  substitutes: [],
  ai_filled_at: null,
};

function fromDb(row) {
  if (!row) return BLANK;
  return {
    id: row.id,
    name: row.name || "",
    tagline: row.tagline || "",
    category: row.category || "Dairy",
    default_unit: row.default_unit || "g",
    photo: row.photo || "",
    show: { ...BLANK.show, ...(row.show || {}) },
    nutrition: { ...BLANK.nutrition, ...(row.nutrition || {}) },
    health_fact: row.health_fact || "",
    storage: row.storage || "",
    substitutes: row.substitutes || [],
    ai_filled_at: row.ai_filled_at || null,
  };
}

function toDb(r) {
  return {
    id: r.id,
    name: r.name,
    tagline: r.tagline || null,
    category: r.category || null,
    default_unit: r.default_unit || "g",
    photo: r.photo || null,
    show: r.show,
    nutrition: r.nutrition,
    health_fact: r.health_fact || null,
    storage: r.storage || null,
    substitutes: r.substitutes || [],
  };
}

function fmtAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function IngredientAdminApp() {
  const params = new URLSearchParams(location.search);
  const editId = params.get("id");
  const isNew = !editId;

  const [r, setR] = useState(BLANK);
  const [usage, setUsage] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [savedAgo, setSavedAgo] = useState(null);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const [row, counts] = await Promise.all([
          window.MFC.adminDb.getIngredient(editId),
          window.MFC.adminDb.ingredientUsageCounts(),
        ]);
        if (!row) { setErr(`No ingredient with id "${editId}"`); return; }
        setR(fromDb(row));
        setUsage(counts[editId] || 0);
        setDirty(false);
      } catch (e) { setErr(e.message); }
    })();
  }, [editId, isNew]);

  const update = (patch) => { setR((p) => ({ ...p, ...patch })); setDirty(true); };
  const updateShow = (k, v) => update({ show: { ...r.show, [k]: v } });
  const updateNut = (k, v) => update({ nutrition: { ...r.nutrition, [k]: v } });

  async function onPublish() {
    setErr(null); setBusy(true);
    try {
      let id = r.id;
      if (isNew || !id) {
        id = window.slugify(r.name);
        if (!id) throw new Error("Ingredient needs a name before saving.");
      }
      await window.MFC.adminDb.upsertIngredient(toDb({ ...r, id }));
      setDirty(false); setSavedAgo("just now");
      if (isNew) { location.href = `admin-ingredient.html?id=${encodeURIComponent(id)}`; return; }
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
        <AdminSidebar active="ingredients" />
        <div className="admin-main">
          <AdminTopbar crumb={[{ label: "Ingredients", href: "admin-ingredients.html" }, { label: "Error" }]} />
          <div className="admin-page">
            <div className="form-card" style={{ borderColor: "var(--berry)" }}>
              <div className="form-card-body" style={{ color: "var(--berry)" }}>
                {err} · <a href="admin-ingredients.html" style={{ color: "var(--orange)" }}>Back to ingredients</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <AdminSidebar active="ingredients" />
      <div className="admin-main">
        <AdminTopbar
          crumb={[{ label: "Ingredients", href: "admin-ingredients.html" }, { label: r.name || "Untitled" }]}
          status="live"
          savedAgo={savedAgo}
          isNew={isNew}
          onPublish={onPublish}
        />

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h1>{isNew ? <>New <em>ingredient</em></> : <>Edit <em>ingredient</em></>}</h1>
              <p className="lede">Library entry — {isNew ? "added once, picked by recipes." : `used by ${usage} recipe${usage === 1 ? "" : "s"}.`} Most fields are auto-filled by AI; you only review and toggle what should surface to users.</p>
            </div>
            <div className="admin-page-meta">
              {!isNew && <span><b>id</b> · {r.id}</span>}
              {!isNew && <span><b>{usage}</b> recipe{usage === 1 ? "" : "s"}</span>}
              {r.ai_filled_at && <span style={{ color: "var(--matcha-deep)" }}><b>✦</b> ai-filled {fmtAgo(r.ai_filled_at)}</span>}
            </div>
          </div>

          {r.ai_filled_at && (
            <div className="ai-banner">
              <div className="glyph">✦</div>
              <div className="copy">
                <b>Auto-filled by Claude · {fmtAgo(r.ai_filled_at)}</b>
                <span>Identity, photo, and nutrition were generated. Review the values, toggle which optional fields should appear to users, and publish.</span>
              </div>
            </div>
          )}

          <div className="workbench">
            <div className="workbench-form">
              <FormCard title="Core" scribble="always shown">
                <div className="field-grid">
                  <Field label="Name" required>
                    <input className="input serif" value={r.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Paneer" />
                  </Field>
                  {isNew && r.name && (
                    <div className="field-hint" style={{ fontFamily: "var(--mono)", fontStyle: "normal", fontSize: 11 }}>
                      id will be: <span style={{ color: "var(--orange)" }}>{window.slugify(r.name)}</span>
                    </div>
                  )}
                  <div className="field-grid cols-2">
                    <Field label="Tagline" help="one line">
                      <input className="input" value={r.tagline} onChange={(e) => update({ tagline: e.target.value })} placeholder="fresh, milky, holds shape under heat" />
                    </Field>
                    <Field label="Category">
                      <select className="select" value={r.category} onChange={(e) => update({ category: e.target.value })}>
                        <option>Dairy</option><option>Vegetable</option><option>Fruit</option><option>Grain</option><option>Spice</option><option>Herb</option><option>Protein</option><option>Oil & Fat</option><option>Nut & Seed</option><option>Aromatic</option><option>Seasoning</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Default unit" hint="Pre-filled when a recipe picks this ingredient.">
                    <RadioPills value={r.default_unit} options={["g", "ml", "tsp", "tbsp", "cup", "medium", "large", "whole", "pinch"]} onChange={(v) => update({ default_unit: v })} />
                  </Field>
                  <Field label="Photo" hint="Path under data/ingredient-photos/.">
                    <input className="input mono" value={r.photo} onChange={(e) => update({ photo: e.target.value })} placeholder="data/ingredient-photos/paneer.jpg" />
                  </Field>
                </div>
              </FormCard>

              <SurfaceCard
                title="Nutrition" scribble="per 100g"
                surfaceLabel="recipe & ingredient page"
                show={r.show.nutrition}
                onShowChange={(v) => updateShow("nutrition", v)}
              >
                <div className="nut-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                  <NutCell label="Calories" value={r.nutrition.calories} unit="kcal" onChange={(v) => updateNut("calories", v)} accent />
                  <NutCell label="Protein"  value={r.nutrition.protein}  unit="g"    onChange={(v) => updateNut("protein", v)} />
                  <NutCell label="Fat"      value={r.nutrition.fat}      unit="g"    onChange={(v) => updateNut("fat", v)} />
                  <NutCell label="Carbs"    value={r.nutrition.carbs}    unit="g"    onChange={(v) => updateNut("carbs", v)} />
                </div>
              </SurfaceCard>

              <SurfaceCard
                title="Health fact" scribble="rotates in cooking flow"
                surfaceLabel="recipe page · health rotator"
                show={r.show.healthFact}
                onShowChange={(v) => updateShow("healthFact", v)}
              >
                <Field label="One-liner" help="60–110 chars">
                  <textarea
                    className="textarea"
                    rows={2}
                    value={r.health_fact}
                    onChange={(e) => update({ health_fact: e.target.value })}
                  />
                </Field>
              </SurfaceCard>

              <SurfaceCard
                title="Storage tip"
                surfaceLabel="ingredient page only"
                show={r.show.storage}
                onShowChange={(v) => updateShow("storage", v)}
              >
                <Field label="Where & how long">
                  <input className="input" value={r.storage} onChange={(e) => update({ storage: e.target.value })} placeholder="Refrigerated, submerged in water · 7 days" />
                </Field>
              </SurfaceCard>

              <SurfaceCard
                title="Substitutes"
                surfaceLabel="ingredient page only"
                show={r.show.substitutes}
                onShowChange={(v) => updateShow("substitutes", v)}
              >
                <Field label="Similar ingredients" hint="Press enter to add">
                  <ChipInput
                    color="matcha"
                    tags={r.substitutes}
                    onAdd={(t) => update({ substitutes: [...r.substitutes, t] })}
                    onRemove={(i) => update({ substitutes: r.substitutes.filter((_, k) => k !== i) })}
                    placeholder="tofu, halloumi…"
                  />
                </Field>
              </SurfaceCard>
            </div>

            <div className="workbench-preview">
              <PreviewFrame url={`/i/${r.id || "<new>"}`}>
                <IngredientPreview r={r} usage={usage} />
              </PreviewFrame>
              <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "0 4px", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-muted)" }}>
                <span>↻ Live preview</span>
                <span>·</span>
                <span>What users will see</span>
              </div>
            </div>
          </div>

          <SaveBar dirty={dirty} busy={busy} error={err} onDiscard={onDiscard} onPublish={onPublish} isNew={isNew} />
        </div>
      </div>
    </div>
  );
}

function SurfaceCard({ title, scribble, surfaceLabel, show, onShowChange, children }) {
  return (
    <section className="form-card" style={!show ? { opacity: 0.6 } : {}}>
      <div className="form-card-head">
        <h3>{title}</h3>
        {scribble && <span className="scribble-note">{scribble}</span>}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: show ? "var(--matcha-deep)" : "var(--ink-faint)" }}>
            {show ? `↗ ${surfaceLabel}` : "hidden"}
          </span>
          <Toggle value={show} onChange={onShowChange} />
        </div>
      </div>
      {show && <div className="form-card-body compact">{children}</div>}
      {!show && (
        <div style={{ padding: "14px 24px", background: "var(--cream-soft)", borderTop: "1px dashed var(--rule)", fontSize: 12, color: "var(--ink-muted)", fontStyle: "italic", fontFamily: "var(--serif)" }}>
          Toggle on to include this in the user-facing output.
        </div>
      )}
    </section>
  );
}

function NutCell({ label, value, unit, onChange, accent }) {
  return (
    <div className={"nut-cell" + (accent ? " accent" : "")}>
      <div className="lbl">{label}</div>
      <div className="row">
        <input value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
        <span className="unit">{unit}</span>
      </div>
    </div>
  );
}

function IngredientPreview({ r, usage }) {
  const firstWord = (r.name || "").split(" ")[0];
  const rest = (r.name || "").split(" ").slice(1).join(" ");
  return (
    <div className="pv-ing-card">
      <div className="pv-ing-photo">
        <span className="badge">{r.category}</span>
        <span className="tag">[ {r.photo || "no-photo.jpg"} ]</span>
      </div>
      <div className="pv-ing-body">
        <div className="pv-ing-name">
          {rest ? <><em>{firstWord}</em> {rest}</> : firstWord || "Untitled"}
        </div>
        <div className="pv-ing-tagline">{r.tagline}</div>

        {r.show.nutrition && (
          <div className="pv-nut-strip">
            <div className="cell"><div className="v">{r.nutrition.calories}</div><div className="l">kcal</div></div>
            <div className="cell"><div className="v">{r.nutrition.protein}g</div><div className="l">protein</div></div>
            <div className="cell"><div className="v">{r.nutrition.fat}g</div><div className="l">fat</div></div>
            <div className="cell"><div className="v">{r.nutrition.carbs}g</div><div className="l">carbs</div></div>
          </div>
        )}

        {r.show.healthFact && r.health_fact && (
          <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--matcha-soft)", borderRadius: 10, fontSize: 13, color: "var(--matcha-deep)", fontStyle: "italic", fontFamily: "var(--serif)", lineHeight: 1.45 }}>
            <span style={{ fontFamily: "var(--mono)", fontStyle: "normal", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--matcha-deep)", display: "block", marginBottom: 4, opacity: 0.7 }}>did you know</span>
            {r.health_fact}
          </div>
        )}

        {r.show.storage && r.storage && (
          <div style={{ marginTop: 12, fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)", display: "flex", gap: 8 }}>
            <span style={{ color: "var(--orange)" }}>storage</span>
            <span>{r.storage}</span>
          </div>
        )}

        {r.show.substitutes && r.substitutes.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-muted)", marginBottom: 6 }}>or use</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {r.substitutes.map((s, i) => (
                <span key={i} style={{ padding: "3px 9px", background: "var(--matcha-soft)", color: "var(--matcha-deep)", borderRadius: 999, fontSize: 11 }}>{s}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--rule)", fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-faint)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
          used in {usage} recipe{usage === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<IngredientAdminApp />);
});
