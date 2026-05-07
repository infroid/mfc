// Utensil editor — WYSIWYG. Hero card with photo + identity + spec rows,
// Care tip block, Buy links retailer list. Loads ?id=<slug> for edit, none
// for new. App-shell layout for mobile parity.
const { useState, useEffect, useRef } = React;

const UT_CATEGORIES = ["Cookware", "Bakeware", "Cutlery", "Small appliance", "Utensil", "Measuring"];
const STORES = ["Amazon", "Target", "Williams-Sonoma", "Lodge", "iHerb", "Other"];

const BLANK = {
  id: "",
  name: "",
  tagline: "",
  category: "Cookware",
  photo: "",
  care_tip: "",
  specs: { material: "", size: "", weight: "" },
  show: { careTip: true, specs: false },
  ai_filled_at: null,
  buy_links: [],
};

function fromDb(row, buyLinks) {
  if (!row) return BLANK;
  return {
    id: row.id,
    name: row.name || "",
    tagline: row.tagline || "",
    category: row.category || "Cookware",
    photo: row.photo || "",
    care_tip: row.care_tip || "",
    specs: { ...BLANK.specs, ...(row.specs || {}) },
    show: { ...BLANK.show, ...(row.show || {}) },
    ai_filled_at: row.ai_filled_at || null,
    buy_links: (buyLinks || []).map((b) => ({
      store: b.store || "",
      url: b.url || "",
      price: b.price || "",
      affiliate_tag: b.affiliate_tag || "",
    })),
  };
}

