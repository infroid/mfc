// Chef recipe editor — WYSIWYG. Renders cards that mirror the public recipe
// page; each card is inline-editable. Loads ?id=<slug> for edit, or no id for
// a blank draft. Library pickers (ingredients/utensils) read from the public
// catalog. Save writes to recipes + child tables under chef/admin RLS.
const { useState, useEffect, useMemo, useRef } = React;

const CUISINES = ["North Indian","South Indian","Italian","Mexican","Thai","Japanese","Mediterranean","Other"];
const UNITS = ["g", "kg", "ml", "l", "teaspoon", "tablespoon"];

const UNIT_ALIASES = { tsp: "teaspoon", tbsp: "tablespoon" };
function normalizeUnit(u) {
  if (!u) return UNITS[0];
  if (UNITS.includes(u)) return u;
  return UNIT_ALIASES[u] || UNITS[0];
}

const BLANK = {
  id: "",
  name: "",
  short_tagline: "",
  tagline: "",
  cuisine: "North Indian",
  difficulty: "Easy",
  servings: 4,
  total_minutes: 30,
  hero_image: "",
  meal_types: [],
  steps: [],
  ingredients: [], // { ingredient_id, group_name, amount, unit }
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
      media_src: s.media_src,
    }));
  const utensils = (row.recipe_utensils || [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((u) => ({ utensil_id: u.utensil_id, essential: !!u.essential }));
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
    difficulty: row.difficulty,
    servings: row.servings,
    total_minutes: row.total_minutes,
    hero_image: row.media?.hero?.src || "",
    // Stash the full media blob so we can preserve other keys (alt, fit, etc.)
    // when the chef saves; the editor only mutates hero.src.
    media_full: row.media || {},
    created_by: row.created_by || null,
    meal_types: row.meal_types || [],
    steps, ingredients, utensils, tags, health,
  };
}

function toDb(r) {
  return {
    id: r.id,
    recipe: {
      name: r.name,
      tagline: r.tagline || null,
      short_tagline: r.short_tagline || null,
      cuisine: r.cuisine,
      difficulty: r.difficulty,
      servings: parseInt(r.servings, 10) || 0,
      total_minutes: parseInt(r.total_minutes, 10) || 0,
      // Hero URL lives canonically on media.hero.src (single source of truth
      // since the schema migration that dropped media.image). Preserve any
      // other pre-existing media keys (emoji, alt, fit) by spreading the
      // full blob the row was loaded with.
      media: (() => {
        const prev = r.media_full || {};
        const url = r.hero_image || null;
        return {
          ...prev,
          hero: { ...(prev.hero || {}), src: url },
        };
      })(),
      meal_types: r.meal_types || [],
    },
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
      media_src: s.media_src || null,
    })),
    utensils: r.utensils.map((u) => ({ utensil_id: u.utensil_id, essential: !!u.essential })),
    tags: r.tags,
    health: r.health.filter((h) => (h || "").trim()),
  };
}

// ============================================================
// PRIMITIVES
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

