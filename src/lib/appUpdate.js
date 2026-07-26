const CHECK_INTERVAL_MS = 5 * 60 * 1000;

function currentBundlePath() {
  const script = document.querySelector('script[type="module"][src]');
  return script ? new URL(script.src, window.location.href).pathname : null;
}

async function deployedBundlePath() {
  const response = await fetch(`/?update-check=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) return null;

  const html = await response.text();
  const match = html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)
    || html.match(/<script[^>]+src=["']([^"']+)["'][^>]+type=["']module["']/i);
  return match ? new URL(match[1], window.location.origin).pathname : null;
}

export function enableAutomaticAppUpdates() {
  let checking = false;

  async function checkForUpdate() {
    if (checking || document.visibilityState === "hidden") return;
    checking = true;
    try {
      const [loaded, deployed] = await Promise.all([
        Promise.resolve(currentBundlePath()),
        deployedBundlePath(),
      ]);
      if (loaded && deployed && loaded !== deployed) {
        // Vite fingerprints every production asset, so once the fresh HTML
        // has been fetched a normal reload will select the new bundle. A
        // cache-busting query on the visible URL is unnecessary and used to
        // leave players stranded on `?app-update=...`.
        window.location.reload();
      }
    } catch {
      // Being offline or between deployments is normal; try again later.
    } finally {
      checking = false;
    }
  }

  window.addEventListener("pageshow", checkForUpdate);
  document.addEventListener("visibilitychange", checkForUpdate);
  window.setInterval(checkForUpdate, CHECK_INTERVAL_MS);
  void checkForUpdate();
}
