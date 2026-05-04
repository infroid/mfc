const { useState, useEffect, useMemo } = React;

const MARKERS_STYLE = `
.wrap { max-width: var(--container); margin: 0 auto; padding: 0 28px; position: relative; z-index: 2; }

.mk-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 100vh; gap: 14px;
}
.mk-loading .pulse {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--orange);
  animation: mk-pulse 1.1s cubic-bezier(.4,0,.6,1) infinite;
}
.mk-loading p {
  font-family: var(--serif); font-style: italic; font-size: 18px;
  color: var(--ink-muted); letter-spacing: -0.01em;
}
@keyframes mk-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.6); }
}

/* ---------- NAV (outer only — inner pieces in shared/nav.jsx) ---------- */
.nav {
  position: sticky; top: 0; z-index: 50; height: 64px;
  display: flex; align-items: center;
  background: rgba(247, 241, 227, 0.86);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
          backdrop-filter: blur(14px) saturate(160%);
  border-bottom: 1px solid var(--rule);
}

/* ---------- BUTTONS ---------- */
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

/* ---------- ATOMS ---------- */
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

.card {
  background: var(--paper);
  border: 1.5px solid var(--ink);
  border-radius: var(--r-lg);
  box-shadow: var(--pop-md);
  transition: transform 200ms cubic-bezier(.2,.8,.2,1),
              box-shadow 200ms cubic-bezier(.2,.8,.2,1);
}
.card.lift:hover { transform: translate(-2px,-2px); box-shadow: var(--pop-lg); }

/* ---------- HERO ---------- */
.mk-hero { padding: 56px 0 32px; }
.mk-hero h1 {
  font-family: var(--sans); font-weight: 500;
  font-size: clamp(42px, 5.4vw, 68px);
  line-height: 0.98; letter-spacing: -0.035em;
}
.mk-hero h1 em {
  font-family: var(--serif); font-style: italic; font-weight: 400;
  color: var(--orange);
}
.mk-hero-sub {
  font-family: var(--serif); font-style: italic;
  font-size: 22px; color: var(--ink-soft);
  margin-top: 14px; max-width: 640px; line-height: 1.35;
}

.markers-summary {
  display: flex; gap: 16px; margin-top: 28px; flex-wrap: wrap;
}
.summary-stat {
  flex: 1; min-width: 160px;
  background: var(--paper);
  border: 1.5px solid var(--ink);
  border-radius: var(--r-md);
  padding: 18px 22px;
  box-shadow: var(--pop-md);
}
.summary-stat.tone-ok    { box-shadow: 4px 4px 0 var(--matcha); }
.summary-stat.tone-alert { box-shadow: 4px 4px 0 var(--berry); }
.summary-stat.tone-muted { box-shadow: 4px 4px 0 var(--ink-muted); }
.summary-stat-value {
  font-family: var(--sans); font-weight: 500;
  font-size: 44px; letter-spacing: -0.03em; line-height: 1;
}
.summary-stat-label {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ink-muted); margin-top: 8px;
}

/* ---------- TABS ---------- */
.markers-tabs {
  display: flex; gap: 8px; margin-top: 24px; align-items: center;
  flex-wrap: wrap;
  padding-bottom: 18px;
  border-bottom: 1px dashed var(--rule-strong);
}
.filter-chip {
  padding: 9px 18px;
  background: transparent;
  border: 1.5px solid var(--rule-strong);
  border-radius: var(--r-pill);
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--ink-muted);
  transition: all 180ms cubic-bezier(.2,.8,.2,1);
  cursor: pointer;
}
.filter-chip:hover { border-color: var(--ink); color: var(--ink); }
.filter-chip.active {
  background: var(--ink); color: var(--paper); border-color: var(--ink);
  box-shadow: var(--pop-sm);
  transform: translate(-1px,-1px);
}

/* ---------- SECTION HEAD ---------- */
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

/* ---------- MARKER CARDS ---------- */
.markers-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
  gap: 18px;
  margin-top: 22px;
}
.marker-card { padding: 22px; display: flex; flex-direction: column; gap: 14px; }
.marker-card.status-low  { box-shadow: 5px 5px 0 var(--butter); }
.marker-card.status-high { box-shadow: 5px 5px 0 var(--berry); }
.mc-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.mc-cat {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--ink-muted); margin-bottom: 4px;
}
.mc-name {
  font-family: var(--sans); font-weight: 500;
  font-size: 19px; letter-spacing: -0.02em;
}
.mc-status {
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.08em; text-transform: uppercase;
  padding: 4px 10px; border-radius: var(--r-pill);
  white-space: nowrap;
}
.mc-status.ok   { background: var(--matcha-soft); color: var(--matcha-deep); }
.mc-status.low  { background: rgba(244,214,122,0.4); color: #8a6a14; }
.mc-status.high { background: rgba(200,75,90,0.16); color: var(--berry); }
.mc-value { display: flex; align-items: baseline; gap: 8px; }
.mc-num {
  font-family: var(--sans); font-weight: 500;
  font-size: 44px; letter-spacing: -0.03em; line-height: 1;
}
.mc-unit { font-family: var(--mono); font-size: 12px; color: var(--ink-muted); letter-spacing: 0.04em; }
.mc-trend { font-size: 18px; margin-left: auto; }
.mc-trend.up   { color: var(--matcha-deep); }
.mc-trend.down { color: var(--berry); }
.mc-trend.flat { color: var(--ink-muted); }
.mc-meta {
  display: flex; gap: 8px; flex-wrap: wrap;
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.04em; color: var(--ink-muted);
}
.mc-recs {
  margin-top: auto; padding-top: 14px;
  border-top: 1px dashed var(--rule-strong);
}
.mc-rec-list { display: flex; flex-direction: column; gap: 6px; }
.mc-rec {
  display: flex; align-items: center; gap: 10px;
  padding: 6px;
  border-radius: var(--r-sm);
  transition: background 180ms;
  text-decoration: none; color: inherit;
}
.mc-rec:hover { background: var(--cream-deep); }
.mc-rec-thumb {
  width: 36px; height: 36px; border-radius: var(--r-sm);
  overflow: hidden; flex-shrink: 0;
  display: grid; place-items: center;
  font-size: 18px;
  background: var(--orange-soft);
}
.mc-rec-thumb img { width: 100%; height: 100%; object-fit: cover; }
.mc-rec-name { font-size: 13px; font-weight: 500; }
.mc-empty { padding: 12px 0 4px; text-align: center; }
.mc-empty p {
  font-family: var(--serif); font-style: italic;
  color: var(--ink-muted); font-size: 16px;
}
.mc-edit-toggle {
  font-family: var(--mono); font-size: 11px;
  color: var(--ink-muted); letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 6px 10px; border-radius: var(--r-pill);
  transition: color 150ms, background 150ms;
}
.mc-edit-toggle:hover { color: var(--orange); background: var(--cream-deep); }

/* inline editor */
.mc-editor {
  display: grid; grid-template-columns: 1fr 1fr auto;
  gap: 8px; align-items: center;
  padding: 12px;
  background: var(--cream-deep);
  border-radius: var(--r-md);
  margin-top: 4px;
}
.mc-editor input {
  width: 100%;
  padding: 9px 12px;
  background: var(--paper);
  border: 1.5px solid var(--rule-strong);
  border-radius: var(--r-sm);
  font-family: var(--mono); font-size: 13px;
  color: var(--ink); outline: none;
  transition: border-color 150ms;
}
.mc-editor input:focus { border-color: var(--orange); }
.mc-editor .btn { padding: 9px 14px; font-size: 12px; box-shadow: var(--pop-sm); }
.mc-editor .btn:hover { box-shadow: 4px 4px 0 var(--ink); }
.mc-saved-flash {
  font-family: var(--mono); font-size: 11px;
  color: var(--matcha-deep); letter-spacing: 0.04em;
  margin-top: 4px;
}

/* range bar */
.range-bar {
  position: relative;
  height: 32px;
  margin: 4px 0 4px;
}
.range-track {
  position: absolute; left: 0; right: 0; top: 14px;
  height: 4px;
  background: var(--cream-deep);
  border-radius: var(--r-pill);
}
.range-ok {
  position: absolute; top: 14px; height: 4px;
  background: linear-gradient(90deg, var(--matcha), var(--matcha-deep));
  border-radius: var(--r-pill);
}
.range-marker { position: absolute; top: 4px; transform: translateX(-50%); }
.range-marker .range-tick {
  display: block;
  width: 4px; height: 24px;
  background: var(--ink);
  border-radius: 2px;
}
.range-marker.status-low  .range-tick { background: var(--butter); box-shadow: 0 0 0 3px rgba(244,214,122,0.4); }
.range-marker.status-high .range-tick { background: var(--berry); box-shadow: 0 0 0 3px rgba(200,75,90,0.2); }
.range-marker.status-ok   .range-tick { background: var(--matcha-deep); }

/* footer note */
.mk-footer-note {
  margin: 56px 0 56px;
  padding: 20px 24px;
  border: 1.5px dashed rgba(122,156,90,0.45);
  background: var(--matcha-soft);
  border-radius: var(--r-md);
  display: flex; gap: 14px; align-items: flex-start;
}
.mk-footer-note .scribble {
  font-family: var(--hand); font-size: 28px;
  color: var(--matcha-deep); transform: rotate(-2deg);
  line-height: 1; flex-shrink: 0;
}
.mk-footer-note p {
  font-family: var(--serif); font-style: italic;
  font-size: 16px; color: var(--ink-soft); line-height: 1.4;
}

/* anim */
@keyframes reveal { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
.reveal { animation: reveal 700ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes card-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
.card-stagger { animation: card-rise 520ms cubic-bezier(.2,.8,.2,1) backwards; }

/* hero scribble */
.mk-hero-wrap { position: relative; }
.mk-scribble {
  font-family: var(--hand); font-weight: 500;
  font-size: 26px; color: var(--orange); line-height: 1;
  display: inline-block; transform: rotate(-3deg);
  margin-left: 6px; vertical-align: 2px;
  white-space: nowrap;
}
@media (max-width: 720px) { .mk-scribble { display: none; } }

@media (max-width: 720px) {
  .nav-links { display: none; }
  .nav-inner { padding: 0 20px; gap: 12px; }
  .wrap { padding: 0 20px; }
  .mk-hero { padding: 32px 0 24px; }
  .mk-hero-sub { font-size: 18px; }
  .markers-grid { grid-template-columns: 1fr; }
  .mc-editor { grid-template-columns: 1fr 1fr; }
  .mc-editor .btn { grid-column: 1 / -1; }
  .mk-footer-note { margin: 32px 0 32px; padding: 16px 18px; }
}
@media (max-width: 420px) {
  .wrap { padding: 0 16px; }
  .nav-inner { padding: 0 16px; }
  .summary-stat { padding: 14px 16px; }
  .summary-stat-value { font-size: 36px; }
  .marker-card { padding: 18px; }
  .mc-num { font-size: 36px; }
  .filter-chip { padding: 8px 14px; }
}
`;

