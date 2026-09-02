# ProVOC BFF (`pv-bff`)

NestJS backend-for-frontend that acts as the single API gateway for the ProVOC mobile app.

**Responsibilities:**
- JWT authentication
- Business listing search (Google Places API) and Zembra multi-platform matching
- Review lifecycle: draft → AI compose → publish
- Proxy to the `pv-ai` AI sidecar (with JWT relay auth + per-user token cache)
- Async platform posting via BullMQ / Redis
- User profile, preferences, avatar, and password management
- S3 photo upload for review media
- Content filter and recommendations proxy

---

## Table of contents

1. [Tech stack](#tech-stack)
2. [Prerequisites](#prerequisites)
3. [Environment variables](#environment-variables)
4. [Running locally](#running-locally)
5. [Database setup](#database-setup)
6. [API reference](#api-reference)
7. [Database schema](#database-schema)
8. [Module overview](#module-overview)
9. [Testing](#testing)
10. [Deployment (Railway)](#deployment-railway)
11. [Known limitations](#known-limitations)

---

## Tech stack

| Package | Version | Purpose |
|---|---|---|
| NestJS | ^11.0.1 | Framework |
| TypeScript | ^5.7.3 | Language |
| Prisma | ^6.19.2 | ORM + migrations |
| PostgreSQL | 15 | Primary database |
| Redis | 7-alpine | BullMQ queue + session cache |
| BullMQ | ^5.76.10 | Async review posting queue |
| `@nestjs/jwt` | ^11.0.2 | JWT issuance and verification |
| `@nestjs/throttler` | ^6.5.0 | Rate limiting (`POST /auth/login`: 5 req / 60 s) |
| `@aws-sdk/client-s3` | v3 | S3 photo upload |
| `@nestjs/swagger` | ^11.4.2 | OpenAPI docs at `/api` |

---

## Prerequisites

- Node.js 20+
- Docker Desktop (PostgreSQL + Redis)
- A Google Cloud API key with **Places API (New)** enabled
- A Zembra API token (for `GET /zembra/match` — requires a running ngrok tunnel in dev)
- AWS credentials with access to the `provoc-review-media` S3 bucket

---

## Environment variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | Yes | HTTP listen port (default `3001`) |
| `DATABASE_URL` | Yes | Prisma async connection string |
| `JWT_SECRET` | Yes | JWT signing key |
| `JWT_EXPIRES_IN` | No | Token lifespan (default `7d`) |
| `REDIS_HOST` | Yes | BullMQ Redis host |
| `REDIS_PORT` | Yes | BullMQ Redis port |
| `REDIS_PASSWORD` | No | Redis auth password |
| `GOOGLE_PLACES_API_KEY` | Yes | Google Places Text Search API key |
| `FASTAPI_URL` | Yes | URL of the `pv-ai` sidecar |
| `PJAI_SHARED_SECRET` | Yes | Shared secret for the pv-ai relay endpoint |
| `AWS_ACCESS_KEY_ID` | Yes | AWS IAM key for S3 |
| `AWS_SECRET_ACCESS_KEY` | Yes | AWS IAM secret for S3 |
| `AWS_REGION` | Yes | AWS region (e.g. `us-east-1`) |
| `AWS_S3_BUCKET` | Yes | S3 bucket name (e.g. `provoc-review-media`) |
| `ZEMBRA_API_URL` | Yes (Zembra match) | Base URL of the ngrok tunnel pointing at the local Zembra server. Must be updated on Railway every time the ngrok tunnel restarts (free-tier URLs are ephemeral) |
| `ZEMBRA_API_TOKEN` | Yes (Zembra match) | Bearer token read by `ZembraService`. Note: `ZEMBRA_API_KEY` is **not** read by the Zembra module — only `ZEMBRA_API_TOKEN` is |
| `FACEBOOK_TEST_TOKEN` | Yes (posting) | Meta Graph Explorer user access token for the Facebook posting demo |

> **Recurring mistake:** when pasting values into Railway's Raw Editor, double-check that the value field doesn't contain the variable name as a literal prefix (e.g. `ZEMBRA_API_URL=ZEMBRA_API_URL=https://...`). This has caused real production outages before.

---

## Running locally

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your values

# 3. Start Docker services (Postgres + Redis only, recommended for dev)
docker-compose up -d database redis

# 4. Apply migrations
npx prisma migrate deploy

# 5. Seed platform network data (run once)
npx prisma db seed

# 6. Start in watch mode
npm run start:dev

# API at http://localhost:3001
# Swagger UI at http://localhost:3001/api
```

---

## Database setup

### Apply migrations

```bash
npx prisma migrate deploy
```

### Seed network records

```bash
npx prisma db seed
```

Seeds four platform networks with their `NetworkPreference` records: Google, Yelp, Trustpilot, Facebook. All upserts — safe to re-run.

### Apply a new migration to Railway production

Always apply immediately after creating a migration — a deployed-code / unapplied-migration mismatch has caused production outages:

```bash
$env:DATABASE_URL="<railway-public-connection-string>"   # PowerShell
# or
DATABASE_URL="<railway-public-connection-string>"        # bash
npx prisma migrate deploy
```

> Do not run bare `npx prisma migrate deploy` without overriding `DATABASE_URL` — it will silently succeed against your local database and leave Railway untouched.

---

## API reference

All endpoints except auth require `Authorization: Bearer <JWT>`. Full interactive docs at `http://localhost:3001/api`.

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create account; returns JWT |
| `POST` | `/auth/login` | Login; returns JWT. Rate-limited: 5 requests / 60 s per IP |

### Listings

| Method | Path | Description |
|---|---|---|
| `GET` | `/listings/search?q=&lat=&lng=` | Google Places Text Search — returns record-keyed results (`google`, `google_1`, …) with `photo_reference` |
| `POST` | `/listings` | Save a listing to DB. Idempotent on `external_listing_id` |
| `GET` | `/listings/:id` | Fetch saved listing; always includes `networks: []` |

### Zembra

| Method | Path | Description |
|---|---|---|
| `GET` | `/zembra/match?name=&address=` | Look up a business on Yelp/Google via Zembra. Requires `ZEMBRA_API_URL` pointing at a live ngrok tunnel |

### Networks

| Method | Path | Description |
|---|---|---|
| `GET` | `/networks` | All active networks: `[{ network_id, name, slug, post_auth_type }]` |

### Reviews

| Method | Path | Description |
|---|---|---|
| `POST` | `/reviews` | Create draft. Idempotent: returns existing draft if `(user_id, listing_id)` pair already has one |
| `GET` | `/reviews` | Paginated list. Filters: `status`, `listing_id`, `search`, `date_from/to`. Sort: `created_at`, `rating`, `updated_at` |
| `GET` | `/reviews/dashboard` | Totals, by-status counts, recent reviews, top businesses |
| `GET` | `/reviews/stats` | Aggregated stats: avg rating, monthly counts, languages |
| `GET` | `/reviews/recent-check?business_id=` | Returns `{ hasRecentReview, lastReviewedAt }` — reviewed in last 24 h? |
| `GET` | `/reviews/category-breakdown` | Per-category rating averages across all user reviews |
| `GET` | `/reviews/:id` | Full review with business, listing, network |
| `PATCH` | `/reviews/:id` | Update `review_text`, `rating`, `tone`, `status`, `language`, `category_ratings`, `selected_networks`. Owner only |
| `DELETE` | `/reviews/:id` | Soft delete. Owner only |

### Review publishing

| Method | Path | Description |
|---|---|---|
| `GET` | `/reviews/:id/publish-link?platform_id=` | Clipboard deep-link URL + review text. Creates `review_platform_posts` row with `status: clipboard_opened` |
| `POST` | `/reviews/:id/publish` | Enqueue BullMQ posting job. Returns `{ queued, skipped }` immediately |
| `POST` | `/reviews/:id/publish/retry` | Re-queue all failed platform posts |
| `GET` | `/reviews/:id/posts` | List all platform post records |

### AI review composer

| Method | Path | Description |
|---|---|---|
| `POST` | `/reviews/:id/transcribe` | `multipart/form-data`, field `audio`. Calls pv-ai Whisper → saves transcript to review |
| `POST` | `/reviews/:id/chat/start` | Start AI chat session. Body: `{ listing_context?, language, previous_messages?, purpose? }` |
| `POST` | `/reviews/:id/chat/message` | Send a chat turn. Body: `{ message, session_id?, purpose? }` |
| `POST` | `/reviews/:id/chat/approve` | Approve review; saves `review_text`, `rating`, `conversation_summary` to DB |
| `POST` | `/reviews/:id/chat/filter` | Content moderation proxy to pv-ai. Returns `{ approved, warning?, reason? }` |
| `GET` | `/reviews/:id/chat/history` | All chat messages for this review, ascending |
| `GET` | `/reviews/:id/drafts` | All saved drafts with network name |

### Review media (photos)

| Method | Path | Description |
|---|---|---|
| `POST` | `/reviews/:id/media` | Upload a JPEG/PNG (`photo` field, max 5 MB). Stores in S3 + `review_medias` table |
| `GET` | `/reviews/:id/media` | List photos as presigned S3 URLs (1-hour expiry) |
| `DELETE` | `/reviews/:id/media/:mediaId` | Delete from S3 and DB. Owner only |

### User profile

| Method | Path | Description |
|---|---|---|
| `GET` | `/auth/me` | Current user: `user_id`, `email`, `display_name`, `avatar_data` |
| `PATCH` | `/users/me` | Update `display_name` / `email`. 409 if email taken |
| `PATCH` | `/users/me/password` | Change password. 401 if current password wrong |
| `PATCH` | `/users/me/avatar` | Upload avatar as base64 data URI. 400 if > 2 MB |
| `GET` | `/users/me/preferences` | Get user preferences |
| `PATCH` | `/users/me/preferences` | Update `preferred_networks` (inclusion list of enabled platform slugs; new users default to `['google', 'yelp']`) |

### Recommendations

| Method | Path | Description |
|---|---|---|
| `GET` | `/recommendations` | Proxy to pv-ai recommendations. Returns `[]` gracefully if pv-ai unavailable |

---

## Database schema

21 tables across 22 Prisma models. Key models:

| Model | Table | Notes |
|---|---|---|
| `User` | `users` | Core user record; includes `avatar_data Text?` |
| `UserCredential` | `user_credentials` | bcrypt-hashed passwords |
| `UserPreference` | `user_preferences` | `preferred_networks Json?`, `default_tone` |
| `Business` | `businesses` | Upserted from listing search results |
| `Listing` | `listings` | One row per business × platform. Includes `zembra_external_id String?` |
| `Network` | `networks` | Seeded: Google, Yelp, Trustpilot, Facebook |
| `NetworkPreference` | `network_preferences` | `post_auth_type`, `supports_api_posting`, char limits etc. |
| `Review` | `reviews` | `status`: `draft` → `pending` → `posted`. Includes `category_ratings Json?`, `selected_networks Json?`, `conversation_summary String?` |
| `ReviewChatMessage` | `review_chat_messages` | Persisted chat history per review |
| `ReviewPlatformPost` | `review_platform_posts` | One row per review × platform posting attempt |
| `ReviewMedia` | `review_medias` | S3 key + metadata for uploaded photos |
| `ConversationSummary` | `conversation_summaries` | AI-generated summary saved on `chat/approve` |

### Applied migrations (11 total)

1. `20260310132406_init` — initial schema (19 tables)
2. `20260312000001_add_user_credentials`
3. `20260518202432_add_review_indexes`
4. `20260519073404_add_ai_session_id`
5. `20260530021019_add_chat_history`
6. `20260531012428_add_conversation_summary`
7. `20260617000052_add_zembra_external_id`
8. `20260619_add_avatar_data`
9. `20260619_add_category_ratings`
10. `20260619_add_selected_networks`
11. `20260629024506_add_conversation_summaries`

---

## Module overview

```
src/
├── auth/          JWT auth, login, register, rate limiting
├── listings/      Google Places search, Zembra, save listing
├── networks/      GET /networks
├── reviews/       Review CRUD, AI composer proxy, posting, publish-link
├── zembra/        GET /zembra/match (ngrok → local Zembra server)
├── ai/            pv-ai HTTP proxy with JWT relay + 25-min token cache
├── users/         PATCH /users/me, avatar, password, preferences
├── media/         S3 photo upload/retrieve/delete
├── recommendations/ GET /recommendations proxy
└── prisma/        Global PrismaService
```

---

## Testing

```bash
# Run all unit tests
npm test

# Run with coverage report
npm run test:cov

# Run a single suite
npx jest src/reviews/reviews.service.spec.ts

# E2e tests (requires running DB)
npm run test:e2e
```

**Current test count: 165 passing** across 13 suites. No DB required for unit tests — Prisma is fully mocked.

| Suite | Tests |
|---|---|
| AppController | 1 |
| AuthService | 3 |
| ListingsService | 11 |
| NetworksService | 4 |
| ReviewsService | 65 |
| PostingWorker | 5 |
| FacebookService | 2 |
| AiService | ~10 |
| RecommendationsController | 2 |
| Others | ~62 |

---

## Deployment (Railway)

The service auto-deploys from the `dev` branch on Railway.

**Build command** (in `package.json`):
```
prisma generate && nest build
```

`prisma generate` is included in the build step because Railway caches `node_modules` and `postinstall` does not re-run on schema changes.

### After adding a new route — always verify the deploy

A new route returning 401 is almost always a stale Railway image (the old image has no route registered, and Railway's reverse proxy returns 401 for unknown paths). Checklist:
1. Confirm Railway dashboard shows the new commit SHA building/deployed.
2. Wait for "Deploy successful."
3. Only then test the new endpoint.

### Key Railway env vars

All values live in the Railway dashboard. Variable names:  
`DATABASE_URL`, `JWT_SECRET`, `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `GOOGLE_PLACES_API_KEY`, `FASTAPI_URL`, `PJAI_SHARED_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`, `ZEMBRA_API_URL`, `ZEMBRA_API_TOKEN`, `FACEBOOK_TEST_TOKEN`

---

## Known limitations

- **Zembra ngrok:** `GET /zembra/match` requires an active ngrok tunnel pointing at the local Zembra Docker stack. Free-tier ngrok URLs are ephemeral — update `ZEMBRA_API_URL` on Railway and redeploy before every demo session that needs live Zembra data.
- **Facebook, TripAdvisor, Trustpilot:** permanently out of scope. Facebook is blocked at the Zembra credentials level, TripAdvisor by Cloudflare bot-detection, Trustpilot by a Zembra auth config error. Do not re-attempt without confirming the underlying issues are resolved.
- **Posting worker:** `PostingWorker` calls the Facebook Graph API for all queued jobs regardless of platform. Multi-platform real posting is not implemented.
- **No RBAC enforcement:** `roles`, `permissions`, `role_permissions`, `user_roles` tables exist in the schema but no API endpoints or guards are implemented.
- **ReviewHistory not written:** status changes are not logged to the `review_histories` table despite the table existing.
- **`user_platform_account_id` nullable mismatch:** the schema marks this as nullable but the applied migration still has `NOT NULL`. Run `prisma migrate dev` to propagate before going to production.
- **Dockerfile CMD:** currently `npm run start:dev` (watch mode). Change to `node dist/main` for a real production image.
- **`GET /test-db`:** gated by `NODE_ENV !== 'production'` — remove or confirm this guard is in place before any public deployment.
