const TEXT_REPLACEMENTS = [
  [/\bQueens\b/g, "Hive"],
  [/\bqueens\b/g, "bees"],
  [/\bQueen\b/g, "Bee"],
  [/\bqueen\b/g, "bee"],
  [/\bCrowns\b/g, "Bees"],
  [/\bcrowns\b/g, "bees"],
  [/\bCrown\b/g, "Bee"],
  [/\bcrown\b/g, "bee"],
];

const ATTRIBUTE_NAMES = ["aria-label", "title", "alt", "placeholder"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);

function replaceCopy(value) {
  if (!value || !/(queen|crown)/i.test(value)) return value;
  return TEXT_REPLACEMENTS.reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), value);
}

function replaceTextNodes(root) {
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    if (SKIP_TAGS.has(node.parentElement?.tagName)) return;
    const next = replaceCopy(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  });
}

function replaceAttributes(root) {
  if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
  [root, ...root.querySelectorAll("*")].forEach((element) => {
    ATTRIBUTE_NAMES.forEach((attribute) => {
      const current = element.getAttribute(attribute);
      const next = replaceCopy(current);
      if (current && next !== current) element.setAttribute(attribute, next);
    });
  });
}

function exactTextElements(root, value) {
  return [...root.querySelectorAll("h1,h2,h3,h4,span,div,p")].filter((element) => element.children.length === 0 && element.textContent?.trim() === value);
}

function markHiveSurfaces(root) {
  exactTextElements(root, "Hive").forEach((label) => {
    let surface = label;
    for (let depth = 0; depth < 7 && surface?.parentElement; depth += 1) {
      surface = surface.parentElement;
      const crownCount = surface.querySelectorAll?.("svg.lucide-crown").length || 0;
      const buttonCount = surface.querySelectorAll?.("button").length || 0;
      if (crownCount > 0 || buttonCount > 4) {
        surface.classList.add("hive-branded-surface");
        break;
      }
    }

    const tile = label.closest("button,article,a,[role='button']") || label.parentElement?.parentElement;
    if (tile) tile.classList.add("hive-game-tile");
  });
}

function replaceGameCrowns(root) {
  root.querySelectorAll(".hive-branded-surface svg.lucide-crown, .hive-game-tile svg.lucide-crown").forEach((icon) => {
    if (icon.dataset.hiveReplaced === "true") return;
    const bee = document.createElement("span");
    bee.className = "hive-bee-piece";
    bee.setAttribute("aria-hidden", "true");
    bee.textContent = "🐝";
    icon.dataset.hiveReplaced = "true";
    icon.replaceWith(bee);
  });
}

function applyHiveBranding(root = document.body) {
  if (!root) return;
  replaceTextNodes(root);
  replaceAttributes(root);
  markHiveSurfaces(document.body);
  replaceGameCrowns(document.body);
}

function startHiveBranding() {
  applyHiveBranding();
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      applyHiveBranding();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startHiveBranding, { once: true });
} else {
  startHiveBranding();
}
