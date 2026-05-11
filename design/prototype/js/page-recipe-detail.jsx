/* RECIPE DETAIL PAGE — full recipe experience inside the unified prototype.
   Mirrors the production recipe page: hero + nutrition glance, step card,
   ingredient/utensil sidebar, health marquee, fixed cooking player.
   Adds an expanded FDA-shaped nutrition section split into Macro / Micro
   with sub-tabs, dense grid cells, %DV bars, and high/warn flags. */

// ─── helpers ───────────────────────────────────────────────────────
function fmtTime(secs) {
  secs = Math.max(0, Math.round(secs));
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(1, "0")}:${String(s).padStart(2, "0")}`;
}
function fmtMin(secs) { return `${Math.round(secs / 60)}m`; }
function ingAmount(ing) {
  const amt = ing.amt ?? "";
  const unit = ing.unit ? ` ${ing.unit}` : "";
  return `${amt}${unit}`.trim();
}
function scaleAmt(ing, serv, base) {
  const raw = String(ing.amt ?? "");
  const m = raw.match(/^([\d.]+)(.*)$/);
  if (!m) return ingAmount(ing);
  const v = parseFloat(m[1]) * (serv / base);
  const out = Number.isInteger(v) ? v : Math.round(v * 10) / 10;
  const unit = ing.unit ? ` ${ing.unit}` : "";
  return `${out}${m[2]}${unit}`.trim();
}

// ─── HERO ──────────────────────────────────────────────────────────
function RecipeHero({ recipe, nutrition, saved, onToggleSave, onJumpToNutrition }) {
  const totalMin = recipe.totalMinutes;
  const stepCount = recipe.steps.length;
  const titleParts = recipe.name.split(" ");
  const proteinPct = Math.min(100, Math.round((nutrition.proteinG * 4 / nutrition.calories) * 100));
  const carbsPct = Math.min(100, Math.round((nutrition.carbsG * 4 / nutrition.calories) * 100));
  const fatPct = Math.min(100, Math.round((nutrition.fatG * 9 / nutrition.calories) * 100));

  return (
    <section className="r-hero">
      <div className="r-hero-left">
        <div className="r-hero-eyebrow">
          <span>{recipe.cuisine}</span>
          <span className="dot">·</span>
          <span><span className="star">★</span> {recipe.rating} <span style={{ opacity: 0.6 }}>({recipe.ratingCount})</span></span>
          <span className="dot">·</span>
          <span>{recipe.difficulty}</span>
          <span className="dot">·</span>
          <span>{recipe.tags.join(" / ")}</span>
        </div>

        <h1 className="r-hero-title">
          <em>{titleParts[0]}</em> {titleParts.slice(1).join(" ")}
        </h1>
        {recipe.tagline && <p className="r-hero-tagline">{recipe.tagline}</p>}

        <div className="r-hero-meta">
          <span><b>{totalMin}</b>min total</span>
          <span><b>{recipe.servings}</b>servings</span>
          <span><b>{stepCount}</b>steps</span>
          <span><b>{nutrition.calories}</b>kcal / serv</span>
        </div>

        <div className="r-hero-byline">
          <span className="av">{recipe.chef.charAt(0)}</span>
          by <span style={{ color: "var(--ink)", fontWeight: 600 }}>{recipe.chef}</span>
          <span className="dot">·</span>
          <span>{recipe.tags.includes("vegetarian") ? "vegetarian" : "non-veg"}</span>
        </div>

        <div className="r-hero-stage">
          <img src={recipe.heroImage} alt={recipe.name} />
          <span className="r-hero-stage-tag">{recipe.cuisine.toLowerCase()} · weeknight</span>
          <button
            className={"r-save-icon" + (saved ? " saved" : "")}
            onClick={onToggleSave}
            aria-label={saved ? "Unsave" : "Save"}
            title={saved ? "Remove from saved" : "Save recipe"}
          >
            <span className="heart">{saved ? "♥" : "♡"}</span>
          </button>
        </div>
      </div>

      <aside className="r-nutri-glance">
        <div className="head">
          <h3>nutrition</h3>
          <span className="card-eyebrow">per serving</span>
        </div>

        <div className="r-nutri-cal">
          <span className="num">{nutrition.calories}</span>
          <span className="unit">kcal</span>
          <span className="per">{Math.round(nutrition.calories / totalMin)} kcal<br/>per minute cooked</span>
        </div>

        <div className="r-macro-rings">
          <div className="r-macro" style={{ "--ring-c": "var(--matcha)", "--ring-p": proteinPct }}>
            <div className="ring"><b>P</b></div>
            <div className="v">{nutrition.proteinG}<sup>g</sup></div>
            <div className="l">protein</div>
          </div>
          <div className="r-macro" style={{ "--ring-c": "var(--orange)", "--ring-p": carbsPct }}>
            <div className="ring"><b>C</b></div>
            <div className="v">{nutrition.carbsG}<sup>g</sup></div>
            <div className="l">carbs</div>
          </div>
          <div className="r-macro" style={{ "--ring-c": "var(--butter)", "--ring-p": fatPct }}>
            <div className="ring"><b>F</b></div>
            <div className="v">{nutrition.fatG}<sup>g</sup></div>
            <div className="l">fat</div>
          </div>
        </div>

        <div className="r-nutri-tags">
          {recipe.nutriTags.map((t, i) => (
            <span key={i} className={"r-nutri-tag " + (i % 3 === 1 ? "warm" : i % 3 === 2 ? "warm-y" : "")}>
              {t}
            </span>
          ))}
        </div>

        <div className="actions">
          <button className="btn btn-paper btn-sm" onClick={onJumpToNutrition}>
            Full nutrition →
          </button>
          <button className="btn btn-orange btn-sm">Cook now</button>
        </div>
      </aside>
    </section>
  );
}

// ─── STEP CARD ─────────────────────────────────────────────────────
function StepCard({ recipe, stepIdx, doneSteps }) {
  const step = recipe.steps[stepIdx];
  const total = recipe.steps.length;
  const minutes = Math.round(step.duration / 60);
  const cumulativeBefore = recipe.steps.slice(0, stepIdx).reduce((acc, s) => acc + s.duration, 0);
  const cumulativeAfter = cumulativeBefore + step.duration;
  const totalSecs = recipe.steps.reduce((acc, s) => acc + s.duration, 0);

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
        <div className="placeholder">step {stepIdx + 1} reference shot</div>
        <span className="cap">{step.title.toLowerCase()}</span>
      </figure>

      {step.tip && (
        <div className="r-step-tip">
          <span className="label-h">chef's note —</span>
          <p>{step.tip}</p>
        </div>
      )}

      <div className="r-step-foot">
        <div className="meta">
          <span>this step <b>~ {minutes} min</b></span>
          <span>·</span>
          <span><b>{doneSteps.size}</b> of {total} steps complete</span>
        </div>
        <span className="card-eyebrow" style={{ fontSize: 10 }}>use the player below to advance</span>
      </div>
    </div>
  );
}

// ─── COLLAPSIBLE CARD ──────────────────────────────────────────────
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

// ─── INGREDIENTS ───────────────────────────────────────────────────
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
        <button className="btn btn-paper btn-sm">Add to list</button>
        <button className="btn btn-orange btn-sm">Order all →</button>
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

// ─── UTENSILS ──────────────────────────────────────────────────────
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

// ─── HEALTH MARQUEE ────────────────────────────────────────────────
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

// ─── FULL NUTRITION (Macro / Micro / sub-tabs) ─────────────────────
function NutrientCell({ row }) {
  const [name, val, unit, dv, flag] = row;
  // dv is %DV — we'll cap the bar fill at 100 visually but show real %
  const fillPct = dv != null ? Math.min(100, Math.max(0, dv)) : 0;
  const flagClass = flag === "high" ? " flag-high" : flag === "warn" ? " flag-warn" : "";
  const barClass = flag === "warn" ? "warn" : (dv != null && dv > 100) ? "over" : "";
  return (
    <div className={"r-nutri-cell" + flagClass}>
      <div className="name-row">
        <span className="name">{name}</span>
        <span className="unit">{unit}</span>
      </div>
      <span className="val">{val}</span>
      {dv != null ? (
        <>
          <div className="dv-bar"><span className={barClass} style={{ width: fillPct + "%" }} /></div>
          <div className="dv">
            <span>%DV</span>
            <span className="pct">{dv}%</span>
          </div>
        </>
      ) : (
        <div className="dv">
          <span style={{ opacity: 0.6 }}>—</span>
          <span style={{ opacity: 0.6 }}>no DV</span>
        </div>
      )}
    </div>
  );
}

function NutritionSection({ nutrition }) {
  const [mode, setMode] = useState("macro");   // "macro" | "micro"
  const [tab, setTab] = useState("all");       // "all" | <group name>

  const groups = nutrition[mode];
  const macroCount = nutrition.macro.reduce((n, g) => n + g.rows.length, 0);
  const microCount = nutrition.micro.reduce((n, g) => n + g.rows.length, 0);

  // reset sub-tab when mode changes
  useEffect(() => { setTab("all"); }, [mode]);

  const visibleGroups = tab === "all" ? groups : groups.filter(g => g.name === tab);

  return (
    <section id="full-nutrition" className="r-nutri-full">
      <div className="r-nutri-full-head">
        <div>
          <div className="card-eyebrow" style={{ marginBottom: 6 }}>
            full nutrient profile · per serving
          </div>
          <h2>The whole <em>FDA panel</em></h2>
          <p style={{ color: "var(--ink-soft)", fontSize: 14, marginTop: 6, maxWidth: "62ch" }}>
            Computed from each ingredient's USDA FoodData Central record, summed and
            divided across {nutrition.servings} servings. Macros tell you the shape of
            the meal; micros tell you what nutrients you're picking up along the way.
          </p>
        </div>
        <div className="r-nutri-full-source">
          <strong>{nutrition.basis}</strong>
          {nutrition.source}
        </div>
      </div>

      {/* Mode toggle */}
      <div className="r-nutri-mode" role="tablist">
        <button
          className={mode === "macro" ? "active" : ""}
          onClick={() => setMode("macro")}
        >Macros <span className="count">· {macroCount}</span></button>
        <button
          className={mode === "micro" ? "active" : ""}
          onClick={() => setMode("micro")}
        >Micros <span className="count">· {microCount}</span></button>
      </div>

      {/* Group sub-tabs */}
      <div className="r-nutri-tabs">
        <button
          className={"r-nutri-tab" + (tab === "all" ? " active" : "")}
          onClick={() => setTab("all")}
        >
          All <span className="badge">{groups.reduce((n, g) => n + g.rows.length, 0)}</span>
        </button>
        {groups.map(g => (
          <button
            key={g.name}
            className={"r-nutri-tab" + (tab === g.name ? " active" : "")}
            onClick={() => setTab(g.name)}
          >
            {g.name} <span className="badge">{g.rows.length}</span>
          </button>
        ))}
      </div>

      {/* Groups */}
      {visibleGroups.map(g => (
        <div key={g.name} className="r-nutri-group">
          <div className="r-nutri-group-title">
            {g.name}
            <span className="grp-count">{g.rows.length} fields</span>
          </div>
          <div className="r-nutri-grid">
            {g.rows.map((row, i) => <NutrientCell key={i} row={row} />)}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="r-nutri-legend">
        <div className="item"><span className="sw high" /> high · ≥ 20% DV or notable boost</div>
        <div className="item"><span className="sw warn" /> watch · over recommended limit</div>
        <div className="item"><span className="sw regular" /> regular contribution</div>
        <span style={{ marginLeft: "auto" }}>%DV based on a 2,000 kcal reference diet</span>
      </div>

      <p className="r-nutri-disclaim">
        <em>Note —</em> values are estimates based on average ingredient profiles and
        do not account for cooking losses, brand variation, or individual portion
        weighing. Talk to a registered dietitian for medical nutrition advice.
      </p>
    </section>
  );
}

// ─── COOKING PLAYER (no TTS in prototype) ─────────────────────────
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
        const next = e + 1;
        if (next >= step.duration) {
          setDoneSteps(prev => new Set([...prev, stepIdx]));
          if (stepIdx < total - 1) {
            setTimeout(() => setStepIdx(stepIdx + 1), 400);
          } else {
            setRunning(false);
          }
        }
        return next;
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

  const segProgress = (Math.min(elapsed, step.duration) / Math.max(step.duration, 1)) * 100;

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
          <div
            className="r-pl-bar"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
              setElapsed(Math.round(pct * step.duration));
            }}
          >
            <div className="r-pl-bar-fill" style={{ width: `${segProgress}%` }} />
            <div className="r-pl-bar-knob" style={{ left: `${segProgress}%` }} />
          </div>
          <div className="r-pl-meta-row">
            <span className="r-pl-time">{fmtTime(elapsed)}</span>
            <span className="r-pl-status">
              {running ? "● cooking" : doneSteps.has(stepIdx) ? "✓ done" : "ready"}
            </span>
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

// ─── PAGE ──────────────────────────────────────────────────────────
function RecipeDetailPage() {
  const recipe = window.RECIPE_DETAIL;
  const nutrition = window.RECIPE_NUTRITION;
  const [stepIdx, setStepIdx] = useState(0);
  const [doneSteps, setDoneSteps] = useState(new Set());
  const [saved, setSaved] = useState(false);

  function jumpToNutrition() {
    document.getElementById("full-nutrition")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <AppNav active="recipes" />
      <main className="recipe-page">
        <div className="wrap">
          <div className="r-breadcrumb">
            <a href="#index">home</a>
            <span className="sep">›</span>
            <a href="#recipe-search">{recipe.cuisine}</a>
            <span className="sep">›</span>
            <span className="current">{recipe.name.toLowerCase()}</span>
          </div>

          <RecipeHero
            recipe={recipe}
            nutrition={nutrition}
            saved={saved}
            onToggleSave={() => setSaved(s => !s)}
            onJumpToNutrition={jumpToNutrition}
          />

          <div className="r-stage">
            <StepCard recipe={recipe} stepIdx={stepIdx} doneSteps={doneSteps} />
            <aside className="r-side">
              <IngredientsCard recipe={recipe} />
              <UtensilsCard recipe={recipe} />
            </aside>
          </div>

          <HealthMarquee facts={recipe.healthFacts} />
          <NutritionSection nutrition={nutrition} />
        </div>
      </main>

      <CookingPlayer
        recipe={recipe}
        stepIdx={stepIdx}
        setStepIdx={setStepIdx}
        doneSteps={doneSteps}
        setDoneSteps={setDoneSteps}
      />
    </>
  );
}

window.RecipeDetailPage = RecipeDetailPage;
