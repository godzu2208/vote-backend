# vote-backend V2 — hardened build

This build keeps the existing V1 APIs and V2 Game APIs, while hardening the Game lifecycle.

## Required Supabase migration

Run the migrations in order. **New in this build:**

- `migrations/007_games_atomic_v2.sql`

This migration adds:

- `update_game_atomic()` — Game Builder updates are performed in one PostgreSQL transaction.
- `reset_game_to_lobby()` — closed games can be reopened with old votes/selections/logs cleared.
- `reset_game_and_start()` — closed games can be restarted as a completely fresh round.

## Important

Do not copy `.env` from a source archive into GitHub. Keep production secrets only in the server environment.

The repository package intentionally excludes `.env`, `node_modules`, and generated `dist` output. Build on the target environment with:

```bash
npm ci
npm run build
```

Then restart the PM2 process.
