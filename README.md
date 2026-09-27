# BLCKBOX — File Storage & Sharing

Small full-stack take-home: upload documents, share them via copyable links (including password-protected links), and collaborate in workspaces.

Built with **Cursor** (Composer). See [How I worked with the coding agent](#how-i-worked-with-the-coding-agent) below.

## How to run (local)

**Prerequisites:** Node.js 20+, a PostgreSQL database.

If you don’t have Postgres handy, a one-off container is enough (the app itself is not dockerized yet):

```bash
docker run -d --name blckbox-postgres \
  -e POSTGRES_USER=blckbox \
  -e POSTGRES_PASSWORD=blckbox \
  -e POSTGRES_DB=blckbox \
  -p 5433:5432 \
  postgres:16-alpine
```

Then:

```bash
cd api
cp .env.example .env
npm install
npx prisma migrate deploy
npm run dev

# new terminal
cd web
cp .env.example .env
npm install
npm run dev
```

- Web UI: http://localhost:5173  
- API: http://localhost:4000  

### Nginx gateway (optional, Angora-style)

#### Full Docker stack (recommended)

One compose file runs Postgres, Redis, API, Web, OnlyOffice, and nginx:

```bash
# /etc/hosts
127.0.0.1  app.blckbox.localapp

# stop any old nginx using port 80
docker stop blckbox-nginx-local 2>/dev/null || true

docker compose -f docker-compose.local.yml up -d --build
# → http://app.blckbox.localapp
```

| File | Domain | TLS |
| ---- | ------ | --- |
| [`docker-compose.local.yml`](docker-compose.local.yml) | `app.blckbox.localapp` | HTTP |
| [`docker-compose.ssl.yml`](docker-compose.ssl.yml) | `blckbox.dms.com` | Pre-placed `/etc/nginx/certs/` |
| [`docker-compose.certbot.yml`](docker-compose.certbot.yml) | `blckbox.dms.com` | Let’s Encrypt |

Copy [`.env.docker.example`](.env.docker.example) → `.env` for secrets (`JWT_SECRET`, etc.).

Gateway nginx configs live under [`nginx/`](nginx/) (`local.conf`, `ssl.conf`, `certbot.conf`). See [`nginx/README.md`](nginx/README.md).

### OnlyOffice preview (optional)

Office/PDF preview uses OnlyOffice Document Server. From the repo root:

```bash
cd docker-compose-only-office
docker compose -f docker-compose-onlyoffice-local.yml up -d
```

Document Server: http://localhost:8080  

Ensure `api/.env` has matching secrets (see `.env.example`):

```
PUBLIC_API_URL=http://host.docker.internal:4000/api
ONLYOFFICE_URL=http://localhost:8080
ONLYOFFICE_JWT_SECRET=blckbox-onlyoffice-jwt-secret-change-me
```

Click a file name in a workspace to open the preview.

Each package has its own `.env` (`api/.env`, `web/.env`). Defaults expect Postgres at `postgresql://blckbox:blckbox@localhost:5433/blckbox`.

### Tests

```bash
cd api
npm test
```

## Architecture overview

```
React (Vite)  --cookie JWT-->  Express API  -->  PostgreSQL (Prisma)
                                    |
                              StorageService
                                    |
                              Local disk (./data/uploads)
```

| Piece | Choice |
|-------|--------|
| API | Node.js + TypeScript + Express |
| DB | PostgreSQL + Prisma migrations |
| Files | Local disk behind a `StorageService` interface (swappable to S3/MinIO later) |
| Auth | Email/password, httpOnly JWT cookie |
| UI | React + Vite |

Key folders:

- `api/src/routes` — HTTP handlers
- `api/src/services/access.ts` — authorization helpers
- `api/src/storage` — storage abstraction
- `api/prisma` — schema + migrations
- `web/src` — UI flows

## Assumptions and decisions

The brief left several product gaps open. Choices below are what a small product team would reasonably ship for v1.

### Sharing: two modes

1. **Inside the team (workspace)** — members see documents while logged in. No share link required.
2. **Outside the team** — create a **public share link**, copy it, send via Gmail/Slack/etc. Recipients **do not need an account or login**. Optional password + optional expiry.

We do **not** send email from the app (no SMTP). The product creates URLs; humans distribute them.

### Workspaces and roles

- `owner` — full control (invite, manage, delete docs)
- `admin` — invite/remove-capable for invites; manage docs/links
- `member` — upload, list, download, create share links; can delete own uploads; owner/admin can delete any workspace doc

### Invitations

- Owner/admin invites by email + role → invite URL.
- Existing user: open invite link while logged in as that email → Accept.
- New user: register with invite token (or register then accept) → membership created.
- Invites expire in **7 days**; can be revoked. Invite URLs are logged to the API console for local demo.

### Documents

- Personal library (no workspace) **or** exactly one workspace.
- Soft-delete (`deletedAt`); active share links are revoked on delete.
- Max upload **25 MB**; common office/PDF/image MIME types.
- Blobs never stored in Postgres — only metadata + `storageKey`.

### Share links

- Token = `crypto.randomBytes(32)` base64url (not guessable).
- Downloads always go through the API (storage paths never exposed).
- **Product improvement:** optional password on a share link (bcrypt). After unlock, an httpOnly cookie allows download for 1 hour.

## Security considerations

**Addressed**

- Password hashing (bcrypt)
- httpOnly, SameSite=Lax auth cookies
- Non-guessable share tokens
- Authz checks on every document access (personal owner / workspace membership)
- Storage behind API; path traversal guarded in local storage
- Upload size + MIME allowlist
- Soft-delete + link revoke

**Knowingly left for later**

- Outbound email
- Virus scanning
- Rate limiting / brute-force protection on share passwords
- CSRF tokens (mitigated somewhat by SameSite cookies)
- Hard-delete garbage collection of files on disk
- SSO / OAuth
- Full audit trail
- `docker-compose up` for the whole stack (deferred until core is stable)

## Product improvement

**Password-protected share links** — built end-to-end (API + UI + tests).

Why: external sharing is the highest-risk flow; a simple password is a realistic control users ask for, without forcing outsiders to create accounts. It’s small enough to ship in a weekend and easy to demo.

## How I worked with the coding agent

**Agent:** Cursor (Composer).

**Delegated**

- Scaffolding Express/Prisma/React boilerplate
- Implementing routes, schema, and UI from an agreed product plan
- Writing integration tests for authz / share / invite

**Where I steered / corrected**

- Locked Express + Postgres (not Fastify) and deferred full Dockerization on purpose
- Chose copy-link + public access (no login) for outsiders instead of forcing signup
- Required a storage abstraction instead of writing files ad hoc in handlers
- Kept authorization in a shared access module rather than sprinkling checks only in the UI

**What I’d watch in review**

- Every document download path goes through `requireDocumentAccess` or a validated share token
- Share tokens and invite tokens are random, not sequential IDs
- README decisions match the code (especially “no email” and “no login for public links”)

## What I’d do with more time

1. `docker-compose.yml` (Postgres + API + web) and optional MinIO `StorageService`
2. Hard-delete job for soft-deleted files
3. Rate limits on auth + share unlock
4. Folders / search within a workspace
5. Audit log of downloads and membership changes

## API sketch

- `POST /api/auth/register|login|logout`, `GET /api/auth/me`
- `GET/POST /api/documents`, `GET /api/documents/:id/download`, `DELETE /api/documents/:id`
- `POST /api/documents/:id/share-links`, `DELETE /api/documents/share-links/:linkId`
- `GET/POST /api/workspaces`, members + invitations
- `GET /api/invites/:token`, `POST /api/invites/:token/accept`
- `GET /api/s/:token`, `POST /api/s/:token/unlock`, `GET /api/s/:token/download`
