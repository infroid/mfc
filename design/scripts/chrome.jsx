/* global React */
const { useState, useEffect, useRef } = React;

// ---------- Auth state (mock) ----------
window.__MFC_AUTH = window.__MFC_AUTH || { user: null, listeners: [] };
function useUser() {
  const [user, setUser] = useState(window.__MFC_AUTH.user);
  useEffect(() => {
    const fn = (u) => setUser(u);
    window.__MFC_AUTH.listeners.push(fn);
    return () => {
      const i = window.__MFC_AUTH.listeners.indexOf(fn);
      if (i >= 0) window.__MFC_AUTH.listeners.splice(i, 1);
    };
  }, []);
  return user;
}
function setUser(u) {
  window.__MFC_AUTH.user = u;
  window.__MFC_AUTH.listeners.forEach((f) => f(u));
}

// ---------- Router (hash-based) ----------
window.__MFC_ROUTE = window.__MFC_ROUTE || { listeners: [] };
function useRoute() {
  const [route, setRoute] = useState(() => parseRoute());
  useEffect(() => {
    const fn = () => setRoute(parseRoute());
    window.addEventListener("hashchange", fn);
    return () => window.removeEventListener("hashchange", fn);
  }, []);
  return route;
}
function parseRoute() {
  const h = (window.location.hash || "#/").replace(/^#/, "");
  const [path, qs] = h.split("?");
  const params = new URLSearchParams(qs || "");
  const seg = path.split("/").filter(Boolean);
  return { path, seg, params };
}
function navigate(path) {
  window.location.hash = path;
}

// ---------- Nav ----------
function BrandMark({ size = 32 }) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size, fontSize: size * 0.72 }}
    >m</span>
  );
}

function Nav({ activeKey, onSignIn }) {
  const user = useUser();
  const route = useRoute();
  const items = [
    { key: "home", label: "Home", path: "/" },
    { key: "recipes", label: "Recipes", path: "/recipes" },
    { key: "dashboard", label: "Dashboard", path: "/dashboard", auth: true },
    { key: "markers", label: "Markers", path: "/markers", auth: true },
  ];
  const visible = items.filter((it) => !it.auth || user);
  return (
    <nav className="nav">
      <div className="nav-inner">
        <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
          <BrandMark />
          <span className="brand-name">MyFood<em>Craving</em></span>
        </a>
        <div className="nav-links">
          {visible.map((it) => (
            <a
              key={it.key}
              href={"#" + it.path}
              className={activeKey === it.key ? "active" : ""}
              onClick={(e) => { e.preventDefault(); navigate(it.path); }}
            >{it.label}</a>
          ))}
          {user?.role === "admin" && (
            <a
              href="#/admin"
              className={activeKey?.startsWith("admin") ? "active" : ""}
              onClick={(e) => { e.preventDefault(); navigate("/admin/recipes"); }}
              style={{ fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase" }}
            >// admin</a>
          )}
        </div>
        {user ? (
          <button
            className="nav-user"
            onClick={() => navigate("/dashboard")}
            title={user.email + " — click to open dashboard"}
          >
            <span className="nav-avatar">{user.initials}</span>
            <span>{user.name.split(" ")[0]}</span>
          </button>
        ) : (
          <button className="btn-nav" onClick={onSignIn}>Sign in →</button>
        )}
      </div>
    </nav>
  );
}

// ---------- Auth Modal ----------
function AuthModal({ onClose }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function signIn(asAdmin) {
    setUser({
      ...window.MFC_DATA.USER,
      role: asAdmin ? "admin" : "user",
    });
    onClose();
    if (asAdmin) navigate("/admin/recipes");
    else navigate("/dashboard");
  }

  function magic(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setSent(true);
    setTimeout(() => signIn(false), 900);
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "28px 28px 20px", borderBottom: "1px dashed var(--rule-strong)" }}>
          <div className="eyebrow-comment" style={{ marginBottom: 8 }}>welcome back</div>
          <h3 style={{ fontFamily: "var(--sans)", fontWeight: 500, fontSize: 26, lineHeight: 1.1, letterSpacing: "-0.025em", marginBottom: 8 }}>
            Sign in to <em style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontWeight: 400, color: "var(--orange)" }}>MyFoodCraving</em>
          </h3>
          <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 16, color: "var(--ink-soft)", lineHeight: 1.4 }}>
            Save recipes, sync your markers, and pick up cooking right where you left off.
          </p>
        </div>

        {sent ? (
          <div style={{ padding: 28, textAlign: "center" }}>
            <div className="footer-scribble" style={{ fontSize: 32, marginBottom: 8 }}>✎</div>
            <p style={{ fontFamily: "var(--serif)", fontStyle: "italic", fontSize: 18, color: "var(--ink-soft)" }}>
              Check <b>{email}</b> for a sign-in link.
            </p>
            <p style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--ink-faint)", marginTop: 14, letterSpacing: "0.06em" }}>
              signing you in…
            </p>
          </div>
        ) : (
          <div style={{ padding: 24 }}>
            <button
              className="btn"
              onClick={() => signIn(false)}
              style={{ width: "100%", marginBottom: 10 }}
            >Continue with Google</button>
            <button
              className="btn"
              disabled
              style={{ width: "100%", marginBottom: 16, opacity: 0.5, cursor: "not-allowed" }}
              title="Coming soon"
            >Continue with Apple</button>
            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "18px 0", color: "var(--ink-faint)" }}>
              <hr style={{ flex: 1, border: "none", borderTop: "1px dashed var(--rule-strong)" }} />
              <span className="eyebrow" style={{ fontSize: 10 }}>or magic link</span>
              <hr style={{ flex: 1, border: "none", borderTop: "1px dashed var(--rule-strong)" }} />
            </div>
            <form onSubmit={magic}>
              <input
                ref={inputRef}
                className="input"
                type="email"
                placeholder="you@kitchen.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <button
                type="submit"
                className="btn primary"
                style={{ width: "100%", marginTop: 10 }}
              >Send sign-in link →</button>
            </form>
            <p style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-faint)", textAlign: "center", marginTop: 16, letterSpacing: "0.06em" }}>
              // demo: <a href="#" onClick={(e) => { e.preventDefault(); signIn(true); }} style={{ color: "var(--orange)" }}>sign in as admin</a>
            </p>
          </div>
        )}
        <button
          onClick={onClose}
          style={{ position: "absolute", top: 16, right: 16, fontSize: 18, color: "var(--ink-muted)", padding: 6 }}
          aria-label="Close"
        >✕</button>
      </div>
    </div>
  );
}

// ---------- Footer ----------
function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-inner">
          <a className="brand" href="#/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>
            <BrandMark size={32} />
            <span className="brand-name" style={{ fontSize: 18 }}>MyFood<em>Craving</em></span>
          </a>
          <p className="footer-tag">Cook well, live well — a kitchen that knows what your body needs.</p>
        </div>
        <div className="footer-bottom">
          <span>© 2026 · Infroid Technologies</span>
          <span className="footer-scribble">made with care in Bengaluru</span>
          <span>v 2.4.0</span>
        </div>
      </div>
    </footer>
  );
}

// Export to global so other JSX files can use these
window.MFC_CHROME = { Nav, Footer, AuthModal, BrandMark, useUser, setUser, useRoute, navigate, parseRoute };
