# pv-bff Handover Report

Generated: 2026-05-27

---

## 1. PROJECT OVERVIEW

### What this project is

`pv-bff` is a **Backend for Frontend (BFF)** service written in NestJS / TypeScript. It acts as the single API gateway for the Provoc mobile/web app. Responsibilities:

- JWT authentication (login, token issuance)
- Business listing lookup via the **Zembra API** (multi-network: Google, TripAdvisor, OpenTable, Yelp, …)
- Saving matched businesses and listings into PostgreSQL
- Review lifecycle management: create draft → AI-compose → publish to platforms
- **AI Review Composer**: audio transcription via Whisper (delegated to a FastAPI `pv-ai` sidecar), multi-turn conversational drafting, draft approval
- Async review posting via **BullMQ / Redis** (Facebook Graph API for demo; real OAuth path pending for other platforms)

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
| `ZEMBRA_API_KEY` | Bearer token from Zembra dashboard | No (dead config — kept in Railway but unused since Google Places migration; see Section 22) | Previously authenticated calls to Zembra |
| `ZEMBRA_BASE_URL` | `https://localapi.zembra.io` (dev) / `https://beta.api.zembra.io` (staging) | No (dead config — see Section 22) | Previously used Zembra base URL |
| `GOOGLE_PLACES_API_KEY` | Google Cloud API key with Places API (New) enabled | Yes | Authenticates calls to Google Places Text Search (`POST /v1/places:searchText`) |
| `FASTAPI_URL` | `http://localhost:8000` | Yes | URL of the `pv-ai` FastAPI sidecar |
| `FACEBOOK_TEST_TOKEN` | User access token from Meta Graph Explorer | Yes (posting) | Access token used directly by `PostingWorker` to call `POST /v21.0/me/feed` for the demo; no OAuth flow needed |

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
| `POST` | `/auth/register` | Public | Creates `User` + `UserCredential` in a single `$transaction` (bcrypt hash, 10 rounds); returns signed JWT. Throws 409 if email already registered |

**Database tables touched:** `users`, `user_credentials`

**JWT payload:** `{ sub: user_id, email }`  
**Token expiry:** configurable via `JWT_EXPIRES_IN` (default `7d`)

**Test file:** [src/auth/auth.service.spec.ts](src/auth/auth.service.spec.ts) — **3 unit tests** (register happy path, 409 conflict on duplicate email, `RegisterDto` password min-length validation)

---

### Module: Listings

**All endpoints require `Authorization: Bearer <JWT>`**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/listings/search` | JWT | Calls Google Places Text Search (`POST /v1/places:searchText`) with `?q=&lat=&lng=`; returns record-keyed results `{ google, google_1, … }`. See Section 22 for full details. |
| `GET` | `/listings/:id` | JWT | Fetches a saved listing; response always includes `networks: [{ network_id, name, slug }]` (empty array if no active listings) |
| `POST` | `/listings` | JWT | Saves a Zembra result: upserts `business` + `network` + `listing` records. Accepts optional `network_slug` to resolve an existing network by slug instead of creating one |

**Database tables touched:** `listings`, `businesses`, `networks`

**Test file:** [src/listings/listings.service.spec.ts](src/listings/listings.service.spec.ts) — **11 unit tests** (search, findById always-returns-networks guarantee, populated networks, save with existing/new network/business, network_slug resolution, 404 case)

---

### Module: Networks

**All endpoints require `Authorization: Bearer <JWT>`**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/networks` | JWT | Returns all active networks ordered by name: `[{ network_id, name, slug, post_auth_type }]`. `slug` = `name.toLowerCase().replace(/\s+/g, '')` |

**Database tables touched:** `networks`, `network_preferences`

**Test file:** [src/networks/networks.service.spec.ts](src/networks/networks.service.spec.ts) — **4 unit tests** (correct shape, slug derivation, null post_auth_type, empty result)

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
| `GET` | `/reviews/:id/publish-link` | JWT | Query: `platform_id` (network UUID, required). Verifies `post_auth_type = clipboard_deeplink`; checks that `external_listing_id` is a valid platform ID (not `osm-*` or `manual-*`); constructs the write-review URL or returns `url: null` if the ID is invalid. Always creates a `review_platform_posts` record (`status: 'clipboard_opened'`). Returns `{ url, review_text, platform_name }` |

#### AI Review Composer

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/reviews/:id/transcribe` | JWT | `multipart/form-data` with `audio` file field + optional `language`. Calls pv-ai Whisper transcription; updates `review_text` and `language` on the review |
| `POST` | `/reviews/:id/chat/start` | JWT | Starts AI chat session; builds `listingContext` from all active listings of the business; stores `session_id` on the review |
| `POST` | `/reviews/:id/chat/message` | JWT | Body: `{ message }`. Sends chat turn to pv-ai; requires active `ai_session_id` (400 if none) |
| `POST` | `/reviews/:id/chat/approve` | JWT | Calls pv-ai approve endpoint; updates review (`review_text`, `rating`, `tone`, `status: 'pending'`); upserts a `review_drafts` row with the improved text; ends session |
| `GET` | `/reviews/:id/chat/history` | JWT | Returns all persisted chat messages for a review in ascending order |
| `GET` | `/reviews/:id/drafts` | JWT | Lists all `review_drafts` with network name |

**Database tables touched:** `reviews`, `review_drafts`, `review_platform_posts`, `review_histories`, `notifications`, `businesses`, `listings`, `networks`, `user_platform_accounts`, `review_chat_messages`

**Test files:**
- [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) — **62 unit tests** covering all service methods including all 403/400 error branches and 3 new `getChatHistory` tests
- [src/reviews/posting.worker.spec.ts](src/reviews/posting.worker.spec.ts) — **5 unit tests** for BullMQ worker (Facebook API success path, notification creation, `onFailed` with retry guard)

**Total across all 6 suites: 81 tests, all passing.**

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
| `ReviewPlatformPost` | `review_platform_posts` | `post_id` (PK), `review_id` (FK), `network_id` (FK), `listing_id` (FK, nullable), `user_platform_account_id` (FK, **nullable** — omitted for Facebook demo posts), `external_review_id`, `status`, `platform_specific_text`, `scheduled_at`, `posted_at`, `retry_count`, `likes_count`, `error_message` |
| `ReviewChatMessage` | `review_chat_messages` | `message_id` (PK, UUID), `review_id` (FK), `role` (String: `'user'` or `'assistant'`), `content`, `created_at` |
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

Review 1──* ReviewChatMessage

Listing 1──* Review
Listing 1──* ReviewPlatformPost

Review 1──* ReviewDraft
Review 1──* ReviewHistory
Review 1──* ReviewMedia
Review 1──* ReviewPlatformPost

ReviewPlatformPost *──0,1 UserPlatformAccount  (nullable since 2026-05-27)

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
│   ├── schema.prisma                # Full DB schema; 22 models / tables
│   ├── prisma.config.ts             # Prisma config entrypoint
│   ├── seed.ts                      # Upserts 4 networks + NetworkPreferences: Yelp, Google, Trustpilot (clipboard_deeplink / supports_api_posting=false), Facebook (api_oauth / supports_api_posting=true)
│   └── migrations/
│       ├── 20260310132406_init/             # Initial schema: all 19 base tables
│       ├── 20260312000001_add_user_credentials/   # Adds user_credentials table
│       ├── 20260518202432_add_review_indexes/     # 4 performance indexes on reviews
│       ├── 20260519073404_add_ai_session_id/      # Adds ai_session_id column to reviews
│       └── 20260530021019_add_chat_history/       # Adds review_chat_messages table
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
│   │   ├── auth.service.ts          # login() + register(): bcrypt.compare / bcrypt.hash (10 rounds), $transaction user+credential creation, signs JWT
│   │   ├── auth.service.spec.ts     # 3 unit tests: register happy path, 409 on duplicate email, RegisterDto password min-length
│   │   ├── auth.controller.ts       # POST /auth/login, POST /auth/register
│   │   ├── dto/
│   │   │   ├── login.dto.ts         # { email: @IsEmail, password: @IsString @MinLength(8) }
│   │   │   └── register.dto.ts      # { display_name: @IsString, email: @IsEmail, password: @IsString @MinLength(8) }
│   │   ├── guards/
│   │   │   └── jwt-auth.guard.ts    # @Injectable AuthGuard('jwt') — applied per-controller
│   │   └── strategies/
│   │       └── jwt.strategy.ts      # Extracts Bearer token; validates → returns { user_id, email }
│   ├── listings/
│   │   ├── listings.module.ts       # HttpModule with rejectUnauthorized:false for Zembra TLS
│   │   ├── listings.service.ts      # search(), findById() (networks always []), save() with network_slug
│   │   ├── listings.controller.ts   # GET /listings/search, GET /listings/:id, POST /listings
│   │   ├── listings.service.spec.ts # 11 unit tests for ListingsService
│   │   └── dto/
│   │       ├── search-listings.dto.ts  # { name, address, networks[]? } with @Transform for arrays
│   │       └── save-listing.dto.ts     # { external_listing_id, name, ..., network?, network_slug? }
│   ├── networks/
│   │   ├── networks.module.ts       # Simple module; uses global PrismaModule
│   │   ├── networks.service.ts      # findAll(): returns active networks with slug + post_auth_type
│   │   ├── networks.controller.ts   # GET /networks
│   │   └── networks.service.spec.ts # 4 unit tests for NetworksService
│   ├── reviews/
│   │   ├── reviews.module.ts        # Imports PrismaModule, AiModule, BullMQ queue registration
│   │   ├── reviews.service.ts       # All 15 service methods (includes getPublishLink)
│   │   ├── reviews.controller.ts    # All 17 API endpoints with full Swagger decoration (includes GET :id/publish-link)
│   │   ├── reviews.service.spec.ts  # 59 unit tests for ReviewsService
│   │   ├── posting.worker.ts        # BullMQ @Processor; calls Facebook Graph API, stores post id, creates notification
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

**Register**
```
POST /auth/register
Content-Type: application/json

