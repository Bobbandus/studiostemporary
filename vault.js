/* ==========================================================================
   A+ VAULT — streaming-style video library
   Reads videos/manifest.json (static, git-committed). This file holds the
   shared helpers plus the browse page (vault.html); the player on the watch
   page (vault-watch.html) lives in vault-player.js and reuses the helpers.
   No backend, no accounts — progress and "Min lista" live in localStorage.
   ========================================================================== */

const VAULT_PROGRESS_KEY = "aplusVaultProgress";
const VAULT_LIST_KEY = "aplusVaultList";
const VAULT_DONE_RATIO = 0.95;  // past this point a video counts as watched
const VAULT_MIN_RESUME = 5;     // seconds; anything shorter isn't worth resuming

/* ==========================================================================
   SHARED — manifest, formatting, progress, Min lista, DOM helpers
   ========================================================================== */

async function loadManifest(){
  try{
    const res = await fetch("/videos/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error("manifest fetch failed: " + res.status);
    const data = await res.json();
    const titles = (Array.isArray(data.titles) ? data.titles : [])
      .filter(t => t && t.slug && t.title)
      .map(t => {
        t.genres = Array.isArray(t.genres) ? t.genres : [];
        if (t.type === "series"){
          t.episodes = (Array.isArray(t.episodes) ? t.episodes : [])
            .slice().sort((a, b) => a.episode - b.episode);
        }
        return t;
      })
      .filter(t => t.type !== "series" || t.episodes.length);
    return { titles };
  } catch(err){
    console.warn("A+ Vault: could not load manifest.json", err);
    return { titles: [] };
  }
}

function formatDuration(seconds){
  if (!seconds) return "";
  const total = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(total / 60), m = total % 60;
  return h ? h + " tim" + (m ? " " + m + " min" : "") : m + " min";
}

function formatClock(seconds){
  seconds = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
  const pad = n => String(n).padStart(2, "0");
  return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
}

function typeLabel(entry){ return entry.type === "series" ? "Serie" : "Film"; }
function episodeLabel(ep){ return "Avs. " + ep.episode; }

function runtimeLabel(entry){
  if (entry.type === "series") return entry.episodes.length + " avsnitt";
  return formatDuration(entry.duration);
}

function metaLine(entry){
  return [entry.year, runtimeLabel(entry)].filter(Boolean).join(" · ");
}

function findEntryBySlug(manifest, slug){
  return manifest.titles.find(t => t.slug === slug) || null;
}

/* ---------- progress ---------- */

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

function isWatched(rec){
  return !!rec && (rec.completed || (rec.duration > 0 && rec.position >= rec.duration * VAULT_DONE_RATIO));
}

function isResumable(rec){
  return !!rec && !isWatched(rec) && rec.duration > 0 && rec.position > VAULT_MIN_RESUME;
}

function progressRatio(rec){
  if (!rec || !rec.duration) return 0;
  return isWatched(rec) ? 1 : Math.min(1, rec.position / rec.duration);
}

function remainingLabel(rec){
  return Math.max(1, Math.round((rec.duration - rec.position) / 60)) + " min kvar";
}

/* Where "Spela upp" should take you for a title: the movie or episode in
   progress, or — once an episode is finished — the next one ("up next"). */
function resumeTarget(entry, progress){
  progress = progress || readProgress();
  if (entry.type !== "series"){
    const rec = progress[progressKey(entry.slug)];
    return {
      episode: null,
      record: isResumable(rec) ? rec : null,
      upNext: false,
      updatedAt: rec ? rec.updatedAt || 0 : 0
    };
  }

  let latest = null, latestEp = null;
  entry.episodes.forEach(ep => {
    const rec = progress[progressKey(entry.slug, ep.episode)];
    if (rec && (!latest || (rec.updatedAt || 0) > (latest.updatedAt || 0))){
      latest = rec; latestEp = ep;
    }
  });

  const base = { episode: entry.episodes[0], record: null, upNext: false, updatedAt: latest ? latest.updatedAt || 0 : 0 };
  if (!latest) return base;
  if (isResumable(latest)) return Object.assign(base, { episode: latestEp, record: latest });
  if (isWatched(latest)){
    const next = entry.episodes[entry.episodes.indexOf(latestEp) + 1];
    return next ? Object.assign(base, { episode: next, upNext: true }) : base;
  }
  return Object.assign(base, { episode: latestEp });
}

function clearProgress(entry){
  const map = readProgress();
  Object.keys(map).forEach(k => {
    if (k === entry.slug || k.startsWith(entry.slug + ":")) delete map[k];
  });
  writeProgress(map);
}

/* ---------- Min lista ---------- */

function readList(){
  try{
    const list = JSON.parse(localStorage.getItem(VAULT_LIST_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch(e){ return []; }
}

function inList(slug){ return readList().includes(slug); }

function toggleList(slug){
  const list = readList();
  const i = list.indexOf(slug);
  if (i >= 0) list.splice(i, 1); else list.unshift(slug);
  try{ localStorage.setItem(VAULT_LIST_KEY, JSON.stringify(list)); } catch(e){}
  return i < 0;
}

/* ---------- URLs ---------- */

function watchHref(entry, episode, opts){
  const params = new URLSearchParams();
  if (episode) params.set("ep", episode.episode);
  if (opts && opts.restart) params.set("t", "0");
  const qs = params.toString();
  return "/vault/" + encodeURIComponent(entry.slug) + (qs ? "?" + qs : "");
}

function detailHref(entry){
  return "/vault?titel=" + encodeURIComponent(entry.slug);
}

/* ---------- DOM ---------- */

const ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M7 4.5v15l12.5-7.5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9.5 6 6 6-6"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5 7 7-7 7"/></svg>'
};

function $(id){ return document.getElementById(id); }

function el(tag, props, children){
  const node = document.createElement(tag);
  if (props) Object.keys(props).forEach(k => {
    const v = props[k];
    if (v == null || v === false) return;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;  // static icon markup only
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  });
  (children || []).forEach(c => { if (c != null) node.append(c); });
  return node;
}

function cssUrl(src){ return src ? "url('" + String(src).replace(/'/g, "%27") + "')" : ""; }

function progressBar(ratio){
  return el("span", { class: "vault-progress-bar" }, [
    el("span", { style: "width:" + Math.round(ratio * 100) + "%" })
  ]);
}

function isPlainClick(e){
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/* ==========================================================================
   BROWSE PAGE (vault.html)
   ========================================================================== */

const VAULT_VIEWS = { serier: "Serier", filmer: "Filmer", "min-lista": "Min lista" };

const vault = {
  manifest: null,
  view: "hem",
  query: "",
  heroEntry: null,
  heroView: null,
  modalSlug: null,
  modalPushed: false,
  lastFocus: null,
  previewTimer: 0,
  rowsDirty: false,
  rowSyncs: [],
  routed: false,
  trailerTimer: 0
};

const canHoverPreview = window.matchMedia("(hover: hover) and (pointer: fine)");

/* ---------- play button state ---------- */

function playInfo(entry, withEpisode){
  const target = resumeTarget(entry);
  const ep = target.episode;
  let label = "Spela upp";
  if (target.record) label = "Fortsätt" + (withEpisode && ep ? " " + episodeLabel(ep) : "");
  else if (target.upNext) label = "Spela " + episodeLabel(ep);
  return { href: watchHref(entry, ep), label: label, target: target };
}

/* ---------- cards ---------- */

function bindDetailClick(node, entry){
  node.addEventListener("click", e => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    openModal(entry);
  });
}

function buildCard(entry){
  const art = el("div", { class: "vault-card-art" }, [
    el("img", { src: entry.poster || entry.backdrop || "", alt: "", loading: "lazy", decoding: "async" }),
    el("span", { class: "vault-card-title", text: entry.title })
  ]);
  if (entry.type === "series") art.append(el("span", { class: "vault-card-tag", text: "Serie" }));

  const card = el("a", {
    class: "vault-card",
    href: detailHref(entry),
    "data-slug": entry.slug,
    "aria-label": entry.title + " (" + typeLabel(entry).toLowerCase() + ")"
  }, [art]);
  bindDetailClick(card, entry);
  attachPreviewHover(card, entry);
  return card;
}

function buildContinueCard(entry, target){
  const ep = target.episode;
  const sub = ep
    ? (target.upNext ? "Nästa: " : "") + episodeLabel(ep) + " · " + ep.title
    : remainingLabel(target.record);

  const link = el("a", {
    class: "vault-card-art",
    href: watchHref(entry, ep),
    "aria-label": "Fortsätt titta på " + entry.title + (ep ? ", " + episodeLabel(ep) : "")
  }, [
    el("img", { src: (ep && ep.poster) || entry.poster || "", alt: "", loading: "lazy", decoding: "async" }),
    el("span", { class: "vault-card-playicon", html: ICONS.play }),
    progressBar(target.record ? progressRatio(target.record) : 0)
  ]);

  const info = el("button", { type: "button", class: "vault-mini-btn", "aria-label": "Mer info om " + entry.title, title: "Mer info", html: ICONS.info });
  info.addEventListener("click", () => openModal(entry));

  const remove = el("button", { type: "button", class: "vault-mini-btn", "aria-label": "Ta bort " + entry.title + " från Fortsätt titta", title: "Ta bort från raden", html: ICONS.close });
  remove.addEventListener("click", () => {
    clearProgress(entry);
    renderView();
  });

  return el("div", { class: "vault-card vault-card--continue", "data-slug": entry.slug }, [
    link,
    el("div", { class: "vault-card-caption" }, [
      el("div", { class: "vault-card-caption-text" }, [
        el("span", { class: "vault-card-caption-title", text: entry.title }),
        el("span", { class: "vault-card-caption-sub", text: sub })
      ]),
      info,
      remove
    ])
  ]);
}

function buildTopCard(entry, rank){
  const card = el("a", {
    class: "vault-top-card",
    href: detailHref(entry),
    "data-slug": entry.slug,
    "aria-label": "Nummer " + rank + ": " + entry.title
  }, [
    el("span", { class: "vault-top-num", text: String(rank), "aria-hidden": "true" }),
    el("div", { class: "vault-top-art" }, [
      el("img", { src: entry.portrait || entry.poster || "", alt: "", loading: "lazy", decoding: "async" }),
      el("span", { class: "vault-card-title", text: entry.title })
    ])
  ]);
  bindDetailClick(card, entry);
  attachPreviewHover(card, entry);
  return card;
}

function listButton(entry, extraClass){
  const btn = el("button", { type: "button", class: "vault-round-btn" + (extraClass ? " " + extraClass : "") });
  const sync = () => {
    const on = inList(entry.slug);
    btn.innerHTML = on ? ICONS.check : ICONS.plus;
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Ta bort " + entry.title + " från Min lista" : "Lägg till " + entry.title + " i Min lista");
    btn.title = on ? "Ta bort från Min lista" : "Lägg till i Min lista";
  };
  btn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    toggleList(entry.slug);
    sync();
    onListChanged();
  });
  sync();
  return btn;
}

function onListChanged(){
  if (!$("vaultPreview").hidden) vault.rowsDirty = true;
  else renderView();
}

/* ---------- rows ---------- */

function buildHomeRows(manifest){
  const titles = manifest.titles;
  const rows = [];
  const progress = readProgress();

  const continuing = titles
    .map(entry => ({ entry: entry, target: resumeTarget(entry, progress) }))
    .filter(x => x.target.record || x.target.upNext)
    .sort((a, b) => b.target.updatedAt - a.target.updatedAt);
  if (continuing.length) rows.push({ title: "Fortsätt titta", kind: "continue", items: continuing });

  const list = readList().map(slug => findEntryBySlug(manifest, slug)).filter(Boolean);
  if (list.length) rows.push({ title: "Min lista", items: list });

  const top = titles.filter(t => t.top).sort((a, b) => a.top - b.top).slice(0, 10);
  if (top.length >= 3) rows.push({ title: "Topp " + top.length + " i valvet", kind: "top", items: top });

  const newest = titles.slice().sort((a, b) => (b.year || 0) - (a.year || 0));
  rows.push({ title: "Nytt i valvet", items: newest });

  const series = titles.filter(t => t.type === "series");
  const movies = titles.filter(t => t.type !== "series");
  if (series.length >= 2) rows.push({ title: "Serier", items: series });
  if (movies.length >= 2) rows.push({ title: "Filmer", items: movies });

  // a genre row earns its place once it groups some, but not all, titles
  const genres = [];
  titles.forEach(t => t.genres.forEach(g => { if (!genres.includes(g)) genres.push(g); }));
  genres.forEach(g => {
    const items = titles.filter(t => t.genres.includes(g));
    if (items.length >= 2 && items.length < titles.length) rows.push({ title: g, items: items });
  });

  return rows;
}

function buildRow(row){
  const track = el("div", { class: "vault-row-track" });
  row.items.forEach((item, i) => {
    if (row.kind === "continue") track.append(buildContinueCard(item.entry, item.target));
    else if (row.kind === "top") track.append(buildTopCard(item, i + 1));
    else track.append(buildCard(item));
  });

  const prev = el("button", { type: "button", class: "vault-row-arrow vault-row-arrow--prev", "aria-label": "Bläddra bakåt", tabindex: "-1", html: ICONS.left, hidden: true });
  const next = el("button", { type: "button", class: "vault-row-arrow vault-row-arrow--next", "aria-label": "Bläddra framåt", tabindex: "-1", html: ICONS.right, hidden: true });
  const page = dir => track.scrollBy({ left: dir * track.clientWidth * 0.9, behavior: "smooth" });
  prev.addEventListener("click", () => page(-1));
  next.addEventListener("click", () => page(1));

  const sync = () => {
    const max = track.scrollWidth - track.clientWidth - 2;
    prev.hidden = track.scrollLeft <= 2;
    next.hidden = track.scrollLeft >= max;
  };
  track.addEventListener("scroll", () => { hidePreview(); sync(); }, { passive: true });
  vault.rowSyncs.push(sync);

  return el("section", { class: "vault-row" + (row.kind ? " vault-row--" + row.kind : "") }, [
    el("h2", { class: "vault-row-heading", text: row.title }),
    el("div", { class: "vault-row-viewport" }, [prev, track, next])
  ]);
}

function renderRows(){
  const wrap = $("vaultRows");
  wrap.innerHTML = "";
  vault.rowSyncs = [];
  buildHomeRows(vault.manifest).forEach(row => wrap.append(buildRow(row)));
  requestAnimationFrame(() => vault.rowSyncs.forEach(fn => fn()));
}

function renderGrid(heading, items, emptyText){
  $("vaultGridHeading").textContent = heading;
  const grid = $("vaultGrid");
  grid.innerHTML = "";
  items.forEach(entry => grid.append(buildCard(entry)));
  const empty = $("vaultGridEmpty");
  empty.textContent = emptyText || "";
  empty.hidden = items.length > 0;
}

/* ---------- hero ---------- */

function pickHero(pool){
  const featured = pool.filter(t => t.featured);
  const candidates = featured.length ? featured : pool.slice(0, 1);
  return candidates[Math.floor(Math.random() * candidates.length)] || null;
}

function renderHero(pool){
  const hero = $("vaultHero");
  if (vault.heroView !== vault.view || !vault.heroEntry){
    vault.heroView = vault.view;
    vault.heroEntry = pickHero(pool);
    const entry = vault.heroEntry;
    if (!entry){ hero.hidden = true; stopHeroTrailer(); return; }

    $("vaultHeroKicker").textContent = typeLabel(entry);
    $("vaultHeroTitle").textContent = entry.title;
    $("vaultHeroMeta").textContent = [entry.year, runtimeLabel(entry)].concat(entry.genres).filter(Boolean).join(" · ");
    $("vaultHeroDesc").textContent = entry.synopsis || "";
    $("vaultHeroBg").style.backgroundImage = cssUrl(entry.backdrop || entry.poster);
    startHeroTrailer(entry);
  }
  if (!vault.heroEntry) return;
  const info = playInfo(vault.heroEntry, false);
  $("vaultHeroPlay").href = info.href;
  $("vaultHeroPlayLabel").textContent = info.label;
  hero.hidden = false;
}

function startHeroTrailer(entry){
  const video = $("vaultHeroTrailer");
  stopHeroTrailer();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const saveData = navigator.connection && navigator.connection.saveData;
  if (!entry.trailer || reduceMotion || saveData) return;
  vault.trailerTimer = setTimeout(() => {
    video.src = entry.trailer;
    video.muted = true;
    video.play().catch(() => {});
  }, 2500);
}

function stopHeroTrailer(){
  const video = $("vaultHeroTrailer");
  clearTimeout(vault.trailerTimer);
  $("vaultHero").classList.remove("is-trailer");
  $("vaultHeroMute").hidden = true;
  if (video.getAttribute("src")){
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
}

function setHeroTrailerPaused(paused){
  const video = $("vaultHeroTrailer");
  if (!$("vaultHero").classList.contains("is-trailer")) return;
  if (paused) video.pause();
  else if (!vault.modalSlug && !document.hidden) video.play().catch(() => {});
}

function initHeroTrailer(){
  const hero = $("vaultHero");
  const video = $("vaultHeroTrailer");
  const mute = $("vaultHeroMute");

  video.addEventListener("playing", () => {
    hero.classList.add("is-trailer");
    mute.hidden = false;
  });
  video.addEventListener("ended", () => {
    hero.classList.remove("is-trailer");
    mute.hidden = true;
  });
  mute.addEventListener("click", () => {
    video.muted = !video.muted;
    mute.classList.toggle("is-unmuted", !video.muted);
    mute.setAttribute("aria-label", video.muted ? "Slå på ljud" : "Stäng av ljud");
  });
  document.addEventListener("visibilitychange", () => setHeroTrailerPaused(document.hidden));
  if ("IntersectionObserver" in window){
    new IntersectionObserver(entries => {
      setHeroTrailerPaused(!entries[0].isIntersecting);
    }, { threshold: 0.4 }).observe(hero);
  }
  $("vaultHeroInfo").addEventListener("click", () => {
    if (vault.heroEntry) openModal(vault.heroEntry);
  });
}

/* ---------- views ---------- */

function normalizeText(s){
  return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function searchTitles(titles, query){
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  return titles
    .map(t => {
      const hay = normalizeText([
        t.title, t.synopsis, t.year, typeLabel(t), t.genres.join(" "),
        (t.cast || []).join(" "),
        t.type === "series" ? t.episodes.map(ep => ep.title).join(" ") : ""
      ].join(" "));
      const titleHit = terms.every(term => normalizeText(t.title).includes(term));
      return { t: t, hit: terms.every(term => hay.includes(term)), titleHit: titleHit };
    })
    .filter(x => x.hit)
    .sort((a, b) => b.titleHit - a.titleHit)
    .map(x => x.t);
}

function renderView(){
  const manifest = vault.manifest;
  if (!manifest) return;
  hidePreview();
  vault.rowsDirty = false;

  document.querySelectorAll(".vault-nav-links a").forEach(a => {
    const active = !vault.query && a.dataset.view === vault.view;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });

  const hero = $("vaultHero"), rows = $("vaultRows"), grid = $("vaultGridView");
  const showGrid = (heading, items, emptyText) => {
    rows.hidden = true;
    grid.hidden = false;
    renderGrid(heading, items, emptyText);
  };

  if (vault.query){
    hero.hidden = true;
    stopHeroTrailer();
    vault.heroView = null;
    showGrid("Resultat för ”" + vault.query + "”", searchTitles(manifest.titles, vault.query),
      "Inga träffar på ”" + vault.query + "”. Prova en titel, en genre eller ett årtal.");
    document.title = "Sök | A+ Vault";
  } else if (vault.view === "min-lista"){
    hero.hidden = true;
    stopHeroTrailer();
    vault.heroView = null;
    const items = readList().map(slug => findEntryBySlug(manifest, slug)).filter(Boolean);
    showGrid("Min lista", items, "Du har inte sparat något än. Tryck på + på en titel så hamnar den här.");
    document.title = "Min lista | A+ Vault";
  } else {
    const type = vault.view === "serier" ? "series" : vault.view === "filmer" ? "movie" : null;
    const pool = type ? manifest.titles.filter(t => (t.type === "series") === (type === "series")) : manifest.titles;
    renderHero(pool);
    if (type){
      showGrid(VAULT_VIEWS[vault.view], pool, type === "series" ? "Inga serier i valvet än." : "Inga filmer i valvet än.");
      document.title = VAULT_VIEWS[vault.view] + " | A+ Vault";
    } else {
      grid.hidden = true;
      rows.hidden = false;
      renderRows();
      document.title = "A+ Vault | A+ Studios";
    }
  }
  document.body.classList.toggle("vault-has-hero", !hero.hidden);
}

/* ---------- routing: /vault?visa=…&sok=…&titel=… ---------- */

function currentParams(){
  const p = new URLSearchParams();
  if (vault.view !== "hem") p.set("visa", vault.view);
  if (vault.query) p.set("sok", vault.query);
  if (vault.modalSlug) p.set("titel", vault.modalSlug);
  return p;
}

function urlForState(){
  const qs = currentParams().toString();
  return location.pathname + (qs ? "?" + qs : "");
}

function applyRoute(){
  const p = new URLSearchParams(location.search);
  const view = VAULT_VIEWS[p.get("visa")] ? p.get("visa") : "hem";
  const query = (p.get("sok") || "").trim();
  if (view !== vault.view || query !== vault.query || !vault.routed){
    vault.routed = true;
    vault.view = view;
    vault.query = query;
    syncSearchInput();
    renderView();
  }
  const entry = p.get("titel") && findEntryBySlug(vault.manifest, p.get("titel"));
  if (entry) openModal(entry, { fromRoute: true });
  else if (vault.modalSlug) hideModal();
}

function initNav(){
  const nav = $("vaultNav");
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 10);
  window.addEventListener("scroll", () => { onScroll(); hidePreview(); }, { passive: true });
  onScroll();

  document.querySelectorAll(".vault-nav-links a").forEach(a => {
    a.addEventListener("click", e => {
      if (!isPlainClick(e)) return;
      e.preventDefault();
      vault.view = a.dataset.view;
      vault.query = "";
      syncSearchInput();
      history.pushState(null, "", urlForState());
      renderView();
      window.scrollTo(0, 0);
    });
  });
}

/* ---------- search ---------- */

function syncSearchInput(){
  const input = $("vaultSearch");
  if (document.activeElement !== input) input.value = vault.query;
  if (vault.query) openSearchBox(false);
}

function openSearchBox(focus){
  const input = $("vaultSearch");
  $("vaultSearchBox").classList.add("is-open");
  input.tabIndex = 0;
  if (focus) input.focus();
}

function initSearch(){
  const box = $("vaultSearchBox");
  const input = $("vaultSearch");
  let timer = 0;

  $("vaultSearchToggle").addEventListener("click", () => openSearchBox(true));
  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (input.value || document.activeElement === input) return;
      box.classList.remove("is-open");
      input.tabIndex = -1;
    }, 150);
  });
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => setQuery(input.value), 160);
  });
  input.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    input.value = "";
    setQuery("");
    input.blur();
  });
  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === "/" && !typing && !vault.modalSlug){
      e.preventDefault();
      openSearchBox(true);
    }
  });
}

