// Admin shared components — shell, sidebar, topbar, save bar, form primitives.
// All components are exposed on `window` so each admin app can reuse them.
const { useState, useEffect, useRef, useMemo } = React;

// ============================================================
// SIDEBAR
// ============================================================
function AdminSidebar({ active, counts = {} }) {
  const items = [
    { group: "Library", entries: [
      { id: "recipes",     icon: "✦", label: "Recipes",     href: "admin-recipes.html",     count: counts.recipes },
      { id: "ingredients", icon: "◐", label: "Ingredients", href: "admin-ingredients.html", count: counts.ingredients },
      { id: "utensils",    icon: "▣", label: "Utensils",    href: "admin-utensils.html",    count: counts.utensils },
    ]},
    { group: "Site", entries: [
      { id: "view-site", icon: "↗", label: "View site",  href: "index.html" },
      { id: "search",    icon: "⌕", label: "Recipe search", href: "recipe-search.html" },
    ]},
  ];

  async function signOut() {
    if (window.MFC?.supabase) await window.MFC.supabase.auth.signOut();
    location.href = "index.html";
  }

  return (
    <aside className="admin-side">
      <a href="index.html" className="admin-brand">
        <span className="brand-mark">m</span>
        <span className="brand-name">my<em>food</em>craving</span>
        <span className="admin-tag">admin</span>
      </a>
      {items.map((g) => (
        <div key={g.group} className="admin-nav-group">
          <div className="admin-nav-label">{g.group}</div>
          {g.entries.map((e) => (
            <a key={e.id} href={e.href} className={"admin-nav-item" + (active === e.id ? " active" : "")}>
              <span className="ic">{e.icon}</span>
              <span>{e.label}</span>
              {e.count !== undefined && <span className="count">{e.count}</span>}
            </a>
          ))}
        </div>
      ))}
      <div className="admin-side-foot">
        <div className="admin-avatar">A</div>
        <div className="who"><b>Admin</b><span>signed in</span></div>
        <button
          onClick={signOut}
          style={{ marginLeft: "auto", background: "transparent", border: "1px solid rgba(255,252,243,0.18)", color: "var(--cream-deep)", borderRadius: 6, padding: "4px 8px", fontSize: 11, cursor: "pointer" }}
        >sign out</button>
      </div>
    </aside>
  );
}

// ============================================================
// TOPBAR
// ============================================================
function AdminTopbar({ crumb, status, savedAgo, onPreview, onPublish, isNew, publishLabel }) {
  return (
    <div className="admin-topbar">
      <div className="admin-crumb">
        <a href="index.html">Admin</a>
        {crumb.map((c, i) => (
          <React.Fragment key={i}>
            <span className="sep">›</span>
            {i === crumb.length - 1
              ? <span className="current">{c.label}</span>
              : <a href={c.href || "#"}>{c.label}</a>}
          </React.Fragment>
        ))}
      </div>
      <div className="admin-topbar-spacer" />
      {status && (
        <span className={"admin-status " + status}>
          <span className="dot" />
          {status === "draft" ? "Draft" : status === "live" ? "Live" : "Archived"}
        </span>
      )}
      {savedAgo && (
        <span className="admin-saved">
          <span className="check">✓</span>
          Auto-saved {savedAgo}
        </span>
      )}
      <div className="admin-actions">
        {onPreview && <button className="btn-sm ghost" onClick={onPreview}>Preview</button>}
        {onPublish && <button className="btn-sm primary" onClick={onPublish}>{publishLabel || (isNew ? "Publish" : "Update")}</button>}
      </div>
    </div>
  );
}

