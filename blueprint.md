# Project Blueprint

## Project Description
This is a NestJS (Node.js + TypeScript) BFF (Backend for Frontend) service that provides authentication, user management, business listing, and AI-assisted review composition APIs. It integrates with the Zembra API for multi-network business lookup and with a FastAPI AI backend (pv-ai, running at `http://localhost:8000`) for Whisper transcription and conversational review drafting. Backed by PostgreSQL (via Prisma) and Redis, with Docker support for local development.

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
- FastAPI AI backend integration (`@nestjs/axios`, `form-data` for multipart audio upload)
- BullMQ async job queue (review posting simulation)

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

### Phase 2 Extension — Reviews Dashboard & Enhanced Filtering

#### New endpoints
- `GET /reviews/dashboard` — summary for the authenticated user: `total_reviews`, `by_status` (draft/pending/published/simulated counts), `recent_reviews` (last 5, with business name, rating, status, created_at), `top_businesses` (top 3 by review count with business name)
- `GET /reviews/stats` — aggregate statistics: `average_rating`, `most_reviewed_category` (most reviewed `business_type`), `this_month` / `last_month` review counts, `languages` (count per language code)
- Both routes placed before `GET /reviews/:id` in the controller to prevent NestJS from matching the literal strings as `:id` params

#### Enhanced `GET /reviews`
- Added query params: `business_id` (UUID filter), `search` (case-insensitive substring match on `review_text`), `sort_by` (`created_at | rating | updated_at`), `sort_order` (`asc | desc`)
- `limit` now capped at 50 via `@Max(50)` in the DTO and `Math.min(limit, 50)` in the service
- Switched from `include` to top-level `select` to avoid fetching unused fields (`intent`, `deleted_at`, `user_id`, etc.)
- Response meta field renamed `last_page` → `total_pages` to match the spec

#### Database indexes
- Migration `20260518202432_add_review_indexes` applied; 4 new indexes on the `reviews` table:
  - `@@index([user_id])` — filters all user-scoped queries
  - `@@index([status])` — status filter in findAll / dashboard groupBy
  - `@@index([created_at])` — default sort column; monthly date-range filters in stats
  - `@@index([listing_id])` — listing filter in findAll

#### Implementation notes
- Dashboard and stats methods fire all sub-queries with `Promise.all` for maximum parallelism; dashboard makes a second sequential query only to resolve business names for the top-3 groupBy result
- `most_reviewed_category` uses a single `$queryRaw` JOIN+GROUP BY instead of fetching all reviews into JS — Prisma's `groupBy` does not support grouping by related fields
- Spec test for `last_page` in `reviews.service.spec.ts` updated to `total_pages`; `tsc --noEmit` passes with no errors

### Phase 2 Extension — Mock Posting Simulation (BullMQ)

#### Infrastructure
- Installed `@nestjs/bullmq` and `bullmq`
- Added `redis:7-alpine` service to `docker-compose.yaml` (port 6379, health-checked); backend `depends_on` Redis
- `BullModule.forRootAsync` configured in `AppModule` using `ConfigService` to read `REDIS_HOST` / `REDIS_PORT` from `.env`
- Queue named `"review-posting"` registered in `ReviewsModule`; constant + `PostingJobData` interface extracted to `posting.constants.ts`

#### New endpoints
- `POST /reviews/:id/publish` — body: `{ platform_ids: string[] }`. For each network UUID: checks the review belongs to the caller (403 otherwise), looks for a `review_drafts` row with `is_selected = true`, checks `network_preferences.supports_api_posting`, then creates a `review_platform_posts` record with `status = 'queued'` and enqueues a BullMQ job. Returns immediately with `{ queued: string[], skipped: { network, reason }[] }`.
- `POST /reviews/:id/publish/retry` — finds all `review_platform_posts` with `status = 'failed'` for the review, increments `retry_count`, resets `status` to `'queued'`, and re-adds each job to the queue. Throws 400 if no failed posts exist, 403 if wrong owner.
- `GET /reviews/:id/posts` — returns all `review_platform_posts` for the review mapped to `{ platform, status, posted_at, external_review_id, retry_count, error_message }`. Throws 403 if wrong owner.
- All three endpoints protected by `JwtAuthGuard` and fully documented with Swagger

