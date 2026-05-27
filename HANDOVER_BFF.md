# pv-bff Handover Report

Generated: 2026-05-19

---

## 1. PROJECT OVERVIEW

### What this project is

`pv-bff` is a **Backend for Frontend (BFF)** service written in NestJS / TypeScript. It acts as the single API gateway for the Provoc mobile/web app. Responsibilities:

- JWT authentication (login, token issuance)
- Business listing lookup via the **Zembra API** (multi-network: Google, TripAdvisor, OpenTable, Yelp, …)
- Saving matched businesses and listings into PostgreSQL
- Review lifecycle management: create draft → AI-compose → publish to platforms
- **AI Review Composer**: audio transcription via Whisper (delegated to a FastAPI `pv-ai` sidecar), multi-turn conversational drafting, draft approval
- Async review posting simulation via **BullMQ / Redis**

### Tech stack — exact versions from package.json

| Package | Version |
|---|---|
| Node.js (Docker image) | 25.2.1 |
| NestJS (`@nestjs/core`) | ^11.0.1 |
| TypeScript | ^5.7.3 |
| Prisma ORM (`@prisma/client`) | ^6.19.2 |
| PostgreSQL (Docker image) | 15.15 |
| Redis (Docker image) | 7-alpine |
| BullMQ (`bullmq`) | ^5.76.10 |
| `@nestjs/bullmq` | ^11.0.4 |
| `@nestjs/jwt` | ^11.0.2 |
| `@nestjs/passport` | ^11.0.5 |
| `passport-jwt` | ^4.0.1 |
| `bcryptjs` | ^2.4.3 |
| `@nestjs/axios` | ^4.0.1 |
| `@nestjs/swagger` | ^11.4.2 |
| `class-validator` | ^0.14.1 |
| `class-transformer` | ^0.5.1 |
| Jest | ^29.7.0 |

### How to run locally

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill env vars
cp .env.example .env
# Edit .env — minimum: DATABASE_URL, JWT_SECRET, ZEMBRA_API_KEY

# 3. Start Docker services (PostgreSQL + Redis; optionally the full stack)
docker-compose up -d

# 4. Run database migrations
npx prisma migrate deploy
# OR (dev mode, creates migration files on schema change):
npx prisma migrate dev

# 5. Start in watch mode
npm run start:dev

# API available at http://localhost:3001
# Swagger UI at http://localhost:3001/api
```

### Environment variables required

| Variable | Example / Default | Required | Purpose |
|---|---|---|---|
| `NODE_ENV` | `development` | Yes | Controls NestJS environment |
| `PORT` | `3001` | Yes | HTTP listen port |
| `DATABASE_URL` | `postgresql://postgres:root@localhost:5432/provoc_db` | Yes | Prisma connection string |
| `DB_HOST` | `localhost` | Yes (compose) | Postgres host for compose health-check |
| `DB_HOST_DOCKER` | `database` | Yes (compose) | Docker-internal host name |
| `DB_PORT` | `5432` | Yes | Postgres port |
| `DB_USER` | `postgres` | Yes | Postgres user |
| `DB_PASSWORD` | `root` | Yes | Postgres password |
| `DB_NAME` | `provoc_db` | Yes | Postgres database name |
| `JWT_SECRET` | any strong random string | Yes | Signing key for JWT tokens |
| `JWT_EXPIRES_IN` | `7d` | No (default `24h`) | Token lifespan |
| `REDIS_HOST` | `localhost` | Yes | BullMQ Redis host |
| `REDIS_PORT` | `6379` | Yes | BullMQ Redis port |
| `REDIS_PASSWORD` | (empty) | No | Redis auth password |
| `ZEMBRA_API_KEY` | Bearer token from Zembra dashboard | Yes | Authenticates calls to Zembra |
| `ZEMBRA_BASE_URL` | `https://localapi.zembra.io` (dev) / `https://beta.api.zembra.io` (staging) | Yes | Zembra base URL |
| `FASTAPI_URL` | `http://localhost:8000` | Yes | URL of the `pv-ai` FastAPI sidecar |

**Important:** the `.env` file in the repo contains a real `ZEMBRA_API_KEY` — do **not** commit this key to a public repo.

### Docker setup

`docker-compose.yaml` defines three services:

| Service | Container | Image | Port |
|---|---|---|---|
| `backend` | `pv-backend-local` | `./Dockerfile` (Node 25) | `${PORT}:${PORT}` |
| `database` | `pv-database-local` | `postgres:15.15` | (internal) |
| `redis` | `pv-redis-local` | `redis:7-alpine` | `6379:6379` |

