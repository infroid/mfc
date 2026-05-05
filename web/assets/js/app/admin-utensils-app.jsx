// Utensils library list.
const { useState, useEffect, useMemo } = React;

function fmtAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function UtensilsListApp() {
  const [rows, setRows] = useState(null);
  const [usage, setUsage] = useState({});
  const [q, setQ] = useState("");
  const [err, setErr] = useState(null);

  async function refresh() {
    try {
      const [list, used] = await Promise.all([
        window.MFC.adminDb.listUtensils(),
        window.MFC.adminDb.utensilUsageCounts(),
      ]);
      setRows(list); setUsage(used);
    } catch (e) { setErr(e.message || String(e)); }
  }
  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const qq = q.toLowerCase().trim();
    if (!qq) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(qq) ||
      (r.category || "").toLowerCase().includes(qq) ||
      r.id.toLowerCase().includes(qq)
    );
  }, [rows, q]);

  async function onDelete(r) {
    const inUse = usage[r.id] || 0;
    if (inUse > 0) {
      alert(`Cannot delete "${r.name}" — it's used by ${inUse} recipe${inUse === 1 ? "" : "s"}.\n\nRemove it from those recipes first.`);
      return;
    }
    if (!confirm(`Delete utensil "${r.name}" from the library?`)) return;
    try { await window.MFC.adminDb.deleteUtensil(r.id); refresh(); }
    catch (e) { alert("Delete failed: " + e.message); }
  }

  return (
    <div className="admin-shell">
      <AdminSidebar active="utensils" counts={rows ? { utensils: rows.length } : undefined} />
      <div className="admin-main">
        <AdminTopbar crumb={[{ label: "Utensils" }]} />

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h1>Utensil <em>library</em></h1>
              <p className="lede">Master list of utensils. Recipes pick from here. AI auto-fills the basics; you review and pick what surfaces (buy link, care tip, specs).</p>
            </div>
            <div className="admin-page-meta">
              <span><b>{rows?.length ?? "—"}</b> total</span>
            </div>
          </div>

          <div className="list-toolbar">
            <div className="list-search">
              <span className="glass">⌕</span>
              <input
                placeholder="Search by name, category, or id…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {filtered && <span className="list-count">{filtered.length} of {rows.length}</span>}
            </div>
            <a href="utensil.html?new=1" className="btn-sm primary" style={{ textDecoration: "none" }}>+ New utensil</a>
          </div>

          {err && (
            <div className="form-card" style={{ borderColor: "var(--berry)" }}>
              <div className="form-card-body" style={{ color: "var(--berry)" }}>Failed to load: {err}</div>
            </div>
          )}

          {!err && (
            <div className="list-table">
              <div className="list-row head">
                <div />
                <div>Utensil</div>
                <div className="col-meta">Category</div>
                <div>Used in</div>
                <div className="col-time">Updated</div>
                <div>Actions</div>
              </div>
              {!rows && <div className="list-empty"><h3>Loading…</h3></div>}
              {rows && filtered.length === 0 && (
                <div className="list-empty">
                  <h3>{q ? "Nothing matches" : "No utensils yet"}</h3>
                  <p>{q ? "Try a different search term." : "Add your first utensil — recipes will pick from this library."}</p>
                  {!q && <a href="utensil.html?new=1" className="btn-sm primary" style={{ textDecoration: "none" }}>+ New utensil</a>}
                </div>
              )}
              {rows && filtered.map((r) => (
                <div key={r.id} className="list-row" onClick={() => { location.href = `utensil.html?id=${encodeURIComponent(r.id)}`; }}>
                  <div className="lib-thumb cream" />
                  <div>
                    <div className="name">{r.name}</div>
                    <div className="id">{r.id}</div>
                  </div>
                  <div className="col-meta">{r.category || "—"}</div>
                  <div className="col-meta">{usage[r.id] || 0}</div>
                  <div className="col-time">{fmtAgo(r.updated_at)}</div>
                  <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn danger" title="Delete" onClick={() => onDelete(r)}>×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<UtensilsListApp />);
});
