const DEFAULTS = {
  enabled: true,
  hideShorts: true,
  hideHomeFeed: false,
  hideRelated: true,
  hideComments: true,
  hideSidebar: false
};

const ids = Object.keys(DEFAULTS);

function $(id){ return document.getElementById(id); }

async function load(){
  const data = await chrome.storage.sync.get(DEFAULTS);
  for (const id of ids) $(id).checked = !!data[id];
}

async function save(id, value){
  await chrome.storage.sync.set({ [id]: value });
}

document.addEventListener('DOMContentLoaded', async () => {
  await load();

  for (const id of ids) {
    $(id).addEventListener('change', (e) => save(id, e.target.checked));
  }
});
