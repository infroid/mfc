/* global React */
const Dm = window.MFC_DATA;
const { useUser: useUserM, navigate: navM } = window.MFC_CHROME;
const { useState: useStateM, useMemo: useMemoM } = React;

// ============================================================
// Markers Page
// ============================================================
function MarkersPage() {
  const user = useUserM();
  const [tab, setTab] = useStateM("all");

  if (!user) {
    return (
      <div style={{ padding: "120px 28px", textAlign: "center" }}>
        <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 24, color: "var(--ink-soft)" }}>
          Sign in to track your markers.
        </p>
      </div>
    );
  }

  const cats = ["all", "vitamin", "mineral", "lipid", "metabolic", "blood", "thyroid"];
  const items = useMemoM(() => {
    const list = Dm.METRIC_DEFS
      .filter(m => tab === "all" || m.category === tab)
      .map(m => ({ m, r: Dm.MARKERS[m.id] }));
    return list;
  }, [tab]);

  const flagged = items.filter(({ m, r }) => r && Dm.markerStatus(m, r) !== "ok");
  const ok = items.filter(({ m, r }) => r && Dm.markerStatus(m, r) === "ok");
  const missing = items.filter(({ r }) => !r);

  // Pull recipe recommendations relevant to flagged markers (simple keyword match)
  function recsForMarker(metricId) {
    const map = {
      iron: ["quinoa-bowl", "gochujang-salmon"],
      ferritin: ["quinoa-bowl", "gochujang-salmon"],
      "vit-d": ["gochujang-salmon"],
      magnesium: ["miso-mushroom"],
    };
    return (map[metricId] || []).map(id => Dm.recipeById(id)).filter(Boolean);
  }

  return (
    <>
      <section style={{ padding: "56px 0 32px" }}>
        <div className="wrap">
          <div className="eyebrow-comment" style={{ marginBottom: 10 }}>your bloodwork</div>
          <h1 style={{ fontFamily: "var(--sans)", fontWeight: 500, fontSize: "clamp(42px,5.4vw,68px)", lineHeight: 0.98, letterSpacing: "-0.035em" }}>
            What's your body <em style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, color: "var(--orange)" }}>asking for?</em>
          </h1>
          <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 22, color: "var(--ink-soft)", marginTop: 14, maxWidth: 640 }}>
            Track {Dm.METRIC_DEFS.length} markers. We'll suggest recipes that move them in the right direction.
          </p>

          <div className="markers-summary">
            <SummaryStat label="In range" value={ok.length} tone="ok" />
            <SummaryStat label="Need attention" value={flagged.length} tone="alert" />
            <SummaryStat label="Not tested" value={missing.length} tone="muted" />
          </div>
        </div>
      </section>

      <div className="wrap">
        <div className="markers-tabs">
          {cats.map(c => (
            <button
              key={c}
              className={"filter-chip" + (tab === c ? " active" : "")}
              onClick={() => setTab(c)}
            >{c}</button>
          ))}
          <span style={{ flex: 1 }} />
          <button className="btn sm">+ Upload report</button>
        </div>

        {flagged.length > 0 && (
          <section style={{ marginTop: 36 }}>
            <div className="section-head">
              <div>
                <div className="section-label" style={{ color: "var(--alert)" }}>needs attention</div>
                <h2><em>{flagged.length}</em> off-range</h2>
              </div>
            </div>
            <div className="markers-grid">
              {flagged.map(({ m, r }) => (
                <MarkerCard key={m.id} metric={m} reading={r} recipes={recsForMarker(m.id)} />
              ))}
            </div>
          </section>
        )}

        <section style={{ marginTop: 56 }}>
          <div className="section-head">
            <div>
              <div className="section-label">in range</div>
              <h2><em>{ok.length}</em> looking good</h2>
            </div>
          </div>
          <div className="markers-grid">
            {ok.map(({ m, r }) => <MarkerCard key={m.id} metric={m} reading={r} />)}
          </div>
        </section>

        {missing.length > 0 && (
          <section style={{ marginTop: 56, marginBottom: 40 }}>
            <div className="section-head">
              <div>
                <div className="section-label" style={{ color: "var(--ink-muted)" }}>not yet tested</div>
                <h2><em>{missing.length}</em> markers · add a reading</h2>
              </div>
            </div>
            <div className="markers-grid">
              {missing.map(({ m }) => <MarkerCard key={m.id} metric={m} reading={null} />)}
            </div>
          </section>
        )}
      </div>
    </>
  );
}

