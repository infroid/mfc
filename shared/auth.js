// Public contract: window.MFC.auth = { getUser, isLoggedIn, signIn, signOut }
// Emits 'mfc:auth-change' CustomEvent on window with { detail: { user } }.
//
// signIn modes:
//   - signIn({ provider: 'google' })   → Google OAuth redirect (returns null; page navigates)
//   - signIn({ email })                 → magic link (returns { magicLinkSent: true, email })
//
// Redirect contract:
//   - post-login  → my/dashboard.html  (unless on a STAY_ON page: recipe.html, anything under /my/ or /admin/)
//   - post-logout → index.html         (always)
//   - index.html is logged-out only: a signed-in user landing there is bounced to my/dashboard.html
window.MFC = window.MFC || {};
window.MFC.auth = (function () {
  const sb = window.MFC.supabase;

  const POST_LOGIN  = 'my/dashboard.html';
  const POST_LOGOUT = 'index.html';
  // Pages that keep the user where they are after sign-in.
  const STAY_ON_PATHS = new Set(['recipe.html']);

  function isStayPage() {
    const path = location.pathname;
    const base = path.split('/').pop() || '';
    return STAY_ON_PATHS.has(base) || path.includes('/admin/') || path.includes('/my/');
  }

  function isOn(target) {
    const here = location.pathname.replace(/^\/+/, '');
    return here === target || (target === 'index.html' && (here === '' || here === '/'));
  }
  function isLoggedOutOnlyPage() {
    return isOn('index.html');
  }
  function redirectAfterLogin()  { if (!isOn(POST_LOGIN))  window.location.href = `${location.origin}/${POST_LOGIN}`;  }
  function redirectAfterLogout() { if (!isOn(POST_LOGOUT)) window.location.href = `${location.origin}/${POST_LOGOUT}`; }

  function emit(user) {
    window.dispatchEvent(new CustomEvent('mfc:auth-change', { detail: { user } }));
  }

  function userFromSession(session) {
    if (!session?.user) return null;
    const u = session.user;
    const m = u.user_metadata || {};
    return {
      id: u.id,
      name: m.full_name || m.name || (u.email ? u.email.split('@')[0] : 'You'),
      email: u.email || '',
      avatar: m.avatar_url || m.picture || null,
      provider: u.app_metadata?.provider || 'email',
    };
  }

  let currentUser = null;

  if (sb) {
    sb.auth.getSession().then(({ data }) => {
      currentUser = userFromSession(data.session);
      if (currentUser && isLoggedOutOnlyPage()) {
        redirectAfterLogin();
        return;
      }
      emit(currentUser);
    });

    sb.auth.onAuthStateChange((event, session) => {
      const prev = currentUser;
      const next = userFromSession(session);
      currentUser = next;
      if (next && !prev && event === 'SIGNED_IN') {
        if (window.MFC?.db?.handoffAnonymous) {
          window.MFC.db.handoffAnonymous(next).catch((e) => console.warn('[mfc] handoff failed', e));
        }
        if (!isStayPage()) {
          redirectAfterLogin();
          return;
        }
      }
      if (next && isLoggedOutOnlyPage()) {
        redirectAfterLogin();
        return;
      }
      emit(next);
    });
  }

  function getUser() { return currentUser; }
  function isLoggedIn() { return !!currentUser; }

  async function signIn(opts = {}) {
    if (!sb) throw new Error('Supabase client unavailable — check mfc-supabase-* meta tags.');
    const loginUrl = isStayPage() ? window.location.href : `${location.origin}/${POST_LOGIN}`;
    if (opts.provider === 'google') {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: loginUrl },
      });
      if (error) throw error;
      return null;
    }
    if (opts.email) {
      const { error } = await sb.auth.signInWithOtp({
        email: opts.email,
        options: { emailRedirectTo: loginUrl },
      });
      if (error) throw error;
      return { magicLinkSent: true, email: opts.email };
    }
    throw new Error('signIn: pass { email } for magic link or { provider: "google" } for OAuth');
  }

  async function signOut() {
    if (!sb) return;
    await sb.auth.signOut();
    redirectAfterLogout();
  }

  return { getUser, isLoggedIn, signIn, signOut };
})();
