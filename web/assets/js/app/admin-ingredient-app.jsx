/* Ingredient editor — editorial WYSIWYG.
 *
 * Mirrors design/prototype/js/page-ingredients.jsx and matches the rest of the
 * admin shell's italic-serif + mono-eyebrow + cream-orange-matcha vibe.
 *
 * Surfaces every column on the polymorphic ingredients + ingredient_details +
 * health_facts triple: identity, photo, source provenance, macros, full FDC
 * nutrition (tabbed, with %DV bars), multi-row health facts, storage tip,
 * substitutes.
 */
const { useState, useEffect, useMemo, useRef } = React;

// ---------------------------------------------------------------------------
// Static config
// ---------------------------------------------------------------------------
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

// FDA Daily Values (2,000 kcal diet) used for %DV bars. Values from the
// nutrition labeling rule (21 CFR 101.9). Units must match the column's unit
// (see docs/NUTRITION_FIELDS.md). Omitted entries render without a bar.
const DV = {
  calories: 2000, protein: 50, total_fat: 78, carbohydrate: 275,
  fiber: 28, sugars_added: 50, saturated_fat: 20, trans_fat: null,
  cholesterol: 300, sodium: 2300, potassium: 4700,
  calcium: 1300, iron: 18, magnesium: 420, phosphorus: 1250,
  zinc: 11, copper: 0.9, manganese: 2.3, selenium: 55,
  iodine: 150, chloride: 2300,
  vitamin_a: 900, vitamin_c: 90, vitamin_d: 20, vitamin_e: 15, vitamin_k: 120,
  thiamin: 1.2, riboflavin: 1.3, niacin: 16, vitamin_b6: 1.7,
  folate: 400, folate_dfe: 400, vitamin_b12: 2.4,
  biotin: 30, pantothenic_acid: 5, choline: 550,
};

// "high" bar at ≥20% DV (excellent source); "warn" past 100% (over limit).
const FLAG_HIGH = 20;
const FLAG_WARN = 100;

