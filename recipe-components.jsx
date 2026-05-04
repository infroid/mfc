// Recipe page — UI components
const { useState, useEffect, useRef, useMemo, useCallback } = React;
const _BASE = window.MFC_BASE || '';

function fmtTime(secs) {
  secs = Math.max(0, Math.round(secs));
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(1, "0")}:${String(s).padStart(2, "0")}`;
}
function fmtMin(secs) {
  return `${Math.round(secs / 60)}m`;
}

function ingAmount(ing) {
  const amt = ing.amt ?? ing.amount ?? "";
  const unit = ing.unit ? ` ${ing.unit}` : "";
  return `${amt}${unit}`.trim();
}

function scaleAmt(ing, serv, base) {
  const raw = String(ing.amt ?? ing.amount ?? "");
  const m = raw.match(/^([\d.]+)(.*)$/);
  if (!m) return ingAmount(ing);
  const v = parseFloat(m[1]) * (serv / base);
  const out = Number.isInteger(v) ? v : Math.round(v * 10) / 10;
  const unit = ing.unit ? ` ${ing.unit}` : "";
  return `${out}${m[2]}${unit}`.trim();
}

// ============================================================
// NAV
// ============================================================
function RecipeNav() {
  const scrolled = useScrolled();
  return (
    <nav className={"nav" + (scrolled ? " scrolled" : "")}>
      <div className="nav-inner">
        <a href={_BASE + "index.html"} className="brand">
          <span className="brand-mark">m</span>
          <span className="brand-name">my<em>food</em>craving</span>
        </a>
        <div className="nav-links">
          <a href={_BASE + "index.html"}>Home</a>
          <a href={_BASE + "recipe-search.html"}>Recipes</a>
        </div>
        <a href={_BASE + "recipe-search.html"} className="btn btn-primary">All recipes</a>
      </div>
    </nav>
  );
}

// ============================================================
// HERO — image + meta on left, nutrition card on right
// ============================================================
function RecipeHero({ recipe, saved, onToggleSave, user, onRequestSignIn, justSaved }) {
  const hero = recipe.media?.hero || {};
  const heroSrc = hero.src ? _BASE + hero.src : "";
  const heroFit = hero.fit || {};
  const heroPalette = hero.palette || [];
  const heroStyle = heroSrc ? {} : {
    "--hero-b": heroPalette[1] || "var(--butter)",
    "--hero-c": heroPalette[2] || heroPalette[0] || "var(--orange)"
  };

  const n = recipe.nutrition;
  const rating = recipe.rating ?? 4.8;
  const ratingCount = recipe.ratingCount ?? 128;
  const cuisine = recipe.cuisine || "Recipe";
  const difficulty = recipe.difficulty || "—";
  const totalMin = recipe.totalMinutes || recipe.minutes || 0;
  const stepCount = recipe.steps?.length ?? 0;

  return (
    <section className="r-hero">
      <div className="r-hero-left">
        <header className="r-hero-header">
          <div className="r-hero-eyebrow">
            <span>{cuisine}</span>
            <span className="dot">·</span>
            <span><span className="star">★</span> {rating} <span style={{ opacity: 0.6 }}>({ratingCount})</span></span>
            <span className="dot">·</span>
            <span>{difficulty}</span>
          </div>
          <h1 className="r-hero-title">
            <em>{recipe.name.split(" ")[0]}</em> {recipe.name.split(" ").slice(1).join(" ")}
          </h1>
          {recipe.tagline && <p className="r-hero-tagline">{recipe.tagline}</p>}
          <div className="r-hero-meta">
            <span><b>{totalMin}</b>min total</span>
            <span><b>{recipe.servings}</b>servings</span>
            <span><b>{stepCount}</b>steps</span>
          </div>
        </header>

        <div className={"r-hero-stage" + (heroSrc ? " has-media" : "")} style={heroStyle}>
          {heroSrc ? (
            <img
              src={heroSrc}
              alt={hero.alt || recipe.name}
              style={{
                "--media-scale": heroFit.scale || 1,
                "--media-x": heroFit.x || "0%",
                "--media-y": heroFit.y || "0%",
                objectPosition: heroFit.position || "50% 50%"
              }}
            />
          ) : (
            <div className="r-hero-placeholder">{cuisine}</div>
          )}
          <button
            className={"r-save-icon" + (user && saved ? " saved" : "") + (justSaved ? " just-saved" : "")}
            onClick={user ? onToggleSave : onRequestSignIn}
            title={user ? (saved ? "Remove from saved" : "Save recipe") : "Sign in to save"}
            aria-label={user ? (saved ? "Unsave" : "Save") : "Sign in to save"}
          >
            <span className="heart">{user && saved ? "♥" : "♡"}</span>
          </button>
        </div>
      </div>

      <NutritionCard recipe={recipe} />
    </section>
  );
}

function NutritionCard({ recipe }) {
  const totalMin = recipe.totalMinutes || recipe.minutes || 1;
  const n = recipe.nutrition || { calories: 420, protein: 18, carbs: 50, fat: 14, fiber: 6, sodium: 320 };
  const proteinPct = Math.min(100, Math.round((n.protein * 4 / n.calories) * 100));
  const carbsPct = Math.min(100, Math.round((n.carbs * 4 / n.calories) * 100));
  const fatPct = Math.min(100, Math.round((n.fat * 9 / n.calories) * 100));
  const tags = recipe.nutriTags || [];

  return (
    <aside className="r-nutri">
      <div className="r-nutri-head">
        <h3>nutrition</h3>
        <span className="eyebrow-comment">per serving</span>
      </div>
      <div className="r-nutri-cal">
        <span className="num">{n.calories}</span>
        <span className="unit">kcal</span>
        <span className="per">{Math.round(n.calories / totalMin)} kcal<br/>per minute cooked</span>
      </div>
      <div className="r-nutri-grid">
        <div className="r-macro" style={{ "--ring-c": "var(--matcha)", "--ring-p": proteinPct }}>
          <div className="ring"><b>P</b></div>
          <div className="v">{n.protein}<sup>g</sup></div>
          <div className="l">protein</div>
        </div>
        <div className="r-macro" style={{ "--ring-c": "var(--orange)", "--ring-p": carbsPct }}>
          <div className="ring"><b>C</b></div>
          <div className="v">{n.carbs}<sup>g</sup></div>
          <div className="l">carbs</div>
        </div>
        <div className="r-macro" style={{ "--ring-c": "var(--butter)", "--ring-p": fatPct }}>
          <div className="ring"><b>F</b></div>
          <div className="v">{n.fat}<sup>g</sup></div>
          <div className="l">fat</div>
        </div>
        <div className="r-macro" style={{ "--ring-c": "var(--matcha-deep)", "--ring-p": Math.min(100, n.fiber * 4) }}>
          <div className="ring"><b>·</b></div>
          <div className="v">{n.fiber}<sup>g</sup></div>
          <div className="l">fiber</div>
        </div>
        <div className="r-macro" style={{ "--ring-c": "var(--berry)", "--ring-p": Math.min(100, n.sodium / 23) }}>
          <div className="ring"><b>Na</b></div>
          <div className="v">{n.sodium}<sup>mg</sup></div>
          <div className="l">sodium</div>
        </div>
        <div className="r-macro" style={{ "--ring-c": "var(--orange-deep)", "--ring-p": proteinPct }}>
          <div className="ring"><b>%</b></div>
          <div className="v">{proteinPct}<sup>%</sup></div>
          <div className="l">from protein</div>
        </div>
      </div>
      {tags.length > 0 && (
        <div className="r-nutri-tags">
          {tags.map((t, i) => (
            <span key={i} className={"r-nutri-tag " + (i % 3 === 1 ? "warm" : i % 3 === 2 ? "warm-y" : "")}>{t}</span>
          ))}
        </div>
      )}
      <div className="r-nutri-actions">
        <button className="btn sm">Share</button>
        <button className="btn sm orange">Cook now</button>
      </div>
    </aside>
  );
}

// ============================================================
// STEP CARD — no inline timer; player drives advancement
// ============================================================
function StepCard({ recipe, stepIdx, doneSteps }) {
  const step = recipe.steps[stepIdx];
  const stepMedia = step.media || null;
  const stepSrc = stepMedia?.src ? _BASE + stepMedia.src : "";
  const total = recipe.steps.length;
  const minutes = Math.round(step.duration / 60);
  const cumulativeBefore = recipe.steps.slice(0, stepIdx).reduce((acc, s) => acc + s.duration, 0);
  const cumulativeAfter = cumulativeBefore + step.duration;
  const totalSecs = recipe.steps.reduce((acc, s) => acc + s.duration, 0);
  const caption = stepMedia?.caption || step.title.toLowerCase();

  return (
    <div className="r-step-card">
      <div className="r-step-head">
        <span className="r-step-tag">step <b>{String(stepIdx + 1).padStart(2, "0")}</b> / {String(total).padStart(2, "0")}</span>
        <span className="r-step-divider" />
        <span className="r-step-pacing">
          <span className="dot" />
          {fmtMin(cumulativeBefore)} → {fmtMin(cumulativeAfter)} of {fmtMin(totalSecs)}
        </span>
      </div>

      <h2 className="r-step-title">{step.title}</h2>
      <p className="r-step-detail">{step.detail}</p>

      <figure className="r-step-image">
        {stepSrc ? (
          <img src={stepSrc} alt={stepMedia.alt || step.title} />
        ) : (
          <div className="placeholder">step {stepIdx + 1} reference shot</div>
        )}
        <span className="cap">{caption}</span>
      </figure>

      {step.tip && (
        <div className="r-step-tip">
          <span className="label-h">chef's note —</span>
          <p>{step.tip}</p>
        </div>
      )}

      <div className="r-step-foot">
        <div className="r-step-foot-meta">
          <span>this step <b>~ {minutes} min</b></span>
          <span>·</span>
          <span><b>{doneSteps.size}</b> of {total} steps complete</span>
        </div>
        <span className="eyebrow-comment">use the player below to advance</span>
      </div>
    </div>
  );
}

// ============================================================
// COLLAPSIBLE CARD
// ============================================================
function CollapseCard({ title, count, children, defaultOpen = true, footer }) {
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
          {footer && <div className="r-card-foot">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// INGREDIENTS — emoji thumbnails, essential dot, scalable
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

  return (
    <CollapseCard
      title="ingredients"
      count={recipe.ingredients.length}
      footer={<>
        <button className="btn sm">Add to list</button>
        <button className="btn sm primary">Order all →</button>
      </>}
    >
      <div className="r-servings">
        <span className="lbl">servings</span>
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
            <div className={"r-thumb" + (ing.essential ? " essential" : "")}>{ing.emoji || "•"}</div>
            <span className="name">{ing.name}</span>
            <span className="r-ing-amt">{scaleAmt(ing, serv, recipe.servings)}</span>
          </div>
        ))}
      </div>
    </CollapseCard>
  );
}

// ============================================================
// UTENSILS — emoji thumbnails, must/nice tags
// ============================================================
function UtensilsCard({ recipe }) {
  return (
    <CollapseCard title="utensils" count={recipe.utensils.length} defaultOpen={false}>
      <div className="r-ut-list">
        {recipe.utensils.map((u, i) => (
          <div key={i} className="r-ut-row">
            <div className={"r-thumb" + (u.essential ? " essential" : "")}>{u.emoji || "🛠"}</div>
            <span className="name">{u.name}</span>
            <span className={"r-ut-tag" + (u.essential ? " ess" : "")}>
              {u.essential ? "must" : "nice"}
            </span>
          </div>
        ))}
      </div>
    </CollapseCard>
  );
}

// ============================================================
// HEALTH MARQUEE
// ============================================================
function HealthMarquee({ facts }) {
  const display = useMemo(() => [...facts, ...facts], [facts]);
  if (!facts || facts.length === 0) return null;
  return (
    <div className="r-marquee">
      <div className="r-marquee-tag"><span className="pulse" /> health note</div>
      <div className="r-marquee-track">
        <div className="r-marquee-strip">
          {display.map((f, i) => <div key={i} className="item">{f}</div>)}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PREMIUM PLAYER — segment-per-step timeline w/ live timing
// ============================================================
function CookingPlayer({ recipe, stepIdx, setStepIdx, doneSteps, setDoneSteps }) {
  const total = recipe.steps.length;
  const step = recipe.steps[stepIdx];

  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => { setElapsed(0); }, [stepIdx]);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setElapsed(e => {
        if (e + 1 >= step.duration) {
          clearInterval(id);
          setDoneSteps(prev => new Set([...prev, stepIdx]));
          if (stepIdx < total - 1) {
            setTimeout(() => setStepIdx(stepIdx + 1), 400);
          } else {
            setRunning(false);
          }
          return step.duration;
        }
        return e + 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running, step.duration, stepIdx, total]);

  function jump(delta) {
    const next = stepIdx + delta;
    if (next < 0 || next >= total) return;
    if (delta > 0) setDoneSteps(prev => new Set([...prev, stepIdx]));
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

  const segProgress = (elapsed / step.duration) * 100;

  return (
    <div className={"r-player" + (running ? " playing" : "")}>
      <div className="r-player-inner">
        <div className="r-pl-controls">
          <button className="r-pl-step" onClick={() => jump(-1)} disabled={stepIdx === 0} aria-label="Previous step">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M3 1v12M13 1L4 7l9 6V1z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>
          </button>
          <button className="r-pl-play" onClick={() => setRunning(r => !r)} aria-label={running ? "Pause" : "Start"}>
            {running ? (
              <svg width="12" height="13" viewBox="0 0 12 13"><rect x="1" y="0.5" width="3.4" height="12" rx="1" fill="currentColor"/><rect x="7.6" y="0.5" width="3.4" height="12" rx="1" fill="currentColor"/></svg>
            ) : (
              <svg width="12" height="13" viewBox="0 0 12 13"><path d="M2 1.2L11 6.5L2 11.8V1.2Z" fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>
            )}
          </button>
          <button className="r-pl-step" onClick={() => jump(1)} disabled={stepIdx === total - 1} aria-label="Next step">
            <svg width="14" height="14" viewBox="0 0 14 14"><path d="M11 1v12M1 1l9 6-9 6V1z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/></svg>
          </button>
        </div>

        <div className="r-pl-now">
          <div className="r-pl-now-row">
            <span className="r-pl-counter">{String(stepIdx + 1).padStart(2, "0")}<span className="dim">/{String(total).padStart(2, "0")}</span></span>
            <span className="r-pl-name" title={step.title}>{step.title}</span>
          </div>
          <div className="r-pl-bar" onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
            setElapsed(Math.round(pct * step.duration));
          }}>
            <div className="r-pl-bar-fill" style={{ width: `${segProgress}%` }} />
            <div className="r-pl-bar-knob" style={{ left: `${segProgress}%` }} />
          </div>
          <div className="r-pl-meta-row">
            <span className="r-pl-time">{fmtTime(elapsed)}</span>
            <span className="r-pl-status">{running ? "● cooking" : doneSteps.has(stepIdx) ? "✓ done" : "ready"}</span>
            <span className="r-pl-time end">{fmtTime(step.duration)}</span>
          </div>
        </div>

        <div className="r-pl-dots" role="tablist" aria-label="Steps">
          {recipe.steps.map((s, i) => {
            const isDone = doneSteps.has(i);
            const isNow = i === stepIdx;
            return (
              <button
                key={i}
                className={"r-pl-dot" + (isDone ? " done" : isNow ? " now" : "")}
                onClick={() => jumpTo(i)}
                aria-label={`Step ${i + 1}: ${s.title}`}
                title={`${i + 1}. ${s.title} · ${fmtMin(s.duration)}`}
              />
            );
          })}
        </div>
      </div>
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
