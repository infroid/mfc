// Admin analytics dashboard — dense, single-shot snapshot of the catalog/library.
// Pulls from public-read tables only (recipes, ingredients, utensils, joins).
// User-owned tables are RLS-scoped to owner so they're not aggregated here.
const { useState, useEffect, useMemo, useRef } = React;

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function fmtAgo(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  return `${mo}mo ago`;
}

function pct(num, den) {
  if (!den) return 0;
  return Math.round((num / den) * 100);
}

function bucketByWeek(records, weeks = 12) {
  const now = new Date();
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const end = new Date(now);
    end.setDate(end.getDate() - 7 * i);
    const start = new Date(end);
    start.setDate(start.getDate() - 7);
    return { start, end, count: 0, label: `${start.getMonth() + 1}/${start.getDate()}` };
  }).reverse();

  for (const r of records) {
    const t = new Date(r);
    if (isNaN(t)) continue;
    for (const b of buckets) if (t >= b.start && t < b.end) { b.count++; break; }
  }
  return buckets;
}

function topN(map, n = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

// ------------------------------------------------------------
// SVG area-line chart (catalog growth)
// ------------------------------------------------------------
function AreaChart({ buckets }) {
  const w = 600, h = 140, pad = 8;
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const stepX = (w - pad * 2) / Math.max(1, buckets.length - 1);
  const pts = buckets.map((b, i) => [
    pad + i * stepX,
    h - pad - (b.count / max) * (h - pad * 2),
  ]);
  const linePath = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const areaPath = linePath + ` L ${pts[pts.length - 1][0].toFixed(1)} ${h - pad} L ${pts[0][0].toFixed(1)} ${h - pad} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="aGrad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#FF6D2E" stopOpacity="0.32" />
          <stop offset="100%" stopColor="#FF6D2E" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <g stroke="rgba(31,26,20,0.08)" strokeWidth="1">
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1={pad} x2={w - pad} y1={pad + (h - pad * 2) * p} y2={pad + (h - pad * 2) * p} strokeDasharray="2 4" />
        ))}
      </g>
      <path d={areaPath} fill="url(#aGrad)" />
      <path d={linePath} fill="none" stroke="#FF6D2E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={buckets[i].count > 0 ? 3 : 1.5} fill="#FF6D2E" />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------
// Sparkline (KPI accent)
// ------------------------------------------------------------
function Sparkline({ values, color = "#FF6D2E", w = 64, h = 22 }) {
  if (!values?.length) return null;
  const max = Math.max(1, ...values);
  const stepX = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => [i * stepX, h - (v / max) * h]);
  const d = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ------------------------------------------------------------
// Bar list (top N with inline horizontal bars)
// ------------------------------------------------------------
function BarList({ rows, color = "orange", emptyText = "Nothing yet" }) {
  if (!rows.length) return <div style={{ padding: "24px 0", textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>{emptyText}</div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bar-list">
      {rows.map((r, i) => (
        <div key={r.label + i} className={`bar-row ${color !== "orange" ? color : ""}`.trim()}>
          <div className="bar" style={{ width: `${(r.value / max) * 100}%` }} />
          <div className="name"><span className="rk">{i + 1}</span>{r.label}</div>
          <div className="v">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// Histogram bins
// ------------------------------------------------------------
function Histogram({ bins, axis }) {
  const max = Math.max(1, ...bins);
  return (
    <>
      <div className="hist">
        {bins.map((v, i) => (
          <div
            key={i}
            className="hist-bar"
            data-v={v}
            style={{ height: `${(v / max) * 100}%` }}
            title={`${axis[i]}: ${v}`}
          />
        ))}
      </div>
      <div className="hist-axis">
        {axis.map((a, i) => <div key={i}>{a}</div>)}
      </div>
    </>
  );
}

// ------------------------------------------------------------
// MAIN APP
// ------------------------------------------------------------
function DashboardApp() {
  const [snap, setSnap] = useState(null);
  const [err, setErr] = useState(null);
  const [loadedAt, setLoadedAt] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setErr(null);
    try {
      const data = await window.MFC.adminDb.getDashboardSnapshot();
      setSnap(data);
      setLoadedAt(new Date());
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    if (!snap) return null;
    const { recipes, ingredients, utensils, ingredientUsage, utensilUsage, tags, utensilBuyLinks } = snap;

    const incomplete = recipes.filter((r) => r.stepCount === 0 || r.ingCount === 0).length;
    const noPhoto = recipes.filter((r) => !r.media?.image).length;
    const noTags = recipes.filter((r) => r.tagCount === 0).length;
    const noHealth = recipes.filter((r) => r.healthCount === 0).length;
    const noMealTypes = recipes.filter((r) => !r.meal_types?.length).length;

    const ingNoPhoto = ingredients.filter((i) => !i.photo).length;
    const ingAi = ingredients.filter((i) => i.ai_filled_at).length;
    const ingNoNutrition = ingredients.filter((i) => {
      const n = i.nutrition || {};
      return !n.calories && !n.protein && !n.fat && !n.carbs;
    }).length;
    const utNoPhoto = utensils.filter((u) => !u.photo).length;
    const utAi = utensils.filter((u) => u.ai_filled_at).length;
    const utNoBuy = utensils.filter((u) => !utensilBuyLinks[u.id]).length;

    const orphanIngredients = ingredients.filter((i) => !ingredientUsage[i.id]).length;
    const orphanUtensils = utensils.filter((u) => !utensilUsage[u.id]).length;

    // Cuisine breakdown
    const cuisineMap = {};
    for (const r of recipes) cuisineMap[r.cuisine || "—"] = (cuisineMap[r.cuisine || "—"] || 0) + 1;

    // Difficulty breakdown
    const diffMap = {};
    for (const r of recipes) diffMap[r.difficulty || "—"] = (diffMap[r.difficulty || "—"] || 0) + 1;

    // Meal-type tally (multi-valued)
    const mealMap = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
    for (const r of recipes) for (const m of r.meal_types || []) mealMap[m] = (mealMap[m] || 0) + 1;

    // Tags
    const tagMap = {};
    for (const t of tags) tagMap[t.tag] = (tagMap[t.tag] || 0) + 1;

    // Ingredient categories
    const ingCatMap = {};
    for (const i of ingredients) ingCatMap[i.category || "—"] = (ingCatMap[i.category || "—"] || 0) + 1;

    // Utensil categories
    const utCatMap = {};
    for (const u of utensils) utCatMap[u.category || "—"] = (utCatMap[u.category || "—"] || 0) + 1;

    // Top ingredients/utensils by usage in recipes
    const ingNameById = Object.fromEntries(ingredients.map((i) => [i.id, i.name]));
    const utNameById  = Object.fromEntries(utensils.map((u) => [u.id, u.name]));
    const topIng = topN(ingredientUsage, 8).map(([id, v]) => ({ label: ingNameById[id] || id, value: v }));
    const topUt  = topN(utensilUsage, 8).map(([id, v]) => ({ label: utNameById[id] || id, value: v }));
    const topTags = topN(tagMap, 8).map(([t, v]) => ({ label: t, value: v }));

    // Distribution: cook time histogram (8 buckets, 0–10, 10–20, …, 70+)
    const cookBins = new Array(8).fill(0);
    for (const r of recipes) {
      const m = r.total_minutes || 0;
      const idx = Math.min(7, Math.floor(m / 10));
      cookBins[idx]++;
    }
    const cookAxis = ["0–10", "10–20", "20–30", "30–40", "40–50", "50–60", "60–70", "70+"];

    // Distribution: step count histogram
    const stepBins = new Array(8).fill(0);
    for (const r of recipes) {
      const idx = Math.min(7, Math.max(0, r.stepCount - 1));
      stepBins[idx]++;
    }
    const stepAxis = ["1", "2", "3", "4", "5", "6", "7", "8+"];

    // Catalog growth — recipe updates over the last 12 weeks
    const growth = bucketByWeek(recipes.map((r) => r.updated_at), 12);
    const created = bucketByWeek(recipes.map((r) => r.created_at), 12);

    // Recent activity feed
    const activity = [
      ...recipes.slice(0, 6).map((r) => ({ kind: "recipe", id: r.id, name: r.name, sub: `${r.cuisine || "—"} · ${r.stepCount} steps`, ts: r.updated_at, href: `recipe.html?id=${encodeURIComponent(r.id)}` })),
      ...[...ingredients].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 4).map((i) => ({ kind: "ing", id: i.id, name: i.name, sub: i.category || "ingredient", ts: i.updated_at, href: `ingredient.html?id=${encodeURIComponent(i.id)}` })),
      ...[...utensils].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)).slice(0, 4).map((u) => ({ kind: "ut", id: u.id, name: u.name, sub: u.category || "utensil", ts: u.updated_at, href: `utensil.html?id=${encodeURIComponent(u.id)}` })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts)).slice(0, 10);

    const totalSteps = recipes.reduce((s, r) => s + r.stepCount, 0);
    const totalIngLinks = recipes.reduce((s, r) => s + r.ingCount, 0);
    const totalUtLinks = recipes.reduce((s, r) => s + r.utCount, 0);
    const totalHealth = recipes.reduce((s, r) => s + r.healthCount, 0);
    const totalTags = tags.length;
    const uniqueTags = Object.keys(tagMap).length;
    const avgSteps = recipes.length ? (totalSteps / recipes.length).toFixed(1) : "0";
    const avgIng = recipes.length ? (totalIngLinks / recipes.length).toFixed(1) : "0";
    const avgCookMin = recipes.length ? Math.round(recipes.reduce((s, r) => s + (r.total_minutes || 0), 0) / recipes.length) : 0;

    return {
      incomplete, noPhoto, noTags, noHealth, noMealTypes,
      ingNoPhoto, ingAi, ingNoNutrition, utNoPhoto, utAi, utNoBuy,
      orphanIngredients, orphanUtensils,
      cuisineRows: topN(cuisineMap, 8).map(([k, v]) => ({ label: k, value: v })),
      diffRows: topN(diffMap, 8).map(([k, v]) => ({ label: k, value: v })),
      mealMap,
      ingCatRows: topN(ingCatMap, 6).map(([k, v]) => ({ label: k, value: v })),
      utCatRows: topN(utCatMap, 6).map(([k, v]) => ({ label: k, value: v })),
      topIng, topUt, topTags,
      cookBins, cookAxis, stepBins, stepAxis,
      growth, created,
      activity,
      totalSteps, totalIngLinks, totalUtLinks, totalHealth, totalTags, uniqueTags,
      avgSteps, avgIng, avgCookMin,
    };
  }, [snap]);

  return (
    <div className="admin-shell">
      <AdminSidebar
        active="dashboard"
        counts={snap ? { recipes: snap.recipes.length, ingredients: snap.ingredients.length, utensils: snap.utensils.length } : undefined}
      />
      <div className="admin-main">
        <AdminTopbar crumb={[{ label: "Dashboard" }]} />

        <div className="dash-page">
          <div className="dash-head">
            <div>
              <h1>The <em>pulse</em></h1>
              <div className="sub">Catalog &amp; library health at a glance — counts, gaps, and recent edits.</div>
            </div>
            <div className="dash-head-meta">
              {loadedAt && (
                <span className="ts">
                  <span className="dot" />
                  Live · {fmtAgo(loadedAt.toISOString())}
                </span>
              )}
              <button className="dash-refresh" onClick={load} disabled={busy}>
                {busy ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
          </div>

          {err && (
            <div className="form-card" style={{ borderColor: "var(--berry)", marginBottom: 16 }}>
              <div className="form-card-body" style={{ color: "var(--berry)" }}>
                Failed to load dashboard: {err}
              </div>
            </div>
          )}

          {!stats && !err && (
            <div className="dash-loading">
              <h3>Tallying the catalog…</h3>
              <p style={{ marginTop: 6, fontSize: 13 }}>One round trip; should be fast.</p>
            </div>
          )}

          {stats && (
            <>
              {/* KPI strip */}
              <div className="kpi-strip">
                <div className="kpi accent">
                  <span className="lbl">Recipes</span>
                  <span className="v">{snap.recipes.length}<em>total</em></span>
                  <span className="sub">
                    {stats.incomplete > 0 && <span className="delta warn">{stats.incomplete} incomplete</span>}
                  </span>
                  <Sparkline values={stats.created.map((b) => b.count)} />
                </div>

                <div className="kpi matcha">
                  <span className="lbl">Ingredients</span>
                  <span className="v">{snap.ingredients.length}<em>library</em></span>
                  <span className="sub">
                    <span className="delta">{pct(stats.ingAi, snap.ingredients.length)}% AI-filled</span>
                    {stats.orphanIngredients > 0 && <span className="delta warn">{stats.orphanIngredients} unused</span>}
                  </span>
                </div>

                <div className="kpi">
                  <span className="lbl">Utensils</span>
                  <span className="v">{snap.utensils.length}<em>library</em></span>
                  <span className="sub">
                    <span className="delta">{pct(stats.utAi, snap.utensils.length)}% AI-filled</span>
                    {stats.orphanUtensils > 0 && <span className="delta warn">{stats.orphanUtensils} unused</span>}
                  </span>
                </div>

                <div className="kpi">
                  <span className="lbl">Steps</span>
                  <span className="v">{stats.totalSteps}<em>across catalog</em></span>
                  <span className="sub">avg <b style={{ color: "var(--ink)" }}>{stats.avgSteps}</b>/recipe · ø <b style={{ color: "var(--ink)" }}>{stats.avgCookMin}</b>min</span>
                </div>

                <div className="kpi">
                  <span className="lbl">Tags</span>
                  <span className="v">{stats.uniqueTags}<em>unique</em></span>
                  <span className="sub">{stats.totalTags} total · {stats.noTags} recipes untagged</span>
                </div>

                <div className="kpi berry">
                  <span className="lbl">Quality flags</span>
                  <span className="v">{stats.incomplete + stats.noPhoto + stats.noHealth}<em>open</em></span>
                  <span className="sub">
                    {stats.incomplete > 0 && <span className="delta bad">{stats.incomplete} no steps/ing</span>}
                    {stats.incomplete === 0 && <span className="delta">all complete</span>}
                  </span>
                </div>
              </div>

              {/* Row 2: growth + cuisine + difficulty/meal */}
              <div className="dash-grid cols-3">
                <section className="widget">
                  <div className="widget-head">
                    <h3>Catalog growth</h3>
                    <span className="tag">12 weeks</span>
                    <div className="spacer" />
                    <span className="meta">recipe edits</span>
                  </div>
                  <div className="widget-body">
                    <div className="spark-legend">
                      <span className="item"><span className="swatch" /> updated_at</span>
                    </div>
                    <div className="spark-wrap">
                      <AreaChart buckets={stats.growth} />
                    </div>
                    <div className="spark-axis">
                      {stats.growth.filter((_, i) => i % 2 === 0).map((b) => <span key={b.label}>{b.label}</span>)}
                    </div>
                    <div className="mini-stats" style={{ marginTop: 12 }}>
                      <div className="mini-stat accent">
                        <div className="lbl">This week</div>
                        <div className="v">{stats.growth[stats.growth.length - 1].count}<em>edits</em></div>
                      </div>
                      <div className="mini-stat">
                        <div className="lbl">Prev week</div>
                        <div className="v">{stats.growth[stats.growth.length - 2]?.count ?? 0}</div>
                      </div>
                      <div className="mini-stat">
                        <div className="lbl">12-wk total</div>
                        <div className="v">{stats.growth.reduce((s, b) => s + b.count, 0)}</div>
                      </div>
                      <div className="mini-stat matcha">
                        <div className="lbl">New created</div>
                        <div className="v">{stats.created.reduce((s, b) => s + b.count, 0)}</div>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="widget">
                  <div className="widget-head">
                    <h3>By cuisine</h3>
                    <span className="tag">distribution</span>
                  </div>
                  <div className="widget-body">
                    <BarList rows={stats.cuisineRows} color="orange" emptyText="No recipes yet" />
                  </div>
                </section>

                <section className="widget">
                  <div className="widget-head">
                    <h3>Mix</h3>
                    <span className="tag">difficulty + meal</span>
                  </div>
                  <div className="widget-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                      <div className="spark-legend"><span className="item">Difficulty</span></div>
                      <BarList rows={stats.diffRows} color="matcha" emptyText="—" />
                    </div>
                    <div>
                      <div className="spark-legend"><span className="item">Meal types</span></div>
                      <div className="chip-row">
                        {Object.entries(stats.mealMap).map(([k, v]) => (
                          <span key={k} className="chip"><b>{v}</b> {k}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              {/* Row 3: top ingredients / utensils / tags */}
              <div className="dash-grid cols-3-equal">
                <section className="widget">
                  <div className="widget-head">
                    <h3>Top ingredients</h3>
                    <span className="tag">by recipe references</span>
                  </div>
                  <div className="widget-body">
                    <BarList rows={stats.topIng} color="matcha" emptyText="No usage yet" />
                  </div>
                </section>

                <section className="widget">
                  <div className="widget-head">
                    <h3>Top utensils</h3>
                    <span className="tag">by recipe references</span>
                  </div>
                  <div className="widget-body">
                    <BarList rows={stats.topUt} color="kraft" emptyText="No usage yet" />
                  </div>
                </section>

                <section className="widget">
                  <div className="widget-head">
                    <h3>Top tags</h3>
                    <span className="tag">recipe_tags</span>
                  </div>
                  <div className="widget-body">
                    <BarList rows={stats.topTags} color="orange" emptyText="No tags yet" />
                  </div>
                </section>
              </div>

              {/* Row 4: quality monitor + activity feed */}
              <div className="dash-grid cols-2">
                <section className="widget">
                  <div className="widget-head">
                    <h3>Quality monitor</h3>
                    <span className="tag">recipe gaps</span>
                    <div className="spacer" />
                    <span className="meta">{snap.recipes.length} rows</span>
                  </div>
                  <div className="widget-body">
                    <div className="q-list">
                      <QRow level={stats.incomplete === 0 ? "ok" : "bad"} value={stats.incomplete} total={snap.recipes.length} label="recipes missing steps or ingredients" />
                      <QRow level={stats.noPhoto === 0 ? "ok" : "warn"} value={stats.noPhoto} total={snap.recipes.length} label="recipes without a hero image" />
                      <QRow level={stats.noHealth === 0 ? "ok" : "warn"} value={stats.noHealth} total={snap.recipes.length} label="recipes with no health facts" />
                      <QRow level={stats.noTags === 0 ? "ok" : "warn"} value={stats.noTags} total={snap.recipes.length} label="recipes with no tags (won't filter)" />
                      <QRow level={stats.noMealTypes === 0 ? "ok" : "warn"} value={stats.noMealTypes} total={snap.recipes.length} label="recipes missing meal_types (won't appear in dashboard slots)" />
                      <QRow level={stats.ingNoNutrition === 0 ? "ok" : "warn"} value={stats.ingNoNutrition} total={snap.ingredients.length} label="ingredients without macros" />
                      <QRow level={stats.ingNoPhoto === 0 ? "ok" : "warn"} value={stats.ingNoPhoto} total={snap.ingredients.length} label="ingredients without a photo" />
                      <QRow level={stats.utNoPhoto === 0 ? "ok" : "warn"} value={stats.utNoPhoto} total={snap.utensils.length} label="utensils without a photo" />
                      <QRow level={stats.utNoBuy === 0 ? "ok" : "warn"} value={stats.utNoBuy} total={snap.utensils.length} label="utensils without a buy link" />
                      <QRow level={stats.orphanIngredients === 0 ? "ok" : "warn"} value={stats.orphanIngredients} total={snap.ingredients.length} label="orphan ingredients (in library, used by 0 recipes)" />
                      <QRow level={stats.orphanUtensils === 0 ? "ok" : "warn"} value={stats.orphanUtensils} total={snap.utensils.length} label="orphan utensils (in library, used by 0 recipes)" />
                    </div>
                  </div>
                </section>

                <section className="widget">
                  <div className="widget-head">
                    <h3>Recent activity</h3>
                    <span className="tag">last 10 edits</span>
                  </div>
                  <div className="widget-body flush">
                    <div className="activity">
                      {stats.activity.length === 0 && (
                        <div style={{ padding: "30px 14px", textAlign: "center", color: "var(--ink-faint)", fontSize: 13 }}>
                          No edits yet.
                        </div>
                      )}
                      {stats.activity.map((a, i) => (
                        <a key={i} href={a.href} className="activity-item">
                          <span className={`activity-glyph ${a.kind}`}>
                            {a.kind === "recipe" ? "✦" : a.kind === "ing" ? "◐" : "▣"}
                          </span>
                          <div className="activity-meta">
                            <div className="name">{a.name}</div>
                            <div className="sub">{a.kind === "recipe" ? "recipe" : a.kind === "ing" ? "ingredient" : "utensil"} · {a.sub}</div>
                          </div>
                          <span className="activity-time">{fmtAgo(a.ts)}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                </section>
              </div>

              {/* Row 5: distributions + library composition */}
              <div className="dash-grid cols-4">
                <section className="widget">
                  <div className="widget-head">
                    <h3>Cook time</h3>
                    <span className="tag">minutes</span>
                  </div>
                  <div className="widget-body tight">
                    <Histogram bins={stats.cookBins} axis={stats.cookAxis} />
                  </div>
                </section>

                <section className="widget">
                  <div className="widget-head">
                    <h3>Steps per recipe</h3>
                    <span className="tag">count</span>
                  </div>
                  <div className="widget-body tight">
                    <Histogram bins={stats.stepBins} axis={stats.stepAxis} />
                  </div>
                </section>

                <section className="widget">
                  <div className="widget-head">
                    <h3>Ingredient mix</h3>
                    <span className="tag">categories</span>
                  </div>
                  <div className="widget-body">
                    <BarList rows={stats.ingCatRows} color="matcha" emptyText="—" />
                  </div>
                </section>

                <section className="widget">
                  <div className="widget-head">
                    <h3>Library coverage</h3>
                    <span className="tag">photo + AI</span>
                  </div>
                  <div className="widget-body" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div className="donut-row">
                      <div className="donut" style={{ "--p": pct(snap.ingredients.length - stats.ingNoPhoto, snap.ingredients.length), "--c": "var(--matcha)" }}>
                        <span className="num">{pct(snap.ingredients.length - stats.ingNoPhoto, snap.ingredients.length)}<em>%</em></span>
                      </div>
                      <div className="donut-meta">
                        <span className="lbl">Ingredients</span>
                        <span className="desc">{snap.ingredients.length - stats.ingNoPhoto}/{snap.ingredients.length} have a photo · {stats.ingAi} AI-filled</span>
                      </div>
                    </div>
                    <div className="donut-row">
                      <div className="donut" style={{ "--p": pct(snap.utensils.length - stats.utNoPhoto, snap.utensils.length), "--c": "var(--orange)" }}>
                        <span className="num">{pct(snap.utensils.length - stats.utNoPhoto, snap.utensils.length)}<em>%</em></span>
                      </div>
                      <div className="donut-meta">
                        <span className="lbl">Utensils</span>
                        <span className="desc">{snap.utensils.length - stats.utNoPhoto}/{snap.utensils.length} have a photo · {stats.utAi} AI-filled</span>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function QRow({ level, value, total, label }) {
  const glyph = level === "ok" ? "✓" : level === "bad" ? "!" : "•";
  return (
    <div className={`q-row ${level}`}>
      <span className="q-glyph">{glyph}</span>
      <span className="lbl"><b>{value}</b> of {total} — {label}</span>
      <span className="v">{pct(value, total)}%</span>
    </div>
  );
}

window.MFC.adminGate.guard().then((ok) => {
  if (ok) ReactDOM.createRoot(document.getElementById("root")).render(<DashboardApp />);
});