// Pretty labels + units for the nutrient columns we surface in the deep view.
// Order within each group is the order rendered.
const NUT_GROUPS = [
  {
    key: "macros",
    name: "Macros",
    rows: [
      ["protein",       "Protein",       "g"],
      ["total_fat",     "Fat, total",    "g"],
      ["carbohydrate",  "Carbs",         "g"],
      ["fiber",         "Fiber",         "g"],
      ["sugars",        "Sugars",        "g"],
      ["sugars_added",  "Sugars, added", "g"],
      ["starch",        "Starch",        "g"],
      ["water",         "Water",         "g"],
      ["ash",           "Ash",           "g"],
      ["alcohol",       "Alcohol",       "g"],
    ],
  },
  {
    key: "fats",
    name: "Fats",
    rows: [
      ["saturated_fat", "Saturated",       "g"],
      ["mono_fat",      "Monounsaturated", "g"],
      ["poly_fat",      "Polyunsaturated", "g"],
      ["trans_fat",     "Trans",           "g"],
      ["cholesterol",   "Cholesterol",     "mg"],
      ["pufa_18_3_n3_ala",  "Omega-3 · ALA",    "g"],
      ["pufa_20_5_n3_epa",  "Omega-3 · EPA",    "g"],
      ["pufa_22_6_n3_dha",  "Omega-3 · DHA",    "g"],
      ["pufa_18_2_n6_la",   "Omega-6 · LA",     "g"],
      ["pufa_20_4_n6_aa",   "Omega-6 · AA",     "g"],
    ],
  },
  {
    key: "minerals",
    name: "Minerals",
    rows: [
      ["sodium",     "Sodium",     "mg"],
      ["potassium",  "Potassium",  "mg"],
      ["calcium",    "Calcium",    "mg"],
      ["iron",       "Iron",       "mg"],
      ["magnesium",  "Magnesium",  "mg"],
      ["phosphorus", "Phosphorus", "mg"],
      ["zinc",       "Zinc",       "mg"],
      ["copper",     "Copper",     "mg"],
      ["manganese",  "Manganese",  "mg"],
      ["selenium",   "Selenium",   "µg"],
      ["iodine",     "Iodine",     "µg"],
      ["fluoride",   "Fluoride",   "µg"],
    ],
  },
  {
    key: "vitamins",
    name: "Vitamins",
    rows: [
      ["vitamin_a",         "Vitamin A",        "µg"],
      ["vitamin_c",         "Vitamin C",        "mg"],
      ["vitamin_d",         "Vitamin D",        "µg"],
      ["vitamin_e",         "Vitamin E",        "mg"],
      ["vitamin_k",         "Vitamin K",        "µg"],
      ["thiamin",           "Thiamin (B1)",     "mg"],
      ["riboflavin",        "Riboflavin (B2)",  "mg"],
      ["niacin",            "Niacin (B3)",      "mg"],
      ["pantothenic_acid",  "Pantothenic (B5)", "mg"],
      ["vitamin_b6",        "Vitamin B6",       "mg"],
      ["biotin",            "Biotin (B7)",      "µg"],
      ["folate",            "Folate (B9)",      "µg"],
      ["folate_dfe",        "Folate, DFE",      "µg"],
      ["vitamin_b12",       "Vitamin B12",      "µg"],
      ["choline",           "Choline",          "mg"],
      ["carotene_alpha",    "α-carotene",       "µg"],
      ["carotene_beta",     "β-carotene",       "µg"],
      ["lutein_zeaxanthin", "Lutein+Zeaxanthin","µg"],
      ["lycopene",          "Lycopene",         "µg"],
    ],
  },
  {
    key: "amino",
    name: "Amino acids",
    rows: [
      ["tryptophan",   "Tryptophan",   "g"],
      ["threonine",    "Threonine",    "g"],
      ["isoleucine",   "Isoleucine",   "g"],
      ["leucine",      "Leucine",      "g"],
      ["lysine",       "Lysine",       "g"],
      ["methionine",   "Methionine",   "g"],
      ["cystine",      "Cystine",      "g"],
      ["phenylalanine","Phenylalanine","g"],
      ["tyrosine",     "Tyrosine",     "g"],
      ["valine",       "Valine",       "g"],
      ["arginine",     "Arginine",     "g"],
      ["histidine",    "Histidine",    "g"],
      ["alanine",      "Alanine",      "g"],
      ["aspartic_acid","Aspartic acid","g"],
      ["glutamic_acid","Glutamic acid","g"],
      ["glycine",      "Glycine",      "g"],
      ["proline",      "Proline",      "g"],
      ["serine",       "Serine",       "g"],
    ],
  },
  {
    key: "other",
    name: "Other",
    rows: [
      ["caffeine",    "Caffeine",    "mg"],
      ["theobromine", "Theobromine", "mg"],
      ["energy_kj",   "Energy",      "kJ"],
      ["nitrogen",    "Nitrogen",    "g"],
    ],
  },
];

// ---------------------------------------------------------------------------
// Initial / shape helpers
// ---------------------------------------------------------------------------
const BLANK = {
  id: "",
  name: "",
  tagline: "",
  category: "Dairy",
  default_unit: "g",
  photo: "",
  show: { nutrition: true, healthFact: true, storage: false, substitutes: false },
  details: { nutrition_per: "100g" },
  health_facts: [],
  storage: "",
  substitutes: [],
  source: null,
  fdc_id: null,
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
    details: { ...BLANK.details, ...(row.details || {}) },
    health_facts: Array.isArray(row.health_facts) ? row.health_facts : [],
    storage: row.storage || "",
    substitutes: row.substitutes || [],
    source: row.source || null,
    fdc_id: row.fdc_id || null,
    ai_filled_at: row.ai_filled_at || null,
  };
}

