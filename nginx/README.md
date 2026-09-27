# BLCKBOX nginx gateway configs

Nginx configs mounted by the **root** full-stack compose files. There is no separate nginx-only compose here.

| Conf | Used by | Domain | TLS |
| ---- | ------- | ------ | --- |
| [`local.conf`](./local.conf) | [`../docker-compose.local.yml`](../docker-compose.local.yml) | `*.blckbox.localapp` | HTTP |
| [`ssl.conf`](./ssl.conf) | [`../docker-compose.ssl.yml`](../docker-compose.ssl.yml) | `blckbox.dms.com` | Pre-placed certs in `/etc/nginx/certs/` |
| [`certbot.conf`](./certbot.conf) | [`../docker-compose.certbot.yml`](../docker-compose.certbot.yml) | `blckbox.dms.com` | Let’s Encrypt |

Upstreams (Docker network): `web:80`, `api:4000`, `onlyoffice:80`.

## Quick start (local)

1. Add hosts (see [`hosts`](./hosts)); example:

```bash
127.0.0.1  app.blckbox.localapp
```

2. From the repo root:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

3. Open http://app.blckbox.localapp

After editing a conf while the gateway is running:

```bash
docker exec blckbox-gateway nginx -s reload
```

## Routing map

| Path | Target |
| ---- | ------ |
| `/api/` | API `:4000` |
| `/socket.io/` | API `:4000` |
| `/onlyoffice/` | OnlyOffice |
| `/` | Web (SPA) |

## SSL / Certbot

See the comments at the top of [`../docker-compose.ssl.yml`](../docker-compose.ssl.yml) and [`../docker-compose.certbot.yml`](../docker-compose.certbot.yml) for cert paths and Let’s Encrypt steps.
