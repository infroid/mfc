// Shared navbar — single source of truth for primary navigation.
// Two variants only: logged-out (Home, Recipes) and logged-in
// (Dashboard, Bloodwork, Recipes). Right-side avatar is delegated to
// MfcUserMenu (must be loaded first).
//
// Styles for the shared inner pieces (brand, links, user pill, avatar) are
// injected once. Each host page may still own the outer `.nav` rule
// (position/background) — see CLAUDE.md re: fixed-on-root vs sticky-on-/my/.
//
// Usage:
//   <MfcNav user={user} active="home|recipes|dashboard|bloodwork" base="" />
//   - `base` is the path prefix to project root from the current page
//     ("" for root pages, "../" for /my/ pages).
//   - `active` is optional; omit on pages without a matching nav link
//     (e.g. /my/account, /my/profile).

(function () {
  const { useState, useEffect } = React;

  const STYLE = `
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
.nav-user-btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 16px; background: var(--orange); color: var(--paper);
  border-radius: 999px; font-size: 14px; font-weight: 500;
  cursor: pointer; border: none; transition: background 200ms;
}
.nav-user-btn:hover { background: var(--orange-deep); }
.nav-user {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 14px 6px 6px;
  background: var(--paper); color: var(--ink);
  border: 1.5px solid var(--ink); border-radius: 999px;
  font-size: 13px; font-weight: 500;
  cursor: pointer; box-shadow: 3px 3px 0 var(--ink);
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
@media (max-width: 880px) {
  .nav-links { display: none; }
}
`;

  function ensureStyle() {
    if (document.getElementById('mfc-nav-style')) return;
    const el = document.createElement('style');
    el.id = 'mfc-nav-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }
  ensureStyle();

  function useScrolled() {
    const [s, setS] = useState(false);
    useEffect(() => {
      const fn = () => setS(window.scrollY > 20);
      window.addEventListener('scroll', fn, { passive: true });
      fn();
      return () => window.removeEventListener('scroll', fn);
    }, []);
    return s;
  }

  function MfcNav({ user, active, base = '' }) {
    const scrolled = useScrolled();
    const openAuth = () => window.dispatchEvent(new CustomEvent('mfc:open-auth'));
    const UserMenu = window.MfcUserMenu;
    const cls = (key) => active === key ? 'active' : undefined;
    const brandHref = user ? base + 'my/dashboard.html' : base + 'index.html';

    return (
      <nav className={'nav' + (scrolled ? ' scrolled' : '')}>
        <div className="nav-inner">
          <a className="brand" href={brandHref}>
            <span className="brand-mark">m</span>
            <span className="brand-name">MyFood<em>Craving</em></span>
          </a>
          <div className="nav-links">
            {user ? (
              <>
                <a href={base + 'my/dashboard.html'} className={cls('dashboard')}>Dashboard</a>
                <a href={base + 'my/markers.html'} className={cls('bloodwork')}>Bloodwork</a>
                <a href={base + 'recipe-search.html'} className={cls('recipes')}>Recipes</a>
              </>
            ) : (
              <>
                <a href={base + 'index.html'} className={cls('home')}>Home</a>
                <a href={base + 'recipe-search.html'} className={cls('recipes')}>Recipes</a>
              </>
            )}
          </div>
          {UserMenu && (
            <UserMenu
              user={user}
              onSignIn={openAuth}
              accountHref={base + 'my/account.html'}
              profileHref={base + 'my/profile.html'}
            />
          )}
        </div>
      </nav>
    );
  }

  window.MfcNav = MfcNav;
})();
