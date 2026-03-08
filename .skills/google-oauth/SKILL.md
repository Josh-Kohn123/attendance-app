---
name: google-oauth
description: >
  **Google OAuth Integration**: Setting up Google OAuth 2.0 (OIDC) authentication
  in Node.js/TypeScript web applications with a React frontend.
  - MANDATORY TRIGGERS: Google OAuth, Google sign-in, Google login, OIDC,
    Google authentication, social login with Google, Google SSO, "Sign in with Google",
    account picker, OAuth callback, Google Cloud Console OAuth setup
  - Use this skill whenever implementing or debugging Google OAuth flows, including
    building login pages, handling OAuth callbacks, fixing redirect loops, fixing
    account picker issues, or troubleshooting 401/429 errors related to auth.
  - Also trigger when the user mentions Google Cloud Console credentials, OAuth
    consent screens, or callback URL configuration.
---

# Google OAuth 2.0 Integration (Node.js + React)

This skill covers the full Google OAuth flow: Google Cloud Console setup, backend
redirect/callback endpoints, JWT session management, React auth state, and the
most common pitfalls encountered during development.

## Architecture Overview

```
Browser                    Your API                   Google
  │                          │                          │
  │  click "Sign in"         │                          │
  ├─────────────────────────>│                          │
  │                          │                          │
  │  302 redirect to Google  │                          │
  │<─────────────────────────│                          │
  │                          │                          │
  │  User picks account + consents                      │
  ├────────────────────────────────────────────────────>│
  │                          │                          │
  │  302 redirect to callback with ?code=...            │
  │<────────────────────────────────────────────────────│
  │                          │                          │
  ├─────────────────────────>│  exchange code for tokens │
  │                          ├─────────────────────────>│
  │                          │  { access_token, id_token }
  │                          │<─────────────────────────│
  │                          │                          │
  │                          │  fetch /userinfo          │
  │                          ├─────────────────────────>│
  │                          │  { email, name, picture } │
  │                          │<─────────────────────────│
  │                          │                          │
  │  302 redirect to frontend with ?token=<jwt>         │
  │<─────────────────────────│                          │
```

## Google Cloud Console Setup

Before writing any code, configure credentials in the Google Cloud Console:

1. Go to https://console.cloud.google.com/apis/credentials
2. Create an OAuth 2.0 Client ID (Web application type)
3. Set **Authorized redirect URIs** to your callback URL(s):
   - Local dev: `http://localhost:3001/auth/google/callback`
   - Production: `https://yourdomain.com/auth/google/callback`
4. Copy the **Client ID** and **Client Secret** into your `.env`

The redirect URI must match *exactly* — including trailing slashes and protocol.
A mismatch produces Google's cryptic `redirect_uri_mismatch` error.

### Required env vars

```env
GOOGLE_CLIENT_ID="893433360385-xxxxx.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-xxxxxxxxxxxxxxxx"
GOOGLE_CALLBACK_URL="http://localhost:3001/auth/google/callback"
JWT_SECRET="change-me-to-a-strong-random-secret"
```

## Backend: The Two Endpoints

### 1. Redirect endpoint (`GET /auth/google`)

This endpoint builds the Google OAuth URL and redirects the browser to it.

**Critical: use `URLSearchParams` to build the URL.** Manually inserting `%20`
inside template literals risks double-encoding in frameworks like Fastify, which
causes Google to silently ignore parameters like `prompt` — leading to the account
picker not appearing even though the code looks correct.

