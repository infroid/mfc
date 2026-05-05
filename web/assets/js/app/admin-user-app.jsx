// Admin user detail — read-only.
// Shows identity + current role; suggests `make set-role` commands.

const { useState, useEffect } = React;

const ROLE_LABELS = { user: "User", chef: "Chef", admin: "Admin" };
const ROLE_DESCRIPTIONS = {
  user:  "No write access. Default role.",
  chef:  "Will be able to create and edit recipes they own (granted in sub-project #2).",
  admin: "Full access: catalog, users, settings.",
};

function RoleBadge({ role }) {
  return <span className={`role-badge role-${role}`}>{ROLE_LABELS[role] || role}</span>;
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handler = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <button className="btn-sm" onClick={handler}>
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function isDemotion(currentRole, newRole) {
  if (currentRole === "admin" && newRole !== "admin") return true;
  if (currentRole === "chef" && newRole === "user") return true;
  return false;
}

function consequenceFor(currentRole, newRole) {
  if (isDemotion(currentRole, newRole)) {
    return "Will sign the user out of all sessions immediately.";
  }
  if (newRole === "admin") return "Grants full admin access.";
  if (newRole === "chef")  return "Grants chef-level recipe ownership (when sub-project #2 lands).";
  return "Removes elevated access.";
}

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function UserDetail({ user }) {
  const otherRoles = ["user", "chef", "admin"].filter((r) => r !== user.role);
  return (
    <>
      <div className="form-card">
        <div className="form-card-head"><h3>Identity</h3></div>
        <div className="form-card-body">
          <dl className="user-id-grid">
            <dt>Email</dt>           <dd>{user.email}</dd>
            <dt>Name</dt>            <dd>{user.full_name || "—"}</dd>
            <dt>Provider</dt>        <dd>{user.provider}</dd>
            <dt>Signed up</dt>       <dd>{fmtTimestamp(user.created_at)}</dd>
            <dt>Last sign-in</dt>    <dd>{fmtTimestamp(user.last_sign_in_at)}</dd>
            <dt>User ID</dt>         <dd className="mono small">{user.id}</dd>
          </dl>
        </div>
      </div>

      <div className="form-card">
        <div className="form-card-head"><h3>Role</h3></div>
        <div className="form-card-body">
          <p style={{ marginBottom: 18 }}>
            Current: <RoleBadge role={user.role} />
          </p>

          <p className="lede" style={{ marginBottom: 14 }}>
            To change this role, run one of these commands in your terminal:
          </p>

          <div className="role-suggestions">
            {otherRoles.map((r) => {
              const cmd = `make set-role USER=${user.email} ROLE=${r}`;
              return (
                <div key={r} className="role-suggestion">
                  <div className="suggestion-head">
                    <span className="suggestion-label">→ Set to <RoleBadge role={r} /></span>
                    <CopyButton text={cmd} />
                  </div>
                  <pre className="suggestion-cmd">{cmd}</pre>
                  <p className="suggestion-caption">
                    {consequenceFor(user.role, r)} <em>{ROLE_DESCRIPTIONS[r]}</em>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

function UserApp() {
  const id = new URLSearchParams(window.location.search).get("id");
  const [user, setUser] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) { setErr("No user id in URL."); setLoading(false); return; }
    let cancelled = false;
    // Wider page; find by id. p_q is email-only so passing an id wouldn't match.
    window.MFC.supabase.rpc("list_app_users", {
      p_role: "all", p_q: null, p_page: 1, p_per_page: 200,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { setErr(error.message || String(error)); setLoading(false); return; }
      const match = (data || []).find((r) => r.id === id);
      if (!match) setErr("User not found.");
      else setUser(match);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className="admin-shell">
      <AdminSidebar active="users" />
      <div className="admin-main">
        <AdminTopbar crumb={[
          { label: "Users", href: "users.html" },
          { label: user ? user.email : (loading ? "…" : "User") },
        ]} />

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h1>{user ? user.email : (loading ? "Loading…" : "User")}</h1>
              {user && <p className="lede">Identity is read-only. Role changes are made from the terminal.</p>}
            </div>
          </div>

          {err && (
            <div className="form-card" style={{ borderColor: "var(--berry)" }}>
              <div className="form-card-body" style={{ color: "var(--berry)" }}>
                {err}
              </div>
            </div>
          )}

          {loading && !err && (
            <div className="list-empty"><h3>Loading…</h3></div>
          )}

          {user && <UserDetail user={user} />}
        </div>
      </div>
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<UserApp />);
});
