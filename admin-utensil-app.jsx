// Utensil editor — create or update one library entry. ?id=<slug> or ?new=1.
const { useState, useEffect } = React;

const BLANK = {
  id: "",
  name: "",
  tagline: "",
  category: "Cookware",
  photo: "",
  buy_link: { store: "Amazon", url: "", price: "" },
  care_tip: "",
  specs: { material: "", size: "", weight: "" },
  show: { buyLink: true, careTip: true, specs: false },
  ai_filled_at: null,
};

function fromDb(row) {
  if (!row) return BLANK;
  return {
    id: row.id,
    name: row.name || "",
    tagline: row.tagline || "",
    category: row.category || "Cookware",
    photo: row.photo || "",
    buy_link: { ...BLANK.buy_link, ...(row.buy_link || {}) },
    care_tip: row.care_tip || "",
    specs: { ...BLANK.specs, ...(row.specs || {}) },
    show: { ...BLANK.show, ...(row.show || {}) },
    ai_filled_at: row.ai_filled_at || null,
  };
}

function toDb(r) {
  return {
    id: r.id,
    name: r.name,
    tagline: r.tagline || null,
    category: r.category || null,
    photo: r.photo || null,
    buy_link: r.buy_link,
    care_tip: r.care_tip || null,
    specs: r.specs,
    show: r.show,
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

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const [row, counts] = await Promise.all([
          window.MFC.adminDb.getUtensil(editId),
          window.MFC.adminDb.utensilUsageCounts(),
        ]);
        if (!row) { setErr(`No utensil with id "${editId}"`); return; }
        setR(fromDb(row));
        setUsage(counts[editId] || 0);
        setDirty(false);
      } catch (e) { setErr(e.message); }
    })();
  }, [editId, isNew]);

  const update = (patch) => { setR((p) => ({ ...p, ...patch })); setDirty(true); };
  const updateShow = (k, v) => update({ show: { ...r.show, [k]: v } });
  const updateBuy  = (k, v) => update({ buy_link: { ...r.buy_link, [k]: v } });
  const updateSpec = (k, v) => update({ specs: { ...r.specs, [k]: v } });

  async function onPublish() {
    setErr(null); setBusy(true);
    try {
      let id = r.id;
      if (isNew || !id) {
        id = window.slugify(r.name);
        if (!id) throw new Error("Utensil needs a name before saving.");
      }
      await window.MFC.adminDb.upsertUtensil(toDb({ ...r, id }));
      setDirty(false); setSavedAgo("just now");
      if (isNew) { location.href = `admin-utensil.html?id=${encodeURIComponent(id)}`; return; }
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
        <AdminSidebar active="utensils" />
        <div className="admin-main">
          <AdminTopbar crumb={[{ label: "Utensils", href: "admin-utensils.html" }, { label: "Error" }]} />
          <div className="admin-page">
            <div className="form-card" style={{ borderColor: "var(--berry)" }}>
              <div className="form-card-body" style={{ color: "var(--berry)" }}>
                {err} · <a href="admin-utensils.html" style={{ color: "var(--orange)" }}>Back to utensils</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <AdminSidebar active="utensils" />
      <div className="admin-main">
        <AdminTopbar
          crumb={[{ label: "Utensils", href: "admin-utensils.html" }, { label: r.name || "Untitled" }]}
          status="live"
          savedAgo={savedAgo}
          isNew={isNew}
          onPublish={onPublish}
        />

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h1>{isNew ? <>New <em>utensil</em></> : <>Edit <em>utensil</em></>}</h1>
              <p className="lede">Library entry — {isNew ? "added once, picked by recipes." : `used by ${usage} recipe${usage === 1 ? "" : "s"}.`} AI fills the basics; you decide what surfaces.</p>
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
                <span>Identity, photo, and Amazon link were generated. Review, toggle which fields appear, publish.</span>
              </div>
            </div>
          )}

          <div className="workbench">
            <div className="workbench-form">
              <FormCard title="Core" scribble="always shown">
                <div className="field-grid">
                  <Field label="Name" required>
                    <input className="input serif" value={r.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Cast-iron kadhai" />
                  </Field>
                  {isNew && r.name && (
                    <div className="field-hint" style={{ fontFamily: "var(--mono)", fontStyle: "normal", fontSize: 11 }}>
                      id will be: <span style={{ color: "var(--orange)" }}>{window.slugify(r.name)}</span>
                    </div>
                  )}
                  <div className="field-grid cols-2">
                    <Field label="Tagline" help="one line">
                      <input className="input" value={r.tagline} onChange={(e) => update({ tagline: e.target.value })} placeholder="deep, broad, hot — the workhorse pan" />
                    </Field>
                    <Field label="Category">
                      <select className="select" value={r.category} onChange={(e) => update({ category: e.target.value })}>
                        <option>Cookware</option><option>Bakeware</option><option>Cutlery</option><option>Small appliance</option><option>Utensil</option><option>Measuring</option>
                      </select>
                    </Field>
                  </div>
                  <Field label="Photo" hint="Path under data/utensil-photos/.">
                    <input className="input mono" value={r.photo} onChange={(e) => update({ photo: e.target.value })} placeholder="data/utensil-photos/kadhai.jpg" />
                  </Field>
                </div>
              </FormCard>

              <SurfaceCard
                title="Buy link" scribble="affiliate"
                surfaceLabel="recipe sidebar · utensil page"
                show={r.show.buyLink}
                onShowChange={(v) => updateShow("buyLink", v)}
              >
                <div className="link-card amazon" style={{ marginBottom: 10 }}>
                  <div className="platform">a</div>
                  <input
                    className="url-input"
                    value={r.buy_link.url}
                    onChange={(e) => updateBuy("url", e.target.value)}
                    placeholder="amazon.com/dp/B07JFTSKXW?tag=mfc-20"
                  />
                  <input
                    style={{ width: 80, background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: 6, padding: "4px 8px", fontFamily: "var(--mono)", fontSize: 12, color: "var(--orange)", fontWeight: 600, outline: "none", textAlign: "right" }}
                    value={r.buy_link.price || ""}
                    onChange={(e) => updateBuy("price", e.target.value)}
                    placeholder="$49.95"
                  />
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-muted)", fontStyle: "italic", fontFamily: "var(--serif)" }}>
                  Affiliate tag <span style={{ fontFamily: "var(--mono)", fontStyle: "normal", color: "var(--orange)" }}>mfc-20</span> is appended automatically. Click metrics tracked separately.
                </div>
              </SurfaceCard>

              <SurfaceCard
                title="Care tip"
                surfaceLabel="utensil page only"
                show={r.show.careTip}
                onShowChange={(v) => updateShow("careTip", v)}
              >
                <Field label="One-liner">
                  <textarea
                    className="textarea"
                    rows={2}
                    value={r.care_tip}
                    onChange={(e) => update({ care_tip: e.target.value })}
                  />
                </Field>
              </SurfaceCard>

              <SurfaceCard
                title="Specs"
                surfaceLabel="utensil page only"
                show={r.show.specs}
                onShowChange={(v) => updateShow("specs", v)}
              >
                <div className="field-grid cols-3">
                  <Field label="Material">
                    <input className="input" value={r.specs.material} onChange={(e) => updateSpec("material", e.target.value)} />
                  </Field>
                  <Field label="Size">
                    <input className="input" value={r.specs.size} onChange={(e) => updateSpec("size", e.target.value)} />
                  </Field>
                  <Field label="Weight">
                    <input className="input" value={r.specs.weight} onChange={(e) => updateSpec("weight", e.target.value)} />
                  </Field>
                </div>
              </SurfaceCard>
            </div>

            <div className="workbench-preview">
              <PreviewFrame url={`/u/${r.id || "<new>"}`}>
                <UtensilPreview r={r} />
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

