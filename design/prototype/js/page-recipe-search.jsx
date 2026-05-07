/* RECIPE SEARCH redesign — built to scale to hundreds of recipes.
   Adds: list/grid toggle, sort, multi-filter, pagination, density. */

function RecipeCardGrid({ r }) {
  return (
    <a className="recipe-card" href="#recipe">
      <ImgPh label={r.emoji + "  " + r.cuisine} ratio="1/1" style={{ borderBottom: "1.5px solid var(--ink)", borderRadius: 0 }} />
      <div className="rc-body">
        <div className="rc-name">{r.name}</div>
        <div className="rc-meta">
          <span>{r.totalMinutes} min</span>
          <span className="rc-meta-sep">·</span>
          <span>{r.difficulty}</span>
          <span className="rc-meta-sep">·</span>
          <span>{r.cuisine}</span>
        </div>
        <div className="rc-tags">
          {r.tags.slice(0, 3).map(t => <span key={t} className={"rc-tag " + (t === "vegetarian" || t === "vegan" ? "veg" : t === "non-veg" ? "nonveg" : "")}>{t}</span>)}
        </div>
      </div>
      <style>{`
        .recipe-card{background:var(--paper);border:1.5px solid var(--ink);border-radius:var(--r-md);
          display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--shadow-pop);
          transition:transform 200ms cubic-bezier(.2,.8,.2,1),box-shadow 200ms;position:relative;cursor:pointer}
        .recipe-card:hover{transform:translate(-2px,-2px);box-shadow:var(--shadow-pop-lg)}
        .rc-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:8px}
        .rc-name{font-family:var(--serif);font-style:italic;font-size:18px;line-height:1.18}
        .rc-meta{font-family:var(--mono);font-size:10px;letter-spacing:0.06em;text-transform:uppercase;
          color:var(--ink-muted);display:flex;flex-wrap:wrap;align-items:center;gap:6px}
        .rc-meta-sep{color:var(--rule-strong)}
        .rc-tags{display:flex;flex-wrap:wrap;gap:4px}
        .rc-tag{padding:3px 8px;border-radius:999px;font-size:11px;background:var(--cream-deep);
          color:var(--ink-muted);border:1px solid var(--rule)}
        .rc-tag.veg{background:var(--matcha-soft);color:var(--matcha-deep);border-color:transparent}
        .rc-tag.nonveg{background:var(--orange-soft);color:var(--orange-deep);border-color:transparent}
      `}</style>
    </a>
  );
}

