# Deploy DataX to Vercel + MongoDB Atlas

This app needs **one server environment variable**: `MONGODB_URI`.

Seller/buyer **API keys** (`dx_…`) are **created in the app** and stored in MongoDB — you do **not** put them in Vercel env vars.

---

## 1. MongoDB Atlas

1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas) and sign in (or create a free M0 cluster).
2. **Create a database user** (Database Access → Add user):
   - Authentication: password.
   - Save the username and password somewhere safe.
3. **Network Access** (Network Access → Add IP Address):
   - For Vercel serverless, outbound IPs are not fixed. Use **`0.0.0.0/0`** (allow from anywhere) for the MVP, or tighten later with [Atlas IP / Vercel](https://www.mongodb.com/docs/atlas/security/ip-access-list/) if you move to a dedicated setup.
4. **Connection string** (Database → Connect → Drivers):
   - Choose **Node.js**, driver 6.x compatible.
   - Replace `<password>` with your user’s password (URL-encode special characters like `@`, `#`, `%`).
   - Set the database name in the path, e.g. `...mongodb.net/datax?retryWrites=true&w=majority`.

Example shape:

```text
mongodb+srv://MY_USER:MY_ENCODED_PASSWORD@cluster0.xxxxx.mongodb.net/datax?retryWrites=true&w=majority
```

5. **Test locally** (optional):

```bash
export MONGODB_URI='mongodb+srv://...'
npm run dev
```

Open `http://localhost:3000` — stats should load if the URI is correct.

---

## 2. Vercel + GitHub (recommended)

1. Push this project to a **GitHub** repository (root of the repo = Next.js app with `package.json` at the top level).
2. In Vercel, sign in with **Continue with GitHub** and authorize the Vercel GitHub App when prompted (so it can read repos and post deployment status).
3. Open [vercel.com/new](https://vercel.com/new) → **Import** your DataX repo.
4. **Configure Project** (before the first deploy):
   - Framework Preset: **Next.js** (auto-detected).
   - **Root Directory**: leave `.` unless this app lives in a subfolder inside a monorepo — then set that subfolder here.
   - Build / Output: defaults are fine (`npm run build`).
5. **Environment Variables** — expand the section on the import screen *or* add after import under **Settings → Environment Variables**:
   - Name: `MONGODB_URI`
   - Value: your Atlas connection string.
   - Check **Production**, **Preview**, and **Development** so every branch preview can hit the DB.
6. Click **Deploy**. Later, every `git push` to your default branch redeploys production; other branches get **Preview** URLs.

### Alternative — Vercel CLI (no Git integration)

```bash
npm i -g vercel
cd "/path/to/Project DataX"
vercel login
vercel link
vercel env add MONGODB_URI
# paste value, select Production + Preview + Development
vercel --prod
```

---

## 3. After first deploy

1. Open your **production URL** (e.g. `https://datax-xxx.vercel.app`).
2. **Seed demo data** (runs from your laptop, talks to Atlas — same DB Vercel uses):

```bash
export MONGODB_URI='mongodb+srv://...same as Vercel...'
npm run seed
```

3. Register a seller/buyer on the live site and walk through a deal to confirm.

---

## 4. Keys checklist

| Item | Where it lives |
|------|----------------|
| `MONGODB_URI` | Vercel env + your local `.env.local` / shell for `seed` |
| Agent API keys `dx_…` | Created via `POST /api/agents` or the UI; stored **hashed** in MongoDB |
| Atlas DB user password | Atlas only (embedded in `MONGODB_URI`) |

There is **no** separate “DataX API secret” for the Next.js server.

---

## 4b. A2A protocol env vars (optional)

DataX exposes Agent2Agent v1.0 at `POST /api/a2a` with signed Agent Cards at
`/.well-known/agent-card.json`. The following env vars are optional for local
dev (unsigned cards and default timings) but should be set in production:

| Name | Purpose | Default |
|------|---------|---------|
| `A2A_SIGNING_KEY` | PKCS#8 PEM or JWK JSON used to sign Agent Cards. Public half is auto-published at `/.well-known/jwks.json`. | Unset — cards are served unsigned with a console warning. |
| `A2A_SIGNING_ALG` | Algorithm for PEM keys (`EdDSA` preferred, `ES256` fallback). | `EdDSA` |
| `A2A_SIGNING_KID` | Key id published in JWKS + JWS `kid` header. | `datax-a2a-1` |
| `A2A_SSE_POLL_MS` | SSE tail poll interval in ms. Clamped to `[500, 10000]`. | `2000` |
| `A2A_SSE_STREAM_TTL_MS` | Max lifetime of one SSE connection before graceful rotation. Must be < Vercel function timeout. | `55000` (Hobby-safe) |
| `A2A_BASE_URL` | Absolute URL DataX advertises in Agent Cards and push notifications. Falls back to the request origin if unset. | unset |

### Vercel Pro upgrade path

When you outgrow Hobby's 60-second function cap:

1. Set `A2A_SSE_STREAM_TTL_MS = 270000` in Vercel env vars.
2. Uncomment `export const maxDuration = 300` at the top of
   [src/app/api/a2a/route.ts](../src/app/api/a2a/route.ts).

No logic or workflow changes required.

## 5. Optional hardening (later)

- Restrict Atlas IP list if you use a fixed egress (e.g. Vercel Enterprise patterns).
- Add **Vercel Authentication** or middleware if you want `/seller` and `/buyer` behind a password.
- **Custom domain**: Project → Settings → Domains.

---

## 6. Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| “Database is not configured” / stats fail | `MONGODB_URI` missing or wrong env on Vercel (check Preview vs Production). |
| Mongo timeout / `ENOTFOUND` | Wrong cluster host; user/password typo; password not URL-encoded. |
| Works locally, not on Vercel | Atlas Network Access blocks Vercel; add `0.0.0.0/0` or fix IP rules. |

---

## 7. Monorepo / path notes

If the project folder name has spaces, quote paths in the terminal. Vercel uses the repo root as the project root — ensure the **Root Directory** in Vercel is set to this Next.js app if the repo is not only DataX.
