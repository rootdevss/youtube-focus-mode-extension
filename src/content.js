// YouTube Focus Mode - content script (MV3)

const DEFAULTS = {
  // Focus Mode
  enabled: false,
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
  notesOpen: false,
  commentSearch: true
};

const STYLE_ID = "yt-focus-mode-style";
const NOTES_STYLE_ID = "yt-focus-notes-style";
const NOTES_PANEL_ID = "yt-focus-notes-panel";
const COMMENT_STYLE_ID = "yt-focus-comment-search-style";
const COMMENT_BAR_ID = "yt-focus-comment-search";

let currentKeyHandler = null;
let currentRateHandler = null;
let currentUrl = location.href;
let dragState = null;

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

  if (settings.hideHomeFeed) {
    rules.push(`
      ytd-browse[page-subtype="home"] ytd-rich-grid-renderer,
      ytd-browse[page-subtype="home"] ytd-rich-grid-row,
      ytd-browse[page-subtype="home"] ytd-rich-item-renderer {
        display: none !important;
      }
    `);
  }

  if (settings.hideRelated) {
    rules.push(`
      #related,
      ytd-watch-next-secondary-results-renderer {
        display: none !important;
      }
    `);
  }

  if (settings.hideComments) {
    rules.push(`
      #comments,
      ytd-comments {
        display: none !important;
      }
    `);
  }

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

  if (currentRateHandler) {
    video.removeEventListener("ratechange", currentRateHandler);
    currentRateHandler = null;
  }

  if (!settings.rememberSpeedByChannel) return;

  const channelKey = getChannelKey();
  const storageKey = channelKey ? `speedByChannel:${channelKey}` : null;

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

function removeNotesPanel() {
  document.getElementById(NOTES_PANEL_ID)?.remove();
  document.getElementById(NOTES_STYLE_ID)?.remove();
}