{ "display_name": "Alice", "email": "alice@example.com", "password": "mypassword" }

→ 201 { "access_token": "eyJhbGci..." }
→ 409 if email already registered
→ 400 if password < 8 chars or email is not valid
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
  by_status: { draft: 5, pending: 2, published: 3, posted: 2 },
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
The BullMQ worker fires async: calls `POST https://graph.facebook.com/v21.0/me/feed` with
`FACEBOOK_TEST_TOKEN` and the draft text, then on success marks the post as `posted`
(status transitions: `queued` → `posted` on success, `queued` → `failed` after 3 failed
attempts), stores the real Facebook post id as `external_review_id`, sets `posted_at = now`,
flips the review status to `published`, and creates a notification. On any HTTP error the
worker throws, letting BullMQ handle exponential-backoff retry.

**Get clipboard deep-link**
```
GET /reviews/<review-id>/publish-link?platform_id=<network-uuid>
Authorization: Bearer <token>

→ 200 { "url": "https://search.google.com/local/writereview?placeid=ChIJ...", "review_text": "Great place!", "platform_name": "Google" }
→ 400 if network post_auth_type is not clipboard_deeplink, or network name not recognised
→ 403 if review belongs to another user
→ 404 if review not found or no listing exists for this platform
```

Also creates a `review_platform_posts` row with `status = 'clipboard_opened'` so the post history reflects that the user was given the link.

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
- **Facebook Graph API** — `PostingWorker` calls `POST /v21.0/me/feed` with `FACEBOOK_TEST_TOKEN`; real post id stored in `external_review_id`
- **pv-ai FastAPI sidecar** — HTTP proxy tested; 502/503 error mapping works correctly
- **pv-ai JWT relay** — BFF relays user identity via shared secret, tokens cached 25 min per user

---

## 6. WHAT IS NOT DONE YET

### Missing from the blueprint

1. **Role and permission management APIs** — `roles`, `permissions`, `role_permissions`, `user_roles` tables exist in the schema but there are no API endpoints to create roles, assign permissions, or assign roles to users. No RBAC enforcement exists on any endpoint.

2. **User preferences and consent management endpoints** — `user_preferences`, `data_consent` tables exist but have no API. Users cannot set their `default_tone`, `preferred_networks`, or manage GDPR consent.

3. **User platform account management** — `user_platform_accounts` (OAuth tokens for platforms) cannot be created/managed via API. The `publish` flow no longer creates a placeholder account; `user_platform_account_id` is now nullable on `review_platform_posts`. Real per-user OAuth is not implemented.

4. **Media upload** — `review_medias` table exists but there is no `POST /reviews/:id/media` endpoint. The `ReviewMedia` model references an `s3_key` field; no S3 integration exists.

5. **`ReviewHistory` tracking** — the table exists but no code writes to it. Status changes from `update()`, `remove()`, `publish()`, and `approveDraft()` are not logged.

6. **`UserActivityStats` calculation** — the table exists but no service calculates or updates it.

7. **Real platform posting (partial)** — Facebook posting is live for the demo via `FACEBOOK_TEST_TOKEN`. The worker calls the Facebook Graph API and stores the real post id. Posting to Google, Yelp, TripAdvisor, and other platforms is not yet implemented; those networks will queue a job but the worker will attempt a Facebook API call regardless of `network_name`.

8. **Real OAuth for platform accounts** — `UserPlatformAccount.oauth_token` / `refresh_token` fields exist but are never populated.

9. **Notifications delivery** — notifications are created in the DB but never pushed (no WebSocket, no FCM, no email).

10. **`GET /test-db`** — the debug endpoint in `AppController` is still live in production. It should be removed or gated.

### Incomplete / known issues

- `tsconfig.json` has `strictNullChecks: false` and `noImplicitAny: false`. These relaxed settings mask potential type bugs. Should be tightened before going to production.
- The Dockerfile CMD is `npm run start:dev` (watch mode) — this should use `start:prod` for a real production image.
- No rate limiting on `POST /auth/login` — brute-force attacks are possible.
- No input sanitisation on `review_text` — XSS is not a concern server-side but worth noting.
- `ZEMBRA_API_KEY` is committed in `.env` in git history — rotate it if the repo is ever made public.
- `listing_id` is nullable on `Review`. If a user creates a review without a listing (edge case not exposed by the current DTO), `business_id` would be unset.

---

## 7. NEXT STEPS IN PRIORITY ORDER

### 1. Role and permission management APIs

**What:** CRUD for roles and permissions; assign roles to users; enforce RBAC via a custom `RolesGuard`.

**Files to touch:**
- Create `src/roles/` module with `roles.controller.ts`, `roles.service.ts`, `roles.module.ts`
- Create `src/auth/guards/roles.guard.ts`
- Create `src/auth/decorators/roles.decorator.ts`

**Complexity:** Medium (half-day)

---

### 2. User preferences and consent endpoints

**What:** `GET/PATCH /users/me/preferences` and `POST /users/me/consent`.

**Files to touch:**
- Create `src/users/` module
- Touch `user_preferences` and `data_consent` tables

**Complexity:** Low–Medium (2–3 hours)

---

### 3. Platform account OAuth connection

**What:** endpoint for users to connect a platform account (store `oauth_token`). Required for real (non-simulated) posting.

**Files to touch:**
- `src/users/users.service.ts` — `connectPlatform()` / `disconnectPlatform()`
- `user_platform_accounts` table

**Complexity:** Medium (depends on OAuth provider complexity)

---

### 4. Multi-platform real posting

**What:** `PostingWorker` now calls the Facebook Graph API for all jobs (demo). Extend it to dispatch to the correct platform based on `network_name`, and implement Google / Yelp / TripAdvisor posting.

**Files to touch:**
- [src/reviews/posting.worker.ts](src/reviews/posting.worker.ts) — add a `network_name` switch; implement per-platform HTTP calls
- Possibly create `src/platforms/` service per network with its own OAuth token management