function toDb(r) {
  return {
    id: r.id,
    name: r.name,
    tagline: r.tagline || null,
    category: r.category || null,
    photo: r.photo || null,
    care_tip: r.care_tip || null,
    specs: r.specs,
    show: r.show,
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

// ============================================================
// MODALS
// ============================================================
function IdentityModal({ r, update, slugTaken, isNew, onClose }) {
  return (
    <CeModal title="Identity" onClose={onClose}
      footer={<button className="btn-sm primary" onClick={onClose}>Done</button>}>
      <div className="field-row">
        <label>Name</label>
        <input value={r.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Cast-iron kadhai" autoFocus />
      </div>
      {isNew && r.name && (
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-muted)", padding: "4px 0 8px" }}>
          id will be: <span style={{ color: "var(--orange)" }}>{window.slugify(r.name)}</span>
        </div>
      )}
      {slugTaken && (
        <div className="slug-warning" style={{ marginBottom: 10 }}>
          A utensil with the slug <code>{window.slugify(r.name)}</code> already exists. Choose a different name.
        </div>
      )}
      <div className="field-row">
        <label>Tagline</label>
        <input value={r.tagline} onChange={(e) => update({ tagline: e.target.value })} placeholder="deep, broad, hot — the workhorse pan" />
      </div>
      <div className="field-row">
        <label>Category</label>
        <select value={r.category} onChange={(e) => update({ category: e.target.value })}>
          {UT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="field-row">
        <label>Photo path</label>
        <input
          value={r.photo}
          onChange={(e) => update({ photo: e.target.value })}
          placeholder="/assets/img/utensils/kadhai.jpg"
          style={{ fontFamily: "var(--mono)", fontSize: 13 }}
        />
      </div>
    </CeModal>
  );
}

// ============================================================
// MAIN
// ============================================================
function UtensilAdminApp() {
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
  const [openModal, setOpenModal] = useState(null); // 'identity'
  const [toast, setToast] = useToast();

  // Slug collision check (new mode)
  useEffect(() => {
    if (!isNew) return;
    const wantSlug = window.slugify(r.name);
    if (!wantSlug) { setSlugTaken(false); return; }
    const t = setTimeout(async () => {
      const { data } = await window.MFC.supabase
        .from('utensils').select('id').eq('id', wantSlug).maybeSingle();
      setSlugTaken(!!data);
    }, 400);
    return () => clearTimeout(t);
  }, [r.name, isNew]);

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const [row, counts, links] = await Promise.all([
          window.MFC.adminDb.getUtensil(editId),
          window.MFC.adminDb.utensilUsageCounts(),
          window.MFC.adminDb.listUtensilBuyLinks(editId),
        ]);
        if (!row) { setErr(`No utensil with id "${editId}"`); return; }
        setR(fromDb(row, links));
        setUsage(counts[editId] || 0);
        setDirty(false);
      } catch (e) { setErr(e.message); }
    })();
  }, [editId, isNew]);

  const update = (patch) => { setR((p) => ({ ...p, ...patch })); setDirty(true); };
  const updateShow = (k, v) => update({ show: { ...r.show, [k]: v } });
  const updateSpec = (k, v) => update({ specs: { ...r.specs, [k]: v } });
  const updateLink = (i, patch) => update({ buy_links: r.buy_links.map((l, k) => k === i ? { ...l, ...patch } : l) });
  const removeLink = (i) => update({ buy_links: r.buy_links.filter((_, k) => k !== i) });
  const addLink = () => update({ buy_links: [...r.buy_links, { store: "Amazon", url: "", price: "" }] });

  // Completion checks
  const checks = [
    { label: "Name",      pass: !!(r.name || "").trim(),     required: true },
    { label: "Tagline",   pass: !!(r.tagline || "").trim(),  required: true },
    { label: "Category",  pass: !!(r.category || "").trim(), required: true },
    { label: "Photo",     pass: !!(r.photo || "").trim(),    required: false },
    { label: "Care tip",  pass: !!(r.care_tip || "").trim(), required: false },
    { label: "Buy link",  pass: r.buy_links.some((b) => b.url),     required: false },
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
        if (!id) throw new Error("Utensil needs a name before saving.");
      }
      await window.MFC.adminDb.upsertUtensil(toDb({ ...r, id }));
      await window.MFC.adminDb.saveUtensilBuyLinks(id, r.buy_links);
      setDirty(false); setSavedAgo("just now");
      setToast(isNew ? "✓ created" : "✓ saved");
      if (isNew) { location.href = `utensil.html?id=${encodeURIComponent(id)}`; return; }
    } catch (e) {
      const msg = e.message || String(e);
      if (msg.includes('23505')) setErr("A utensil with this id already exists. Choose a different name.");
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
        <AdminSidebar active="utensils" />
        <div className="admin-main">
          <div className="chef-edit">
            <div className="ce-card" style={{ borderColor: "var(--berry)" }}>
              <p style={{ color: "var(--berry)", fontFamily: "var(--mono)" }}>
                {err} · <a href="utensils.html" style={{ color: "var(--orange)" }}>Back to utensils</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell admin-app-shell">
      <AdminSidebar active="utensils" />
      <div className="admin-main">
        <div className="chef-edit">
          {/* Breadcrumb */}
          <div className="ce-breadcrumb">
            <a href="index.html">Admin</a>
            <span className="sep">›</span>
            <a href="utensils.html">Utensils</a>
            <span className="sep">›</span>
            <span className="current">{r.name || (isNew ? "New" : (editId || "Untitled"))}</span>
          </div>

          {/* Header */}
          <div className="ce-header">
            <div>
              <div className="ce-eyebrow">{isNew ? "library · new utensil" : "library · editing"}</div>
              <h1>{isNew ? <><em>New</em> utensil</> : <><em>Edit</em> {r.name || editId || "utensil"}</>}</h1>
            </div>
          </div>

          {/* AI banner if applicable */}
          {r.ai_filled_at && (
            <div className="ce-ai-banner">
              <span className="glyph">✦</span>
              <div className="copy">
                <b>Auto-filled by Claude · {fmtAgo(r.ai_filled_at)}</b>
                <span>Identity, photo, and link data were generated. Review and toggle which fields surface.</span>
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

          {/* HERO CARD — split: square photo (left) + identity (right) */}
          <div className="ce-card flush ce-ut-hero-card">
            <div className="ce-ut-hero-photo">
              {r.photo
                ? <img src={r.photo} alt="" onError={(e) => { e.target.style.display = "none"; }} />
                : (
                  <div className="ce-ut-hero-empty">
                    <div className="glyph">🍳</div>
                    <div className="label">No photo yet</div>
                  </div>
                )}
              <EditPill
                style={{ position: "absolute", bottom: 12, right: 12, background: "rgba(255,252,243,0.94)" }}
                onClick={() => setOpenModal("identity")}
              >{r.photo ? "replace" : "add"} photo</EditPill>
            </div>
            <div className="ce-ut-hero-text">
              <div className="ce-hero-meta">
                <span>{r.category}</span>
                <span className="dot">·</span>
                <span>for the kitchen</span>
                <EditPill onClick={() => setOpenModal("identity")}>identity</EditPill>
                {slugTaken && (
                  <span style={{ color: "var(--berry)", fontFamily: "var(--mono)", fontSize: 10.5 }}>⚠ slug taken</span>
                )}
              </div>
              <input
                className="ce-hero-title-input"
                value={r.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Utensil name"
              />
              <input
                className="ce-hero-tag-input"
                value={r.tagline}
                onChange={(e) => update({ tagline: e.target.value })}
                placeholder="One-line description"
              />

              {/* Spec rows — inline-editable */}
              <div className="ce-ut-specs-edit">
                <SpecRow label="Material" value={r.specs.material} onChange={(v) => updateSpec("material", v)} placeholder="Pre-seasoned cast iron" />
                <SpecRow label="Size"     value={r.specs.size}     onChange={(v) => updateSpec("size", v)}     placeholder="12 in / 30 cm" />
                <SpecRow label="Weight"   value={r.specs.weight}   onChange={(v) => updateSpec("weight", v)}   placeholder="5.6 lbs" />
              </div>

              <div className="ce-ut-hero-foot">
                <span>
                  {isNew
                    ? <>// new entry · id will be generated from name</>
                    : <>// id <b style={{ color: "var(--ink)" }}>{r.id}</b>{r.ai_filled_at ? <> · ✦ ai-filled {fmtAgo(r.ai_filled_at)}</> : null}</>
                  }
                </span>
                <SurfaceToggle
                  label="show specs on utensil page"
                  value={r.show.specs}
                  onChange={(v) => updateShow("specs", v)}
                />
              </div>
            </div>
          </div>

          {/* CARE TIP CARD */}
          <div className={"ce-card" + (r.show.careTip ? "" : " ce-card-dim")}>
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">care notes</div>
                <h3 className="ce-card-title">how to keep it</h3>
              </div>
              <SurfaceToggle
                label="surface on utensil page"
                value={r.show.careTip}
                onChange={(v) => updateShow("careTip", v)}
              />
            </div>
            {r.show.careTip ? (
              <textarea
                className="ce-ut-care-input"
                rows={2}
                value={r.care_tip}
                onChange={(e) => update({ care_tip: e.target.value })}
                placeholder="Hand wash, dry on the stove, wipe with a thin film of neutral oil."
              />
            ) : (
              <div className="ce-faint">Toggle on to surface a care one-liner on the utensil page.</div>
            )}
          </div>

          {/* BUY LINKS CARD */}
          <div className="ce-card ce-ut-buy-card">
            <div className="ce-card-head">
              <div>
                <div className="ce-eyebrow">where to buy</div>
                <h3 className="ce-card-title">{r.buy_links.length} {r.buy_links.length === 1 ? "retailer" : "retailers"}</h3>
                <div className="ce-card-sub">Affiliate tags appended at render time.</div>
              </div>
              <EditPill onClick={addLink}>+ add</EditPill>
            </div>
            {r.buy_links.length === 0 ? (
              <div className="ce-empty">No retailers yet — click "+ add" to link one.</div>
            ) : (
              <div className="ce-ut-buy-list">
                {r.buy_links.map((b, i) => (
                  <div key={i} className="ce-ut-buy-row">
                    <select
                      value={STORES.includes(b.store) ? b.store : (b.store || "Amazon")}
                      onChange={(e) => updateLink(i, { store: e.target.value })}
                      className="ce-ut-buy-store"
                    >
                      {STORES.map((s) => <option key={s}>{s}</option>)}
                      {b.store && !STORES.includes(b.store) && (
                        <option value={b.store}>{b.store}</option>
                      )}
                    </select>
                    <input
                      className="ce-ut-buy-url"
                      value={b.url}
                      onChange={(e) => updateLink(i, { url: e.target.value })}
                      placeholder="https://amazon.com/dp/B07JFTSKXW"
                    />
                    <input
                      className="ce-ut-buy-price"
                      value={b.price || ""}
                      onChange={(e) => updateLink(i, { price: e.target.value })}
                      placeholder="$49.95"
                    />
                    <button className="ce-step-icon-btn danger" onClick={() => removeLink(i)} title="Remove">×</button>
                  </div>
                ))}
              </div>
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

      {toast && <div className="ce-toast">{toast}</div>}
    </div>
  );
}

// Spec row — label + inline-editable value styled as text
function SpecRow({ label, value, onChange, placeholder }) {
  return (
    <div className="ce-ut-spec-row">
      <span className="ce-ut-spec-label">{label}</span>
      <input
        className="ce-ut-spec-input"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<UtensilAdminApp />);
});