// ---------- marker → recipe suggestions ----------
// Hardcoded mapping: which recipes help move a given metric in the right direction.
// Used only to surface "cook this" suggestions on flagged marker cards.
const MARKER_RECIPE_HINTS = {
  iron:              ['palak-paneer', 'dal-makhani', 'rajma-chawal'],
  ferritin:          ['palak-paneer', 'dal-makhani', 'rajma-chawal'],
  hemoglobin:        ['palak-paneer', 'rajma-chawal'],
  magnesium:         ['dal-makhani', 'palak-paneer'],
  zinc:              ['butter-chicken', 'dal-makhani'],
  'vit-d':           ['tandoori-chicken', 'butter-chicken'],
  'vit-b12':         ['butter-chicken', 'tandoori-chicken'],
  folate:            ['palak-paneer', 'dal-makhani'],
  ldl:               ['aloo-gobi', 'palak-paneer'],
  hdl:               ['palak-paneer', 'aloo-gobi'],
  triglycerides:     ['aloo-gobi', 'palak-paneer'],
  'fasting-glucose': ['aloo-gobi', 'palak-paneer'],
  hba1c:             ['aloo-gobi', 'palak-paneer'],
  tsh:               ['palak-paneer'],
  creatinine:        ['aloo-gobi'],
  wbc:               ['palak-paneer'],
};