**Complexity:** High (depends on each platform's API and OAuth requirements)

---

### 5. `ReviewHistory` write-through

**What:** every status change should append a row to `review_histories`.

**Files to touch:**
- [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) — add `prisma.reviewHistory.create()` calls in `update()`, `remove()`, `publish()`, `approveDraft()`

**Complexity:** Low (2 hours)

---

### 6. Tighten TypeScript config

**What:** enable `strictNullChecks` and `noImplicitAny` in [tsconfig.json](tsconfig.json).

**Complexity:** Medium (fixing the type errors that surface)

---

### 7. Fix Dockerfile for production

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

**6. `user_platform_account_id` is now nullable on `review_platform_posts`**
The schema previously required a `user_platform_account_id` FK on every platform post. `ReviewsService.publish()` was creating a placeholder `UserPlatformAccount` (`is_active: false`) purely to satisfy this constraint. Since posting now uses a global `FACEBOOK_TEST_TOKEN` (no per-user OAuth), the placeholder creation was removed and `user_platform_account_id` was made nullable (`String? @db.Uuid`) in `schema.prisma`. `getPublishLink()` still performs the findFirst/create for clipboard-deeplink platforms (Google, Yelp, Trustpilot) where the account record is still recorded for audit purposes. **Note:** the database column is still `NOT NULL` in applied migrations — a `prisma migrate dev` is required to propagate the nullable change to the actual DB before going to production.

**7. `approveDraft()` draft row management via upsert**
After the AI approve call, `approveDraft()` must ensure a `review_drafts` row exists with the improved text. It first calls `reviewDraft.findFirst` to check for an existing draft. It then calls `reviewDraft.upsert` using the found draft's `draft_id` as the key, or a sentinel UUID (`00000000-0000-0000-0000-000000000000`) when no draft exists — which forces Prisma to take the `create` branch. A follow-up `reviewDraft.updateMany` propagates the new `draft_text` to any other selected drafts for the same review. The sentinel UUID approach is a workaround for Prisma's requirement that the `where` clause of an upsert reference a unique field even when creating a new row.

**8. `getPublishLink()` — clipboard deep-link flow**
For platforms where users must copy-paste a review (Google, Yelp, Trustpilot), `post_auth_type = clipboard_deeplink` in `NetworkPreference` signals that the app should open the platform's native write-review page rather than posting via API. `getPublishLink()` looks up the listing for the review's business on the requested network, verifies the auth type, constructs the URL, and records the event as a `review_platform_posts` row with `status = clipboard_opened`. The URL construction is a switch on `network.name`: Google uses the `placeid` query param; Yelp uses the business slug; Trustpilot parses the domain from `listing.external_url` (path segment after `/review/`).

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
| ListingsService | [src/listings/listings.service.spec.ts](src/listings/listings.service.spec.ts) | 11 |
| AuthService | [src/auth/auth.service.spec.ts](src/auth/auth.service.spec.ts) | 3 |
| ReviewsService | [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | 64 |
| PostingWorker | [src/reviews/posting.worker.spec.ts](src/reviews/posting.worker.spec.ts) | 5 |
| FacebookService | [src/facebook/facebook.service.spec.ts](src/facebook/facebook.service.spec.ts) | 2 |
| NetworksService | [src/networks/networks.service.spec.ts](src/networks/networks.service.spec.ts) | 4 |
| **Total** | | **90 (all passing)** |

All tests mock the database (no DB required to run unit tests). The Prisma service is mocked via `jest.fn()`. BullMQ queue is mocked via `getQueueToken`. The AiService is mocked via a plain object with `jest.fn()` methods. `PostingWorker` tests additionally mock `global.fetch` and `ConfigService` to stub the Facebook API call.

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

### Step 6 — Create a test user and seed network data

**Create a user via the API (preferred):**

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Test User","email":"test@example.com","password":"password123"}'
# → { "access_token": "eyJ..." }
```

**Seed the four platform networks** (Yelp, Google, Trustpilot, Facebook) with their `NetworkPreference` records:

```bash
npx prisma db seed
```

This runs `prisma/seed.ts` and upserts all four networks so that publish and publish-link flows have valid `network_preferences` rows. Re-running is safe — all operations are upserts.

### Step 7 — Start the backend

```bash
npm run start:dev
```

Output should include:
```
[Nest] LOG [NestApplication] Nest application successfully started
[Nest] LOG [RouterExplorer] Mapped { /auth/login, POST }
[Nest] LOG [RouterExplorer] Mapped { /auth/register, POST }
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

---

## 11. CHAT HISTORY PERSISTENCE (added 2026-05-30)

### What was implemented

Chat messages are now persisted in PostgreSQL so users can resume a draft review with full AI context.

**Database:** new `review_chat_messages` table, migration `20260530021019_add_chat_history`.

**Schema model:**
```prisma
model ReviewChatMessage {
  message_id String   @id @default(uuid()) @db.Uuid
  review_id  String   @db.Uuid
  role       String   // 'user' or 'assistant'
  content    String
  created_at DateTime @default(now())
  review     Review   @relation(fields: [review_id], references: [review_id])

  @@index([review_id])
  @@map("review_chat_messages")
}
```

**Behavior:**
- `POST /reviews/:id/chat/start` — builds a transcript from `review.review_text` and starts a fresh pv-ai session. No DB history is queried; no messages are written to DB. See Section 19 for the simplified resume flow.
  - **Review has text**: transcript = `You previously helped the user write this review: "{review_text}". The user wants to continue refining it. Ask them what they would like to change.`
  - **Review has no text**: transcript = `''` (empty string, edge case for brand-new reviews).
- `POST /reviews/:id/chat/message` — saves both the user message and the AI response after each turn using `createMany`.
- `GET /reviews/:id/chat/history` — returns all chat messages ordered by `created_at` ascending (owner-scoped; 403 for wrong user, 404 if review missing).

**New endpoint summary:**

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/reviews/:id/chat/history` | JWT | Returns ordered list of `ReviewChatMessage` rows for the review |

**Files changed:**
- [prisma/schema.prisma](prisma/schema.prisma) — `ReviewChatMessage` model + `chat_messages` relation on `Review`
- [prisma/migrations/20260530021019_add_chat_history/](prisma/migrations/20260530021019_add_chat_history/) — migration SQL
- [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) — `startChat`, `sendMessage` updated; `getChatHistory` added
- [src/reviews/reviews.controller.ts](src/reviews/reviews.controller.ts) — `GET :id/chat/history` endpoint added
- [src/ai/ai.service.ts](src/ai/ai.service.ts) — `startChat` accepts optional `previousMessages` parameter
- [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) — `reviewChatMessage` mock added; `startChat` test updated for new 7th arg; 3 new `getChatHistory` tests

**Also fixed (pre-existing test failures):**
- `getPublishLink` — removed redundant `network.findUnique` call; added `post_auth_type` check on listing's network; fixed Trustpilot URL to parse domain from `listing.external_url`
- `AuthService.register` test — updated expected result to include `user` field returned by the updated service
- `ListingsService` tests — added `networkPreference` and `listing.findMany` mocks; updated assertions to match refactored `ensureNetwork` + `listingsToNetworks` logic

---

## 12. WHAT pv-ai NEEDS TO SUPPORT PREVIOUS_MESSAGES

`POST /api/chat/start` in pv-ai does **not** currently accept a `previous_messages` field. When a user resumes a draft review that already has chat history in the BFF database, `AiService.startChat` now includes `previous_messages` in the request body — but pv-ai silently ignores it.

**To make context restoration fully functional, pv-ai's `chat.py` must:**

1. Accept an optional `previous_messages: list[dict]` field in the `/api/chat/start` request body (Pydantic model).

2. If `previous_messages` is non-empty, pre-populate the Redis session's `chat_history` with those messages **before** calling Groq. Each entry has the shape `{"role": "user"|"assistant", "content": "..."}` — map directly to OpenAI message format.

3. Insert the pre-populated history between the system prompt and the first new Groq call, so the LLM has context of the prior conversation.

**Suggested change to `chat.py`:**
```python
# In the /start endpoint Pydantic model, add:
class StartChatRequest(BaseModel):
    ...
    previous_messages: list[dict] | None = None

# After building the system prompt and before calling Groq:
if body.previous_messages:
    session["chat_history"] += [
        {"role": m["role"], "content": m["content"]}
        for m in body.previous_messages
    ]
```

**Until pv-ai is updated:** the BFF correctly sends `previous_messages` on `/chat/start`, but pv-ai starts each session fresh. Chat history is still stored in the BFF database and returned via `GET /reviews/:id/chat/history`, so the client can display past conversations — the AI just won't have that context on re-start.

---

---

## 13. THREE BACKEND FIXES (added 2026-05-30)

### FIX 1 — GET /listings/:id stable networks array

`findById()` and all `save()` return paths now use `networks ?? []` explicitly so the `networks` key is **always** present at the top level and **never** undefined even when a business has no other active listings.

Each entry in `networks` has the shape `{ network_id, name, slug }` where `slug = name.toLowerCase().replace(/\s+/g, '')` (e.g., `'Google'` → `'google'`, `'Trip Advisor'` → `'tripadvisor'`).

**Files changed:** [src/listings/listings.service.ts](src/listings/listings.service.ts)

**Tests added:** 2 new tests in `listings.service.spec.ts`
- `always returns networks array even when business has no other active listings`
- `returns populated networks when business has active listings`

---

### FIX 2 — POST /listings accepts network_slug

`SaveListingDto` now accepts an optional `network_slug?: string` field. When provided, `save()` resolves it to an existing DB network via a **case-insensitive name lookup** using `SLUG_TO_NAME` (e.g., `'google'` → `'Google'`) before falling back to `ensureNetwork`. This skips the create-if-missing path and uses the pre-seeded network directly — which fixes the OSM fallback flow that sends `network: 'google'` as a slug string.

**Resolution order in `save()`:**
1. If `network_slug` is set and a matching network is found → use it (no ensureNetwork)
2. If `network_slug` is set but no match → fall back to `ensureNetwork(network_slug)`
3. If only `network` is set → `ensureNetwork(network)`
4. Default → `ensureNetwork('google')`

**Files changed:**
- [src/listings/dto/save-listing.dto.ts](src/listings/dto/save-listing.dto.ts) — added `network_slug?: string`
- [src/listings/listings.service.ts](src/listings/listings.service.ts) — added slug-lookup block before `ensureNetwork`

**Test added:** 1 new test in `listings.service.spec.ts`
- `resolves network_slug to existing network without calling ensureNetwork`

---

### FIX 3 — GET /networks endpoint

New `NetworksModule` at `src/networks/` exposes a single authenticated endpoint:

```
GET /networks
Authorization: Bearer <JWT>

→ 200 [
  { "network_id": "...", "name": "Facebook",   "slug": "facebook",    "post_auth_type": "api_oauth" },
  { "network_id": "...", "name": "Google",     "slug": "google",      "post_auth_type": "clipboard_deeplink" },
  { "network_id": "...", "name": "TripAdvisor","slug": "tripadvisor", "post_auth_type": "clipboard_deeplink" },
  { "network_id": "...", "name": "Trustpilot", "slug": "trustpilot",  "post_auth_type": "clipboard_deeplink" },
  { "network_id": "...", "name": "Yelp",       "slug": "yelp",        "post_auth_type": "clipboard_deeplink" }
]
```

Results are ordered by `name` ascending and filtered to `is_active: true`. `post_auth_type` is `null` if the network has no `NetworkPreference` row.

**Files created:**
- [src/networks/networks.service.ts](src/networks/networks.service.ts)
- [src/networks/networks.controller.ts](src/networks/networks.controller.ts)
- [src/networks/networks.module.ts](src/networks/networks.module.ts)
- [src/networks/networks.service.spec.ts](src/networks/networks.service.spec.ts) — 4 unit tests

**Files changed:** [src/app.module.ts](src/app.module.ts) — `NetworksModule` added to imports

---

---

## 14. getPublishLink OSM ID FIX (added 2026-05-30)

### Bug

When a listing was saved from an OSM nearby result, `external_listing_id` is `'osm-4386938002'` (an OpenStreetMap node ID, not a Google Place ID). `getPublishLink` was constructing:

```
https://search.google.com/local/writereview?placeid=osm-4386938002
```

Google rejects this URL with a 404 page.

### Fix

In `getPublishLink()`, after the listing is fetched and the `post_auth_type` check passes, a `hasValidId` flag is computed:

```typescript
const hasValidId =
  !!listing.external_listing_id &&
  !listing.external_listing_id.startsWith('osm-') &&
  !listing.external_listing_id.startsWith('manual-');
```

- If `hasValidId` is **true**: URL construction proceeds as before.
- If `hasValidId` is **false**: `url` stays `null`. No platform URL is constructed. The `ReviewPlatformPost` row is **still created** with `status: 'clipboard_opened'` (for audit). The response is `{ url: null, review_text, platform_name }`.

The frontend handles `url: null` by falling back to a Google Maps search URL client-side.

As a bonus simplification: inside `if (hasValidId)`, the old ternary `extId ? url_with_id : fallback_url` was removed — when `hasValidId` is true, `extId` is guaranteed to be a valid non-empty ID, so the fallback branch was dead code.

### Files changed

| File | Lines changed |
|---|---|
| [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) | `getPublishLink()`: added `hasValidId` constant; changed `let url: string` → `let url: string \| null = null`; wrapped URL switch inside `if (hasValidId)`; removed now-redundant empty-extId ternaries |
| [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | Added 1 test: `returns url: null when external_listing_id is an OSM id (osm- prefix)` |
| [HANDOVER_BFF.md](HANDOVER_BFF.md) | Updated publish-link description, test count (62→63, total 88→89) |

---

---

## 15. startChat chat-history ordering fix (added 2026-05-30)

### Bug

`startChat()` was saving only the AI's `initial_response` to `review_chat_messages`:

```typescript
// BROKEN — assistant row only
await this.prisma.reviewChatMessage.create({
  data: { review_id: reviewId, role: 'assistant', content: result.initial_response },
});
```

This produced a broken conversation structure in the DB:

```
[assistant, user, assistant, user, assistant, …]
```

Groq expects alternating `user / assistant` turns starting with the **user**. The missing first `user` row broke context restoration and caused malformed history when resuming a session.

### Fix

Replaced the single `create` call with a `createMany` that atomically writes both rows in the correct order:

```typescript
// FIXED — user transcript first, then assistant response
await this.prisma.reviewChatMessage.createMany({
  data: [
    { review_id: reviewId, role: 'user',      content: review.review_text      },
    { review_id: reviewId, role: 'assistant', content: result.initial_response },
  ],
});
```

`review.review_text` is the user's original transcript (the text used as input to the AI session). It is already in scope from the earlier `prisma.review.findFirst` call and is passed as the second argument to `aiService.startChat`.

The correct DB structure is now:

```
[user, assistant, user, assistant, user, assistant, …]
```

This fix applies on every `startChat` call — even when `previous_messages` already exist in the DB (resuming a session), the new transcript is always recorded.

### Files changed

| File | Change |
|---|---|
| [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) | `startChat()`: replaced `reviewChatMessage.create` (assistant only) with `reviewChatMessage.createMany` (user + assistant pair) |
| [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | `startChat` happy-path test: swapped `create.mockResolvedValue` → `createMany.mockResolvedValue({ count: 2 })`; updated assertion to verify both user and assistant rows |
| [HANDOVER_BFF.md](HANDOVER_BFF.md) | Section 11 behavior description updated; this section added |

---

---

## 16. startChat resume-session fix (added 2026-05-30)

### Bug

Every call to `startChat()` unconditionally saved `review.review_text` as a new user row via `createMany`, even when the user was resuming an existing conversation. On a second session the DB grew:

```
[user(transcript), assistant(r1)]          ← first session
[user(transcript), assistant(r1),          ← what the DB held
 user(review_text), assistant(r2)]         ← second startChat appended this
```

The second `user(review_text)` row sent stale transcript text to Groq as if it were a new user message, confusing the conversation context.

### Fix

`startChat()` now branches on whether `existingMessages` is empty:

```typescript
const isNewSession = existingMessages.length === 0;
const transcript = isNewSession
  ? review.review_text
  : 'Please continue helping refine this review based on our previous conversation.';
```

**New session** (`isNewSession === true`):
- Passes `review.review_text` to `aiService.startChat` as the transcript (unchanged).
- Saves `[user(transcript), assistant(response)]` via `createMany` (unchanged).

**Resume session** (`isNewSession === false`):
- Passes a fixed resume prompt to `aiService.startChat`. The real transcript is already included in `existingMessages` / `previous_messages` — no need to repeat it.
- Saves **only** `assistant(response)` via a single `create`. No user row is written, so the DB stays clean.

### Files changed

| File | Change |
|---|---|
| [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) | `startChat()`: added `isNewSession` / `transcript` variables; wrapped `createMany` in `if (isNewSession)` branch; added `else` branch with `create` (assistant only) |
| [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | Added 1 test: `resume: sends resume prompt to AI and saves only the assistant response`; existing new-session test unchanged |
| [HANDOVER_BFF.md](HANDOVER_BFF.md) | Section 11 behavior updated; test count 63→64, total 89→90; this section added |

---

---

## 17. startChat chat-history pollution fix (added 2026-05-30)

### Bug

After multiple resume sessions the `review_chat_messages` table accumulated polluted history:

```
[user, assistant]                    ← first session (correct)
[user, assistant, assistant]         ← after first resume: duplicate assistant added
[user, assistant, assistant,         ← after second resume: another assistant appended
 assistant]
```

Two root causes:

1. **`take: 20` fetched already-polluted rows** — resume sessions read their own previously-saved greeting rows back into `existingMessages`, which were then sent to pv-ai as context and further corrupted the conversation.

2. **Resume branch saved the greeting assistant row** — the `else` branch called `reviewChatMessage.create` with the resume greeting (`"Please continue…"` response). This greeting is transient; saving it polluted subsequent resume reads and confused Groq's context window with consecutive assistant turns.

### Fix

Two targeted changes to `startChat()`:

**FIX 1 — Reduce fetch window (`take: 20` → `take: 10`)**

Limits `existingMessages` to the first 10 rows only. Since a first session saves at most `[user, assistant]` plus subsequent `sendMessage` pairs, 10 rows covers several real turns without reaching any previously-saved resume garbage. This is a safety net; FIX 2 is the primary cure.

**FIX 2 — Remove DB write in resume branch**

The entire `else` branch was removed:

```typescript
// REMOVED — was writing a transient greeting to DB on every resume
} else {
  await this.prisma.reviewChatMessage.create({
    data: { review_id: reviewId, role: 'assistant', content: result.initial_response },
  });
}
```

The resume greeting exists only to orient the AI at session start. It is never shown to the user and must not be stored. All real conversation content is saved by `sendMessage()` (`createMany` for each user+assistant pair), so nothing useful is lost.

**Also removed** — 5 temporary `console.log` debug statements added in a previous debugging session.

### Resulting DB invariant

```
[user(transcript), assistant(r1)]   ← written by startChat on first session
[user(msg1), assistant(r2)]         ← written by sendMessage turn 1
[user(msg2), assistant(r3)]         ← written by sendMessage turn 2
```

On every subsequent `startChat` (resume): no rows written. DB unchanged.

### Files changed

| File | Change |
|---|---|
| [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) | `startChat()`: `take: 20` → `take: 10`; removed `else` branch (`reviewChatMessage.create`); removed 5 debug `console.log` statements |
| [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | Resume test renamed to `resume: sends resume prompt to AI and does NOT save assistant response to DB`; removed `create.mockResolvedValue({})` setup; assertion changed from `toHaveBeenCalledWith(...)` to `not.toHaveBeenCalled()` |
| [HANDOVER_BFF.md](HANDOVER_BFF.md) | Section 11 resume behavior description updated (`take` value + "saves nothing"); this section added |

---

---

## 18. sendMessage rephrase-history fix (added 2026-05-30)

### Bug

When the frontend calls `handleRetry` (rephrase flow) it opens a new chat session via `chat/start`, sends a rephrase instruction via `chat/message`, then calls `chat/approve`. Because `sendMessage` unconditionally wrote every `(user, assistant)` pair to `review_chat_messages`, the rephrase instruction message was persisted alongside the original conversation:

```
[user(transcript), assistant(r1)]          ← first session (correct)
[user(transcript), assistant(r1),
 user("Please rewrite this review…"),       ← rephrase message written to DB ← BUG
 assistant(rephrased text)]
```

When the user opened the review again, `startChat` fetched these 4 messages as `existingMessages` and passed them to pv-ai as prior context. pv-ai then saw the rephrase instruction as a real conversation turn, confusing subsequent sessions and making the AI think the user always wants to rephrase.

### Fix

Added a guard at the top of the `createMany` call in `sendMessage()`. Any message whose text starts with `'Please rewrite this review'` is considered a transient system instruction — it is still forwarded to pv-ai (so the AI can act on it), but neither the instruction nor its response is written to the DB.

```typescript
// reviews.service.ts — sendMessage()
if (!message.startsWith('Please rewrite this review')) {
  await this.prisma.reviewChatMessage.createMany({
    data: [
      { review_id: reviewId, role: 'user',      content: message            },
      { review_id: reviewId, role: 'assistant', content: aiResponse.response },
    ],
  });
}
```

This keeps the DB history clean regardless of how many times the user retries/rephrases. The original conversation is never overwritten.

### Files changed

| File | Lines changed |
|---|---|
| [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) | `sendMessage()`: wrapped `reviewChatMessage.createMany` in `if (!message.startsWith('Please rewrite this review'))` guard |
| [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | Added 1 test: `skips DB write when message is a rephrase instruction` — asserts `createMany` is not called when the message starts with the rephrase prefix |

**Test count after fix:** 91 (all passing). Previous total was 90.

---

---

## 19. startChat resume-transcript context fix (added 2026-05-30)

### Bug

The resume branch sent a generic placeholder prompt to pv-ai:

```
'Please continue helping refine this review based on our previous conversation.'
```

pv-ai received no review text. When it generated its opening message (e.g. "Your experience sounds great!") it was guessing based on the `previous_messages` — which only contain the user's raw transcript and earlier AI turns. If the user had written a mixed or negative review, pv-ai often got the sentiment wrong, undermining the user's confidence in the AI.

### Fix

The resume transcript now embeds the current `review.review_text` so the AI has the concrete review content in view before replying:

```typescript
const transcript = isNewSession
  ? review.review_text
  : `The current review text is: "${review.review_text}". Please continue helping the user refine this review based on our previous conversation. Do not summarize or change the sentiment — just be ready to help with edits.`;
```

The three explicit instructions at the end (`Do not summarize or change the sentiment — just be ready to help with edits.`) prevent the AI from launching into unsolicited rewrites when the user simply resumes.

### Files changed

| File | Change |
|---|---|
| [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) | `startChat()`: resume branch transcript changed from static string to template literal embedding `review.review_text` |
| [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | Resume test assertion updated: `'Please continue…'` → backtick template referencing `mockReview.review_text` |

**Test count unchanged: 90 (all passing).**

---

---

## 20. startChat full simplification — remove previous_messages (added 2026-05-31)

### Problem

The approach introduced in Sections 11–17 and 19 (fetching up to 10 `review_chat_messages` rows, passing them as `previous_messages` to pv-ai) was causing corrupted conversation structure and confusing Groq. Root causes:

- Passing raw DB rows as prior context sent duplicate or out-of-order turns to Groq.
- The `isNewSession` / `existingMessages` branching was complex and fragile.
- The dependency on pv-ai implementing `previous_messages` support (Section 12) was never landed.

### Simplified approach

`startChat()` no longer queries `review_chat_messages` at all. Instead it derives the session transcript directly from `review.review_text`:

| Condition | Transcript sent to pv-ai |
|---|---|
| `review.review_text` is non-empty | `You previously helped the user write this review: "{text}". The user wants to continue refining it. Ask them what they would like to change.` |
| `review.review_text` is empty | `''` (empty string — edge case for brand-new reviews with no content yet) |

**No messages are written to the DB** by `startChat()`. Every real conversation turn continues to be saved by `sendMessage()` via `createMany`. `getChatHistory` and its DB table are unaffected.

**pv-ai dependency removed:** `AiService.startChat()` no longer sends `previous_messages` in the request body. pv-ai sees a fresh `transcript` on every `/api/chat/start` call.

### Files changed

| File | Change |
|---|---|
| [src/ai/ai.service.ts](src/ai/ai.service.ts) | `startChat()`: removed optional `previousMessages` parameter; removed `if (previousMessages && previousMessages.length > 0)` block that added `body.previous_messages` |
| [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) | `startChat()`: removed `reviewChatMessage.findMany` query; removed `isNewSession` variable; replaced two-branch transcript with single ternary on `review.review_text`; dropped 7th arg (`existingMessages`) from `aiService.startChat` call; removed `if (isNewSession) { createMany }` block |
| [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | Test 1 (`builds correct listingContext…`): removed `reviewChatMessage.findMany` + `createMany` mock setup; updated `aiService.startChat` assertion to 6 args with resume-prompt transcript; replaced `createMany.toHaveBeenCalledWith(…)` with `not.toHaveBeenCalled()`. Test 2 renamed `resume: …` → `sends empty transcript when review has no text`: rewritten to use `review_text: ''`, verify empty string transcript, no DB writes. |

**Test count: 91 (all passing). Supersedes Sections 11–17 and 19 for the startChat resume logic.**

---

---

## 21. conversation_summary — persist and inject into resume (added 2026-05-31)

### What changed

pv-ai's `/api/chat/approve` endpoint already returns a `conversation_summary` string (a one-paragraph plain-text summary generated by a second Groq call). The BFF now:

1. **Persists the summary** — `approveDraft()` writes `conversation_summary` to the `reviews` table alongside `review_text`.
2. **Injects it into the next session** — `startChat()` weaves the stored summary into the resume transcript so Groq has a compact description of the prior conversation without needing to re-process raw message history.

### Schema change

New nullable column on `Review`:

```prisma
conversation_summary String?
```

Migration: `prisma/migrations/20260531012428_add_conversation_summary/migration.sql`

### Transcript format

| Condition | Transcript sent to pv-ai |
|---|---|
| `review_text` non-empty, summary present | `The current review text is: "{text}".\nContext from previous session:\n{summary}\nThe user wants to continue refining it. Ask them what they would like to change.` |
| `review_text` non-empty, no summary | `The current review text is: "{text}".\nThe user wants to continue refining it. Ask them what they would like to change.` |
| `review_text` empty | `''` |

### Files changed

| File | Change |
|---|---|
| [prisma/schema.prisma](prisma/schema.prisma) | `Review` model: added `conversation_summary String?` field |
| [prisma/migrations/20260531012428_add_conversation_summary/](prisma/migrations/20260531012428_add_conversation_summary/) | Migration SQL adding nullable `conversation_summary` column to `reviews` table |
| [src/ai/ai.service.ts](src/ai/ai.service.ts) | `approveDraft()`: changed from pass-through `return this.post(…)` to explicit mapping; renamed `improved_text` → `review_text` in return type; added `conversation_summary: data.conversation_summary ?? null` |
| [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) | `approveDraft()`: `result.improved_text` → `result.review_text` (3 occurrences); added `conversation_summary: result.conversation_summary` to `prisma.review.update` data. `startChat()`: added `summaryContext` variable; updated transcript template to embed summary when present |
| [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | `mockApproveResult`: renamed `improved_text` → `review_text`, added `conversation_summary: null`. Existing `approveDraft` test: added `conversation_summary: null` to `prisma.review.update` assertion. New test: `saves conversation_summary to review when approve returns it`. `startChat` test 1: updated transcript assertion to new template. Two new `startChat` tests: `includes conversation_summary in resume transcript when present`, `builds resume transcript without summary when conversation_summary is null` |

**Test count: 94 (all passing). Previous total was 91.**

---

---

## 22. Search migration to Google Places API (New) (added 2026-06-11)

### What changed

`GET /listings/search` no longer calls the Zembra API. It now calls the **Google Places API (New)** Text Search endpoint directly. Zembra is entirely removed from the search path; `ZEMBRA_API_KEY` and `ZEMBRA_BASE_URL` remain in Railway env vars as dead config but are not used.

### New request shape

`SearchListingsDto` was rewritten. Old fields (`name`, `address`, `networks[]`) are replaced:

| Field | Type | Required | Description |
|---|---|---|---|
| `q` | `string` | Yes | Free-text query (business name, category, location) |
| `lat` | `string` | No | Latitude for location bias |
| `lng` | `string` | No | Longitude for location bias |

Example:
```
GET /listings/search?q=Harmony+Cuisine+San+Diego&lat=32.8122&lng=-117.1497
Authorization: Bearer <token>
```

### How it works

`ListingsService.search()` builds a POST body for `https://places.googleapis.com/v1/places:searchText`:

- Always sets `textQuery: q`.
- If `lat` and `lng` are both provided, adds a `locationBias.circle` (radius 5000 m) so nearby results rank higher.
- Requests fields: `places.id`, `places.displayName`, `places.formattedAddress`, `places.rating`, `places.location`, `places.photos`.
- The API key is passed as a query parameter (`?key=GOOGLE_PLACES_API_KEY`).

### Response format

Results are returned as a **record keyed by position**, not an array:

```json
{
  "google":   { "id": "ChIJ...", "name": "...", "formattedAddress": "...", "globalRating": 4.8, "reviewCount": 0, "url": "", "photo_reference": "places/.../photos/..." },
  "google_1": { ... },
  "google_2": { ... }
}
```

- First result key is always `"google"`; subsequent results are `"google_1"`, `"google_2"`, etc.
- `photo_reference` is `place.photos[0].name` from the Google Places New API (a resource path, not a legacy photo reference string). It is `null` when the place has no photos.
- `reviewCount` is always `0` — Google Places Text Search does not return a review count in this field set.
- `url` is always `''` — the direct place URL is not requested; the frontend constructs deep-links from `id`.

### Environment variable required

| Variable | Purpose |
|---|---|
| `GOOGLE_PLACES_API_KEY` | Google Cloud API key with **Places API (New)** enabled in the Google Cloud Console |

`ZEMBRA_API_KEY` and `ZEMBRA_BASE_URL` are no longer required for search but remain in existing Railway deployments as dead config.

### Files changed

| File | Change |
|---|---|
| [src/listings/listings.service.ts](src/listings/listings.service.ts) | `search()`: replaced Zembra HTTP call with Google Places `POST /v1/places:searchText`; added `locationBias` block; mapped response to record-keyed format with `photo_reference` |
| [src/listings/dto/search-listings.dto.ts](src/listings/dto/search-listings.dto.ts) | Replaced `name`, `address`, `networks[]` with `q` (required), `lat`, `lng` (optional) |
| [src/listings/listings.service.spec.ts](src/listings/listings.service.spec.ts) | All search tests rewritten for Google Places response format |

**Test count: 94 (all passing).**

---

---

## 23. Nominatim User-Agent fix for nearby businesses (added 2026-06-11)

### Problem

The nearby-businesses flow calls the **Nominatim OSM** reverse-geocoding API. On Railway (cloud environment), requests without a `User-Agent` header were blocked by Nominatim's usage policy, returning an error instead of location data.

### Fix

Added required HTTP headers to all Nominatim requests in [src/listings/listings.service.ts](src/listings/listings.service.ts):

```typescript
headers: {
  'User-Agent': 'pv-bff/1.0 (provoc-app)',
  'Accept-Language': 'en',
  'Referer': 'https://provoc.app',
}
```

These three headers satisfy Nominatim's usage policy:
- `User-Agent` identifies the application (required — Nominatim blocks anonymous requests).
- `Accept-Language` standardises the language of returned place names.
- `Referer` provides additional identification context.

### Files changed

| File | Change |
|---|---|
| [src/listings/listings.service.ts](src/listings/listings.service.ts) | Nominatim `GET` call: added `User-Agent`, `Accept-Language`, `Referer` headers |

---

---

## 24. pv-ai /pending-reviews — real Redis data (added 2026-06-11)

### Problem

The `GET /pending-reviews` endpoint in the `pv-ai` sidecar (`yelp.py`) previously returned an empty array unconditionally, making the pending-reviews feature non-functional.

### Fix

The endpoint now reads real data from Redis:

1. Scans all `session:*` keys in Redis.
2. Deserialises each session and filters by `status` (pending) and `user_id` (owner-scoped).
3. Returns the matching sessions as the pending-reviews list.

### Files changed

| File | Change |
|---|---|
| `yelp.py` (pv-ai sidecar) | `/pending-reviews` handler: replaced static `return []` with Redis scan + filter logic |

---

---

## 25. pv-ai /transcription — session persistence fix (added 2026-06-11)

### Problem

The `POST /transcription` endpoint in the `pv-ai` sidecar (`yelp.py`) was an echo stub — it returned the incoming data without persisting it. As a result, `voiceTranscription` and `detected_language` were never saved to the Redis session, so subsequent chat turns had no access to the transcribed text.

### Fix

The endpoint now:

1. Loads the existing Redis session via `get_session(session_id)`.
2. Returns **404** if the session is not found.
3. Returns **503** if Redis is unavailable.
4. On success, writes `voiceTranscription` and `detected_language` to the session object and persists it via `save_session()`.

### Files changed

| File | Change |
|---|---|
| `yelp.py` (pv-ai sidecar) | `/transcription` handler: replaced echo stub with `get_session` → update fields → `save_session`; added 404 (session not found) and 503 (Redis unavailable) error paths |

---

---

## 26. GET /recommendations proxy endpoint (added 2026-06-13)

### What was added

New endpoint that proxies `GET /api/recommendations` from the `pv-ai` sidecar to authenticated BFF clients. If pv-ai is unreachable the endpoint degrades gracefully and returns `[]` instead of propagating an error.

### Endpoint

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/recommendations` | JWT | Forwards to `{FASTAPI_URL}/api/recommendations`; returns pv-ai's response or `[]` on failure |

### Authentication to pv-ai

Uses the same relay token system as all other pv-ai proxy calls (see Section 8 — pv-ai JWT relay):

1. BFF calls `POST {FASTAPI_URL}/api/auth/token/relay` with `X-BFF-Secret: {PJAI_SHARED_SECRET}` and `{ user_id }`.
2. pv-ai returns a 30-minute Bearer token.
3. The BFF caches it for 25 minutes per user (existing `AiService` token cache).
4. `GET /api/recommendations` is called with `Authorization: Bearer <relay_token>`.
5. If **anything** throws (relay down, pv-ai down, non-2xx, network error), `getRecommendations()` catches it and returns `[]` — no error is propagated to the client.

### Files changed / created

| File | Change |
|---|---|
| [src/ai/ai.service.ts](src/ai/ai.service.ts) | Added `private async get<T>()` helper (mirrors existing `post<T>()`; maps non-2xx → 502, network errors → 503). Added `async getRecommendations(userId)`: calls `GET /api/recommendations` via `get<T>()` with relay auth headers; wraps entire call in `try/catch` that returns `[]` on any error |
| [src/recommendations/recommendations.controller.ts](src/recommendations/recommendations.controller.ts) | New file. `@Controller('recommendations')`, `@UseGuards(JwtAuthGuard)`. Single `@Get()` handler: reads `req.user.user_id` and delegates to `aiService.getRecommendations()` |
| [src/recommendations/recommendations.module.ts](src/recommendations/recommendations.module.ts) | New file. Imports `AiModule`; declares `RecommendationsController` |
| [src/recommendations/recommendations.controller.spec.ts](src/recommendations/recommendations.controller.spec.ts) | New file. 2 unit tests: happy path (pv-ai returns data array) and graceful degradation (returns `[]`) |
| [src/app.module.ts](src/app.module.ts) | `RecommendationsModule` added to imports array |

**Commit:** `f17a97e`

**Test count: 96 (all passing). Previous total was 94.**

---

---

## 27. Railway deployment note — stale image can produce 401 on new routes (added 2026-06-13)

### What was observed

After adding `GET /recommendations` (commit `f17a97e`) and pushing to `dev`, the endpoint returned **401** on Railway while `GET /reviews` and `GET /listings/nearby` returned **200** with the identical token. The NestJS guard code and module wiring were confirmed identical to every other authenticated endpoint.

### Root cause

Railway was still serving the **previous image** that predated commit `f17a97e`. The old image has no `/recommendations` route. Railway's infrastructure (reverse proxy / catch-all layer) returned **401** for the unknown path rather than **404**. This made the error look like an auth failure in the new code when the new code had not yet been deployed.

### Rule for future work

> **After adding any new route, always verify on Railway's deployment dashboard that the new commit is the active revision before debugging 401 / 404 errors on that route.** A 401 with visually correct auth code is a strong signal that Railway is running a stale image without the new route registered.

Checklist:
1. Push commit → confirm Railway dashboard shows the new commit SHA building/deploying.
2. Wait for "Deploy successful" status.
3. Only then test the new endpoint.
4. If still 401: check NestJS guard wiring. If 404: check module registration.

---

## 28. PUBLISH-LINK FIXES + ZEMBRA INTEGRATION BUG (added 2026-06-17)

### Google publish-link — real Place ID lookup for OSM/manual listings

`getPublishLink()`'s `hasValidId` check previously only excluded `external_listing_id` values starting with `osm-` or `manual-`. For Google specifically, this meant listings sourced via the nearby/OSM search flow always fell through to the generic `https://maps.google.com/?q={businessName}` fallback, even though a real, working Google Place ID could often be found live.

**Fix:** `hasValidId` now additionally requires, for Google only, that `external_listing_id` matches `/^ChIJ[A-Za-z0-9_-]+$/` (the real Google Place ID format). When this fails, a new private helper attempts a live Google Places API lookup (same pattern as [listings.service.ts](src/listings/listings.service.ts)'s `search()` — `places.googleapis.com/v1/places:searchText`, using business name as `textQuery` and latitude/longitude as `locationBias.circle.center` radius 5000 when available) to find a real `place.id` before falling back. On any failure (API error, empty results, exception), the function returns `url: null` — deliberately **not** the generic Maps URL — to match the existing frontend contract: `app/review/result.tsx` already has its own multi-step fallback chain (`data.url` → `listing.url` → `review.listing?.external_url` → direct listing refetch) when `url` is `null`, confirmed via the comment at `result.tsx` line ~138 ("publish-link often returns null"). Returning a Maps URL from the backend would have short-circuited that existing frontend logic.

### Yelp publish-link — same problem, two-tier fix

Yelp had an equivalent bug: Zembra-sourced listings get a synthetic `external_listing_id` like `zembra-yelp-{businessId}` (not a real Yelp business ID), which incorrectly **passed** the original `hasValidId` check (it only excluded `osm-`/`manual-` prefixes), causing a broken URL: `https://www.yelp.com/writeareview/biz/zembra-yelp-{businessId}`.

**Fix tier 1 (real Yelp ID):** a new `zembra_external_id` column was added to the `Listing` model (nullable string) specifically to store Zembra's real business ID (e.g. `"FEVQpbOPOwAPNIgO7D3xxw"`, found at the raw Zembra response's `data.data.yelp.id` field — see the Zembra integration bug below). When present, `getPublishLink()` builds `https://www.yelp.com/writeareview/biz/{zembra_external_id}` directly — this lands on Yelp's actual review form, not just the business page.

**Fix tier 2 (fallback when no real ID stored):** if `zembra_external_id` is absent, falls back to using `listing.external_url` directly when it's a `yelp.com`-family domain (Yelp's own business page works as a "go review this" link — no special writeareview path needed, unlike Google).