function UtensilPreview({ r }) {
  return (
    <div className="pv-ut-card">
      <div className="pv-ut-photo">
        <span className="tag">[ {r.photo || "no-photo.jpg"} ]</span>
      </div>
      <div className="pv-ut-body">
        <div className="pv-ut-name">{r.name || "Untitled"}</div>
        <div className="pv-ut-tag">{r.category}</div>
        <div style={{ fontSize: 12, color: "var(--ink-soft)", lineHeight: 1.45, margin: "6px 0 8px", fontStyle: "italic", fontFamily: "var(--serif)" }}>
          {r.tagline}
        </div>

        {r.show.specs && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10, fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-muted)" }}>
            <div><span style={{ color: "var(--ink-faint)" }}>material </span>{r.specs.material}</div>
            <div><span style={{ color: "var(--ink-faint)" }}>size </span>{r.specs.size}</div>
            <div><span style={{ color: "var(--ink-faint)" }}>weight </span>{r.specs.weight}</div>
          </div>
        )}

        {r.show.careTip && r.care_tip && (
          <div style={{ marginBottom: 10, padding: "8px 10px", background: "var(--cream-soft)", borderRadius: 8, fontSize: 11, color: "var(--ink-soft)", lineHeight: 1.45, fontStyle: "italic", fontFamily: "var(--serif)" }}>
            <span style={{ fontFamily: "var(--mono)", fontStyle: "normal", fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--orange)", display: "block", marginBottom: 2 }}>care</span>
            {r.care_tip}
          </div>
        )}

        {r.show.buyLink && r.buy_link.url && (
          <div className="pv-ut-buy">
            <span style={{ marginLeft: 4 }}>{r.buy_link.price ? "· " + r.buy_link.price : ""}</span>
          </div>
        )}
      </div>
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<UtensilAdminApp />);
});
