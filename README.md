# ProVOC BFF

Backend for Frontend service for the ProVOC platform. Built with NestJS, Prisma, PostgreSQL, and Redis.

## Stack

- **Framework:** NestJS (Node.js + TypeScript)
- **ORM:** Prisma
- **Database:** PostgreSQL
- **Cache / Session:** Redis
- **Auth:** JWT + Passport
- **Docs:** Swagger / OpenAPI (`/api/docs`)
- **Containerization:** Docker + docker-compose

## Getting Started

```bash
# Start infrastructure (Postgres + Redis + API)
docker compose up

# Or run locally (requires Postgres and Redis running)
npm install
npx prisma generate
npm run start:dev
```

The API will be available at `http://localhost:3001` and Swagger at `http://localhost:3001/api/docs`.

## Environment

Copy `.env.example` to `.env` and fill in the required values before starting.

## Development Workflow

All active development happens on the `dev` branch. The `master` branch reflects production-ready, tested deliverables only.

```
master  ← merged from dev only when a deliverable is fully tested
  └── dev  ← all development work goes here
        └── feature/...  ← short-lived feature branches (optional)
```

To promote dev to master:

```bash
git checkout master
git merge dev
git checkout dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for full branch rules and commit guidelines.

## Running Tests

```bash
# unit tests
npm run test

# test coverage
npm run test:cov

# e2e tests
npm run test:e2e
```

## License

MIT
