# Project Blueprint

## Project Description
This is a NestJS (Node.js + TypeScript) BFF (Backend for Frontend) service that provides authentication, user management, and business listing APIs. It integrates with the Zembra API for multi-network business lookup, backed by PostgreSQL (via Prisma) and Redis, with Docker support for local development.

## Skills Used
- TypeScript
- NestJS
- Prisma ORM
- PostgreSQL
- Redis
- JWT authentication (Passport)
- REST API design
- Docker and docker-compose
- Swagger/OpenAPI
- Jest testing
- ESLint and Prettier
- Zembra API integration (`@nestjs/axios`)

## Completed Tasks

### Phase 0 — Foundation
- Database schema: users, credentials, roles, permissions, listings, reviews, businesses, networks, and related models
- Docker compose setup for API, PostgreSQL, and Redis
- JWT authentication: `POST /auth/login` with bcrypt password verification
- SonarQube workflow disabled (pending secret configuration)
- Git history cleaned up and pushed to personal repo (two-branch workflow: `master`/`dev`)

### Phase 1 — Business Lookup (Deliverable 2)
- `GET /listings/search?name=&address=&networks[]=` — calls Zembra `/listing/match`, returns matched listings from requested networks
- `GET /listings/:id` — fetches a saved listing from the database (with business and network relations)
- `POST /listings` — saves a Zembra business result into the DB (upserts business + Zembra network + listing)
- All endpoints protected by `JwtAuthGuard`, documented with Swagger
- 8 Jest unit tests (search, findById, save flows) — all passing
- Docker networking fixed: `extra_hosts` so container reaches local Zembra dev server
- Live test confirmed: Harmony Cuisine 2B1 / OpenTable → rating 4.8, 327 reviews

## How the Zembra API Integration Works Locally

### The short answer
The Zembra project runs as a local server on your Windows machine. Our NestJS app runs inside a Docker container. The challenge was making the container talk to the host machine's local server — and bypassing its self-signed TLS certificate. Here is the full breakdown:

### 1. What `localapi.zembra.io` actually is
`localapi.zembra.io` is **not** a public internet URL — it is a domain that your Windows hosts file (`C:\Windows\System32\drivers\etc\hosts`) maps to `127.0.0.1`. This means when your browser or Postman calls `https://localapi.zembra.io`, it hits a Zembra dev server running on your own machine (the Zembra project, which you already had running in the background).

### 2. Why Docker couldn't reach it (the original ECONNREFUSED error)
Docker containers have their own network namespace. When the container tried to resolve `localapi.zembra.io`, it got `127.0.0.1` — but inside the container, `127.0.0.1` means **the container itself**, not your Windows machine. There is no Zembra server inside the container, so the connection was refused.

### 3. The fix: `extra_hosts` in docker-compose.yaml
```yaml
services:
  backend:
    extra_hosts:
      - "localapi.zembra.io:host-gateway"
```
`host-gateway` is a special Docker keyword that always resolves to the host machine's IP address (the Windows machine running Docker). Adding this line tells the container: "when you see `localapi.zembra.io`, connect to the host machine instead of loopback." The container can then reach the Zembra server running on Windows.

### 4. The TLS fix: self-signed certificate
The local Zembra dev server uses a self-signed HTTPS certificate (not issued by a public CA). Node.js rejects these by default with `DEPTH_ZERO_SELF_SIGNED_CERT`. The fix was configuring the `HttpModule` in `ListingsModule` with a custom HTTPS agent that skips certificate verification:
```typescript
// src/listings/listings.module.ts
HttpModule.register({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
})
```
This only affects HTTP calls made by `ListingsService` — it does not disable TLS verification globally for the app.

### 5. Authentication: Bearer token
Every Zembra API call includes an `Authorization: Bearer <token>` header. The token comes from `ZEMBRA_API_KEY` in `.env`, which is the API key from your Zembra dashboard. It is injected via `ConfigService` and never hard-coded.

### 6. End-to-end flow summary
```
Postman / Frontend
  → POST /auth/login         (get JWT)
  → GET /listings/search     (JWT in header)
       ↓
  NestJS ListingsService
       ↓  Bearer token
  localapi.zembra.io          (Zembra dev server on your Windows host)
       ↓  host-gateway routing (Docker extra_hosts)
  Windows host machine
       ↓  self-signed TLS accepted (rejectUnauthorized: false)
  Zembra /listing/match
       ↓
  Returns matched listings (OpenTable, Google, etc.)
```

