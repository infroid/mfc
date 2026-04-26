// Recipe page — UI components
const { useState, useEffect, useRef, useMemo, useCallback } = React;

function fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ============================================================
// NAV
// ============================================================
function RecipeNav() {
  const scrolled = useScrolled();
  return (
    <nav className={"nav" + (scrolled ? " scrolled" : "")}>
      <div className="nav-inner">
        <a href="index.html" className="brand">
          <span className="brand-mark">m</span>
          <span className="brand-name">my<em>food</em>craving</span>
        </a>
        <div className="nav-links">
          <a href="index.html">Home</a>
          <a href="#">My plan</a>
          <a href="#">Recipes</a>
          <a href="#">Pantry</a>
        </div>
        <a href="#" className="btn btn-primary">Save recipe</a>
      </div>
    </nav>
  );
}

// ============================================================
// HERO
// ============================================================
function RecipeHero({ recipe, progress }) {
  return (
    <section className="r-hero">
      <div className="r-hero-copy">
        <div className="r-breadcrumb">
          <a href="index.html">Home</a>
          <span>›</span>
          <a href="#">{recipe.cuisine}</a>
          <span>›</span>
          <span style={{ color: "var(--ink)" }}>{recipe.name}</span>
        </div>
        <h1 className="r-title">
          <em>{recipe.name.split(" ")[0]}</em> {recipe.name.split(" ").slice(1).join(" ")}
        </h1>
        <div className="r-tagline">{recipe.tagline}</div>

        <div className="r-meta">
          <div className="r-meta-pill"><span className="dot" /><b>{recipe.totalMinutes}</b>&nbsp;min total</div>
          <div className="r-meta-pill"><b>{recipe.servings}</b>&nbsp;servings</div>
          <div className="r-meta-pill"><b>{recipe.difficulty}</b></div>
          <div className="r-meta-pill"><b>{recipe.steps.length}</b>&nbsp;steps</div>
        </div>

        <div className="r-progress-card">
          <div>
            <div className="r-progress-label">Cooking progress</div>
            <div className="r-progress-bar">
              <div className="r-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="r-progress-pct">{progress}<span className="pct-sym">%</span></div>
        </div>
      </div>

      <div className="r-hero-plate">
        <div className="r-hero-sticker">{recipe.cuisine}</div>
        <div className="r-hero-sticker right">★ 4.8</div>
        <div className="r-hero-plate-tag">{recipe.hero.caption}</div>
      </div>
    </section>
  );
}

