# Project Blueprint

## Project Description
This is a NestJS (Node.js + TypeScript) backend service that provides authentication and user management APIs, backed by PostgreSQL (via Prisma) and Redis, with Docker support for local development.

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

## Completed Tasks (Current/Old)
- Auth signup endpoint: `POST /auth/register`
- User update endpoint: `PATCH /users/:id` with validation and role checks
- User fetch endpoints: `GET /users/:id` and `GET /users` with access control
- User soft delete endpoint: `DELETE /users/:id` with cascade review soft delete
- Database schema with users, credentials, roles, permissions, listings, reviews, and related models
- Docker compose setup for API, PostgreSQL, and Redis

## Planned Tasks (Needs Confirmation)
- Expand review lifecycle endpoints (create, update, delete, moderation)
- Business and listing management endpoints
- Role and permission management APIs
- User preferences and consent management endpoints
- Background jobs for sync and notifications

## Notes
- Please confirm or adjust the planned tasks section so it matches the actual roadmap.
