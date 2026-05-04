// Shared user menu — pill button + dropdown (Account, Sign out).
// Reuses .nav-user / .nav-avatar / .nav-user-btn already defined per-page.
// Injects its own dropdown styles once.
// Usage: <MfcUserMenu user={user} onSignIn={openAuth}
//                      accountHref="my/account.html"
//                      profileHref="my/profile.html" />
// profileHref is optional; when omitted the Profile item is hidden.

(function () {
  const STYLE = `
.user-menu { position: relative; display: inline-flex; }
.user-menu .nav-user { gap: 8px; }
.user-menu-caret {
  width: 0; height: 0; margin-left: 4px;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--ink-muted, #6B6253);
  transition: transform 200ms cubic-bezier(.2,.8,.2,1);
}
.user-menu .nav-user.open .user-menu-caret { transform: rotate(180deg); }
.user-menu-dropdown {
  position: absolute; top: calc(100% + 10px); right: 0;
  min-width: 240px;
  background: var(--paper, #FFFCF3);
  border: 1.5px solid var(--ink, #1F1A14);
  border-radius: 14px;
  box-shadow: 4px 4px 0 var(--ink, #1F1A14);
  padding: 6px;
  z-index: 1000;
  animation: user-menu-pop 180ms cubic-bezier(.2,.8,.2,1);
}
@keyframes user-menu-pop {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.user-menu-head {
  padding: 10px 12px 8px;
  display: flex; flex-direction: column; gap: 2px;
}
.user-menu-name {
  font-family: var(--sans); font-size: 13px; font-weight: 600;
  color: var(--ink, #1F1A14); letter-spacing: -0.01em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.user-menu-email {
  font-family: var(--mono, monospace); font-size: 11px;
  color: var(--ink-muted, #6B6253); letter-spacing: 0.02em;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.user-menu-rule {
  border: none;
  border-top: 1px dashed var(--rule-strong, rgba(31,26,20,.28));
  margin: 6px 4px;
}
.user-menu-item {
  display: block;
  width: 100%; padding: 10px 12px;
  background: transparent; border: none; cursor: pointer;
  font-family: var(--sans); font-size: 13px; font-weight: 500;
  color: var(--ink, #1F1A14); text-align: left;
  border-radius: 8px;
  transition: background 160ms, color 160ms;
  text-decoration: none;
  letter-spacing: -0.01em;
}
.user-menu-item:hover, .user-menu-item:focus-visible {
  background: var(--cream-deep, #EFE6CF); outline: none;
}
.user-menu-item.danger { color: var(--ink-soft, #3A332A); }
.user-menu-item.danger:hover { background: rgba(200,75,90,.10); color: var(--berry, #C84B5A); }
`;

  function ensureStyle() {
    if (document.getElementById('mfc-user-menu-style')) return;
    const el = document.createElement('style');
    el.id = 'mfc-user-menu-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }
  ensureStyle();

  function deriveInitials(user) {
    const src = (user && (user.name || user.email)) || '?';
    const parts = src.split(/[\s@.]/).filter(Boolean).slice(0, 2);
    const out = parts.map((s) => s[0]).join('') || src[0] || '?';
    return out.toUpperCase();
  }

  function deriveFirstName(user) {
    const src = (user && (user.name || user.email)) || '';
    return src.split(/[\s@]/)[0] || 'You';
  }

  function MfcUserMenu({ user, onSignIn, accountHref, profileHref }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef(null);

    React.useEffect(() => {
      if (!open) return;
      const onDocClick = (e) => {
        if (ref.current && !ref.current.contains(e.target)) setOpen(false);
      };
      const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDocClick);
        document.removeEventListener('keydown', onKey);
      };
    }, [open]);

    if (!user) {
      return (
        <button className="nav-user-btn" onClick={onSignIn}>Sign in →</button>
      );
    }

    const initials = deriveInitials(user);
    const firstName = deriveFirstName(user);

    function handleSignOut() {
      setOpen(false);
      window.MFC && window.MFC.auth && window.MFC.auth.signOut && window.MFC.auth.signOut();
    }

    return (
      <div className="user-menu" ref={ref}>
        <button
          type="button"
          className={"nav-user" + (open ? " open" : "")}
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={user.email || ''}
        >
          <span className="nav-avatar">{initials}</span>
          <span>{firstName}</span>
          <span className="user-menu-caret" aria-hidden="true" />
        </button>
        {open && (
          <div className="user-menu-dropdown" role="menu">
            <div className="user-menu-head">
              <div className="user-menu-name">{user.name || firstName}</div>
              {user.email && <div className="user-menu-email">{user.email}</div>}
            </div>
            <div className="user-menu-rule" />
            {profileHref && (
              <a
                className="user-menu-item"
                role="menuitem"
                href={profileHref}
                onClick={() => setOpen(false)}
              >
                Profile
              </a>
            )}
            <a
              className="user-menu-item"
              role="menuitem"
              href={accountHref || '#'}
              onClick={() => setOpen(false)}
            >
              Account
            </a>
            <button
              type="button"
              className="user-menu-item danger"
              role="menuitem"
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  window.MfcUserMenu = MfcUserMenu;
})();
