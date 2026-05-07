const { useState, useEffect, useMemo, useRef } = React;

// ---------- tag taxonomy ----------
//
// Sections split for UI grouping; storage maps:
//   - All Diet sub-groups + Lifestyle  -> user_profiles.diet_tags
//   - Allergies                        -> user_profiles.allergies
//   - Goals                            -> user_profiles.goals
//
// `mediterranean` intentionally appears in two diet sub-groups (Patterns +
// Cuisine). Selecting either toggles the same underlying tag — both chips
// show selected state because they share the source of truth.

const DIET_GROUPS = [
  { key: 'eating',  label: 'How do you eat?',
    tags: ['vegetarian', 'vegan', 'pescatarian', 'gluten-free', 'dairy-free', 'low-fodmap'] },
  { key: 'macro',   label: 'Macro orientation',
    tags: ['high-protein', 'low-carb', 'low-fat', 'low-sodium', 'low-sugar'] },
  { key: 'pattern', label: 'Patterns',
    tags: ['keto', 'paleo', 'mediterranean', 'whole30'] },
  { key: 'cuisine', label: 'Cuisine preference',
    tags: ['indian', 'asian', 'mediterranean', 'mexican', 'italian'] },
  { key: 'time',    label: 'Time / effort',
    tags: ['quick', 'one-pot', 'batch-cook'] },
];

const ALLERGY_TAGS  = ['nut-free', 'egg-free', 'soy-free', 'shellfish-free'];
const GOAL_TAGS     = ['weight-loss', 'muscle-gain', 'energy', 'heart-health', 'gut-health'];
const LIFESTYLE_TAGS = ['halal', 'kosher', 'jain', 'warming', 'cooling', 'raw'];

