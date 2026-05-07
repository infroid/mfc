// Admin users list — read-only. Calls public.list_app_users() RPC.
// Role mutations happen in the terminal (see /admin/user.html).

const { useState, useEffect, useMemo } = React;

const ROLE_LABELS = { user: "User", chef: "Chef", admin: "Admin" };

function fmtAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

function initials(email, fullName) {
  if (fullName) {
    const parts = fullName.trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
  }
  return (email?.[0] || "?").toUpperCase();
}

function RoleBadge({ role }) {
  return <span className={`role-badge role-${role}`}>{ROLE_LABELS[role] || role}</span>;
}

function UsersListApp() {
  const [role, setRole] = useState("all");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 50;
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState(null);

  // Debounce q.
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput); setPage(1); }, 250);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setErr(null);
    window.MFC.supabase.rpc("list_app_users", {
      p_role: role,
      p_q: q || null,
      p_page: page,
      p_per_page: perPage,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setErr(error.message || String(error));
        setRows([]);
        setTotal(0);
      } else {
        setRows(data || []);
        setTotal(data && data.length ? Number(data[0].total_count) : 0);
      }
    });
    return () => { cancelled = true; };
  }, [role, q, page]);

  const lastPage = Math.max(1, Math.ceil(total / perPage));

  return (
    <div className="admin-shell">
      <AdminSidebar active="users" counts={rows ? { users: total } : undefined} />
      <div className="admin-main">
        <AdminTopbar crumb={[{ label: "Users" }]} />

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <div className="page-eyebrow">admin · users</div>
              <h1>All <em>users</em></h1>
              <p className="lede">Browse signed-up users. Role changes are made from the terminal — open a user to see the exact command.</p>
            </div>
            <div className="admin-page-meta">
              <span><b>{rows ? total : "—"}</b> total</span>
            </div>
          </div>

          <div className="list-toolbar">
            <div className="list-search">
              <span className="glass">⌕</span>
              <input
                type="search"
                placeholder="Search by email…"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
              />
              {rows && <span className="list-count">{rows.length} of {total}</span>}
            </div>
            <div className="role-pills">
              {["all", "user", "chef", "admin"].map((r) => (
                <button
                  key={r}
                  className={"role-pill" + (role === r ? " active" : "")}
                  onClick={() => { setRole(r); setPage(1); }}
                >
                  {r === "all" ? "All" : ROLE_LABELS[r]}
                </button>
              ))}
            </div>
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
              <div className="list-row users-row head">
                <div />
                <div>Email</div>
                <div className="col-meta">Name</div>
                <div>Role</div>
                <div className="col-meta">Provider</div>
                <div className="col-time">Last sign-in</div>
                <div className="col-time">Signed up</div>
              </div>
              {!rows && <div className="list-empty"><h3>Loading…</h3></div>}
              {rows && rows.length === 0 && (
                <div className="list-empty">
                  <h3>{q || role !== "all" ? "Nothing matches" : "No users yet"}</h3>
                  <p>{q || role !== "all" ? "Try a different filter or search term." : "Users appear here once they sign in."}</p>
                </div>
              )}
              {rows && rows.map((r) => (
                <div
                  key={r.id}
                  className="list-row users-row"
                  onClick={() => { location.href = `user.html?id=${encodeURIComponent(r.id)}`; }}
                >
                  <div className="user-avatar-cell"><span className="user-avatar">{initials(r.email, r.full_name)}</span></div>
                  <div>
                    <div className="name">{r.email}</div>
                    <div className="id">{r.id}</div>
                  </div>
                  <div className="col-meta">{r.full_name || "—"}</div>
                  <div><RoleBadge role={r.role} /></div>
                  <div className="col-meta">{r.provider}</div>
                  <div className="col-time" title={r.last_sign_in_at || ""}>{fmtAgo(r.last_sign_in_at)}</div>
                  <div className="col-time" title={r.created_at || ""}>{fmtAgo(r.created_at)}</div>
                </div>
              ))}
            </div>
          )}

          {rows && rows.length > 0 && (
            <div className="user-pager">
              <button className="btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
              <span>page {page} of {lastPage} · {total} total</span>
              <button className="btn-sm" disabled={page >= lastPage} onClick={() => setPage(page + 1)}>Next ›</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<UsersListApp />);
});