function setQuery(raw){
  const query = raw.trim();
  if (query === vault.query) return;
  const starting = !vault.query && query;
  vault.query = query;
  history.replaceState(history.state, "", urlForState());
  renderView();
  if (starting) window.scrollTo(0, 0);
}

/* ---------- hover preview (desktop) ---------- */

function attachPreviewHover(card, entry){
  card.addEventListener("mouseenter", () => {
    if (!canHoverPreview.matches || window.innerWidth < 800) return;
    clearTimeout(vault.previewTimer);
    vault.previewTimer = setTimeout(() => showPreview(card, entry), 450);
  });
  card.addEventListener("mouseleave", () => clearTimeout(vault.previewTimer));
}

function showPreview(card, entry){
  const pv = $("vaultPreview");
  const anchor = card.querySelector(".vault-top-art") || card;
  const r = anchor.getBoundingClientRect();
  if (!r.width) return;

  const vw = document.documentElement.clientWidth;
  const width = Math.min(Math.max(r.width * 1.45, 300), 440);
  const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, 12), vw - width - 12);
  const artHeight = width * 9 / 16;
  const top = r.top + r.height / 2 - artHeight / 2;
  const info = playInfo(entry, true);
  const target = info.target;

  pv.innerHTML = "";
  const art = el("a", { class: "vault-preview-art", href: detailHref(entry), "aria-label": "Mer info om " + entry.title }, [
    el("img", { src: entry.poster || entry.backdrop || "", alt: "" }),
    el("span", { class: "vault-card-title", text: entry.title })
  ]);
  if (target.record) art.append(progressBar(progressRatio(target.record)));
  bindDetailClick(art, entry);

  const play = el("a", { class: "vault-round-btn vault-round-btn--solid", href: info.href, "aria-label": info.label + ": " + entry.title, title: info.label, html: ICONS.play });
  const more = el("button", { type: "button", class: "vault-round-btn vault-round-btn--push", "aria-label": "Mer info om " + entry.title, title: "Mer info", html: ICONS.down });
  more.addEventListener("click", () => openModal(entry));

  const progressText = target.record
    ? (target.episode ? episodeLabel(target.episode) + " · " : "") + remainingLabel(target.record)
    : target.upNext ? "Nästa: " + episodeLabel(target.episode) : "";

  pv.append(art, el("div", { class: "vault-preview-body" }, [
    el("div", { class: "vault-preview-actions" }, [play, listButton(entry), more]),
    el("p", { class: "vault-preview-meta" }, [
      el("span", { class: "vault-preview-type", text: typeLabel(entry) }),
      document.createTextNode(metaLine(entry))
    ]),
    progressText ? el("p", { class: "vault-preview-progress", text: progressText }) : null,
    entry.genres.length ? el("p", { class: "vault-preview-genres", text: entry.genres.join(" · ") }) : null
  ]));

  pv.style.left = (left + window.scrollX) + "px";
  pv.style.top = (top + window.scrollY) + "px";
  pv.style.width = width + "px";
  pv.style.transformOrigin = (r.left + r.width / 2 - left) + "px " + (artHeight / 2) + "px";
  pv.style.setProperty("--from-scale", (r.width / width).toFixed(3));
  pv.hidden = false;
  requestAnimationFrame(() => pv.classList.add("is-open"));
}