The compose file has `name: pv-bff-local` to prevent Docker volume collisions with the company copy of the project (which runs under the name `pv-bff`). See [Section 8](#8-important-decisions-made) for full details.

Backend waits for both `database` and `redis` health-checks before starting. The `extra_hosts` entry (`localapi.zembra.io:host-gateway`) routes Zembra API calls from the container to the host machine.

---

## 2. COMPLETED FEATURES

### Module: Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/login` | Public | Validates email + bcrypt password against `user_credentials`; returns a signed JWT |

**Database tables touched:** `users`, `user_credentials`

**JWT payload:** `{ sub: user_id, email }`  
**Token expiry:** configurable via `JWT_EXPIRES_IN` (default `7d`)

**Test file:** No dedicated spec for `AuthService` currently. Auth is covered indirectly in `test/auth.e2e-spec.ts`.

---

### Module: Listings

**All endpoints require `Authorization: Bearer <JWT>`**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/listings/search` | JWT | Calls Zembra `/listing/match` with `?name=&address=&networks[]=`; returns raw Zembra response |
| `GET` | `/listings/:id` | JWT | Fetches a saved listing from DB (includes `business` and `network`) |
| `POST` | `/listings` | JWT | Saves a Zembra result: upserts `business` + `network` + `listing` records |

**Database tables touched:** `listings`, `businesses`, `networks`

**Test file:** [src/listings/listings.service.spec.ts](src/listings/listings.service.spec.ts) — **8 unit tests** (search, findById, save with existing/new network/business, 404 case)

---

### Module: Reviews

**All endpoints require `Authorization: Bearer <JWT>`**

#### Core CRUD

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/reviews` | JWT | Create a review draft (`status: 'draft'`); auto-resolves `business_id` from the listing |
| `GET` | `/reviews` | JWT | Paginated list (owner-scoped); filters: `status`, `listing_id`, `business_id`, `date_from`, `date_to`, `search`; sort by `created_at`, `rating`, `updated_at`; max 50/page |
| `GET` | `/reviews/dashboard` | JWT | Summary: `total_reviews`, `by_status`, `recent_reviews` (last 5), `top_businesses` (top 3) |
| `GET` | `/reviews/stats` | JWT | Aggregates: `average_rating`, `most_reviewed_category`, `this_month`, `last_month`, `languages` |
| `GET` | `/reviews/:id` | JWT | Full review details with `business`, `listing.network`, `user.display_name` |
| `PATCH` | `/reviews/:id` | JWT | Partial update of `review_text`, `rating`, `tone`, `status`, `language` — owner only (403 otherwise) |
| `DELETE` | `/reviews/:id` | JWT | Soft-delete (`deleted_at = now()`) — owner only; no hard deletes |

#### Publishing

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/reviews/:id/publish` | JWT | Body: `{ platform_ids: string[] }`. Checks for selected draft + `supports_api_posting` per network, creates `review_platform_posts` record (`status: 'queued'`), enqueues BullMQ job. Returns `{ queued, skipped }` immediately |
| `POST` | `/reviews/:id/publish/retry` | JWT | Re-queues all `review_platform_posts` where `status = 'failed'`; increments `retry_count` |
| `GET` | `/reviews/:id/posts` | JWT | Lists all platform post records for a review |

#### AI Review Composer

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/reviews/:id/transcribe` | JWT | `multipart/form-data` with `audio` file field + optional `language`. Calls pv-ai Whisper transcription; updates `review_text` and `language` on the review |
| `POST` | `/reviews/:id/chat/start` | JWT | Starts AI chat session; builds `listingContext` from all active listings of the business; stores `session_id` on the review |
| `POST` | `/reviews/:id/chat/message` | JWT | Body: `{ message }`. Sends chat turn to pv-ai; requires active `ai_session_id` (400 if none) |
| `POST` | `/reviews/:id/chat/approve` | JWT | Calls pv-ai approve endpoint; updates review (`review_text`, `rating`, `tone`, `status: 'pending'`); ends session |
| `GET` | `/reviews/:id/drafts` | JWT | Lists all `review_drafts` with network name |

**Database tables touched:** `reviews`, `review_drafts`, `review_platform_posts`, `review_histories`, `notifications`, `businesses`, `listings`, `networks`, `user_platform_accounts`

**Test files:**
- [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) — **~50 unit tests** covering all service methods including all 403/400 error branches
- [src/reviews/posting.worker.spec.ts](src/reviews/posting.worker.spec.ts) — **5 unit tests** for BullMQ worker (success, notification creation, `onFailed` with retry guard)

**Total across all 4 suites: 60 tests, all passing.**

---

## 3. DATABASE SCHEMA

Schema file: [prisma/schema.prisma](prisma/schema.prisma)

### Models

| Model | Table | Key Fields |
|---|---|---|
| `User` | `users` | `user_id` (PK, UUID), `display_name`, `language` (default `fr`), `age_verified`, `is_active`, timestamps |
| `UserCredential` | `user_credentials` | `credential_id` (PK), `user_id` (FK, unique), `email` (unique), `password_hash`, timestamps |
| `UserPreference` | `user_preferences` | `pref_id` (PK), `user_id` (FK, unique), `default_tone`, `preferred_networks` (JSON), `review_reminder_delay`, `location_tracking` |
| `UserPlatformAccount` | `user_platform_accounts` | `account_id` (PK), `user_id` (FK), `network_id` (FK), `oauth_token`, `refresh_token`, `token_expires_at`, `is_primary`, `external_user_id`, `is_active`, `connected_at` |
| `UserActivityStats` | `user_activity_stats` | `stat_id` (PK), `user_id` (FK, unique), `reputation_score`, `total_reviews`, `most_reviewed_category`, `total_arbitrations`, `last_calculated_at` |
| `DataConsent` | `data_consent` | `consent_id` (PK), `user_id` (FK), `consent_type`, `is_given`, `given_at`, `revoked_at`, `version`, `ip_address` |
| `Role` | `roles` | `role_id` (PK), `name` (unique), `description`, `is_system` |
| `Permission` | `permissions` | `permission_id` (PK), `name` (unique), `resource`, `action` |
| `RolePermission` | `role_permissions` | `role_perm_id` (PK), `role_id` (FK), `permission_id` (FK) |
| `UserRole` | `user_roles` | `user_role_id` (PK), `user_id` (FK), `role_id` (FK), `assigned_by` (FK nullable), `assigned_at`, `expires_at` |
| `Business` | `businesses` | `business_id` (PK), `name`, `parent_business_id` (self-FK, nullable), `business_type`, `is_online_only`, `is_claimed`, `is_active`, `public_page_slug` (unique), `qr_code_url`, `avg_rating` (Decimal 3,2), `total_reviews`, `address`, `latitude` (Decimal 10,8), `longitude` (Decimal 11,8) |
| `Listing` | `listings` | `listing_id` (PK), `business_id` (FK), `network_id` (FK), `external_listing_id`, `external_rating` (Decimal 3,2), `external_url`, `is_active`, `last_synced_at` |
| `Network` | `networks` | `network_id` (PK), `name` (VarChar 100), `base_url`, `logo_url`, `is_active` |
| `NetworkPreference` | `network_preferences` | `network_pref_id` (PK), `network_id` (FK, unique), `max_chars_post`, `min_chars_post`, `rating_type`, `rating_scale_min/max`, `rating_options` (JSON), `has_profanity_filter`, `supports_api_posting`, `post_auth_type`, `requires_verified_account`, `allows_media_in_review`, `max_media_count`, `supports_update_review`, `supports_delete_review`, `max_chars_reply`, `min_chars_reply`, `supports_api_reply`, `reply_auth_type`, `reply_requires_ownership` |
| `Review` | `reviews` | `review_id` (PK), `user_id` (FK), `business_id` (FK), `listing_id` (FK, nullable), `review_text`, `rating` (Int), `status`, `tone`, `intent`, `language` (VarChar 10), `ai_session_id` (nullable), `deleted_at` (nullable, soft-delete) |
| `ReviewDraft` | `review_drafts` | `draft_id` (PK), `review_id` (FK), `network_id` (FK, nullable), `version` (default 1), `draft_text`, `compliance_check`, `is_selected` |
| `ReviewMedia` | `review_medias` | `media_id` (PK), `review_id` (FK), `media_type`, `s3_key`, `original_filename`, `file_size_bytes`, `mime_type`, `thumbnail_url` |
| `ReviewHistory` | `review_histories` | `history_id` (PK), `review_id` (FK), `previous_status`, `new_status`, `snapshot_text`, `changed_by_type`, `changed_by_id`, `reason` |
| `ReviewPlatformPost` | `review_platform_posts` | `post_id` (PK), `review_id` (FK), `network_id` (FK), `listing_id` (FK, nullable), `user_platform_account_id` (FK), `external_review_id`, `status`, `platform_specific_text`, `scheduled_at`, `posted_at`, `retry_count`, `likes_count`, `error_message` |
| `Notification` | `notifications` | `notification_id` (PK), `user_id` (FK), `type`, `category`, `title`, `body`, `data` (JSON), `is_read`, `is_sent`, `sent_at`, `scheduled_for` |

### Relations

```
User 1──* Review
User 1──1 UserCredential
User 1──1 UserPreference
User 1──1 UserActivityStats
User 1──* DataConsent
User 1──* Notification
User 1──* UserPlatformAccount
User 1──* UserRole (as subject)
User 1──* UserRole (as assigner)

Business 1──* Listing
Business 1──* Review
Business 0──* Business (self-relation: parent_business / sub_businesses chain)

Network 1──* Listing
Network 1──* UserPlatformAccount
Network 1──* ReviewDraft
Network 1──* ReviewPlatformPost
Network 1──1 NetworkPreference

Listing 1──* Review
Listing 1──* ReviewPlatformPost

Review 1──* ReviewDraft
Review 1──* ReviewHistory
Review 1──* ReviewMedia
Review 1──* ReviewPlatformPost

ReviewPlatformPost *──1 UserPlatformAccount

Role 1──* RolePermission
Role 1──* UserRole
Permission 1──* RolePermission
```

### Indexes

Defined in [prisma/schema.prisma](prisma/schema.prisma) via migration `20260518202432_add_review_indexes`:

```
reviews: @@index([user_id])     — all owner-scoped queries
reviews: @@index([status])      — status filter in findAll / dashboard groupBy
reviews: @@index([created_at])  — default sort column; monthly stats filters
reviews: @@index([listing_id])  — listing filter in findAll
```

Plus implicit unique indexes on:
- `user_credentials.email`
- `user_credentials.user_id`
- `user_preferences.user_id`
- `user_activity_stats.user_id`
- `network_preferences.network_id`
- `businesses.public_page_slug`
- `roles.name`
- `permissions.name`

---

## 4. CURRENT FILE STRUCTURE

```
d:\pfe backend\pv-bff/
├── .env                             # Local dev env vars (contains real Zembra key — do not commit publicly)
├── .env.example                     # Template with placeholder values
├── .gitignore
├── blueprint.md                     # Running project log: decisions, phases, architecture notes
├── docker-compose.yaml              # PostgreSQL 15 + Redis 7 + NestJS backend
├── Dockerfile                       # Multi-stage Node 25 image; runs start:dev in container
├── nest-cli.json                    # NestJS CLI config; sourceRoot=src
├── package.json                     # Dependencies and npm scripts
├── package-lock.json
├── tsconfig.json                    # Base TS config; target ES2021, emitDecoratorMetadata
├── tsconfig.build.json              # Extends base; excludes tests and node_modules
├── prisma/
│   ├── schema.prisma                # Full DB schema; 21 models / tables
│   ├── prisma.config.ts             # Prisma config entrypoint
│   └── migrations/
│       ├── 20260310132406_init/             # Initial schema: all 19 base tables
│       ├── 20260312000001_add_user_credentials/   # Adds user_credentials table
│       ├── 20260518202432_add_review_indexes/     # 4 performance indexes on reviews
│       └── 20260519073404_add_ai_session_id/      # Adds ai_session_id column to reviews
├── src/
│   ├── main.ts                      # Bootstrap: creates NestJS app, GlobalPipes, Swagger, listen
│   ├── app.module.ts                # Root module: imports ConfigModule, BullModule, all feature modules
│   ├── app.controller.ts            # Health check: GET / and GET /test-db
│   ├── app.service.ts               # Returns "Hello World!" and DB connection check
│   ├── app.controller.spec.ts       # 1 unit test for root controller
│   ├── prisma/
│   │   ├── prisma.module.ts         # @Global module; exports PrismaService to all modules
│   │   └── prisma.service.ts        # PrismaClient wrapper with onModuleInit/Destroy lifecycle
│   ├── auth/
│   │   ├── auth.module.ts           # JwtModule.registerAsync + PassportModule; exports strategy
│   │   ├── auth.service.ts          # login(): looks up UserCredential, bcrypt.compare, signs JWT
│   │   ├── auth.controller.ts       # POST /auth/login
│   │   ├── dto/
│   │   │   └── login.dto.ts         # { email: @IsEmail, password: @IsString @MinLength(8) }
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts    # @Injectable AuthGuard('jwt') — applied per-controller
│   │   └── strategies/
│   │       └── jwt.strategy.ts      # Extracts Bearer token; validates → returns { user_id, email }
│   ├── listings/
│   │   ├── listings.module.ts       # HttpModule with rejectUnauthorized:false for Zembra TLS
│   │   ├── listings.service.ts      # search(), findById(), save() methods
│   │   ├── listings.controller.ts   # GET /listings/search, GET /listings/:id, POST /listings
│   │   ├── listings.service.spec.ts # 8 unit tests for ListingsService
│   │   └── dto/
│   │       ├── search-listings.dto.ts  # { name, address, networks[]? } with @Transform for arrays
│   │       └── save-listing.dto.ts     # { external_listing_id, name, address?, business_type?, ... }
│   ├── reviews/
│   │   ├── reviews.module.ts        # Imports PrismaModule, AiModule, BullMQ queue registration
│   │   ├── reviews.service.ts       # All 14 service methods (576 lines)
│   │   ├── reviews.controller.ts    # All 16 API endpoints with full Swagger decoration (411 lines)
│   │   ├── reviews.service.spec.ts  # ~50 unit tests for ReviewsService
│   │   ├── posting.worker.ts        # BullMQ @Processor; simulates posting + notifications
│   │   ├── posting.worker.spec.ts   # 5 unit tests for PostingWorker
│   │   ├── posting.constants.ts     # POSTING_QUEUE constant + PostingJobData interface
│   │   └── dto/
│   │       ├── create-review.dto.ts    # { listing_id, review_text, rating, tone?, language? }
│   │       ├── update-review.dto.ts    # All fields optional; status enum validated
│   │       ├── query-reviews.dto.ts    # Pagination + filters with @Type coercions
│   │       └── publish-review.dto.ts  # { platform_ids: string[] } validated as UUID array
│   └── ai/
│       ├── ai.module.ts             # HttpModule + AiService; exported for ReviewsModule
│       └── ai.service.ts            # HTTP proxy to pv-ai: transcribe, startChat, sendMessage, approveDraft, endSession
└── test/
    ├── app.e2e-spec.ts              # Basic e2e: GET / health check
    ├── auth.e2e-spec.ts             # Auth e2e: login, JWT verification flows
    └── jest-e2e.json                # Jest config for e2e tests
```

---

## 5. WHAT WORKS RIGHT NOW

### Auth

**Login**
```
POST /auth/login
Content-Type: application/json

{ "email": "user@example.com", "password": "mypassword" }

→ 200 { "access_token": "eyJhbGci..." }
→ 401 if email not found, wrong password, or account inactive
```

---

### Listings — Zembra integration

**Search (calls Zembra live)**
```
GET /listings/search?name=Harmony+Cuisine+2B1&address=3904+Convoy+St+117%2C+San+Diego%2C+CA+92111&networks[]=opentable
Authorization: Bearer <token>

→ 200  Zembra raw response (listing objects per network with ratings, review counts, URLs)
```

Confirmed working live: Harmony Cuisine 2B1 / OpenTable → rating 4.8, 327 reviews.

**Save listing**
```
POST /listings
Authorization: Bearer <token>
Content-Type: application/json

{
  "external_listing_id": "zembra-biz-001",
  "name": "Harmony Cuisine 2B1",
  "address": "3904 Convoy St 117, San Diego, CA 92111",
  "business_type": "restaurant",
  "external_rating": 4.8,
  "external_url": "https://opentable.com/...",
  "latitude": 32.8122,
  "longitude": -117.1497
}

→ 201  { listing_id, business: { name, address }, network: { name } }
```

Note: `POST /listings` is idempotent on `external_listing_id` — re-posting the same ID returns the existing record.

---

### Reviews

**Create review draft**
```
POST /reviews
Authorization: Bearer <token>

{ "listing_id": "<uuid>", "review_text": "Very good!", "rating": 4, "tone": "polite", "language": "en" }

→ 201  Review object with status "draft", business name, listing external_url
→ 404  if listing_id does not exist
```

**List reviews with filters**
```
GET /reviews?status=draft&page=1&limit=10&sort_by=rating&sort_order=desc
Authorization: Bearer <token>

→ 200 {
  data: [ { review_id, business: { name }, rating, status, ... } ],
  meta: { total, page, limit, total_pages }
}
```

**Dashboard**
```
GET /reviews/dashboard
Authorization: Bearer <token>

→ 200 {
  total_reviews: 12,
  by_status: { draft: 5, pending: 2, published: 3, simulated: 2 },
  recent_reviews: [ { review_id, business_name, rating, status, created_at } ],
  top_businesses: [ { business_id, name, review_count } ]
}
```

**Publish (enqueue)**
```
POST /reviews/<review-id>/publish
Authorization: Bearer <token>

{ "platform_ids": ["<network-uuid>"] }

→ 201 { queued: ["Google"], skipped: [{ network: "Yelp", reason: "No selected draft for this platform" }] }
```
The BullMQ worker fires async: marks post as `simulated` 
(status transitions: `queued` → `simulated` on success, 
`queued` → `failed` after 3 failed attempts), sets 
`external_review_id = "SIMULATED-<uuid>"`, flips review 
status to `published`, creates a notification.

**AI transcription**
```
POST /reviews/<review-id>/transcribe
Authorization: Bearer <token>
Content-Type: multipart/form-data

audio: <binary file>
language: "fr"

→ 201 { transcript: "...", detected_language: "fr", review_id: "..." }
```

Requires the `pv-ai` FastAPI sidecar running at `FASTAPI_URL`.

### Known working integrations

- **Zembra API** — live lookup confirmed (`GET /listings/search`)
- **PostgreSQL** — all 4 migrations applied, 21 tables created
- **Redis / BullMQ** — queue connects and jobs are processed by `PostingWorker`
- **pv-ai FastAPI sidecar** — HTTP proxy tested; 502/503 error mapping works correctly
- **pv-ai JWT relay** — BFF relays user identity via shared secret, tokens cached 25 min per user

---

## 6. WHAT IS NOT DONE YET

### Missing from the blueprint

1. **Role and permission management APIs** — `roles`, `permissions`, `role_permissions`, `user_roles` tables exist in the schema but there are no API endpoints to create roles, assign permissions, or assign roles to users. No RBAC enforcement exists on any endpoint.

2. **User preferences and consent management endpoints** — `user_preferences`, `data_consent` tables exist but have no API. Users cannot set their `default_tone`, `preferred_networks`, or manage GDPR consent.

3. **User registration endpoint** — there is no `POST /auth/register` or any way to create a `User` + `UserCredential` record via the API. To log in, a user must be seeded directly into the database.
**Workaround until implemented:** insert a test user manually 
using the SQL snippet in Section 10 Step 6. The bcrypt hash 
in that snippet corresponds to the password `password123`.

4. **User platform account management** — `user_platform_accounts` (OAuth tokens for platforms) cannot be created/managed via API. The `publish` flow creates a placeholder account automatically but real OAuth is not implemented.

5. **`NetworkPreference` seeding** — `supports_api_posting` must be `true` in `network_preferences` for a platform to pass the publish check. There is no API or seed script to create these records; they must be inserted manually.

6. **Media upload** — `review_medias` table exists but there is no `POST /reviews/:id/media` endpoint. The `ReviewMedia` model references an `s3_key` field; no S3 integration exists.

7. **`ReviewHistory` tracking** — the table exists but no code writes to it. Status changes from `update()`, `remove()`, `publish()`, and `approveDraft()` are not logged.

8. **`UserActivityStats` calculation** — the table exists but no service calculates or updates it.

9. **Real platform posting** — all posting is simulated. The worker sets `status = 'simulated'` with a fake `external_review_id`. There is no real API call to Google/Yelp/etc.

10. **Real OAuth for platform accounts** — `UserPlatformAccount.oauth_token` / `refresh_token` fields exist but are never populated.

11. **Notifications delivery** — notifications are created in the DB but never pushed (no WebSocket, no FCM, no email).

12. **`GET /test-db`** — the debug endpoint in `AppController` is still live in production. It should be removed or gated.

### Incomplete / known issues

- `tsconfig.json` has `strictNullChecks: false` and `noImplicitAny: false`. These relaxed settings mask potential type bugs. Should be tightened before going to production.
- The Dockerfile CMD is `npm run start:dev` (watch mode) — this should use `start:prod` for a real production image.
- No rate limiting on `POST /auth/login` — brute-force attacks are possible.
- No input sanitisation on `review_text` — XSS is not a concern server-side but worth noting.
- `ZEMBRA_API_KEY` is committed in `.env` in git history — rotate it if the repo is ever made public.
- `listing_id` is nullable on `Review`. If a user creates a review without a listing (edge case not exposed by the current DTO), `business_id` would be unset.

---

## 7. NEXT STEPS IN PRIORITY ORDER

### 1. User registration (`POST /auth/register`)

**Why first:** nothing works end-to-end without being able to create users via the API.

**Files to touch:**
- Create `src/auth/dto/register.dto.ts` — `{ display_name, email, password }`
- Edit [src/auth/auth.service.ts](src/auth/auth.service.ts) — add `register()` method: create `User` then `UserCredential` (bcrypt hash password, salt rounds = 10)
- Edit [src/auth/auth.controller.ts](src/auth/auth.controller.ts) — add `POST /auth/register`

**Complexity:** Low (1–2 hours)

---

### 2. `NetworkPreference` seed / management

**Why:** without a `network_preferences` row where `supports_api_posting = true`, every publish call returns skipped.

**Files to touch:**
- Add a Prisma seed script `prisma/seed.ts` that creates a test Network + NetworkPreference
- Or add `POST /admin/networks` endpoint (basic, auth-gated)

**Complexity:** Low (1 hour for seed; Medium for full admin API)

---

### 3. Role and permission management APIs

**What:** CRUD for roles and permissions; assign roles to users; enforce RBAC via a custom `RolesGuard`.

**Files to touch:**
- Create `src/roles/` module with `roles.controller.ts`, `roles.service.ts`, `roles.module.ts`
- Create `src/auth/guards/roles.guard.ts`
- Create `src/auth/decorators/roles.decorator.ts`

**Complexity:** Medium (half-day)

---

### 4. User preferences and consent endpoints

**What:** `GET/PATCH /users/me/preferences` and `POST /users/me/consent`.

**Files to touch:**
- Create `src/users/` module
- Touch `user_preferences` and `data_consent` tables

**Complexity:** Low–Medium (2–3 hours)

---

### 5. Platform account OAuth connection

**What:** endpoint for users to connect a platform account (store `oauth_token`). Required for real (non-simulated) posting.

**Files to touch:**
- `src/users/users.service.ts` — `connectPlatform()` / `disconnectPlatform()`
- `user_platform_accounts` table

**Complexity:** Medium (depends on OAuth provider complexity)

---

### 6. Real platform posting

**What:** replace the simulation in `PostingWorker.process()` with actual HTTP calls to platform APIs.

**Files to touch:**
- [src/reviews/posting.worker.ts](src/reviews/posting.worker.ts) — replace the DB simulation block with a platform-specific API call
- Possibly create `src/platforms/` service per network

**Complexity:** High (depends on each platform's API)

---

### 7. `ReviewHistory` write-through

**What:** every status change should append a row to `review_histories`.

**Files to touch:**
- [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) — add `prisma.reviewHistory.create()` calls in `update()`, `remove()`, `publish()`, `approveDraft()`

**Complexity:** Low (2 hours)

---

### 8. Tighten TypeScript config

**What:** enable `strictNullChecks` and `noImplicitAny` in [tsconfig.json](tsconfig.json).

**Complexity:** Medium (fixing the type errors that surface)

---

### 9. Fix Dockerfile for production

**What:** change CMD to `node dist/main` (not `npm run start:dev`) and add a proper entrypoint that runs `prisma migrate deploy` before starting.

**Files to touch:**
- [Dockerfile](Dockerfile)

**Complexity:** Low (30 minutes)

---

## 8. IMPORTANT DECISIONS MADE

### Architecture decisions

**1. BFF pattern — single NestJS gateway**
All API consumers (mobile app, web) go through one NestJS service. The pv-ai FastAPI sidecar is internal-only, not exposed to clients. This simplifies auth (only one JWT issuer) and lets us transform/aggregate pv-ai responses before returning them.

**2. Prisma as ORM**
Chosen over TypeORM for its type-safe generated client, clean migration workflow, and first-class PostgreSQL support. Raw SQL is used exactly once (`$queryRaw` in `getStats()` for the most-reviewed category join) because Prisma's `groupBy` cannot group by related fields.

**3. BullMQ for async posting**
Platform posting is intentionally async and non-blocking. The `publish` endpoint returns immediately with `{ queued, skipped }`. The worker handles retries (3 attempts, exponential backoff). The `post_id` is created in the service (not the worker) so the worker always does `update`, never `create` — this makes retries safe because there is always an existing row.

**4. Soft deletes**
Reviews are never hard-deleted. The `deleted_at` field is set and all queries filter `deleted_at: null`. This preserves audit history and makes the `ReviewHistory` table meaningful.

**5. `review_platform_posts` row created before enqueueing**
The platform post record is created synchronously in `ReviewsService.publish()`, not in the worker. This ensures `GET /reviews/:id/posts` shows `status: 'queued'` immediately, and `retryFailed()` always has a stable row to increment `retry_count` on.

**6. `UserPlatformAccount` placeholder on publish**
The schema requires a `user_platform_account_id` FK on every platform post. Since real OAuth is not implemented, the service does `findFirst` for an active account — and if none exists, creates a placeholder (`is_active: false`) to satisfy the constraint. This is clearly a simulation workaround.

---

### Docker isolation — two identical projects

The project exists in two locations:
- **Company repo:** `\\wsl.localhost\Ubuntu\home\rabie\proVOC\pv-bff`
- **This (private) copy:** `D:\pfe backend\pv-bff`

Both have the same directory name `pv-bff`. Without a fix, Docker would use the same project name, leading to:
- Shared `pv-bff_pgdata` volume (both projects write to the same database)
- Container name collisions (`pv-backend`, `pv-database`, `pv-redis` already in use)

**Fix applied to this project's `docker-compose.yaml`:**
```yaml
name: pv-bff-local       # explicit project name
services:
  backend:
    container_name: pv-backend-local
  database:
    container_name: pv-database-local
  redis:
    container_name: pv-redis-local
```

Result: this project uses volume `pv-bff-local_pgdata`, completely isolated from the company project.

---

### pv-ai JWT relay — BFF-issued authentication for AI sidecar calls

All five AI operations (`transcribeAudio`, `startChat`, `sendMessage`, `approveDraft`, `endSession`) now include a Bearer token in every request to pv-ai. The token is obtained from pv-ai's service-to-service relay endpoint:

```
POST {FASTAPI_URL}/api/auth/token/relay
X-BFF-Secret: {PJAI_SHARED_SECRET}
Body: { user_id: string }
→ { access_token, token_type: "bearer", expires_in: 1800 }
```

**Why relay instead of forwarding the user's BFF JWT:**
pv-ai and pv-bff are separate services with separate JWT secrets. pv-ai cannot verify BFF-issued tokens. The relay pattern keeps each service sovereign: the BFF proves its identity via the shared secret, pv-ai issues its own short-lived token (30 min) with a `"relay": true` claim, and pv-ai's `get_current_user()` accepts relay tokens without a local DB lookup.

**Token caching (25 min per user):**
To avoid a relay round-trip on every AI request, `AiService` maintains an in-process `Map<userId, { token, expiresAt }>`. The cache TTL (25 min) is set 5 min below pv-ai's token expiry (30 min) so the BFF never presents an expired token. On a cache miss (first request per user, or after expiry), a single relay call fetches a fresh token, which is then reused for all subsequent AI calls by that user until expiry.

**Security model:**
- `PJAI_SHARED_SECRET` must be kept out of source control (lives in `.env`, gitignored on both sides).
- The relay endpoint trusts the `user_id` supplied by the BFF unconditionally — if the secret is compromised, arbitrary user tokens can be minted. Rotate the secret immediately if exposed.
- Relay tokens carry `"relay": true` and only work on pv-ai; they cannot be used against pv-bff.

---

### Zembra TLS workaround in Docker

The local Zembra dev server uses a self-signed certificate. Node.js rejects this by default. The fix is scoped to `ListingsModule` only:

```typescript
// src/listings/listings.module.ts
HttpModule.register({
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
})
```

This does **not** disable TLS verification globally — only for HTTP calls made by `ListingsService`.

The container also needs to reach the Zembra server on the Windows host (not loopback). This is handled via:
```yaml
# docker-compose.yaml
extra_hosts:
  - "localapi.zembra.io:host-gateway"
```

---

### Route ordering — dashboard and stats before `:id`

`GET /reviews/dashboard` and `GET /reviews/stats` are registered **before** `GET /reviews/:id` in [src/reviews/reviews.controller.ts](src/reviews/reviews.controller.ts). NestJS matches routes in declaration order; if `:id` came first, the literal strings `"dashboard"` and `"stats"` would be treated as review UUIDs and throw 404.

---

### pv-ai error mapping

[src/ai/ai.service.ts](src/ai/ai.service.ts) maps FastAPI errors explicitly:
- Non-2xx FastAPI response → **502 Bad Gateway** (forwards the FastAPI error body)
- Network error (ECONNREFUSED, timeout) → **503 Service Unavailable** with message `"AI service temporarily unavailable"`

This prevents raw Axios errors from leaking to the client.

---

## 9. HOW TO RUN TESTS

### Run all unit tests
```bash
npm test
```

### Run with coverage
```bash
npm run test:cov
# HTML report generated in ./coverage/
```

### Run a single test file
```bash
npx jest src/listings/listings.service.spec.ts
npx jest src/reviews/reviews.service.spec.ts
npx jest src/reviews/posting.worker.spec.ts
npx jest src/app.controller.spec.ts
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run e2e tests
```bash
npm run test:e2e
# Note: e2e tests require a running database. Start docker-compose first.
```

### Current test count and pass rate

| Suite | File | Tests |
|---|---|---|
| AppController | [src/app.controller.spec.ts](src/app.controller.spec.ts) | 1 |
| ListingsService | [src/listings/listings.service.spec.ts](src/listings/listings.service.spec.ts) | 8 |
| ReviewsService | [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | ~46 |
| PostingWorker | [src/reviews/posting.worker.spec.ts](src/reviews/posting.worker.spec.ts) | 5 |
| **Total** | | **60 (all passing)** |

All tests mock the database (no DB required to run unit tests). The Prisma service is mocked via `jest.fn()`. BullMQ queue is mocked via `getQueueToken`. The AiService is mocked via a plain object with `jest.fn()` methods.

---

## 10. ENVIRONMENT SETUP FROM SCRATCH

Follow these steps on a new Windows machine with Docker Desktop installed.

### Prerequisites

- Node.js 20+ (or use the Docker container for everything)
- Docker Desktop with WSL2 integration enabled
- Git

### Step 1 — Clone the project

```bash
git clone <repo-url> "D:\pfe backend\pv-bff"
cd "D:\pfe backend\pv-bff"
```

### Step 2 — Install Node dependencies

```bash
npm install
```

### Step 3 — Configure environment

```bash
copy .env.example .env
```

Edit `.env` and fill in:

```
PORT=3001
DATABASE_URL=postgresql://postgres:root@localhost:5432/provoc_db
JWT_SECRET=<generate a random 64-char string>
ZEMBRA_API_KEY=<your Zembra Bearer token from the Zembra dashboard>
ZEMBRA_BASE_URL=https://localapi.zembra.io   # (dev) or https://beta.api.zembra.io
FASTAPI_URL=http://localhost:8000
REDIS_HOST=localhost
REDIS_PORT=6379
```

Leave `DB_*` vars at their defaults unless you change the Postgres credentials.

### Step 4 — Start Docker services

```bash
docker-compose up -d
```

This starts:
- PostgreSQL 15 on port 5432 (internal only, exposed to host via container networking)
- Redis 7 on port 6379
- NestJS backend on `PORT` (if you want it in Docker; see note below)

Wait for health checks to pass:
```bash
docker-compose ps
# database and redis should show "healthy"
```

**Note:** for development, it is easier to run NestJS directly on the host (`npm run start:dev`) and only use Docker for Postgres + Redis. To do this, remove or comment out the `backend` service in `docker-compose.yaml` and run Docker with:
```bash
docker-compose up -d database redis
```

### Step 5 — Run database migrations

```bash
# If running NestJS locally (recommended for dev):
npx prisma migrate deploy

# If running everything in Docker:
docker-compose exec backend npx prisma migrate deploy
```

This applies all 4 migrations and creates the 21 tables. Verify:
```bash
docker-compose exec database psql -U postgres -d provoc_db -c "\dt"
# Should list 21 tables
```

### Step 6 — Seed test data (required to log in)

There is no registration endpoint yet. Insert a test user manually:

```sql
-- Connect to the database
docker-compose exec database psql -U postgres -d provoc_db

-- Create a user
INSERT INTO users (user_id, display_name, language, is_active, created_at, updated_at)
VALUES (gen_random_uuid(), 'Test User', 'en', true, now(), now())
RETURNING user_id;

-- Take the user_id from above and create credentials
-- Password below is bcrypt hash of "password123"
INSERT INTO user_credentials (credential_id, user_id, email, password_hash, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  '<user_id from above>',
  'test@example.com',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  now(),
  now()
);
```

### Step 7 — Start the backend

```bash
npm run start:dev
```

Output should include:
```
[Nest] LOG [NestApplication] Nest application successfully started
[Nest] LOG [RouterExplorer] Mapped { /auth/login, POST }
...
```

### Step 8 — Verify

```bash
# Health check
curl http://localhost:3001

# DB check
curl http://localhost:3001/test-db

# Login
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
# → { "access_token": "eyJ..." }
```

### Step 9 — Open Swagger UI

Navigate to: [http://localhost:3001/api](http://localhost:3001/api)

Click **Authorize**, paste the `access_token`, and explore all endpoints.

### Step 10 — (Optional) Start pv-ai sidecar

For AI Review Composer endpoints to work, the FastAPI `pv-ai` service must be running:

```bash
# In the pv-ai project directory (separate repo):
uvicorn main:app --reload --port 8000
```

Ensure `FASTAPI_URL=http://localhost:8000` in `.env`.

---

*This document reflects the state of the project as of 2026-05-19.*
