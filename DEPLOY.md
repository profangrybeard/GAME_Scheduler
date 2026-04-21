# Deploying GAME Scheduler

> **Status (2026-04-17):**
> - ✅ Hosted + gated at **https://scheduler.autocoursescheduler.com**.
> - ✅ Cloudflare Access policy allows only `@scad.edu` emails. Login is via one-time PIN — users enter their email, receive a 6-digit code, paste it in. (Google SSO was attempted first but SCAD Workspace admin blocks third-party OAuth clients; see §Cloudflare Access for the full story.)
> - ✅ Origin lives at `https://scad-class-scheduler.fly.dev`, proxied through Cloudflare with Full (strict) TLS. Direct Fly URL is still reachable but undocumented — Access-gated URL is the canonical entry point.

The React workspace + FastAPI solver deploys as one Docker container to
[Fly.io](https://fly.io), gated by Cloudflare Access so only `@scad.edu`
users can reach it.

## How deploys actually happen

| Player | Role |
|--------|------|
| **GitHub** | Source of truth. `git push origin main` triggers [`.github/workflows/fly.yml`](.github/workflows/fly.yml). |
| **GitHub Actions** | Runs `flyctl deploy --remote-only` using the `FLY_API_TOKEN` repo secret. |
| **Fly.io remote builder** | Builds the Docker image defined in [`Dockerfile`](Dockerfile), uploads to the Fly registry. |
| **Fly.io Machines** | Runs the container per [`fly.toml`](fly.toml). Auto-stops when idle; wakes on request. |
| **Cloudflare proxy** | DNS proxy + edge TLS for `scheduler.autocoursescheduler.com`. Terminates client TLS, re-encrypts to Fly origin. |
| **Cloudflare Access** | Gates the proxied URL with the `@scad.edu` policy. Unauthorized users never reach Fly. |

**Deploys are automatic.** Merge to main → ~60–90 seconds later the new
version is live. The [About popover](frontend/src/components/TopbarMenu.tsx)
in the top-right shows the deployed commit's short SHA so you can see at a
glance which build is serving.

**For local development** (you, Tim), keep using
[`./launch_workspace.sh`](launch_workspace.sh) (or `run_workspace.bat` on
Windows) — the hosted build is for Eric and other reviewers, not your daily
iteration loop.

**Hosted URL:** `https://scheduler.autocoursescheduler.com`

---

## One-time setup (~30 min, already done for this repo)

If you're re-doing this from scratch (e.g. forking the project, or the
existing setup breaks):

### 1. Fly.io account — `@scad.edu` email

Use **email signup**, not the GitHub / Google OAuth buttons — the account
travels with SCAD rather than any one person's personal login. Fly asks for
a credit card (anti-abuse; typical monthly cost under $5 with auto-stop).

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

**That's it.** Your PC is done. All future code deploys are `git push = live`.

---

## Cloudflare Access — `@scad.edu` gate via one-time PIN

Fly gives you `https://scad-class-scheduler.fly.dev`, which is public. We
put Cloudflare Access in front on a custom domain so only `@scad.edu` users
can reach it.

> Eric opens `https://scheduler.autocoursescheduler.com` → CF prompts for
> his email → enters `eric@scad.edu` → receives a 6-digit code in his inbox
> → pastes it in → he's in. Session lasts 24 hours per browser.

### Why PIN, not Google SSO

The original plan was Google SSO (click-to-login using the browser's
existing `@scad.edu` Google session). SCAD's Google Workspace admin policy
blocks third-party OAuth clients for faculty — any attempt to sign in to
an app on `*.cloudflareaccess.com` returns `Error 400: access_not_configured`
("Your institution's admin needs to review cloudflareaccess.com"). Filing a
ticket with SCAD IT was not a realistic path. One-time PIN bypasses Google
Workspace entirely — CF mails the code directly, plaintext 6-digit, which
SCAD's email security won't pre-fetch or strip.

### Prerequisites

- A domain on Cloudflare (we use `autocoursescheduler.com`, bought via CF
  Registrar for ~$10/year).
- A free Cloudflare Zero Trust team (we use `scad-scheduler` →
  `scad-scheduler.cloudflareaccess.com`).

### Steps

1. **Add the domain to Cloudflare** — either buy through CF Registrar
   (no nameserver change needed) or buy elsewhere and paste CF's nameservers
   into your registrar. If buying through CF Registrar from a SCAD email,
   expect the verification email to be pre-fetched by SCAD's link scanner
   (consumes the token before you can click it). Workaround: right-click
   the verify link in Gmail → **Copy link address** → paste into Chrome's
   address bar. Do not click.