// ============================================================
// STEP CARD with timer + nav
// ============================================================
function StepCard({ recipe, stepIdx, setStepIdx, doneSteps, setDoneSteps }) {
  const step = recipe.steps[stepIdx];
  const total = recipe.steps.length;

  const [remaining, setRemaining] = useState(step.duration);
  const [running, setRunning] = useState(false);
  const [buzzing, setBuzzing] = useState(false);

  useEffect(() => {
    setRemaining(step.duration);
    setRunning(false);
    setBuzzing(false);
  }, [stepIdx]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          clearInterval(id);
          setRunning(false);
          setBuzzing(true);
          setTimeout(() => setBuzzing(false), 6000);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const progressPct = ((step.duration - remaining) / step.duration) * 100;

  function go(delta) {
    const next = stepIdx + delta;
    if (next < 0 || next >= total) return;
    if (delta > 0) setDoneSteps(s => new Set([...s, stepIdx]));
    setStepIdx(next);
  }

  function jumpTo(i) {
    if (i === stepIdx) return;
    if (i > stepIdx) {
      const ds = new Set(doneSteps);
      for (let k = stepIdx; k < i; k++) ds.add(k);
      setDoneSteps(ds);
    }
    setStepIdx(i);
  }

  return (
    <div className="r-step-card">
      <div className="r-step-pips">
        {recipe.steps.map((_, i) => (
          <div
            key={i}
            className={"r-pip " + (doneSteps.has(i) ? "done" : i === stepIdx ? "now" : "")}
            style={i === stepIdx ? { "--p": `${progressPct}%` } : {}}
            onClick={() => jumpTo(i)}
          />
        ))}
      </div>

      <div className="r-step-head">
        <div className="r-step-num">Step <b>{stepIdx + 1}</b> &nbsp;/ {total}</div>
        <div className="r-step-num" style={{ color: "var(--ink-muted)" }}>
          ~ {Math.round(step.duration / 60)} min
        </div>
      </div>
      <h2 className="r-step-title">{step.title}</h2>
      <p className="r-step-detail">{step.detail}</p>

      {step.hasImage && (
        <div className="r-step-image" data-cap={`[ step ${stepIdx + 1} reference shot ]`}></div>
      )}

      {step.tip && (
        <div className="r-step-tip">
          <b>chef's note —</b>
          {step.tip}
        </div>
      )}

      <div className="r-timer-row">
        <div className={"r-timer" + (buzzing ? " buzzing" : "")}>
          <div className="r-timer-clock">{fmtTime(remaining)}</div>
          <div className="r-timer-meta">
            <span className="label">{buzzing ? "Time's up!" : running ? "Cooking" : "Ready"}</span>
            <span className="name">{step.title}</span>
          </div>
          <div className="r-timer-buttons">
            <button className="r-timer-btn" onClick={() => setRemaining(step.duration)} title="Reset">↺</button>
            <button className="r-timer-btn" onClick={() => setRunning(r => !r)} title={running ? "Pause" : "Start"}>
              {running ? "❚❚" : "▶"}
            </button>
          </div>
        </div>
        <div className="r-step-nav">
          <button className="r-nav-btn" disabled={stepIdx === 0} onClick={() => go(-1)}>← Prev</button>
          <button className="r-nav-btn primary" onClick={() => go(1)} disabled={stepIdx === total - 1}>
            {stepIdx === total - 1 ? "Finished ✓" : "Next →"}
          </button>
        </div>
      </div>

      <div className="r-step-map">
        {recipe.steps.map((s, i) => (
          <div
            key={i}
            className={"r-step-chip " + (doneSteps.has(i) ? "done" : i === stepIdx ? "now" : "")}
            onClick={() => jumpTo(i)}
          >
            <span className="n">{String(i + 1).padStart(2, "0")}</span>
            {s.title}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// COLLAPSIBLE CARD
// ============================================================
function CollapseCard({ title, count, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={"r-card" + (open ? " open" : "")}>
      <div className="r-card-head" onClick={() => setOpen(o => !o)}>
        <h4>
          {title}
          {count !== undefined && <span className="count">· {count}</span>}
        </h4>
        <div className="r-chev">▾</div>
      </div>
      <div className="r-card-body">
        <div>
          <div className="r-card-inner">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// INGREDIENTS
// ============================================================
function IngredientsCard({ recipe }) {
  const [checked, setChecked] = useState(new Set());
  const [serv, setServ] = useState(recipe.servings);

  function toggle(name) {
    setChecked(prev => {
      const n = new Set(prev);
      if (n.has(name)) n.delete(name); else n.add(name);
      return n;
    });
  }

  function scaleAmt(amt) {
    const m = amt.match(/^([\d.]+)(.*)$/);
    if (!m) return amt;
    const v = parseFloat(m[1]) * (serv / recipe.servings);
    const out = Number.isInteger(v) ? v : Math.round(v * 10) / 10;
    return out + m[2];
  }

  return (
    <CollapseCard title="Ingredients" count={recipe.ingredients.length}>
      <div className="r-servings">
        <span className="lbl">Servings</span>
        <div className="r-serv-stepper">
          <button className="r-serv-btn" onClick={() => setServ(s => Math.max(1, s - 1))}>−</button>
          <span className="r-serv-val">{serv}</span>
          <button className="r-serv-btn" onClick={() => setServ(s => Math.min(12, s + 1))}>+</button>
        </div>
      </div>
      <div className="r-ing-list">
        {recipe.ingredients.map((ing, i) => (
          <div
            key={i}
            className={"r-ing-row" + (checked.has(ing.name) ? " checked" : "")}
            onClick={() => toggle(ing.name)}
          >
            <div className="r-ing-check">✓</div>
            <span className="name">{ing.name}</span>
            <span className="r-ing-amt">{scaleAmt(ing.amt)}</span>
          </div>
        ))}
      </div>
    </CollapseCard>
  );
}

// ============================================================
// UTENSILS
// ============================================================
function UtensilsCard({ recipe }) {
  return (
    <CollapseCard title="Utensils" count={recipe.utensils.length} defaultOpen={false}>
      <div className="r-ut-list">
        {recipe.utensils.map((u, i) => (
          <div key={i} className="r-ut-row">
            <div className="r-ut-icon">{String(i + 1).padStart(2, "0")}</div>
            <span>{u.name}</span>
            <span className={"r-ut-tag" + (u.essential ? " ess" : "")}>
              {u.essential ? "Must" : "Nice"}
            </span>
          </div>
        ))}
      </div>
    </CollapseCard>
  );
}

// ============================================================
// HEALTH MARQUEE — surfaces every N minutes
// ============================================================
function HealthMarquee({ facts, intervalMs = 180000 }) {
  const [visible, setVisible] = useState(false);
  const [factIdx, setFactIdx] = useState(0);

  useEffect(() => {
    const first = setTimeout(() => setVisible(true), 8000);
    const id = setInterval(() => {
      setFactIdx(i => (i + 1) % facts.length);
      setVisible(true);
    }, intervalMs);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [intervalMs, facts.length]);

  const display = [
    facts[factIdx % facts.length],
    facts[(factIdx + 1) % facts.length],
    facts[(factIdx + 2) % facts.length]
  ];

  return (
    <div className={"r-marquee" + (!visible ? " hidden" : "")}>
      <div className="r-marquee-tag"><span className="pulse" /> health fact</div>
      <div className="r-marquee-track">
        <div className="r-marquee-strip">
          {[...display, ...display].map((f, i) => (
            <div key={i} className="item">{f}</div>
          ))}
        </div>
      </div>
      <button className="r-marquee-close" onClick={() => setVisible(false)} title="Dismiss">✕</button>
    </div>
  );
}

// ============================================================
// VOICE PLAYER — small paper-themed pill, synced to current step
// ============================================================
function CookingPlayer({ recipe, stepIdx, setStepIdx }) {
  const total = recipe.steps.length;
  const step = recipe.steps[stepIdx];

  // Estimate voiceover duration from word count (~165 wpm)
  const voSecs = useMemo(() => {
    const words = (step.title + " " + step.detail).split(/\s+/).length;
    return Math.max(8, Math.round((words / 165) * 60));
  }, [stepIdx]);

  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => { setElapsed(0); }, [stepIdx]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setElapsed(e => {
        const ne = e + 0.25;
        if (ne >= voSecs) {
          clearInterval(id);
          if (stepIdx < total - 1) {
            setTimeout(() => setStepIdx(stepIdx + 1), 400);
          } else {
            setPlaying(false);
          }
          return voSecs;
        }
        return ne;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playing, voSecs, stepIdx, total]);

  const pct = (elapsed / voSecs) * 100;
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(1, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function jump(delta) {
    const next = stepIdx + delta;
    if (next < 0 || next >= total) return;
    setStepIdx(next);
  }

  return (
    <div className={"r-player" + (playing ? " playing" : "")}>
      <button
        className="r-pl-step"
        onClick={() => jump(-1)}
        disabled={stepIdx === 0}
        aria-label="Previous step"
      >‹</button>

      <button
        className="r-pl-play"
        onClick={() => setPlaying(p => !p)}
        aria-label={playing ? "Pause voiceover" : "Play voiceover"}
      >
        {playing ? (
          <svg width="11" height="12" viewBox="0 0 11 12" fill="none">
            <rect x="0" y="0" width="3.5" height="12" rx="1" fill="currentColor"/>
            <rect x="7.5" y="0" width="3.5" height="12" rx="1" fill="currentColor"/>
          </svg>
        ) : (
          <svg width="11" height="12" viewBox="0 0 11 12" fill="none">
            <path d="M1 1L10 6L1 11V1Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      <button
        className="r-pl-step"
        onClick={() => jump(1)}
        disabled={stepIdx === total - 1}
        aria-label="Next step"
      >›</button>

      <div className="r-pl-body">
        <div className="r-pl-title">
          <span className="r-pl-num">{String(stepIdx + 1).padStart(2, "0")}</span>
          <span className="r-pl-name">{step.title}</span>
        </div>
        <div className="r-pl-bar">
          <div className="r-pl-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="r-pl-time">{fmt(elapsed)}<span>/{fmt(voSecs)}</span></div>
    </div>
  );
}

window.RecipeNav = RecipeNav;
window.RecipeHero = RecipeHero;
window.StepCard = StepCard;
window.IngredientsCard = IngredientsCard;
window.UtensilsCard = UtensilsCard;
window.HealthMarquee = HealthMarquee;
window.CookingPlayer = CookingPlayer;