#### PostingWorker (`posting.worker.ts`)
- `@Processor('review-posting')` extending `WorkerHost`
- On success (`process()`): updates the `review_platform_posts` record to `status = 'simulated'`, sets `posted_at = now`, generates `external_review_id = "SIMULATED-<uuid>"`, updates the parent review's `status` to `'published'`, creates a `notifications` record (`type: 'posting'`, `is_sent: true`), logs `[PostingWorker] <review_id> posted to <network_name>`
- Job options: `attempts: 3`, `backoff: { type: 'exponential', delay: 2000 }`
- On final failure (`@OnWorkerEvent('failed')`): guard checks `job.attemptsMade >= job.opts.attempts`; if true, updates post `status` to `'failed'`, stores `error_message`, logs `[PostingWorker] FAILED <review_id> on <network_name> after 3 attempts`

#### Design decisions
- `review_platform_posts` record is created in `publish()` (not the worker) so that `post_id` travels in the job payload — the worker always calls `update`, never `create`. This ensures `retryFailed` always has a stable row to increment `retry_count` on.
- `UserPlatformAccount` FK (`user_platform_account_id`) is required by the schema. At publish time the service does `findFirst` for an active account for that user+network; if none exists it creates a placeholder (`is_active: false`) to satisfy the constraint without breaking the simulation.
- 7 new Jest unit tests added to `reviews.service.spec.ts`; `beforeEach` extended with queue mock (`getQueueToken`) and new Prisma model mocks (`network`, `reviewDraft`, `userPlatformAccount`, `reviewPlatformPost`, `notification`).
- New `posting.worker.spec.ts` added with 5 tests: `process()` sets `status = 'simulated'` + correct fields on the platform post, updates the review to `'published'`, creates the notification row; `onFailed()` sets `status = 'failed'` only on the final attempt and leaves the record untouched while retries remain.
- 403 coverage completed: `retryFailed` and `getPosts` each have an explicit `ForbiddenException` test for wrong-owner access (matching the existing `publish` 403 test).
- All 50 tests across 4 suites pass at this point; total rose to 60 after the AI Review Composer phase.

### Phase 3 — AI Review Composer

#### Overview
Wires the BFF to the FastAPI `pv-ai` backend (`FASTAPI_URL=http://localhost:8000`) so users can transcribe an audio recording into a review draft, refine it through a multi-turn AI chat, and approve the final text — all from a single review record.

#### New module: `AiModule` / `AiService`
- `src/ai/ai.service.ts` — thin HTTP proxy over FastAPI using `@nestjs/axios`. A private `post()` helper maps FastAPI errors: non-2xx responses become **502 Bad Gateway**; unreachable host (ECONNREFUSED / timeout) becomes **503 Service Unavailable** with message `"AI service temporarily unavailable"`.
- `src/ai/ai.module.ts` — wraps `HttpModule`, exports `AiService`. Imported by `ReviewsModule`.
- Five `AiService` methods and their FastAPI counterparts:

| Method | FastAPI endpoint | Returns |
|---|---|---|
| `transcribeAudio(buffer, language, mimetype)` | `POST /api/transcribe` | `{ transcript, detected_language }` |
| `startChat(reviewId, transcript, listingId, language, listingContext)` | `POST /api/chat/start` | `{ session_id, initial_response, detected_language }` |
| `sendMessage(sessionId, message)` | `POST /api/chat/message` | `{ response, session_id }` |
| `approveDraft(sessionId)` | `POST /api/chat/approve` | `{ improved_text, rating, sentiment, tone, key_points }` |
| `endSession(sessionId)` | `POST /api/chat/end` | `{ success }` |

Audio is forwarded as `multipart/form-data` using the `form-data` npm package (already a transitive dep of axios).

#### Schema change
- `ai_session_id String?` added to the `reviews` table; migration `20260519073404_add_ai_session_id` applied.

#### New endpoints (all `JwtAuthGuard`, Swagger tag `AI Review Composer`)

