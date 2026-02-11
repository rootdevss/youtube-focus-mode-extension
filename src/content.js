// YouTube Focus Mode - content script (MV3)

const DEFAULTS = {
  // Focus Mode
  enabled: true,
  hideShorts: true,
  hideHomeFeed: false,
  hideRelated: true,
  hideComments: true,
  hideSidebar: false,

  // Extras
  autoTheater: false,
  rememberSpeedByChannel: true,
  defaultSpeed: 1.25,
  keyboardShortcuts: true,
  notesOpen: false
};

const STYLE_ID = "yt-focus-mode-style";
const NOTES_STYLE_ID = "yt-focus-notes-style";
const NOTES_PANEL_ID = "yt-focus-notes-panel";

let currentKeyHandler = null;
let currentRateHandler = null;
let currentUrl = location.href;

function isEditableTarget(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function parseVideoId() {
  try {
    const url = new URL(location.href);
    const v = url.searchParams.get("v");
    if (v) return v;
    // Shorts
    const m = url.pathname.match(/^\/shorts\/([^/?#]+)/);
    if (m) return m[1];
  } catch {}
  return null;
}

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function buildCss(settings) {
  if (!settings.enabled) return "";

  const rules = [];

  // Shorts
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

  // Home feed
  if (settings.hideHomeFeed) {
    rules.push(`
      ytd-browse[page-subtype="home"] ytd-rich-grid-renderer,
      ytd-browse[page-subtype="home"] ytd-rich-grid-row,
      ytd-browse[page-subtype="home"] ytd-rich-item-renderer {
        display: none !important;
      }
    `);
  }

  // Related videos
  if (settings.hideRelated) {
    rules.push(`
      #related,
      ytd-watch-next-secondary-results-renderer {
        display: none !important;
      }
    `);
  }

  // Comments
  if (settings.hideComments) {
    rules.push(`
      #comments,
      ytd-comments {
        display: none !important;
      }
    `);
  }

  // Sidebar
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

function upsertStyle(id, cssText) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.documentElement.appendChild(el);
  }
  el.textContent = cssText;
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

function getChannelKey() {
  const a =
    document.querySelector("ytd-watch-metadata ytd-channel-name a") ||
    document.querySelector("#channel-name a") ||
    document.querySelector("ytd-video-owner-renderer a.yt-simple-endpoint");

  const href = a?.getAttribute?.("href") || "";
  const text = (a?.textContent || "").trim();
  if (href) return `href:${href}`;
  if (text) return `name:${text}`;
  return null;
}

function getVideoEl() {
  return document.querySelector("video");
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

async function setSetting(key, value) {
  await chrome.storage.sync.set({ [key]: value });
}

async function toggleSetting(key) {
  const cur = await chrome.storage.sync.get({ [key]: DEFAULTS[key] });
  await setSetting(key, !cur[key]);
}

async function waitFor(selector, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = document.querySelector(selector);
    if (el) return el;
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

async function ensureTheater(settings) {
  if (!settings.autoTheater) return;
  // Only on watch pages
  if (!location.pathname.startsWith("/watch")) return;

  const flexy = await waitFor("ytd-watch-flexy", 6000);
  const sizeBtn = await waitFor(".ytp-size-button", 6000);
  if (!flexy || !sizeBtn) return;

  const isTheater = flexy.hasAttribute("theater") || flexy.getAttribute("theater") !== null;
  if (!isTheater) sizeBtn.click();
}

function toggleTheaterNow() {
  const btn = document.querySelector(".ytp-size-button");
  if (btn) btn.click();
}

async function setupSpeedMemory(settings) {
  const video = getVideoEl();
  if (!video) return;

  // Clean previous listener
  if (currentRateHandler) {
    video.removeEventListener("ratechange", currentRateHandler);
    currentRateHandler = null;
  }

  if (!settings.rememberSpeedByChannel) return;

  const channelKey = getChannelKey();
  const storageKey = channelKey ? `speedByChannel:${channelKey}` : null;

  // Apply initial rate once
  try {
    if (storageKey) {
      const data = await chrome.storage.sync.get({ [storageKey]: null });
      if (typeof data[storageKey] === "number") {
        video.playbackRate = clamp(data[storageKey], 0.25, 3);
      } else if (typeof settings.defaultSpeed === "number" && settings.defaultSpeed > 0) {
        video.playbackRate = clamp(settings.defaultSpeed, 0.25, 3);
      }
    } else if (typeof settings.defaultSpeed === "number" && settings.defaultSpeed > 0) {
      video.playbackRate = clamp(settings.defaultSpeed, 0.25, 3);
    }
  } catch {}

  currentRateHandler = async () => {
    if (!storageKey) return;
    try {
      await chrome.storage.sync.set({ [storageKey]: video.playbackRate });
    } catch {}
  };

  video.addEventListener("ratechange", currentRateHandler);
}

function setupKeyboard(settings) {
  if (currentKeyHandler) {
    document.removeEventListener("keydown", currentKeyHandler, true);
    currentKeyHandler = null;
  }

  if (!settings.keyboardShortcuts) return;

  currentKeyHandler = (e) => {
    if (!e.shiftKey) return;
    if (isEditableTarget(e.target)) return;

    const video = getVideoEl();

    switch (e.code) {
      case "KeyF":
        e.preventDefault();
        toggleSetting("enabled");
        break;
      case "KeyN":
        e.preventDefault();
        toggleSetting("notesOpen");
        break;
      case "KeyT":
        e.preventDefault();
        toggleTheaterNow();
        break;
      case "ArrowUp":
        if (!video) return;
        e.preventDefault();
        video.playbackRate = clamp((video.playbackRate || 1) + 0.25, 0.25, 3);
        break;
      case "ArrowDown":
        if (!video) return;
        e.preventDefault();
        video.playbackRate = clamp((video.playbackRate || 1) - 0.25, 0.25, 3);
        break;
      default:
        break;
    }
  };

  document.addEventListener("keydown", currentKeyHandler, true);
}

function removeNotesPanel() {
  const panel = document.getElementById(NOTES_PANEL_ID);
  if (panel) panel.remove();
  const style = document.getElementById(NOTES_STYLE_ID);
  if (style) style.remove();
}

async function loadNotes(videoId) {
  if (!videoId) return { text: "", items: [] };
  const key = `notes:${videoId}`;
  const data = await chrome.storage.sync.get({ [key]: { text: "", items: [] } });
  return data[key] || { text: "", items: [] };
}

async function saveNotes(videoId, notes) {
  if (!videoId) return;
  const key = `notes:${videoId}`;
  await chrome.storage.sync.set({ [key]: notes });
}

function ensureNotesStyle() {
  const css = `
    #${NOTES_PANEL_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 360px;
      max-width: calc(100vw - 32px);
      max-height: 60vh;
      background: rgba(20,20,20,0.92);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      z-index: 2147483647;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    }
    #${NOTES_PANEL_ID} header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255,255,255,0.12);
      font: 600 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #${NOTES_PANEL_ID} header .title {
      display: flex;
      gap: 10px;
      align-items: center;
      min-width: 0;
    }
    #${NOTES_PANEL_ID} header .title span {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 240px;
      opacity: 0.95;
    }
    #${NOTES_PANEL_ID} header button {
      border: 0;
      background: rgba(255,255,255,0.12);
      color: #fff;
      padding: 6px 10px;
      border-radius: 10px;
      cursor: pointer;
      font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #${NOTES_PANEL_ID} .body {
      padding: 10px 12px;
      display: grid;
      gap: 10px;
      overflow: auto;
    }
    #${NOTES_PANEL_ID} textarea {
      width: 100%;
      min-height: 110px;
      resize: vertical;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.16);
      padding: 10px;
      background: rgba(0,0,0,0.25);
      color: #fff;
      outline: none;
      font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #${NOTES_PANEL_ID} .row {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
    }
    #${NOTES_PANEL_ID} .row .hint {
      opacity: 0.75;
      font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    #${NOTES_PANEL_ID} .items {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    #${NOTES_PANEL_ID} .chip {
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(255,255,255,0.08);
      color: #fff;
      padding: 6px 10px;
      border-radius: 999px;
      cursor: pointer;
      font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
  `;
  upsertStyle(NOTES_STYLE_ID, css);
}

async function ensureNotesPanel(settings) {
  if (!settings.notesOpen) {
    removeNotesPanel();
    return;
  }

  ensureNotesStyle();

  let panel = document.getElementById(NOTES_PANEL_ID);
  if (!panel) {
    panel = document.createElement("div");
    panel.id = NOTES_PANEL_ID;
    panel.innerHTML = `
      <header>
        <div class="title">
          <span>Notas do vídeo</span>
        </div>
        <div class="actions">
          <button id="ytfn-close" title="Fechar">Fechar</button>
        </div>
      </header>
      <div class="body">
        <div class="row">
          <button id="ytfn-add">+ Timestamp</button>
          <div class="hint">Shift+N abre/fecha</div>
        </div>
        <div class="items" id="ytfn-items"></div>
        <textarea id="ytfn-text" placeholder="Anote aqui... (salvo por vídeo)"></textarea>
      </div>
    `;

    document.documentElement.appendChild(panel);

    panel.querySelector("#ytfn-close")?.addEventListener("click", () => setSetting("notesOpen", false));
  }

  const videoId = parseVideoId();
  const title = (document.querySelector("h1 yt-formatted-string")?.textContent || "Notas do vídeo").trim();
  panel.querySelector("header .title span").textContent = title || "Notas do vídeo";

  const textEl = panel.querySelector("#ytfn-text");
  const itemsEl = panel.querySelector("#ytfn-items");
  const addBtn = panel.querySelector("#ytfn-add");

  let notes = await loadNotes(videoId);
  if (!notes || typeof notes !== "object") notes = { text: "", items: [] };
  if (!Array.isArray(notes.items)) notes.items = [];

  // Render items
  const renderItems = () => {
    itemsEl.innerHTML = "";
    for (const it of notes.items) {
      const btn = document.createElement("button");
      btn.className = "chip";
      btn.textContent = it.label;
      btn.title = "Ir para este tempo";
      btn.addEventListener("click", () => {
        const v = getVideoEl();
        if (v) v.currentTime = it.t;
      });
      itemsEl.appendChild(btn);
    }
  };

  renderItems();
  textEl.value = notes.text || "";

  // Debounced save
  let saveTimer = null;
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      notes.text = textEl.value;
      saveNotes(videoId, notes);
    }, 400);
  };

  // Avoid stacking listeners if we re-open on SPA
  textEl.oninput = scheduleSave;

  addBtn.onclick = () => {
    const v = getVideoEl();
    if (!v) return;
    const t = Math.floor(v.currentTime || 0);
    const entry = { t, label: formatTime(t) };
    notes.items = [entry, ...notes.items].slice(0, 30);
    renderItems();
    saveNotes(videoId, notes);
  };
}

async function applyAll() {
  const settings = await getSettings();
  upsertStyle(STYLE_ID, buildCss(settings));

  // Extras
  setupKeyboard(settings);
  ensureNotesPanel(settings);

  // Watch page extras that may need DOM ready
  ensureTheater(settings);
  setupSpeedMemory(settings);
}

applyAll();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const keys = Object.keys(changes);
  if (keys.some(k => k in DEFAULTS) || keys.some(k => k.startsWith("notes:")) || keys.some(k => k.startsWith("speedByChannel:"))) {
    applyAll();
  }
});

// YouTube uses SPA navigation; watch for URL changes
new MutationObserver(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    applyAll();
  }
}).observe(document, { subtree: true, childList: true });