function toDb(r) {
  // Strip nullish / zero entries from details so the writer doesn't overwrite
  // legitimate USDA values with 0. Only persist what the editor touched plus
  // anything that came in from the fetch.
  const det = {};
  for (const [k, v] of Object.entries(r.details || {})) {
    if (v === null || v === undefined || v === "") continue;
    det[k] = v;
  }
  return {
    id: r.id,
    name: r.name,
    tagline: r.tagline || null,
    category: r.category || null,
    default_unit: r.default_unit || "g",
    photo: r.photo || null,
    show: r.show,
    details: det,
    storage: r.storage || null,
    substitutes: r.substitutes || [],
    health_facts: (r.health_facts || []).map((s) => (s || "").trim()).filter(Boolean),
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

function fmtNum(v, unit) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return "—";
  const n = Number(v);
  if (n === 0) return "0";
  if (unit === "g" || unit === "kJ") {
    if (n < 1) return n.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
    if (n < 10) return n.toFixed(1).replace(/\.0$/, "");
    return Math.round(n).toString();
  }
  if (n < 1) return n.toFixed(2).replace(/0$/, "").replace(/\.$/, "");
  if (n < 100) return n.toFixed(1).replace(/\.0$/, "");
  return Math.round(n).toString();
}

function dvPercent(col, val) {
  if (val == null) return null;
  const dv = DV[col];
  if (!dv) return null;
  const pct = (Number(val) / dv) * 100;
  if (!Number.isFinite(pct)) return null;
  return Math.round(pct);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
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

function EditPill({ children = "Edit", onClick, danger = false, style }) {
  return (
    <button type="button" className={"edit-pill" + (danger ? " danger" : "")} onClick={onClick} style={style}>
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

function CeModal({ title, onClose, footer, children, width }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ce-modal-bd" onClick={onClose}>
      <div className="ce-modal" onClick={(e) => e.stopPropagation()} style={width ? { maxWidth: width } : null}>
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

function SrcPill({ source, fdcId, aiAt }) {
  if (!source) {
    return <span className="src-pill empty">// unfilled</span>;
  }
  if (source === "fdc" || source === "fdc-miss") {
    return (
      <span className={"src-pill fdc" + (source === "fdc-miss" ? " miss" : "")}>
        <b>USDA</b>
        {fdcId ? <em>· fdc {fdcId}</em> : <em>· no match</em>}
      </span>
    );
  }
  if (source === "ai" || source === "ai-miss") {
    return (
      <span className={"src-pill ai" + (source === "ai-miss" ? " miss" : "")}>
        <b>✦ Claude</b>
        {aiAt ? <em>· {fmtAgo(aiAt)}</em> : null}
      </span>
    );
  }
  return <span className="src-pill manual"><b>manual</b></span>;
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------
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
          <span key={i} className="ce-tag-chip veg">
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

function MacroEditModal({ details, onChange, onClose }) {
  const fields = [
    ["calories", "Calories", "kcal"],
    ["protein", "Protein", "g"],
    ["total_fat", "Fat, total", "g"],
    ["carbohydrate", "Carbs", "g"],
    ["fiber", "Fiber", "g"],
    ["sugars", "Sugars", "g"],
  ];
  function set(col, v) {
    if (v === "") return onChange({ ...details, [col]: null });
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n < 0) return;
    onChange({ ...details, [col]: n });
  }
  return (
    <CeModal title="Edit macros" onClose={onClose}
      footer={<button className="btn-sm primary" onClick={onClose}>Done</button>}>
      <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-muted)", marginBottom: 14 }}>
        per 100g · auto-pulled from USDA when available
      </p>
      <div className="macro-edit-grid">
        {fields.map(([col, label, unit]) => (
          <div key={col} className="macro-edit-row">
            <label>{label}</label>
            <input
              type="number" inputMode="decimal" step="0.1" min="0"
              value={details[col] ?? ""}
              onChange={(e) => set(col, e.target.value)}
              placeholder="0"
            />
            <span className="u">{unit}</span>
          </div>
        ))}
      </div>
    </CeModal>
  );
}

// ---------------------------------------------------------------------------
// MacroDonut — visualizes proportion of energy from protein / fat / carbs.
// Recipe page also uses this aesthetic; centerpiece of the macros card.
// ---------------------------------------------------------------------------
function MacroDonut({ details }) {
  const p = Number(details.protein) || 0;
  const f = Number(details.total_fat) || 0;
  const c = Number(details.carbohydrate) || 0;
  const kcalP = p * 4, kcalF = f * 9, kcalC = c * 4;
  const total = kcalP + kcalF + kcalC;
  const cal = details.calories != null ? Math.round(details.calories) : "—";

  if (total <= 0) {
    return (
      <div className="macro-donut empty">
        <svg viewBox="0 0 160 160">
          <circle cx="80" cy="80" r="60" stroke="var(--rule)" strokeWidth="14" fill="none" />
        </svg>
        <div className="label">
          <div>
            <b>{cal}</b>
            <div className="u">kcal / 100g</div>
          </div>
        </div>
      </div>
    );
  }

  const segs = [
    { label: "Protein", v: kcalP / total, color: "#7A9C5A" },
    { label: "Fat",     v: kcalF / total, color: "#FF6D2E" },
    { label: "Carbs",   v: kcalC / total, color: "#F4D67A" },
  ];
  const r = 60, circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="macro-donut">
      <svg viewBox="0 0 160 160">
        <circle cx="80" cy="80" r={r} stroke="var(--rule)" strokeWidth="14" fill="none" />
        {segs.map((s, i) => {
          const len = circ * s.v;
          const off = circ * acc;
          acc += s.v;
          return (
            <circle key={i} cx="80" cy="80" r={r}
              stroke={s.color} strokeWidth="14" fill="none"
              strokeDasharray={`${len} ${circ}`}
              strokeDashoffset={-off}
              strokeLinecap="butt" />
          );
        })}
      </svg>
      <div className="label">
        <div>
          <b>{cal}</b>
          <div className="u">kcal / 100g</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FactRow — single editable health-fact card
// ---------------------------------------------------------------------------
function FactRow({ value, onChange, onRemove, onMoveUp, onMoveDown, first, last, idx }) {
  return (
    <div className="fact-row">
      <span className="fact-bullet">{String(idx + 1).padStart(2, "0")}</span>
      <textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="One observation. Surfaces in the recipe-page rotator during guided cook."
      />
      <div className="fact-tools">
        <button type="button" className="fact-tool" disabled={first} onClick={onMoveUp} title="Move up">↑</button>
        <button type="button" className="fact-tool" disabled={last} onClick={onMoveDown} title="Move down">↓</button>
        <button type="button" className="fact-tool danger" onClick={onRemove} title="Remove">×</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------
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
  const [openModal, setOpenModal] = useState(null); // 'identity' | 'subs' | 'macros'
  const [nutTab, setNutTab] = useState("all");
  const [toast, setToast] = useToast();

  // Slug-collision check on new mode
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

  const update      = (patch) => { setR((p) => ({ ...p, ...patch })); setDirty(true); };
  const updateShow  = (k, v) => update({ show: { ...r.show, [k]: v } });
  const updateDet   = (det) => update({ details: det });

  // ---------- health-facts list editing ----------
  const factsSet = (i, v) => update({ health_facts: r.health_facts.map((x, k) => k === i ? v : x) });
  const factsAdd = ()      => update({ health_facts: [...r.health_facts, ""] });
  const factsDel = (i)     => update({ health_facts: r.health_facts.filter((_, k) => k !== i) });
  const factsMove = (i, dir) => {
    const arr = [...r.health_facts];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    update({ health_facts: arr });
  };

  // ---------- completion ----------
  const factsTrimmed = (r.health_facts || []).map(x => (x || "").trim()).filter(Boolean);
  const checks = [
    { label: "Name",        pass: !!(r.name || "").trim(),                          required: true },
    { label: "Tagline",     pass: !!(r.tagline || "").trim(),                       required: true },
    { label: "Category",    pass: !!(r.category || "").trim(),                      required: true },
    { label: "Photo",       pass: !!(r.photo || "").trim(),                         required: false },
    { label: "Macros",      pass: (r.details?.calories || 0) > 0,                   required: false },
    { label: "Health fact", pass: factsTrimmed.length > 0,                          required: false },
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

  // ---------- nutrition view ----------
  const tabs = [{ key: "all", name: "All" }, ...NUT_GROUPS.map(g => ({ key: g.key, name: g.name }))];
  const visibleGroups = nutTab === "all" ? NUT_GROUPS : NUT_GROUPS.filter(g => g.key === nutTab);
  function groupHasData(g) {
    return g.rows.some(([col]) => r.details[col] != null && r.details[col] !== "" && Number(r.details[col]) !== 0);
  }
  const filledCount = NUT_GROUPS.reduce((acc, g) =>
    acc + g.rows.filter(([col]) => r.details[col] != null && r.details[col] !== "" && Number(r.details[col]) !== 0).length, 0);
  const totalCount = NUT_GROUPS.reduce((acc, g) => acc + g.rows.length, 0);

  return (
    <div className="admin-shell admin-app-shell">
      <AdminSidebar active="ingredients" />
      <div className="admin-main">
        <div className="chef-edit ing-edit">

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
              <div className="ce-eyebrow">{isNew ? "library · new ingredient" : "library · editing — wysiwyg"}</div>
              <h1>
                {isNew ? <><em>New</em> ingredient</> : (
                  r.name ? <><em>{r.name.split(/[,\s]/)[0]}</em>{r.name.replace(/^[^,\s]+/, "")}</>
                         : <><em>Edit</em> {editId || "ingredient"}</>
                )}
              </h1>
            </div>
            <div className="ce-header-side">
              <SrcPill source={r.source} fdcId={r.fdc_id} aiAt={r.ai_filled_at} />
            </div>
          </div>

          {/* AI banner */}
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
                {pct}% complete · {filledCount}/{totalCount} nutrients filled
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

          {/* HERO CARD — photo on left, identity on right */}
          <div className="ce-card flush ing-hero">
            <div className="ing-hero-photo">
              {r.photo
                ? <img src={r.photo} alt="" onError={(e) => { e.target.style.display = "none"; }} />
                : (
                  <div className="ing-hero-empty">
                    <div className="glyph">{(r.category || "").toLowerCase().includes("fruit") ? "🍎"
                      : (r.category || "").toLowerCase().includes("veget") ? "🥬"
                      : (r.category || "").toLowerCase().includes("dairy") ? "🥛"
                      : (r.category || "").toLowerCase().includes("grain") ? "🌾"
                      : (r.category || "").toLowerCase().includes("spice") || (r.category || "").toLowerCase().includes("herb") ? "🌿"
                      : "🥕"}</div>
                    <div className="label">no photo</div>
                  </div>
                )}
              <EditPill style={{ position: "absolute", bottom: 12, right: 12, background: "rgba(255,252,243,0.94)" }}
                onClick={() => setOpenModal("identity")}>
                {r.photo ? "replace photo" : "add photo"}
              </EditPill>
            </div>

            <div className="ing-hero-text">
              <div className="ing-hero-eyebrow">
                <span>{r.category || "uncategorized"}</span>
                <span className="dot">·</span>
                <span>default <b>{r.default_unit}</b></span>
                <EditPill onClick={() => setOpenModal("identity")}>identity</EditPill>
                {slugTaken && <span className="ing-hero-warn">⚠ slug taken</span>}
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

              <div className="ing-hero-foot">
                <div className="ing-hero-id">
                  {isNew
                    ? <span>// new entry · id generated from name</span>
                    : <span>// id <b>{r.id}</b></span>}
                </div>
                <div className="ing-hero-basis">
                  📊 {r.details.nutrition_per || "100g"}
                  {r.fdc_id ? <> · fdc {r.fdc_id}</> : null}
                  {r.source && r.source !== "manual" && r.source !== "ai" && r.source !== "fdc"
                    ? <> · <span style={{ color: "var(--berry)" }}>{r.source}</span></> : null}
                </div>
              </div>
            </div>
          </div>

          {/* MACROS CARD — donut + grid */}
          <div className={"ce-card" + (r.show.nutrition ? "" : " ce-card-dim")}>
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">macros at a glance</div>
                <h3 className="ce-card-title">per {r.details.nutrition_per || "100g"}</h3>
                <div className="ce-card-sub">%DV based on a 2,000 kcal diet</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <EditPill onClick={() => setOpenModal("macros")}>edit values</EditPill>
                <SurfaceToggle label="surface on recipe page"
                  value={r.show.nutrition} onChange={(v) => updateShow("nutrition", v)} />
              </div>
            </div>

            <div className="macro-card-body">
              <div className="macro-donut-wrap">
                <MacroDonut details={r.details} />
                <div className="macro-legend">
                  <span className="legend-item"><span className="sw" style={{ background: "#7A9C5A" }} />Protein</span>
                  <span className="legend-item"><span className="sw" style={{ background: "#FF6D2E" }} />Fat</span>
                  <span className="legend-item"><span className="sw" style={{ background: "#F4D67A" }} />Carbs</span>
                </div>
              </div>
              <div className="macro-cells">
                <MacroEssential label="Protein"   col="protein"       value={r.details.protein}      unit="g" />
                <MacroEssential label="Fat"       col="total_fat"     value={r.details.total_fat}    unit="g" />
                <MacroEssential label="Carbs"     col="carbohydrate"  value={r.details.carbohydrate} unit="g" />
                <MacroEssential label="Fiber"     col="fiber"         value={r.details.fiber}        unit="g" />
                <MacroEssential label="Sugars"    col="sugars"        value={r.details.sugars}       unit="g" />
                <MacroEssential label="Water"     col="water"         value={r.details.water}        unit="g" />
              </div>
            </div>
          </div>

          {/* FULL NUTRITION CARD — tabbed */}
          <div className="ce-card">
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">full nutrition</div>
                <h3 className="ce-card-title">FDC complete</h3>
                <div className="ce-card-sub">{filledCount} of {totalCount} columns filled · empty rows shown for completeness</div>
              </div>
              <div className="ce-card-head-side">
                <span className="src-mini">{r.source === "fdc" && r.fdc_id ? `fdc ${r.fdc_id}` : (r.source || "—")}</span>
              </div>
            </div>

            <div className="nut-tabs">
              {tabs.map(t => {
                let count = null;
                if (t.key !== "all") {
                  const g = NUT_GROUPS.find(gg => gg.key === t.key);
                  count = g.rows.filter(([col]) => r.details[col] != null && r.details[col] !== "" && Number(r.details[col]) !== 0).length;
                }
                return (
                  <button key={t.key}
                    className={"nut-tab" + (t.key === nutTab ? " active" : "")}
                    onClick={() => setNutTab(t.key)}>
                    {t.name}
                    {count != null && <span className="nut-tab-count">{count}</span>}
                  </button>
                );
              })}
            </div>

            {visibleGroups.map(g => (
              <NutritionGroup key={g.key} group={g} details={r.details} hasData={groupHasData(g)} />
            ))}
          </div>

          {/* HEALTH FACTS CARD — multi-row */}
          <div className={"ce-card" + (r.show.healthFact ? "" : " ce-card-dim")}>
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">health facts</div>
                <h3 className="ce-card-title">cooking-flow rotator</h3>
                <div className="ce-card-sub">Each fact surfaces in turn during guided cook · keep ~60–110 chars each</div>
              </div>
              <SurfaceToggle label="surface on recipe page"
                value={r.show.healthFact} onChange={(v) => updateShow("healthFact", v)} />
            </div>

            {r.show.healthFact ? (
              <div className="fact-list">
                {r.health_facts.length === 0 && (
                  <div className="fact-empty">
                    <span className="ink">No facts yet.</span>
                    <span className="mono">Add one observation per row · iron-rich, K-vitamin source, etc.</span>
                  </div>
                )}
                {r.health_facts.map((f, i) => (
                  <FactRow
                    key={i}
                    idx={i}
                    value={f}
                    first={i === 0}
                    last={i === r.health_facts.length - 1}
                    onChange={(v) => factsSet(i, v)}
                    onRemove={() => factsDel(i)}
                    onMoveUp={() => factsMove(i, -1)}
                    onMoveDown={() => factsMove(i, +1)}
                  />
                ))}
                <button type="button" className="fact-add" onClick={factsAdd}>
                  <span className="plus">+</span> add another fact
                </button>
              </div>
            ) : (
              <div className="ce-faint">Toggle on to surface the rotator during guided cook.</div>
            )}
          </div>

          {/* STORAGE CARD */}
          <div className={"ce-card" + (r.show.storage ? "" : " ce-card-dim")}>
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">storage</div>
                <h3 className="ce-card-title">where &amp; how long</h3>
              </div>
              <SurfaceToggle label="surface on ingredient page"
                value={r.show.storage} onChange={(v) => updateShow("storage", v)} />
            </div>
            {r.show.storage ? (
              <input className="ce-ing-line"
                value={r.storage} onChange={(e) => update({ storage: e.target.value })}
                placeholder="Refrigerated, submerged in water · 7 days" />
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
                {r.show.substitutes && <EditPill onClick={() => setOpenModal("subs")}>edit</EditPill>}
                <SurfaceToggle label="surface on ingredient page"
                  value={r.show.substitutes} onChange={(v) => updateShow("substitutes", v)} />
              </div>
            </div>
            {r.show.substitutes ? (
              r.substitutes.length === 0 ? (
                <div className="ce-empty">No substitutes yet — click "edit" to add.</div>
              ) : (
                <div className="ce-tags-row">
                  {r.substitutes.map((s) => <span key={s} className="ce-tag-chip veg">{s}</span>)}
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

        {/* Sticky save bar */}
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

      {openModal === "identity" && (
        <IdentityModal r={r} update={update} slugTaken={slugTaken} isNew={isNew} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "subs" && (
        <SubstitutesModal subs={r.substitutes} onChange={(s) => update({ substitutes: s })} onClose={() => setOpenModal(null)} />
      )}
      {openModal === "macros" && (
        <MacroEditModal details={r.details} onChange={updateDet} onClose={() => setOpenModal(null)} />
      )}

      {toast && <div className="ce-toast">{toast}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MacroEssential — one of the six big tiles in the macros card.
// ---------------------------------------------------------------------------
function MacroEssential({ label, col, value, unit }) {
  const dv = dvPercent(col, value);
  return (
    <div className="macro-cell">
      <div className="name">
        <span>{label}</span>
        <span className="unit">{unit}</span>
      </div>
      <div className="val">{fmtNum(value, unit)}</div>
      {dv != null && (
        <>
          <div className={"dv" + (dv >= FLAG_WARN ? " warn" : dv >= FLAG_HIGH ? " high" : "")}>
            {dv}% DV{dv >= FLAG_WARN ? " · over" : dv >= FLAG_HIGH ? " · excellent" : ""}
          </div>
          <div className="dv-bar">
            <span className={dv >= FLAG_WARN ? "over" : dv >= FLAG_HIGH ? "high" : ""}
              style={{ width: Math.min(100, Math.max(2, dv)) + "%" }} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NutritionGroup — one tabbed group within the full-nutrition card.
// ---------------------------------------------------------------------------
function NutritionGroup({ group, details, hasData }) {
  return (
    <div className="nut-group">
      <div className="nut-group-head">
        <span className="nut-group-name">{group.name}</span>
        {!hasData && <span className="nut-group-empty">no data</span>}
      </div>
      <div className="nut-grid">
        {group.rows.map(([col, label, unit]) => {
          const v = details[col];
          const dv = dvPercent(col, v);
          const flag = dv != null
            ? (dv >= FLAG_WARN ? "warn" : dv >= FLAG_HIGH ? "high" : "")
            : "";
          const empty = v == null || v === "" || Number(v) === 0;
          return (
            <div key={col} className={"nut-cell" + (empty ? " empty" : "") + (flag ? " " + flag : "")}>
              <div className="name">
                <span>{label}</span>
                <span className="unit">{unit}</span>
              </div>
              <div className="val">{fmtNum(v, unit)}</div>
              {dv != null && (
                <>
                  <div className="dv">
                    {dv}% DV
                    {flag === "warn" ? " · over" : flag === "high" ? " · excellent" : ""}
                  </div>
                  <div className="dv-bar">
                    <span className={flag === "warn" ? "over" : flag === "high" ? "high" : ""}
                      style={{ width: Math.min(100, Math.max(2, dv)) + "%" }} />
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SurfaceToggle — slim show/hide pill used on every card head.
// ---------------------------------------------------------------------------
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