**Fix tier 3 (final fallback):** the original `writeareview/biz/{external_listing_id}` behavior, preserved for listings with a genuinely real (non-synthetic) `external_listing_id`.

**New migration:** `20260617000052_add_zembra_external_id` (nullable `zembra_external_id` column on `listings` table). Applied to Railway production DB via:

```bash
$env:DATABASE_URL="<railway-public-connection-string-for-pv-bff-db>"
npx prisma migrate deploy
```

> Note: must override `DATABASE_URL` explicitly — running the bare command uses the local `.env` value and reports "No pending migrations" against the **wrong** database, since it silently succeeds against localhost where the migration was already applied during development.

### Critical bug found: Zembra response parsing was wrong since the integration was first built

While debugging why `/zembra/match` always returned `{ networks: {} }` even for businesses confirmed (via direct curl + ngrok inspector) to have real Yelp/Google data, found that `zembra.service.ts`'s `fetchNetwork()` read the per-network payload from `response.data[network]`, but Zembra's actual response envelope nests it one level deeper: `{ status: "SUCCESS", message: "...", data: { yelp: {...} }, elapsed: "..." }` — meaning the real path is `response.data.data[network]`. The existing check `if (!data[network]) return null` was evaluating an always-undefined value and silently treating every genuine success as a failure. This means Zembra's Yelp/Google matching has likely never actually worked correctly in production since this integration was first built — confirmed by testing with a known-good business (Shake Shack Madison Square Park) via ngrok's request inspector, which showed Zembra returning a fully correct SUCCESS response that the code was silently discarding.

