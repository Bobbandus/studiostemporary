/* ==========================================================================
   A+ VAULT — prototype video library
   Reads videos/manifest.json (static, git-committed) and renders either
   the browse page (vault.html) or the watch page (vault-watch.html).
   No backend, no accounts — progress is tracked client-side in localStorage.
   ========================================================================== */

const VAULT_PROGRESS_KEY = "aplusVaultProgress";

async function loadManifest(){
  try{
    const res = await fetch("/videos/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("manifest fetch failed: " + res.status);
    const data = await res.json();
    return {
      categories: Array.isArray(data.categories) ? data.categories : [],
      titles: Array.isArray(data.titles) ? data.titles : []
    };
  } catch(err){
    console.warn("A+ Vault: could not load manifest.json", err);
    return { categories: [], titles: [] };
  }
}

function formatDuration(seconds){
  if (!seconds && seconds !== 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + " min" + (s ? " " + s + " s" : "");
}

function readProgress(){
  try{
    return JSON.parse(localStorage.getItem(VAULT_PROGRESS_KEY) || "{}");
  } catch(e){ return {}; }
}

function writeProgress(map){
  try{ localStorage.setItem(VAULT_PROGRESS_KEY, JSON.stringify(map)); } catch(e){}
}

function progressKey(slug, episode){
  return episode ? slug + ":" + episode : slug;
}

/* ==========================================================================
   BROWSE PAGE (vault.html)
   ========================================================================== */

function watchHref(entry, episode){
  const base = "/vault/" + entry.slug;
  return episode ? base + "?ep=" + episode.episode : base;
}

function buildCard(entry, opts){
  opts = opts || {};
  const a = document.createElement("a");
  a.className = "vault-card";
  a.href = opts.episode ? watchHref(entry, opts.episode) : watchHref(entry, entry.type === "series" ? entry.episodes[0] : null);
  a.dataset.title = entry.title.toLowerCase();

  const poster = document.createElement("div");
  poster.className = "vault-card-poster";
  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = entry.title;
  img.src = (opts.episode && opts.episode.poster) || entry.poster || "";
  poster.appendChild(img);

  if (opts.progressRatio){
    const bar = document.createElement("div");
    bar.className = "vault-card-progress";
    const fill = document.createElement("span");
    fill.style.width = Math.round(opts.progressRatio * 100) + "%";
    bar.appendChild(fill);
    poster.appendChild(bar);
  }

  const body = document.createElement("div");
  body.className = "vault-card-body";
  const title = document.createElement("p");
  title.className = "vault-card-title";
  title.textContent = opts.episode ? entry.title + " · " + opts.episode.title : entry.title;
  const meta = document.createElement("p");
  meta.className = "vault-card-meta";
  meta.textContent = entry.type === "series" ? "Serie" : "Film";
  body.appendChild(title);
  body.appendChild(meta);

  a.appendChild(poster);
  a.appendChild(body);
  return a;
}

function renderHero(manifest){
  const hero = document.getElementById("vaultHero");
  if (!hero) return;
  const entry = manifest.titles.find(t => t.featured) || manifest.titles[0];
  if (!entry) return;

  document.getElementById("vaultHeroKicker").textContent = entry.type === "series" ? "Serie" : "Film";
  document.getElementById("vaultHeroTitle").textContent = entry.title;
  document.getElementById("vaultHeroDesc").textContent = entry.synopsis || "";
  const meta = [entry.year, entry.type === "series" ? (entry.episodes.length + " avsnitt") : formatDuration(entry.duration)]
    .filter(Boolean).join(" · ");
  document.getElementById("vaultHeroMeta").textContent = meta;

  const bg = document.getElementById("vaultHeroBg");
  if (bg && entry.poster) bg.style.backgroundImage = "url('" + entry.poster + "')";

  const playBtn = document.getElementById("vaultHeroPlay");
  if (playBtn) playBtn.href = watchHref(entry, entry.type === "series" ? entry.episodes[0] : null);

  hero.hidden = false;
}

function renderContinueWatching(manifest){
  const row = document.getElementById("vaultContinueRow");
  const track = document.getElementById("vaultContinueTrack");
  if (!row || !track) return;

  const progress = readProgress();
  const cards = [];

  manifest.titles.forEach(entry => {
    if (entry.type === "series"){
      entry.episodes.forEach(ep => {
        const p = progress[progressKey(entry.slug, ep.episode)];
        if (p && p.position > 5 && p.duration && p.position < p.duration * 0.95){
          cards.push(buildCard(entry, { episode: ep, progressRatio: p.position / p.duration }));
        }
      });
    } else {
      const p = progress[progressKey(entry.slug)];
      if (p && p.position > 5 && p.duration && p.position < p.duration * 0.95){
        cards.push(buildCard(entry, { progressRatio: p.position / p.duration }));
      }
    }
  });

  if (!cards.length){ row.hidden = true; return; }
  track.innerHTML = "";
  cards.forEach(c => track.appendChild(c));
  row.hidden = false;
}

function renderTitleGrid(manifest){
  const section = document.getElementById("vaultCategories");
  if (!section) return;
  section.innerHTML = "";
  if (!manifest.titles.length) return;

  const row = document.createElement("div");
  row.className = "vault-row";

  const heading = document.createElement("p");
  heading.className = "vault-row-heading";
  heading.textContent = "Filmer";

  const track = document.createElement("div");
  track.className = "vault-row-track";
  manifest.titles.forEach(entry => track.appendChild(buildCard(entry)));

  row.appendChild(heading);
  row.appendChild(track);
  section.appendChild(row);
}

function initSearch(){
  const input = document.getElementById("vaultSearch");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll(".vault-card").forEach(card => {
      card.style.display = !q || card.dataset.title.includes(q) ? "" : "none";
    });
  });
}

