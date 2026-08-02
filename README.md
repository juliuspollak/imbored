# Puzzle Games

Currently: Hive. Structured so more games can be dropped into `src/games/`
and wired into `src/App.jsx` as they're built.

## Local dev

```bash
npm install
npm run dev
```

Opens at http://localhost:5173

## Build

```bash
npm run build
```

Outputs static files to `dist/`.

## Deploy (Vercel — free, easiest)

1. Push this folder to a new GitHub repo
2. Go to vercel.com → "Add New Project" → import the repo
3. Vercel auto-detects Vite, no config needed — click Deploy
4. You get a live URL immediately (e.g. `puzzle-games.vercel.app`), and it
   redeploys automatically on every push to `main`

## Deploy (Netlify — also free, near-identical)

1. Push to GitHub
2. netlify.com → "Add new site" → import the repo
3. Build command: `npm run build`, publish directory: `dist`
4. Deploy

## Custom domain

Both Vercel and Netlify let you attach your own domain for free under
Project Settings → Domains — just point a CNAME/A record at them.

## Database schema

The current application-owned database is defined by:

- `supabase/schemas/public.sql` — tables, functions, triggers, policies and grants.
- `supabase/schemas/seed.sql` — non-personal game, benchmark and reward configuration.

The schema was baselined from the test project after the v211 scoring cleanup.
Historical root-level migrations are no longer the source of truth. Make schema
changes declaratively, review the generated diff, and deploy only the new
forward migration. Never commit player or authentication data.