### Why you didn't need to "start" the Zembra project manually
The Zembra project was already running on your machine (likely started automatically or previously). You just needed to point our BFF at it correctly — which is what the `extra_hosts` and TLS fixes achieved.

### Phase 2 — Reviews Module (Deliverable 3)
- JWT updated to include `sub: user_id` in the token payload; `JwtStrategy.validate()` now returns `{ user_id, email }` so all controllers can read the caller's identity from `req.user.user_id`
- `POST /reviews` — creates a review draft (status: `draft`) linked to a listing; resolves `business_id` from the listing automatically
- `GET /reviews` — paginated list of the authenticated user's reviews; supports `status`, `listing_id`, `date_from`, `date_to`, `page`, `limit` query filters; response includes `business.name`
- `GET /reviews/:id` — full review details including business, listing (with network), and display_name of the owner
- `PATCH /reviews/:id` — partial update of `review_text`, `rating`, `tone`, `status`, `language`; owner-only (403 otherwise)
- `DELETE /reviews/:id` — soft delete via `deleted_at` timestamp; owner-only; no hard deletes
- All endpoints protected by `JwtAuthGuard` and fully documented with Swagger (`@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`, response/error decorators)
- DTOs with `class-validator`: `CreateReviewDto`, `UpdateReviewDto`, `QueryReviewsDto` (with `@Type(() => Number)` for pagination coercion)
- 12 Jest unit tests covering create, findAll (pagination + all filters), findOne (auth), and remove (soft-delete + auth) — all passing
- `prisma migrate dev` run: DB synced, Prisma Client regenerated (schema already contained the `reviews` table from Phase 0 init)

## Docker Isolation Issue — Shared Volume Between Two Provoc Projects

### The problem

The project exists in two locations on the same machine:

- **Company project** — `\\wsl.localhost\Ubuntu\home\rabie\proVOC\pv-bff` (WSL Ubuntu)
- **Private copy** — `D:\pfe backend\pv-bff` (Windows)

Both projects originally had identical `docker-compose.yaml` files with hardcoded `container_name` values and a named volume called `pgdata`. Docker Compose derives the **project name** from the directory name when no explicit name is set. Since both directories are named `pv-bff`, Docker treated them as the same project and created the same prefixed volume name:

```
pv-bff_pgdata  ←  used by BOTH projects
```

This had two consequences:

1. **Container name clash** — both define `container_name: pv-backend`, `pv-database`, `pv-redis`. Docker refuses to create a container with a name already in use, so the second project to start would always fail.

2. **Shared database volume** — because `pv-bff_pgdata` resolved to the same Docker named volume, both projects wrote to and read from the same PostgreSQL data directory. Migrations, schema changes, or data resets in one project silently affected the other.

This was not obvious because Docker Desktop uses a single daemon shared between WSL2 and Windows, so all containers regardless of which shell started them live in the same space.

### The fix

Added a `name:` field at the top of the **private project's** `docker-compose.yaml` and renamed all container names with a `-local` suffix:

```yaml
name: pv-bff-local          # forces a unique project name

services:
  backend:
    container_name: pv-backend-local
  database:
    container_name: pv-database-local
```

Effect after the fix:

| Resource | Company project | Private project |
|---|---|---|
| Project name | `pv-bff` | `pv-bff-local` |
| DB volume | `pv-bff_pgdata` | `pv-bff-local_pgdata` |
| Backend container | `pv-backend` | `pv-backend-local` |
| DB container | `pv-database` | `pv-database-local` |

The two projects can now coexist in Docker Desktop without any name or data collision. They still cannot run simultaneously on the same port (3001), but they no longer corrupt each other's data when switching between them.

### Migration after the fix

Because the new volume `pv-bff-local_pgdata` is empty, migrations were re-applied inside the running container to rebuild the schema from scratch:

```bash
docker-compose down
docker-compose up -d
docker-compose exec backend npx prisma migrate deploy
```

All 21 tables confirmed created in the isolated `provoc_db` database at `pv-database-local:5432`.

## Planned Tasks
- Role and permission management APIs
- User preferences and consent management endpoints
- Background jobs for sync and notifications
- AI-assisted review generation (integration with pv-ai service)
