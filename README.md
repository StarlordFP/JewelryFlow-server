# JewelryFlow Backend

NestJS API for the JewelryFlow ERP.

## Database

- **Backup:** `npm run db:backup` — saves to `server/backups/`
- **Restore:** `npm run db:restore backups/jewelryflow-backup-<timestamp>.sql`
- **Test DB setup:** `npm run db:test:create` then `npm run db:test:setup` — creates `jewelryflow_test` for integration tests
- **NEVER** run `npm run test:integration` without `.env.test` configured — integration tests run destructive cleanup on their target database

### Test database isolation

Integration tests load `server/.env.test` (not `.env`). Copy `.env` to `.env.test` and change the database name to `jewelryflow_test`:

```
DATABASE_URL="postgresql://user:password@localhost:5432/jewelryflow_test"
```

First-time setup:

```bash
npm run db:test:create   # CREATE DATABASE jewelryflow_test
npm run db:test:setup    # apply migrations
dotenv -e .env.test -- prisma db seed   # optional: seed test data
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run start:dev` | Start API in watch mode |
| `npm run test` | Unit tests + integration tests (serial) |
| `npm run test:integration` | Integration tests only |
| `npm run db:backup` | pg_dump dev database |
| `npm run db:restore` | Restore dev database from backup file |