const CATEGORY_TABS = [
  'all',
  'iron-panel', 'inflammation',
  'lipid', 'metabolic',
  'liver', 'kidney',
  'vitamin', 'mineral',
  'thyroid', 'other',
];

// Apply user.biologicalSex to a metric def: when sex-specific bounds exist
// they replace the unisex normal_min/max; otherwise the def is unchanged.
function resolveDef(def, sex) {
  if (sex !== 'female' && sex !== 'male') return def;
  const minKey = sex === 'female' ? 'normal_min_female' : 'normal_min_male';
  const maxKey = sex === 'female' ? 'normal_max_female' : 'normal_max_male';
  const lo = def[minKey];
  const hi = def[maxKey];
  if (lo == null && hi == null) return def;
  return {
    ...def,
    normal_min: lo != null ? lo : def.normal_min,
    normal_max: hi != null ? hi : def.normal_max,
  };
}

function markerStatus(def, value) {
  if (value == null || value === '') return 'missing';
  const v = Number(value);
  if (def.normal_min != null && v < Number(def.normal_min)) return 'low';
  if (def.normal_max != null && v > Number(def.normal_max)) return 'high';
  return 'ok';
}

function fmtRange(def) {
  const lo = def.normal_min, hi = def.normal_max, u = def.unit || '';
  if (lo != null && hi != null) return `Normal: ${lo}–${hi} ${u}`;
  if (hi != null) return `Normal: < ${hi} ${u}`;
  if (lo != null) return `Normal: > ${lo} ${u}`;
  return `Unit: ${u}`;
}

function fmtTestedDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ---------- auth guard ----------

function useAuthGuard() {
  const [user, setUser]   = useState(() => window.MFC?.auth?.getUser() || null);
  const [ready, setReady] = useState(() => !!window.MFC?.auth?.getUser());
  useEffect(() => {
    const h = (e) => { setUser(e.detail.user); setReady(true); };
    window.addEventListener('mfc:auth-change', h);
    return () => window.removeEventListener('mfc:auth-change', h);
  }, []);
  return { user, ready };
}

// ---------- chrome ----------

function Nav({ user }) {
  const MfcNav = window.MfcNav;
  return MfcNav ? <MfcNav user={user} active="bloodwork" base="../" /> : null;
}

// ---------- range bar ----------

function RangeBar({ def, value, status }) {
  const lo = def.normal_min != null ? Number(def.normal_min) : null;
  const hi = def.normal_max != null ? Number(def.normal_max) : null;
  const v  = Number(value);
  const min = lo != null ? lo * 0.6 : 0;
  const max = hi != null ? hi * 1.3 : (lo ? lo * 2.5 : v * 1.4 || 100);
  const pct = Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
  const loPct = lo != null ? Math.max(0, Math.min(100, ((lo - min) / (max - min)) * 100)) : 0;
  const hiPct = hi != null ? Math.max(0, Math.min(100, ((hi - min) / (max - min)) * 100)) : 100;
  return (
    <div className="range-bar">
      <div className="range-track" />
      <div className="range-ok" style={{ left: loPct + '%', width: (hiPct - loPct) + '%' }} />
      <div className={'range-marker status-' + status} style={{ left: pct + '%' }}>
        <span className="range-tick" />
      </div>
    </div>
  );
}

// ---------- recipe thumb ----------

function RecipeThumb({ recipe }) {
  const [errored, setErrored] = useState(false);
  if (!recipe) return <span className="mc-rec-thumb">🍽</span>;
  return (
    <span className="mc-rec-thumb">
      {errored
        ? <span>🍽</span>
        : <img
            src={`data/recipe-bundles/${recipe.id}/hero.jpg`}
            alt=""
            loading="lazy"
            onError={() => setErrored(true)}
          />}
    </span>
  );
}

// ---------- marker card ----------