function hidePreview(){
  const pv = $("vaultPreview");
  clearTimeout(vault.previewTimer);
  if (pv.hidden) return;
  pv.classList.remove("is-open");
  setTimeout(() => { if (!pv.classList.contains("is-open")) pv.hidden = true; }, 180);
  if (vault.rowsDirty){
    vault.rowsDirty = false;
    setTimeout(renderView, 0);
  }
}

function initPreview(){
  const pv = $("vaultPreview");
  pv.addEventListener("mouseleave", hidePreview);
  window.addEventListener("resize", hidePreview);
  // the pointer can slip off before it ever "enters" the scaling-in preview,
  // so mouseleave alone would leave it stuck — test against its final box
  document.addEventListener("mousemove", e => {
    if (pv.hidden || !pv.classList.contains("is-open")) return;
    const l = pv.offsetLeft, t = pv.offsetTop;
    if (e.pageX < l || e.pageX > l + pv.offsetWidth || e.pageY < t || e.pageY > t + pv.offsetHeight) hidePreview();
  });
}

/* ---------- detail modal ---------- */

function openModal(entry, opts){
  opts = opts || {};
  hidePreview();
  const modal = $("vaultModal");
  const wasOpen = !!vault.modalSlug;
  vault.modalSlug = entry.slug;
  fillModal(entry);

  if (!opts.fromRoute){
    if (wasOpen) history.replaceState(history.state, "", urlForState());
    else {
      history.pushState({ vaultModal: true }, "", urlForState());
      vault.modalPushed = true;
    }
  }

  if (!wasOpen){
    vault.lastFocus = document.activeElement;
    lockScroll(true);
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add("is-open"));
    setHeroTrailerPaused(true);
  }
  const card = modal.querySelector(".vault-modal-card");
  card.scrollTop = 0;
  card.focus({ preventScroll: true });
}

