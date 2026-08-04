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

## iOS app (Capacitor)

The web app is wrapped with Capacitor. `capacitor.config.ts` bundles the built
`dist` into the app rather than pointing a web view at imbored.au — an app that
is only a web view onto a live site is the standard App Store guideline 4.2
rejection, and bundling also means the games work with no connection.

The trade-off: shipping a change to iOS now needs an App Store release, not just
a Vercel deploy.

**Everything below needs macOS.** Xcode and CocoaPods are Mac-only, so the
project cannot be generated, built, signed or submitted from Windows. Also
required: Xcode 15+, CocoaPods, and an Apple Developer Program membership.

First time, on the Mac:

```bash
npm install
npx cap add ios      # generates ios/ — commit it, it holds signing + Info.plist
npm run ios:sync     # vite build && cap sync ios
npm run ios:open     # opens Xcode
```

After any web change: `npm run ios:sync`.

Already configured here: bundle id `au.imbored.app`, bundled web assets,
full-bleed web view with `env(safe-area-inset-*)` padding, page-level
rubber-banding disabled, and self-hosted fonts so launch needs no network.

Still to do in Xcode (none of it possible from Windows):

- App icon set and launch screen.
- Display name `I’mBoredToday` in Info.plist (the Xcode project is ASCII
  `ImBoredToday`, since a curly apostrophe in a target name causes trouble).
- A `CFBundleURLTypes` entry for the OAuth callback scheme — Google refuses to
  complete sign-in inside a plain `WKWebView`, so that flow has to move to
  `ASWebAuthenticationSession` and return through a deep link.
- Sign in with Apple capability (guideline 4.8, required because Google
  sign-in is offered).

## Database schema

The current application-owned database is defined by:

- `supabase/schemas/public.sql` — tables, functions, triggers, policies and grants.
- `supabase/schemas/seed.sql` — non-personal game, benchmark and reward configuration.

These two files are the whole story. While the project is still in testing there
are no migration scripts to follow: edit the schema in place, apply it, and the
file always describes what the database should be. Never commit player or
authentication data.
