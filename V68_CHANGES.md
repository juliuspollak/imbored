# Puzzle Games

Currently: Queens. Structured so more games can be dropped into `src/games/`
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

## Hidden-player privacy migration

After deploying this version, run this file once in **Supabase Dashboard → SQL Editor**:

```text
supabase/migration_complete_hidden_user_privacy.sql
```

The earlier implementation hid only the `profiles` row. This migration also hides the player's statistics, leaderboard entries, presence, team memberships, feedback, votes, release-note reactions and pokes at database level. Admins and the hidden player can still see the player's own data.

## Rewards & Progression v60

Run `supabase/migration_rewards_progression_v60.sql` after the v59 migrations.
It adds secure server-side Points awarding, streaks, levels, transfers, rewards,
wishes, redemptions, streak protection, and admin configuration. Players only
see a simple Points/Streak/Level interface; calculation details remain stored
in the private ledger for tuning and audit.
