/* global React */
const { useState, useMemo } = React;
const { Nav, Footer, AuthModal, useUser, useRoute, navigate, BrandMark } = window.MFC_CHROME;
const D = window.MFC_DATA;

// ============================================================
// Recipe Search Page
// ============================================================
function RecipeSearchPage() {
  const route = useRoute();
  const initialQ = route.params.get("q") || "";
  const initialF = route.params.get("filter") || "";
  const [q, setQ] = useState(initialQ);
  const [filter, setFilter] = useState(initialF);

  const FILTERS = [
    { label: "All", value: "" },
    { label: "Vegetarian", value: "vegetarian" },
    { label: "Non-veg", value: "non-veg" },
    { label: "Easy", value: "easy" },
    { label: "Under 30 min", value: "quick" },
    { label: "High-protein", value: "high-protein" },
  ];

  const filtered = useMemo(() => {
    let list = D.RECIPES;
    if (filter === "vegetarian") list = list.filter(r => r.tags.includes("vegetarian") || r.tags.includes("vegan"));
    else if (filter === "non-veg") list = list.filter(r => r.tags.includes("non-veg"));
    else if (filter === "easy") list = list.filter(r => r.difficulty === "Easy");
    else if (filter === "quick") list = list.filter(r => r.minutes <= 30);
    else if (filter === "high-protein") list = list.filter(r => r.tags.includes("high-protein"));
    if (q.trim()) {
      const qq = q.toLowerCase();
      list = list.filter(r =>
        r.name.toLowerCase().includes(qq) ||
        r.cuisine.toLowerCase().includes(qq) ||
        r.tagline.toLowerCase().includes(qq)
      );
    }
    return list;
  }, [q, filter]);

  const featured = D.RECIPES.filter(r => r.featured);
  const searching = q.trim() !== "" || filter !== "";

  return (
    <>
      {/* Search Hero */}
      <section style={{ padding: "72px 0 44px", textAlign: "center", position: "relative", zIndex: 2 }}>
        <div className="wrap">
          <div className="pill" style={{ marginBottom: 22 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--orange)", boxShadow: "0 0 0 3px var(--orange-soft)", animation: "pulse-mini 1.6s ease-in-out infinite" }} />
            10 RECIPES · GUIDED COOKING · NUTRITION INSIGHTS
          </div>
          <h1 style={{ fontFamily: "var(--sans)", fontWeight: 500, fontSize: "clamp(42px,5.8vw,76px)", lineHeight: 1, letterSpacing: "-0.035em", marginBottom: 14 }}>
            Find what you're <em style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, color: "var(--orange)" }}>craving.</em>
          </h1>
          <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, color: "var(--ink-soft)" }}>
            Cook it with confidence.
          </p>

          <div className="search-hero-box">
            <input
              className="search-input"
              placeholder="biryani, paneer, dosa, ricotta…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && <button className="search-clear" onClick={() => setQ("")}>✕</button>}
            <button className="search-submit" aria-label="Search">↵</button>
          </div>

          <div className="filter-row">
            {FILTERS.map(f => (
              <button
                key={f.value}
                className={"filter-chip" + (filter === f.value ? " active" : "")}
                onClick={() => setFilter(f.value)}
              >{f.label}</button>
            ))}
          </div>
        </div>
      </section>

      {!searching && (
        <section className="section">
          <div className="wrap">
            <div className="section-head">
              <div>
                <div className="section-label">featured picks</div>
                <h2>Start with <em>these.</em></h2>
              </div>
              <span className="pill">{featured.length} hand-picked</span>
            </div>
            <div className="featured-grid">
              {featured.map(r => <FeaturedCard key={r.id} recipe={r} />)}
            </div>
          </div>
        </section>
      )}

      <hr style={{ border: "none", borderTop: "1px dashed var(--rule-strong)", margin: "0 28px", maxWidth: "var(--container)", marginLeft: "auto", marginRight: "auto" }} />

      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <div className="section-label">{searching ? "search results" : "all recipes"}</div>
              <h2>
                {searching ? <><em>Results</em> for "{q || filter}"</> : <><em>All</em> 10 recipes</>}
              </h2>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="pill">{filtered.length} of {D.RECIPES.length}</span>
              <SortDropdown />
            </div>
          </div>

          {filtered.length > 0 ? (
            <div className="recipe-list">
              {filtered.map(r => <RecipeRow key={r.id} recipe={r} />)}
            </div>
          ) : (
            <div className="no-results card flat" style={{ textAlign: "center", padding: "72px 24px" }}>
              <span className="footer-scribble" style={{ fontSize: 44, marginBottom: 8, display: "block" }}>¯\_(ツ)_/¯</span>
              <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 24, color: "var(--ink-soft)" }}>
                No recipes matched "{q}". Try something else.
              </p>
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function SortDropdown() {
  const [open, setOpen] = useState(false);
  const [sort, setSort] = useState("newest");
  const labels = { newest: "Newest", quickest: "Quickest", easiest: "Easiest" };
  return (
    <div style={{ position: "relative" }}>
      <button className="pill" style={{ cursor: "pointer", paddingRight: 16 }} onClick={() => setOpen(o => !o)}>
        sort: {labels[sort]} ⌄
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", right: 0, top: "100%", marginTop: 6, padding: 6, minWidth: 140, zIndex: 20 }}>
          {Object.entries(labels).map(([k, v]) => (
            <button
              key={k}
              onClick={() => { setSort(k); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 8, fontSize: 13, background: sort === k ? "var(--cream-deep)" : "transparent" }}
            >{v}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function FeaturedCard({ recipe }) {
  return (
    <a className="featured-card card lift" href={"#/recipe/" + recipe.id} onClick={(e) => { e.preventDefault(); }}>
      <div className="fc-top" style={{ background: recipe.colorSoft }}>
        <img src={recipe.image} alt={recipe.name} className="fc-image" />
        <span className="fc-cuisine">{recipe.cuisine}</span>
        <span className="fc-difficulty">{recipe.difficulty}</span>
      </div>
      <div className="fc-body">
        <h3 className="fc-name">{recipe.name}</h3>
        <p className="fc-tagline">{recipe.tagline}</p>
        <div className="fc-meta">
          <span>⏱ {recipe.minutes} MIN</span>
          <span>·</span>
          <span>👥 {recipe.servings} SERVINGS</span>
        </div>
        <div className="fc-tags">
          {recipe.tags.map(t => (
            <span key={t} className={"tag-pill " + (t === "non-veg" ? "nonveg" : "veg")}>{t}</span>
          ))}
        </div>
        <div className="fc-highlight">
          <span style={{ color: "var(--matcha)" }}>✦</span> {recipe.highlight}
        </div>
      </div>
      <div className="fc-cta">
        <span>Cook it now</span>
        <span>→</span>
      </div>
    </a>
  );
}

function RecipeRow({ recipe }) {
  const user = useUser();
  const saved = user && D.SAVED.includes(recipe.id);
  return (
    <a className="recipe-row card lift" href={"#/recipe/" + recipe.id} onClick={(e) => { e.preventDefault(); }}>
      <div className="rr-img" style={{ background: recipe.colorSoft }}>
        <img src={recipe.image} alt={recipe.name} />
      </div>
      <div className="rr-body">
        <h3 className="rr-name">{recipe.name}</h3>
        <p className="rr-tagline">{recipe.tagline}</p>
        <div className="rr-meta">
          <span>{recipe.cuisine}</span>
          <span>·</span>
          <span>{recipe.minutes} min</span>
          <span>·</span>
          <span>{recipe.difficulty}</span>
          <span>·</span>
          <span>{recipe.stepCount} steps</span>
        </div>
      </div>
      <div className="rr-tags">
        {recipe.tags.slice(0, 2).map(t => (
          <span key={t} className={"tag-pill " + (t === "non-veg" ? "nonveg" : "veg")}>{t}</span>
        ))}
      </div>
      <div className="rr-actions">
        {user && (
          <button className="rr-heart" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
            {saved ? "♥" : "♡"}
          </button>
        )}
        <span className="rr-arrow">→</span>
      </div>
    </a>
  );
}

window.MFC_PAGES = window.MFC_PAGES || {};
window.MFC_PAGES.RecipeSearchPage = RecipeSearchPage;