2. **Create a Zero Trust team** — Cloudflare dash → **Zero Trust** → follow
   the onboarding. Free plan covers up to 50 users. Your team name becomes
   `<team>.cloudflareaccess.com`.

3. **Create the Access application:**
   - Zero Trust dash → **Access controls → Applications → Add an application**.
   - Type: **Self-hosted and private**.
   - **Destinations → Public hostnames:** subdomain `scheduler`, domain
     `autocoursescheduler.com`, path blank.
   - **Access policies → Create new policy:**
     - Name: `SCAD faculty`
     - Action: `Allow`
     - Include → **Emails ending in** → `@scad.edu`
   - **Authentication:**
     - Uncheck "Accept all available identity providers"
     - "Select available identity providers" → choose **One-time PIN**
     - Flip **"Apply instant authentication"** to **On** (skips the
       login-method-picker since PIN is the only option)
   - **Details:** Name = `SCAD Course Scheduler`, Session Duration = `24 hours`.
   - Create.

4. **DNS — add three records to `autocoursescheduler.com`:**

   | Type | Name | Target | Proxy |
   |------|------|--------|-------|
   | `CNAME` | `scheduler` | `scad-class-scheduler.fly.dev` | **Proxied (orange cloud)** |
   | `CNAME` | `_acme-challenge.scheduler` | `scheduler.autocoursescheduler.com.<app-id>.flydns.net` | **DNS only (grey cloud)** |
   | `TXT` | `_fly-ownership.scheduler` | `app-<app-id>` | n/a |

   The second + third records let Fly verify the cert via DNS-01 instead of
   HTTP-01 (which is blocked by CF Access intercepting the `/.well-known/`
   path). Run `flyctl certs setup scheduler.autocoursescheduler.com -a scad-class-scheduler`
   to get the exact `<app-id>` values for the two verification records.

5. **Issue the Fly cert:**
   ```bash
   flyctl certs add scheduler.autocoursescheduler.com -a scad-class-scheduler
   # wait ~60s for DNS propagation, then:
   flyctl certs check scheduler.autocoursescheduler.com -a scad-class-scheduler
   # should report Status = Issued
   ```

6. **Harden CF → origin TLS:**
   - `autocoursescheduler.com` → **SSL/TLS → Configuration** → Encryption
     Mode → **Full (strict)**. Do this *after* `flyctl certs check` reports
     Issued; flipping to strict before the cert is live returns 526 errors.

7. **Test** in an incognito window:
   - `https://scheduler.autocoursescheduler.com` → PIN prompt → enter
     `tlindsey@scad.edu` → code arrives in inbox → paste → workspace loads.
   - Negative test: enter a non-SCAD email (e.g. personal Gmail) — CF should
     silently not send a code. User never sees "denied," they just get no
     code. That's the policy working correctly.

### Known UX quirk — Brave Private Browsing

Some privacy-focused browsers (Brave in Private mode is the confirmed case)
pre-fetch email links to test them for tracking, which burns one-shot auth
tokens. Effect: user enters a correct code but CF says "already used."
Workaround: click "Resend code," use the new one. Chrome Incognito and
Firefox Private Browsing don't exhibit this.

---

## Ongoing maintenance

| Task | How |
|------|-----|
| Deploy new code | `git push origin main`. Workflow handles the rest. |
| Read production logs | `fly logs -a scad-class-scheduler` (CLI) or Fly dashboard |
| Roll back | `git revert <sha> && git push`. Deploys the prior state. |
| Scale memory if solver OOMs | `fly scale memory 1024 -a scad-class-scheduler` |
| Rotate the deploy token | Generate a new one, update the `FLY_API_TOKEN` GitHub secret. Revoke the old one with `fly tokens revoke <id>`. |
| See who used the hosted app | Cloudflare Zero Trust → **Insights → Logs → Access** |
| Add an allowed user outside `@scad.edu` | Zero Trust → Access → Applications → `SCAD Course Scheduler` → Policies → edit — add another Include rule (e.g. `Emails → specific-email@gmail.com`). |

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
- **Don't flip SSL/TLS to Full (strict) while the Fly cert is still
  provisioning** — you'll get 526 errors until the cert finishes. Wait for
  `flyctl certs check` to report `Status = Issued` first.

## Related

- [`launch_workspace.sh`](launch_workspace.sh) / [`run_workspace.bat`](run_workspace.bat)
  — local dev (Vite + uvicorn together)
- [`.github/workflows/fly.yml`](.github/workflows/fly.yml) — the deploy workflow
- [`.github/workflows/frontend-ci.yml`](.github/workflows/frontend-ci.yml) —
  frontend typecheck / build / lint on every PR
- [`.github/workflows/python-ci.yml`](.github/workflows/python-ci.yml) —
  pytest on every PR
