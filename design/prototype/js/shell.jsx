/* Shared shell components for the MFC unified prototype. */

const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ─── App nav (cream nav rendered inside each page) ──────────────────
function AppNav({ active = "recipes", role = "user", userName = "alex" }) {
  const links = [
    { id: "home", label: "Home", href: "#index" },
    { id: "recipes", label: "Recipes", href: "#recipe-search" },
    { id: "dashboard", label: "Dashboard", href: "#dashboard" },
    { id: "markers", label: "Health markers", href: "#markers" },
  ];
  const ctx = role === "admin" ? "admin"
            : role === "chef"  ? "chef"
            : null;
  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        <a className="brand-mark" href="#index" aria-label="MyFoodCraving">m</a>
        <span className="brand-name">MyFoodCraving</span>
        <div className="app-nav-links">
          {links.map(l => (
            <a key={l.id} className={"app-nav-link" + (active === l.id ? " active" : "")} href={l.href}>{l.label}</a>
          ))}
        </div>
        {ctx && <span className={"context-tag " + ctx}>{ctx} mode</span>}
        <div className="app-nav-user">
          <span className="name">{userName}</span>
          <span className="avatar">{userName.charAt(0)}</span>
        </div>
      </div>
    </nav>
  );
}

// ─── Page header ────────────────────────────────────────────────────
function PageHeader({ eyebrow, title, sub, actions, breadcrumb }) {
  return (
    <div>
      {breadcrumb && (
        <div className="breadcrumb">
          {breadcrumb.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="sep">›</span>}
              {b.href ? <a href={b.href}>{b.label}</a> : <span className="current">{b.label}</span>}
            </React.Fragment>
          ))}
        </div>
      )}
      <div className="page-header">
        <div>
          {eyebrow && <div className="card-eyebrow" style={{ marginBottom: 8 }}>{eyebrow}</div>}
          <h1 className="page-header-title" dangerouslySetInnerHTML={{ __html: title }} />
          {sub && <div className="page-header-sub">{sub}</div>}
        </div>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
    </div>
  );
}

// ─── Edit pill ──────────────────────────────────────────────────────
function EditPill({ children = "Edit", required = false, empty = false, onClick }) {
  const cls = "edit-pill" + (required && empty ? " required-empty" : "");
  return (
    <button type="button" className={cls} onClick={onClick}>
      <span className="pencil">✎</span>{children}
    </button>
  );
}

// ─── Completion ring ────────────────────────────────────────────────
function CompletionRing({ pct = 0, size = 64, stroke = 7 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  const tone = pct >= 80 ? "high" : pct >= 50 ? "mid" : "low";
  return (
    <div className="completion-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle className="track" cx={size/2} cy={size/2} r={r} style={{ strokeWidth: stroke }} />
        <circle className={"meter " + tone} cx={size/2} cy={size/2} r={r}
          style={{ strokeWidth: stroke }}
          strokeDasharray={c} strokeDashoffset={off} />
      </svg>
      <span className="pct" style={{ fontSize: Math.max(8, Math.round(size * 0.32)) + "px" }}>
        {pct === 100 ? "✓" : pct + "%"}
      </span>
    </div>
  );
}

// ─── Publish bar ────────────────────────────────────────────────────
function PublishBar({ pct, missing = [], status = "draft", onPublish, label = "Recipe" }) {
  const ready = missing.length === 0;
  return (
    <div className="publish-bar">
      <CompletionRing pct={pct} />
      <div className="publish-bar-text">
        <b>{label} · {ready ? "ready to publish" : "needs a few details"}</b>
        <div className="meta">
          status: <span style={{ color: status === "published" ? "var(--matcha-deep)" : "var(--ink)" }}>{status}</span> · {pct}% complete
        </div>
        {missing.length > 0 && (
          <div className="warn-list">
            {missing.map(m => <span key={m} className="warn-pill">{m}</span>)}
          </div>
        )}
      </div>
      <div className="publish-bar-actions">
        <button className="btn btn-ghost btn-sm">Preview</button>
        <button
          className={"btn btn-orange" + (ready ? "" : " disabled")}
          disabled={!ready}
          onClick={onPublish}
        >{status === "published" ? "Update" : "Publish"} →</button>
      </div>
    </div>
  );
}

// ─── Toolbar ────────────────────────────────────────────────────────
function Toolbar({ children }) {
  return <div className="toolbar">{children}</div>;
}
function SearchInput({ value, onChange, placeholder = "Search…" }) {
  return (
    <div className="toolbar-search">
      <span className="ico">⌕</span>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
      {value && <button className="ico" onClick={() => onChange("")}>×</button>}
    </div>
  );
}
function Segment({ value, onChange, options }) {
  return (
    <div className="toolbar-segment">
      {options.map(o => (
        <button key={o.value} className={value === o.value ? "active" : ""}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// ─── Pagination ─────────────────────────────────────────────────────
function Pagination({ page, pageCount, total, onChange, perPage }) {
  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);
  const pages = [];
  const window2 = 2;
  for (let i = 1; i <= pageCount; i++) {
    if (i === 1 || i === pageCount || (i >= page - window2 && i <= page + window2)) pages.push(i);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }
  return (
    <div className="pagination">
      <span>{start}–{end} of {total}</span>
      <div className="pagination-pages">
        <button className={"pg-btn" + (page === 1 ? " disabled" : "")}
          onClick={() => page > 1 && onChange(page - 1)}>‹</button>
        {pages.map((p, i) => p === "…"
          ? <span key={i} style={{ padding: "0 4px" }}>…</span>
          : <button key={i} className={"pg-btn" + (p === page ? " active" : "")}
              onClick={() => onChange(p)}>{p}</button>)}
        <button className={"pg-btn" + (page === pageCount ? " disabled" : "")}
          onClick={() => page < pageCount && onChange(page + 1)}>›</button>
      </div>
    </div>
  );
}

// ─── Tag chip ───────────────────────────────────────────────────────
function TagChip({ tone = "", children }) {
  return <span className={"tag-chip " + tone}>{children}</span>;
}

// ─── Image placeholder ──────────────────────────────────────────────
function ImgPh({ label, ratio = "16/9", className = "", style = {} }) {
  return (
    <div className={"img-ph " + className} style={{ aspectRatio: ratio, ...style }}>
      [{label}]
    </div>
  );
}

// ─── Side nav (admin shell) ─────────────────────────────────────────
function SideNav({ active, items, sectionLabel = "Library" }) {
  return (
    <aside className="side-nav">
      <div className="side-nav-section">{sectionLabel}</div>
      {items.map(it => (
        <a key={it.id} className={"side-nav-link" + (active === it.id ? " active" : "")} href={it.href || "#"}>
          <span className="ico">{it.icon}</span>
          <span>{it.label}</span>
          {it.count != null && <span className="count">{it.count}</span>}
        </a>
      ))}
    </aside>
  );
}

// ─── Toast ──────────────────────────────────────────────────────────
function useToast() {
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 1800);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, setMsg];
}

// expose
Object.assign(window, {
  AppNav, PageHeader, EditPill, CompletionRing, PublishBar,
  Toolbar, SearchInput, Segment, Pagination, TagChip, ImgPh, SideNav, useToast,
});
