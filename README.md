# BLCKBOX — File Storage & Sharing

Small full-stack take-home: upload documents into workspaces, preview them, share with teammates or via public links (optional password), and track activity.

Built with **Cursor** (Composer). See [How I worked with the coding agent](#how-i-worked-with-the-coding-agent) below.

## How to run (Docker)

**Prerequisites:** Docker with Compose v2, port **80** free, and a hosts entry for local HTTP.

```bash
# /etc/hosts (see also nginx/hosts)
127.0.0.1  app.blckbox.localapp
```

```bash
cp .env.docker.example .env   # JWT and other secrets

docker compose -f docker-compose.local.yml up -d --build
# → http://app.blckbox.localapp
```

One compose file starts **Postgres, Redis, API, Web, OnlyOffice, and nginx**. On first API boot the entrypoint runs Prisma migrations and seeds a bootstrap admin.

| Stack | Compose file | Domain | TLS |
| ----- | ------------ | ------ | --- |
| Local | [`docker-compose.local.yml`](docker-compose.local.yml) | `app.blckbox.localapp` | HTTP |
| SSL | [`docker-compose.ssl.yml`](docker-compose.ssl.yml) | `blckbox.dms.com` | Pre-placed certs under `/etc/nginx/certs/` |
| Certbot | [`docker-compose.certbot.yml`](docker-compose.certbot.yml) | `blckbox.dms.com` | Let’s Encrypt |

Gateway configs: [`nginx/local.conf`](nginx/local.conf), [`nginx/ssl.conf`](nginx/ssl.conf), [`nginx/certbot.conf`](nginx/certbot.conf). Details: [`nginx/README.md`](nginx/README.md).

Optional host-only helpers (not needed with full stack): [`docker-compose-only-office/`](docker-compose-only-office/) and [`docker-compose-redis/`](docker-compose-redis/).

After editing an nginx conf while the gateway is already up:

```bash
docker exec blckbox-gateway nginx -s reload
```

### Default admin

Public registration is **disabled**. Accounts are created by an admin (Users page).

| Field | Value |
| ----- | ----- |
| Email | `vikaskumar9891452674@gmail.com` |
| Password | `Vikas@123` |

Seed is idempotent (safe on every API restart).

### Tests (optional, on the host)

```bash
cd api
cp .env.example .env   # if you need a local DB for tests
npm install
npm test
```

## Architecture overview

```
Browser
   │
   ▼
nginx (gateway)
   ├── /              → web (React SPA)
   ├── /api/          → Express API
   ├── /socket.io/    → API (realtime)
   └── /onlyoffice/   → OnlyOffice Document Server
                           │
              Express ─────┼──► PostgreSQL (Prisma)
                           ├──► Redis (BullMQ trash purge)
                           └──► local disk (StorageService)
```

| Piece | Choice |
|-------|--------|
| API | Node.js + TypeScript + Express (mounted under `/api`) |
| DB | PostgreSQL + Prisma migrations |
| Queue | Redis + BullMQ (permanent delete) |
| Files | Local disk behind a `StorageService` interface (swappable to S3/MinIO later) |
| Preview | OnlyOffice Document Server |
| Auth | Email/password, httpOnly JWT cookie (`Secure` when `NODE_ENV=production`) |
| UI | React + Vite (served by nginx in the web image) |
| Deploy | Docker Compose + nginx gateway |

Key folders:

- `api/src/routes` — HTTP handlers
- `api/src/services` — access, audit, storage settings, seed
- `api/src/storage` — storage abstraction
- `api/prisma` — schema + migrations
- `web/src` — UI
- `nginx/` — gateway configs mounted by compose
- `docker-compose.*.yml` — full stacks (local / ssl / certbot)

SPA paths such as `/users` and `/settings` must not collide with the API. The API lives under **`/api/`**; nginx sends only `/api/` (and `/socket.io/`) to Express.

## Assumptions and decisions

### Sharing: two modes

1. **Internal** — share a document with one or more platform users (searchable picker). Recipients see it under Shared with me while logged in.
2. **External** — public share link (copy URL). Optional password and expiry. Recipients do **not** need an account.

The app does **not** require SMTP for the happy path; links can be copied. Optional email sending exists when SMTP settings are configured in Settings.

### Platform vs workspace roles

**Platform** (`admin` / `owner` / `member`): who can manage users and see global admin surfaces.

**Workspace** (`owner` / `admin` / `member`): invite, permissions, and document control inside a workspace.

### Documents and folders

- Documents live in a workspace (folders supported).
- Soft-delete → Trash; permanent delete is queued (Redis/BullMQ) with realtime toast on completion.
- Max upload **25 MB**; common office/PDF/image MIME types.
- Blobs are not stored in Postgres — metadata + `storageKey` only.

### Preview and activity

- Office/PDF preview via OnlyOffice (included in compose).
- Per-document **Audit trail** (access-gated).
- Dashboard **Recent activity** is role-scoped: platform admin sees all; owner/member see their own actions plus events in workspaces they can access.

### Auth bootstrap

- Admin is seeded on API startup.
- `POST /api/auth/register` returns an error directing users to ask an admin.

## Security considerations

- Password hashing (bcrypt)
- httpOnly, SameSite=Lax auth cookies (`Secure` in production)
- Non-guessable share tokens
- Authz on document access (workspace membership / personal owner / share token)
- Storage behind API; path traversal guarded in local storage
- Upload size + MIME allowlist
- Soft-delete + link revoke; trash permanent-delete queue
- Public registration disabled; admin-provisioned users
- API namespaced under `/api` behind the gateway

## Product improvement

**Password-protected share links** — built end-to-end (API + UI + tests). External sharing is the highest-risk flow; a link password is a realistic control without forcing outsiders to create accounts.

## How I worked with the coding agent

**Agent:** Cursor (Composer).

**Delegated**

- Scaffolding Express/Prisma/React and Docker/nginx wiring
- Implementing routes, schema, and UI from an agreed product plan
- Integration tests for authz / share / invite
- Reusable UI pieces (e.g. searchable dropdown) and activity scoping

**Where I steered / corrected**

- Locked Express + Postgres and shipped a full Docker Compose stack
- Chose copy-link + public access for outsiders (optional password) instead of forcing signup
- Required a storage abstraction instead of writing files ad hoc in handlers
- Kept authorization in a shared access module
- Mounted the API under `/api` so browser routes and the gateway do not collide

**What I’d watch in review**

- Every document download path goes through access checks or a validated share token
- Share and invite tokens are random, not sequential IDs
- README decisions match the code (especially admin seed and `/api` routing)

## API sketch

- `POST /api/auth/login|logout`, `GET /api/auth/me` (public register disabled)
- `GET/POST /api/users` (admin), platform role / disable / enable
- `GET /api/dashboard` (stats + scoped recent activity)
- `POST /api/documents`, download, trash, OnlyOffice preview
- `GET/POST /api/workspaces`, members, invitations, folders, contents
- `GET/POST /api/shares/...` (internal / external / mine / with-me)

- `GET /api/audit-trails/documents/:id`
- `GET /api/invites/:token`, `POST /api/invites/:token/accept`
- `GET /api/s/:token`, `POST /api/s/:token/unlock`, `GET /api/s/:token/download`
