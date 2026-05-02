// Auth state — localStorage now, swap internals for API calls when backend is ready.
// Shape: { id, name, email, avatar, provider }
// Events: 'mfc:auth-change' dispatched on window with { detail: { user } }
window.MFC = window.MFC || {};
window.MFC.auth = (function () {
  const KEY = 'mfc_user';

  function getUser() {
    try { return JSON.parse(localStorage.getItem(KEY)) || null; }
    catch { return null; }
  }

  function _emit(user) {
    window.dispatchEvent(new CustomEvent('mfc:auth-change', { detail: { user } }));
  }

  function setUser(user) {
    localStorage.setItem(KEY, JSON.stringify(user));
    _emit(user);
  }

  function clearUser() {
    localStorage.removeItem(KEY);
    _emit(null);
  }

  function isLoggedIn() { return !!getUser(); }

  // Demo sign-in — replace body with OAuth redirect when backend is ready.
  // The returned shape is the contract the whole app depends on.
  async function signIn({ name, email } = {}) {
    const user = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36),
      name: name || 'Guest',
      email: email || '',
      avatar: null,
      provider: 'demo',
    };
    setUser(user);
    return user;
  }

  async function signOut() {
    clearUser();
  }

  return { getUser, setUser, clearUser, isLoggedIn, signIn, signOut };
})();