**Fix:** `fetchNetwork` now reads from `data.data?.[network]` instead of `data[network]`. The top-level `data.status === 'ERROR'` check (for genuinely failed lookups) was correct already and is unchanged.

### ngrok tunnel required for local Zembra access from Railway

Since pv-bff now runs on Railway but Zembra is local-only (Docker stack on the dev machine, see existing Zembra handover notes), reaching Zembra from Railway requires an active ngrok tunnel:

```bash
ngrok.exe http https://localhost:443 --host-header=localapi.zembra.io
```

**Important:** do **not** manually set a `Host` header in the outgoing request from `zembra.service.ts`. ngrok validates the incoming request's `Host` header against its own tunnel domain on the public side — if `zembra.service.ts` sends `Host: localapi.zembra.io` itself (which it used to, via a `ZEMBRA_HOST_HEADER` config var), ngrok rejects it with `"Received a request for different Host than the current tunnel."` The `--host-header=localapi.zembra.io` flag on the ngrok command itself handles rewriting the header correctly on the way to local nginx — the client (pv-bff) must send no Host override at all. `ZEMBRA_HOST_HEADER` config and its read in the constructor were removed entirely.

ngrok free-tier URLs are ephemeral — every restart generates a new URL, requiring `ZEMBRA_API_URL` to be updated on Railway and redeployed. This must be done fresh before any demo/test session that needs live Zembra data.