// Shared modal scaffold
function CeModal({ title, onClose, footer, wide, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ce-modal-bd" onClick={onClose}>
      <div className={"ce-modal" + (wide ? " wide" : "")} onClick={(e) => e.stopPropagation()}>
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
// HERO IMAGE CONTROL (preserved)
// ============================================================
function HeroImageControl({ recipeId, value, onChange, onUploaded }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const inputRef = useRef(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!recipeId) {
      setErr("Save the recipe first (needs an id) before uploading.");
      e.target.value = ""; return;
    }
    setBusy(true); setErr(null);
    try {
      const url = await window.MFC.imageUpload.upload(file, {
        recipeId, filename: "hero.jpg", kind: "hero",
      });
      const v = `${url}?v=${Date.now()}`;
      onChange(v);
      onUploaded?.();
    } catch (x) { setErr(x?.message || String(x)); }
    finally     { setBusy(false); e.target.value = ""; }
  }

  async function removeHero() {
    if (!value || !recipeId) return;
    if (!confirm("Remove hero image? This deletes hero.jpg from Storage.")) return;
    setBusy(true); setErr(null);
    try {
      await window.MFC.imageUpload.remove([`${recipeId}/hero.jpg`]);
      onChange(null);
    } catch (x) { setErr(x?.message || String(x)); }
    finally     { setBusy(false); }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={onFile}
      />
      {value ? (
        <>
          <img src={value} alt="hero" />
          <EditPill style={{ position: "absolute", top: 12, right: 12, background: "rgba(255,252,243,0.94)" }}
            onClick={() => inputRef.current?.click()}>
            {busy ? "Uploading…" : "Replace"}
          </EditPill>
          <EditPill danger style={{ position: "absolute", top: 12, right: 90, background: "rgba(255,252,243,0.94)" }}
            onClick={removeHero}>Remove</EditPill>
        </>
      ) : (
        <div className="ce-hero-empty">
          <div className="glyph">🖼</div>
          <div className="label">No hero image yet</div>
          <button type="button" className="btn-sm primary" onClick={() => inputRef.current?.click()} disabled={busy || !recipeId}>
            {busy ? "Uploading…" : recipeId ? "Upload hero image" : "Save first to enable upload"}
          </button>
          {err && <div style={{ color: "var(--berry)", fontSize: 11, fontFamily: "var(--mono)" }}>{err}</div>}
        </div>
      )}
    </>
  );
}

// ============================================================
// STEP IMAGE CONTROL (preserved, used inside step-extras)
// ============================================================
function StepImageControl({ recipeId, sortOrder, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);
  const inputRef = useRef(null);

  async function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!recipeId) { setErr("Save first."); e.target.value = ""; return; }
    setBusy(true); setErr(null);
    try {
      const url = await window.MFC.imageUpload.upload(file, {
        recipeId, filename: `step-${sortOrder}.jpg`, kind: "step",
      });
      onChange(`${url}?v=${Date.now()}`);
    } catch (x) { setErr(x?.message || String(x)); }
    finally     { setBusy(false); e.target.value = ""; }
  }

  async function removeImg() {
    if (!value || !recipeId) return;
    if (!confirm(`Remove image for step ${sortOrder}?`)) return;
    setBusy(true); setErr(null);
    try {
      await window.MFC.imageUpload.remove([`${recipeId}/step-${sortOrder}.jpg`]);
      onChange(null);
    } catch (x) { setErr(x?.message || String(x)); }
    finally     { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }} onChange={onFile} />
      {value ? (
        <img src={value} alt={`step ${sortOrder}`} style={{ width: 70, height: 50, objectFit: "cover", borderRadius: 6, border: "1px solid var(--rule)" }} />
      ) : (
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-faint)", letterSpacing: "0.06em", textTransform: "uppercase" }}>no img</span>
      )}
      <button type="button" className="btn-sm" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? "…" : value ? "Replace" : "Upload"}
      </button>
      {value && <button type="button" className="btn-sm danger" onClick={removeImg} disabled={busy}>Remove</button>}
      {err && <span style={{ fontSize: 11, color: "var(--berry)" }}>{err}</span>}
    </div>
  );
}

