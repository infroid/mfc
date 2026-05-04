const { useState, useEffect, useMemo } = React;

const DASH_STYLE = `
.wrap { max-width: var(--container); margin: 0 auto; padding: 0 28px; position: relative; z-index: 2; }

/* ---------- LOADING ---------- */
.dash-loading {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; font-family: var(--mono); color: var(--ink-muted); font-size: 13px;
  letter-spacing: 0.08em; text-transform: uppercase;
}

/* ---------- NAV ---------- */
.nav {
  position: sticky; top: 0; z-index: 50; height: 64px;
  display: flex; align-items: center;
  background: rgba(247, 241, 227, 0.86);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
          backdrop-filter: blur(14px) saturate(160%);
  border-bottom: 1px solid var(--rule);
}
.nav-inner {
  width: 100%; max-width: var(--container);
  margin: 0 auto; padding: 0 28px;
  display: flex; align-items: center; justify-content: space-between; gap: 24px;
}
.brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 600; letter-spacing: -0.02em; }
.brand-mark {
  display: inline-grid; place-items: center;
  width: 32px; height: 32px;
  background: var(--orange); color: var(--paper);
  font-family: var(--serif); font-style: italic; font-size: 22px;
  border-radius: 50%; transform: rotate(-6deg);
  flex-shrink: 0;
}
.brand-name { font-size: 17px; }
.brand-name em { font-family: var(--serif); font-weight: 400; font-style: italic; }
.nav-links { display: flex; align-items: center; gap: 28px; }
.nav-links a {
  font-family: var(--mono); font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-soft);
  transition: color 200ms cubic-bezier(.2,.8,.2,1);
  position: relative;
}
.nav-links a:hover, .nav-links a.active { color: var(--orange); }
.nav-links a.active::after {
  content: ""; position: absolute; left: 50%; bottom: -22px;
  width: 6px; height: 6px; border-radius: 50%; background: var(--orange);
  transform: translateX(-50%);
}
.nav-user {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px 6px 6px;
  background: var(--paper); color: var(--ink);
  border: 1.5px solid var(--ink); border-radius: var(--r-pill);
  font-size: 13px; font-weight: 500;
  cursor: pointer; box-shadow: var(--pop-sm);
  transition: transform 180ms, box-shadow 180ms;
}
.nav-user:hover { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 var(--ink); }
.nav-avatar {
  display: grid; place-items: center;
  width: 26px; height: 26px;
  background: var(--orange); color: var(--paper);
  border-radius: 50%;
  font-size: 12px; font-weight: 700;
  font-family: var(--mono);
  flex-shrink: 0; text-transform: uppercase;
}

/* ---------- BUTTONS / PILLS ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 12px 22px;
  border: 1.5px solid var(--ink);
  border-radius: var(--r-pill);
  background: var(--paper); color: var(--ink);
  font-size: 14px; font-weight: 500;
  box-shadow: var(--pop-md);
  transition: transform 180ms cubic-bezier(.2,.8,.2,1),
              box-shadow 180ms cubic-bezier(.2,.8,.2,1),
              background 180ms cubic-bezier(.2,.8,.2,1);
  white-space: nowrap; cursor: pointer;
}
.btn:hover { transform: translate(-1px,-1px); box-shadow: 5px 5px 0 var(--ink); }
.btn:active { transform: translate(0,0); box-shadow: var(--pop-sm); }
.btn.orange { background: var(--orange); color: var(--paper); border-color: var(--ink); box-shadow: 4px 4px 0 var(--orange-deep); }
.btn.orange:hover { box-shadow: 5px 5px 0 var(--orange-deep); }
.btn.ghost { box-shadow: none; }
.btn.ghost:hover { background: var(--cream-deep); box-shadow: none; transform: none; }
.btn.sm { padding: 8px 14px; font-size: 13px; box-shadow: var(--pop-sm); }
.btn.sm:hover { box-shadow: 4px 4px 0 var(--ink); }
.btn:disabled { opacity: 0.55; cursor: not-allowed; }
.btn:disabled:hover { transform: none; box-shadow: var(--pop-sm); }

.pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px;
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--r-pill);
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-muted); white-space: nowrap;
}

.eyebrow-comment {
  font-family: var(--mono); font-size: 12px;
  color: var(--ink-muted); letter-spacing: 0.04em;
}
.eyebrow-comment::before { content: "// "; color: var(--orange); }
.section-label {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--ink-muted); margin-bottom: 8px;
}
.section-label::before { content: "// "; color: var(--orange); }

/* ---------- CARD ---------- */
.card {
  background: var(--paper);
  border: 1.5px solid var(--ink);
  border-radius: var(--r-lg);
  box-shadow: var(--pop-md);
  transition: transform 200ms cubic-bezier(.2,.8,.2,1),
              box-shadow 200ms cubic-bezier(.2,.8,.2,1);
}
.card.lift { cursor: pointer; }
.card.lift:hover { transform: translate(-2px,-2px); box-shadow: var(--pop-lg); }

/* ---------- HERO ---------- */
.dash-hero { padding: 56px 0 32px; }
.dash-hero-row {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 24px; flex-wrap: wrap;
}
.dash-hero-title {
  font-family: var(--sans); font-weight: 500;
  font-size: clamp(42px, 5.4vw, 68px);
  line-height: 0.98; letter-spacing: -0.035em;
}
.dash-hero-title em {
  font-family: var(--serif); font-style: italic; font-weight: 400;
  color: var(--orange);
}
.dash-hero-sub {
  font-family: var(--serif); font-style: italic;
  font-size: 22px; color: var(--ink-soft);
  margin-top: 12px; line-height: 1.35; max-width: 620px;
}
.dash-stats { display: flex; gap: 14px; flex-wrap: wrap; }
.dash-stat {
  background: var(--paper);
  border: 1.5px solid var(--ink);
  border-radius: var(--r-md);
  padding: 14px 20px;
  box-shadow: var(--pop-sm);
  min-width: 110px;
}
.dash-stat-value {
  font-family: var(--sans); font-weight: 500;
  font-size: 32px; letter-spacing: -0.03em; line-height: 1;
}
.dash-stat-unit {
  font-family: var(--serif); font-style: italic;
  font-size: 14px; color: var(--ink-soft); margin-left: 5px;
}
.dash-stat-label {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ink-muted); margin-top: 4px;
}

/* ---------- RESUME BANNER ---------- */
.resume-banner {
  display: grid; grid-template-columns: 140px 1fr auto;
  gap: 22px; align-items: center;
  padding: 16px 22px 16px 16px;
  margin-bottom: 32px;
}
.resume-img {
  width: 140px; height: 140px;
  border-radius: var(--r-md);
  overflow: hidden; border: 1.5px solid var(--ink);
  display: grid; place-items: center;
  font-size: 56px; flex-shrink: 0;
}
.resume-img img { width: 100%; height: 100%; object-fit: cover; }
.resume-body { min-width: 0; }
.resume-name {
  font-family: var(--serif); font-style: italic;
  font-size: 32px; line-height: 1.05;
  margin-top: 4px; margin-bottom: 4px;
  letter-spacing: -0.01em;
}
.resume-meta { font-size: 14px; color: var(--ink-soft); }
.resume-meta b { font-weight: 600; color: var(--ink); }
@media (max-width: 720px) {
  .resume-banner { grid-template-columns: 100px 1fr; gap: 14px; padding: 14px; }
  .resume-img { width: 100px; height: 100px; }
  .resume-banner > .btn { grid-column: 1 / -1; justify-self: start; }
}

/* ---------- TWO-COL GRID ---------- */
.dash-grid {
  display: grid; grid-template-columns: 1fr 360px;
  gap: 56px; padding: 16px 28px 80px;
  position: relative; z-index: 2;
  max-width: var(--container); margin: 0 auto;
}
@media (max-width: 1100px) { .dash-grid { grid-template-columns: 1fr; gap: 32px; padding: 16px 28px 60px; } }
.dash-main, .dash-side { display: flex; flex-direction: column; gap: 22px; }
.dash-main > section + section { margin-top: 34px; }

.section-head {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 24px; margin-bottom: 18px; flex-wrap: wrap;
}
.section-head h2 {
  font-family: var(--sans); font-weight: 500;
  font-size: clamp(26px, 3.2vw, 36px);
  line-height: 1.05; letter-spacing: -0.03em;
}
.section-head h2 em {
  font-family: var(--serif); font-style: italic; font-weight: 400;
  color: var(--orange);
}

/* ---------- MEAL TABS ---------- */
.meal-tabs {
  display: flex; gap: 4px;
  background: var(--cream-deep);
  padding: 4px; border-radius: var(--r-pill);
}
.meal-tab {
  padding: 8px 16px; border-radius: var(--r-pill);
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-muted);
  transition: all 180ms;
}
.meal-tab:hover { color: var(--ink); }
.meal-tab.active { background: var(--ink); color: var(--paper); }

/* ---------- REC CARDS ---------- */
.rec-stack { display: flex; flex-direction: column; gap: 14px; }
.rec-card {
  display: grid; grid-template-columns: 120px 1fr auto;
  gap: 18px; align-items: center;
  padding: 14px 20px 14px 14px;
  text-decoration: none; color: inherit;
}
.rec-img {
  position: relative;
  width: 120px; height: 120px;
  border-radius: var(--r-md);
  overflow: hidden; border: 1.5px solid var(--ink);
  display: grid; place-items: center;
  font-size: 48px; flex-shrink: 0;
}
.rec-img img { width: 100%; height: 100%; object-fit: cover; }
.rec-rank {
  position: absolute; top: 8px; left: 8px;
  background: var(--ink); color: var(--paper);
  padding: 3px 8px; border-radius: var(--r-pill);
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.06em; font-weight: 600;
}
.rec-name { font-family: var(--sans); font-weight: 500; font-size: 20px; letter-spacing: -0.02em; }
.rec-reason {
  font-family: var(--serif); font-style: italic;
  font-size: 15px; color: var(--ink-soft); line-height: 1.4;
  margin-top: 4px;
}
.rec-meta {
  display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.06em; color: var(--ink-muted);
  text-transform: uppercase;
}
.rec-go {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ink); padding: 8px 14px;
  border: 1.5px solid var(--ink);
  border-radius: var(--r-pill);
  transition: all 180ms;
  white-space: nowrap;
}
.rec-card:hover .rec-go { background: var(--orange); color: var(--paper); border-color: var(--orange); }
@media (max-width: 720px) {
  .rec-card { grid-template-columns: 88px 1fr; gap: 14px; padding: 12px; }
  .rec-img { width: 88px; height: 88px; font-size: 36px; }
  .rec-go { display: none; }
}

/* ---------- SAVED GRID ---------- */
.saved-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr));
  gap: 18px;
}
.saved-card { overflow: hidden; text-decoration: none; color: inherit; display: block; }
.saved-img {
  position: relative; aspect-ratio: 4/3;
  border-bottom: 1.5px solid var(--ink); overflow: hidden;
  display: grid; place-items: center; font-size: 64px;
}
.saved-img img { width: 100%; height: 100%; object-fit: cover; transition: transform 600ms cubic-bezier(.2,.8,.2,1); }
.saved-card:hover .saved-img img { transform: scale(1.05); }
.saved-heart {
  position: absolute; top: 10px; right: 10px;
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--paper); border: 1.5px solid var(--ink);
  display: grid; place-items: center;
  color: var(--berry); font-size: 16px;
  z-index: 2;
}
.saved-body { padding: 14px 16px 16px; }
.saved-body h4 { font-family: var(--sans); font-weight: 500; font-size: 16px; letter-spacing: -0.015em; }
.saved-meta { font-family: var(--mono); font-size: 11px; color: var(--ink-muted); margin-top: 4px; letter-spacing: 0.04em; }

/* ---------- SIDEBAR CARDS ---------- */
.side-card { padding: 22px; }
.side-card h3 {
  font-family: var(--sans); font-weight: 500;
  font-size: 22px; letter-spacing: -0.02em; line-height: 1.15;
  margin-bottom: 6px;
}
.side-card h3 em {
  font-family: var(--serif); font-style: italic; font-weight: 400;
  color: var(--orange);
}
.side-sub {
  font-family: var(--serif); font-style: italic;
  font-size: 15px; color: var(--ink-soft);
  line-height: 1.45; margin-bottom: 14px;
}
.dash-empty {
  font-family: var(--serif); font-style: italic;
  font-size: 15px; color: var(--ink-muted);
  padding: 14px 0;
}

/* markers glance */
.mk-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.mk-mini {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: var(--cream-deep);
  border-radius: var(--r-md);
}
.mk-mini-name { font-size: 13px; color: var(--ink); font-weight: 500; }
.mk-mini-pill {
  font-family: var(--mono); font-size: 10px;
  padding: 3px 9px; border-radius: var(--r-pill);
  letter-spacing: 0.04em; white-space: nowrap;
  text-transform: uppercase;
}
.mk-mini-pill.ok   { background: var(--matcha-soft); color: var(--matcha-deep); }
.mk-mini-pill.low  { background: rgba(244,214,122,0.4); color: #8a6a14; }
.mk-mini-pill.high { background: rgba(200,75,90,0.16); color: var(--berry); }

/* meal log */
.log-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }
.log-row {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 6px 0;
}
.log-dot {
  width: 8px; height: 8px; margin-top: 6px;
  background: var(--orange); border-radius: 50%; flex-shrink: 0;
}
.log-name {
  font-size: 14px; font-weight: 500; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.log-meta { display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.meal-badge {
  font-family: var(--mono); font-size: 9px;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 2px 7px; border-radius: var(--r-pill);
  background: var(--cream-deep); color: var(--ink-muted); font-weight: 600;
}
.meal-badge.breakfast { background: rgba(244,214,122,0.5); color: #8a6a14; }
.meal-badge.lunch { background: var(--orange-soft); color: var(--orange-deep); }
.meal-badge.dinner { background: rgba(31,26,20,0.1); color: var(--ink); }
.meal-badge.snack { background: var(--matcha-soft); color: var(--matcha-deep); }
.log-when {
  font-family: var(--mono); font-size: 10px;
  color: var(--ink-faint); letter-spacing: 0.06em;
  text-transform: uppercase;
}
.log-sv {
  font-family: var(--mono); font-size: 10px;
  color: var(--ink-muted); letter-spacing: 0.04em;
}

/* meal-log form */
.log-form {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 8px; padding-top: 14px;
  border-top: 1px dashed var(--rule-strong);
}
.log-form .input, .log-form .select {
  width: 100%;
  padding: 9px 12px;
  background: var(--cream-soft);
  border: 1.5px solid var(--rule-strong);
  border-radius: var(--r-sm);
  font-size: 13px; color: var(--ink); outline: none;
  transition: border-color 180ms, background 180ms;
}
.log-form .input:focus, .log-form .select:focus {
  border-color: var(--orange); background: var(--paper);
}
.log-form .select {
  appearance: none; -webkit-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 12 8'><path d='M1 1l5 5 5-5' stroke='%231F1A14' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}
.log-form .full { grid-column: 1 / -1; }
.log-form .btn { width: 100%; padding: 9px 14px; font-size: 12px; font-family: var(--mono); letter-spacing: 0.08em; text-transform: uppercase; }

/* tip card */
.tip-card { padding: 20px; background: var(--cream-deep); }
.tip-scribble {
  font-family: var(--hand); font-size: 28px;
  color: var(--orange); transform: rotate(-2deg); display: inline-block;
  line-height: 1; margin-bottom: 4px;
}
.tip-card p {
  font-family: var(--serif); font-style: italic;
  font-size: 17px; line-height: 1.4;
  color: var(--ink-soft);
}

/* ---------- ANIM ---------- */
@keyframes reveal { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
.reveal { animation: reveal 700ms cubic-bezier(.2,.8,.2,1) both; }

/* ---------- MOBILE ---------- */
@media (max-width: 720px) {
  .nav-links { display: none; }
  .nav-inner { padding: 0 20px; gap: 12px; }
  .wrap { padding: 0 20px; }
  .dash-grid { padding: 16px 20px 60px; }
  .dash-hero { padding: 40px 0 24px; }
  .dash-hero-sub { font-size: 18px; }
  .side-card { padding: 18px; }
  .log-form { grid-template-columns: 1fr; }
}
@media (max-width: 420px) {
  .wrap { padding: 0 16px; }
  .nav-inner { padding: 0 16px; }
  .dash-grid { padding: 16px 16px 60px; }
  .dash-stat { min-width: 96px; padding: 12px 16px; }
  .dash-stat-value { font-size: 26px; }
  .resume-name { font-size: 24px; }
  .rec-name { font-size: 17px; }
  .rec-reason { font-size: 14px; }
  .saved-body h4 { font-size: 15px; }
  .nav-user span:not(.nav-avatar) { display: none; }
  .nav-user { padding: 4px; }
}
`;