### Double-tap bug — keyboard swallowing first touch (pv-app, not pv-bff, but documented here for completeness)

`app/search.tsx`'s `autoFocus` `TextInput` combined with `FlatList`s that lacked `keyboardShouldPersistTaps` caused the first tap on any result/history item to only dismiss the keyboard (RN default `keyboardShouldPersistTaps="never"`) rather than firing `onPress`. Fixed by adding `keyboardShouldPersistTaps="handled"` to both `FlatList`s in `search.tsx` and to the `ScrollView` in `result.tsx` (same pattern found there too). `chat.tsx`'s `autoFocus` inputs were checked and are **not** affected — they sit in plain sibling `View`s, not inside the same scrollable container as the `autoFocus` input.

### Files changed (pv-bff)

| File | Change |
|---|---|
| [src/reviews/reviews.service.ts](src/reviews/reviews.service.ts) | `getPublishLink()`: Google ChIJ-pattern validation + live Places API lookup fallback; Yelp 3-tier fallback (`zembra_external_id` → `external_url` → existing behavior) |
| [src/reviews/reviews.service.spec.ts](src/reviews/reviews.service.spec.ts) | New/updated tests for Google live-lookup success/failure and Yelp 3-tier fallback |
| [src/zembra/zembra.service.ts](src/zembra/zembra.service.ts) | `fetchNetwork()`: fixed `data[network]` → `data.data?.[network]` parsing bug; added `id` extraction; removed `Host` header override and `ZEMBRA_HOST_HEADER` config |
| [src/zembra/zembra.service.spec.ts](src/zembra/zembra.service.spec.ts) | Fixtures updated to the real nested Zembra response shape; `id` field coverage; Host-header assertion updated |
| [src/zembra/zembra.controller.ts](src/zembra/zembra.controller.ts) | Swagger schema updated to document the new `id` field per network |
| [src/listings/dto/save-listing.dto.ts](src/listings/dto/save-listing.dto.ts) | Added optional `zembra_external_id` field |
| [src/listings/listings.service.ts](src/listings/listings.service.ts) | `save()` persists `zembra_external_id` on listing creation |
| [prisma/schema.prisma](prisma/schema.prisma) | `Listing` model: added `zembra_external_id String?` |
| `prisma/migrations/20260617000052_add_zembra_external_id/` | New migration adding the nullable column |

