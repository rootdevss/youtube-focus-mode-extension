// YouTube Focus Mode - content script

const DEFAULTS = {
  enabled: true,
  hideShorts: true,
  hideHomeFeed: false,
  hideRelated: true,
  hideComments: true,
  hideSidebar: false
};

const STYLE_ID = "yt-focus-mode-style";

function buildCss(settings) {
  if (!settings.enabled) return "";

  const rules = [];

  // Shorts: shelves, tabs, carousels and Shorts pages
  if (settings.hideShorts) {
    rules.push(`
      ytd-reel-shelf-renderer,
      ytd-rich-section-renderer[is-shorts],
      ytd-shorts,
      ytd-guide-entry-renderer a[title="Shorts"],
      a[title="Shorts"],
      a[href^="/shorts"],
      ytd-mini-guide-entry-renderer a[title="Shorts"],
      ytd-rich-item-renderer:has(a[href^="/shorts"]) {
        display: none !important;
      }
    `);
  }

  // Home feed (subscriptions/home recommendations grid)
  if (settings.hideHomeFeed) {
    rules.push(`
      ytd-browse[page-subtype="home"] ytd-rich-grid-renderer,
      ytd-browse[page-subtype="home"] ytd-rich-grid-row,
      ytd-browse[page-subtype="home"] ytd-rich-item-renderer {
        display: none !important;
      }
    `);
  }

  // Related videos (watch page)
  if (settings.hideRelated) {
    rules.push(`
      #related,
      ytd-watch-next-secondary-results-renderer {
        display: none !important;
      }
    `);
  }

  // Comments (watch page)
  if (settings.hideComments) {
    rules.push(`
      #comments,
      ytd-comments {
        display: none !important;
      }
    `);
  }

  // Sidebar (left navigation)
  if (settings.hideSidebar) {
    rules.push(`
      ytd-guide-renderer,
      #guide,
      #guide-content,
      ytd-mini-guide-renderer {
        display: none !important;
      }
    `);
  }

  return rules.join("\n");
}

function upsertStyle(cssText) {
  let el = document.getElementById(STYLE_ID);
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.documentElement.appendChild(el);
  }
  el.textContent = cssText;
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

async function apply() {
  const settings = await getSettings();
  upsertStyle(buildCss(settings));
}

// Re-apply on SPA navigation and storage changes
apply();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const keys = Object.keys(changes);
  if (keys.some(k => k in DEFAULTS)) apply();
});

// YouTube uses SPA navigation; watch for URL changes
let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    apply();
  }
}).observe(document, { subtree: true, childList: true });