// ============================================================
// SAVE BAR
// ============================================================
function SaveBar({ dirty, busy, onDiscard, onSaveDraft, onPublish, isNew, error }) {
  return (
    <div className="save-bar">
      <div className="info">
        {dirty && <span className="dirty-dot" />}
        <span>
          {error ? <span style={{ color: "var(--berry)" }}>Error: {error}</span>
            : busy ? "Saving…"
            : dirty ? "Unsaved changes"
            : "All changes saved"}
        </span>
      </div>
      <div className="actions">
        {onDiscard && <button className="btn-sm ghost" onClick={onDiscard} disabled={busy}>Discard</button>}
        {onSaveDraft && <button className="btn-sm" onClick={onSaveDraft} disabled={busy}>Save draft</button>}
        <button className="btn-sm primary" onClick={onPublish} disabled={busy || !dirty}>
          {isNew ? "Publish recipe →" : "Update & republish →"}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// FORM TABS
// ============================================================
function FormTabs({ tabs, active, onChange }) {
  return (
    <div className="form-tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={"form-tab" + (active === t.id ? " active" : "")}
          onClick={() => onChange(t.id)}
        >
          {t.label}
          {t.badge !== undefined && <span className="badge">{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}

// ============================================================
// FORM CARD
// ============================================================
function FormCard({ title, stepNo, scribble, headRight, children }) {
  return (
    <section className="form-card">
      <div className="form-card-head">
        <h3>
          {stepNo && <span className="step-no">{stepNo}</span>}
          {title}
        </h3>
        {scribble && <span className="scribble-note">{scribble}</span>}
        {headRight}
      </div>
      <div className="form-card-body">{children}</div>
    </section>
  );
}

// ============================================================
// FIELD
// ============================================================
function Field({ label, required, hint, help, children }) {
  return (
    <div className="field">
      <div className="field-label">
        <span>{label}</span>
        {required && <span className="req">*</span>}
        {help && <span className="help">{help}</span>}
      </div>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function RadioPills({ value, options, onChange }) {
  return (
    <div className="radio-pills">
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return (
          <button
            key={v}
            type="button"
            className={"pill" + (value === v ? " active" : "")}
            onClick={() => onChange(v)}
          >{l}</button>
        );
      })}
    </div>
  );
}

function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      className={"toggle" + (value ? " on" : "")}
      onClick={() => onChange(!value)}
    />
  );
}

function ToggleRow({ name, desc, value, onChange }) {
  return (
    <div className="toggle-row">
      <div className="copy">
        <div className="name">{name}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <Toggle value={value} onChange={onChange} />
    </div>
  );
}

function ChipInput({ tags, onAdd, onRemove, placeholder = "Add tag…", color }) {
  const [draft, setDraft] = useState("");
  function commit() {
    const v = draft.trim();
    if (v) { onAdd(v); setDraft(""); }
  }
  return (
    <div className="chip-input">
      {tags.map((t, i) => (
        <span key={i} className={"tag " + (color || "")}>
          {t}
          <span className="x" onClick={() => onRemove(i)}>×</span>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
          else if (e.key === "Backspace" && !draft && tags.length) onRemove(tags.length - 1);
        }}
        onBlur={commit}
        placeholder={placeholder}
      />
    </div>
  );
}

function Uploader({ filename, size, caption, hint, onClear }) {
  if (filename) {
    return (
      <div className="uploader has-image">
        <div className="uploader-img" />
        <div className="uploader-meta">
          <div>
            <div className="name">{filename}</div>
            {size && <div className="size">{size}</div>}
          </div>
          <span className="replace" onClick={onClear}>Replace</span>
        </div>
      </div>
    );
  }
  return (
    <div className="uploader">
      <div className="uploader-glyph">↑</div>
      <div className="uploader-title">{caption || "Drop a photo here"}</div>
      <div className="uploader-hint">{hint || "PNG / JPG · 1600×1200 recommended"}</div>
    </div>
  );
}

function PreviewFrame({ url, tabs = ["Desktop", "Mobile"], children }) {
  const [tab, setTab] = useState(tabs[0]);
  return (
    <div className="preview-frame">
      <div className="preview-bar">
        <span className="dots"><span /><span /><span /></span>
        <span className="url">myfoodcraving.com{url}</span>
        <div className="pv-tabs">
          {tabs.map((t) => (
            <button key={t} className={"pv-tab" + (tab === t ? " active" : "")} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
      </div>
      <div className="preview-body">{children}</div>
    </div>
  );
}

// ============================================================
// helper: "Asha" → "asha", "ginger garlic paste" → "ginger-garlic-paste"
// ============================================================
function slugify(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

Object.assign(window, {
  AdminSidebar, AdminTopbar, SaveBar, FormTabs, FormCard, Field,
  RadioPills, Toggle, ToggleRow, ChipInput, Uploader, PreviewFrame,
  slugify,
});