| Method | Route | Description |
|---|---|---|
| `POST` | `/reviews/:id/transcribe` | `multipart/form-data` with field `audio` (file) + optional `language`. Calls `AiService.transcribeAudio`, updates `review_text` and `language` on the review. Returns `{ transcript, detected_language, review_id }`. |
| `POST` | `/reviews/:id/chat/start` | Fetches all active listings for the review's business, builds a `listingContext` object `{ business_name, networks: [{ name, max_chars, supports_api_posting }] }`, calls `AiService.startChat`, stores the returned `session_id` on the review (`ai_session_id`). Returns `{ session_id, initial_response, detected_language, review_id }`. |
| `POST` | `/reviews/:id/chat/message` | Body: `{ message }`. Loads `ai_session_id` from the review (400 if null), calls `AiService.sendMessage`. Returns `{ response, session_id }`. |
| `POST` | `/reviews/:id/chat/approve` | Calls `AiService.approveDraft`, updates review (`review_text`, `rating`, `tone`, `status = 'pending'`, `ai_session_id = null`), calls `reviewDraft.updateMany` for all `is_selected = true` drafts, then calls `AiService.endSession`. Returns `{ improved_text, rating, sentiment, tone, key_points, review_id }`. |
| `GET` | `/reviews/:id/drafts` | Returns all `review_drafts` for the review joined with network name: `{ draft_id, network, draft_text, version, compliance_check, is_selected, created_at }[]`. |

All five endpoints throw **403** if the review belongs to a different user, and **400** on the message/approve routes if no active session exists.

#### Implementation notes
- `listingContext` is built from **all active listings of the business** (not just the one the review is linked to), so the AI has full awareness of every platform the business is on.
- `approveDraft` stores the `sessionId` in a local variable before clearing it in the DB update, so `endSession` can still use it after the DB record is already cleaned up.
- File upload uses `FileInterceptor('audio')` from `@nestjs/platform-express` (multer in-memory storage); `file.buffer` and `file.mimetype` are forwarded directly to `AiService`.
- `@types/multer` added as a dev dependency.

#### Tests
- `AiService` mock (`transcribeAudio`, `startChat`, `sendMessage`, `approveDraft`, `endSession`) added to `reviews.service.spec.ts` `beforeEach`.
- Prisma mock extended with `listing.findMany`, `reviewDraft.findMany`, `reviewDraft.updateMany`.
- 10 new test cases: happy-path and 403/400 error cases for all five new service methods.
- **60 tests across 4 suites — all passing.**

### Phase 3 Extension — pv-ai JWT Relay (Part 2)

#### Overview
Secures all BFF → pv-ai HTTP calls with per-user Bearer tokens obtained via a service-to-service relay endpoint on pv-ai. Before this change, AI calls were unauthenticated; pv-ai's `get_current_user()` returned a hardcoded test user. Now each call carries a real JWT scoped to the requesting user.

#### What changed

**`src/ai/ai.service.ts`**
- Added `private readonly tokenCache: Map<string, { token: string; expiresAt: number }>` — in-process per-user token store, initialized empty in constructor.
- Added `private async getPvAiToken(userId)` — checks cache first; on miss calls `POST {FASTAPI_URL}/api/auth/token/relay` with `X-BFF-Secret` header; stores result with `expiresAt = now + 25 min`; throws 503 if relay call fails.
- Added `private async getAuthHeaders(userId)` — returns `{ Authorization: Bearer <token> }`.
- Updated all 5 methods (`transcribeAudio`, `startChat`, `sendMessage`, `approveDraft`, `endSession`) to accept `userId: string` as their last parameter and pass `await this.getAuthHeaders(userId)` in the headers of every HTTP call.
- Reads `PJAI_SHARED_SECRET` from `ConfigService`.

**`src/reviews/reviews.service.ts`**
- All 5 calls to `AiService` methods now pass `userId` as the last argument. No other logic changed.

**`.env` / `.env.example`**
- Added `PJAI_SHARED_SECRET` (real value in `.env`; placeholder in `.env.example`).
- Corrected `FASTAPI_URL` from port 8000 to port 5000 to match pv-ai's actual listen port.

#### Design decisions
- **25-min cache TTL** — pv-ai tokens expire in 30 min; caching at 25 min ensures the BFF never presents a token within the last 5 min of its validity window, eliminating clock-skew races.
- **Cache scope is process-lifetime** — the `Map` lives in the `AiService` singleton. A server restart clears all cached tokens; users incur one relay round-trip on their next AI request. Acceptable trade-off over shared Redis cache for a single-instance deployment.
- **Relay error → 503, not 502** — a relay failure means the auth sidecar is unreachable (infrastructure problem), not that the AI request itself returned an error. 503 correctly signals "service unavailable" to the caller.

#### Tests
- `reviews.service.spec.ts` — 4 `toHaveBeenCalledWith` assertions updated to include `USER_ID` as the last argument (`transcribeAudio`, `startChat`, `sendMessage`, `endSession`). All 60 tests continue to pass.

## Planned Tasks
- Role and permission management APIs
- User preferences and consent management endpoints