function labelFor(tag) {
  if (tag === 'low-fodmap') return 'Low-FODMAP';
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

// Re-export taxonomy for any other surface that needs to enumerate the same
// tag namespace (e.g. recipe-search soft-pref strip rendering "+N more").
window.MFC = window.MFC || {};
window.MFC.tagTaxonomy = {
  diet:      DIET_GROUPS.flatMap((g) => g.tags),
  allergies: ALLERGY_TAGS,
  goals:     GOAL_TAGS,
  lifestyle: LIFESTYLE_TAGS,
  groups:    { DIET_GROUPS, ALLERGY_TAGS, GOAL_TAGS, LIFESTYLE_TAGS },
  labelFor,
};

// ---------- styles ----------

const PROFILE_STYLE = `
.wrap { max-width: 920px; margin: 0 auto; padding: 0 28px 160px; position: relative; z-index: 2; }

.pf-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 100vh; gap: 14px;
}
.pf-loading .pulse {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--orange);
  animation: pf-pulse 1.1s cubic-bezier(.4,0,.6,1) infinite;
}
.pf-loading p {
  font-family: var(--serif); font-style: italic; font-size: 18px;
  color: var(--ink-muted); letter-spacing: -0.01em;
}
@keyframes pf-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.4; transform: scale(0.6); }
}

/* ---------- NAV (outer only — inner pieces in assets/js/lib/nav.jsx) ---------- */
.nav {
  position: sticky; top: 0; z-index: 50; height: 64px;
  display: flex; align-items: center;
  background: rgba(247, 241, 227, 0.86);
  -webkit-backdrop-filter: blur(14px) saturate(160%);
          backdrop-filter: blur(14px) saturate(160%);
  border-bottom: 1px solid var(--rule);
}

/* ---------- HEADER ---------- */
.pf-head { padding: 56px 0 24px; }
.pf-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px; background: var(--paper);
  border: 1px solid var(--rule); border-radius: var(--r-pill);
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft);
  margin-bottom: 18px;
}
.pf-eyebrow::before { content: "// "; color: var(--orange); }
.pf-title {
  font-family: var(--sans); font-weight: 500;
  font-size: clamp(36px, 5vw, 56px); line-height: 1.0;
  letter-spacing: -0.035em;
}
.pf-title em {
  font-family: var(--serif); font-style: italic; font-weight: 400;
  color: var(--orange);
}
.pf-scribble {
  font-family: var(--hand, "Caveat", cursive);
  font-size: 24px; font-weight: 500;
  color: var(--matcha-deep);
  display: inline-block;
  transform: rotate(-3deg);
  margin-left: 12px;
  vertical-align: 0.3em;
}
.pf-sub {
  margin-top: 14px; font-family: var(--serif); font-style: italic;
  font-size: 19px; color: var(--ink-soft); line-height: 1.45;
  max-width: 600px;
}

/* ---------- SECTION ---------- */
.pf-section { padding: 36px 0 8px; }
.pf-section-rule {
  border-top: 1px dashed var(--rule-strong);
  padding-top: 36px;
}
.pf-sec-eyebrow {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--orange-deep); margin-bottom: 10px;
}
.pf-sec-eyebrow::before { content: "§ "; color: var(--ink-faint); }
.pf-sec-title {
  font-family: var(--sans); font-weight: 500;
  font-size: clamp(24px, 3vw, 32px); line-height: 1.1;
  letter-spacing: -0.025em;
}
.pf-sec-title em {
  font-family: var(--serif); font-style: italic; font-weight: 400;
  color: var(--orange);
}
.pf-sec-tag {
  margin-top: 10px;
  font-family: var(--serif); font-style: italic;
  color: var(--ink-soft); font-size: 17px; line-height: 1.45;
  max-width: 600px;
}

/* ---------- CHIP GROUP ---------- */
.pf-group { margin-top: 22px; }
.pf-group-label {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-muted);
  margin-bottom: 10px;
}
.pf-group-label::before { content: "↳ "; color: var(--ink-faint); }
.pf-chips {
  display: flex; flex-wrap: wrap; gap: 8px;
}

.pf-chip {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 16px;
  background: var(--paper); color: var(--ink-soft);
  border: 1.5px solid var(--rule-strong);
  border-radius: var(--r-pill);
  font-family: var(--sans); font-size: 13.5px; font-weight: 500;
  letter-spacing: -0.01em;
  cursor: pointer; user-select: none;
  transition: transform 160ms cubic-bezier(.2,.8,.2,1),
              box-shadow 160ms,
              border-color 160ms,
              background 160ms,
              color 160ms;
}
.pf-chip:hover {
  border-color: var(--ink); color: var(--ink);
  background: var(--cream-soft);
}
.pf-chip.selected {
  background: var(--ink); color: var(--paper);
  border-color: var(--ink);
  box-shadow: var(--pop-sm);
  transform: translate(-1px,-1px);
}
.pf-chip.selected:hover {
  background: var(--orange); border-color: var(--orange);
  box-shadow: 4px 4px 0 var(--ink);
}
.pf-chip-tick {
  display: inline-grid; place-items: center;
  width: 14px; height: 14px;
  border-radius: 50%;
  background: var(--orange); color: var(--paper);
  font-family: var(--mono); font-size: 9px; font-weight: 700;
  line-height: 1;
}
.pf-chip-tick::before { content: "✓"; }

/* allergy chips lean berry to feel like a hard 'no' */
.pf-chip.allergy.selected {
  background: var(--berry); border-color: var(--berry);
  box-shadow: 3px 3px 0 var(--ink);
}
.pf-chip.allergy.selected:hover {
  background: var(--berry); border-color: var(--berry);
}
.pf-chip.allergy .pf-chip-tick { background: var(--paper); color: var(--berry); }

/* goal chips lean matcha — green, growth */
.pf-chip.goal.selected {
  background: var(--matcha-deep); border-color: var(--matcha-deep);
}
.pf-chip.goal.selected:hover {
  background: var(--matcha-deep); border-color: var(--matcha-deep);
}

/* ---------- IDENTITY CARD ---------- */
.pf-id-card {
  margin-top: 32px;
  background: var(--paper);
  border: 1.5px solid var(--ink);
  border-radius: var(--r-lg);
  box-shadow: var(--pop-md);
  padding: 22px 26px 18px;
}
.pf-id-row {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  padding: 12px 0;
  border-bottom: 1px dashed var(--rule);
  flex-wrap: wrap;
}
.pf-id-row:last-child { border-bottom: none; }
.pf-id-label { display: flex; flex-direction: column; gap: 3px; }
.pf-id-name {
  font-family: var(--sans); font-weight: 500; font-size: 14px; color: var(--ink);
}
.pf-id-hint {
  font-family: var(--mono); font-size: 11px; color: var(--ink-muted);
  letter-spacing: 0.02em;
}
.pf-dob-input {
  padding: 9px 12px;
  background: var(--paper); color: var(--ink);
  border: 1.5px solid var(--rule-strong);
  border-radius: 10px;
  font-family: var(--sans); font-size: 14px;
  outline: none; min-width: 168px;
  transition: border-color 160ms, box-shadow 160ms;
}
.pf-dob-input:focus {
  border-color: var(--orange);
  box-shadow: 0 0 0 3px var(--orange-soft);
}

/* radio-pill row — same atom as pf-chip but enforces single-select */
.pf-radio-row { display: flex; gap: 8px; }
.pf-radio {
  padding: 8px 14px;
  background: var(--paper); color: var(--ink-soft);
  border: 1.5px solid var(--rule-strong);
  border-radius: var(--r-pill);
  font-family: var(--sans); font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: all 160ms cubic-bezier(.2,.8,.2,1);
}
.pf-radio:hover { border-color: var(--ink); color: var(--ink); }
.pf-radio.selected {
  background: var(--ink); color: var(--paper);
  border-color: var(--ink);
  box-shadow: var(--pop-sm);
  transform: translate(-1px,-1px);
}

.pf-id-link {
  font-family: var(--mono); font-size: 11.5px;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--orange-deep);
  transition: color 160ms;
}
.pf-id-link:hover { color: var(--orange); }
.pf-id-link::before { content: "↗ "; }

/* ---------- EMPTY-STATE NOTE ---------- */
.pf-empty-note {
  margin-top: 18px;
  padding: 14px 20px;
  background: var(--orange-soft);
  border-left: 3px solid var(--orange);
  border-radius: 8px;
  font-family: var(--serif); font-style: italic;
  font-size: 16px; line-height: 1.45;
  color: var(--ink-soft);
}
.pf-empty-note::before {
  content: "✎";
  font-family: var(--hand); font-style: normal;
  font-size: 22px; color: var(--orange);
  margin-right: 10px; vertical-align: -1px;
}

/* ---------- SAVE BAR ---------- */
.pf-savebar {
  position: fixed;
  left: 50%; bottom: 24px;
  transform: translateX(-50%);
  display: inline-flex; align-items: center; gap: 14px;
  padding: 10px 12px 10px 22px;
  background: var(--ink); color: var(--paper);
  border-radius: var(--r-pill);
  box-shadow: 6px 6px 0 var(--orange);
  z-index: 80;
  animation: pf-savebar-in 280ms cubic-bezier(.2,.8,.2,1);
  max-width: calc(100vw - 40px);
}
@keyframes pf-savebar-in {
  from { transform: translate(-50%, 28px); opacity: 0; }
  to   { transform: translate(-50%, 0);    opacity: 1; }
}
.pf-savebar-msg {
  font-family: var(--mono); font-size: 12px;
  letter-spacing: 0.04em; color: rgba(255,252,243,.8);
  white-space: nowrap;
}
.pf-savebar-msg b { color: var(--paper); font-weight: 600; }
.pf-savebar-discard {
  padding: 7px 14px;
  background: transparent; color: rgba(255,252,243,.85);
  border: 1px solid rgba(255,252,243,.35);
  border-radius: var(--r-pill);
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.06em; text-transform: uppercase;
  cursor: pointer;
  transition: background 160ms, color 160ms;
}
.pf-savebar-discard:hover {
  background: rgba(255,252,243,.1);
  color: var(--paper);
}
.pf-savebar-save {
  padding: 9px 18px;
  background: var(--orange); color: var(--paper);
  border-radius: var(--r-pill);
  font-family: var(--sans); font-size: 13px; font-weight: 500;
  cursor: pointer;
  transition: transform 160ms, box-shadow 160ms;
}
.pf-savebar-save:hover:not(:disabled) {
  transform: translate(-1px,-1px);
  box-shadow: 0 0 0 2px var(--paper);
}
.pf-savebar-save:disabled { opacity: 0.5; cursor: not-allowed; }
.pf-savebar-error {
  display: block; margin-top: 6px;
  font-family: var(--mono); font-size: 11px;
  color: var(--butter); letter-spacing: 0.04em;
}

/* ---------- SAVED FLASH ---------- */
.pf-flash {
  position: fixed;
  left: 50%; bottom: 24px;
  transform: translateX(-50%);
  padding: 10px 18px;
  background: var(--matcha-deep); color: var(--paper);
  border-radius: var(--r-pill);
  font-family: var(--mono); font-size: 12px;
  letter-spacing: 0.06em; text-transform: uppercase;
  box-shadow: 4px 4px 0 var(--ink);
  z-index: 80;
  animation: pf-flash-in 240ms cubic-bezier(.2,.8,.2,1);
}
.pf-flash::before { content: "✓ "; }
@keyframes pf-flash-in {
  from { transform: translate(-50%, 16px); opacity: 0; }
  to   { transform: translate(-50%, 0);    opacity: 1; }
}

/* ---------- responsive ---------- */
@media (max-width: 720px) {
  .nav-links { display: none; }
  .nav-inner { padding: 0 20px; gap: 12px; }
  .pf-head { padding: 36px 0 18px; }
  .pf-id-row { gap: 10px; }
  .pf-savebar {
    width: calc(100vw - 32px);
    justify-content: space-between;
    padding: 10px 10px 10px 18px;
  }
  .pf-savebar-msg { font-size: 11px; }
}
`;

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
  return MfcNav ? <MfcNav user={user} base="../" /> : null;
}

