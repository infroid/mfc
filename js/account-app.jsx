const { useState, useEffect } = React;

const ACCOUNT_STYLE = `
.wrap { max-width: 880px; margin: 0 auto; padding: 0 28px; position: relative; z-index: 2; }

.acc-loading {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  min-height: 100vh; gap: 14px;
}
.acc-loading .pulse {
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--orange);
  animation: acc-pulse 1.1s cubic-bezier(.4,0,.6,1) infinite;
}
.acc-loading p {
  font-family: var(--serif); font-style: italic; font-size: 18px;
  color: var(--ink-muted); letter-spacing: -0.01em;
}
@keyframes acc-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.6); }
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
  flex-shrink: 0;
  text-transform: uppercase;
}

/* ---------- HEADER ---------- */
.acc-head { padding: 56px 0 28px; }
.acc-eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px; background: var(--paper);
  border: 1px solid var(--rule); border-radius: var(--r-pill);
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft);
  margin-bottom: 18px;
}
.acc-eyebrow::before { content: "// "; color: var(--orange); }
.acc-title {
  font-family: var(--sans); font-weight: 500;
  font-size: clamp(36px, 5vw, 56px); line-height: 1.0;
  letter-spacing: -0.035em;
}
.acc-title em {
  font-family: var(--serif); font-style: italic; font-weight: 400;
  color: var(--orange);
}
.acc-sub {
  margin-top: 14px; font-family: var(--serif); font-style: italic;
  font-size: 19px; color: var(--ink-soft); line-height: 1.4;
  max-width: 560px;
}

/* ---------- IDENTITY CARD ---------- */
.acc-card {
  margin-top: 36px;
  background: var(--paper);
  border: 1.5px solid var(--ink);
  border-radius: var(--r-lg);
  box-shadow: var(--pop-md);
  overflow: hidden;
}
.acc-card-head {
  display: flex; align-items: center; gap: 18px;
  padding: 24px 26px;
  border-bottom: 1px dashed var(--rule-strong);
}
.acc-avatar-lg {
  width: 64px; height: 64px;
  background: var(--orange); color: var(--paper);
  border-radius: 50%;
  display: grid; place-items: center;
  font-family: var(--mono); font-size: 24px; font-weight: 700;
  text-transform: uppercase;
  border: 2px solid var(--ink);
  box-shadow: var(--pop-sm);
  transform: rotate(-3deg); flex-shrink: 0;
}
.acc-identity { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.acc-name {
  font-family: var(--sans); font-weight: 600; font-size: 20px;
  letter-spacing: -0.02em; color: var(--ink);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acc-email {
  font-family: var(--mono); font-size: 12px;
  color: var(--ink-muted); letter-spacing: 0.02em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.acc-provider {
  display: inline-flex; align-items: center; gap: 6px;
  margin-top: 4px;
  padding: 3px 10px;
  background: var(--orange-soft);
  border-radius: var(--r-pill);
  font-family: var(--mono); font-size: 10px;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: var(--orange-deep);
}

/* ---------- ROWS ---------- */
.acc-rows { padding: 8px 26px 22px; }
.acc-row {
  display: flex; align-items: center; justify-content: space-between; gap: 20px;
  padding: 16px 0;
  border-bottom: 1px dashed var(--rule);
}
.acc-row:last-child { border-bottom: none; }
.acc-row-label { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.acc-row-name {
  font-family: var(--sans); font-weight: 500; font-size: 14px; color: var(--ink);
}
.acc-row-hint {
  font-family: var(--mono); font-size: 11px; color: var(--ink-muted);
  letter-spacing: 0.02em;
}
.acc-row-action {
  font-family: var(--mono); font-size: 11px;
  color: var(--ink-faint); letter-spacing: 0.08em; text-transform: uppercase;
  white-space: nowrap;
}
.acc-row-value {
  font-family: var(--sans); font-size: 14px; font-weight: 500;
  color: var(--ink); letter-spacing: -0.01em;
}
.acc-row-value.unset {
  font-family: var(--serif); font-style: italic; font-weight: 400;
  color: var(--ink-faint); font-size: 15px;
}
.acc-row-right { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; justify-content: flex-end; }
.acc-edit-link {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-muted); cursor: pointer;
  background: none; border: none; padding: 4px 0;
  transition: color 160ms;
}
.acc-edit-link::before { content: "// "; }
.acc-edit-link:hover { color: var(--orange); }
.acc-edit-link.cta { color: var(--orange-deep); }
.acc-edit-link.cta:hover { color: var(--orange); }
.acc-edit-form {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  justify-content: flex-end; flex: 1; min-width: 0;
}
.acc-edit-input {
  flex: 1; min-width: 200px;
  padding: 9px 12px;
  background: var(--paper); color: var(--ink);
  border: 1.5px solid var(--rule-strong);
  border-radius: 10px;
  font-family: var(--sans); font-size: 14px;
  outline: none;
  transition: border-color 160ms, box-shadow 160ms, background 160ms;
}
.acc-edit-input:focus {
  border-color: var(--orange);
  box-shadow: 0 0 0 3px var(--orange-soft);
  background: var(--paper);
}
.acc-edit-save {
  padding: 8px 14px;
  background: var(--ink); color: var(--paper);
  border: 1.5px solid var(--ink); border-radius: var(--r-pill);
  font-family: var(--sans); font-size: 13px; font-weight: 500;
  cursor: pointer;
  box-shadow: var(--pop-sm);
  transition: transform 160ms, box-shadow 160ms, background 160ms;
}
.acc-edit-save:hover:not(:disabled) {
  background: var(--orange);
  transform: translate(-1px,-1px);
  box-shadow: 4px 4px 0 var(--ink);
}
.acc-edit-save:disabled { opacity: 0.4; cursor: not-allowed; }
.acc-edit-cancel {
  padding: 8px 4px;
  background: none; border: none;
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink-muted); cursor: pointer;
  transition: color 160ms;
}
.acc-edit-cancel:hover { color: var(--ink); }
.acc-edit-error {
  flex-basis: 100%;
  font-family: var(--mono); font-size: 11px;
  color: var(--berry); letter-spacing: 0.04em;
  text-align: right;
}

/* ---------- COMING-SOON RIBBON ---------- */
.acc-soon {
  margin-top: 28px;
  padding: 16px 22px;
  background: var(--cream-soft);
  border: 1px dashed var(--rule-strong);
  border-radius: var(--r-md);
  font-family: var(--serif); font-style: italic; font-size: 16px;
  color: var(--ink-soft); line-height: 1.45;
}
.acc-soon::before { content: "✎"; font-family: var(--hand); font-style: normal; font-size: 22px; color: var(--orange); margin-right: 10px; }

/* ---------- DANGER ---------- */
.acc-danger {
  margin-top: 36px; padding: 22px 26px;
  background: var(--paper); border: 1px solid var(--rule);
  border-radius: var(--r-md);
}
.acc-danger-head {
  font-family: var(--mono); font-size: 11px;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--berry); margin-bottom: 10px;
}
.acc-danger-head::before { content: "// "; }
.acc-danger-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.btn-signout {
  padding: 8px 16px; border-radius: var(--r-pill);
  background: var(--paper); color: var(--berry);
  border: 1.5px solid var(--berry);
  font-size: 13px; font-weight: 500;
  cursor: pointer; transition: background 160ms, color 160ms;
}
.btn-signout:hover { background: var(--berry); color: var(--paper); }

@media (max-width: 720px) {
  .nav-links { display: none; }
  .nav-inner { padding: 0 20px; gap: 12px; }
  .acc-head { padding: 36px 0 18px; }
  .acc-card-head { padding: 18px 18px; gap: 14px; }
  .acc-rows { padding: 4px 18px 18px; }
  .acc-avatar-lg { width: 52px; height: 52px; font-size: 20px; }
  .acc-row { flex-wrap: wrap; gap: 6px; }
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

// ---------- placeholder rows ----------

function PlaceholderRow({ name, hint }) {
  return (
    <div className="acc-row">
      <div className="acc-row-label">
        <div className="acc-row-name">{name}</div>
        <div className="acc-row-hint">{hint}</div>
      </div>
      <div className="acc-row-action">soon</div>
    </div>
  );
}

function DisplayNameRow({ user }) {
  const current = (user && user.name) || '';
  const isFallback = current === (user?.email || '').split('@')[0] && !!user?.email;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (editing && inputRef.current) inputRef.current.select();
  }, [editing]);

  function startEdit() {
    setDraft(isFallback ? '' : current);
    setError('');
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError('');
  }

  async function save(e) {
    e.preventDefault();
    const next = draft.trim();
    if (!next || next === current) { cancel(); return; }
    setBusy(true); setError('');
    try {
      const sb = window.MFC?.supabase;
      if (!sb) throw new Error('Supabase unavailable');
      const { error: upErr } = await sb.auth.updateUser({ data: { full_name: next } });
      if (upErr) throw upErr;
      setEditing(false);
    } catch (err) {
      setError((err && err.message) || 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="acc-row">
      <div className="acc-row-label">
        <div className="acc-row-name">Display name</div>
        <div className="acc-row-hint">how MyFoodCraving greets you</div>
      </div>
      {editing ? (
        <form className="acc-edit-form" onSubmit={save}>
          <input
            ref={inputRef}
            type="text"
            className="acc-edit-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') cancel(); }}
            placeholder="What should we call you?"
            maxLength={64}
            disabled={busy}
            autoFocus
          />
          <button type="submit" className="acc-edit-save" disabled={busy || !draft.trim()}>
            {busy ? 'saving…' : 'save'}
          </button>
          <button type="button" className="acc-edit-cancel" onClick={cancel} disabled={busy}>
            cancel
          </button>
          {error && <div className="acc-edit-error">{error}</div>}
        </form>
      ) : (
        <div className="acc-row-right">
          {current && !isFallback
            ? <span className="acc-row-value">{current}</span>
            : <span className="acc-row-value unset">{isFallback ? `${current} (from email)` : 'not set'}</span>
          }
          <button type="button" className={"acc-edit-link" + (isFallback || !current ? " cta" : "")} onClick={startEdit}>
            {isFallback || !current ? 'set name' : 'edit'}
          </button>
        </div>
      )}
    </div>
  );
}

function BiologicalSexRow({ user }) {
  const labelFor = window.MFC_BIOSEX_LABEL_FOR || (() => null);
  const current = user && user.biologicalSex;
  const display = current ? labelFor(current) : null;

  return (
    <div className="acc-row">
      <div className="acc-row-label">
        <div className="acc-row-name">Biological sex</div>
        <div className="acc-row-hint">tunes blood-marker reference ranges · permanent</div>
      </div>
      <div className="acc-row-right">
        {display
          ? <span className="acc-row-value">{display}</span>
          : <span className="acc-row-value unset">set on bloodwork page</span>
        }
      </div>
    </div>
  );
}

// ---------- main ----------

function AccountApp() {
  const { user, ready } = useAuthGuard();

  useEffect(() => {
    if (ready && !user) window.location.href = '../index.html';
  }, [ready, user]);

  function deriveInitials(u) {
    const src = (u && (u.name || u.email)) || '?';
    const parts = src.split(/[\s@.]/).filter(Boolean).slice(0, 2);
    return (parts.map((s) => s[0]).join('') || src[0] || '?').toUpperCase();
  }

  if (!ready) {
    return (
      <>
        <style>{ACCOUNT_STYLE}</style>
        <div className="acc-loading"><span className="pulse" /><p>loading…</p></div>
      </>
    );
  }
  if (!user) return <style>{ACCOUNT_STYLE}</style>;

  const provider = user.provider || 'email';

  return (
    <>
      <style>{ACCOUNT_STYLE}</style>
      <Nav user={user} />
      <main className="wrap">
        <header className="acc-head">
          <div className="acc-eyebrow"><span>your space</span></div>
          <h1 className="acc-title">Your <em>account</em></h1>
          <p className="acc-sub">
            The basics live here. Profile editing, connected services, and notification
            preferences are on their way.
          </p>
        </header>

        <section className="acc-card">
          <div className="acc-card-head">
            <div className="acc-avatar-lg">{deriveInitials(user)}</div>
            <div className="acc-identity">
              <div className="acc-name">{user.name || (user.email || '').split('@')[0] || 'You'}</div>
              {user.email && <div className="acc-email">{user.email}</div>}
              <div><span className="acc-provider">{provider === 'google' ? 'google' : 'magic link'}</span></div>
            </div>
          </div>
          <div className="acc-rows">
            <DisplayNameRow user={user} />
            <PlaceholderRow name="Email" hint="primary contact + sign-in" />
            <BiologicalSexRow user={user} />
            <PlaceholderRow name="Connected accounts" hint="google, apple" />
            <PlaceholderRow name="Notifications" hint="meal nudges, weekly summary" />
            <PlaceholderRow name="Dietary preferences" hint="allergens, cuisines, fasting windows" />
          </div>
        </section>

        <p className="acc-soon">
          We're keeping this page minimal while the rest of the kitchen warms up. Tell us
          what you'd like to control here and it'll show up sooner.
        </p>

        <section className="acc-danger">
          <div className="acc-danger-head">danger zone</div>
          <div className="acc-danger-row">
            <div className="acc-row-label">
              <div className="acc-row-name">Sign out</div>
              <div className="acc-row-hint">end this session on this device</div>
            </div>
            <button className="btn-signout" onClick={() => window.MFC?.auth?.signOut()}>
              Sign out
            </button>
          </div>
        </section>
      </main>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<AccountApp />);
