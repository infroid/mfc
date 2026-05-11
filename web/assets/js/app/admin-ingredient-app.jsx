// Ingredient editor — WYSIWYG. Mirrors the chef recipe editor:
// hero card + macros + optional surface cards, all inline-editable
// via edit pills + modals. App-shell layout for mobile parity.
const { useState, useEffect, useRef } = React;

const CATEGORIES = [
  "Dairy", "Vegetable", "Fruit", "Grain", "Spice", "Herb",
  "Protein", "Oil & Fat", "Nut & Seed", "Aromatic", "Seasoning",
];
const ING_UNITS = ["g", "kg", "ml", "l", "teaspoon", "tablespoon"];
const ING_UNIT_ALIASES = { tsp: "teaspoon", tbsp: "tablespoon" };
function ingNormalizeUnit(u) {
  if (!u) return ING_UNITS[0];
  if (ING_UNITS.includes(u)) return u;
  return ING_UNIT_ALIASES[u] || ING_UNITS[0];
}

const BLANK = {
  id: "",
  name: "",
  tagline: "",
  category: "Dairy",
  default_unit: "g",
  photo: "",
  show: { nutrition: true, healthFact: true, storage: false, substitutes: false },
  nutrition: {},
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
    default_unit: ingNormalizeUnit(row.default_unit),
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
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ============================================================
// PRIMITIVES (kept local to avoid coupling with chef edit)
// ============================================================
function CompletionRing({ pct = 0, size = 56, stroke = 6 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const tone = pct >= 80 ? "high" : pct >= 50 ? "mid" : "low";
  return (
    <div className="completion-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="track" cx={size/2} cy={size/2} r={r} style={{ strokeWidth: stroke }} />
        <circle className={"meter " + tone} cx={size/2} cy={size/2} r={r}
          style={{ strokeWidth: stroke }} strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span className="pct" style={{ fontSize: Math.max(9, Math.round(size * 0.30)) + "px" }}>
        {pct === 100 ? "✓" : pct + "%"}
      </span>
    </div>
  );
}

function EditPill({ children = "Edit", onClick, required = false, empty = false, danger = false, style }) {
  let cls = "edit-pill";
  if (required && empty) cls += " required-empty";
  if (danger) cls += " danger";
  return (
    <button type="button" className={cls} onClick={onClick} style={style}>
      <span className="pencil">✎</span>{children}
    </button>
  );
}

function useToast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 1800);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg];
}

function CeModal({ title, onClose, footer, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ce-modal-bd" onClick={onClose}>
      <div className="ce-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ce-modal-head">
          <h3>{title}</h3>
          <button className="ce-modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="ce-modal-body">{children}</div>
        {footer && <div className="ce-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ============================================================
// MODALS
// ============================================================
function IdentityModal({ r, update, slugTaken, isNew, onClose }) {
  return (
    <CeModal title="Identity" onClose={onClose}
      footer={<button className="btn-sm primary" onClick={onClose}>Done</button>}>
      <div className="field-row">
        <label>Name</label>
        <input value={r.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Paneer" autoFocus />
      </div>
      {isNew && r.name && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-muted)", padding: "4px 0 8px" }}>
          id will be: <span style={{ color: "var(--orange)" }}>{window.slugify(r.name)}</span>
        </div>
      )}
      {slugTaken && (
        <div className="slug-warning" style={{ marginBottom: 10 }}>
          An ingredient with the slug <code>{window.slugify(r.name)}</code> already exists. Choose a different name.
        </div>
      )}
      <div className="field-row">
        <label>Tagline</label>
        <input value={r.tagline} onChange={(e) => update({ tagline: e.target.value })} placeholder="fresh, milky, holds shape under heat" />
      </div>
      <div className="field-row">
        <label>Category</label>
        <select value={r.category} onChange={(e) => update({ category: e.target.value })}>
          {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="field-row">
        <label>Default unit</label>
        <select value={r.default_unit} onChange={(e) => update({ default_unit: e.target.value })}>
          {ING_UNITS.map((u) => <option key={u}>{u}</option>)}
          {r.default_unit && !ING_UNITS.includes(r.default_unit) && (
            <option value={r.default_unit}>{r.default_unit} (legacy)</option>
          )}
        </select>
      </div>
      <div className="field-row">
        <label>Photo URL</label>
        <input
          value={r.photo}
          onChange={(e) => update({ photo: e.target.value })}
          placeholder="https://<ref>.supabase.co/storage/v1/object/public/ingredient-images/paneer/image.png"
          style={{ fontFamily: "var(--mono)", fontSize: 13 }}
        />
      </div>
    </CeModal>
  );
}

function SubstitutesModal({ subs, onChange, onClose }) {
  const [draft, setDraft] = useState("");
  function commit() { const v = draft.trim(); if (v && !subs.includes(v)) onChange([...subs, v]); setDraft(""); }
  return (
    <CeModal title="Substitutes" onClose={onClose}
      footer={<button className="btn-sm primary" onClick={onClose}>Done</button>}>
      <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)", marginBottom: 12 }}>
        Similar ingredients a cook can swap in. Press Enter or comma to add.
      </p>
      <div className="ce-tags-row" style={{ marginBottom: 12 }}>
        {subs.map((t, i) => (
          <span key={i} className="ce-tag-chip" style={{ background: "rgba(122,156,90,0.18)", color: "var(--matcha-deep)", border: "1px solid transparent" }}>
            {t} <span style={{ marginLeft: 6, cursor: "pointer", color: "var(--ink-muted)" }}
              onClick={() => onChange(subs.filter((_, k) => k !== i))}>×</span>
          </span>
        ))}
      </div>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
          else if (e.key === "Backspace" && !draft && subs.length) onChange(subs.slice(0, -1));
        }}
        onBlur={commit}
        placeholder="tofu, halloumi…"
        style={{ width: "100%", padding: "10px 14px", border: "1px solid var(--rule)", borderRadius: 8, background: "var(--cream-soft)", outline: "none", fontSize: 14 }}
      />
    </CeModal>
  );
}

