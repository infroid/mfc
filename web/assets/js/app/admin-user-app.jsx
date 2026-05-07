// Admin user detail — read-only WYSIWYG view.
// Mirrors the admin-view design: avatar identity card + role change card.
// Role mutation is intentionally CLI-only ('mfc set-role') so this page
// shows copy-paste commands rather than a write button.
const { useState, useEffect } = React;

const ROLE_LABELS = { user: "User", chef: "Chef", admin: "Admin" };
const ROLE_DESCRIPTIONS = {
  user:  "No write access. Default role.",
  chef:  "Can create and edit recipes they own.",
  admin: "Full access: catalog, users, settings.",
};

function isDemotion(currentRole, newRole) {
  if (currentRole === "admin" && newRole !== "admin") return true;
  if (currentRole === "chef"  && newRole === "user")  return true;
  return false;
}

function consequenceFor(currentRole, newRole) {
  if (isDemotion(currentRole, newRole)) {
    return "Will sign the user out of all sessions immediately.";
  }
  if (newRole === "admin") return "Grants full admin access.";
  if (newRole === "chef")  return "Grants chef-level recipe ownership.";
  return "Removes elevated access.";
}

function fmtTimestamp(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

function fmtAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function avatarInitial(user) {
  const src = (user.full_name && user.full_name.trim()) || user.email || "?";
  return src.charAt(0).toUpperCase();
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

function RoleBadge({ role }) {
  return <span className={`role-badge role-${role}`}>{ROLE_LABELS[role] || role}</span>;
}

function UserApp() {
  const id = new URLSearchParams(window.location.search).get("id");
  const [user, setUser] = useState(null);
  const [adminView, setAdminView] = useState(null); // { profile, activity }
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) { setErr("No user id in URL."); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await window.MFC.supabase.rpc("list_app_users", {
          p_role: "all", p_q: null, p_page: 1, p_per_page: 200,
        });
        if (error) throw new Error(error.message || String(error));
        const match = (data || []).find((r) => r.id === id);
        if (!match) { if (!cancelled) { setErr("User not found."); setLoading(false); } return; }
        if (cancelled) return;
        setUser(match);

        // Activity + profile come from admin-read RLS policies on the
        // user-owned tables. Fail soft: if the policy isn't applied yet,
        // render the cards in a degraded "data unavailable" state.
        try {
          const view = await window.MFC.adminDb.getUserAdminView(id);
          if (!cancelled) setAdminView(view);
        } catch (e) {
          if (!cancelled) setAdminView({ profile: null, activity: null, error: e.message });
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (err && !user) {
    return (
      <div className="admin-shell admin-app-shell">
        <AdminSidebar active="users" />
        <div className="admin-main">
          <div className="chef-edit">
            <div className="ce-card" style={{ borderColor: "var(--berry)" }}>
              <p style={{ color: "var(--berry)", fontFamily: "var(--mono)" }}>
                {err} · <a href="users.html" style={{ color: "var(--orange)" }}>Back to users</a>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading || !user) {
    return (
      <div className="admin-shell admin-app-shell">
        <AdminSidebar active="users" />
        <div className="admin-main">
          <div className="chef-edit">
            <div className="ce-empty" style={{ padding: "60px 20px", fontSize: 18 }}>Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  const firstName = (user.full_name || user.email.split("@")[0]).split(" ")[0];
  const otherRoles = ["user", "chef", "admin"].filter((r) => r !== user.role);

  return (
    <div className="admin-shell admin-app-shell">
      <AdminSidebar active="users" />
      <div className="admin-main">
        <div className="chef-edit">
          {/* Breadcrumb */}
          <div className="ce-breadcrumb">
            <a href="index.html">Admin</a>
            <span className="sep">›</span>
            <a href="users.html">Users</a>
            <span className="sep">›</span>
            <span className="current">{user.email}</span>
          </div>

          {/* Header */}
          <div className="ce-header">
            <div>
              <div className="ce-eyebrow">profile · admin view</div>
              <h1>
                {user.full_name
                  ? <><em>{firstName}</em> {user.full_name.split(" ").slice(1).join(" ")}</>
                  : <><em>{firstName}</em></>}
              </h1>
            </div>
          </div>

          {/* Two-col body: identity + role (left) | activity + prefs + danger (right) */}
          <div className="ce-grid" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
            {/* LEFT — identity, then role beneath */}
            <div className="ce-col">
              <div className="ce-card ce-user-identity">
                <div className="ce-user-head">
                  <div className="ce-user-avatar">{avatarInitial(user)}</div>
                  <div className="ce-user-name-block">
                    <div className="ce-user-name">{user.full_name || user.email.split("@")[0]}</div>
                    <div className="ce-user-email">{user.email}</div>
                  </div>
                </div>

                <div className="ce-user-fields">
                  <div className="ce-field-row">
                    <span className="ce-field-label">Role</span>
                    <span className="ce-field-value"><RoleBadge role={user.role} /></span>
                  </div>
                  <div className="ce-field-row">
                    <span className="ce-field-label">Provider</span>
                    <span className="ce-field-value mono">{user.provider || "—"}</span>
                  </div>
                  <div className="ce-field-row">
                    <span className="ce-field-label">Joined</span>
                    <span className="ce-field-value">
                      {fmtTimestamp(user.created_at)}
                      {fmtAgo(user.created_at) && (
                        <span className="ce-field-hint"> · {fmtAgo(user.created_at)}</span>
                      )}
                    </span>
                  </div>
                  <div className="ce-field-row">
                    <span className="ce-field-label">Last sign-in</span>
                    <span className="ce-field-value">
                      {fmtTimestamp(user.last_sign_in_at)}
                      {fmtAgo(user.last_sign_in_at) && (
                        <span className="ce-field-hint"> · {fmtAgo(user.last_sign_in_at)}</span>
                      )}
                    </span>
                  </div>
                  <div className="ce-field-row">
                    <span className="ce-field-label">User ID</span>
                    <span className="ce-field-value mono small">{user.id}</span>
                  </div>
                </div>
              </div>

              {/* ROLE CARD — under identity on the left */}
              <div className="ce-card">
                <div className="ce-card-head">
                  <div>
                    <div className="ce-eyebrow">role</div>
                    <h3 className="ce-card-title">terminal-only mutation</h3>
                    <div className="ce-card-sub">
                      Roles are stored in <code className="ce-inline-code">app_metadata</code> and writable
                      only via the CLI — never the browser.
                    </div>
                  </div>
                  <RoleBadge role={user.role} />
                </div>

                <div className="ce-role-list">
                  {otherRoles.map((r) => {
                    const cmd = `make set-role USER=${user.email} ROLE=${r}`;
                    return (
                      <div key={r} className="ce-role-item">
                        <div className="ce-role-item-head">
                          <span className="ce-role-item-label">
                            → Set to <RoleBadge role={r} />
                          </span>
                          <CopyButton text={cmd} />
                        </div>
                        <pre className="ce-role-cmd">{cmd}</pre>
                        <p className="ce-role-caption">
                          {consequenceFor(user.role, r)} <em>{ROLE_DESCRIPTIONS[r]}</em>
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* RIGHT — activity, food prefs, danger zone */}
            <div className="ce-col">
              <ActivityCard view={adminView} />
              <FoodPrefsCard view={adminView} />
              <DangerZoneCard email={user.email} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Activity (last 30 days) ──────────────────────────────────────────
function ActivityCard({ view }) {
  const a = view?.activity;
  return (
    <div className="ce-card">
      <div className="ce-card-head">
        <div>
          <div className="ce-eyebrow">activity</div>
          <h3 className="ce-card-title">last 30 days</h3>
        </div>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>read-only</span>
      </div>
      {!view ? (
        <div className="ce-faint">Loading…</div>
      ) : view.error ? (
        <div className="ce-faint" style={{ color: "var(--berry)" }}>
          Activity unavailable. Apply the latest schema (admin-read RLS) and reload.
        </div>
      ) : (
        <div className="ce-activity-grid">
          <ActivityCell label="recipes saved"   value={a.savedRecipes} />
          <ActivityCell label="meals logged"    value={a.mealsLogged} />
          <ActivityCell label="markers updated" value={a.markersUpdated} />
        </div>
      )}
    </div>
  );
}

function ActivityCell({ label, value }) {
  return (
    <div className="ce-activity-cell">
      <div className="ce-eyebrow">{label}</div>
      <div className="ce-activity-num">{value ?? "—"}</div>
    </div>
  );
}

// ─── Food prefs (read-only) ───────────────────────────────────────────
function FoodPrefsCard({ view }) {
  const p = view?.profile;
  const fmt = (arr) => arr && arr.length > 0 ? arr.join(", ") : null;

  return (
    <div className="ce-card">
      <div className="ce-card-head">
        <div>
          <div className="ce-eyebrow">profile</div>
          <h3 className="ce-card-title">food prefs</h3>
        </div>
        <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ink-muted)", letterSpacing: "0.04em" }}>read-only</span>
      </div>
      {!view ? (
        <div className="ce-faint">Loading…</div>
      ) : view.error ? (
        <div className="ce-faint" style={{ color: "var(--berry)" }}>
          Profile unavailable. Apply the latest schema (admin-read RLS) and reload.
        </div>
      ) : !p ? (
        <div className="ce-faint">No profile yet — user hasn't set their food preferences.</div>
      ) : (
        <div className="ce-user-fields">
          <div className="ce-field-row">
            <span className="ce-field-label">Diet tags</span>
            <span className="ce-field-value">{fmt(p.diet_tags) || <em className="muted">none</em>}</span>
          </div>
          <div className="ce-field-row">
            <span className="ce-field-label">Allergies</span>
            <span className="ce-field-value">{fmt(p.allergies) || <em className="muted">none</em>}</span>
          </div>
          <div className="ce-field-row">
            <span className="ce-field-label">Goals</span>
            <span className="ce-field-value">{fmt(p.goals) || <em className="muted">none</em>}</span>
          </div>
          <div className="ce-field-row">
            <span className="ce-field-label">Units</span>
            <span className="ce-field-value">{p.units || "metric"}</span>
          </div>
          <div className="ce-field-row">
            <span className="ce-field-label">DOB</span>
            <span className="ce-field-value">{p.date_of_birth || <em className="muted">not set</em>}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Danger zone ──────────────────────────────────────────────────────
function DangerZoneCard({ email }) {
  const cmd = `make suspend-user USER=${email}`;
  return (
    <div className="ce-card ce-danger-card">
      <div className="ce-card-head">
        <div>
          <div className="ce-eyebrow" style={{ color: "var(--berry)" }}>danger zone</div>
          <h3 className="ce-card-title" style={{ color: "var(--berry)" }}>suspend account</h3>
          <div className="ce-card-sub">
            Bans login and ends every active session immediately. Run from terminal.
          </div>
        </div>
      </div>
      <div className="ce-role-item" style={{ background: "rgba(200, 75, 90, 0.06)", borderColor: "rgba(200, 75, 90, 0.32)" }}>
        <div className="ce-role-item-head">
          <span className="ce-role-item-label" style={{ color: "var(--berry)" }}>→ Suspend {email}</span>
          <CopyButton text={cmd} />
        </div>
        <pre className="ce-role-cmd">{cmd}</pre>
        <p className="ce-role-caption">
          Sets <code style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>auth.users.banned_until</code> via the GoTrue admin API and force-signs the user out. Permanent until manually cleared.
        </p>
      </div>
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<UserApp />);
});
