/* UTENSILS — list + WYSIWYG detail (the editor IS the public detail page,
   inline edit pills swap copy & metadata in place). */

const ADMIN_NAV = [
  { id: "dashboard", label: "Dashboard",   icon: "◈", href: "#admin",        count: null },
  { id: "ingredients", label: "Ingredients", icon: "◉", href: "#admin-ingredients", count: 248 },
  { id: "utensils",    label: "Utensils",    icon: "◐", href: "#admin-utensils",    count: 36 },
  { id: "users",       label: "Users",       icon: "◔", href: "#admin-users",       count: 142 },
];

function AdminShell({ active, role = "admin", userName = "jordan", children }) {
  return (
    <>
      <AppNav active="recipes" role={role} userName={userName} />
      <div className="wrap">
        <div className="shell">
          <SideNav active={active} items={ADMIN_NAV} sectionLabel="Admin" />
          <div>{children}</div>
        </div>
      </div>
    </>
  );
}

function AdminUtensilsPage() {
  const [query, setQuery] = useState("");
  const [cat, setCat] = useState("all");
  const cats = ["all", ...Array.from(new Set(window.UTENSILS.map(u => u.category)))];
  const filtered = window.UTENSILS.filter(u => {
    if (cat !== "all" && u.category !== cat) return false;
    if (query && !u.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <AdminShell active="utensils">
      <PageHeader
        eyebrow="library"
        title='<em>Utensils</em>'
        sub="Cookware, tools, and gadgets recipes can reference."
        actions={<a className="btn btn-orange" href="#admin-utensil">+ New utensil</a>}
      />

      <Toolbar>
        <SearchInput value={query} onChange={setQuery} placeholder="search utensils…" />
        <div className="toolbar-divider" />
        <select className="cuisine-select" value={cat} onChange={e => setCat(e.target.value)}>
          {cats.map(c => <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <span className="toolbar-stat">{filtered.length} of {window.UTENSILS.length}</span>
      </Toolbar>

      <div className="list">
        <div className="list-row head" style={{ gridTemplateColumns: "60px 1fr 110px 130px 90px 50px" }}>
          <span></span><span>Utensil</span><span>Category</span><span>Price range</span>
          <span style={{ textAlign: "right" }}>Used in</span><span></span>
        </div>
        {filtered.map(u => (
          <a key={u.id} href="#admin-utensil" className="list-row" style={{ gridTemplateColumns: "60px 1fr 110px 130px 90px 50px", textDecoration: "none" }}>
            <ImgPh label={u.emoji} ratio="1/1" style={{ width: 44, height: 44, borderRadius: 8 }} />
            <div>
              <div className="list-name">{u.name}</div>
              <div className="list-sub">{u.category}</div>
            </div>
            <span><TagChip>{u.category}</TagChip></span>
            <span className="mono" style={{ color: "var(--ink-muted)" }}>{u.price}</span>
            <span className="mono" style={{ textAlign: "right", color: "var(--ink-muted)" }}>{u.uses} recipes</span>
            <span style={{ textAlign: "right", color: "var(--ink-faint)" }}>→</span>
          </a>
        ))}
      </div>
    </AdminShell>
  );
}

function AdminUtensilPage() {
  const [u, setU] = useState({
    name: "Cast iron skillet, 12\"",
    category: "Pan",
    description: "A workhorse pan that takes high heat, browns deeply, and lasts a lifetime.",
    careNotes: "Hand wash, dry on the stove, wipe with a thin film of neutral oil.",
    hero: true,
    price: "$45–$80",
    weight: "5.6 lbs",
    material: "Pre-seasoned cast iron",
    diameter: "12 in / 30 cm",
    buyLinks: [
      { name: "Lodge", url: "lodgecastiron.com" },
      { name: "Field", url: "fieldcompany.com" },
    ],
  });
  const [toast, setToast] = useToast();
  function patch(p) { setU(prev => ({ ...prev, ...p })); setToast("✓ saved"); }

  return (
    <AdminShell active="utensils">
      <PageHeader
        breadcrumb={[
          { label: "admin", href: "#admin" },
          { label: "utensils", href: "#admin-utensils" },
          { label: u.name.toLowerCase() },
        ]}
        eyebrow="editing — wysiwyg"
        title={`<em>Edit</em> · ${u.name}`}
        actions={<>
          <button className="btn btn-ghost btn-sm">Preview public</button>
          <button className="btn btn-orange btn-sm" onClick={() => setToast("✓ saved & published")}>Save & publish</button>
        </>}
      />

      <PublishBar
        pct={92}
        missing={[]}
        status="published"
        label="Utensil"
        onPublish={() => setToast("✓ updated")}
      />

      {/* WYSIWYG: this layout IS what users see on the public detail page,
          with edit pills overlaid in place of form inputs. */}
      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="resp-2col" style={{ gridTemplateColumns: "1fr 1fr", gap: 0 }}>
          <div style={{ position: "relative", borderRight: "1px solid var(--rule)" }}>
            <ImgPh label="utensil photo · ¾ view" ratio="1/1" style={{ borderRadius: 0 }} />
            <button
              className="edit-pill"
              style={{ position: "absolute", top: 12, right: 12, background: "rgba(255,252,243,0.94)" }}
              onClick={() => setToast("opens replace-image flow")}
            ><span className="pencil">✎</span>Replace</button>
          </div>
          <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="card-eyebrow">{u.category} · for the kitchen
              <EditPill onClick={() => setToast("category picker")}>category</EditPill>
            </div>
            <h2 style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 36, lineHeight: 1.05 }}>
              {u.name}
              <EditPill onClick={() => setToast("inline title editor")}>title</EditPill>
            </h2>
            <p style={{ color: "var(--ink-soft)", fontSize: 15.5 }}>
              {u.description}
              <EditPill onClick={() => setToast("inline description editor")}>desc</EditPill>
            </p>

            <div className="field-row" style={{ marginTop: 8 }}>
              <span className="field-label">Material</span>
              <span className="field-value">{u.material} <EditPill onClick={() => setToast("edit material")}>edit</EditPill></span>
            </div>
            <div className="field-row">
              <span className="field-label">Diameter</span>
              <span className="field-value">{u.diameter} <EditPill onClick={() => setToast("edit diameter")}>edit</EditPill></span>
            </div>
            <div className="field-row">
              <span className="field-label">Weight</span>
              <span className="field-value">{u.weight} <EditPill onClick={() => setToast("edit weight")}>edit</EditPill></span>
            </div>
            <div className="field-row">
              <span className="field-label">Price range</span>
              <span className="field-value">{u.price} <EditPill onClick={() => setToast("edit price")}>edit</EditPill></span>
            </div>
          </div>
        </div>

        <div style={{ padding: 28, borderTop: "1px solid var(--rule)" }}>
          <div className="card-eyebrow" style={{ marginBottom: 8 }}>care notes</div>
          <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, lineHeight: 1.4, color: "var(--ink-soft)" }}>
            "{u.careNotes}"
            <EditPill onClick={() => setToast("inline care editor")}>edit</EditPill>
          </p>
        </div>

        <div style={{ padding: 28, borderTop: "1px solid var(--rule)", background: "var(--cream-soft)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div className="card-eyebrow">where to buy</div>
              <h3 className="card-title">{u.buyLinks.length} retailers</h3>
            </div>
            <EditPill onClick={() => setToast("add retailer link")}>+ add</EditPill>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {u.buyLinks.map((b, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: "var(--paper)", border: "1px solid var(--rule)", borderRadius: 8 }}>
                <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17 }}>{b.name}</span>
                <span className="mono" style={{ color: "var(--ink-muted)" }}>{b.url}</span>
                <span style={{ flex: 1 }} />
                <EditPill onClick={() => setToast("edit link")}>edit</EditPill>
                <button className="btn btn-ghost btn-sm" onClick={() => setToast("removed (mock)")}>×</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="spacer" />
      {toast && <div className="toast">{toast}</div>}
      <div className="wysiwyg-flag">
        <span className="pulse" />
        WYSIWYG editing — what you see is what's published
      </div>
    </AdminShell>
  );
}

window.AdminUtensilsPage = AdminUtensilsPage;
window.AdminUtensilPage = AdminUtensilPage;