// ============================================================
// MAIN
// ============================================================
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
  const [slugTaken, setSlugTaken] = useState(false);
  const [openModal, setOpenModal] = useState(null); // 'identity' | 'subs'
  const [toast, setToast] = useToast();

  // Slug collision check (new mode)
  useEffect(() => {
    if (!isNew) return;
    const wantSlug = window.slugify(r.name);
    if (!wantSlug) { setSlugTaken(false); return; }
    const t = setTimeout(async () => {
      const { data } = await window.MFC.supabase
        .from('ingredients').select('id').eq('id', wantSlug).maybeSingle();
      setSlugTaken(!!data);
    }, 400);
    return () => clearTimeout(t);
  }, [r.name, isNew]);

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
  const updateNut = (k, v) =>
    update({ nutrition: { ...r.nutrition, [k]: v } });

  // Completion checks
  const checks = [
    { label: "Name",      pass: !!(r.name || "").trim(),     required: true },
    { label: "Tagline",   pass: !!(r.tagline || "").trim(),  required: true },
    { label: "Category",  pass: !!(r.category || "").trim(), required: true },
    { label: "Photo",     pass: !!(r.photo || "").trim(),    required: false },
    { label: "Nutrition", pass: (r.nutrition?.calories || 0) > 0, required: false },
    { label: "Health fact", pass: !!(r.health_fact || "").trim(), required: false },
  ];
  const passed = checks.filter(c => c.pass).length;
  const pct = Math.round((passed / checks.length) * 100);
  const missing = checks.filter(c => c.required && !c.pass).map(c => c.label);
  const ready = missing.length === 0;

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
      setToast(isNew ? "✓ created" : "✓ saved");
      if (isNew) { location.href = `ingredient.html?id=${encodeURIComponent(id)}`; return; }
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('23505')) setErr("An ingredient with this id already exists. Choose a different name.");
      else setErr(msg);
    } finally { setBusy(false); }
  }

  function onDiscard() {
    if (!dirty) return;
    if (!confirm("Discard unsaved changes?")) return;
    location.reload();
  }

  if (err && !r.name && !isNew) {
    return (
      <div className="admin-shell admin-app-shell">
        <AdminSidebar active="ingredients" />
        <div className="admin-main">
          <div className="chef-edit">
            <div className="ce-card" style={{ borderColor: "var(--berry)" }}>
              <p style={{ color: "var(--berry)", fontFamily: "var(--mono)" }}>
                {err} · <a href="ingredients.html" style={{ color: "var(--orange)" }}>Back to ingredients</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell admin-app-shell">
      <AdminSidebar active="ingredients" />
      <div className="admin-main">
        <div className="chef-edit">
          {/* Breadcrumb */}
          <div className="ce-breadcrumb">
            <a href="index.html">Admin</a>
            <span className="sep">›</span>
            <a href="ingredients.html">Ingredients</a>
            <span className="sep">›</span>
            <span className="current">{r.name || (isNew ? "New" : (editId || "Untitled"))}</span>
          </div>

          {/* Header */}
          <div className="ce-header">
            <div>
              <div className="ce-eyebrow">{isNew ? "library · new ingredient" : "library · editing"}</div>
              <h1>{isNew ? <><em>New</em> ingredient</> : <><em>Edit</em> {r.name || editId || "ingredient"}</>}</h1>
            </div>
          </div>

          {/* AI banner if applicable */}
          {r.ai_filled_at && (
            <div className="ce-ai-banner">
              <span className="glyph">✦</span>
              <div className="copy">
                <b>Auto-filled by Claude · {fmtAgo(r.ai_filled_at)}</b>
                <span>Identity, photo, and nutrition were generated. Review the values and toggle which optional fields surface.</span>
              </div>
            </div>
          )}

          {/* Publish bar */}
          <div className="publish-bar">
            <CompletionRing pct={pct} />
            <div className="pb-text">
              <b>{ready ? "Ready to publish" : "Needs a few details"}</b>
              <div className="pb-meta">
                {!isNew && <>used by {usage} recipe{usage === 1 ? "" : "s"} · </>}
                {pct}% complete
                {savedAgo && <> · <span className="ok">saved {savedAgo}</span></>}
              </div>
              {missing.length > 0 && (
                <div className="warn-list">
                  {missing.map((m) => <span key={m} className="warn-pill">{m}</span>)}
                </div>
              )}
            </div>
            <div className="pb-actions">
              <button className={"btn-sm primary" + (busy ? " disabled" : "")} disabled={busy} onClick={onPublish}>
                {busy ? "Saving…" : isNew ? "Create →" : "Update →"}
              </button>
            </div>
          </div>

          {/* HERO CARD — split: photo on left, identity on right */}
          <div className="ce-card flush ce-ing-hero">
            <div className="ce-ing-hero-photo">
              {r.photo
                ? <img src={r.photo} alt="" onError={(e) => { e.target.style.display = "none"; }} />
                : (
                  <div className="ce-ing-hero-empty">
                    <div className="glyph">🥕</div>
                    <div className="label">No photo yet</div>
                  </div>
                )}
              <EditPill
                style={{ position: "absolute", bottom: 12, right: 12, background: "rgba(255,252,243,0.94)" }}
                onClick={() => setOpenModal("identity")}
              >{r.photo ? "replace" : "add"} photo</EditPill>
            </div>
            <div className="ce-ing-hero-text">
              <div className="ce-hero-meta">
                <span>{r.category}</span>
                <span className="dot">·</span>
                <span>default <b style={{ color: "var(--ink)" }}>{r.default_unit}</b></span>
                <EditPill onClick={() => setOpenModal("identity")}>identity</EditPill>
                {slugTaken && (
                  <span style={{ color: "var(--berry)", fontFamily: "var(--mono)", fontSize: 10.5 }}>⚠ slug taken</span>
                )}
              </div>
              <input
                className="ce-hero-title-input"
                value={r.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Ingredient name"
              />
              <input
                className="ce-hero-tag-input"
                value={r.tagline}
                onChange={(e) => update({ tagline: e.target.value })}
                placeholder="One-line description"
              />
              <div className="ce-ing-hero-foot">
                {isNew ? (
                  <span>// new entry · id will be generated from name</span>
                ) : (
                  <span>// id <b style={{ color: "var(--ink)" }}>{r.id}</b>{r.ai_filled_at ? <> · ✦ ai-filled {fmtAgo(r.ai_filled_at)}</> : null}</span>
                )}
              </div>
            </div>
          </div>

          {/* MACROS CARD */}
          <div className="ce-card">
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">macros</div>
                <h3 className="ce-card-title">per 100g</h3>
              </div>
              <SurfaceToggle
                label="surface on recipe page"
                value={r.show.nutrition}
                onChange={(v) => updateShow("nutrition", v)}
              />
            </div>
            <div className="ce-nut-grid">
              <NutCell label="Calories" value={r.nutrition?.calories || 0} unit="kcal" accent
                onChange={(v) => updateNut("calories", v)} />
              <NutCell label="Protein" value={r.nutrition?.protein || 0} unit="g"
                onChange={(v) => updateNut("protein", v)} />
              <NutCell label="Fat" value={r.nutrition?.total_fat || 0} unit="g"
                onChange={(v) => updateNut("total_fat", v)} />
              <NutCell label="Carbs" value={r.nutrition?.carbohydrate || 0} unit="g"
                onChange={(v) => updateNut("carbohydrate", v)} />
            </div>
          </div>

          {/* HEALTH FACT CARD */}
          <div className={"ce-card" + (r.show.healthFact ? "" : " ce-card-dim")}>
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">health fact</div>
                <h3 className="ce-card-title">cooking flow rotator</h3>
                <div className="ce-card-sub">60–110 chars · surfaces during guided cook</div>
              </div>
              <SurfaceToggle
                label="surface on recipe page"
                value={r.show.healthFact}
                onChange={(v) => updateShow("healthFact", v)}
              />
            </div>
            {r.show.healthFact ? (
              <textarea
                className="ce-ing-multiline"
                rows={2}
                value={r.health_fact}
                onChange={(e) => update({ health_fact: e.target.value })}
                placeholder="Spinach is rich in iron, but its bioavailability improves dramatically with vitamin C."
              />
            ) : (
              <div className="ce-faint">Toggle on to include this on the recipe page rotator.</div>
            )}
          </div>

          {/* STORAGE CARD */}
          <div className={"ce-card" + (r.show.storage ? "" : " ce-card-dim")}>
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">storage</div>
                <h3 className="ce-card-title">where & how long</h3>
              </div>
              <SurfaceToggle
                label="surface on ingredient page"
                value={r.show.storage}
                onChange={(v) => updateShow("storage", v)}
              />
            </div>
            {r.show.storage ? (
              <input
                className="ce-ing-line"
                value={r.storage}
                onChange={(e) => update({ storage: e.target.value })}
                placeholder="Refrigerated, submerged in water · 7 days"
              />
            ) : (
              <div className="ce-faint">Toggle on to include a storage tip on the ingredient page.</div>
            )}
          </div>

          {/* SUBSTITUTES CARD */}
          <div className={"ce-card" + (r.show.substitutes ? "" : " ce-card-dim")}>
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">substitutes</div>
                <h3 className="ce-card-title">similar ingredients</h3>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {r.show.substitutes && (
                  <EditPill onClick={() => setOpenModal("subs")}>edit</EditPill>
                )}
                <SurfaceToggle
                  label="surface on ingredient page"
                  value={r.show.substitutes}
                  onChange={(v) => updateShow("substitutes", v)}
                />
              </div>
            </div>
            {r.show.substitutes ? (
              r.substitutes.length === 0 ? (
                <div className="ce-empty">No substitutes yet — click "edit" to add.</div>
              ) : (
                <div className="ce-tags-row">
                  {r.substitutes.map((s) => (
                    <span key={s} className="ce-tag-chip" style={{ background: "rgba(122,156,90,0.18)", color: "var(--matcha-deep)", border: "1px solid transparent" }}>{s}</span>
                  ))}
                </div>
              )
            ) : (
              <div className="ce-faint">Toggle on to surface a list of swap-ins on the ingredient page.</div>
            )}
          </div>

          {err && (
            <div className="ce-card" style={{ borderColor: "var(--berry)" }}>
              <p style={{ color: "var(--berry)", fontFamily: "var(--mono)", fontSize: 12 }}>Error: {err}</p>
            </div>
          )}
        </div>

        {/* Sticky bottom save bar */}
        <div className="ce-savebar">
          <div className={"info" + (dirty ? "" : " clean")}>
            <span className="dot" />
            <span>
              {busy ? "Saving…"
                : err ? <span style={{ color: "var(--berry)" }}>Error · see above</span>
                : dirty ? "Unsaved changes"
                : savedAgo ? `All changes saved · ${savedAgo}`
                : "All changes saved"}
            </span>
          </div>
          <div className="actions">
            <button className="btn-sm ghost" onClick={onDiscard} disabled={busy || !dirty}>Discard</button>
            <button className="btn-sm primary" onClick={onPublish} disabled={busy || (!dirty && !isNew)}>
              {busy ? "Saving…" : isNew ? "Create →" : "Update →"}
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {openModal === "identity" && (
        <IdentityModal r={r} update={update} slugTaken={slugTaken} isNew={isNew} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "subs" && (
        <SubstitutesModal subs={r.substitutes} onChange={(s) => update({ substitutes: s })} onClose={() => setOpenModal(null)} />
      )}

      {toast && <div className="ce-toast">{toast}</div>}
    </div>
  );
}

// Macro cell — integer input, mono unit suffix, design tokens.
function NutCell({ label, value, unit, onChange, accent }) {
  return (
    <div className={"ce-nut-cell" + (accent ? " accent" : "")}>
      <div className="lbl">{label}</div>
      <div className="row">
        <input
          type="number"
          inputMode="numeric"
          step="1"
          min="0"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "") { onChange(0); return; }
            const n = parseInt(v, 10);
            if (!Number.isFinite(n) || n < 0) return;
            onChange(n);
          }}
        />
        <span className="unit">{unit}</span>
      </div>
    </div>
  );
}

// Slim toggle + label, used in card heads
function SurfaceToggle({ label, value, onChange }) {
  return (
    <div className="ce-surface-toggle">
      <span className={"ce-surface-label " + (value ? "on" : "off")}>
        {value ? "↗ " + label : "hidden"}
      </span>
      <button
        type="button"
        className={"ce-toggle" + (value ? " on" : "")}
        onClick={() => onChange(!value)}
        aria-label={value ? "Hide on user-facing surfaces" : "Show on user-facing surfaces"}
      />
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<IngredientAdminApp />);
});
