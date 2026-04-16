# Deploying GAME Scheduler

The React workspace + FastAPI solver deploys as one Docker container to
[Fly.io](https://fly.io), gated (once wired up) by Cloudflare Access so only
`@scad.edu` users can reach it.

## How deploys actually happen

| Player | Role |
|--------|------|
| **GitHub** | Source of truth. `git push origin main` triggers [`.github/workflows/fly.yml`](.github/workflows/fly.yml). |
| **GitHub Actions** | Runs `flyctl deploy --remote-only` using the `FLY_API_TOKEN` repo secret. |
| **Fly.io remote builder** | Builds the Docker image defined in [`Dockerfile`](Dockerfile), uploads to the Fly registry. |
| **Fly.io Machines** | Runs the container per [`fly.toml`](fly.toml). Auto-stops when idle; wakes on request. |
| **Cloudflare Access** *(optional, see §Cloudflare)* | Gates the hosted URL with Google SSO + `@scad.edu` policy. |

**Deploys are automatic.** Merge to main → ~60–90 seconds later the new
version is live. The [version badge](frontend/src/components/VersionBadge.tsx)
in the top-right shows the deployed commit's short SHA so you can see at a
glance which build is serving.

**For local development** (you, Tim), keep using
[`./launch_workspace.sh`](launch_workspace.sh) (or `run_workspace.bat` on
Windows) — the hosted build is for Eric and other reviewers, not your daily
iteration loop.

**Hosted URL:** `https://scad-class-scheduler.fly.dev`

---

## One-time setup (~15 min, already done for this repo)

If you're re-doing this from scratch (e.g. forking the project, or the
existing setup breaks):

### 1. Fly.io account — `@scad.edu` email

Use **email signup**, not the GitHub / Google OAuth buttons — the account
travels with SCAD rather than any one person's personal login. Fly asks for
a credit card (anti-abuse; typical monthly cost under $2 with auto-stop).

### 2. Install flyctl and reserve the app name

```powershell
# Windows (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex
```
```bash
# Mac/Linux
curl -L https://fly.io/install.sh | sh
```

```bash
fly auth login                                     # browser-based, uses your @scad.edu account
fly apps create scad-class-scheduler               # reserves the name on Fly's namespace
```

If `scad-class-scheduler` is taken globally, pick a variant and update the
`app = "..."` line in [`fly.toml`](fly.toml) to match.

### 3. Generate the deploy token and paste it into GitHub

```bash
fly tokens create deploy -x 999999h -a scad-class-scheduler
# copy the "FlyV1 fm2_..." string
```

In GitHub → repo **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**:

- **Name:** `FLY_API_TOKEN`
- **Value:** paste the token

### 4. Push to main

```bash
git push origin main
```

The Fly Deploy workflow kicks off automatically; watch progress in the
Actions tab. First real build takes ~3–4 min (ortools is chonky); subsequent
builds are ~60 s thanks to Fly's layer cache.

**That's it.** Your PC is done. All future deploys are `git push = live`.

---

## Cloudflare Access — SCAD Google Workspace SSO

Fly gives you `https://scad-class-scheduler.fly.dev`, which is public. We
put Cloudflare Access in front so only `@scad.edu` users can reach it.
SCAD runs on Google Workspace, so the flow is:

> Eric opens the link → "Sign in with Google" → already-signed-in SCAD
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
     Cloud Console. Follow them — paste the Client ID + Client Secret back
     into Cloudflare.

3. **Create an access application**:
   - **Zero Trust** → **Access** → **Applications** → **Add application** →
     **Self-hosted**.
   - Application name: `GAME Scheduler`.
   - Session duration: 24 hours.
   - Subdomain + domain: e.g. `scheduler.yourdomain.xyz`.
   - **Identity providers**: check **Google**. Uncheck "One-time PIN" so
     everyone goes through Google SSO — keeps the @scad.edu filter airtight.

4. **Add a policy**:
   - Name: `SCAD faculty`.
   - Action: `Allow`.
   - Include → **Emails ending in** → `@scad.edu`.

5. **Point DNS at Fly.io**:
   - **DNS** → **Records** → **Add record**.
   - Type: `CNAME`, Name: `scheduler`, Target: `scad-class-scheduler.fly.dev`.
   - Proxy status: **Proxied** (orange cloud).

6. **Tell Fly about the custom domain**:
   - Fly Dashboard → your app → **Certificates** → **Add certificate** →
     enter `scheduler.yourdomain.xyz`. Fly auto-issues a Let's Encrypt cert.

7. **Test** in an incognito window: click the link → Google SSO → `@scad.edu` →
   in. A non-SCAD Google account sees "Access denied".

---

## Ongoing maintenance

| Task | How |
|------|-----|
| Deploy new code | `git push origin main`. Workflow handles the rest. |
| Read production logs | `fly logs -a scad-class-scheduler` (CLI) or Fly dashboard |
| Roll back | `git revert <sha> && git push`. Deploys the prior state. |
| Scale memory if solver OOMs | `fly scale memory 1024 -a scad-class-scheduler` |
| Rotate the deploy token | Generate a new one, update the `FLY_API_TOKEN` GitHub secret. Revoke the old one with `fly tokens revoke <id>`. |
| See who used the hosted app | Cloudflare Zero Trust → Access → Logs |

## What NOT to do

- **Don't `fly deploy` from your PC** — it bypasses CI, potentially shipping
  uncommitted code, and confuses the "push to main = deploy" mental model.
  The workflow is the deploy authority.
- **Don't put secrets in `fly.toml`** — it's committed to the repo. Use
  `fly secrets set KEY=value -a scad-class-scheduler` for anything sensitive.
- **Don't commit `data/quarterly_offerings.json`** — it's gitignored and
  per-user state.
- **Don't disable the Cloudflare Access policy "to test real quick"** — the
  solver is a free-CPU target for anyone who finds the URL while it's open.

## Related

- [`launch_workspace.sh`](launch_workspace.sh) / [`run_workspace.bat`](run_workspace.bat)
  — local dev (Vite + uvicorn together)
- [`.github/workflows/fly.yml`](.github/workflows/fly.yml) — the deploy workflow
- [`.github/workflows/frontend-ci.yml`](.github/workflows/frontend-ci.yml) —
  frontend typecheck / build / lint on every PR
- [`.github/workflows/python-ci.yml`](.github/workflows/python-ci.yml) —
  pytest on every PR