// ---------- helpers ----------

function formatAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 5) return 'late night';
  if (h < 12) return 'good morning';
  if (h < 17) return 'good afternoon';
  return 'good evening';
}

function markerStatus(def, row) {
  if (!def || !row || row.value == null) return 'ok';
  const v = Number(row.value);
  if (def.normal_min != null && v < Number(def.normal_min)) return 'low';
  if (def.normal_max != null && v > Number(def.normal_max)) return 'high';
  return 'ok';
}

// distinct days with at least one meal log, counted backwards from today
function computeStreak(logs) {
  if (!logs?.length) return 0;
  const days = new Set(
    logs.map((l) => new Date(l.logged_at).toISOString().slice(0, 10))
  );
  let streak = 0;
  const cur = new Date();
  cur.setHours(0, 0, 0, 0);
  while (days.has(cur.toISOString().slice(0, 10))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

// ---------- auth guard ----------

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

// ---------- recipe image ----------

function RecipeImage({ recipe, fallbackBg, className, children }) {
  const [errored, setErrored] = useState(false);
  const emoji = recipe?.media?.emoji || '🍽';
  const bg = recipe?.colorSoft || fallbackBg || 'var(--orange-soft)';

  return (
    <div className={className} style={{ background: bg, position: 'relative' }}>
      {(!recipe?.id || errored)
        ? <span>{emoji}</span>
        : <img
            src={`data/recipe-bundles/${recipe.id}/hero.jpg`}
            alt={recipe.name || ''}
            loading="lazy"
            onError={() => setErrored(true)}
          />}
      {children}
    </div>
  );
}

// ---------- chrome ----------

function Nav({ user }) {
  const UserMenu = window.MfcUserMenu;
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="brand" href="../index.html">
          <span className="brand-mark">m</span>
          <span className="brand-name">MyFood<em>Craving</em></span>
        </a>
        <div className="nav-links">
          <a href="../index.html">Home</a>
          <a href="markers.html">Bloodwork</a>
          <a href="../recipe-search.html">Recipes</a>
        </div>
        {UserMenu && <UserMenu user={user} accountHref="account.html" />}
      </div>
    </nav>
  );
}

// ---------- main ----------

function DashboardApp() {
  const { user, ready } = useAuthGuard();

  const [mealType, setMealType]       = useState(() => window.MFC?.mealTime?.defaultMealTypeForNow?.() || 'lunch');
  const [recs, setRecs]               = useState([]);
  const [recipesById, setRecipesById] = useState({});
  const [sessions, setSessions]       = useState([]);
  const [saved, setSaved]             = useState([]);
  const [logs, setLogs]               = useState([]);
  const [metricDefs, setMetricDefs]   = useState([]);
  const [markers, setMarkers]         = useState([]);
  const [logForm, setLogForm]         = useState({ mealType: '', recipeId: '', servings: '' });
  const [logBusy, setLogBusy]         = useState(false);

  useEffect(() => {
    if (ready && !user) window.location.href = 'index.html';
  }, [ready, user]);

  useEffect(() => {
    if (!user) return;
    const db = window.MFC?.db; if (!db) return;
    db.getRecipes().then((list) => {
      const byId = {}; for (const r of list || []) byId[r.id] = r;
      setRecipesById(byId);
    });
    db.getActiveSessions().then((s) => setSessions(s || []));
    db.getSaved().then((s) => setSaved(s || []));
    const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    db.getMealLogs({ from }).then((list) => setLogs(list || []));
    db.getMetricDefinitions?.().then((d) => setMetricDefs(d || []));
    db.getHealthMarkers?.().then((m) => setMarkers(m || []));
  }, [user]);

  useEffect(() => {
    if (!user) return;
    window.MFC?.db?.getRecommendations(mealType).then((r) => setRecs(r || []));
  }, [user, mealType]);

  useEffect(() => {
    setLogForm((f) => f.mealType ? f : { ...f, mealType });
  }, [mealType]);

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
      window.MFC.db.getMealLogs({ from }).then((list) => setLogs(list || []));
      setLogForm({ mealType: logForm.mealType, recipeId: '', servings: '' });
    }
  }

  // Markers — flagged
  const markersById = useMemo(() => {
    const m = {}; for (const r of markers) m[r.metric_id] = r; return m;
  }, [markers]);
  const flagged = useMemo(() => {
    return metricDefs
      .map((d) => ({ def: d, row: markersById[d.id] }))
      .filter(({ row }) => !!row)
      .map(({ def, row }) => ({ def, row, status: markerStatus(def, row) }))
      .filter(({ status }) => status !== 'ok');
  }, [metricDefs, markersById]);
  const lastMeasured = useMemo(() => {
    if (!markers.length) return null;
    return markers.reduce(
      (acc, r) => (!acc || new Date(r.measured_at) > new Date(acc)) ? r.measured_at : acc,
      null
    );
  }, [markers]);

  // Stats
  const cookedThisWeek = logs.length;
  const streak = useMemo(() => computeStreak(logs), [logs]);

  if (!ready) return <div className="dash-loading">Loading…</div>;
  if (!user)  return null;

  const firstName  = (user.name || (user.email || '').split('@')[0] || 'there').split(' ')[0];
  const allRecipes = Object.values(recipesById).sort((a, b) => a.name.localeCompare(b.name));

  // Hero sub: dynamic from sessions if any, else generic
  const topSession = sessions[0];
  const topSessionRecipe = topSession ? recipesById[topSession.recipe_id] : null;
  const heroSub = topSessionRecipe
    ? `You've got ${topSessionRecipe.name.toLowerCase()} waiting on step ${topSession.current_step + 1}. Pick it up?`
    : "Here's what's worth cooking today.";

  // Date subline
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <>
      <style>{DASH_STYLE}</style>

      <Nav user={user} />

      <main className="reveal">

        {/* HERO */}
        <section className="dash-hero">
          <div className="wrap">
            <div className="dash-hero-row">
              <div>
                <div className="eyebrow-comment" style={{ marginBottom: 10 }}>
                  {timeOfDayGreeting()} · {today}
                </div>
                <h1 className="dash-hero-title">Hey, <em>{firstName}</em>.</h1>
                <p className="dash-hero-sub">{heroSub}</p>
              </div>
              <div className="dash-stats">
                <Stat label="Streak" value={streak} unit="days" />
                <Stat label="Cooked" value={cookedThisWeek} unit="this wk" />
                <Stat label="Saved" value={saved.length} unit="recipes" />
              </div>
            </div>
          </div>
        </section>

        {/* RESUME COOKING */}
        {sessions.length > 0 && (
          <section style={{ padding: '0' }}>
            <div className="wrap">
              {sessions.map((s) => {
                const r = recipesById[s.recipe_id];
                if (!r) return null;
                return (
                  <div key={s.recipe_id} className="card resume-banner" style={{ boxShadow: '8px 8px 0 var(--matcha)' }}>
                    <RecipeImage recipe={r} className="resume-img" />
                    <div className="resume-body">
                      <div className="eyebrow-comment">resume cooking</div>
                      <h3 className="resume-name">{r.name}</h3>
                      <p className="resume-meta">
                        Paused on <b>step {s.current_step + 1}</b> · {formatAgo(s.updated_at)}
                      </p>
                    </div>
                    <a className="btn orange" href={`recipe.html?id=${r.id}&resume=1`}>Resume →</a>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="dash-grid">

          {/* LEFT — RECS + SAVED */}
          <div className="dash-main">

            <section>
              <div className="section-head">
                <div>
                  <div className="section-label">tonight's pick</div>
                  <h2><em>Recommended</em> for you</h2>
                </div>
                <div className="meal-tabs">
                  {['breakfast','lunch','dinner','snack'].map((m) => (
                    <button key={m}
                      className={'meal-tab' + (mealType === m ? ' active' : '')}
                      onClick={() => setMealType(m)}>{m}</button>
                  ))}
                </div>
              </div>
              {recs.length === 0 ? (
                <p className="dash-empty">
                  No {mealType} recommendations yet — your pipeline will populate these once your blood markers are processed.
                </p>
              ) : (
                <div className="rec-stack">
                  {recs.map((r) => {
                    const recipe = recipesById[r.recipe_id];
                    return (
                      <a key={r.recipe_id} className="rec-card card lift" href={`recipe.html?id=${r.recipe_id}`}>
                        <RecipeImage recipe={recipe} className="rec-img">
                          <span className="rec-rank">#{r.rank}</span>
                        </RecipeImage>
                        <div>
                          <div className="rec-name">{recipe?.name || r.recipe_id}</div>
                          {r.reason && <p className="rec-reason">{r.reason}</p>}
                          <div className="rec-meta">
                            {recipe?.cuisine && <span>{recipe.cuisine}</span>}
                            {recipe?.totalMinutes && <><span>·</span><span>⏱ {recipe.totalMinutes} min</span></>}
                            {recipe?.servings && <><span>·</span><span>👥 {recipe.servings}</span></>}
                          </div>
                        </div>
                        <span className="rec-go">Cook →</span>
                      </a>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="section-head">
                <div>
                  <div className="section-label">your library</div>
                  <h2><em>Saved</em> recipes</h2>
                </div>
                {saved.length > 0 && <span className="pill">{saved.length} hearted</span>}
              </div>
              {saved.length === 0 ? (
                <p className="dash-empty">Tap the ♥ icon on any recipe to save it here.</p>
              ) : (
                <div className="saved-grid">
                  {saved.map((s) => {
                    const r = recipesById[s.recipe_id];
                    return (
                      <a key={s.recipe_id} className="saved-card card lift" href={`recipe.html?id=${s.recipe_id}`}>
                        <RecipeImage recipe={r} className="saved-img" fallbackBg="var(--cream-deep)">
                          <span className="saved-heart">♥</span>
                        </RecipeImage>
                        <div className="saved-body">
                          <h4>{r?.name || s.recipe_id}</h4>
                          <div className="saved-meta">
                            {[r?.cuisine, r?.totalMinutes && `${r.totalMinutes} min`].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </a>
                    );
                  })}
                </div>
              )}
            </section>

          </div>

          {/* RIGHT — SIDEBAR */}
          <aside className="dash-side">

            {/* MARKERS GLANCE */}
            <div className="card side-card">
              <div className="eyebrow-comment" style={{ marginBottom: 8 }}>blood markers</div>
              {markers.length === 0 ? (
                <>
                  <h3>No <em>markers</em> yet</h3>
                  <p className="side-sub">Add a recent test to power tailored recommendations.</p>
                  <a className="btn sm" style={{ width: '100%' }} href="markers.html">Add markers →</a>
                </>
              ) : (
                <>
                  <h3>
                    {flagged.length === 0
                      ? <>All markers <em>in range</em></>
                      : <>{flagged.length} marker{flagged.length === 1 ? '' : 's'} <em>need attention</em></>}
                  </h3>
                  {lastMeasured && (
                    <p className="side-sub">
                      Last test: {new Date(lastMeasured).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                  {flagged.length > 0 && (
                    <div className="mk-list">
                      {flagged.slice(0, 3).map(({ def, row, status }) => (
                        <div key={def.id} className="mk-mini">
                          <span className="mk-mini-name">{def.name}</span>
                          <span className={'mk-mini-pill ' + status}>
                            {row.value}{def.unit ? ' ' + def.unit : ''} · {status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <a className="btn sm" style={{ width: '100%' }} href="markers.html">Update markers →</a>
                </>
              )}
            </div>

            {/* MEAL LOG */}
            <div className="card side-card">
              <div className="eyebrow-comment" style={{ marginBottom: 12 }}>meal log · last 7 days</div>
              {logs.length === 0 ? (
                <p className="dash-empty" style={{ padding: '4px 0 14px' }}>
                  No meals logged yet this week.
                </p>
              ) : (
                <div className="log-list">
                  {logs.slice(0, 5).map((l) => {
                    const r = l.recipe_id ? recipesById[l.recipe_id] : null;
                    return (
                      <div key={l.id} className="log-row">
                        <div className="log-dot" />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="log-name">{r?.name || (l.recipe_id || '—')}</div>
                          <div className="log-meta">
                            <span className={'meal-badge ' + l.meal_type}>{l.meal_type}</span>
                            {l.servings != null && <span className="log-sv">{l.servings}× serv</span>}
                            <span className="log-when">
                              {new Date(l.logged_at).toLocaleDateString('en-US', { weekday: 'short' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <form className="log-form" onSubmit={handleLogMeal}>
                <select className="select" value={logForm.mealType}
                  onChange={(e) => setLogForm((f) => ({ ...f, mealType: e.target.value }))}>
                  <option value="">Meal…</option>
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                  <option value="snack">Snack</option>
                </select>
                <input type="number" min="0.5" step="0.5" placeholder="Servings"
                  className="input"
                  value={logForm.servings}
                  onChange={(e) => setLogForm((f) => ({ ...f, servings: e.target.value }))} />
                <select className="select full" value={logForm.recipeId}
                  onChange={(e) => setLogForm((f) => ({ ...f, recipeId: e.target.value }))}>
                  <option value="">Recipe (optional)</option>
                  {allRecipes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <button type="submit" className="btn full"
                  disabled={logBusy || !logForm.mealType}>
                  {logBusy ? 'Logging…' : '+ Log a meal'}
                </button>
              </form>
            </div>

            {/* TIP */}
            <div className="card tip-card">
              <div className="tip-scribble">✎ tip</div>
              <p>Pair iron-rich foods with vitamin C — your ferritin trend will thank you.</p>
            </div>

          </aside>
        </div>
      </main>
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

ReactDOM.createRoot(document.getElementById('root')).render(<DashboardApp />);