function closeModal(){
  if (!vault.modalSlug) return;
  if (vault.modalPushed && history.state && history.state.vaultModal){
    history.back();  // popstate -> applyRoute -> hideModal
    return;
  }
  vault.modalSlug = null;
  history.replaceState(history.state, "", urlForState());
  hideModal();
}

function hideModal(){
  const modal = $("vaultModal");
  const slug = vault.modalSlug;
  vault.modalSlug = null;
  vault.modalPushed = false;
  modal.classList.remove("is-open");
  setTimeout(() => { if (!vault.modalSlug) modal.hidden = true; }, 220);
  lockScroll(false);
  setHeroTrailerPaused(false);

  let focusTarget = vault.lastFocus;
  if (!focusTarget || !document.contains(focusTarget)){
    focusTarget = slug && document.querySelector('#vaultMain [data-slug="' + CSS.escape(slug) + '"]');
    if (focusTarget && !focusTarget.matches("a")) focusTarget = focusTarget.querySelector("a");
  }
  if (focusTarget) focusTarget.focus({ preventScroll: true });
}

function lockScroll(on){
  const gap = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.classList.toggle("vault-scroll-lock", on);
  document.body.style.paddingRight = on && gap > 0 ? gap + "px" : "";
}

function fillModal(entry){
  const progress = readProgress();
  const info = playInfo(entry, true);
  const target = info.target;
  const ep = target.episode;

  $("vaultModalTitle").textContent = entry.title;
  $("vaultModalBg").style.backgroundImage = cssUrl(entry.backdrop || entry.poster);
  $("vaultModalPlay").href = info.href;
  $("vaultModalPlayLabel").textContent = info.label;

  const restart = $("vaultModalRestart");
  restart.hidden = !target.record;
  restart.href = watchHref(entry, ep, { restart: true });

  $("vaultModalListSlot").replaceChildren(listButton(entry));

  const prog = $("vaultModalProgress");
  prog.hidden = !target.record;
  if (target.record){
    $("vaultModalProgressFill").style.width = Math.round(progressRatio(target.record) * 100) + "%";
    $("vaultModalProgressText").textContent = (ep ? episodeLabel(ep) + " · " : "") + remainingLabel(target.record);
  }

  $("vaultModalMeta").replaceChildren(
    el("span", { class: "vault-modal-type", text: typeLabel(entry) }),
    document.createTextNode(metaLine(entry))
  );
  $("vaultModalSynopsis").textContent = entry.synopsis || "";

  const side = $("vaultModalSide");
  side.replaceChildren();
  const addFact = (list, label, value) => {
    if (!value || (Array.isArray(value) && !value.length)) return;
    list.append(el("div", {}, [
      el("dt", { text: label + ":" }),
      el("dd", { text: Array.isArray(value) ? value.join(", ") : String(value) })
    ]));
  };
  addFact(side, "Medverkande", (entry.cast || []).slice(0, 4));
  addFact(side, "Genrer", entry.genres);
  addFact(side, "Regi", entry.director);

  // episodes
  const epSection = $("vaultModalEpisodes");
  const epList = $("vaultModalEpisodeList");
  epList.replaceChildren();
  if (entry.type === "series"){
    $("vaultModalEpisodeCount").textContent = entry.episodes.length + " avsnitt";
    entry.episodes.forEach(item => epList.append(buildEpisodeItem(entry, item, progress, ep)));
    epSection.hidden = false;
  } else {
    epSection.hidden = true;
  }

  // more like this
  const similar = similarTitles(entry);
  const moreGrid = $("vaultModalMoreGrid");
  moreGrid.replaceChildren();
  similar.forEach(t => moreGrid.append(buildMoreCard(t)));
  $("vaultModalMore").hidden = !similar.length;

  // about
  $("vaultModalAboutHeading").textContent = "Om " + entry.title;
  const about = $("vaultModalAboutList");
  about.replaceChildren();
  addFact(about, "Regi", entry.director);
  addFact(about, "Medverkande", entry.cast);
  addFact(about, "Genrer", entry.genres);
  addFact(about, "Typ", typeLabel(entry));
  addFact(about, "År", entry.year);
  addFact(about, entry.type === "series" ? "Avsnitt" : "Längd", runtimeLabel(entry));
}

