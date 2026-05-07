/* ADMIN — dashboard, users list, user detail. + USER pages: account, profile, dashboard.
   All consistent with the recipe-page system. */

function AdminDashboardPage() {
  const stats = [
    { label: "Recipes", value: window.RECIPES.length, delta: "+4 this week", tone: "matcha" },
    { label: "Ingredients", value: 248, delta: "+12 this month", tone: "matcha" },
    { label: "Utensils", value: 36, delta: "+1 this month", tone: "neutral" },
    { label: "Users", value: 142, delta: "+18 this week", tone: "matcha" },
    { label: "Drafts pending", value: 7, delta: "needs review", tone: "warn" },
    { label: "DAU", value: 84, delta: "+6%", tone: "matcha" },
  ];
  const recent = window.USERS.slice(0, 5);
  const drafts = window.RECIPES.filter(r => r.status === "draft").slice(0, 4);

  return (
    <AdminShell active="dashboard">
      <PageHeader eyebrow="overview" title='<em>Hello,</em> Jordan' sub="Here's the state of the kitchen today." />

      <div className="grid-3" style={{ marginBottom: 24 }}>
        {stats.map(s => (
          <div key={s.label} className="stat-card">
            <div className="card-eyebrow" style={{ marginBottom: 6 }}>{s.label}</div>
            <div className="stat-num">{s.value}</div>
            <div className={"stat-delta " + s.tone}>{s.delta}</div>
          </div>
        ))}
      </div>

      <div className="resp-2col" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">queue</div>
              <h3 className="card-title">Drafts to review</h3>
            </div>
            <a className="btn btn-ghost btn-sm" href="#chef-recipes">view all</a>
          </div>
          {drafts.map(d => (
            <div key={d.id} className="field-row" style={{ alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <ImgPh label={d.emoji} ratio="1/1" style={{ width: 36, height: 36, borderRadius: 8 }} />
                <div>
                  <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17 }}>{d.name}</div>
                  <div className="mono" style={{ color: "var(--ink-muted)" }}>by {d.chef} · {d.updated}</div>
                </div>
              </div>
              <a className="btn btn-paper btn-sm" href="#chef-recipe">Review →</a>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-eyebrow">community</div>
              <h3 className="card-title">Recent joins</h3>
            </div>
            <a className="btn btn-ghost btn-sm" href="#admin-users">view all</a>
          </div>
          {recent.map(u => (
            <div key={u.id} className="field-row" style={{ alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="avatar-sm">{u.name.charAt(0)}</span>
                <div>
                  <div style={{ fontSize: 14 }}>{u.name}</div>
                  <div className="mono" style={{ color: "var(--ink-muted)" }}>{u.joined}</div>
                </div>
              </div>
              <TagChip tone={"role-" + u.role}>{u.role}</TagChip>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        .stat-card{background:var(--paper);border:1.5px solid var(--ink);border-radius:var(--r-md);
          box-shadow:var(--shadow-pop);padding:18px 20px}
        .stat-num{font-family:var(--serif);font-style:italic;font-size:48px;line-height:1;
          letter-spacing:-0.02em;color:var(--ink);margin:6px 0}
        .stat-delta{font-family:var(--mono);font-size:11px;letter-spacing:0.04em;color:var(--ink-muted)}
        .stat-delta.matcha{color:var(--matcha-deep)}
        .stat-delta.warn{color:var(--berry)}
        .avatar-sm{width:32px;height:32px;border-radius:50%;background:var(--matcha);color:var(--paper);
          display:grid;place-items:center;font-family:var(--serif);font-style:italic;font-size:16px}
      `}</style>
      <div className="spacer" />
    </AdminShell>
  );
}

function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("all");
  const filtered = window.USERS.filter(u => {
    if (role !== "all" && u.role !== role) return false;
    if (query && !(u.name + u.email).toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <AdminShell active="users">
      <PageHeader eyebrow="community" title='<em>Users</em>' sub="People who cook with us." />

      <Toolbar>
        <SearchInput value={query} onChange={setQuery} placeholder="search by name or email…" />
        <div className="toolbar-divider" />
        <Segment value={role} onChange={setRole} options={[
          { value: "all", label: "All" },
          { value: "user", label: "Users" },
          { value: "chef", label: "Chefs" },
          { value: "admin", label: "Admins" },
        ]} />
        <span style={{ flex: 1 }} />
        <span className="toolbar-stat">{filtered.length} of {window.USERS.length}</span>
      </Toolbar>

      <div className="list">
        <div className="list-row head" style={{ gridTemplateColumns: "60px 1.6fr 1fr 90px 90px 110px 50px" }}>
          <span></span><span>Person</span><span>Email</span><span>Role</span>
          <span style={{ textAlign: "right" }}>Saves</span><span>Last active</span><span></span>
        </div>
        {filtered.map(u => (
          <a key={u.id} href="#admin-user" className="list-row" style={{ gridTemplateColumns: "60px 1.6fr 1fr 90px 90px 110px 50px", textDecoration: "none" }}>
            <span className="avatar-sm" style={{ width: 36, height: 36, fontSize: 18 }}>{u.name.charAt(0)}</span>
            <div>
              <div className="list-name" style={{ fontStyle: "normal", fontFamily: "var(--sans)", fontSize: 14, fontWeight: 500 }}>{u.name}</div>
              <div className="list-sub">joined {u.joined}</div>
            </div>
            <span className="mono" style={{ color: "var(--ink-muted)" }}>{u.email}</span>
            <span><TagChip tone={"role-" + u.role}>{u.role}</TagChip></span>
            <span className="mono" style={{ textAlign: "right", color: "var(--ink-muted)" }}>{u.saves}</span>
            <span className="mono" style={{ color: "var(--ink-muted)" }}>{u.last}</span>
            <span style={{ textAlign: "right", color: "var(--ink-faint)" }}>→</span>
          </a>
        ))}
      </div>

      <style>{`
        .avatar-sm{width:32px;height:32px;border-radius:50%;background:var(--matcha);color:var(--paper);
          display:grid;place-items:center;font-family:var(--serif);font-style:italic;font-size:16px}
      `}</style>
    </AdminShell>
  );
}

function AdminUserPage() {
  const u = window.USERS[1];
  const [toast, setToast] = useToast();
  return (
    <AdminShell active="users">
      <PageHeader
        breadcrumb={[
          { label: "admin", href: "#admin" },
          { label: "users", href: "#admin-users" },
          { label: u.name.toLowerCase() },
        ]}
        eyebrow="profile · admin view"
        title={`<em>${u.name.split(' ')[0]}</em> ${u.name.split(' ').slice(1).join(' ')}`}
        actions={<>
          <button className="btn btn-ghost btn-sm" onClick={() => setToast("magic-link sent")}>Send sign-in link</button>
          <button className="btn btn-orange btn-sm" onClick={() => setToast("role updated")}>Save</button>
        </>}
      />

      <div className="resp-2col" style={{ gridTemplateColumns: "1fr 1.4fr" }}>
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
            <span className="avatar-sm" style={{ width: 64, height: 64, fontSize: 32 }}>{u.name.charAt(0)}</span>
            <div>
              <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 24 }}>{u.name}</div>
              <div className="mono" style={{ color: "var(--ink-muted)" }}>{u.email}</div>
            </div>
          </div>
          <div className="field-row"><span className="field-label">Role</span>
            <span className="field-value">
              <TagChip tone={"role-" + u.role}>{u.role}</TagChip>
              <EditPill onClick={() => setToast("role picker")}>change</EditPill>
            </span>
          </div>
          <div className="field-row"><span className="field-label">Joined</span><span className="field-value">{u.joined}</span></div>
          <div className="field-row"><span className="field-label">Last seen</span><span className="field-value">{u.last}</span></div>
          <div className="field-row"><span className="field-label">Sign-in</span><span className="field-value">Magic link · Google</span></div>
          <div style={{ marginTop: 14, padding: 12, background: "var(--berry-soft)", borderRadius: 8, color: "var(--berry)", fontSize: 13 }}>
            Danger zone
            <button className="btn btn-ghost btn-sm" style={{ marginLeft: 12, color: "var(--berry)", borderColor: "var(--berry)" }}>Suspend account</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="card">
            <div className="card-head">
              <div><div className="card-eyebrow">activity</div><h3 className="card-title">last 30 days</h3></div>
            </div>
            <div className="grid-3">
              <div><div className="card-eyebrow">recipes saved</div><div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 32 }}>{u.saves}</div></div>
              <div><div className="card-eyebrow">meals logged</div><div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 32 }}>21</div></div>
              <div><div className="card-eyebrow">markers updated</div><div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 32 }}>3</div></div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div><div className="card-eyebrow">profile</div><h3 className="card-title">food prefs</h3></div>
              <span className="mono" style={{ color: "var(--ink-muted)" }}>read-only</span>
            </div>
            <div className="field-row"><span className="field-label">Diet</span><span className="field-value">vegetarian</span></div>
            <div className="field-row"><span className="field-label">Allergies</span><span className="field-value">peanuts, shellfish</span></div>
            <div className="field-row"><span className="field-label">Goals</span><span className="field-value">high-protein, iron-rich</span></div>
            <div className="field-row"><span className="field-label">Units</span><span className="field-value">metric</span></div>
          </div>
        </div>
      </div>

      <div className="spacer" />
      {toast && <div className="toast">{toast}</div>}
      <style>{`
        .avatar-sm{border-radius:50%;background:var(--matcha);color:var(--paper);
          display:grid;place-items:center;font-family:var(--serif);font-style:italic}
      `}</style>
    </AdminShell>
  );
}

/* ─── User-side: account + profile + dashboard ─── */

function AccountPage() {
  const [toast, setToast] = useToast();
  return (
    <>
      <AppNav active="dashboard" userName="alex" />
      <div className="wrap wrap-narrow">
        <PageHeader eyebrow="settings" title='Your <em>account</em>' sub="Identity, sign-in, and the basics." />

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <div><div className="card-eyebrow">identity</div><h3 className="card-title">who you are</h3></div>
          </div>
          <div className="field-row">
            <span className="field-label">Display name</span>
            <span className="field-value">Alex Chen <EditPill onClick={() => setToast("inline name editor")}>edit</EditPill></span>
          </div>
          <div className="field-row">
            <span className="field-label">Email</span>
            <span className="field-value">alex@gmail.com <span className="mono" style={{ color: "var(--matcha-deep)", marginLeft: 8 }}>verified ✓</span></span>
          </div>
          <div className="field-row">
            <span className="field-label">Biological sex</span>
            <span className="field-value">Female <span className="mono" style={{ color: "var(--ink-faint)", marginLeft: 8 }}>permanent · used for marker ranges</span></span>
          </div>
          <div className="field-row">
            <span className="field-label">Date of birth</span>
            <span className="field-value empty">Not set <EditPill required empty onClick={() => setToast("dob picker")}>set</EditPill></span>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head">
            <div><div className="card-eyebrow">sign-in</div><h3 className="card-title">how you log in</h3></div>
          </div>
          <div className="field-row">
            <span className="field-label">Magic link</span>
            <span className="field-value">enabled (alex@gmail.com)</span>
          </div>
          <div className="field-row">
            <span className="field-label">Google</span>
            <span className="field-value"><button className="btn btn-ghost btn-sm">Connect Google</button></span>
          </div>
        </div>

        <div className="card" style={{ borderColor: "var(--berry)", boxShadow: "3px 3px 0 var(--berry)" }}>
          <div className="card-head">
            <div><div className="card-eyebrow" style={{ color: "var(--berry)" }}>danger zone</div><h3 className="card-title" style={{ color: "var(--berry)" }}>account removal</h3></div>
          </div>
          <p className="muted" style={{ fontSize: 14, marginBottom: 12 }}>
            Deletes saved recipes, cooking sessions, meal logs, and health markers. Cannot be undone.
          </p>
          <button className="btn btn-ghost btn-sm" style={{ color: "var(--berry)", borderColor: "var(--berry)" }}>
            Delete account
          </button>
        </div>

        <div className="spacer" />
      </div>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function ProfilePage() {
  const [toast, setToast] = useToast();
  const [diet, setDiet] = useState("vegetarian");
  const [allergies, setAllergies] = useState(new Set(["peanuts", "shellfish"]));
  const [goals, setGoals] = useState(new Set(["high-protein", "iron-rich"]));
  const [units, setUnits] = useState("metric");

  function toggleSet(setter, set, val) {
    const s = new Set(set);
    if (s.has(val)) s.delete(val); else s.add(val);
    setter(s); setToast("✓ saved");
  }

  const checks = [
    { label: "Diet style", pass: !!diet },
    { label: "Allergies", pass: true },
    { label: "Goals", pass: goals.size > 0 },
    { label: "Units", pass: !!units },
    { label: "DOB", pass: false },
  ];
  const pct = Math.round(checks.filter(c => c.pass).length / checks.length * 100);

  return (
    <>
      <AppNav active="dashboard" userName="alex" />
      <div className="wrap wrap-narrow">
        <PageHeader eyebrow="preferences" title='Your <em>food profile</em>' sub="Powers personalized recipe suggestions and the soft-pref filter." />

        <div className="publish-bar">
          <CompletionRing pct={pct} />
          <div className="publish-bar-text">
            <b>{pct}% complete</b>
            <div className="meta">A complete profile gets more accurate suggestions.</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head"><div><div className="card-eyebrow">diet style</div><h3 className="card-title">how you eat</h3></div></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["omnivore", "vegetarian", "vegan", "pescatarian", "keto"].map(d => (
              <button key={d}
                className={"filter-chip-r " + (diet === d ? "active" : "")}
                onClick={() => { setDiet(d); setToast("✓ saved"); }}
              >{d}</button>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head"><div><div className="card-eyebrow">allergies · safety floor</div><h3 className="card-title">what to avoid</h3></div></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["dairy", "egg", "nuts", "peanuts", "soy", "shellfish", "fish", "gluten", "sesame"].map(a => (
              <button key={a}
                className={"filter-chip-r " + (allergies.has(a) ? "active" : "")}
                onClick={() => toggleSet(setAllergies, allergies, a)}
              >{a}</button>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head"><div><div className="card-eyebrow">goals</div><h3 className="card-title">what you're cooking toward</h3></div></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["high-protein", "iron-rich", "high-fiber", "low-carb", "low-sodium", "weight-loss", "muscle-gain"].map(g => (
              <button key={g}
                className={"filter-chip-r " + (goals.has(g) ? "active" : "")}
                onClick={() => toggleSet(setGoals, goals, g)}
              >{g}</button>
            ))}
          </div>
        </div>

        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-head"><div><div className="card-eyebrow">units</div><h3 className="card-title">how to display measures</h3></div></div>
          <Segment value={units} onChange={(v) => { setUnits(v); setToast("✓ saved"); }}
            options={[{ value: "metric", label: "Metric (g, ml, °C)" }, { value: "us", label: "US (oz, cups, °F)" }]} />
        </div>

        <div className="spacer" />
      </div>
      {toast && <div className="toast">{toast}</div>}
      <style>{`
        .filter-chip-r{padding:5px 12px;border-radius:999px;background:var(--paper);
          border:1px solid var(--rule);font-size:12px;color:var(--ink-soft);cursor:pointer;transition:all 160ms}
        .filter-chip-r:hover{background:var(--cream-deep)}
        .filter-chip-r.active{background:var(--ink);color:var(--paper);border-color:var(--ink)}
      `}</style>
    </>
  );
}

function DashboardPage() {
  const recs = window.RECIPES.slice(0, 6);
  const saved = window.RECIPES.filter(r => r.saved).slice(0, 4);
  return (
    <>
      <AppNav active="dashboard" userName="alex" />
      <div className="wrap">
        <PageHeader eyebrow="welcome back" title='<em>Hi,</em> Alex' sub="Your kitchen, today." />

        <div className="resp-2col" style={{ gridTemplateColumns: "1.6fr 1fr", marginBottom: 24 }}>
          <div className="card">
            <div className="card-head">
              <div><div className="card-eyebrow">for you · matched to your markers</div><h3 className="card-title">Today's picks</h3></div>
              <a className="btn btn-ghost btn-sm" href="#recipe-search">browse all →</a>
            </div>
            <div className="grid-3">
              {recs.slice(0, 3).map(r => (
                <a key={r.id} href="#" className="rec-tile">
                  <ImgPh label={r.emoji} ratio="4/3" />
                  <div style={{ padding: "10px 4px 0" }}>
                    <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16, lineHeight: 1.2 }}>{r.name}</div>
                    <div className="mono" style={{ color: "var(--ink-muted)", marginTop: 4 }}>{r.totalMinutes}m · {r.cuisine}</div>
                  </div>
                </a>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><div><div className="card-eyebrow">saved</div><h3 className="card-title">{saved.length} recipes</h3></div></div>
            {saved.map(r => (
              <a key={r.id} href="#" className="field-row" style={{ alignItems: "center", textDecoration: "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <ImgPh label={r.emoji} ratio="1/1" style={{ width: 36, height: 36, borderRadius: 8 }} />
                  <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16 }}>{r.name}</div>
                </div>
                <span className="mono" style={{ color: "var(--ink-muted)" }}>{r.totalMinutes}m</span>
              </a>
            ))}
          </div>
        </div>

        <div className="resp-2col" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="card">
            <div className="card-head"><div><div className="card-eyebrow">health markers</div><h3 className="card-title">latest readings</h3></div>
              <a className="btn btn-ghost btn-sm" href="#markers">manage →</a></div>
            <div className="grid-3">
              {[
                { name: "Iron, Fe", val: 102, unit: "µg/dL", tone: "matcha" },
                { name: "Ferritin", val: 58, unit: "ng/mL", tone: "matcha" },
                { name: "Vit D", val: 24, unit: "ng/mL", tone: "warn" },
              ].map(m => (
                <div key={m.name}>
                  <div className="card-eyebrow">{m.name}</div>
                  <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 28, color: m.tone === "warn" ? "var(--berry)" : "var(--matcha-deep)" }}>{m.val}</div>
                  <div className="mono" style={{ color: "var(--ink-faint)" }}>{m.unit}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-head"><div><div className="card-eyebrow">this week</div><h3 className="card-title">meals logged</h3></div></div>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end", height: 120 }}>
              {[3, 2, 4, 3, 5, 1, 2].map((v, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end" }}>
                    <div style={{ width: "100%", height: `${v * 18}px`, background: "var(--orange)", borderRadius: "4px 4px 0 0" }} />
                  </div>
                  <span className="mono" style={{ color: "var(--ink-muted)" }}>{["M","T","W","T","F","S","S"][i]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="spacer" />
      </div>
      <style>{`
        .rec-tile{display:block;text-decoration:none;color:inherit;border-radius:var(--r-md);
          padding:8px;transition:background 140ms}
        .rec-tile:hover{background:var(--cream-soft)}
      `}</style>
    </>
  );
}

Object.assign(window, {
  AdminDashboardPage, AdminUsersPage, AdminUserPage,
  AccountPage, ProfilePage, DashboardPage,
});
