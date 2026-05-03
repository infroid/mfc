// Public contract: window.MFC.auth = { getUser, isLoggedIn, signIn, signOut }
// Emits 'mfc:auth-change' CustomEvent on window with { detail: { user } }.
//
// signIn modes:
//   - signIn({ provider: 'google' })   → Google OAuth redirect (returns null; page navigates)
//   - signIn({ email })                 → magic link (returns { magicLinkSent: true, email })
window.MFC = window.MFC || {};
window.MFC.auth = (function () {
  const sb = window.MFC.supabase;

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
      }
      emit(next);
    });
  }

  function getUser() { return currentUser; }
  function isLoggedIn() { return !!currentUser; }

  async function signIn(opts = {}) {
    if (!sb) throw new Error('Supabase client unavailable — check mfc-supabase-* meta tags.');
    if (opts.provider === 'google') {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href },
      });
      if (error) throw error;
      return null;
    }
    if (opts.email) {
      const { error } = await sb.auth.signInWithOtp({
        email: opts.email,
        options: { emailRedirectTo: window.location.href },
      });
      if (error) throw error;
      return { magicLinkSent: true, email: opts.email };
    }
    throw new Error('signIn: pass { email } for magic link or { provider: "google" } for OAuth');
  }

  async function signOut() {
    if (!sb) return;
    await sb.auth.signOut();
  }

  return { getUser, isLoggedIn, signIn, signOut };
})();
