/* CHEF PAGES — recipes list + WYSIWYG inline-edit recipe page.
   Mirrors the look of the public recipe page; replaces forms with edit pills. */

function ChefRecipesPage() {
  const allMine = window.RECIPES.slice(0, 12).map((r, i) => ({
    ...r,
    status: i % 5 === 0 ? "draft" : "published",
    completion: [100, 100, 100, 64, 100, 100, 90, 100, 100, 42, 100, 100][i % 12],
  }));
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = allMine.filter(r => {
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (query && !r.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <>
      <AppNav active="recipes" role="chef" userName="ravi" />
      <div className="wrap">
        <PageHeader
          eyebrow="chef portal"
          title='Your <em>recipes</em>'
          sub="Edit, publish, and track your published dishes."
          actions={
            <>
              <button className="btn btn-ghost">Import .json</button>
              <a className="btn btn-orange" href="#chef-recipe">+ New recipe</a>
            </>
          }
        />

        <Toolbar>
          <SearchInput value={query} onChange={setQuery} placeholder="search your recipes…" />
          <div className="toolbar-divider" />
          <Segment value={statusFilter} onChange={setStatusFilter} options={[
            { value: "all", label: "All" },
            { value: "published", label: "Published" },
            { value: "draft", label: "Draft" },
          ]} />
          <span style={{ flex: 1 }} />
          <span className="toolbar-stat">{filtered.length} of {allMine.length}</span>
        </Toolbar>

        <div className="list">
          <div className="list-row head" style={{ gridTemplateColumns: "60px 1fr 90px 110px 120px 80px 60px" }}>
            <span></span>
            <span>Recipe</span>
            <span>Status</span>
            <span>Completion</span>
            <span>Updated</span>
            <span style={{ textAlign: "right" }}>Views</span>
            <span></span>
          </div>
          {filtered.map(r => (
            <a key={r.id} href="#chef-recipe" className="list-row" style={{ gridTemplateColumns: "60px 1fr 90px 110px 120px 80px 60px", textDecoration: "none" }}>
              <ImgPh label={r.emoji} ratio="1/1" style={{ width: 44, height: 44, borderRadius: 8 }} />
              <div>
                <div className="list-name">{r.name}</div>
                <div className="list-sub">{r.cuisine} · {r.totalMinutes} min · {r.difficulty}</div>
              </div>
              <span><TagChip tone={r.status === "published" ? "published" : "draft"}>{r.status}</TagChip></span>
              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <CompletionRing pct={r.completion} size={28} stroke={3} />
              </span>
              <span className="mono" style={{ color: "var(--ink-muted)" }}>{r.updated}</span>
              <span className="mono" style={{ textAlign: "right", color: "var(--ink-muted)" }}>{r.views.toLocaleString()}</span>
              <span style={{ textAlign: "right", color: "var(--ink-faint)" }}>→</span>
            </a>
          ))}
        </div>

        <div className="spacer" />
      </div>
    </>
  );
}

/* ─── WYSIWYG recipe editor — looks like the recipe page,
       but every field is an EditPill instead of a form input. ─── */

function ChefRecipePage() {
  const [recipe, setRecipe] = useState({
    name: "Saffron Butter Biryani",
    cuisine: "Indian",
    difficulty: "Medium",
    totalMinutes: 55,
    serves: 4,
    tagline: "Layered basmati, slow-bloomed saffron, ghee finish.",
    hero: false,           // intentionally missing → completion warning
    ingredients: [
      { name: "Basmati rice", qty: "2 cups" },
      { name: "Ghee", qty: "3 tbsp" },
      { name: "Saffron", qty: "a pinch" },
      { name: "Yogurt", qty: "½ cup" },
      { name: "Yellow onion, sliced", qty: "2 large" },
    ],
    steps: [
      { title: "Bloom the saffron", body: "Steep saffron in ¼ cup warm milk for 10 minutes." },
      { title: "Crisp the onions", body: "In ghee, fry onions until deep amber. Reserve half." },
      { title: "Layer + dum", body: "Layer rice, onions, yogurt; cover; cook on low 25 min." },
    ],
    tags: ["vegetarian", "festive"],
    health: [],
    utensils: ["u1", "u3"],
  });
  const [toast, setToast] = useToast();
  const [openUtensil, setOpenUtensil] = useState(null);
  const utensilDetails = {
    u1: {
      id: "u1", name: "Cast iron skillet, 12\"", category: "Pan", emoji: "🍳",
      tagline: "A workhorse that takes high heat, browns deeply, lasts a lifetime.",
      material: "Pre-seasoned cast iron",
      diameter: "12 in / 30 cm",
      weight: "5.6 lbs",
      price: "$45–$80",
      care: "Hand wash, dry on the stove, wipe with a thin film of neutral oil.",
      buy: [
        { name: "Lodge", url: "lodgecastiron.com" },
        { name: "Field", url: "fieldcompany.com" },
      ],
    },
    u3: {
      id: "u3", name: "Chef's knife, 8\"", category: "Knife", emoji: "🔪",
      tagline: "The one knife that does 90% of the work in any kitchen.",
      material: "High-carbon stainless steel",
      diameter: "8 in blade / 20 cm",
      weight: "0.5 lbs",
      price: "$60–$200",
      care: "Hand wash and dry immediately. Hone weekly, sharpen yearly.",
      buy: [
        { name: "Misono", url: "misono.com" },
        { name: "Wüsthof", url: "wusthof.com" },
      ],
    },
  };

  // completion calc
  const checks = [
    { key: "hero", label: "Hero image", pass: !!recipe.hero, required: true },
    { key: "name", label: "Title", pass: !!recipe.name, required: true },
    { key: "tagline", label: "Tagline", pass: !!recipe.tagline, required: true },
    { key: "ingredients", label: "Ingredients", pass: recipe.ingredients.length >= 3, required: true },
    { key: "steps", label: "Steps", pass: recipe.steps.length >= 3, required: true },
    { key: "tags", label: "Tags", pass: recipe.tags.length > 0, required: false },
    { key: "health", label: "Health facts", pass: recipe.health.length > 0, required: false },
    { key: "utensils", label: "Utensils", pass: recipe.utensils.length > 0, required: false },
  ];
  const passed = checks.filter(c => c.pass).length;
  const pct = Math.round((passed / checks.length) * 100);
  const missing = checks.filter(c => c.required && !c.pass).map(c => c.label);

  function setField(k, v) {
    setRecipe(r => ({ ...r, [k]: v }));
    setToast("✓ saved");
  }

  return (
    <>
      <AppNav active="recipes" role="chef" userName="ravi" />
      <div className="wrap wrap-narrow">
        <PageHeader
          breadcrumb={[
            { label: "chef", href: "#chef-recipes" },
            { label: "recipes", href: "#chef-recipes" },
            { label: recipe.name.toLowerCase() },
          ]}
          eyebrow="editing — wysiwyg"
          title={`<em>Edit</em> ${recipe.name}`}
        />

        <PublishBar pct={pct} missing={missing} status="draft" onPublish={() => setToast("✓ published")} />

        {/* HERO — looks like the recipe page hero, with an overlay edit pill */}
        <div className="r-hero card" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
          <div style={{ position: "relative" }}>
            {recipe.hero ? (
              <ImgPh label="hero photo" ratio="16/9" />
            ) : (
              <div style={{ aspectRatio: "16/9", display: "grid", placeItems: "center", background: "var(--berry-soft)", color: "var(--berry)", border: "1.5px dashed var(--berry)" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>🖼</div>
                  <div className="mono">No hero image yet</div>
                  <button
                    className="btn btn-paper btn-sm" style={{ marginTop: 12 }}
                    onClick={() => setField("hero", true)}
                  >Drop or upload hero image</button>
                </div>
              </div>
            )}
            {recipe.hero && (
              <button
                className="edit-pill"
                style={{ position: "absolute", top: 12, right: 12, background: "rgba(255,252,243,0.94)" }}
                onClick={() => setField("hero", false)}
              >
                <span className="pencil">✎</span>Replace
              </button>
            )}
          </div>
          <div style={{ padding: 24 }}>
            <div className="card-eyebrow" style={{ marginBottom: 8 }}>
              {recipe.cuisine} · {recipe.totalMinutes} min · {recipe.difficulty} · serves {recipe.serves}
              <span style={{ marginLeft: 10 }}>
                <EditPill onClick={() => setToast("opens cuisine/time/difficulty modal")}>meta</EditPill>
              </span>
            </div>
            <h2 style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 44, lineHeight: 1.05 }}>
              {recipe.name}
              <EditPill onClick={() => setToast("inline title editor")}>title</EditPill>
            </h2>
            <p style={{ marginTop: 10, color: "var(--ink-soft)", fontSize: 16 }}>
              {recipe.tagline}
              <EditPill onClick={() => setToast("inline tagline editor")}>tagline</EditPill>
            </p>
          </div>
        </div>

        <div className="resp-2col" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
          {/* STEPS */}
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-eyebrow">cooking steps</div>
                <h3 className="card-title">{recipe.steps.length} steps</h3>
              </div>
              <EditPill onClick={() => setToast("opens drag-to-reorder + add step")}>reorder · add</EditPill>
            </div>
            {recipe.steps.map((s, i) => (
              <div key={i} className="step-row">
                <div className="step-num">{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 19 }}>{s.title}</div>
                  <div style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 4 }}>{s.body}</div>
                </div>
                <EditPill onClick={() => setToast("inline step editor")}>edit</EditPill>
              </div>
            ))}
            <button
              className="btn btn-ghost btn-sm" style={{ width: "100%", marginTop: 10 }}
              onClick={() => {
                setField("steps", [...recipe.steps, { title: "New step", body: "Describe what to do." }]);
              }}
            >+ Add step</button>
          </div>

          {/* RIGHT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">ingredients</div>
                  <h3 className="card-title">{recipe.ingredients.length} items</h3>
                </div>
                <EditPill onClick={() => setToast("opens ingredient picker (admin library)")}>add · edit</EditPill>
              </div>
              {recipe.ingredients.map((ing, i) => (
                <div key={i} className="field-row">
                  <span className="field-value">{ing.name}</span>
                  <span className="mono" style={{ color: "var(--ink-muted)" }}>{ing.qty}</span>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">utensils</div>
                  <h3 className="card-title">tools used</h3>
                </div>
                <EditPill required empty={recipe.utensils.length === 0} onClick={() => setToast("opens utensil picker")}>
                  + add
                </EditPill>
              </div>
              {recipe.utensils.length === 0 ? (
                <div className="muted" style={{ fontSize: 13, fontStyle: "italic" }}>
                  No utensils linked yet.
                </div>
              ) : (
                <div className="utensil-grid">
                  {recipe.utensils.map(uid => {
                    const u = utensilDetails[uid];
                    return (
                      <button key={uid} className="utensil-tile" onClick={() => setOpenUtensil(u)}>
                        <ImgPh label={u.emoji} ratio="1/1" className="ut-img" />
                        <div className="ut-body">
                          <div className="ut-name">{u.name}</div>
                          <div className="ut-cat mono">{u.category}</div>
                        </div>
                        <span className="ut-arrow">→</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">tags</div>
                  <h3 className="card-title">discovery</h3>
                </div>
                <EditPill onClick={() => setToast("tag editor")}>edit</EditPill>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {recipe.tags.map(t => <TagChip key={t} tone={t === "vegetarian" ? "veg" : ""}>{t}</TagChip>)}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-eyebrow">health facts</div>
                  <h3 className="card-title">nutrition · markers</h3>
                </div>
                <EditPill onClick={() => setToast("link FDC ingredients to compute")}>compute</EditPill>
              </div>
              <div className="muted" style={{ fontSize: 13, fontStyle: "italic" }}>
                Auto-derived from linked ingredients.
              </div>
            </div>
          </div>
        </div>

        <div className="spacer" />
      </div>

      {toast && <div className="toast">{toast}</div>}

      {openUtensil && (
        <div className="ut-modal-bd" onClick={() => setOpenUtensil(null)}>
          <div className="ut-modal" onClick={e => e.stopPropagation()}>
            <button className="ut-close" onClick={() => setOpenUtensil(null)} aria-label="Close">×</button>
            <div className="ut-hero">
              <ImgPh label={openUtensil.emoji + "  " + openUtensil.name} ratio="4/3" style={{ borderRadius: 0 }} />
              <span className="ut-cat-pill mono">{openUtensil.category}</span>
            </div>
            <div className="ut-content">
              <h3 className="ut-title">{openUtensil.name}</h3>
              <p className="ut-tag">"{openUtensil.tagline}"</p>
              <div className="ut-specs">
                <div className="ut-spec"><span className="field-label">Material</span><span>{openUtensil.material}</span></div>
                <div className="ut-spec"><span className="field-label">Size</span><span>{openUtensil.diameter}</span></div>
                <div className="ut-spec"><span className="field-label">Weight</span><span>{openUtensil.weight}</span></div>
                <div className="ut-spec"><span className="field-label">Price</span><span>{openUtensil.price}</span></div>
              </div>
              <div className="ut-care">
                <div className="card-eyebrow" style={{ marginBottom: 6 }}>care</div>
                <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17, color: "var(--ink-soft)", lineHeight: 1.4 }}>
                  {openUtensil.care}
                </p>
              </div>
              <div className="ut-buy">
                <div className="card-eyebrow" style={{ marginBottom: 8 }}>where to buy</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {openUtensil.buy.map(b => (
                    <a key={b.name} href={"https://" + b.url} target="_blank" rel="noopener" className="ut-buy-link">
                      <span style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17 }}>{b.name}</span>
                      <span className="mono" style={{ color: "var(--ink-muted)" }}>{b.url}</span>
                      <span style={{ marginLeft: "auto", color: "var(--orange-deep)" }}>↗</span>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .step-row{display:flex;gap:14px;align-items:flex-start;padding:14px 0;
          border-bottom:1px dashed var(--rule)}
        .step-row:last-of-type{border-bottom:none}
        .step-num{width:32px;height:32px;border-radius:50%;background:var(--orange);
          color:var(--paper);display:grid;place-items:center;font-family:var(--mono);
          font-size:13px;font-weight:600;flex-shrink:0}

        .utensil-grid{display:grid;gap:8px}
        .utensil-tile{display:flex;align-items:center;gap:12px;padding:8px 12px 8px 8px;
          background:var(--cream-soft);border:1px solid var(--rule);border-radius:10px;
          cursor:pointer;transition:transform 160ms cubic-bezier(.2,.8,.2,1),
            background 160ms,border-color 160ms,box-shadow 160ms;text-align:left;width:100%}
        .utensil-tile:hover{background:var(--paper);border-color:var(--ink);
          transform:translate(-1px,-1px);box-shadow:2px 2px 0 var(--ink)}
        .utensil-tile .ut-img{width:48px;height:48px;flex-shrink:0;border-radius:8px}
        .utensil-tile .ut-body{flex:1;min-width:0}
        .utensil-tile .ut-name{font-family:var(--serif);font-style:italic;font-size:17px;
          line-height:1.15;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .utensil-tile .ut-cat{font-size:10.5px;letter-spacing:0.06em;
          text-transform:uppercase;color:var(--ink-muted);margin-top:2px}
        .utensil-tile .ut-arrow{color:var(--ink-faint);font-size:14px;transition:color 160ms,transform 160ms}
        .utensil-tile:hover .ut-arrow{color:var(--orange-deep);transform:translateX(2px)}

        .ut-modal-bd{position:fixed;inset:0;z-index:300;background:rgba(31,26,20,.55);
          display:grid;place-items:center;padding:20px;animation:fade 200ms ease}
        @keyframes fade{from{opacity:0}to{opacity:1}}
        .ut-modal{background:var(--paper);border:1.5px solid var(--ink);border-radius:var(--r-lg);
          box-shadow:6px 6px 0 var(--ink);max-width:480px;width:100%;
          max-height:min(86vh,720px);display:flex;flex-direction:column;overflow:hidden;
          position:relative;animation:pop 240ms cubic-bezier(.2,.8,.2,1)}
        @keyframes pop{from{transform:translateY(8px) scale(.98);opacity:0}to{transform:none;opacity:1}}
        .ut-close{position:absolute;top:12px;right:12px;z-index:2;width:30px;height:30px;
          border-radius:50%;background:var(--paper);border:1px solid var(--ink);font-size:17px;
          line-height:1;display:grid;place-items:center;cursor:pointer}
        .ut-close:hover{background:var(--ink);color:var(--paper)}
        .ut-hero{position:relative;border-bottom:1.5px solid var(--ink);flex-shrink:0}
        .ut-hero .img-ph{aspect-ratio:21/9 !important}
        .ut-cat-pill{position:absolute;top:12px;left:12px;padding:3px 9px;border-radius:999px;
          background:var(--paper);border:1px solid var(--ink);font-size:10px;
          text-transform:uppercase;letter-spacing:0.08em;color:var(--ink)}
        .ut-content{padding:18px 20px 20px;overflow-y:auto;overflow-x:hidden;
          scrollbar-width:thin;scrollbar-color:var(--rule-strong) transparent}
        .ut-content::-webkit-scrollbar{width:6px}
        .ut-content::-webkit-scrollbar-track{background:transparent}
        .ut-content::-webkit-scrollbar-thumb{background:var(--rule-strong);border-radius:3px}
        .ut-content::-webkit-scrollbar-thumb:hover{background:var(--ink-faint)}
        .ut-title{font-family:var(--serif);font-style:italic;font-size:26px;line-height:1.05;
          margin-bottom:6px}
        .ut-tag{font-family:var(--serif);font-style:italic;font-size:15px;color:var(--ink-soft);
          line-height:1.4;margin-bottom:14px;padding-left:12px;border-left:2px solid var(--orange)}
        .ut-specs{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;margin-bottom:14px;
          padding:10px 0;border-top:1px dashed var(--rule);border-bottom:1px dashed var(--rule)}
        .ut-spec{display:flex;flex-direction:column;gap:2px;padding:4px 0}
        .ut-spec span:last-child{font-size:13px;color:var(--ink)}
        .ut-care{margin-bottom:14px}
        .ut-care p{font-size:14.5px !important}
        .ut-buy-link{display:flex;align-items:center;gap:10px;padding:8px 12px;
          background:var(--cream-soft);border:1px solid var(--rule);border-radius:8px;
          transition:all 160ms;text-decoration:none;color:inherit}
        .ut-buy-link:hover{background:var(--orange-soft);border-color:var(--orange);
          transform:translateX(2px)}
        .ut-buy-link span:first-child{font-size:15px !important}
        @media(max-width:520px){
          .ut-modal-bd{padding:12px;align-items:flex-end}
          .ut-modal{max-height:min(82vh,640px);border-radius:var(--r-md)}
          .ut-specs{grid-template-columns:1fr;gap:0}
          .ut-content{padding:16px}
          .ut-title{font-size:22px}
        }
      `}</style>
    </>
  );
}

window.ChefRecipesPage = ChefRecipesPage;
window.ChefRecipePage = ChefRecipePage;
