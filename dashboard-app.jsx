const { useState, useEffect } = React;

const DASH_STYLE = `
.dash-loading {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; font-family: var(--mono); color: var(--ink-muted); font-size: 13px;
}
.dash-nav {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 32px; height: 60px;
  background: var(--paper); border-bottom: 1px solid var(--rule);
}
.dash-logo {
  font-family: var(--serif); font-style: italic; font-size: 22px; color: var(--orange);
}
.dash-nav-right { display: flex; align-items: center; gap: 16px; }
.dash-nav-user { font-size: 14px; color: var(--ink-muted); font-family: var(--mono); }
.dash-signout {
  font-size: 12px; font-family: var(--mono); color: var(--ink-muted);
  border: 1px solid var(--rule); border-radius: var(--r-sm); padding: 5px 12px;
}
.dash-signout:hover { color: var(--ink); border-color: var(--rule-strong); }

.dash-main {
  max-width: 860px; margin: 0 auto; padding: 48px 24px 80px;
  display: flex; flex-direction: column; gap: 52px;
}

.dash-hero { padding-bottom: 24px; border-bottom: 1px solid var(--rule); }
.dash-hero-title {
  font-family: var(--serif); font-size: clamp(2rem, 5vw, 3rem);
  font-weight: 400; line-height: 1.1;
}
.dash-hero-title em { color: var(--orange); font-style: italic; }
.dash-hero-sub { margin-top: 8px; color: var(--ink-muted); font-size: 15px; }

.dash-section-head {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px; margin-bottom: 16px;
}
.dash-section-head h2 {
  font-family: var(--serif); font-size: 1.35rem; font-weight: 400;
}
.dash-empty {
  font-size: 14px; color: var(--ink-muted); font-style: italic; padding: 12px 0;
}

.slot-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.slot-tab {
  font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em;
  padding: 5px 12px; border-radius: 100px;
  border: 1px solid var(--rule); color: var(--ink-muted); background: transparent;
}
.slot-tab.active { background: var(--orange); color: var(--paper); border-color: var(--orange); }
.slot-tab:not(.active):hover { border-color: var(--rule-strong); color: var(--ink); }

.dash-cards { display: flex; flex-direction: column; gap: 8px; }
.dash-card {
  display: grid; grid-template-columns: 48px 1fr auto;
  align-items: center; gap: 14px;
  padding: 12px 16px; border-radius: var(--r-md);
  background: var(--paper); border: 1px solid var(--rule);
}
.dash-card:hover { border-color: var(--rule-strong); }
.dash-card-tile {
  width: 48px; height: 48px; border-radius: var(--r-sm);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.dash-card-emoji { font-size: 22px; }
.dash-card-name { font-weight: 500; font-size: 15px; }
.dash-card-reason { font-size: 12px; color: var(--ink-muted); margin-top: 2px; line-height: 1.4; }
.dash-card-meta { font-size: 12px; color: var(--ink-faint); font-family: var(--mono); margin-top: 3px; }
.dash-card-rank {
  font-family: var(--mono); font-size: 11px; color: var(--orange);
  border: 1px solid var(--orange-soft); border-radius: 100px;
  padding: 3px 8px; flex-shrink: 0;
}
.dash-card-arrow { color: var(--ink-faint); flex-shrink: 0; }

.dash-resume-list { display: flex; flex-direction: column; gap: 8px; }
.dash-resume-row {
  display: grid; grid-template-columns: 44px 1fr auto;
  align-items: center; gap: 14px;
  padding: 10px 16px; border-radius: var(--r-md);
  background: var(--paper); border: 1px solid var(--rule);
}
.dash-resume-row:hover { border-color: var(--rule-strong); }
.dash-resume-tile {
  width: 44px; height: 44px; border-radius: var(--r-sm);
  display: flex; align-items: center; justify-content: center; font-size: 20px; flex-shrink: 0;
}
.dash-resume-name { font-weight: 500; font-size: 15px; }
.dash-resume-step { font-size: 12px; color: var(--ink-muted); font-family: var(--mono); margin-top: 2px; }
.dash-resume-cta { font-family: var(--mono); font-size: 12px; color: var(--orange); flex-shrink: 0; }

.dash-log-form {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;
}
.dash-log-select, .dash-log-input {
  background: var(--paper); border: 1px solid var(--rule);
  border-radius: var(--r-sm); padding: 8px 12px;
  font: inherit; font-size: 13px; color: var(--ink); outline: none;
}
.dash-log-select:focus, .dash-log-input:focus { border-color: var(--orange); }
.dash-log-select-flex { flex: 1; min-width: 140px; }
.dash-log-input { width: 90px; }
.dash-log-btn {
  background: var(--orange); color: var(--paper);
  border-radius: var(--r-sm); padding: 8px 20px;
  font-size: 13px; font-family: var(--mono);
}
.dash-log-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.dash-log-list { display: flex; flex-direction: column; gap: 6px; }
.dash-log-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 14px; border-radius: var(--r-sm);
  background: var(--paper); border: 1px solid var(--rule); font-size: 13px;
}
.dash-log-badge {
  font-family: var(--mono); font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--matcha-deep);
  background: var(--matcha-soft); border-radius: 100px; padding: 2px 8px; flex-shrink: 0;
}
.dash-log-name { flex: 1; color: var(--ink-soft); }
.dash-log-sv { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); }
.dash-log-when { font-family: var(--mono); font-size: 11px; color: var(--ink-faint); margin-left: auto; white-space: nowrap; }

.dash-footer-link {
  display: flex; flex-direction: column; gap: 4px;
  padding: 20px 24px; border-radius: var(--r-md);
  background: var(--paper); border: 1px solid var(--rule);
}
.dash-footer-link a { font-weight: 500; font-size: 15px; color: var(--orange); }
.dash-footer-link a:hover { text-decoration: underline; }
.dash-footer-link span { font-size: 13px; color: var(--ink-muted); }
`;