```typescript
app.get("/auth/google", async (request, reply) => {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: process.env.GOOGLE_CALLBACK_URL
      ?? "http://localhost:3001/auth/google/callback",
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account consent",
    authuser: "-1",
    include_granted_scopes: "false",
  });

  return reply.redirect(
    `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  );
});
```

#### Why each parameter matters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `prompt` | `"select_account consent"` | Forces both the account picker AND the consent screen every time. Without `select_account`, Google auto-selects whichever account is the browser default. |
| `authuser` | `"-1"` | Google-specific parameter that bypasses cached account selection in the browser session. This is the most reliable account-picker enforcer. |
| `include_granted_scopes` | `"false"` | Prevents Google from silently reusing a previous session's scope grants, which can cause it to skip the picker. |
| `access_type` | `"offline"` | Returns a refresh token (useful if you need to call Google APIs later). |

### 2. Callback endpoint (`GET /auth/google/callback`)

Google redirects here with `?code=...` after the user consents.

**Declare shared variables once, at the top of the handler.** The callback
often needs `frontendUrl` (or similar) for both early-exit error redirects
(unregistered user, deactivated account) and the success redirect at the end.
Declare it once before any early-exit `return` statements — do not re-declare
it near the success path. Duplicate `const` declarations in the same scope
cause a compile-time `TransformError: symbol already declared` that crashes
the server at startup.

```typescript
app.get("/auth/google/callback", async (request, reply) => {
  const { code } = request.query as { code?: string };
  if (!code) {
    return reply.status(400).send({ error: "Missing authorization code" });
  }

  // Exchange code for tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: process.env.GOOGLE_CALLBACK_URL
        ?? "http://localhost:3001/auth/google/callback",
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();

  // Get user info
  const userInfoRes = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: `Bearer ${tokens.access_token}` } }
  );
  const userInfo = await userInfoRes.json();
  // userInfo = { sub, email, name, picture }

  // Find or create user in your DB, then generate a JWT
  const jwt = app.jwt.sign({
    sub: user.id,
    email: user.email,
    roles: user.roles,
  });

  // Redirect to frontend with the JWT
  const frontendUrl = process.env.CORS_ORIGIN ?? "http://localhost:5173";
  return reply.redirect(`${frontendUrl}/auth/callback?token=${jwt}`);
});
```

### Rate limiting: exempt auth routes

OAuth endpoints are browser redirects, not API calls. If they hit a rate limiter
they'll fail with a 429 before the user even reaches Google. Exempt them:

```typescript
// Per-route exemption (Fastify)
app.get("/auth/google", { config: { rateLimit: false } }, handler);
app.get("/auth/google/callback", { config: { rateLimit: false } }, handler);
```

In development, consider skipping rate limiting entirely — all requests come from
`127.0.0.1` so the per-IP bucket fills up fast:

```typescript
await app.register(rateLimit, {
  max: 300,
  timeWindow: "1 minute",
  skip: () => process.env.NODE_ENV !== "production",
});
```

## Frontend: React Auth Flow

### AuthProvider

The auth provider manages user state and exposes `login`, `logout`, and
`refetchUser` to the rest of the app.

Key design decisions and the reasons behind them:

**Don't call `/auth/me` when there's no token.** If `fetchUser` always fires on
mount (including the login page), it produces a 401 on every page load for
unauthenticated users. This is noisy in the console and wasteful.

**Never hard-redirect on 401 in the API client.** If the API client does
`window.location.href = "/login"` on a 401, and the auth provider calls
`/auth/me` on mount, you get an infinite reload loop:
mount → 401 → redirect → mount → 401 → redirect → ...
Instead, just clear the token and throw. Let React Router handle the redirect
based on `user === null` state.

**Expose `refetchUser` on context.** After the OAuth callback sets the token,
something needs to tell the auth provider to re-fetch user data. Without
`refetchUser`, the only way to update state is a full page reload.

```tsx
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = useCallback(() => {
    // No token = not logged in. Skip the request entirely.
    if (!localStorage.getItem("auth_token")) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    api.get("/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    // Fallback: check URL for token (in case of hard redirect flow)
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setToken(token);
      window.history.replaceState({}, "", window.location.pathname);
    }
    fetchUser();
  }, [fetchUser]);

  const login = () => {
    window.location.href = "/api/auth/google";
  };

  // Expose refetchUser so AuthCallback can trigger it
  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refetchUser: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}
