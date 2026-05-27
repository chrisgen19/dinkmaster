# Google sign-in setup

DinkMaster supports signing in / registering with Google via Better Auth,
alongside email + password. Google is only turned on when **both** of its
environment variables are set, so deployments without credentials simply hide
the button.

```env
# .env (gitignored)
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
```

The OAuth **redirect (callback) URL** is fixed by Better Auth:

```text
<BETTER_AUTH_URL>/api/auth/callback/google
```

For local dev (`BETTER_AUTH_URL=http://localhost:3020`):

| Provider | Redirect URI |
| --- | --- |
| Google | `http://localhost:3020/api/auth/callback/google` |

For production, set `BETTER_AUTH_URL` to your real origin and whitelist
`https://YOUR_DOMAIN/api/auth/callback/google` in the Google Cloud Console.

---

## Google (Google Cloud Console)

1. Go to <https://console.cloud.google.com> and create or select a project.
2. **APIs & Services → OAuth consent screen**
   - User type **External**.
   - Fill app name, user support email, developer contact email.
   - Scopes: `email`, `profile`, `openid`.
   - While the screen is in **Testing**, add your Google account under
     **Test users** (otherwise sign-in is blocked for non-test accounts).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**.
   - **Authorized JavaScript origins:** `http://localhost:3020`
   - **Authorized redirect URIs:** `http://localhost:3020/api/auth/callback/google`
4. Copy the **Client ID** → `GOOGLE_CLIENT_ID` and **Client secret** →
   `GOOGLE_CLIENT_SECRET` into `.env`.

---

## Account linking & a caveat about email verification

When someone signs in with Google and the Google email matches an existing
account, Better Auth links them into one account — but only when the
**local account's email is verified** (the secure default,
`requireLocalEmailVerified`). This prevents an attacker from pre-registering
an unverified account at someone else's email and hijacking their OAuth
identity.

This app does **not** currently verify emails (password sign-ups have
`emailVerified: false`). Consequence:

- New users via Google → works.
- Users who only ever use Google → works.
- An **existing email/password user** whose email matches their Google login
  will **not** be auto-linked — Better Auth redirects to
  `/api/auth/error?error=account_not_linked`. They should keep signing in
  with their password.

### Unblocking an existing account (`account_not_linked`)

Because the gate checks the **local** account's `emailVerified`, the safe way
to let a specific existing password account link to Google is to mark that
account's email verified, then sign in with Google:

```sh
# one-off, per account — keeps requireLocalEmailVerified secure for everyone else
psql "$DATABASE_URL" -c \
  "UPDATE \"User\" SET \"emailVerified\" = true WHERE email = 'you@example.com';"
```

On the next Google sign-in Better Auth links the provider into that account
(and leaves `emailVerified` true).

If you later want this to be self-service, the proper paths are an
authenticated "Link Google" action (from `/profile`, using
`authClient.linkSocial`) and/or a real email-verification flow — both tracked
as follow-ups.

---

## How it's wired (for maintainers)

- `src/lib/auth.js` — builds `socialProviders` conditionally from env, maps
  the Google profile to `firstName`/`lastName` via `deriveNameParts`,
  configures `account.accountLinking`, and relaxes the required-name guard
  for social sign-ups (credential sign-ups on `/sign-up/email` stay strict).
- `src/lib/user-profile.js` — `deriveNameParts` and the `requireNames`
  option on `normalizeUserProfile`.
- `src/lib/social-providers.js` — the provider list + `visibleSocialProviders()`
  selector. Add an entry here (and an icon in `auth-shell.js`) to expose a
  new provider in the UI.
- `src/app/auth-shell.js` — `SocialAuthButtons`, rendered on `/login` and
  `/register`.
- No DB migration: the existing `Account` model already holds OAuth tokens.
