// Chef portal — recipes list. Used by both chef and admin.
// Chef sees recipes where they're in recipe_owners (creator OR co-owner).
// Admin sees ALL recipes.
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

function ChefRecipesApp({ user }) {
  const role = user?.role || 'chef';
  const isAdmin = role === 'admin';

  const [rows, setRows] = useState(null);
  const [creators, setCreators] = useState({}); // userId -> truncated label
  const [q, setQ] = useState("");
  const [err, setErr] = useState(null);

  async function refresh() {
    try {
      const list = isAdmin
        ? await window.MFC.adminDb.listRecipes()
        : await window.MFC.adminDb.listOwnedRecipes(user.id);
      setRows(list);
    } catch (e) { setErr(e.message || String(e)); }
  }

  useEffect(() => { refresh(); }, []);

  // Fetch creator labels for any unique created_by we don't have yet.
  // We can't read auth.users directly from the client without admin RPC,
  // so non-self creators show as truncated UUIDs. Admin can resolve full
  // emails via /admin/users.html if needed.
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const wanted = [...new Set(rows.map((r) => r.created_by).filter(Boolean))];
    const missing = wanted.filter((id) => !(id in creators) && id !== user.id);
    if (missing.length === 0) return;
    const next = { ...creators };
    missing.forEach((id) => { next[id] = id.slice(0, 8) + "…"; });
    setCreators(next);
  }, [rows, user.id]);

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
    if (!confirm(`Delete recipe "${r.name}"?\n\nThis removes all steps, ingredients, utensils, tags, and health facts, plus its hero + step images from Supabase Storage. Cannot be undone.`)) return;
    try {
      await window.MFC.adminDb.deleteRecipe(r.id);
      try { await window.MFC.imageUpload.removeFolder(r.id); }
      catch (e) { console.warn("[chef] storage cleanup failed (orphans may remain)", e); }
      refresh();
    } catch (e) { alert("Delete failed: " + e.message); }
  }

  function creatorLabel(r) {
    if (r.created_by === user.id) return "You";
    return creators[r.created_by] || "—";
  }

  return (
    <div className="admin-shell">
      <ChefSidebar active="recipes" role={role} counts={rows ? { recipes: rows.length } : undefined} />
      <div className="admin-main">
        <AdminTopbar crumb={[{ label: "Recipes" }]} />

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h1>Recipes</h1>
              <p className="lede">
                {isAdmin
                  ? "All recipes. New recipes you create will be marked with you as creator."
                  : "Your authored recipes. Pick one to edit, or start a new one."}
              </p>
            </div>
            <div className="admin-page-meta">
              <span><b>{rows?.length ?? "—"}</b> total</span>
            </div>
          </div>

          {isAdmin && (
            <div className="admin-banner">
              Viewing all recipes as admin. New recipes you create will be marked with you as creator.
              User and library management lives in the Admin portal.
            </div>
          )}

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
                <div className="col-meta">Creator</div>
                <div className="col-time">Updated</div>
                <div>Actions</div>
              </div>
              {!rows && <div className="list-empty"><h3>Loading…</h3></div>}
              {rows && filtered.length === 0 && (
                <div className="list-empty">
                  <h3>{q ? "Nothing matches" : (isAdmin ? "No recipes match." : "You haven't authored any recipes yet.")}</h3>
                  {!q && <a href="recipe.html?new=1" className="btn-sm primary" style={{ textDecoration: "none" }}>+ {isAdmin ? "New recipe" : "Create your first recipe"}</a>}
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
                  <div className="col-meta">{creatorLabel(r)}</div>
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
    ReactDOM.createRoot(document.getElementById("root")).render(<ChefRecipesApp user={user} />);
  });
});
