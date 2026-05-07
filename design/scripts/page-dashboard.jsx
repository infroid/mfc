/* global React */
const { useState: useStateD, useEffect: useEffectD } = React;
const D2 = window.MFC_DATA;
const { useUser: useUserD, navigate: navD } = window.MFC_CHROME;

// ============================================================
// Dashboard
// ============================================================
function DashboardPage() {
  const user = useUserD();
  const [mealType, setMealType] = useStateD(() => {
    const h = new Date().getHours();
    if (h < 11) return "breakfast";
    if (h < 15) return "lunch";
    if (h < 18) return "snack";
    return "dinner";
  });

  if (!user) {
    return (
      <div style={{ padding: "120px 28px", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 24, color: "var(--ink-soft)" }}>
          Sign in to see your dashboard.
        </p>
      </div>
    );
  }

  const recs = D2.RECOMMENDATIONS[mealType] || [];
  const sessions = D2.SESSIONS;
  const saved = D2.SAVED.map((id) => D2.recipeById(id)).filter(Boolean);
  const logs = D2.MEAL_LOGS;
  const firstName = user.name.split(" ")[0];

  // Marker quick-glance summary
  const flagged = D2.METRIC_DEFS
    .map(m => ({ m, r: D2.MARKERS[m.id] }))
    .filter(({ m, r }) => r && D2.markerStatus(m, r) !== "ok");

  return (
    <>
      {/* Hero */}
      <section style={{ padding: "56px 0 32px" }}>
        <div className="wrap">
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
            <div>
              <div className="eyebrow-comment" style={{ marginBottom: 10 }}>good evening · {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</div>
              <h1 style={{ fontFamily: "var(--sans)", fontWeight: 500, fontSize: "clamp(42px,5.4vw,68px)", lineHeight: 0.98, letterSpacing: "-0.035em" }}>
                Hey, <em style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, color: "var(--orange)" }}>{firstName}</em>.
              </h1>
              <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, color: "var(--ink-soft)", marginTop: 12 }}>
                {sessions.length > 0 ? "You've got a salmon waiting on step 3. Pick it up?" : "Here's what's worth cooking today."}
              </p>
            </div>
            <div className="dash-stats">
              <Stat label="Streak" value={user.streak} unit="days" />
              <Stat label="Cooked" value={user.cookedThisWeek} unit="this wk" />
              <Stat label="Saved" value={saved.length} unit="recipes" />
            </div>
          </div>
        </div>
      </section>

      {/* Continue cooking — banner */}
      {sessions.length > 0 && (
        <section style={{ padding: "0 0 32px" }}>
          <div className="wrap">
            {sessions.map(s => {
              const r = D2.recipeById(s.recipe_id);
              if (!r) return null;
              return (
                <div key={s.recipe_id} className="card resume-banner" style={{ boxShadow: "8px 8px 0 var(--matcha)" }}>
                  <div className="resume-img" style={{ background: r.colorSoft }}>
                    <img src={r.image} alt={r.name} />
                  </div>
                  <div className="resume-body">
                    <div className="eyebrow-comment">resume cooking</div>
                    <h3 style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 32, lineHeight: 1.05, marginTop: 4, marginBottom: 4 }}>{r.name}</h3>
                    <p style={{ fontSize: 14, color: "var(--ink-soft)" }}>
                      Paused on <b>step {s.current_step + 1} of {r.stepCount}</b> · {D2.fmtAgo(s.updated_at)}
                    </p>
                    <div style={{ marginTop: 12, height: 6, background: "var(--cream-deep)", borderRadius: 999, overflow: "hidden", maxWidth: 320 }}>
                      <div style={{ width: `${((s.current_step) / r.stepCount) * 100}%`, height: "100%", background: "linear-gradient(90deg, var(--orange), var(--orange-deep))" }} />
                    </div>
                  </div>
                  <button className="btn orange">Resume →</button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="dash-grid wrap">
        {/* Left col — recommendations */}
        <div className="dash-main">
          <section>
            <div className="section-head" style={{ marginBottom: 18 }}>
              <div>
                <div className="section-label">tonight's pick</div>
                <h2><em>Recommended</em> for you</h2>
              </div>
              <div className="meal-tabs">
                {["breakfast", "lunch", "dinner", "snack"].map(m => (
                  <button
                    key={m}
                    className={"meal-tab" + (mealType === m ? " active" : "")}
                    onClick={() => setMealType(m)}
                  >{m}</button>
                ))}
              </div>
            </div>
            {recs.length === 0 ? (
              <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-muted)", padding: "20px 0" }}>
                No {mealType} recommendations yet.
              </p>
            ) : (
              <div className="rec-stack">
                {recs.map(r => <RecCard key={r.recipe_id} rec={r} />)}
              </div>
            )}
          </section>

          {/* Saved recipes */}
          <section style={{ marginTop: 56 }}>
            <div className="section-head" style={{ marginBottom: 18 }}>
              <div>
                <div className="section-label">your library</div>
                <h2><em>Saved</em> recipes</h2>
              </div>
              <span className="pill">{saved.length} hearted</span>
            </div>
            <div className="saved-grid">
              {saved.map(r => (
                <a key={r.id} href={"#/recipe/" + r.id} onClick={(e) => e.preventDefault()} className="saved-card card lift">
                  <div className="saved-img" style={{ background: r.colorSoft }}>
                    <img src={r.image} alt={r.name} />
                    <span className="saved-heart">♥</span>
                  </div>
                  <div className="saved-body">
                    <h4>{r.name}</h4>
                    <div className="saved-meta">{r.cuisine} · {r.minutes} min</div>
                  </div>
                </a>
              ))}
            </div>
          </section>
        </div>

        {/* Right col — sidebar */}
        <aside className="dash-side">
          {/* Markers glance */}
          <div className="card" style={{ padding: 22 }}>
            <div className="eyebrow-comment" style={{ marginBottom: 8 }}>blood markers</div>
            <h3 style={{ fontFamily: "var(--sans)", fontWeight: 500, fontSize: 22, letterSpacing: "-0.02em", lineHeight: 1.1, marginBottom: 6 }}>
              {flagged.length} marker{flagged.length === 1 ? "" : "s"} <em style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, color: "var(--orange)" }}>need attention</em>
            </h3>
            <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 15, color: "var(--ink-soft)", marginBottom: 14, lineHeight: 1.45 }}>
              Last test: {D2.fmtDate(D2.MARKERS.iron.measured_at, { month: "long", day: "numeric", year: "numeric" })}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {flagged.slice(0, 3).map(({ m, r }) => {
                const status = D2.markerStatus(m, r);
                return (
                  <div key={m.id} className="mk-mini">
                    <span className="mk-mini-name">{m.name}</span>
                    <span className={"mk-mini-pill " + status}>
                      {r.value} {m.unit} · {status}
                    </span>
                  </div>
                );
              })}
            </div>
            <button className="btn sm" style={{ width: "100%" }} onClick={() => navD("/markers")}>
              Update markers →
            </button>
          </div>

          {/* Meal log */}
          <div className="card" style={{ padding: 22 }}>
            <div className="eyebrow-comment" style={{ marginBottom: 12 }}>meal log · last 7 days</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {logs.slice(0, 5).map(l => {
                const r = l.recipe_id ? D2.recipeById(l.recipe_id) : null;
                return (
                  <div key={l.id} className="log-row">
                    <div className="log-dot" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="log-name">{r?.name || "—"}</div>
                      <div className="log-meta">
                        <span className={"meal-badge " + l.meal_type}>{l.meal_type}</span>
                        <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-faint)" }}>
                          {D2.fmtDate(l.logged_at, { weekday: "short" }).toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="btn ghost sm" style={{ width: "100%", marginTop: 14, fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              + Log a meal
            </button>
          </div>

          {/* Tip card */}
          <div className="card" style={{ padding: 20, background: "var(--cream-deep)" }}>
            <div className="footer-scribble" style={{ fontSize: 28, marginBottom: 4 }}>✎ tip</div>
            <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 17, lineHeight: 1.4, color: "var(--ink-soft)" }}>
              Pair iron-rich foods with vitamin C — your ferritin trend will thank you.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="dash-stat">
      <div className="dash-stat-value">{value}<span className="dash-stat-unit">{unit}</span></div>
      <div className="dash-stat-label">{label}</div>
    </div>
  );
}

function RecCard({ rec }) {
  const r = D2.recipeById(rec.recipe_id);
  if (!r) return null;
  return (
    <a className="rec-card card lift" href={"#/recipe/" + r.id} onClick={(e) => e.preventDefault()}>
      <div className="rec-img" style={{ background: r.colorSoft }}>
        <img src={r.image} alt={r.name} />
        <span className="rec-rank">#{rec.rank}</span>
      </div>
      <div className="rec-body">
        <h3 className="rec-name">{r.name}</h3>
        <p className="rec-reason">{rec.reason}</p>
        <div className="rec-meta">
          <span>{r.cuisine}</span>
          <span>·</span>
          <span>⏱ {r.minutes} min</span>
          <span>·</span>
          <span>👥 {r.servings}</span>
        </div>
      </div>
      <span className="rec-go">Cook →</span>
    </a>
  );
}

window.MFC_PAGES = window.MFC_PAGES || {};
window.MFC_PAGES.DashboardPage = DashboardPage;