function SummaryStat({ label, value, tone }) {
  return (
    <div className={"summary-stat tone-" + tone}>
      <div className="summary-stat-value">{value}</div>
      <div className="summary-stat-label">{label}</div>
    </div>
  );
}

function MarkerCard({ metric, reading, recipes }) {
  const status = Dm.markerStatus(metric, reading);
  const lo = metric.normal_min, hi = metric.normal_max;

  return (
    <div className={"marker-card card lift status-" + status}>
      <div className="mc-head">
        <div>
          <div className="mc-cat">{metric.category}</div>
          <h3 className="mc-name">{metric.name}</h3>
        </div>
        <span className={"mc-status " + status}>{status === "ok" ? "in range" : status}</span>
      </div>

      {reading ? (
        <>
          <div className="mc-value">
            <span className="mc-num">{reading.value}</span>
            <span className="mc-unit">{metric.unit}</span>
            {reading.trend && <span className={"mc-trend " + reading.trend}>{trendArrow(reading.trend)}</span>}
          </div>
          <RangeBar metric={metric} value={reading.value} status={status} />
          <div className="mc-meta">
            <span>Normal: {lo != null ? lo : "—"}{lo != null && hi != null ? "–" : ""}{hi != null ? hi : ""} {metric.unit}</span>
            <span>·</span>
            <span>Tested {Dm.fmtDate(reading.measured_at, { month: "short", day: "numeric", year: "numeric" })}</span>
          </div>
          {recipes && recipes.length > 0 && (
            <div className="mc-recs">
              <div className="eyebrow-comment" style={{ marginBottom: 8 }}>cook this →</div>
              <div className="mc-rec-list">
                {recipes.slice(0, 2).map(r => (
                  <a key={r.id} href={"#/recipe/" + r.id} onClick={(e) => e.preventDefault()} className="mc-rec">
                    <span className="mc-rec-thumb" style={{ background: r.colorSoft }}>
                      <img src={r.image} alt="" />
                    </span>
                    <span className="mc-rec-name">{r.name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="mc-empty">
          <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-muted)", fontSize: 16 }}>
            Not tested yet
          </p>
          <button className="btn ghost sm" style={{ marginTop: 10 }}>+ Add reading</button>
        </div>
      )}
    </div>
  );
}

function trendArrow(t) {
  if (t === "up") return "↗";
  if (t === "down") return "↘";
  return "→";
}

function RangeBar({ metric, value, status }) {
  const lo = metric.normal_min, hi = metric.normal_max;
  // Build a viz scale; pad 30% on each side
  const min = lo != null ? lo * 0.6 : 0;
  const max = hi != null ? hi * 1.3 : (lo ? lo * 2.5 : value * 1.4);
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const loPct = lo != null ? Math.max(0, Math.min(100, ((lo - min) / (max - min)) * 100)) : 0;
  const hiPct = hi != null ? Math.max(0, Math.min(100, ((hi - min) / (max - min)) * 100)) : 100;
  return (
    <div className="range-bar">
      <div className="range-track" />
      <div className="range-ok" style={{ left: loPct + "%", width: (hiPct - loPct) + "%" }} />
      <div className={"range-marker status-" + status} style={{ left: pct + "%" }}>
        <span className="range-tick" />
      </div>
    </div>
  );
}

window.MFC_PAGES.MarkersPage = MarkersPage;