function MarkerCard({ def, reading, recipes, onSaved, index }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(reading?.value ?? '');
  const [date, setDate]       = useState(reading?.measured_at || todayISO());
  const [busy, setBusy]       = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  useEffect(() => {
    setEditing(false);
    setValue(reading?.value ?? '');
    setDate(reading?.measured_at || todayISO());
  }, [reading?.value, reading?.measured_at]);

  const status = markerStatus(def, reading?.value);
  const justSaved = savedAt && Date.now() - savedAt < 2200;

  async function save() {
    if (value === '' || isNaN(Number(value))) return;
    setBusy(true);
    const ok = await window.MFC?.db?.upsertHealthMarker({
      metricId: def.id,
      value: Number(value),
      unit: def.unit,
      measuredAt: date,
    });
    setBusy(false);
    if (ok) {
      setSavedAt(Date.now());
      setEditing(false);
      onSaved?.();
    }
  }

  const stagger = typeof index === 'number' ? { animationDelay: Math.min(index, 18) * 40 + 'ms' } : null;

  return (
    <div className={'marker-card card lift status-' + status + (stagger ? ' card-stagger' : '')} style={stagger}>
      <div className="mc-head">
        <div>
          <div className="mc-cat">{def.category || 'other'}</div>
          <h3 className="mc-name">{def.name}</h3>
        </div>
        {reading
          ? <span className={'mc-status ' + status}>{status === 'ok' ? 'in range' : status}</span>
          : <span className="mc-status" style={{ background: 'var(--cream-deep)', color: 'var(--ink-muted)' }}>not tested</span>}
      </div>

      {reading && !editing && (
        <>
          <div className="mc-value">
            <span className="mc-num">{reading.value}</span>
            <span className="mc-unit">{def.unit}</span>
            <button className="mc-edit-toggle" style={{ marginLeft: 'auto' }} onClick={() => setEditing(true)}>edit</button>
          </div>
          <RangeBar def={def} value={reading.value} status={status} />
          <div className="mc-meta">
            <span>{fmtRange(def)}</span>
            {reading.measured_at && <><span>·</span><span>Tested {fmtTestedDate(reading.measured_at)}</span></>}
          </div>
        </>
      )}

      {!reading && !editing && (
        <div className="mc-empty">
          <p>Not tested yet</p>
          <div className="mc-meta" style={{ justifyContent: 'center', marginTop: 6 }}>
            <span>{fmtRange(def)}</span>
          </div>
          <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setEditing(true)}>+ Add reading</button>
        </div>
      )}

      {editing && (
        <>
          <div className="mc-editor">
            <input
              type="number" step="any" placeholder={`value (${def.unit || ''})`}
              value={value} onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              autoFocus
            />
            <input
              type="date" value={date}
              onChange={(e) => setDate(e.target.value)}
              max={todayISO()}
            />
            <button className="btn sm" onClick={save} disabled={busy || value === ''}>
              {busy ? '…' : 'save'}
            </button>
          </div>
          <div className="mc-meta">
            <span>{fmtRange(def)}</span>
            <button className="mc-edit-toggle" style={{ marginLeft: 'auto' }} onClick={() => setEditing(false)}>cancel</button>
          </div>
          {justSaved && <div className="mc-saved-flash">✓ saved</div>}
        </>
      )}

      {recipes && recipes.length > 0 && reading && (
        <div className="mc-recs">
          <div className="eyebrow-comment" style={{ marginBottom: 8 }}>cook this →</div>
          <div className="mc-rec-list">
            {recipes.slice(0, 2).map((r) => (
              <a key={r.id} href={`recipe.html?id=${r.id}`} className="mc-rec">
                <RecipeThumb recipe={r} />
                <span className="mc-rec-name">{r.name}</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- main ----------

function MarkersApp() {
  const { user, ready } = useAuthGuard();
  const [defs, setDefs]             = useState([]);
  const [latest, setLatest]         = useState({});
  const [recipesById, setRecipesById] = useState({});
  const [tab, setTab]               = useState('all');

  useEffect(() => {
    if (ready && !user) window.location.href = '../index.html';
  }, [ready, user]);

  useEffect(() => {
    if (!user) return;
    const db = window.MFC?.db; if (!db) return;
    db.getMetricDefinitions().then((d) => setDefs(d || []));
    refreshLatest();
    db.getRecipes().then((list) => {
      const byId = {}; for (const r of list || []) byId[r.id] = r;
      setRecipesById(byId);
    });
  }, [user]);

  function refreshLatest() {
    window.MFC?.db?.getHealthMarkers().then((rows) => {
      const byId = {};
      for (const r of rows || []) byId[r.metric_id] = r;
      setLatest(byId);
    });
  }

  function recipesForMarker(metricId) {
    const ids = MARKER_RECIPE_HINTS[metricId] || [];
    return ids.map((id) => recipesById[id]).filter(Boolean);
  }

  const resolvedDefs = useMemo(
    () => defs.map((d) => resolveDef(d, user?.biologicalSex)),
    [defs, user?.biologicalSex]
  );

  const filteredDefs = useMemo(() => {
    return resolvedDefs.filter((d) => tab === 'all' || (d.category || 'other') === tab);
  }, [resolvedDefs, tab]);

  const items = useMemo(() => {
    return filteredDefs.map((d) => ({ def: d, reading: latest[d.id] || null }));
  }, [filteredDefs, latest]);

  const flagged = items.filter(({ def, reading }) => reading && markerStatus(def, reading.value) !== 'ok');
  const ok      = items.filter(({ def, reading }) => reading && markerStatus(def, reading.value) === 'ok');
  const missing = items.filter(({ reading }) => !reading);

  // Visible category tabs — only show ones we actually have defs for
  const availableCats = useMemo(() => {
    const set = new Set(defs.map((d) => d.category || 'other'));
    return CATEGORY_TABS.filter((c) => c === 'all' || set.has(c));
  }, [defs]);

  if (!ready) return (
    <div className="mk-loading">
      <style>{MARKERS_STYLE}</style>
      <span className="pulse" />
      <p>reading your numbers…</p>
    </div>
  );
  if (!user)  return null;

  const Gate = window.MfcBiologicalSexGate;
  const needsBioSex = !user.biologicalSex;

  return (
    <>
      <style>{MARKERS_STYLE}</style>
      <Nav user={user} />
      {needsBioSex && Gate && <Gate user={user} />}

      <main className="reveal">
        <section className="mk-hero">
          <div className="wrap">
            <div className="eyebrow-comment" style={{ marginBottom: 10 }}>your bloodwork</div>
            <h1>What's your body <em>asking for?</em><span className="mk-scribble">read the signals ↘</span></h1>
            <p className="mk-hero-sub">
              Track {defs.length || 'your'} markers. We'll suggest recipes that move them in the right direction.
            </p>

            <div className="markers-summary">
              <SummaryStat label="In range"      value={ok.length}      tone="ok" />
              <SummaryStat label="Need attention" value={flagged.length} tone="alert" />
              <SummaryStat label="Not tested"     value={missing.length} tone="muted" />
            </div>
          </div>
        </section>

        <div className="wrap">
          <div className="markers-tabs">
            {availableCats.map((c) => (
              <button
                key={c}
                className={'filter-chip' + (tab === c ? ' active' : '')}
                onClick={() => setTab(c)}
              >{c}</button>
            ))}
          </div>

          {defs.length === 0 && (
            <p style={{ marginTop: 28, color: 'var(--ink-muted)', fontFamily: 'var(--serif)', fontStyle: 'italic', fontSize: 18 }}>
              Loading markers…
            </p>
          )}

          {flagged.length > 0 && (
            <section style={{ marginTop: 36 }}>
              <div className="section-head">
                <div>
                  <div className="section-label" style={{ color: 'var(--berry)' }}>needs attention</div>
                  <h2><em>{flagged.length}</em> off-range</h2>
                </div>
              </div>
              <div className="markers-grid">
                {flagged.map(({ def, reading }, i) => (
                  <MarkerCard
                    key={def.id} def={def} reading={reading}
                    recipes={recipesForMarker(def.id)}
                    onSaved={refreshLatest}
                    index={i}
                  />
                ))}
              </div>
            </section>
          )}

          {ok.length > 0 && (
            <section style={{ marginTop: 56 }}>
              <div className="section-head">
                <div>
                  <div className="section-label">in range</div>
                  <h2><em>{ok.length}</em> looking good</h2>
                </div>
              </div>
              <div className="markers-grid">
                {ok.map(({ def, reading }, i) => (
                  <MarkerCard
                    key={def.id} def={def} reading={reading}
                    onSaved={refreshLatest}
                    index={i}
                  />
                ))}
              </div>
            </section>
          )}

          {missing.length > 0 && (
            <section style={{ marginTop: 56 }}>
              <div className="section-head">
                <div>
                  <div className="section-label" style={{ color: 'var(--ink-muted)' }}>not yet tested</div>
                  <h2><em>{missing.length}</em> markers · add a reading</h2>
                </div>
              </div>
              <div className="markers-grid">
                {missing.map(({ def }, i) => (
                  <MarkerCard
                    key={def.id} def={def} reading={null}
                    onSaved={refreshLatest}
                    index={i}
                  />
                ))}
              </div>
            </section>
          )}

          <div className="mk-footer-note">
            <span className="scribble">✎</span>
            <p>
              Recommendations refresh once your data pipeline runs against updated markers — usually
              within a few hours. New readings save the moment you tap <b>save</b>.
            </p>
          </div>
        </div>
      </main>
    </>
  );
}

function SummaryStat({ label, value, tone }) {
  return (
    <div className={'summary-stat tone-' + tone}>
      <div className="summary-stat-value">{value}</div>
      <div className="summary-stat-label">{label}</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<MarkersApp />);