// ============================================================
// META MODAL — cuisine, difficulty, time, servings, meal types
// ============================================================
function MetaModal({ r, update, slugTaken, isNew, onClose }) {
  return (
    <CeModal title="Recipe details" onClose={onClose}
      footer={<button className="btn-sm primary" onClick={onClose}>Done</button>}>
      <div className="field-row">
        <label>Name</label>
        <input value={r.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Paneer Butter Masala" autoFocus />
      </div>
      {isNew && r.name && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-muted)", padding: "4px 0 8px" }}>
          id will be: <span style={{ color: "var(--orange)" }}>{window.slugify(r.name)}</span>
        </div>
      )}
      {slugTaken && (
        <div className="slug-warning" style={{ marginBottom: 10 }}>
          A recipe with the slug <code>{window.slugify(r.name)}</code> already exists. Choose a different name.
        </div>
      )}
      <div className="field-row">
        <label>Short tagline</label>
        <input value={r.short_tagline} onChange={(e) => update({ short_tagline: e.target.value })} placeholder="creamy · tomato · 35 min" />
      </div>
      <div className="field-row">
        <label>Listing tagline</label>
        <input value={r.tagline} onChange={(e) => update({ tagline: e.target.value })} placeholder="One short, evocative line" />
      </div>
      <div className="field-row">
        <label>Cuisine</label>
        <select value={r.cuisine} onChange={(e) => update({ cuisine: e.target.value })}>
          {CUISINES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="field-row">
        <label>Difficulty</label>
        <select value={r.difficulty} onChange={(e) => update({ difficulty: e.target.value })}>
          <option>Easy</option><option>Medium</option><option>Hard</option>
        </select>
      </div>
      <div className="field-row">
        <label>Total time</label>
        <input type="number" min="0" value={r.total_minutes} onChange={(e) => update({ total_minutes: e.target.value })} />
      </div>
      <div className="field-row">
        <label>Servings</label>
        <input type="number" min="1" value={r.servings} onChange={(e) => update({ servings: e.target.value })} />
      </div>
      <div className="field-row">
        <label>Meal types</label>
        <input
          value={(r.meal_types || []).join(", ")}
          onChange={(e) => update({ meal_types: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          placeholder="lunch, dinner"
        />
      </div>
    </CeModal>
  );
}

// ============================================================
// LIBRARY PICKER MODAL
// ============================================================
function PickerModal({ kind, library, picked, onPick, onClose, manageHref, manageLabel }) {
  const [q, setQ] = useState("");
  const idKey = kind === "ing" ? "ingredient_id" : "utensil_id";
  const isPicked = (id) => picked.some((p) => p[idKey] === id);
  const filtered = useMemo(() => {
    const qq = q.toLowerCase().trim();
    return library.filter((x) => !qq || x.name.toLowerCase().includes(qq) || (x.category || "").toLowerCase().includes(qq));
  }, [q, library]);

  return (
    <CeModal title={kind === "ing" ? "Add ingredient" : "Add utensil"} onClose={onClose}>
      <div className="ce-picker-search">
        <span className="glass">⌕</span>
        <input
          autoFocus
          placeholder={`Search ${kind === "ing" ? "ingredients" : "utensils"} library…`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="count">{filtered.length} of {library.length}</span>
      </div>

      <div className="ce-picker-list">
        {library.length === 0 ? (
          <div style={{ padding: "24px 8px", textAlign: "center", color: "var(--ink-muted)" }}>
            <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17, marginBottom: 6 }}>The library is empty</div>
            <div style={{ fontSize: 12 }}>Add some {kind === "ing" ? "ingredients" : "utensils"} first. <a href={manageHref} style={{ color: "var(--orange)", textDecoration: "underline" }}>{manageLabel}</a></div>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "24px 8px", textAlign: "center", color: "var(--ink-muted)" }}>
            <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17, marginBottom: 6 }}>Nothing matches "{q}"</div>
            <div style={{ fontSize: 12 }}>Items can only be added from the library. <a href={manageHref} style={{ color: "var(--orange)", textDecoration: "underline" }}>{manageLabel}</a></div>
          </div>
        ) : filtered.map((item) => {
          const used = isPicked(item.id);
          return (
            <div key={item.id} className={"ce-picker-row" + (used ? " disabled" : "")}
              onClick={() => !used && onPick(item)}>
              <div className={"thumb " + (kind === "ing" ? "matcha" : "cream")} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="name">{item.name}</div>
                <div className="cat">{item.category || "—"}</div>
              </div>
              <span className={"pill " + (used ? "added" : "add")}>{used ? "✓ added" : "+ add"}</span>
            </div>
          );
        })}
      </div>

      <div className="ce-picker-foot">
        Library only · <a href={manageHref}>{manageLabel} →</a>
      </div>
    </CeModal>
  );
}

// ============================================================
// TAGS MODAL
// ============================================================
function TagsModal({ tags, onChange, onClose }) {
  const [draft, setDraft] = useState("");
  function commit() { const v = draft.trim(); if (v && !tags.includes(v)) { onChange([...tags, v]); } setDraft(""); }
  return (
    <CeModal title="Tags" onClose={onClose}
      footer={<button className="btn-sm primary" onClick={onClose}>Done</button>}>
      <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)", marginBottom: 12 }}>
        Used by search and recommendations. Press Enter or comma to add.
      </p>
      <div className="ce-tags-row" style={{ marginBottom: 12 }}>
        {tags.map((t, i) => (
          <span key={i} className="ce-tag-chip">
            {t} <span style={{ marginLeft: 6, cursor: "pointer", color: "var(--ink-muted)" }}
              onClick={() => onChange(tags.filter((_, k) => k !== i))}>×</span>
          </span>
        ))}
      </div>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
          else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={commit}
        placeholder="Add tag…"
        style={{ width: "100%", padding: "10px 14px", border: "1px solid var(--rule)", borderRadius: 8, background: "var(--cream-soft)", outline: "none", fontSize: 14 }}
      />
    </CeModal>
  );
}