function makeId(prefix = "n") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeEmptyNotesData() {
  const id = makeId("note");
  return {
    version: 2,
    activeId: id,
    notes: [
      {
        id,
        title: "nota 1",
        text: "",
        items: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ]
  };
}

function normalizeNotesData(raw) {
  if (raw && typeof raw === "object" && raw.version === 2 && Array.isArray(raw.notes)) {
    if (!raw.activeId && raw.notes[0]?.id) raw.activeId = raw.notes[0].id;
    if (!raw.notes.some(n => n.id === raw.activeId) && raw.notes[0]?.id) raw.activeId = raw.notes[0].id;
    return raw;
  }

  // migrate old shape { text, items }
  if (raw && typeof raw === "object" && ("text" in raw || "items" in raw)) {
    const id = makeId("note");
    const text = typeof raw.text === "string" ? raw.text : "";
    const items = Array.isArray(raw.items) ? raw.items : [];

    return {
      version: 2,
      activeId: id,
      notes: [
        {
          id,
          title: "nota 1",
          text,
          items,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ]
    };
  }

  return makeEmptyNotesData();
}

async function loadNotes(videoId) {
  if (!videoId) return makeEmptyNotesData();
  const key = `notes:${videoId}`;
  const data = await chrome.storage.sync.get({ [key]: null });
  return normalizeNotesData(data[key]);
}

async function saveNotes(videoId, notesData) {
  if (!videoId) return;
  const key = `notes:${videoId}`;
  await chrome.storage.sync.set({ [key]: notesData });
}

async function deleteNotes(videoId) {
  if (!videoId) return;
  const key = `notes:${videoId}`;
  await chrome.storage.sync.remove([key]);
}

async function loadNotesPos() {
  const data = await chrome.storage.sync.get({ notesPanelPos: null });
  return data.notesPanelPos;
}

async function saveNotesPos(pos) {
  await chrome.storage.sync.set({ notesPanelPos: pos });
}

function ensureNotesStyle() {
  const css = `
    #${NOTES_PANEL_ID} {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 380px;
      max-width: calc(100vw - 32px);
      max-height: 66vh;
      background: var(--yt-spec-raised-background, rgba(24,24,24,0.94));
      color: var(--yt-spec-text-primary, #fff);
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.14));
      border-radius: 14px;
      z-index: 2147483647;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 12px 34px rgba(0,0,0,0.35);
    }

    #${NOTES_PANEL_ID} header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.14));
      font: 700 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      cursor: grab;
      user-select: none;
    }

    #${NOTES_PANEL_ID}.dragging header { cursor: grabbing; }

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
      max-width: 210px;
      opacity: 0.95;
    }

    #${NOTES_PANEL_ID} header .actions {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      flex: 0 0 auto;
    }

    #${NOTES_PANEL_ID} header button {
      border: 0;
      background: var(--yt-spec-badge-chip-background, rgba(255,255,255,0.12));
      color: var(--yt-spec-text-primary, #fff);
      padding: 6px 10px;
      border-radius: 999px;
      cursor: pointer;
      font: 700 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }

    #${NOTES_PANEL_ID} header button:hover { filter: brightness(1.06); }

    #${NOTES_PANEL_ID} header button.danger {
      background: rgba(239, 68, 68, 0.18);
      color: var(--yt-spec-text-primary, #fff);
    }

    #${NOTES_PANEL_ID} .body {
      padding: 10px 12px 12px 12px;
      display: grid;
      gap: 10px;
      overflow: auto;
    }

    #${NOTES_PANEL_ID} .note-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    #${NOTES_PANEL_ID} .note-tabs {
      display: flex;
      gap: 8px;
      align-items: center;
      overflow-x: auto;
      overflow-y: hidden;
      padding-bottom: 2px;
      flex: 1 1 auto;
    }

    #${NOTES_PANEL_ID} .note-tabs::-webkit-scrollbar { height: 6px; }
    #${NOTES_PANEL_ID} .note-tabs::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.18);
      border-radius: 99px;
    }

    #${NOTES_PANEL_ID} .note-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.16));
      background: var(--yt-spec-badge-chip-background, rgba(255,255,255,0.08));
      color: var(--yt-spec-text-primary, #fff);
      padding: 6px 10px;
      border-radius: 999px;
      font: 800 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      white-space: nowrap;
    }

    #${NOTES_PANEL_ID} .note-chip.active {
      background: var(--yt-spec-call-to-action, #065fd4);
      border-color: transparent;
      color: #fff;
    }

    #${NOTES_PANEL_ID} .note-chip button {
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 0 2px;
      font: inherit;
      opacity: 0.95;
    }

    #${NOTES_PANEL_ID} .note-chip button:hover { opacity: 1; }
    #${NOTES_PANEL_ID} .note-chip .del { opacity: 0.75; }

    #${NOTES_PANEL_ID} .mini {
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.16));
      background: var(--yt-spec-badge-chip-background, rgba(255,255,255,0.08));
      color: var(--yt-spec-text-primary, #fff);
      padding: 6px 10px;
      border-radius: 999px;
      cursor: pointer;
      font: 800 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      white-space: nowrap;
    }

    #${NOTES_PANEL_ID} .mini:hover { filter: brightness(1.06); }

    #${NOTES_PANEL_ID} textarea {
      width: 100%;
      min-height: 120px;
      resize: vertical;
      border-radius: 12px;
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.16));
      padding: 10px 12px;
      background: var(--yt-spec-base-background, rgba(0,0,0,0.18));
      color: var(--yt-spec-text-primary, #fff);
      outline: none;
      font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }

    #${NOTES_PANEL_ID} textarea:focus {
      border-color: var(--yt-spec-call-to-action, #065fd4);
      box-shadow: 0 0 0 3px rgba(6,95,212,0.18);
    }

    #${NOTES_PANEL_ID} .row {
      display: flex;
      gap: 10px;
      align-items: center;
      justify-content: space-between;
    }

    #${NOTES_PANEL_ID} .row .hint {
      opacity: 0.72;
      font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }

    #${NOTES_PANEL_ID} .items {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    #${NOTES_PANEL_ID} .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,0.16));
      background: var(--yt-spec-badge-chip-background, rgba(255,255,255,0.08));
      color: var(--yt-spec-text-primary, #fff);
      padding: 6px 10px;
      border-radius: 999px;
      font: 800 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }

    #${NOTES_PANEL_ID} .chip button {
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 0 4px;
      font: inherit;
      opacity: 0.95;
    }

    #${NOTES_PANEL_ID} .chip button:hover { opacity: 1; }
    #${NOTES_PANEL_ID} .chip .del { opacity: 0.75; }

    #${NOTES_PANEL_ID} .footer {
      display: flex;
      justify-content: flex-end;
    }

    #${NOTES_PANEL_ID} .link {
      border: 0;
      background: transparent;
      color: var(--yt-spec-text-secondary, rgba(255,255,255,0.78));
      cursor: pointer;
      font: 700 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      padding: 4px 6px;
      opacity: 0.9;
      text-decoration: underline;
      text-underline-offset: 3px;
    }

    #${NOTES_PANEL_ID} .link:hover { opacity: 1; }
  `;

  upsertStyle(NOTES_STYLE_ID, css);
}

function startDrag(panel, e) {
  if (!panel) return;
  const header = panel.querySelector("header");
  if (!header) return;

  if (e.target && (e.target.tagName || "").toUpperCase() === "BUTTON") return;

  const rect = panel.getBoundingClientRect();
  dragState = {
    startX: e.clientX,
    startY: e.clientY,
    startLeft: rect.left,
    startTop: rect.top,
    w: rect.width,
    h: rect.height
  };

  panel.classList.add("dragging");

  const onMove = (ev) => {
    if (!dragState) return;
    const dx = ev.clientX - dragState.startX;
    const dy = ev.clientY - dragState.startY;

    const newLeft = clamp(dragState.startLeft + dx, 8, window.innerWidth - dragState.w - 8);
    const newTop = clamp(dragState.startTop + dy, 8, window.innerHeight - dragState.h - 8);

    panel.style.left = `${newLeft}px`;
    panel.style.top = `${newTop}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  };

  const onUp = async () => {
    panel.classList.remove("dragging");
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);

    const r = panel.getBoundingClientRect();
    dragState = null;
    await saveNotesPos({ left: Math.round(r.left), top: Math.round(r.top) });
  };

  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
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
          <span>notas do video</span>
        </div>
        <div class="actions">
          <button id="ytfn-save" title="salvar">salvar</button>
          <button id="ytfn-delnote" class="danger" title="excluir nota">excluir nota</button>
          <button id="ytfn-close" title="fechar">fechar</button>
        </div>
      </header>
      <div class="body">
        <div class="note-row">
          <div class="note-tabs" id="ytfn-tabs"></div>
          <button class="mini" id="ytfn-new" title="nova nota">+ nota</button>
        </div>
        <div class="row">
          <button class="mini" id="ytfn-add">+ timestamp</button>
          <div class="hint">arraste pelo topo • duplo clique na nota para renomear</div>
        </div>
        <div class="items" id="ytfn-items"></div>
        <textarea id="ytfn-text" placeholder="anote aqui" spellcheck="true"></textarea>
        <div class="footer">
          <button class="link" id="ytfn-delall" title="excluir tudo do video">excluir tudo</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(panel);
    panel.querySelector("header")?.addEventListener("mousedown", (e) => startDrag(panel, e));
    panel.querySelector("#ytfn-close")?.addEventListener("click", () => setSetting("notesOpen", false));
  }

  const pos = await loadNotesPos();
  if (pos && typeof pos.left === "number" && typeof pos.top === "number") {
    const r0 = panel.getBoundingClientRect();
    const left = clamp(pos.left, 8, window.innerWidth - r0.width - 8);
    const top = clamp(pos.top, 8, window.innerHeight - r0.height - 8);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  const videoId = parseVideoId();
  const videoTitle = (document.querySelector("h1 yt-formatted-string")?.textContent || "notas do video").trim();
  panel.querySelector("header .title span").textContent = videoTitle || "notas do video";

  const tabsEl = panel.querySelector("#ytfn-tabs");
  const textEl = panel.querySelector("#ytfn-text");
  const itemsEl = panel.querySelector("#ytfn-items");

  const newBtn = panel.querySelector("#ytfn-new");
  const addBtn = panel.querySelector("#ytfn-add");
  const saveBtn = panel.querySelector("#ytfn-save");
  const delNoteBtn = panel.querySelector("#ytfn-delnote");
  const delAllBtn = panel.querySelector("#ytfn-delall");

  let notesData = await loadNotes(videoId);

  const getActiveNote = () => notesData.notes.find(n => n.id === notesData.activeId) || notesData.notes[0];

  const persist = async () => {
    if (!videoId) return;
    await saveNotes(videoId, notesData);
  };

  const renderTabs = () => {
    tabsEl.innerHTML = "";

    notesData.notes.forEach((n) => {
      const chip = document.createElement("span");
      chip.className = "note-chip" + (n.id === notesData.activeId ? " active" : "");

      const btn = document.createElement("button");
      btn.textContent = n.title || "nota";
      btn.title = "selecionar nota";
      btn.addEventListener("click", async () => {
        notesData.activeId = n.id;
        await persist();
        renderAll();
      });

      btn.addEventListener("dblclick", async () => {
        const next = prompt("nome da nota", n.title || "nota");
        if (next === null) return;
        n.title = String(next).trim().slice(0, 42) || "nota";
        n.updatedAt = Date.now();
        await persist();
        renderTabs();
      });

      const del = document.createElement("button");
      del.textContent = "×";
      del.className = "del";
      del.title = "excluir nota";
      del.addEventListener("click", async () => {
        const ok = confirm("excluir esta nota");
        if (!ok) return;

        if (notesData.notes.length <= 1) {
          // keep at least 1 note
          const only = notesData.notes[0];
          only.text = "";
          only.items = [];
          only.updatedAt = Date.now();
          notesData.activeId = only.id;
        } else {
          const idx = notesData.notes.findIndex(x => x.id === n.id);
          notesData.notes.splice(idx, 1);
          if (!notesData.notes.some(x => x.id === notesData.activeId)) {
            notesData.activeId = notesData.notes[0]?.id || makeId("note");
          }
        }

        await persist();
        renderAll();
      });

      chip.appendChild(btn);
      chip.appendChild(del);
      tabsEl.appendChild(chip);
    });
  };

  const renderItems = (activeNote) => {
    itemsEl.innerHTML = "";

    (activeNote.items || []).forEach((it, idx) => {
      const chip = document.createElement("span");
      chip.className = "chip";

      const jump = document.createElement("button");
      jump.textContent = it.label;
      jump.title = "ir para este tempo";
      jump.addEventListener("click", () => {
        const v = getVideoEl();
        if (v) v.currentTime = it.t;
      });

      const del = document.createElement("button");
      del.textContent = "×";
      del.className = "del";
      del.title = "excluir timestamp";
      del.addEventListener("click", async () => {
        const note = getActiveNote();
        note.items.splice(idx, 1);
        note.updatedAt = Date.now();
        renderItems(note);
        await persist();
      });

      chip.appendChild(jump);
      chip.appendChild(del);
      itemsEl.appendChild(chip);
    });
  };

  const renderAll = () => {
    // safety
    if (!Array.isArray(notesData.notes) || notesData.notes.length === 0) notesData = makeEmptyNotesData();
    if (!notesData.activeId) notesData.activeId = notesData.notes[0].id;
    if (!notesData.notes.some(n => n.id === notesData.activeId)) notesData.activeId = notesData.notes[0].id;

    renderTabs();
    const active = getActiveNote();
    textEl.value = active.text || "";
    renderItems(active);

    const disabled = !videoId;
    newBtn.disabled = disabled;
    addBtn.disabled = disabled;
    saveBtn.disabled = disabled;
    delNoteBtn.disabled = disabled;
    delAllBtn.disabled = disabled;
  };

  // autosave with debounce (active note)
  let saveTimer = null;
  const scheduleAutoSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const n = getActiveNote();
      n.text = textEl.value;
      n.updatedAt = Date.now();
      await persist();
    }, 450);
  };

  textEl.oninput = scheduleAutoSave;

  newBtn.onclick = async () => {
    if (!videoId) return;
    const id = makeId("note");
    const idx = notesData.notes.length + 1;
    notesData.notes.unshift({
      id,
      title: `nota ${idx}`,
      text: "",
      items: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    notesData.activeId = id;
    await persist();
    renderAll();
  };

  addBtn.onclick = async () => {
    if (!videoId) return;
    const v = getVideoEl();
    if (!v) return;

    const t = Math.floor(v.currentTime || 0);
    const entry = { t, label: formatTime(t) };

    const n = getActiveNote();
    n.items = Array.isArray(n.items) ? n.items : [];
    n.items = [entry, ...n.items].slice(0, 30);
    n.updatedAt = Date.now();

    renderItems(n);
    await persist();
  };

  saveBtn.onclick = async () => {
    if (!videoId) return;
    const n = getActiveNote();
    n.text = textEl.value;
    n.updatedAt = Date.now();
    await persist();
  };

  delNoteBtn.onclick = async () => {
    if (!videoId) return;
    const n = getActiveNote();
    const ok = confirm("excluir esta nota");
    if (!ok) return;

    if (notesData.notes.length <= 1) {
      n.text = "";
      n.items = [];
      n.updatedAt = Date.now();
      await persist();
      renderAll();
      return;
    }

    notesData.notes = notesData.notes.filter(x => x.id !== n.id);
    notesData.activeId = notesData.notes[0]?.id || makeId("note");
    await persist();
    renderAll();
  };

  delAllBtn.onclick = async () => {
    if (!videoId) return;
    const ok = confirm("excluir todas as notas deste video");
    if (!ok) return;

    await deleteNotes(videoId);
    notesData = makeEmptyNotesData();
    renderAll();
  };

  renderAll();
}

function normalizeText(s, { ignoreCase = true, ignoreAccents = true } = {}) {
  let t = String(s ?? "");
  if (ignoreCase) t = t.toLowerCase();
  if (ignoreAccents) t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return t;
}

function getLoadedCommentThreads() {
  return Array.from(document.querySelectorAll("ytd-comment-thread-renderer"));
}

function getThreadCombinedText(thread) {
  const nodes = thread.querySelectorAll("#content-text");
  return Array.from(nodes).map(n => (n.textContent || "").trim()).join("\n");
}

function ensureCommentSearchStyle() {
  const css = `
    #${COMMENT_BAR_ID} {
      margin: 12px 0 14px 0;
      padding: 12px;
      border-radius: 14px;
      background: var(--yt-spec-raised-background, rgba(255,255,255,0.92));
      color: var(--yt-spec-text-primary, #0f0f0f);
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(0,0,0,0.10));
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    html[dark] #${COMMENT_BAR_ID} {
      border-color: var(--yt-spec-10-percent-layer, rgba(255,255,255,0.14));
      box-shadow: 0 2px 12px rgba(0,0,0,0.22);
    }

    #${COMMENT_BAR_ID} .ytfm-top {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    #${COMMENT_BAR_ID} .ytfm-input {
      flex: 1 1 320px;
      min-width: 220px;
      height: 34px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(0,0,0,0.14));
      background: var(--yt-spec-base-background, rgba(255,255,255,0.7));
      color: var(--yt-spec-text-primary, #0f0f0f);
      outline: none;
      font: 13px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    html[dark] #${COMMENT_BAR_ID} .ytfm-input {
      background: rgba(0,0,0,0.18);
      border-color: rgba(255,255,255,0.18);
      color: #fff;
    }
    #${COMMENT_BAR_ID} .ytfm-input:focus {
      border-color: var(--yt-spec-call-to-action, #065fd4);
      box-shadow: 0 0 0 3px rgba(6,95,212,0.18);
    }

    #${COMMENT_BAR_ID} .ytfm-btn {
      height: 34px;
      padding: 0 12px;
      border-radius: 999px;
      border: 1px solid var(--yt-spec-10-percent-layer, rgba(0,0,0,0.12));
      cursor: pointer;
      background: var(--yt-spec-badge-chip-background, rgba(0,0,0,0.06));
      color: var(--yt-spec-text-primary, #0f0f0f);
      font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }
    html[dark] #${COMMENT_BAR_ID} .ytfm-btn {
      background: rgba(255,255,255,0.10);
      border-color: rgba(255,255,255,0.14);
      color: #fff;
    }
    #${COMMENT_BAR_ID} .ytfm-btn-primary {
      background: var(--yt-spec-call-to-action, #065fd4);
      border-color: transparent;
      color: #fff;
    }

    #${COMMENT_BAR_ID} .ytfm-options {
      margin-top: 10px;
      display: flex;
      flex-wrap: wrap;
      gap: 14px;
      align-items: center;
    }

    #${COMMENT_BAR_ID} .ytfm-opt {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      user-select: none;
      font: 600 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      opacity: 0.9;
    }

    #${COMMENT_BAR_ID} input[type="checkbox"] {
      width: 14px;
      height: 14px;
      accent-color: var(--yt-spec-call-to-action, #065fd4);
      transform: translateY(1px);
    }

    #${COMMENT_BAR_ID} .ytfm-meta {
      margin-top: 8px;
      font: 12px/1.25 system-ui, -apple-system, Segoe UI, Roboto, Arial;
      opacity: 0.72;
    }

    ytd-comment-thread-renderer.ytfm-comment-match {
      scroll-margin-top: 96px;
      border-radius: 12px;
      background: rgba(34, 197, 94, 0.06);
      box-shadow: inset 4px 0 0 rgba(34, 197, 94, 0.95);
    }
    html[dark] ytd-comment-thread-renderer.ytfm-comment-match {
      background: rgba(34, 197, 94, 0.12);
    }
  `;

  upsertStyle(COMMENT_STYLE_ID, css);
}

async function loadMoreCommentsOnce() {
  const comments = document.querySelector("#comments");
  if (comments) comments.scrollIntoView({ behavior: "smooth", block: "start" });
  await new Promise(r => setTimeout(r, 500));
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  await new Promise(r => setTimeout(r, 900));
}

function clearCommentMatches() {
  for (const thread of getLoadedCommentThreads()) {
    thread.classList.remove("ytfm-comment-match");
    thread.style.display = "";
  }
}

function runCommentSearch({ query, filterMode, matchAllWords, ignoreAccents }) {
  const q = normalizeText(query, { ignoreCase: true, ignoreAccents });
  const words = q.split(/\s+/).map(s => s.trim()).filter(Boolean);

  const threads = getLoadedCommentThreads();
  let matches = 0;

  for (const thread of threads) {
    const text = normalizeText(getThreadCombinedText(thread), { ignoreCase: true, ignoreAccents });
    const ok = words.length === 0
      ? false
      : (matchAllWords ? words.every(w => text.includes(w)) : words.some(w => text.includes(w)));

    if (ok) {
      matches++;
      thread.classList.add("ytfm-comment-match");
      thread.style.display = "";
    } else {
      thread.classList.remove("ytfm-comment-match");
      thread.style.display = filterMode ? "none" : "";
    }
  }

  return { matches, total: threads.length };
}

function removeCommentSearchBar() {
  document.getElementById(COMMENT_BAR_ID)?.remove();
  document.getElementById(COMMENT_STYLE_ID)?.remove();
  clearCommentMatches();
}

async function ensureCommentSearchBar(settings) {
  if (!location.pathname.startsWith("/watch")) {
    removeCommentSearchBar();
    return;
  }

  if (settings.hideComments || !settings.commentSearch) {
    removeCommentSearchBar();
    return;
  }

  const commentsRoot = await waitFor("#comments", 6000);
  if (!commentsRoot) return;

  ensureCommentSearchStyle();

  let bar = document.getElementById(COMMENT_BAR_ID);
  if (!bar) {
    bar = document.createElement("div");
    bar.id = COMMENT_BAR_ID;
    bar.innerHTML = `
      <div class="ytfm-top">
        <input class="ytfm-input" id="ytfm-cq" type="text" placeholder="Pesquisar comentários… (ex: manda salve)" />
        <button class="ytfm-btn ytfm-btn-primary" id="ytfm-csearch" title="Pesquisar">Pesquisar</button>
        <button class="ytfm-btn" id="ytfm-cclear" title="Limpar">Limpar</button>
        <button class="ytfm-btn" id="ytfm-cload" title="Carregar mais comentários">Carregar mais</button>
      </div>
      <div class="ytfm-options">
        <label class="ytfm-opt"><input id="ytfm-cfilter" type="checkbox" /> Filtrar</label>
        <label class="ytfm-opt"><input id="ytfm-call" type="checkbox" /> Todas as palavras</label>
        <label class="ytfm-opt"><input id="ytfm-cacc" type="checkbox" checked /> Ignorar acentos</label>
      </div>
      <div class="ytfm-meta" id="ytfm-cmeta">Dica: role a página ou use “Carregar mais” para buscar em mais comentários carregados.</div>
    `;

    const header = document.querySelector("ytd-comments-header-renderer");
    if (header?.parentElement) {
      header.parentElement.insertBefore(bar, header.nextSibling);
    } else {
      commentsRoot.prepend(bar);
    }

    const q = bar.querySelector("#ytfm-cq");
    const btnSearch = bar.querySelector("#ytfm-csearch");
    const btnClear = bar.querySelector("#ytfm-cclear");
    const btnLoad = bar.querySelector("#ytfm-cload");
    const chkFilter = bar.querySelector("#ytfm-cfilter");
    const chkAll = bar.querySelector("#ytfm-call");
    const chkAcc = bar.querySelector("#ytfm-cacc");
    const meta = bar.querySelector("#ytfm-cmeta");

    const update = () => {
      const query = q.value;
      clearCommentMatches();
      if (!query.trim()) {
        meta.textContent = "Digite uma palavra/frase e clique em Pesquisar.";
        return;
      }
      const res = runCommentSearch({
        query,
        filterMode: chkFilter.checked,
        matchAllWords: chkAll.checked,
        ignoreAccents: chkAcc.checked
      });
      meta.textContent = `${res.matches} encontrado(s) • ${res.total} comentários carregados`;

      if (res.matches > 0) {
        const first = document.querySelector("ytd-comment-thread-renderer.ytfm-comment-match");
        first?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      }
    };

    btnSearch.addEventListener("click", update);
    q.addEventListener("keydown", (e) => {
      if (e.key === "Enter") update();
    });

    btnClear.addEventListener("click", () => {
      q.value = "";
      chkFilter.checked = false;
      chkAll.checked = false;
      clearCommentMatches();
      meta.textContent = "Digite uma palavra/frase e clique em Pesquisar.";
      q.focus();
    });

    btnLoad.addEventListener("click", async () => {
      meta.textContent = "Carregando mais comentários…";
      await loadMoreCommentsOnce();
      if (q.value.trim()) update();
      else meta.textContent = "Mais comentários carregados. Agora pesquise.";
    });

    chkFilter.addEventListener("change", () => q.value.trim() && update());
    chkAll.addEventListener("change", () => q.value.trim() && update());
    chkAcc.addEventListener("change", () => q.value.trim() && update());

    meta.textContent = "Digite uma palavra/frase e clique em Pesquisar.";
  }
}

function focusCommentSearch() {
  const q = document.querySelector(`#${COMMENT_BAR_ID} #ytfm-cq`);
  if (q) {
    q.focus();
    q.select?.();
    return true;
  }
  return false;
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
      case "KeyC":
        if (settings.commentSearch) {
          const ok = focusCommentSearch();
          if (ok) e.preventDefault();
        }
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

async function applyAll() {
  const settings = await getSettings();
  upsertStyle(STYLE_ID, buildCss(settings));

  setupKeyboard(settings);
  ensureNotesPanel(settings);
  ensureCommentSearchBar(settings);

  ensureTheater(settings);
  setupSpeedMemory(settings);
}

applyAll();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  applyAll();
});

new MutationObserver(() => {
  if (location.href !== currentUrl) {
    currentUrl = location.href;
    applyAll();
  }
}).observe(document, { subtree: true, childList: true });
