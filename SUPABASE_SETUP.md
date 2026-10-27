# Shared database setup (Supabase / Postgres)

## One person (once)
1. Create a project at https://supabase.com and invite your teammate (Project Settings -> Team).
2. SQL Editor -> paste `database/schema.pg.sql` -> Run.
3. Project -> **Connect** -> copy the **Session pooler** connection string.
4. Put it in `backend/.env` (see `backend/.env.example`), then seed ONCE:
   ```bash
   cd backend && npm install
   node ../database/seed.js      # refuses to run if courses already exist
   ```

## Everyone
```bash
cp backend/.env.example backend/.env   # paste the shared DATABASE_URL + same JWT_SECRET
npm install && npm run dev
```
Share the real `.env` values privately (never commit them).

## Rules for a shared DB
- Schema changes go in new numbered files (`database/migrations/002_xxx.sql`), run by whoever merges.
- `database/resetSimulation.js` wipes everyone's enrollments - coordinate before running it.
- The old MySQL files (`schema.sql`, `backfill_registration_order.sql`) are kept for reference only.

## Deploy
- Backend (needs a long-running server for Socket.IO - use Render/Railway/Fly, NOT Vercel functions):
  env vars `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN=<your frontend URL>`; start command `node index.js`.
- Frontend (Vercel/Netlify): env var `REACT_APP_API_URL=<your backend URL>` (no trailing slash, no /api).