### Test count

113 → 114 passing (final count after all fixes in this session; note intermediate counts of 111, 113 occurred during the multi-step fix sequence — 114 is the final state).

---

## 29. SESSION 2026-06-19 — PROFILE MODULE, CATEGORY RATINGS, STATUS-ENUM FIXES, AND AI CONTEXT FORWARDING

### 1. Duplicate-Google-network bug (fixed)

`ListingsService.ensureNetwork()` created a separate `Network` row per Google Places result suffix (`google_1`, `google_2`, etc.) instead of reusing the canonical `Google` row, since those slugs weren't in `SLUG_TO_NAME`. Fixed by normalizing any slug starting with `"google"` to `'Google'` before the lookup, case-insensitive. 2 new tests. A standalone cleanup script (`cleanup_duplicate_google_networks.js`) was written to re-point existing bad listings on Railway and remove orphaned rows — written but deliberately left for manual review/execution rather than auto-run.

### 2. New endpoint: `GET /reviews/recent-check`

`?business_id={uuid}` returns `{ hasRecentReview: boolean, lastReviewedAt: string | null }` — lets pv-app show a soft warning before re-reviewing a business reviewed in the last 24h. 4 new tests.

### 3. New `src/users/` module (profile management) — did not exist before

Four new authenticated endpoints:
- **`PATCH /users/me`** — update `display_name`/`email`; 409 if email belongs to another user.
- **`GET /users/me/preferences`**, **`PATCH /users/me/preferences`** — upserts `UserPreference`; `preferred_networks` is an **ENABLED**-platforms list (inclusion, not exclusion — confirmed final semantics); new users default to `['google', 'yelp']`.
- **`PATCH /users/me/avatar`** — avatar stored as a base64 data URI directly in Postgres (new `User.avatar_data String? @db.Text` column + migration) — explicitly **not** S3, a deliberate time-constrained choice for now. 2MB decoded-size limit, 400 if exceeded.
- **`PATCH /users/me/password`** — bcrypt-compares current password (401 if wrong), bcrypt-hashes new password (10 rounds), mirrors `auth.service.ts`'s existing patterns.

