const { useState, useEffect, useMemo } = React;

const MARKERS_STYLE = `
.mk-loading {
  display: flex; align-items: center; justify-content: center;
  min-height: 100vh; font-family: var(--mono); color: var(--ink-muted); font-size: 13px;
}
.mk-nav {
  position: sticky; top: 0; z-index: 100;
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 32px; height: 60px;
  background: var(--paper); border-bottom: 1px solid var(--rule);
}
.mk-logo { font-family: var(--serif); font-style: italic; font-size: 22px; color: var(--orange); }
.mk-nav-right { display: flex; align-items: center; gap: 12px; }
.mk-back {
  font-family: var(--mono); font-size: 12px; color: var(--ink-muted);
  border: 1px solid var(--rule); border-radius: var(--r-sm); padding: 5px 12px;
}
.mk-back:hover { color: var(--ink); border-color: var(--rule-strong); }

.mk-main {
  max-width: 720px; margin: 0 auto; padding: 48px 24px 80px;
  display: flex; flex-direction: column; gap: 40px;
}

.mk-header {}
.mk-title {
  font-family: var(--serif); font-size: clamp(1.8rem, 4vw, 2.6rem);
  font-weight: 400; line-height: 1.15; margin-bottom: 12px;
}
.mk-explainer {
  font-size: 14px; color: var(--ink-muted); line-height: 1.6; max-width: 540px;
}

.mk-category-label {
  font-family: var(--mono); font-size: 10px; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--ink-muted);
  margin-bottom: 8px; margin-top: 4px;
}
.mk-group { display: flex; flex-direction: column; gap: 6px; }

.mk-row {
  display: grid; grid-template-columns: 1fr 100px 130px 28px;
  gap: 8px; align-items: center;
  padding: 10px 14px; border-radius: var(--r-md);
  background: var(--paper); border: 1px solid var(--rule);
}
.mk-row-name { font-weight: 500; font-size: 14px; }
.mk-row-range { font-size: 11px; color: var(--ink-faint); font-family: var(--mono); margin-top: 2px; }
.mk-row input[type="number"],
.mk-row input[type="date"] {
  width: 100%; font: inherit; font-size: 13px; font-family: var(--mono);
  padding: 7px 10px; border-radius: var(--r-sm);
  border: 1px solid var(--rule); background: var(--cream-soft); color: var(--ink);
  outline: none;
}
.mk-row input:focus { border-color: var(--orange); }
.mk-row-status {
  font-family: var(--mono); font-size: 12px; color: var(--matcha-deep);
  text-align: center; width: 28px;
}

.mk-footer-note {
  padding: 16px 20px; border-radius: var(--r-md);
  background: var(--matcha-soft); border: 1px solid rgba(122,156,90,0.25);
  font-size: 13px; color: var(--matcha-deep); line-height: 1.55;
}
`;

const CATEGORY_ORDER = ['mineral','blood','vitamin','lipid','metabolic','thyroid','kidney','other'];

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

function MarkerRow({ def, latest, onSaved }) {
  const [value, setValue] = useState(latest?.value ?? '');
  const [date, setDate]   = useState(latest?.measured_at || new Date().toISOString().slice(0, 10));
  const [savedAt, setSavedAt] = useState(0);
  const [busy, setBusy]   = useState(false);

  async function save() {
    if (!value || isNaN(Number(value))) return;
    setBusy(true);
    const ok = await window.MFC?.db?.upsertHealthMarker({
      metricId: def.id, value: Number(value), unit: def.unit, measuredAt: date,
    });
    setBusy(false);
    if (ok) { setSavedAt(Date.now()); onSaved?.(); }
  }

  const justSaved = savedAt && Date.now() - savedAt < 2200;
  const range = def.normal_min != null && def.normal_max != null
    ? `${def.normal_min}–${def.normal_max} ${def.unit}`
    : def.normal_max != null ? `< ${def.normal_max} ${def.unit}`
    : def.normal_min != null ? `> ${def.normal_min} ${def.unit}`
    : def.unit;

  return (
    <div className="mk-row">
      <div>
        <div className="mk-row-name">{def.name}</div>
        <div className="mk-row-range">{range}</div>
      </div>
      <input type="number" step="any" placeholder="value"
        value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} />
      <input type="date" value={date}
        onChange={(e) => setDate(e.target.value)} onBlur={save} />
      <span className="mk-row-status">{busy ? '…' : justSaved ? '✓' : ''}</span>
    </div>
  );
}

function MarkersApp() {
  const { user, ready } = useAuthGuard();
  const [defs, setDefs]     = useState([]);
  const [latest, setLatest] = useState({});

  useEffect(() => {
    if (ready && !user) window.location.href = 'index.html';
  }, [ready, user]);

  useEffect(() => {
    if (!user) return;
    window.MFC?.db?.getMetricDefinitions().then(setDefs);
    window.MFC?.db?.getHealthMarkers().then((rows) => {
      const byId = {};
      for (const r of rows || []) byId[r.metric_id] = r;
      setLatest(byId);
    });
  }, [user]);

  function refreshLatest() {
    window.MFC?.db?.getHealthMarkers().then((rows) => {
      const byId = {};
      for (const r of rows || []) byId[r.metric_id] = r;
      setLatest(byId);
    });
  }

  const byCategory = useMemo(() => {
    const out = {};
    for (const d of defs) (out[d.category || 'other'] ||= []).push(d);
    return out;
  }, [defs]);

  const orderedCats = CATEGORY_ORDER.filter((c) => byCategory[c]);

  if (!ready) return <div className="mk-loading">Loading…</div>;
  if (!user)  return null;

  return (
    <>
      <style>{MARKERS_STYLE}</style>

      <nav className="mk-nav">
        <a href="index.html" className="mk-logo">mfc</a>
        <div className="mk-nav-right">
          <a href="dashboard.html" className="mk-back">← Dashboard</a>
        </div>
      </nav>

      <main className="mk-main">

        <header className="mk-header">
          <h1 className="mk-title">Your blood markers</h1>
          <p className="mk-explainer">
            Enter your latest blood test values below. Your offline pipeline maps these numbers to
            recipes that address real nutritional gaps — recommendations refresh once the pipeline
            runs against updated markers.
          </p>
        </header>

        {defs.length === 0 ? (
          <p style={{ color: 'var(--ink-muted)', fontStyle: 'italic', fontSize: 14 }}>Loading…</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {orderedCats.map((cat) => (
              <div key={cat}>
                <div className="mk-category-label">{cat}</div>
                <div className="mk-group">
                  {byCategory[cat].map((d) => (
                    <MarkerRow key={d.id} def={d} latest={latest[d.id]} onSaved={refreshLatest} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mk-footer-note">
          Recommendations refresh once your data pipeline runs — usually within a few hours of
          updating your markers.
        </div>

      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<MarkersApp />);
