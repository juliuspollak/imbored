# App Store discovery and launch checklist

Public listing: https://apps.apple.com/au/app/imboredtoday/id6804962205
Website: https://imbored.au/

## Proposed App Store Connect metadata (requires owner review)

- **Name (27/30):** imBoredToday: Daily Puzzles
- **Subtitle (24/30):** Brain Games With Friends
- **Keyword field (93/100 characters):** `logic,brain teaser,maze,geography,visual,quiz,leaderboard,competition,thinking,number,pattern`
- **Primary category:** Puzzle (unchanged).
- **Promotional text:** Six quick daily games. Solve the same puzzles as everyone, compare scores, and challenge friends or family in Circles.
- **First description paragraph:** Play six quick daily puzzle games with friends and family. Solve the same daily Challenge as other players, compare your results and come back tomorrow for fresh puzzles. Create Circles to organise friendly competitions and see how everyone performed.

Correct the current public description's opening reference to **"mBored"** to match **"imBoredToday"**. Verify every claimed game and social feature in the current released build. Avoid trademarked competitor names and claims not present in the application.

App name and subtitle are at most 30 characters each. The keywords are a suggestion, not validated search-volume data; track impressions and conversions in App Store Connect and refine later. These updates are made in App Store Connect, and some require a new app version / review.

## Screenshots to prepare in App Store Connect

1. Home / daily challenge: **Six Daily Puzzles. One Challenge.**
2. Results / standings: **See How You Stack Up.**
3. Circles: **Challenge Friends & Family.**
4. Game selection: **Hive, Twist, Gridly & More.**
5. Practice: **Play Again in Practice Mode.**

Use genuine screenshots from the current version of the app. Text overlays should describe actual functionality. Avoid showing personal accounts or invented results.

## Launch verification

- Deploy the approved web change to production and confirm the CTA opens the correct live App Store listing on iPhone and desktop.
- Check landing page search title, meta description and shared-link preview in deployed HTML.
- Verify native iOS login and browser deep links are unchanged; public-page routing is guarded separately.
- Update App Store Connect metadata and screenshots, then verify the published listing.
- Consider completing Apple's accessibility feature declarations based on tested app behaviour (do not self-declare unsupported features).
- Review App Store Connect Analytics for product page views, search impressions and conversion; ask early users for genuine ratings without pressure or incentives.