`GET /auth/me` extended to also return `avatar_data` (previously only `user_id`/`email`/`display_name`).

### 4. Review category ratings + breakdown

New nullable `Review.category_ratings Json?` column + migration. `PATCH /reviews/:id` accepts optional `category_ratings` (e.g. `{"Food": 4, "Service": 5}`) — validated as a plain object at the DTO layer; each value range-checked to 1-5 inside the service (no fixed key whitelist, since categories vary per business type). New `GET /reviews/category-breakdown` aggregates `{ average, count }` per category across a user's reviews. Frontend: written by `app/review/breakdown.tsx` (previously captured ratings locally with no persistence at all) and surfaced on pv-app's profile tab as a "Your Ratings" card.

### 5. Two stale-enum bugs (same root cause, two call sites) — fixed

Both `UpdateReviewDto` (`PATCH /reviews/:id`) and `QueryReviewsDto` (`GET /reviews?status=`) validated `status` against `['draft', 'pending', 'published', 'simulated']` — `'simulated'` was never a real value used anywhere in app logic, and `'posted'` (the actual value `REVIEW_STATUSES` uses, and what pv-app's mark-as-posted flow and "Published" tab filter both send) was missing entirely. Both were silently 400ing — meaning `result.tsx`'s "mark as posted" confirmation, **and** pv-app's entire "Published" tab/filter, had been broken for an unknown period before this session. Both now validate against `['draft', 'pending', 'published', 'posted']`.

### 6. Yelp publish-link last-resort case — fixed

When a Yelp listing has neither a real `zembra_external_id` nor a usable `external_url`, `getPublishLink()` was building `writeareview/biz/{extId}` using the synthetic `zembra-yelp-<uuid>` placeholder directly — a guaranteed-broken URL. Now returns `url: null` in that case, matching Google's branch shape (already handled by pv-app's existing fallback chain).

### 7. regenerate/rephrase AI context bug — fixed (significant)

`ReviewsService.startChat()` accepted `body.previous_messages` (sent correctly by pv-app's regenerate action) but never forwarded it anywhere — it always synthesized its own generic "continue refining" transcript instead, silently discarding real conversation context. Root cause of "regenerate ignores new messages" reported and investigated this session. Now `previous_messages` flows through `StartChatDto` → `startChat()` → `AiService.startChat()` → pv-ai, additively (the normal/fresh-chat transcript-synthesis path is untouched). New `src/ai/ai.service.spec.ts` (zero tests existed for this service before). See `HANDOVER_AI.md` for the complementary pv-ai-side prompt-routing work built on top of this fix.

### 8. Outstanding: `purpose` field not yet forwarded to pv-ai

pv-ai now supports a `purpose` field (`Literal["start","regenerate"]` on `chat/start`, `Literal["message","rephrase"]` on `chat/message`) to select dedicated prompts per action — see `HANDOVER_AI.md`. pv-bff's `StartChatDto` and the send-message DTO need a corresponding optional `purpose` field, with `startChat()` passing `"regenerate"` for its regenerate call site (not fresh/resumed chats) and `sendMessage()` passing `"rephrase"` for its rephrase call site (not normal messages) — both call sites already exist and already distinguish these cases internally, this is purely about forwarding the right value through. **Not yet implemented.**

### 9. `selected_networks` field (network-slug persistence for review posting)

New nullable `Review.selected_networks Json?` column + migration. `UpdateReviewDto.selected_networks?: string[]`, persisted in `update()`. Purpose: pv-app's `result.tsx` persists which network slugs were actually selected during the live search→select→post flow, fixing a bug where reopening an old review from the Reviews tab always showed every platform the listing had (instead of just the ones originally chosen) since the original selection only ever existed as a transient navigation param with nowhere to persist.

### Test count

96 (last recorded, §26) → 162 passing. `tsc --noEmit` clean.

---

*This document reflects the state of the project as of 2026-06-19.*

---

## 30. SESSION 2026-06-24 — PURPOSE FIELD, TEST-DB GUARD, RATE LIMITING

### 1. `purpose` field forwarded to pv-ai (§29 item 8 — now implemented)

pv-ai's `chat/start` and `chat/message` endpoints accept a `purpose` discriminator to select dedicated prompts per action. This session wires the corresponding field through from the BFF DTOs all the way to pv-ai.

**`StartChatDto`** (`src/reviews/dto/start-chat.dto.ts`): added `purpose?: 'start' | 'regenerate'` with `@IsOptional() @IsIn(...)` validation.

**New `SendMessageDto`** (`src/reviews/dto/send-message.dto.ts`): `message: string`, `session_id?: string`, `purpose?: 'message' | 'rephrase'`. The controller's `POST :id/chat/message` endpoint now uses this DTO instead of bare `@Body('message')` / `@Body('session_id')` decorators.

**`AiService.startChat()`**: added `purpose?: 'start' | 'regenerate'` as the 8th parameter; always included in the pv-ai request body as `purpose ?? 'start'`.

**`AiService.sendMessage()`**: added `purpose?: 'message' | 'rephrase'` as the 4th parameter; always included in the pv-ai request body as `purpose ?? 'message'`.

**`ReviewsService.startChat()`**: computes `purpose = (body?.previous_messages && body.previous_messages.length > 0) ? 'regenerate' : 'start'` and passes it as the new 8th arg — so the regenerate call site (the one forwarding `previous_messages`) sends `'regenerate'` and every plain/resume chat sends `'start'`.

**`ReviewsService.sendMessage()`**: computes `msgPurpose = message.startsWith('Please rewrite this review') ? 'rephrase' : 'message'` before the AI call — the rephrase guard that already skips DB writes now also tags the pv-ai call with `'rephrase'`; all other messages use `'message'`.

**Tests**: 5 existing `aiService.startChat.toHaveBeenCalledWith` assertions updated to include the new `purpose` 8th arg; 2 existing `aiService.sendMessage.toHaveBeenCalledWith` assertions updated to include the new `purpose` 4th arg; 2 new tests added — `forwards purpose:"regenerate" to AiService when body contains previous_messages` and `forwards purpose:"rephrase" to AiService when message is a rephrase instruction`.

---

### 2. `GET /test-db` gated by NODE_ENV

`AppController.testDb()` now throws `NotFoundException` when `process.env.NODE_ENV === 'production'`. The endpoint remains accessible in `development` and `test` environments for local DB health checks. No new dependency — uses `process.env` directly. File: `src/app.controller.ts`.

---

### 3. Rate limiting on `POST /auth/login`

**Package installed:** `@nestjs/throttler` v6.5.0.

**Global config** (`src/app.module.ts`): `ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])` — 100 requests per 60 s as a broad global baseline (not applied globally via `APP_GUARD`; guard is applied only where needed).

**Login endpoint** (`src/auth/auth.controller.ts`): `@UseGuards(ThrottlerGuard)` + `@Throttle({ default: { ttl: 60000, limit: 5 } })` — limits each IP to 5 login attempts per 60 s. Returns HTTP 429 on breach.

No other endpoints are throttled. The `ThrottlerGuard` is not registered as `APP_GUARD` to avoid unintended 429s on AI/upload endpoints under load.

---

### Test count

162 (§29) → **164 passing**. `tsc --noEmit` clean.
