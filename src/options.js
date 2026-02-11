const DEFAULTS = {
  enabled: true,
  hideShorts: true,
  hideHomeFeed: false,
  hideRelated: true,
  hideComments: true,
  hideSidebar: false,

  autoTheater: false,
  rememberSpeedByChannel: true,
  defaultSpeed: 1.25,
  keyboardShortcuts: true,
  notesOpen: false
};

const checkIds = [
  "enabled",
  "hideShorts",
  "hideRelated",
  "hideComments",
  "hideSidebar",
  "hideHomeFeed",
  "autoTheater",
  "rememberSpeedByChannel",
  "keyboardShortcuts",
  "notesOpen"
];

const $ = (id) => document.getElementById(id);

async function load(){
  const data = await chrome.storage.sync.get(DEFAULTS);
  for (const id of checkIds) $(id).checked = !!data[id];
  $("defaultSpeed").value = Number(data.defaultSpeed ?? DEFAULTS.defaultSpeed);
}

async function save(id, value){
  await chrome.storage.sync.set({ [id]: value });
}

document.addEventListener('DOMContentLoaded', async () => {
  await load();

  for (const id of checkIds) {
    $(id).addEventListener('change', (e) => save(id, e.target.checked));
  }

  $("defaultSpeed").addEventListener("change", (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v)) return;
    save("defaultSpeed", v);
  });
});
