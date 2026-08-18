import { supabase, supabaseReady } from "./supabase.js";

const PUZZLE_MARKER = /\[\[puzzle:(\d+)\]\]/i;

export function openPuzzlePractice(statId) {
  const id = Number(statId);
  if (!Number.isFinite(id) || id <= 0 || typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("puzzle", String(id));
  url.searchParams.delete("rush");
  window.location.assign(`${url.pathname}${url.search}${url.hash}`);
}

export async function sharePuzzleWithCircles(statId) {
  if (!supabaseReady) return { data:null, error:new Error("Sharing is unavailable right now.") };
  const id = Number(statId);
  if (!Number.isFinite(id) || id <= 0) return { data:null, error:new Error("This puzzle result is unavailable.") };
  return supabase.rpc("share_puzzle_with_circles", { target_stat_id:id });
}

function decoratePuzzleText(element) {
  if (!element || element.dataset.puzzleShareDecorated === "true") return;
  const text = element.textContent || "";
  const match = text.match(PUZZLE_MARKER);
  if (!match) return;

  const statId = Number(match[1]);
  element.dataset.puzzleShareDecorated = "true";
  element.textContent = text.replace(PUZZLE_MARKER, "").trim();

  if (element.classList.contains("chats-preview")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Play puzzle";
  button.setAttribute("aria-label", "Play this shared puzzle in practice mode");
  button.style.marginTop = "8px";
  button.style.padding = "7px 12px";
  button.style.border = "0";
  button.style.borderRadius = "999px";
  button.style.background = "var(--color-primary)";
  button.style.color = "var(--color-primary-text)";
  button.style.fontSize = "12px";
  button.style.fontWeight = "800";
  button.style.cursor = "pointer";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPuzzlePractice(statId);
  });
  element.insertAdjacentElement("afterend", button);
}

// ChallengeStandings has the saved game_stats id. The replay RPC owns the
// decision about whether that result can be replayed, including reconstructing
// older deterministic seeds. React can re-apply the old disabled prop after a
// standings refresh, so keep the DOM control enabled whenever that happens.
function enableChallengeResultReplay(root = document) {
  const buttons = [];
  if (root.matches?.(".challenge-result-replay")) buttons.push(root);
  root.querySelectorAll?.(".challenge-result-replay").forEach((button) => buttons.push(button));
  buttons.forEach((button) => {
    if (!button.disabled) return;
    button.disabled = false;
    button.style.opacity = "1";
    button.style.cursor = "pointer";
    button.style.touchAction = "manipulation";
  });
}

export function enablePuzzleShareLinks() {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};

  const scan = (root = document) => {
    root.querySelectorAll?.(".chat-text, .chats-preview").forEach(decoratePuzzleText);
    enableChallengeResultReplay(root);
  };

  scan();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        if (mutation.target instanceof Element && mutation.target.matches?.(".challenge-result-replay")) {
          enableChallengeResultReplay(mutation.target);
        }
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(".chat-text, .chats-preview")) decoratePuzzleText(node);
        scan(node);
      }
    }
  });
  observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:["disabled"] });
  return () => observer.disconnect();
}