// ============================================================
// UTENSIL DETAIL MODAL (matches the design's read-only view)
// ============================================================
function UtensilDetailModal({ utensil, picked, onToggleEssential, onClose }) {
  const [buyLinks, setBuyLinks] = useState(null);
  useEffect(() => {
    if (!utensil?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await window.MFC.supabase
          .from("utensil_buy_links")
          .select("store,url,price,affiliate_tag,sort_order")
          .eq("utensil_id", utensil.id)
          .order("sort_order", { ascending: true });
        if (!cancelled) setBuyLinks(data || []);
      } catch { if (!cancelled) setBuyLinks([]); }
    })();
    return () => { cancelled = true; };
  }, [utensil?.id]);

  if (!utensil) return null;
  const u = utensil;
  const specs = u.specs || {};
  const photo = u.photo;
  const buy = (buyLinks || []).filter((b) => b && b.url);

  return (
    <div className="ce-modal-bd" onClick={onClose}>
      <div className="ce-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ce-ut-hero">
          <span className="ce-ut-cat-pill">{u.category || "tool"}</span>
          {photo ? <img src={photo} alt="" /> : <span className="glyph">🛠</span>}
        </div>
        <button className="ce-modal-close" style={{ position: "absolute", top: 12, right: 12, zIndex: 2 }}
          onClick={onClose} aria-label="Close">×</button>
        <div className="ce-ut-detail">
          <h3>{u.name}</h3>
          {u.tagline && <p className="ce-ut-tag">"{u.tagline}"</p>}
          {(specs.material || specs.size || specs.weight) && (
            <div className="ce-ut-specs">
              {specs.material && <div className="ce-ut-spec"><span className="lbl">Material</span><span className="val">{specs.material}</span></div>}
              {specs.size     && <div className="ce-ut-spec"><span className="lbl">Size</span><span className="val">{specs.size}</span></div>}
              {specs.weight   && <div className="ce-ut-spec"><span className="lbl">Weight</span><span className="val">{specs.weight}</span></div>}
            </div>
          )}
          {u.care_tip && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>// care</div>
              <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 15, color: "var(--ink-soft)", lineHeight: 1.4 }}>{u.care_tip}</p>
            </div>
          )}
          {buy.length > 0 && (
            <div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>// where to buy</div>
              <div>
                {buy.map((b, i) => (
                  <a key={i} href={b.url} target="_blank" rel="noopener" className="ce-ut-buy-link">
                    <span className="name">{b.store || "Buy"}</span>
                    <span className="url">{(b.url || "").replace(/^https?:\/\//, "").split("/")[0]}</span>
                    {b.price && <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)" }}>{b.price}</span>}
                    <span className="arrow">↗</span>
                  </a>
                ))}
              </div>
            </div>
          )}
          {picked && (
            <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--cream-soft)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>
                Marked as <b style={{ color: "var(--ink)" }}>{picked.essential ? "essential" : "nice to have"}</b>
              </span>
              <button className="btn-sm" onClick={onToggleEssential}>
                Toggle to {picked.essential ? "nice to have" : "essential"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MAIN
// ============================================================
function ChefRecipeApp({ user }) {
  const params = new URLSearchParams(location.search);
  const editId = params.get("id");
  const isNew = !editId;

  const [r, setR] = useState(BLANK);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [savedAgo, setSavedAgo] = useState(null);
  const [toast, setToast] = useToast();

  const [ingLib, setIngLib] = useState([]);
  const [utLib, setUtLib]   = useState([]);
  const [slugTaken, setSlugTaken] = useState(false);

  const [openModal, setOpenModal] = useState(null); // 'meta' | 'ing' | 'ut' | 'tags' | 'health'
  const [openUtensil, setOpenUtensil] = useState(null);
  const [openStepIdx, setOpenStepIdx] = useState(null);

  // Slug collision check
  useEffect(() => {
    if (!isNew) return;
    const wantSlug = window.slugify(r.name);
    if (!wantSlug) { setSlugTaken(false); return; }
    const t = setTimeout(async () => {
      const { data } = await window.MFC.supabase
        .from('recipes').select('id').eq('id', wantSlug).maybeSingle();
      setSlugTaken(!!data);
    }, 400);
    return () => clearTimeout(t);
  }, [r.name, isNew]);

  // Load libraries
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

  // Load recipe (edit mode)
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
    update({ ingredients: [...r.ingredients, { ingredient_id: lib.id, amount: "", unit: normalizeUnit(lib.default_unit) }] });
  };

  const updateUt = (i, patch) => update({ utensils: r.utensils.map((s, k) => k === i ? { ...s, ...patch } : s) });
  const removeUt = (i) => update({ utensils: r.utensils.filter((_, k) => k !== i) });
  const addUtFromLib = (lib) => {
    if (r.utensils.some((x) => x.utensil_id === lib.id)) return;
    update({ utensils: [...r.utensils, { utensil_id: lib.id, essential: true }] });
  };

  // Completion checks
  const checks = [
    { key: "name",        label: "Title",          pass: !!(r.name || "").trim(),       required: true },
    { key: "short_tag",   label: "Short tagline",  pass: !!(r.short_tagline || "").trim(), required: true },
    { key: "hero",        label: "Hero image",     pass: !!r.hero_image,                required: true },
    { key: "ingredients", label: "Ingredients",    pass: r.ingredients.length >= 3,     required: true },
    { key: "steps",       label: "Steps",          pass: r.steps.length >= 3,           required: true },
    { key: "tags",        label: "Tags",           pass: r.tags.length > 0,             required: false },
    { key: "utensils",    label: "Utensils",       pass: r.utensils.length > 0,         required: false },
    { key: "health",      label: "Health facts",   pass: r.health.filter(h => (h||"").trim()).length > 0, required: false },
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
        if (!id) throw new Error("Recipe needs a name before saving.");
      }
      const payload = toDb({ ...r, id });
      if (isNew) {
        await window.MFC.adminDb.createOwnedRecipe(payload, user.id);
      } else {
        await window.MFC.adminDb.saveRecipe(payload);
      }
      setDirty(false);
      setSavedAgo("just now");
      setToast(isNew ? "✓ published" : "✓ saved");
      if (isNew) { location.href = `recipe.html?id=${encodeURIComponent(id)}`; return; }
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('23505')) setErr("A recipe with this id already exists. Choose a different name.");
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
      <div className="admin-shell admin-app-shell chef-edit-shell">
        <ChefSidebar active="recipes" role={user.role} />
        <div className="admin-main">
          <div className="chef-edit">
            <div className="ce-card" style={{ borderColor: "var(--berry)" }}>
              <p style={{ color: "var(--berry)", fontFamily: "var(--mono)" }}>
                {err} · <a href="recipes.html" style={{ color: "var(--orange)" }}>Back to recipes</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell admin-app-shell chef-edit-shell">
      <ChefSidebar active="recipes" role={user.role} />
      <div className="admin-main">
        <div className="chef-edit">
          {/* Breadcrumb + header */}
          <div className="ce-breadcrumb">
            <a href="recipes.html">Chef</a>
            <span className="sep">›</span>
            <a href="recipes.html">Recipes</a>
            <span className="sep">›</span>
            <span className="current">{r.name || (isNew ? "New" : (editId || "Untitled"))}</span>
          </div>
          <div className="ce-header">
            <div>
              <div className="ce-eyebrow">{isNew ? "chef · new recipe" : "chef · editing"}</div>
              <h1>{isNew ? <><em>New</em> recipe</> : <><em>Edit</em> {r.name || editId || "recipe"}</>}</h1>
            </div>
          </div>

          {/* Publish bar */}
          <div className="publish-bar">
            <CompletionRing pct={pct} />
            <div className="pb-text">
              <b>{ready ? "Ready to publish" : "Needs a few details"}</b>
              <div className="pb-meta">
                status: <span className={ready ? "ok" : ""}>{isNew ? "draft" : "live"}</span> · {pct}% complete
                {savedAgo && <> · <span className="ok">saved {savedAgo}</span></>}
              </div>
              {missing.length > 0 && (
                <div className="warn-list">
                  {missing.map((m) => <span key={m} className="warn-pill">{m}</span>)}
                </div>
              )}
            </div>
            <div className="pb-actions">
              {!isNew && (
                <a className="btn-sm ghost" href={`../recipe.html?id=${encodeURIComponent(r.id)}`} target="_blank" rel="noopener">Preview ↗</a>
              )}
              <button
                className={"btn-sm primary" + (busy ? " disabled" : "")}
                disabled={busy}
                onClick={onPublish}
              >
                {busy ? "Saving…" : isNew ? "Publish →" : "Update →"}
              </button>
            </div>
          </div>

          {/* HERO CARD */}
          <div className="ce-card flush ce-hero">
            <div className="ce-hero-img-wrap">
              <HeroImageControl
                recipeId={r.id || ""}
                value={r.hero_image || null}
                onChange={(url) => update({ hero_image: url || "" })}
              />
            </div>
            <div className="ce-hero-text">
              <div className="ce-hero-meta">
                <span>{r.cuisine}</span>
                <span className="dot">·</span>
                <span>{r.total_minutes} min</span>
                <span className="dot">·</span>
                <span>{r.difficulty}</span>
                <span className="dot">·</span>
                <span>serves {r.servings}</span>
                <EditPill onClick={() => setOpenModal("meta")}>meta</EditPill>
                {slugTaken && (
                  <span style={{ color: "var(--berry)", fontFamily: "var(--mono)", fontSize: 10.5 }}>⚠ slug taken</span>
                )}
              </div>
              <input
                className="ce-hero-title-input"
                value={r.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Recipe title"
              />
              <input
                className="ce-hero-tag-input"
                value={r.short_tagline}
                onChange={(e) => update({ short_tagline: e.target.value })}
                placeholder="Short tagline — appears on the recipe page"
              />
              {(r.created_by || isNew) && (
                <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-faint)", letterSpacing: "0.06em" }}>
                  // created by · {r.created_by === user.id ? "you" : (r.created_by ? r.created_by.slice(0, 8) + "…" : "you")}
                  {!isNew && r.id && <> · id {r.id}</>}
                </div>
              )}
            </div>
          </div>

          {/* 2-col body */}
          <div className="ce-grid">
            {/* LEFT: Steps */}
            <div className="ce-col">
              <div className="ce-card">
                <div className="ce-card-head">
                  <div>
                    <div className="ce-eyebrow">cooking steps</div>
                    <h3 className="ce-card-title">{r.steps.length} {r.steps.length === 1 ? "step" : "steps"}</h3>
                  </div>
                  <EditPill required empty={r.steps.length < 3} onClick={addStep}>+ add step</EditPill>
                </div>

                {r.steps.length === 0 ? (
                  <div className="ce-empty">No steps yet. Add at least three for a complete recipe.</div>
                ) : r.steps.map((s, i) => (
                  <div className="ce-step" key={i}>
                    <div className="ce-step-num">{i + 1}</div>
                    <div className="ce-step-body">
                      <input
                        className="ce-step-title"
                        value={s.title}
                        onChange={(e) => updateStep(i, { title: e.target.value })}
                        placeholder="Step title"
                      />
                      <textarea
                        className="ce-step-detail"
                        value={s.detail}
                        onChange={(e) => updateStep(i, { detail: e.target.value })}
                        placeholder="What does the cook do?"
                        rows={2}
                      />
                      {openStepIdx === i && (
                        <div className="ce-step-extras">
                          <div className="ce-row">
                            <label>Timer</label>
                            <input
                              type="number"
                              min="0"
                              placeholder="seconds"
                              value={s.duration_seconds == null ? "" : s.duration_seconds}
                              onChange={(e) => updateStep(i, { duration_seconds: e.target.value })}
                            />
                            <span style={{ fontSize: 11, color: "var(--ink-muted)" }}>sec</span>
                          </div>
                          <div className="ce-row">
                            <label>Tip</label>
                            <input
                              placeholder="Optional pro-tip"
                              value={s.tip || ""}
                              onChange={(e) => updateStep(i, { tip: e.target.value })}
                            />
                          </div>
                          <div className="ce-row">
                            <label>Caption</label>
                            <input
                              placeholder="Reference image caption"
                              value={s.media_caption || ""}
                              onChange={(e) => updateStep(i, { media_caption: e.target.value })}
                            />
                          </div>
                          <div className="ce-row">
                            <label>Image</label>
                            <StepImageControl
                              recipeId={r.id || ""}
                              sortOrder={i + 1}
                              value={s.media_src || null}
                              onChange={(url) => updateStep(i, { media_src: url })}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="ce-step-actions">
                      <button
                        className="ce-step-icon-btn"
                        title={openStepIdx === i ? "Collapse" : "More fields"}
                        onClick={() => setOpenStepIdx(openStepIdx === i ? null : i)}
                      >{openStepIdx === i ? "−" : "⋯"}</button>
                      <button className="ce-step-icon-btn danger" title="Remove step"
                        onClick={() => { if (confirm("Remove this step?")) removeStep(i); }}>×</button>
                    </div>
                  </div>
                ))}

                <button className="ce-add-row" onClick={addStep}>+ Add step</button>
              </div>
            </div>

            {/* RIGHT: ingredients, utensils, tags, health */}
            <div className="ce-col">
              {/* Ingredients */}
              <div className="ce-card">
                <div className="ce-card-head">
                  <div>
                    <div className="ce-eyebrow">ingredients</div>
                    <h3 className="ce-card-title">{r.ingredients.length} {r.ingredients.length === 1 ? "item" : "items"}</h3>
                  </div>
                  <EditPill required empty={r.ingredients.length < 3} onClick={() => setOpenModal("ing")}>+ from library</EditPill>
                </div>
                {r.ingredients.length === 0 ? (
                  <div className="ce-empty">None yet — pick from the library.</div>
                ) : (
                  <div>
                    {r.ingredients.map((ing, i) => {
                      const lib = ingLib.find((x) => x.id === ing.ingredient_id) || { name: ing.ingredient_id || "(unknown)", category: "—" };
                      return (
                        <div key={i} className="ce-ing-row">
                          <div>
                            <div className="ce-ing-name">{lib.name}</div>
                            <div className="ce-ing-cat">{lib.category || "—"}</div>
                          </div>
                          <input
                            type="number"
                            inputMode="numeric"
                            step="1"
                            min="0"
                            value={ing.amount}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === "") { updateIng(i, { amount: "" }); return; }
                              const n = parseInt(v, 10);
                              if (!Number.isFinite(n) || n < 0) return;
                              updateIng(i, { amount: String(n) });
                            }}
                            placeholder="—"
                          />
                          <select
                            value={UNITS.includes(ing.unit) ? ing.unit : (ing.unit || UNITS[0])}
                            onChange={(e) => updateIng(i, { unit: e.target.value })}
                          >
                            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                            {ing.unit && !UNITS.includes(ing.unit) && (
                              <option value={ing.unit}>{ing.unit} (legacy)</option>
                            )}
                          </select>
                          <button className="ce-x" onClick={() => removeIng(i)} title="Remove">×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Utensils */}
              <div className="ce-card">
                <div className="ce-card-head">
                  <div>
                    <div className="ce-eyebrow">utensils</div>
                    <h3 className="ce-card-title">tools used</h3>
                  </div>
                  <EditPill onClick={() => setOpenModal("ut")}>+ add</EditPill>
                </div>
                {r.utensils.length === 0 ? (
                  <div className="ce-empty">No utensils linked yet.</div>
                ) : (
                  <div className="ce-utensil-grid">
                    {r.utensils.map((u, i) => {
                      const lib = utLib.find((x) => x.id === u.utensil_id) || { id: u.utensil_id, name: u.utensil_id || "(unknown)", category: "—" };
                      return (
                        <button key={i} className="ce-utensil-tile"
                          onClick={() => setOpenUtensil({ ...lib, _idx: i })}
                          type="button">
                          <div className="ut-img">
                            {lib.photo ? <img src={lib.photo} alt="" /> : <span>🛠</span>}
                          </div>
                          <div className="ut-body">
                            <div className="ut-name">{lib.name}</div>
                            <div className="ut-cat">{lib.category || "—"}</div>
                          </div>
                          <span
                            className="ce-x"
                            onClick={(e) => { e.stopPropagation(); removeUt(i); }}
                            title="Remove"
                            role="button"
                          >×</span>
                          <span className="ut-arrow">→</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Tags */}
              <div className="ce-card">
                <div className="ce-card-head">
                  <div>
                    <div className="ce-eyebrow">tags</div>
                    <h3 className="ce-card-title">discovery</h3>
                  </div>
                  <EditPill onClick={() => setOpenModal("tags")}>edit</EditPill>
                </div>
                {r.tags.length === 0 ? (
                  <div className="ce-empty">No tags yet.</div>
                ) : (
                  <div className="ce-tags-row">
                    {r.tags.map((t) => (
                      <span key={t} className={"ce-tag-chip " + (t === "vegetarian" || t === "vegan" || t === "veg" ? "veg" : "")}>{t}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Health */}
              <div className="ce-card">
                <div className="ce-card-head">
                  <div>
                    <div className="ce-eyebrow">health facts</div>
                    <h3 className="ce-card-title">rotates during cook</h3>
                  </div>
                  <EditPill onClick={() => setOpenModal("health")}>edit</EditPill>
                </div>
                {r.health.filter(h => (h||"").trim()).length === 0 ? (
                  <div className="ce-faint">Add up to 6 short facts that surface one at a time during cooking.</div>
                ) : (
                  <div className="ce-tags-row">
                    {r.health.filter(h => (h||"").trim()).map((h, i) => (
                      <span key={i} className="ce-tag-chip" style={{ background: "rgba(122,156,90,0.18)", color: "var(--matcha-deep)", border: "1px solid transparent" }}>{h}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
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
              {busy ? "Saving…" : isNew ? "Publish →" : "Update →"}
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {openModal === "meta" && (
        <MetaModal r={r} update={update} slugTaken={slugTaken} isNew={isNew} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "ing" && (
        <PickerModal kind="ing" library={ingLib} picked={r.ingredients}
          onPick={(item) => { addIngFromLib(item); setToast("✓ added " + item.name); }}
          onClose={() => setOpenModal(null)}
          manageHref={user.role === "admin" ? "../admin/ingredients.html" : "#"}
          manageLabel={user.role === "admin" ? "Manage library" : "Library is admin-managed"}
        />
      )}
      {openModal === "ut" && (
        <PickerModal kind="ut" library={utLib} picked={r.utensils}
          onPick={(item) => { addUtFromLib(item); setToast("✓ added " + item.name); }}
          onClose={() => setOpenModal(null)}
          manageHref={user.role === "admin" ? "../admin/utensils.html" : "#"}
          manageLabel={user.role === "admin" ? "Manage library" : "Library is admin-managed"}
        />
      )}
      {openModal === "tags" && (
        <TagsModal tags={r.tags} onChange={(tags) => update({ tags })} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "health" && (
        <CeModal title="Health facts" onClose={() => setOpenModal(null)}
          footer={<button className="btn-sm primary" onClick={() => setOpenModal(null)}>Done</button>}>
          <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)", marginBottom: 12 }}>
            Up to 6 short facts. Surfaced one at a time during cooking.
          </p>
          <div className="ce-health-list">
            {r.health.map((h, i) => (
              <div key={i} className="ce-health-item">
                <input
                  value={h}
                  onChange={(e) => {
                    const health = [...r.health]; health[i] = e.target.value; update({ health });
                  }}
                  placeholder="e.g. Tomatoes contain lycopene…"
                />
                <button className="ce-step-icon-btn danger" onClick={() => update({ health: r.health.filter((_, k) => k !== i) })}>×</button>
              </div>
            ))}
            {r.health.length < 6 && (
              <button className="ce-add-row" onClick={() => update({ health: [...r.health, ""] })}>+ Add fact</button>
            )}
          </div>
        </CeModal>
      )}
      {openUtensil && (
        <UtensilDetailModal
          utensil={openUtensil}
          picked={r.utensils.find(u => u.utensil_id === openUtensil.id)}
          onToggleEssential={() => {
            const idx = r.utensils.findIndex(u => u.utensil_id === openUtensil.id);
            if (idx >= 0) updateUt(idx, { essential: !r.utensils[idx].essential });
          }}
          onClose={() => setOpenUtensil(null)}
        />
      )}

      {toast && <div className="ce-toast">{toast}</div>}
    </div>
  );
}

window.MFC.chefGate.guard().then((ok) => {
  if (!ok) return;
  window.MFC.supabase.auth.getSession().then(({ data: { session } }) => {
    const u = session?.user;
    const user = u ? {
      id: u.id,
      email: u.email,
      role: u.app_metadata?.role || 'chef',
    } : null;
    if (!user) { document.body.innerHTML = '<p>Session lost.</p>'; return; }
    ReactDOM.createRoot(document.getElementById("root")).render(<ChefRecipeApp user={user} />);
  });
});