function RecipeRowList({ r }) {
  return (
    <a className="rc-row" href="#recipe">
      <ImgPh label={r.emoji} ratio="1/1" className="thumb" style={{ width: 56, height: 56 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="rc-row-name">{r.name}</div>
        <div className="rc-row-meta mono">{r.cuisine} · {r.totalMinutes} min · {r.difficulty} · by {r.chef}</div>
      </div>
      <div className="rc-row-tags">
        {r.tags.slice(0, 3).map(t => (
          <TagChip key={t} tone={t === "vegetarian" || t === "vegan" ? "veg" : ""}>{t}</TagChip>
        ))}
      </div>
      <div className="rc-row-stat mono">{r.views.toLocaleString()} views</div>
      <span className="rc-row-arrow">→</span>
      <style>{`
        .rc-row{display:flex;align-items:center;gap:14px;padding:12px 16px;
          border-bottom:1px solid var(--rule);transition:background 140ms;cursor:pointer}
        .rc-row:last-child{border-bottom:none}
        .rc-row:hover{background:var(--cream-soft)}
        .rc-row .img-ph{flex-shrink:0;border-radius:8px}
        .rc-row-name{font-family:var(--serif);font-style:italic;font-size:18px;line-height:1.15}
        .rc-row-meta{font-size:10.5px;color:var(--ink-muted);margin-top:2px;letter-spacing:0.04em}
        .rc-row-tags{display:flex;gap:4px;flex-shrink:0}
        .rc-row-stat{color:var(--ink-faint);min-width:90px;text-align:right;flex-shrink:0}
        .rc-row-arrow{color:var(--ink-faint);width:24px;text-align:right;font-size:16px;flex-shrink:0}
        @media(max-width:760px){.rc-row-tags,.rc-row-stat{display:none}}
      `}</style>
    </a>
  );
}

function RecipeSearchPage() {
  const all = window.RECIPES;
  const [view, setView] = useState("grid");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(new Set());
  const [cuisine, setCuisine] = useState("all");
  const [sort, setSort] = useState("popular");
  const [page, setPage] = useState(1);
  const PER = 12;

  const FILTER_CHIPS = [
    { value: "vegetarian", label: "Vegetarian" },
    { value: "non-veg", label: "Non-veg" },
    { value: "quick", label: "Under 30m" },
    { value: "easy", label: "Easy" },
    { value: "high-protein", label: "High protein" },
    { value: "gluten-free", label: "GF" },
  ];

  function toggleFilter(v) {
    const s = new Set(filters);
    if (s.has(v)) s.delete(v); else s.add(v);
    setFilters(s);
    setPage(1);
  }

  const filtered = useMemo(() => {
    let list = all;
    if (cuisine !== "all") list = list.filter(r => r.cuisine === cuisine);
    if (filters.size > 0) {
      list = list.filter(r => {
        for (const f of filters) {
          if (f === "quick" && r.totalMinutes > 30) return false;
          if (f === "easy" && r.difficulty !== "Easy") return false;
          if (f !== "quick" && f !== "easy" && !r.tags.includes(f)) return false;
        }
        return true;
      });
    }
    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q));
    }
    const sorted = [...list];
    if (sort === "popular") sorted.sort((a, b) => b.views - a.views);
    else if (sort === "new") sorted.sort((a, b) => a.id.localeCompare(b.id));
    else if (sort === "fast") sorted.sort((a, b) => a.totalMinutes - b.totalMinutes);
    else if (sort === "az") sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [all, cuisine, filters, query, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER));
  const slice = filtered.slice((page - 1) * PER, page * PER);
  useEffect(() => { if (page > pageCount) setPage(1); }, [pageCount]);

  return (
    <>
      <AppNav active="recipes" />
      <div className="wrap">
        <PageHeader
          eyebrow="discover"
          title='All <em>recipes</em>'
          sub={`${all.length} recipes from our chef community · guided cooking · nutrition aware`}
          actions={<>
            <button className="btn btn-ghost btn-sm">⌘K Search</button>
          </>}
        />

        <Toolbar>
          <SearchInput value={query} onChange={(v) => { setQuery(v); setPage(1); }} placeholder="paneer, ramen, tartine…" />
          <div className="toolbar-divider" />
          <select className="cuisine-select" value={cuisine} onChange={e => { setCuisine(e.target.value); setPage(1); }}>
            <option value="all">All cuisines</option>
            {window.CUISINES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="toolbar-divider" />
          <Segment value={sort} onChange={setSort} options={[
            { value: "popular", label: "Popular" },
            { value: "new", label: "New" },
            { value: "fast", label: "Fastest" },
            { value: "az", label: "A–Z" },
          ]} />
          <span style={{ flex: 1 }} />
          <span className="toolbar-stat">{filtered.length} matches</span>
          <div className="toolbar-divider" />
          <Segment value={view} onChange={setView} options={[
            { value: "grid", label: "▦ Grid" },
            { value: "list", label: "≡ List" },
          ]} />
        </Toolbar>

        {/* Filter chips row */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          {FILTER_CHIPS.map(f => (
            <button
              key={f.value}
              className={"filter-chip-r " + (filters.has(f.value) ? "active" : "")}
              onClick={() => toggleFilter(f.value)}
            >{f.label}</button>
          ))}
          {filters.size > 0 && (
            <button className="filter-chip-r clear" onClick={() => { setFilters(new Set()); setPage(1); }}>
              clear ×
            </button>
          )}
        </div>

        {slice.length === 0 ? (
          <div style={{ textAlign: "center", padding: "64px 0", fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-muted)", fontSize: 22 }}>
            No recipes matched. Try fewer filters.
          </div>
        ) : view === "grid" ? (
          <div className="grid-4">
            {slice.map(r => <RecipeCardGrid key={r.id} r={r} />)}
          </div>
        ) : (
          <div className="list">
            {slice.map(r => <RecipeRowList key={r.id} r={r} />)}
          </div>
        )}

        {filtered.length > PER && (
          <Pagination page={page} pageCount={pageCount} total={filtered.length} perPage={PER} onChange={setPage} />
        )}

        <div className="spacer" />
      </div>

      <style>{`
        .cuisine-select{background:transparent;border:1px solid var(--rule);border-radius:999px;
          padding:6px 12px;font-size:12.5px;color:var(--ink);outline:none;cursor:pointer}
        .filter-chip-r{padding:5px 12px;border-radius:999px;background:var(--paper);
          border:1px solid var(--rule);font-size:12px;color:var(--ink-soft);cursor:pointer;
          transition:all 160ms}
        .filter-chip-r:hover{background:var(--cream-deep)}
        .filter-chip-r.active{background:var(--ink);color:var(--paper);border-color:var(--ink)}
        .filter-chip-r.clear{background:transparent;color:var(--berry);border-style:dashed}
      `}</style>
    </>
  );
}

window.RecipeSearchPage = RecipeSearchPage;
