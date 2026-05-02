# Security & Privacy

> Threat model, controls, PII inventory, and compliance posture for the dynamic stack.

---

## Threat Model — Highlights

| Threat | Vector | Control |
|--------|--------|---------|
| **Account takeover** | Phished password / leaked DB | Bcrypt cost 12; MFA-by-OAuth (Google/Apple); refresh-rotation reuse-detection forces global sign-out; rate-limit on `/auth/login` |
| **Session hijack via XSS** | Compromised script | httpOnly + Secure + SameSite=Strict cookies; strict CSP; no inline event handlers; SRI on all CDN scripts |
| **CSRF** | Cross-origin form post | Double-submit token (`mfc_csrf` cookie + `X-CSRF-Token` header) on every state-changing endpoint |
| **OAuth code injection / state mismatch** | Replayed `?code=` | One-shot state nonce in Redis with 5-min TTL |
| **Token theft from refresh reuse** | Stolen refresh cookie | Rotation: every refresh issues new pair + revokes old. Reuse of revoked refresh → revoke ALL sessions for user + Sentry alert |
| **Email enumeration** | `/forgot-password` reveal | Always returns 204, regardless of email existence |
| **Mass scraping** | Anonymous brute force on recipes | Per-IP rate limits at Cloudflare edge + app layer; CDN absorbs hot cache |
| **SQL injection** | Crafted query params | Parameterized queries via SQLAlchemy; no f-string SQL anywhere; CI grep gate |
| **SSRF via image upload** | User-supplied URL | Image uploads come from authenticated import flows only; no user-fetched URLs in V1 |
| **Stored XSS via reviews** | `review` text in `recipe_ratings` | Server stores plain text; frontend renders via `{text}` (React escapes); Markdown disabled |
| **Privilege escalation** | Forging user IDs in path | All user-scoped endpoints derive `user_id` from JWT, never from request path/body |
| **Mass-assignment on /preferences** | Inject sensitive keys | Allowlist of key prefixes (`tweak.*`, `cook.*`, `pref.*`); reject unknown keys |
| **DoS via recommendation cost** | Repeated re-toggle of metrics | Per-user write rate limit + Redis-cached recommendations |
| **Replay of merge-anonymous** | Repeat POST after sign-in | Single allowed call per session (Redis flag); subsequent calls 409 |

---

## PII Inventory

| Field | Where stored | Purpose | Retention |
|-------|--------------|---------|-----------|
| `email` | `users.email` | Sign-in, transactional email | Soft-delete + 30 days, then purge |
| `name` | `users.name` | UI display | Same as above |
| `avatar_url` | `users.avatar_url` | UI display (OAuth avatars are external URLs) | Same as above |
| `password_hash` | `users.password_hash` | Auth (bcrypt) | Same as above |
| `oauth_identities.email_at_link` | provider-supplied | Diagnostic, not used for auth | Same as above |
| `auth_sessions.ip_inet` / `user_agent` | session table | "Where am I signed in" UX | 60 days |
| `audit_events.payload` | append-only | Debugging, abuse forensics | 13 months |
| `health_metrics.value` (sensitive!) | per profile | Personalization | Until user deletes; export-on-request |
| `recipe_ratings.review` | rating | Public display (signed with user name) | Until user deletes their account or rating |

> Health metric values are the most sensitive PII the system holds. They are encrypted at rest by the DB provider; access is restricted to the user themselves and admin-break-glass with audit log.

---

## Encryption

| Data state | Mechanism |
|------------|-----------|
| In transit | TLS 1.3 (Cloudflare-terminated; backhaul to Fly via mTLS or Fly proxy) |
| At rest (DB) | AES-256 disk encryption (Supabase default) |
| At rest (object storage) | AES-256 server-side (Supabase Storage default) |
| Refresh tokens | Stored as sha256 hash; raw never persisted |
| Passwords | Bcrypt cost 12 |
| JWT signing | RS256 (asymmetric) — public key shared with verification middleware, private only on auth issuer |
| OAuth state nonces | Redis with 5-min TTL; single-use |
| Backup snapshots | Encrypted with KMS-managed keys |

JWT keypair rotates every 90 days with a 7-day overlap window where both old and new keys verify. OAuth client secrets rotate annually or on incident.

---

## Authentication Flow Specifics

### Cookies

| Name | Attributes | Contents |
|------|-----------|----------|
| `mfc_access_token` | `HttpOnly; Secure; SameSite=Strict; Path=/api/v1; Max-Age=900` | RS256 JWT with `{ sub, exp, iat, ver }` |
| `mfc_refresh_token` | `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=2592000` | Opaque random 256-bit string |
| `mfc_csrf` | `Secure; SameSite=Strict; Max-Age=86400` (no HttpOnly) | Random 256-bit string; readable by JS |

### CSRF Verification

For every `POST/PUT/PATCH/DELETE` to `/api/v1`:

1. Server reads `mfc_csrf` cookie.
2. Reads `X-CSRF-Token` header.
3. Constant-time compare. Mismatch → 403.

The frontend `shared/api.js` wrapper attaches the header automatically.

### Refresh-Token Rotation Pseudocode

```python
async def refresh(refresh_cookie: str, db: AsyncSession) -> AuthResult:
    h = sha256(refresh_cookie)
    session = await db.get_session_by_hash(h)
    if not session:
        raise InvalidToken
    if session.revoked_at:
        # REUSE — assume token theft
        await db.revoke_all_user_sessions(session.user_id)
        publish("auth.refresh_reuse_detected", {"user_id": session.user_id})
        raise SessionRevoked
    if session.expires_at < now():
        raise ExpiredToken

    new_refresh = secrets.token_urlsafe(48)
    await db.create_session(user_id=session.user_id, refresh_hash=sha256(new_refresh), ...)
    session.revoked_at = now()
    await db.commit()
    return issue_access_token(session.user_id), new_refresh
```