// ---------- chip primitives ----------

function Chip({ tag, selected, onToggle, variant }) {
  return (
    <button
      type="button"
      className={'pf-chip' + (selected ? ' selected' : '') + (variant ? ' ' + variant : '')}
      onClick={() => onToggle(tag)}
      aria-pressed={selected}
    >
      {selected && <span className="pf-chip-tick" aria-hidden="true" />}
      {labelFor(tag)}
    </button>
  );
}

function ChipGroup({ tags, selected, onToggle, variant }) {
  return (
    <div className="pf-chips">
      {tags.map((t) => (
        <Chip key={t} tag={t} selected={selected.has(t)} onToggle={onToggle} variant={variant} />
      ))}
    </div>
  );
}

// ---------- main ----------

function ProfileApp() {
  const { user, ready } = useAuthGuard();

  // Saved snapshot — what's in the database right now.
  // Draft     — what the user has touched but not yet saved.
  const [saved, setSaved] = useState(null);   // null while loading
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef(null);

  // Bounce out if not authed
  useEffect(() => {
    if (ready && !user) window.location.href = '../index.html';
  }, [ready, user]);

  // Load profile once user is known
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const row = await window.MFC?.db?.getUserProfile?.();
      if (cancelled) return;
      const initial = {
        date_of_birth: row?.date_of_birth || '',
        diet_tags:     Array.isArray(row?.diet_tags) ? row.diet_tags : [],
        allergies:     Array.isArray(row?.allergies) ? row.allergies : [],
        goals:         Array.isArray(row?.goals) ? row.goals : [],
        units:         row?.units || 'metric',
      };
      setSaved(initial);
      setDraft(initial);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Cleanup any pending flash
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const dietSet  = useMemo(() => new Set(draft?.diet_tags || []), [draft]);
  const allergSet = useMemo(() => new Set(draft?.allergies || []), [draft]);
  const goalSet  = useMemo(() => new Set(draft?.goals || []), [draft]);

  const dirty = useMemo(() => {
    if (!saved || !draft) return false;
    return !sameProfile(saved, draft);
  }, [saved, draft]);

  const totalSelected = useMemo(() => {
    if (!draft) return 0;
    return new Set([...(draft.diet_tags || []), ...(draft.allergies || []), ...(draft.goals || [])]).size
      + (draft.date_of_birth ? 1 : 0);
  }, [draft]);

  function toggleIn(field) {
    return (tag) => {
      setDraft((d) => {
        const s = new Set(d[field]);
        if (s.has(tag)) s.delete(tag); else s.add(tag);
        return { ...d, [field]: Array.from(s) };
      });
    };
  }

  function setUnits(units) {
    setDraft((d) => ({ ...d, units }));
  }

  function setDob(value) {
    setDraft((d) => ({ ...d, date_of_birth: value }));
  }

  function discard() {
    setDraft(saved);
    setError('');
  }

  async function save() {
    if (!draft || busy) return;
    setBusy(true); setError('');
    const ok = await window.MFC.db.upsertUserProfile({
      dateOfBirth: draft.date_of_birth || null,
      dietTags:    draft.diet_tags,
      allergies:   draft.allergies,
      goals:       draft.goals,
      units:       draft.units,
    });
    setBusy(false);
    if (!ok) {
      setError('Could not save. Try again in a moment.');
      return;
    }
    setSaved(draft);
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 2200);
  }

  // ----- render -----

  if (!ready || loading) {
    return (
      <>
        <style>{PROFILE_STYLE}</style>
        <div className="pf-loading"><span className="pulse" /><p>loading your profile…</p></div>
      </>
    );
  }
  if (!user) return <style>{PROFILE_STYLE}</style>;

  const showEmptyNote = totalSelected === 0;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <style>{PROFILE_STYLE}</style>
      <Nav user={user} />

      <main className="wrap">
        <header className="pf-head">
          <div className="pf-eyebrow"><span>your palate</span></div>
          <h1 className="pf-title">Tune your <em>palate</em><span className="pf-scribble">how you like it ↘</span></h1>
          <p className="pf-sub">
            Tell us what you avoid, what you lean into, and where you're headed.
            We'll soft-filter recipes and sharpen your bloodwork ranges around it.
          </p>
        </header>

        <section className="pf-id-card">
          <div className="pf-id-row">
            <div className="pf-id-label">
              <div className="pf-id-name">Date of birth</div>
              <div className="pf-id-hint">used for age-aware ranges · optional</div>
            </div>
            <input
              type="date"
              className="pf-dob-input"
              value={draft.date_of_birth || ''}
              max={today}
              onChange={(e) => setDob(e.target.value)}
            />
          </div>
          <div className="pf-id-row">
            <div className="pf-id-label">
              <div className="pf-id-name">Units</div>
              <div className="pf-id-hint">how we render measurements</div>
            </div>
            <div className="pf-radio-row" role="radiogroup" aria-label="Measurement units">
              {['metric', 'imperial'].map((u) => (
                <button
                  key={u}
                  type="button"
                  className={'pf-radio' + (draft.units === u ? ' selected' : '')}
                  onClick={() => setUnits(u)}
                  role="radio"
                  aria-checked={draft.units === u}
                >
                  {u === 'metric' ? 'Metric (g, ml, °C)' : 'Imperial (oz, fl-oz, °F)'}
                </button>
              ))}
            </div>
          </div>
          <div className="pf-id-row">
            <div className="pf-id-label">
              <div className="pf-id-name">Display name & biological sex</div>
              <div className="pf-id-hint">live on your account; sex is permanent once set</div>
            </div>
            <a className="pf-id-link" href="account.html">Edit on Account</a>
          </div>
        </section>

        {showEmptyNote && (
          <p className="pf-empty-note">
            Your bloodwork ranges and recipe suggestions get sharper as you fill this in.
          </p>
        )}

        {/* ----- Diet style ----- */}
        <section className="pf-section pf-section-rule">
          <div className="pf-sec-eyebrow">section 01</div>
          <h2 className="pf-sec-title">Diet <em>style</em></h2>
          <p className="pf-sec-tag">
            Pick all that apply — these boost matching recipes and gently demote
            ones that contradict your identity.
          </p>
          {DIET_GROUPS.map((g) => (
            <div className="pf-group" key={g.key}>
              <div className="pf-group-label">{g.label}</div>
              <ChipGroup tags={g.tags} selected={dietSet} onToggle={toggleIn('diet_tags')} />
            </div>
          ))}
        </section>

        {/* ----- Allergies ----- */}
        <section className="pf-section pf-section-rule">
          <div className="pf-sec-eyebrow">section 02</div>
          <h2 className="pf-sec-title">Allergies & <em>exclusions</em></h2>
          <p className="pf-sec-tag">
            A hard "no". These are always enforced — even when soft-filtering is off.
          </p>
          <div className="pf-group">
            <ChipGroup
              tags={ALLERGY_TAGS}
              selected={allergSet}
              onToggle={toggleIn('allergies')}
              variant="allergy"
            />
          </div>
        </section>

        {/* ----- Goals ----- */}
        <section className="pf-section pf-section-rule">
          <div className="pf-sec-eyebrow">section 03</div>
          <h2 className="pf-sec-title">What are you <em>optimizing for</em>?</h2>
          <p className="pf-sec-tag">
            Goals nudge your recommendations toward recipes that move the needle.
          </p>
          <div className="pf-group">
            <ChipGroup
              tags={GOAL_TAGS}
              selected={goalSet}
              onToggle={toggleIn('goals')}
              variant="goal"
            />
          </div>
        </section>

        {/* ----- Lifestyle ----- */}
        <section className="pf-section pf-section-rule">
          <div className="pf-sec-eyebrow">section 04</div>
          <h2 className="pf-sec-title">Lifestyle</h2>
          <p className="pf-sec-tag">
            Religious, cultural, or temperament-based. Halal / kosher / jain are treated
            as identity rules; warming / cooling / raw are gentle preferences.
          </p>
          <div className="pf-group">
            <ChipGroup tags={LIFESTYLE_TAGS} selected={dietSet} onToggle={toggleIn('diet_tags')} />
          </div>
        </section>
      </main>

      {dirty && (
        <div className="pf-savebar" role="status" aria-live="polite">
          <div className="pf-savebar-msg">
            <b>unsaved changes</b>
            {error && <span className="pf-savebar-error">{error}</span>}
          </div>
          <button type="button" className="pf-savebar-discard" onClick={discard} disabled={busy}>
            discard
          </button>
          <button type="button" className="pf-savebar-save" onClick={save} disabled={busy}>
            {busy ? 'saving…' : 'Save changes'}
          </button>
        </div>
      )}
      {!dirty && flash && <div className="pf-flash">profile saved</div>}
    </>
  );
}

function sameProfile(a, b) {
  if (a.date_of_birth !== b.date_of_birth) return false;
  if (a.units !== b.units) return false;
  return sameSet(a.diet_tags, b.diet_tags)
      && sameSet(a.allergies, b.allergies)
      && sameSet(a.goals, b.goals);
}

function sameSet(xs, ys) {
  if (xs.length !== ys.length) return false;
  const s = new Set(xs);
  for (const y of ys) if (!s.has(y)) return false;
  return true;
}

ReactDOM.createRoot(document.getElementById('root')).render(<ProfileApp />);