function useAuthGuard() {
  const [user, setUser]   = useState(() => window.MFC?.auth?.getUser() || null);
  const [ready, setReady] = useState(() => !!window.MFC?.auth?.getUser());

  useEffect(() => {
    if (ready) return;
    const h = (e) => { setUser(e.detail.user); setReady(true); };
    window.addEventListener('mfc:auth-change', h);
    return () => window.removeEventListener('mfc:auth-change', h);
  }, [ready]);

  return { user, ready };
}

function DashboardApp() {
  const { user, ready } = useAuthGuard();

  const [mealType, setMealType]     = useState(() => window.MFC?.mealTime?.defaultMealTypeForNow?.() || 'lunch');
  const [recs, setRecs]             = useState([]);
  const [recipesById, setRecipesById] = useState({});
  const [sessions, setSessions]     = useState([]);
  const [saved, setSaved]           = useState([]);
  const [logs, setLogs]             = useState([]);
  const [logForm, setLogForm]       = useState({ mealType, recipeId: '', servings: '' });
  const [logBusy, setLogBusy]       = useState(false);

  useEffect(() => {
    if (ready && !user) window.location.href = 'index.html';
  }, [ready, user]);

  useEffect(() => {
    if (!user) return;
    const db = window.MFC?.db;
    if (!db) return;
    db.getRecipes().then((list) => {
      const byId = {};
      for (const r of list || []) byId[r.id] = r;
      setRecipesById(byId);
    });
    db.getActiveSessions().then(setSessions);
    db.getSaved().then(setSaved);
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.getMealLogs({ from }).then((list) => setLogs((list || []).slice(0, 5)));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    window.MFC?.db?.getRecommendations(mealType).then(setRecs);
  }, [user, mealType]);

  async function handleLogMeal(e) {
    e.preventDefault();
    if (!logForm.mealType) return;
    setLogBusy(true);
    const ok = await window.MFC.db.logMeal({
      recipeId: logForm.recipeId || null,
      mealType: logForm.mealType,
      servings: logForm.servings ? parseFloat(logForm.servings) : null,
    });
    setLogBusy(false);
    if (ok) {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      window.MFC.db.getMealLogs({ from }).then((list) => setLogs((list || []).slice(0, 5)));
      setLogForm({ mealType: logForm.mealType, recipeId: '', servings: '' });
    }
  }

  if (!ready) return <div className="dash-loading">Loading…</div>;
  if (!user)  return null;

  const firstName  = (user.name || '').split(' ')[0] || 'there';
  const allRecipes = Object.values(recipesById).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <style>{DASH_STYLE}</style>

      <nav className="dash-nav">
        <a href="index.html" className="dash-logo">mfc</a>
        <div className="dash-nav-right">
          <span className="dash-nav-user">{user.email}</span>
          <button className="dash-signout" onClick={() => window.MFC.auth.signOut()}>Sign out</button>
        </div>
      </nav>

      <main className="dash-main">

        <header className="dash-hero">
          <h1 className="dash-hero-title">Hey, <em>{firstName}</em></h1>
          <p className="dash-hero-sub">Here's what's on your plate today.</p>
        </header>

        {/* Recommendations */}
        <section>
          <div className="dash-section-head">
            <h2>Recommended for you</h2>
            <div className="slot-tabs">
              {['breakfast','lunch','dinner','snack'].map((m) => (
                <button key={m}
                  className={'slot-tab' + (mealType === m ? ' active' : '')}
                  onClick={() => setMealType(m)}>{m}</button>
              ))}
            </div>
          </div>
          {recs.length === 0 ? (
            <p className="dash-empty">No {mealType} recommendations yet — your pipeline will populate these once your blood markers are processed.</p>
          ) : (
            <div className="dash-cards">
              {recs.map((r) => {
                const recipe = recipesById[r.recipe_id];
                return (
                  <a key={r.recipe_id} className="dash-card" href={`recipe.html?id=${r.recipe_id}`}>
                    <div className="dash-card-tile" style={{ background: recipe?.colorSoft || 'var(--orange-soft)' }}>
                      <span className="dash-card-emoji">{recipe?.media?.emoji || '🍽️'}</span>
                    </div>
                    <div>
                      <div className="dash-card-name">{recipe?.name || r.recipe_id}</div>
                      {r.reason && <div className="dash-card-reason">{r.reason}</div>}
                      <div className="dash-card-meta">
                        {[recipe?.cuisine, recipe?.totalMinutes && `${recipe.totalMinutes} min`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <span className="dash-card-rank">#{r.rank}</span>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        {/* Continue cooking */}
        {sessions.length > 0 && (
          <section>
            <div className="dash-section-head"><h2>Continue cooking</h2></div>
            <div className="dash-resume-list">
              {sessions.map((s) => {
                const recipe = recipesById[s.recipe_id];
                return (
                  <a key={s.recipe_id} className="dash-resume-row"
                    href={`recipe.html?id=${s.recipe_id}&resume=1`}>
                    <div className="dash-resume-tile"
                      style={{ background: recipe?.colorSoft || 'var(--orange-soft)' }}>
                      {recipe?.media?.emoji || '🍽️'}
                    </div>
                    <div>
                      <div className="dash-resume-name">{recipe?.name || s.recipe_id}</div>
                      <div className="dash-resume-step">Step {s.current_step + 1} — paused</div>
                    </div>
                    <span className="dash-resume-cta">Resume →</span>
                  </a>
                );
              })}
            </div>
          </section>
        )}

        {/* Saved recipes */}
        <section>
          <div className="dash-section-head"><h2>Saved recipes</h2></div>
          {saved.length === 0 ? (
            <p className="dash-empty">Tap the ♥ icon on any recipe to save it here.</p>
          ) : (
            <div className="dash-cards">
              {saved.map((s) => {
                const recipe = recipesById[s.recipe_id];
                return (
                  <a key={s.recipe_id} className="dash-card" href={`recipe.html?id=${s.recipe_id}`}>
                    <div className="dash-card-tile"
                      style={{ background: recipe?.colorSoft || 'var(--cream-deep)' }}>
                      <span className="dash-card-emoji">{recipe?.media?.emoji || '🍽️'}</span>
                    </div>
                    <div>
                      <div className="dash-card-name">{recipe?.name || s.recipe_id}</div>
                      <div className="dash-card-meta">
                        {[recipe?.cuisine, recipe?.totalMinutes && `${recipe.totalMinutes} min`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <span className="dash-card-arrow">→</span>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        {/* Recent meal log */}
        <section>
          <div className="dash-section-head"><h2>Recent meal log</h2></div>
          <form className="dash-log-form" onSubmit={handleLogMeal}>
            <select className="dash-log-select" value={logForm.mealType}
              onChange={(e) => setLogForm((f) => ({ ...f, mealType: e.target.value }))}>
              <option value="">Meal type</option>
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
              <option value="snack">Snack</option>
            </select>
            <select className="dash-log-select dash-log-select-flex" value={logForm.recipeId}
              onChange={(e) => setLogForm((f) => ({ ...f, recipeId: e.target.value }))}>
              <option value="">Recipe (optional)</option>
              {allRecipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            <input type="number" min="0.5" step="0.5" placeholder="Servings"
              className="dash-log-input"
              value={logForm.servings}
              onChange={(e) => setLogForm((f) => ({ ...f, servings: e.target.value }))} />
            <button type="submit" className="dash-log-btn"
              disabled={logBusy || !logForm.mealType}>
              {logBusy ? '…' : 'Log'}
            </button>
          </form>
          {logs.length === 0 ? (
            <p className="dash-empty">No meals logged in the last 7 days.</p>
          ) : (
            <div className="dash-log-list">
              {logs.map((l) => {
                const recipe = l.recipe_id ? recipesById[l.recipe_id] : null;
                const when = new Date(l.logged_at).toLocaleDateString('en-US', {
                  weekday: 'short', month: 'short', day: 'numeric',
                });
                return (
                  <div key={l.id} className="dash-log-row">
                    <span className="dash-log-badge">{l.meal_type}</span>
                    <span className="dash-log-name">{recipe?.name || l.recipe_id || '—'}</span>
                    {l.servings != null && <span className="dash-log-sv">{l.servings}×</span>}
                    <span className="dash-log-when">{when}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="dash-footer-link">
          <a href="markers.html">Manage blood markers →</a>
          <span>Your offline pipeline reads these to generate recommendations.</span>
        </div>

      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<DashboardApp />);