function buildEpisodeItem(entry, ep, progress, currentEp){
  const rec = progress[progressKey(entry.slug, ep.episode)];
  const ratio = progressRatio(rec);
  const thumb = el("div", { class: "vault-episode-thumb" }, [
    el("img", { src: ep.poster || entry.poster || "", alt: "", loading: "lazy", decoding: "async" }),
    el("span", { class: "vault-episode-play", html: ICONS.play })
  ]);
  if (ratio > 0) thumb.append(progressBar(ratio));

  return el("li", { class: "vault-episode" + (ep === currentEp ? " is-current" : "") }, [
    el("a", { class: "vault-episode-link", href: watchHref(entry, ep), "aria-label": "Spela " + episodeLabel(ep) + ": " + ep.title }, [
      el("span", { class: "vault-episode-num", text: String(ep.episode) }),
      thumb,
      el("div", { class: "vault-episode-text" }, [
        el("div", { class: "vault-episode-head" }, [
          el("span", { class: "vault-episode-title", text: ep.title }),
          el("span", { class: "vault-episode-duration", text: formatDuration(ep.duration) })
        ]),
        ep.synopsis ? el("p", { class: "vault-episode-synopsis", text: ep.synopsis }) : null
      ])
    ])
  ]);
}

function similarTitles(entry){
  return vault.manifest.titles
    .filter(t => t !== entry)
    .map(t => ({
      t: t,
      score: t.genres.filter(g => entry.genres.includes(g)).length + (t.type === entry.type ? 0.5 : 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(x => x.t);
}

function buildMoreCard(entry){
  const art = el("a", { class: "vault-more-art", href: detailHref(entry), "aria-label": "Mer info om " + entry.title }, [
    el("img", { src: entry.poster || entry.backdrop || "", alt: "", loading: "lazy", decoding: "async" }),
    el("span", { class: "vault-card-title", text: entry.title }),
    runtimeLabel(entry) ? el("span", { class: "vault-more-runtime", text: runtimeLabel(entry) }) : null
  ]);
  bindDetailClick(art, entry);

  return el("div", { class: "vault-more-card" }, [
    art,
    el("div", { class: "vault-more-body" }, [
      el("div", { class: "vault-more-head" }, [
        el("p", { class: "vault-more-meta", text: [typeLabel(entry), entry.year].filter(Boolean).join(" · ") }),
        listButton(entry, "vault-round-btn--sm")
      ]),
      entry.synopsis ? el("p", { class: "vault-more-synopsis", text: entry.synopsis }) : null
    ])
  ]);
}

function initModal(){
  const modal = $("vaultModal");
  modal.querySelectorAll("[data-modal-close]").forEach(n => n.addEventListener("click", closeModal));
  modal.addEventListener("keydown", e => {
    if (e.key === "Escape"){
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = Array.from(modal.querySelectorAll("a[href], button:not([disabled])"))
      .filter(n => !n.closest("[hidden]") && n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement) || document.activeElement.classList.contains("vault-modal-card"))){
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last){
      e.preventDefault();
      first.focus();
    }
  });
}

/* ---------- boot ---------- */

function showEmptyState(){
  $("vaultEmpty").hidden = false;
  ["vaultHero", "vaultRows", "vaultGridView"].forEach(id => { $(id).hidden = true; });
}

async function initVaultPage(){
  const manifest = await loadManifest();
  $("vaultSkeleton").hidden = true;
  if (!manifest.titles.length){
    showEmptyState();
    return;
  }
  vault.manifest = manifest;

  initNav();
  initSearch();
  initHeroTrailer();
  initPreview();
  initModal();
  applyRoute();

  window.addEventListener("popstate", applyRoute);
  window.addEventListener("resize", () => vault.rowSyncs.forEach(fn => fn()));

  // coming back from the player (bfcache) or another tab: refresh progress + Min lista
  const refresh = () => {
    renderView();
    const open = vault.modalSlug && findEntryBySlug(manifest, vault.modalSlug);
    if (open) fillModal(open);
  };
  window.addEventListener("pageshow", e => { if (e.persisted) refresh(); });
  window.addEventListener("storage", e => {
    if (e.key === VAULT_PROGRESS_KEY || e.key === VAULT_LIST_KEY) refresh();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("vaultRows")) initVaultPage();
});