---

## Content Security Policy

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' https://unpkg.com https://cdn.jsdelivr.net 'sha256-...inline-bootstrap...';
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' https://fonts.gstatic.com;
  img-src 'self' data: https://cdn.myfoodcraving.com https://lh3.googleusercontent.com https://appleid.cdn-apple.com;
  connect-src 'self';
  frame-ancestors 'self';
  base-uri 'self';
  form-action 'self';
  upgrade-insecure-requests
```

Notes:
- `unpkg.com` + `jsdelivr.net` cover React + Babel Standalone (existing). Lock to specific versions and use SRI.
- Inline `<script type="text/babel">` blocks are exempt from CSP via per-block sha256 in `script-src`. Each HTML page's bootstrap is hashed at deploy.
- `'unsafe-inline'` for `style-src` is currently required because Babel-compiled JSX uses inline `style={...}` props; this is a known compromise. Consider stripping inline styles in V2.

---

## Other Security Headers

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

`Permissions-Policy` denies unused features that the recipe site never requests (no camera, mic, geo).

---

## GDPR / Privacy Compliance

| Right | Implementation |
|-------|----------------|
| **Access** | `GET /api/v1/account/export` streams a JSON archive of all user data |
| **Rectification** | `PATCH` endpoints allow self-edit of name/email/health data |
| **Erasure** | `DELETE /api/v1/auth/account` soft-deletes immediately; hard-purge job runs nightly after 30-day grace |
| **Portability** | Export above is a structured JSON; documented schema |
| **Objection / Restriction** | User can deactivate health metrics individually; account deletion is the hard stop |
| **Data minimization** | OAuth-only users get `email = NULL` if Apple private-relay; no mandatory profile fields beyond name |
| **Consent for analytics** | No third-party analytics (no GA, no Mixpanel) in V1; only first-party `audit_events` for ops |
| **Children** | T&Cs gate at 13+; no special handling beyond that in V1 |

`docs/PRIVACY.md` is published on the marketing site and reviewed quarterly.

### Hard-delete script

```sql
-- Runs in nightly job; tx wraps all
BEGIN;
DELETE FROM mfc.cooking_sessions WHERE user_id IN (SELECT id FROM mfc.users WHERE deleted_at < now() - INTERVAL '30 days');
-- Most relations cascade via FK ON DELETE CASCADE
DELETE FROM mfc.users WHERE deleted_at < now() - INTERVAL '30 days';
COMMIT;
```

`audit_events.user_id` is set to NULL on user delete (FK `ON DELETE SET NULL`) so historical events remain anonymized.

---

## Rate Limit Strategy

Sliding-window counters in Redis. Keys:

```
rl:auth:login:{ip}      → 5 / 60s
rl:auth:signup:{ip}     → 3 / 60s
rl:read:{ip}            → 60 / 60s
rl:write:{user_id}      → 30 / 60s
rl:health:sync:{user_id}→ 10 / 60s
rl:export:{user_id}     → 1 / 3600s
```

429 response includes `Retry-After: <seconds>`. For abusive sustained traffic, Cloudflare Firewall rules promote the IP to a longer ban.

---

## Audit Logging

Every security-relevant event writes a row to `audit_events` AND a structured log line:

| Event | Trigger |
|-------|---------|
| `auth.signup` | Successful signup |
| `auth.login.success` | Login |
| `auth.login.fail` | Bad credential |
| `auth.refresh.success` | Refresh |
| `auth.refresh.reuse_detected` | Reuse of revoked refresh |
| `auth.password_reset.requested` | Forgot-password |
| `auth.password_reset.completed` | Reset |
| `auth.account.deleted` | Soft delete |
| `auth.account.purged` | Hard purge |
| `auth.session.revoked` | Manual revoke |
| `health.metric.toggled` | Toggle |
| `health.metric.value_changed` | Numeric change |
| `meal_plan.entry.created` | |
| `account.export.requested` | GDPR export |

`audit_events` is append-only (no UPDATE/DELETE permissions for app role; only the daily compaction job has DELETE).

---

## Incident Response Outline

1. **Detect** — Sentry / Better Stack alert OR external report.
2. **Triage** — `incident-template.md` opened in `docs/incidents/YYYY-MM-DD-...md`.
3. **Contain** — depending on class:
   - Cred leak: rotate JWT keypair, force-revoke all sessions.
   - Data leak: notify users within 72 h (GDPR).
   - DDoS: Cloudflare under-attack mode; whitelist known good IPs.
4. **Eradicate** — patch root cause; deploy.
5. **Recover** — bring affected services back; communicate.
6. **Postmortem** — within 7 days of incident close, blameless writeup; action items tracked.

A breach-notification template lives at `docs/runbooks/breach-notification.md`. Legal contact + DPA on file.

---

## Pre-Launch Security Checklist

- [ ] All `npm`/`pip` deps pinned + scanned (`pip-audit`, `npm audit`).
- [ ] OWASP ZAP automated scan against staging — zero high findings.
- [ ] Manual pentest of auth flow (sign-up, login, refresh rotation, OAuth).
- [ ] CSP shipped in report-only mode for ≥ 7 days; zero violations from real traffic.
- [ ] Backups verified by restoring to a temp instance.
- [ ] Account-delete + GDPR-export tested end-to-end.
- [ ] DPA signed with each subprocessor (Supabase, Fly, Cloudflare, Resend, Sentry, Better Stack).
- [ ] Cookie consent — V1 uses only strictly-necessary cookies (auth, CSRF). No banner required under EU rules (verify with counsel).
- [ ] Sentry PII scrubbing rules verified (no `email`, `password`, `value`, `health` in event bodies).