```

### AuthCallback component

After Google redirects back with a JWT in the URL, this component stores the
token and updates auth state — all without a full page reload.

```tsx
export function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { refetchUser } = useAuth();

  useEffect(() => {
    const token = params.get("token");
    if (token) {
      setToken(token);
      refetchUser();                    // update auth state
      navigate("/", { replace: true }); // React Router, no reload
    } else {
      navigate("/login", { replace: true });
    }
  }, [params, navigate, refetchUser]);

  return <LoadingSpinner />;
}
```

**Prefer `navigate()` over `window.location.href`.** A hard redirect re-mounts
the entire app from scratch, briefly flashes a loading spinner, and wastes a
round-trip to `/auth/me`. React Router navigation is instant.

### API client: 401 handling

The API client should clear the token on 401 but NOT redirect. The routing
layer handles showing the login page when `user` is null.

```typescript
if (res.status === 401) {
  clearToken();
  // Do NOT do: window.location.href = "/login"
  // That causes an infinite reload loop (see AuthProvider section above)
  throw new Error("Unauthorized");
}
```

### App routing (unauthenticated state)

When `user` is null, render only public routes. The wildcard redirect to `/login`
is handled by React Router — no hard page reloads involved.

```tsx
if (!user) {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
```

## Monorepo: Environment Variable Loading

In a monorepo (npm/pnpm/yarn workspaces), each package runs from its own
directory. A `.env` file at the repo root is invisible to packages like
`apps/api/` or `packages/db/`.

### For Node.js apps (API server, worker)

Use Node's built-in `--env-file` flag (Node 20.6+):

```json
{
  "scripts": {
    "dev": "tsx watch --env-file=../../.env src/server.ts"
  }
}
```

The relative path goes from the package directory up to the repo root.

### For Prisma

Prisma looks for `.env` in the directory containing `schema.prisma`. Create a
separate `.env` in `packages/db/` with just `DATABASE_URL`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/mydb?schema=public"
```

Add this to `.gitignore` (the root `.env` pattern usually covers it).

### For Vite (frontend)

Vite loads `.env` from the project root automatically. For API calls, use a
Vite proxy to forward `/api` requests to the backend:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
```

The frontend API client then uses `/api` as its base URL, and the proxy strips
the prefix before forwarding to the backend.

## Common Pitfalls Checklist

When debugging Google OAuth issues, work through this list:

| Symptom | Cause | Fix |
|---------|-------|-----|
| `invalid_request: Missing required parameter: client_id` | Env vars not loaded — `GOOGLE_CLIENT_ID` is undefined | Add `--env-file=../../.env` to the dev script (monorepo) |
| Account picker doesn't appear | Missing `prompt=select_account` or double-encoded URL | Use `URLSearchParams` + `authuser=-1` |
| 429 on `/auth/google` | Rate limiter blocking OAuth redirects | Exempt auth routes from rate limiting |
| Login page infinite reload loop | API client does `window.location.href="/login"` on 401, AuthProvider calls `/auth/me` on mount | Remove hard redirect from 401 handler; let React Router handle it |
| Console 401 error on login page (before clicking anything) | `/auth/me` called even when there's no token | Guard `fetchUser` — skip if no token in localStorage |
| `redirect_uri_mismatch` | Callback URL doesn't match Google Console config exactly | Check protocol, port, trailing slash, and path |
| User stays on loading spinner after OAuth | AuthCallback does `window.location.href` instead of `navigate()`, or doesn't call `refetchUser` | Use React Router `navigate()` + call `refetchUser()` after setting token |
| OAuth works once then fails on retry | `prompt=consent` without `select_account` — Google caches the consent | Add `select_account` to `prompt` parameter |
| `TransformError: symbol "frontendUrl" already declared` on startup | When refactoring the callback to add early-exit redirects (e.g. for unregistered users), a second `const frontendUrl` is easy to introduce at the bottom of the same function | Hoist `frontendUrl` to a single `const` before all the early-exit checks, then delete any later re-declarations |

## Security Notes

- Never expose `GOOGLE_CLIENT_SECRET` to the frontend. The initial redirect
  only needs the Client ID. The secret is only used server-side during the
  code-for-token exchange.
- Store JWTs in `localStorage` for SPAs (simpler), or `httpOnly` cookies
  (more secure against XSS). The tradeoff depends on your threat model.
- Set reasonable JWT expiry (e.g., 8 hours for a workday app).
- In production, always use HTTPS for callback URLs.
