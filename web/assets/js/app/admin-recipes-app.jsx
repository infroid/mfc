// Recipes list — search, edit, delete, new.
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

function RecipesListApp() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState(null);

  async function refresh() {
    try { setRows(await window.MFC.adminDb.listRecipes()); }
    catch (e) { setErr(e.message || String(e)); }
  }
  useEffect(() => { refresh(); }, []);

  const filtered = useMemo(() => {
    if (!rows) return null;
    const qq = q.toLowerCase().trim();
    if (!qq) return rows;
    return rows.filter((r) =>
      r.name.toLowerCase().includes(qq) ||
      (r.cuisine || "").toLowerCase().includes(qq) ||
      r.id.toLowerCase().includes(qq)
    );
  }, [rows, q]);

  async function onDelete(r) {
    if (!confirm(`Delete recipe "${r.name}"?\n\nThis removes all steps, ingredients, utensils, tags, and health facts. Cannot be undone.`)) return;
    try { await window.MFC.adminDb.deleteRecipe(r.id); refresh(); }
    catch (e) { alert("Delete failed: " + e.message); }
  }

  return (
    <div className="admin-shell">
      <AdminSidebar active="recipes" counts={rows ? { recipes: rows.length } : undefined} />
      <div className="admin-main">
        <AdminTopbar crumb={[{ label: "Recipes" }]} />

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h1>All <em>recipes</em></h1>
              <p className="lede">The catalog of published &amp; draft recipes. Edit, duplicate, or remove. New recipes are created from a blank editor.</p>
            </div>
            <div className="admin-page-meta">
              <span><b>{rows?.length ?? "—"}</b> total</span>
            </div>
          </div>

          <div className="list-toolbar">
            <div className="list-search">
              <span className="glass">⌕</span>
              <input
                placeholder="Search by name, cuisine, or id…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {filtered && <span className="list-count">{filtered.length} of {rows.length}</span>}
            </div>
            <a href="recipe.html?new=1" className="btn-sm primary" style={{ textDecoration: "none" }}>+ New recipe</a>
          </div>

          {err && (
            <div className="form-card" style={{ borderColor: "var(--berry)" }}>
              <div className="form-card-body" style={{ color: "var(--berry)" }}>
                Failed to load: {err}
              </div>
            </div>
          )}

          {!err && (
            <div className="list-table">
              <div className="list-row head">
                <div />
                <div>Recipe</div>
                <div className="col-meta">Cuisine · difficulty</div>
                <div>Steps</div>
                <div className="col-time">Updated</div>
                <div>Actions</div>
              </div>
              {!rows && <div className="list-empty"><h3>Loading…</h3></div>}
              {rows && filtered.length === 0 && (
                <div className="list-empty">
                  <h3>{q ? "Nothing matches" : "No recipes yet"}</h3>
                  <p>{q ? "Try a different search term." : "Create your first recipe to get started."}</p>
                  {!q && <a href="recipe.html?new=1" className="btn-sm primary" style={{ textDecoration: "none" }}>+ New recipe</a>}
                </div>
              )}
              {rows && filtered.map((r) => (
                <div key={r.id} className="list-row" onClick={() => { location.href = `recipe.html?id=${encodeURIComponent(r.id)}`; }}>
                  <div className="lib-thumb" />
                  <div>
                    <div className="name">{r.name}</div>
                    <div className="id">{r.id}</div>
                  </div>
                  <div className="col-meta">{r.cuisine} · {r.difficulty}</div>
                  <div className="col-meta">{r.stepCount}</div>
                  <div className="col-time">{fmtAgo(r.updated_at)}</div>
                  <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    {r.featured && <span className="pill-stat featured">★ featured</span>}
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
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<RecipesListApp />);
});