function showEmptyState(){
  const empty = document.getElementById("vaultEmpty");
  if (empty) empty.hidden = false;
  ["vaultHero", "vaultContinueRow", "vaultSearchSection", "vaultCategories"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  });
}

async function initVaultPage(){
  const manifest = await loadManifest();
  if (!manifest.titles.length){
    showEmptyState();
    return;
  }
  renderHero(manifest);
  renderContinueWatching(manifest);
  renderTitleGrid(manifest);
  initSearch();
}

/* ==========================================================================
   WATCH PAGE (vault-watch.html)
   ========================================================================== */

function getQueryParams(){
  return new URLSearchParams(window.location.search);
}

/* Vercel rewrites /vault/<slug> to vault-watch.html?slug=<slug> on the
   server side only — the browser's own address bar (and therefore
   location.search) still just shows /vault/<slug>, so the slug has to be
   read from the path. Falls back to ?slug= for direct/local access. */
function getSlugFromPath(){
  const m = window.location.pathname.match(/\/vault\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function findEntryBySlug(manifest, slug){
  return manifest.titles.find(t => t.slug === slug) || null;
}

function resolveEpisode(entry, epNumber){
  if (entry.type !== "series") return null;
  const num = Number(epNumber);
  return entry.episodes.find(ep => ep.episode === num) || entry.episodes[0];
}

function attachProgressTracking(videoEl, key){
  const progress = readProgress();
  const saved = progress[key];

  videoEl.addEventListener("loadedmetadata", () => {
    if (saved && saved.position && saved.position < videoEl.duration * 0.95){
      videoEl.currentTime = saved.position;
    }
  });

  let lastSave = 0;
  videoEl.addEventListener("timeupdate", () => {
    const now = Date.now();
    if (now - lastSave < 4000) return;
    lastSave = now;
    const map = readProgress();
    map[key] = { position: videoEl.currentTime, duration: videoEl.duration, updatedAt: now };
    writeProgress(map);
  });

  videoEl.addEventListener("ended", () => {
    const map = readProgress();
    delete map[key];
    writeProgress(map);
  });
}

function renderWatchPage(manifest, entry, episode){
  const video = document.getElementById("vaultPlayer");
  const titleEl = document.getElementById("watchTitle");
  const synopsisEl = document.getElementById("watchSynopsis");

  const videoSrc = episode ? episode.video : entry.video;
  const displayTitle = episode ? entry.title + " · " + episode.title : entry.title;
  const key = progressKey(entry.slug, episode ? episode.episode : null);

  video.src = videoSrc;
  titleEl.textContent = displayTitle;
  synopsisEl.textContent = (episode && episode.synopsis) || entry.synopsis || "";
  attachProgressTracking(video, key);

  const list = document.getElementById("watchEpisodes");
  const items = document.getElementById("watchEpisodeItems");
  if (entry.type === "series" && list && items){
    items.innerHTML = "";
    entry.episodes.forEach(ep => {
      const li = document.createElement("li");
      li.className = "vault-episode-item" + (episode && ep.episode === episode.episode ? " active" : "");
      li.innerHTML =
        '<span class="vault-episode-num">' + String(ep.episode).padStart(2, "0") + '</span>' +
        '<span class="vault-episode-title">' + ep.title + '</span>' +
        '<span class="vault-episode-duration">' + formatDuration(ep.duration) + '</span>';
      li.addEventListener("click", () => {
        history.replaceState(null, "", "/vault/" + entry.slug + "?ep=" + ep.episode);
        renderWatchPage(manifest, entry, ep);
      });
      items.appendChild(li);
    });
    list.hidden = false;
  } else if (list){
    list.hidden = true;
  }
}

async function initWatchPage(){
  const manifest = await loadManifest();
  const params = getQueryParams();
  const slug = getSlugFromPath() || params.get("slug");
  const entry = findEntryBySlug(manifest, slug);
  const titleEl = document.getElementById("watchTitle");

  if (!entry){
    if (titleEl) titleEl.textContent = "Videon kunde inte hittas.";
    return;
  }
  const episode = entry.type === "series" ? resolveEpisode(entry, params.get("ep")) : null;
  renderWatchPage(manifest, entry, episode);
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("vaultHero")) initVaultPage();
  if (document.getElementById("vaultPlayer")) initWatchPage();
});
