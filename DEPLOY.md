# Deploying GAME Scheduler

The React workspace + FastAPI solver deploys as one Docker container to
[Fly.io](https://fly.io), gated by Cloudflare Access so only `@scad.edu`
users can reach it.

**Who does what:**

| Player | Role |
|--------|------|
| **Your PC** | One-time setup only: install flyctl, sign in, install Fly's GitHub App on the repo. After that, your PC is done. |
| **GitHub** | Source of truth for code. Fly's GitHub App watches `main` and triggers a deploy on every push. |
| **Fly.io** | Builds the Docker image on its remote builder, runs the container. Auto-stops when idle. |
| **Cloudflare** | Sits in front of Fly, enforces "must be signed in with a `@scad.edu` Google account" before any request reaches the app. |

**For local development** (you, Tim), keep using `./launch_workspace.sh` —
the hosted build is for Eric and other reviewers, not your daily work.

**Hosted app URL:** `https://scad-class-scheduler.fly.dev` (raw, behind
Cloudflare Access the moment DNS is wired up).

---

## One-time setup

### 1. Sign up for Fly.io with your `@scad.edu` email

Use **email signup**, not the GitHub / Google OAuth buttons — the account
travels with SCAD rather than any one person's personal login. Fly will ask
for a credit card (anti-abuse; typical monthly cost for this app is under $2).

### 2. Install flyctl locally

```powershell
# Windows (PowerShell):
iwr https://fly.io/install.ps1 -useb | iex
```

```bash
# Mac/Linux:
curl -L https://fly.io/install.sh | sh
```

### 3. Connect the GitHub repo to Fly

This happens inside the Fly dashboard:

1. Dashboard → **Launch an App** → **Launch an App from GitHub**.
2. Select `profangrybeard/GAME_Scheduler`.
3. Fly's wizard detects the repo; it will scaffold some generic config
   files onto a new branch (`flyio-new-files`) as a "helpful" starting point.
   **Ignore / do not merge that branch** — our real `Dockerfile` and
   `fly.toml` already live on `main`.
4. The first auto-deploy will likely be incorrect (built from Fly's
   generic scaffold, not our real code). That's expected; the next push
   to `main` with our real config overrides it.

### 4. Push to main to trigger a real deploy

Once `Dockerfile`, `fly.toml`, and `.dockerignore` are on `main`:

```bash
git push origin main
```

Fly's GitHub App sees the push, pulls `main`, builds using our actual
Dockerfile on its remote builder, and deploys. Takes ~3–4 minutes the
first time (ortools is a chonky install). When it finishes, visit
`https://scad-class-scheduler.fly.dev` and verify:

- React workspace loads at `/`
- `/api/health` returns `{"ok": true, ...}`

---

## Cloudflare Access (auth gate) — SCAD Google Workspace SSO

Fly gives you `https://scad-class-scheduler.fly.dev`, which is public. We
put Cloudflare Access in front so only `@scad.edu` users can reach it.
SCAD runs on Google Workspace, so the cleanest UX is:

> Eric opens the link → "Sign in with Google" → his already-signed-in SCAD
> account verifies in one click → he's in.

No inbox-hunting for a one-time code, no extra password to remember.

**You need:**
- A domain on Cloudflare (cheapest: buy a `.xyz` for ~$1/year on
  Cloudflare Registrar; a SCAD subdomain would require SCAD IT involvement).
- A free Cloudflare account.

**Steps:**

1. **Add the domain to Cloudflare** (follow the nameserver-change wizard if
   it's a new domain).

2. **Configure Google as an identity provider (one-time)**:
   - Cloudflare Dashboard → **Zero Trust** → **Settings** → **Authentication**
     → **Login methods** → **Add new** → **Google**.
   - Cloudflare shows instructions for creating an OAuth client in Google
     Cloud Console. Follow them — you'll end up pasting a Client ID + Client
     Secret back into Cloudflare.
   - Test: Cloudflare's "Test" button runs a signup flow to verify the
     integration works.

3. **Create an access application**:
   - Cloudflare Dashboard → **Zero Trust** → **Access** → **Applications** →
     **Add an application** → **Self-hosted**.
   - Application name: `GAME Scheduler`.
   - Session duration: 24 hours.
   - Subdomain + domain: e.g. `scheduler.yourdomain.xyz`.
   - Path: leave blank (protects the whole app).
   - **Identity providers**: check **Google**. Uncheck "One-time PIN" so
     everyone is forced through Google SSO — this keeps the @scad.edu
     filter airtight.

4. **Add a policy**:
   - Name: `SCAD faculty`.
   - Action: `Allow`.
   - Include → **Emails ending in** → `@scad.edu`.
   - Because Google is the IdP, Cloudflare reads the verified email from
     Google's OAuth response — users can't spoof the domain.

5. **Point DNS at Fly.io**:
   - Cloudflare Dashboard → **DNS** → **Records** → **Add record**.
   - Type: `CNAME`, Name: `scheduler` (or whatever subdomain you picked).
   - Target: `scad-class-scheduler.fly.dev`.
   - Proxy status: **Proxied** (orange cloud) — routes traffic through
     Cloudflare so Access can intercept.

6. **Tell Fly about the custom domain**:
   - Fly Dashboard → your app → **Certificates** → **Add certificate** →
     enter `scheduler.yourdomain.xyz` → **Add**. Fly issues a Let's Encrypt
     cert automatically (takes a minute or two).

7. **Test it**:
   - Open `https://scheduler.yourdomain.xyz` in an incognito window.
   - Cloudflare shows a "Sign in with Google" button.
   - Click it → Google prompts for an account → pick your `@scad.edu` one →
     you're in.
   - Try with a non-SCAD Google account → "Access denied".

---

## Ongoing maintenance

| Task | How |
|------|-----|
| Deploy new code | `git push origin main`. Fly's GitHub App handles the rest. |
| Read production logs | `fly logs -a scad-class-scheduler` (CLI) or Fly dashboard |
| Roll back | Revert the commit on `main`, push. Fly redeploys the previous state. |
| Scale memory if solver OOMs | Fly dashboard → your app → **Scale** → memory → 1024 MB |
| Revoke an allowed user | Cloudflare Zero Trust → Access → Policies → remove email |
| See who used the app | Cloudflare Zero Trust → Access → Logs |

## What NOT to do

- **Don't merge the `flyio-new-files` branch / PR.** Fly auto-generated it
  as a scaffold template before our real config existed on main. Merging it
  would replace our actual Dockerfile + fly.toml. Close the PR, then
  delete the branch once our deploy is working.
- **Don't `fly secrets set` anything sensitive if it's not needed** — there
  are no app secrets today. If you add (e.g.) a Supabase key later, use
  `fly secrets set KEY=value -a scad-class-scheduler`, **never** put it in
  `fly.toml` (that file is committed).
- **Don't commit `data/quarterly_offerings.json`** — it's gitignored and
  per-user.
- **Don't disable the Cloudflare Access policy "to test something real
  quick"** without putting it back. The app is a free-CPU target for anyone
  who finds the URL while it's open.
