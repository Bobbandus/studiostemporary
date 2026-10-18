/* ==========================================================================
   A+ VAULT — film + live library
   Reads videos/manifest.json (static, git-committed): "titles" are our own
   films/series (played by vault-player.js on vault-watch.html), "lives" are
   YouTube broadcasts played in an embedded theater on the browse page.
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
    const lives = (Array.isArray(data.lives) ? data.lives : [])
      .map(l => {
        const id = l && youtubeId(l.youtube || l.url);
        return id ? Object.assign({}, l, { id: id }) : null;
      })
      .filter(Boolean);
    // newest first when dates are given; otherwise keep the manifest's order
    if (lives.some(l => l.date)) lives.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    return { titles, lives };
  } catch(err){
    console.warn("A+ Vault: could not load manifest.json", err);
    return { titles: [], lives: [] };
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

/* ---------- live (YouTube) ---------- */

const VAULT_LIVE_META_KEY = "aplusVaultLiveMeta";

/* Accepts a bare video id or any common YouTube URL shape. A ?t= in a
   pasted link is deliberately ignored — use the manifest's `start`. */
function youtubeId(value){
  if (!value) return null;
  const s = String(value).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/(?:[?&]v=|youtu\.be\/|\/embed\/|\/live\/|\/shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function slugify(s){
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatLiveDate(date){
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || "");
  if (!m) return date || "";
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("sv-SE", { day: "numeric", month: "short", year: "numeric" });
}

/* ==========================================================================
   BROWSE PAGE (vault.html)
   ========================================================================== */

const VAULT_VIEWS = { serier: "Serier", filmer: "Filmer", "min-lista": "Min lista", live: "Live" };

const vault = {
  manifest: null,
  view: "hem",
  kategori: "",
  query: "",
  heroEntry: null,
  heroView: null,
  overlay: null,         // { kind: "titel" | "live", key }
  overlayPushed: false,
  lastFocus: null,
  liveMeta: {},
  previewTimer: 0,
  rowsDirty: false,
  rowSyncs: [],
  routed: false,
  trailerTimer: 0
};

const canHoverPreview = window.matchMedia("(hover: hover) and (pointer: fine)");
const sidebarDocked = window.matchMedia("(min-width: 900px)");

/* ---------- live helpers ---------- */

function findLive(id){
  return vault.manifest.lives.find(l => l.id === id) || null;
}

function liveTitle(live){
  const meta = vault.liveMeta[live.id];
  return live.title || (meta && meta.title) || "Livesändning";
}

function liveMetaLine(live){
  const meta = vault.liveMeta[live.id];
  return [
    formatLiveDate(live.date),
    live.category,
    live.duration ? formatClock(live.duration) : "",
    live.channel || (meta && meta.author) || ""
  ].filter(Boolean).join(" · ") || "YouTube";
}

function liveHref(live){
  return "/vault?visa=live&live=" + encodeURIComponent(live.id);
}

function liveThumbSrc(live){
  // hqdefault always exists; it's 4:3 with bars, which object-fit:cover crops away
  return live.thumbnail || "https://i.ytimg.com/vi/" + live.id + "/hqdefault.jpg";
}

function liveCategories(lives){
  const seen = {};
  lives.forEach(l => { if (l.category && !seen[slugify(l.category)]) seen[slugify(l.category)] = l.category; });
  return Object.keys(seen).map(slug => ({ slug: slug, label: seen[slug] }));
}

function readLiveMeta(){
  try{
    const v = JSON.parse(localStorage.getItem(VAULT_LIVE_META_KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch(e){ return {}; }
}

/* Titles that aren't typed into the manifest are looked up in the visitor's
   browser via oEmbed and cached for a week. */
async function fetchYouTubeMeta(id){
  const watch = encodeURIComponent("https://www.youtube.com/watch?v=" + id);
  const endpoints = [
    "https://noembed.com/embed?url=" + watch,
    "https://www.youtube.com/oembed?format=json&url=" + watch
  ];
  for (const url of endpoints){
    try{
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.title) return data;
    } catch(e){}
  }
  return null;
}

async function hydrateLives(){
  const week = 7 * 864e5;
  const todo = vault.manifest.lives.filter(l => {
    const meta = vault.liveMeta[l.id];
    return !l.title && !(meta && meta.title && Date.now() - (meta.at || 0) < week);
  });
  if (!todo.length) return;
  const results = await Promise.all(todo.map(l => fetchYouTubeMeta(l.id).then(data => ({ live: l, data: data }))));
  let changed = false;
  results.forEach(r => {
    if (!r.data) return;
    vault.liveMeta[r.live.id] = { title: r.data.title, author: r.data.author_name || "", at: Date.now() };
    changed = true;
  });
  if (!changed) return;
  try{ localStorage.setItem(VAULT_LIVE_META_KEY, JSON.stringify(vault.liveMeta)); } catch(e){}
  document.querySelectorAll("[data-live-title]").forEach(node => {
    const live = findLive(node.getAttribute("data-live-title"));
    if (live) node.textContent = liveTitle(live);
  });
  document.querySelectorAll("[data-live-meta]").forEach(node => {
    const live = findLive(node.getAttribute("data-live-meta"));
    if (live) node.textContent = liveMetaLine(live);
  });
  if (vault.query) renderView();  // freshly known titles are searchable now
}

/* ---------- play button state ---------- */

function playInfo(entry, withEpisode){
  const target = resumeTarget(entry);
  const ep = target.episode;
  let label = "Spela upp";
  if (target.record) label = "Fortsätt" + (withEpisode && ep ? " " + episodeLabel(ep) : "");
  else if (target.upNext) label = "Spela " + episodeLabel(ep);
  return { href: watchHref(entry, ep), label: label, target: target };
}

function slateCells(entry, extended){
  const cells = [
    extended ? ["Typ", typeLabel(entry)] : null,
    ["År", entry.year],
    entry.type === "series" ? ["Avsnitt", entry.episodes.length] : ["Längd", formatDuration(entry.duration)],
    ["Genre", entry.genres.join(", ")],
    extended ? ["Regi", [].concat(entry.director || []).join(", ")] : null
  ];
  return cells.filter(c => c && c[1]);
}

function fillSlate(dl, cells){
  dl.replaceChildren(...cells.map(c => el("div", {}, [
    el("dt", { text: c[0] }),
    el("dd", { text: String(c[1]) })
  ])));
}

function headingWithCount(tag, title, count){
  return el(tag, { class: "vault-row-heading" }, [
    el("span", { text: title }),
    count != null ? el("span", { class: "vault-row-count", text: String(count).padStart(2, "0") }) : null
  ]);
}

/* ---------- cards ---------- */

function bindOverlayClick(node, kind, key){
  node.addEventListener("click", e => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    openOverlay(kind, key);
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
  bindOverlayClick(card, "titel", entry.slug);
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
  info.addEventListener("click", () => openOverlay("titel", entry.slug));

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
  bindOverlayClick(card, "titel", entry.slug);
  attachPreviewHover(card, entry);
  return card;
}

function buildLiveCard(live){
  const card = el("a", { class: "vault-live-card", href: liveHref(live), "data-live": live.id }, [
    el("div", { class: "vault-live-thumb" }, [
      el("img", { src: liveThumbSrc(live), alt: "", loading: "lazy", decoding: "async" }),
      el("span", { class: "vault-live-badge" }, [el("i"), document.createTextNode("Live")]),
      live.duration ? el("span", { class: "vault-live-duration", text: formatClock(live.duration) }) : null,
      el("span", { class: "vault-live-play", html: ICONS.play })
    ]),
    el("div", { class: "vault-live-body" }, [
      el("p", { class: "vault-live-title", "data-live-title": live.id, text: liveTitle(live) }),
      el("p", { class: "vault-live-meta", "data-live-meta": live.id, text: liveMetaLine(live) })
    ])
  ]);
  bindOverlayClick(card, "live", live.id);
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
  syncCounts();
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
  if (newest.length) rows.push({ title: "Nytt i valvet", items: newest });

  if (manifest.lives.length) rows.push({ title: "Senast från Live", kind: "live", items: manifest.lives.slice(0, 10) });

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
    else if (row.kind === "live") track.append(buildLiveCard(item));
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

  const heading = headingWithCount("h2", row.title, row.kind === "top" ? null : row.items.length);
  if (row.kind === "live"){
    const more = el("a", { class: "vault-row-link", href: "/vault?visa=live", "data-view": "live", text: "Hela live-arkivet" });
    bindNavLink(more);
    heading.append(more);
  }

  return el("section", { class: "vault-row" + (row.kind ? " vault-row--" + row.kind : "") }, [
    heading,
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

function renderResults(heading, groups, emptyText){
  $("vaultResultsHeading").textContent = heading;
  const body = $("vaultResultsBody");
  body.replaceChildren();
  const filled = groups.filter(g => g.items.length);
  filled.forEach(g => {
    if (groups.length > 1) body.append(headingWithCount("h2", g.label, g.items.length));
    const grid = el("div", { class: g.kind === "live" ? "vault-live-grid" : "vault-grid" });
    g.items.forEach(item => grid.append(g.kind === "live" ? buildLiveCard(item) : buildCard(item)));
    body.append(grid);
  });
  const empty = $("vaultResultsEmpty");
  empty.textContent = emptyText || "";
  empty.hidden = filled.length > 0;
}

/* ---------- live library ---------- */

function renderLive(){
  const lives = vault.manifest.lives;
  const cats = liveCategories(lives);
  if (!cats.some(c => c.slug === vault.kategori)) vault.kategori = "";
  const shown = vault.kategori ? lives.filter(l => slugify(l.category) === vault.kategori) : lives;

  const chips = $("vaultLiveChips");
  chips.replaceChildren();
  chips.hidden = cats.length < 2;
  if (cats.length >= 2){
    [{ slug: "", label: "Alla" }].concat(cats).forEach(c => {
      const chip = el("a", {
        class: "vault-chip" + (c.slug === vault.kategori ? " is-active" : ""),
        href: "/vault?visa=live" + (c.slug ? "&kategori=" + c.slug : ""),
        "data-view": "live",
        "data-kategori": c.slug,
        text: c.label
      });
      bindNavLink(chip, { keepScroll: true });
      chips.append(chip);
    });
  }

  const label = vault.kategori ? cats.find(c => c.slug === vault.kategori).label : "Alla sändningar";
  $("vaultLiveHeading").firstElementChild.textContent = label;
  $("vaultLiveCount").textContent = String(shown.length).padStart(2, "0");
  const grid = $("vaultLiveGrid");
  grid.replaceChildren(...shown.map(buildLiveCard));
  $("vaultLiveEmpty").hidden = shown.length > 0;

  const latest = $("vaultLiveLatest");
  latest.hidden = !lives.length;
  if (lives.length) latest.href = liveHref(lives[0]);
}

/* ---------- hero ---------- */

function pickHero(pool){
  const featured = pool.filter(t => t.featured);
  const candidates = featured.length ? featured : pool.slice(0, 1);
  return candidates[Math.floor(Math.random() * candidates.length)] || null;
}

function renderHero(pool){
  if (vault.heroView !== vault.view || !vault.heroEntry){
    vault.heroView = vault.view;
    vault.heroEntry = pickHero(pool);
    const entry = vault.heroEntry;
    if (!entry){ stopHeroTrailer(); return false; }

    const status = { serier: "Serier", filmer: "Filmer" }[vault.view] || "Utvalt";
    $("vaultHeroStatus").lastElementChild.textContent = status;
    $("vaultHeroKicker").textContent = typeLabel(entry);
    $("vaultHeroTitle").textContent = entry.title;
    fillSlate($("vaultHeroSlate"), slateCells(entry, false));
    $("vaultHeroDesc").textContent = entry.synopsis || "";
    $("vaultHeroBg").style.backgroundImage = cssUrl(entry.backdrop || entry.poster);
    startHeroTrailer(entry);
  }
  if (!vault.heroEntry) return false;
  const info = playInfo(vault.heroEntry, false);
  $("vaultHeroPlay").href = info.href;
  $("vaultHeroPlayLabel").textContent = info.label;
  return true;
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
  else if (!vault.overlay && !document.hidden) video.play().catch(() => {});
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
    if (vault.heroEntry) openOverlay("titel", vault.heroEntry.slug);
  });
  $("vaultLiveLatest").addEventListener("click", e => {
    if (!isPlainClick(e) || !vault.manifest.lives.length) return;
    e.preventDefault();
    openOverlay("live", vault.manifest.lives[0].id);
  });
}

/* ---------- views ---------- */

function normalizeText(s){
  return String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function rankedSearch(items, query, titleOf, haystackOf){
  const terms = normalizeText(query).split(/\s+/).filter(Boolean);
  return items
    .map(item => {
      const hay = normalizeText(haystackOf(item));
      const title = normalizeText(titleOf(item));
      return { item: item, hit: terms.every(t => hay.includes(t)), titleHit: terms.every(t => title.includes(t)) };
    })
    .filter(x => x.hit)
    .sort((a, b) => b.titleHit - a.titleHit)
    .map(x => x.item);
}

function searchTitles(titles, query){
  return rankedSearch(titles, query, t => t.title, t => [
    t.title, t.synopsis, t.year, typeLabel(t), t.genres.join(" "),
    (t.cast || []).join(" "),
    t.type === "series" ? t.episodes.map(ep => ep.title).join(" ") : ""
  ].join(" "));
}

function searchLives(lives, query){
  return rankedSearch(lives, query, liveTitle, l => [
    liveTitle(l), "live livesandning", l.category, l.description, l.date, liveMetaLine(l)
  ].join(" "));
}

function syncNav(){
  const section = vault.view === "live" ? "live" : "film";
  document.querySelectorAll(".vault-side-nav a[data-view]").forEach(a => {
    const active = !vault.query && a.dataset.view === vault.view &&
      (a.dataset.kategori || "") === (vault.view === "live" ? vault.kategori : "");
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.querySelectorAll(".vault-seg a").forEach(a => {
    a.classList.toggle("active", !vault.query && a.dataset.section === section);
  });
  document.body.classList.toggle("vault-section-live", section === "live" && !vault.query);
}

function syncCounts(){
  const m = vault.manifest;
  const set = (id, n) => { $(id).textContent = n ? String(n).padStart(2, "0") : ""; };
  set("vaultCountFilm", m.titles.length);
  set("vaultCountLive", m.lives.length);
  set("vaultCountList", readList().filter(slug => findEntryBySlug(m, slug)).length);
}

function renderSideCategories(){
  const wrap = $("vaultLiveCats");
  wrap.replaceChildren();
  const cats = liveCategories(vault.manifest.lives);
  if (cats.length < 2) return;
  cats.forEach(c => {
    const a = el("a", { href: "/vault?visa=live&kategori=" + c.slug, class: "vault-side-sub", "data-view": "live", "data-kategori": c.slug, text: c.label });
    bindNavLink(a);
    wrap.append(a);
  });
}

function renderView(){
  const manifest = vault.manifest;
  if (!manifest) return;
  hidePreview();
  vault.rowsDirty = false;
  syncNav();
  syncCounts();

  const show = parts => {
    $("vaultHero").hidden = !parts.hero;
    $("vaultRows").hidden = !parts.rows;
    $("vaultResults").hidden = !parts.results;
    $("vaultLive").hidden = !parts.live;
    if (!parts.hero){ stopHeroTrailer(); vault.heroView = null; }
    document.body.classList.toggle("vault-has-hero", !!(parts.hero || parts.live));
  };

  if (vault.query){
    show({ results: true });
    renderResults("Resultat för ”" + vault.query + "”", [
      { label: "Film", kind: "film", items: searchTitles(manifest.titles, vault.query) },
      { label: "Live", kind: "live", items: searchLives(manifest.lives, vault.query) }
    ], "Inga träffar på ”" + vault.query + "”. Prova en titel, en genre eller ett årtal.");
    document.title = "Sök | A+ Vault";
  } else if (vault.view === "live"){
    show({ live: true });
    renderLive();
    document.title = "Live | A+ Vault";
  } else if (vault.view === "min-lista"){
    show({ results: true });
    const items = readList().map(slug => findEntryBySlug(manifest, slug)).filter(Boolean);
    renderResults("Min lista", [{ kind: "film", items: items }], "Du har inte sparat något än. Tryck på + på en titel så hamnar den här.");
    document.title = "Min lista | A+ Vault";
  } else {
    const type = vault.view === "serier" ? "series" : vault.view === "filmer" ? "movie" : null;
    const pool = type ? manifest.titles.filter(t => (t.type === "series") === (type === "series")) : manifest.titles;
    const heroShown = renderHero(pool);
    if (type){
      show({ hero: heroShown, results: true });
      renderResults(VAULT_VIEWS[vault.view], [{ kind: "film", items: pool }], type === "series" ? "Inga serier i valvet än." : "Inga filmer i valvet än.");
      document.title = VAULT_VIEWS[vault.view] + " | A+ Vault";
    } else {
      show({ hero: heroShown, rows: true });
      renderRows();
      document.title = "A+ Vault | A+ Studios";
    }
  }
}

/* ---------- routing: /vault?visa=…&kategori=…&sok=…&titel=…|live=… ---------- */

function currentParams(){
  const p = new URLSearchParams();
  if (vault.view !== "hem") p.set("visa", vault.view);
  if (vault.view === "live" && vault.kategori) p.set("kategori", vault.kategori);
  if (vault.query) p.set("sok", vault.query);
  if (vault.overlay) p.set(vault.overlay.kind, vault.overlay.key);
  return p;
}

function urlForState(){
  const qs = currentParams().toString();
  return location.pathname + (qs ? "?" + qs : "");
}

function applyRoute(){
  const p = new URLSearchParams(location.search);
  const view = VAULT_VIEWS[p.get("visa")] ? p.get("visa") : "hem";
  const kategori = view === "live" ? p.get("kategori") || "" : "";
  const query = (p.get("sok") || "").trim();
  if (!vault.routed || view !== vault.view || kategori !== vault.kategori || query !== vault.query){
    vault.routed = true;
    vault.view = view;
    vault.kategori = kategori;
    vault.query = query;
    syncSearchInputs();
    renderView();
  }
  const kind = p.get("titel") ? "titel" : p.get("live") ? "live" : null;
  if (kind) openOverlay(kind, p.get(kind), { fromRoute: true });
  else if (vault.overlay) hideOverlay();
}

function bindNavLink(a, opts){
  a.addEventListener("click", e => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    vault.view = a.dataset.section ? (a.dataset.section === "live" ? "live" : "hem") : a.dataset.view;
    vault.kategori = a.dataset.kategori || "";
    vault.query = "";
    syncSearchInputs();
    history.pushState(null, "", urlForState());
    renderView();
    setDrawer(false);
    if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
  });
}

function initNav(){
  document.querySelectorAll(".vault-side-nav a[data-view], .vault-wordmark, .vault-seg a").forEach(a => bindNavLink(a));

  const topbar = $("vaultTopbar");
  const onScroll = () => topbar.classList.toggle("is-scrolled", window.scrollY > 10);
  window.addEventListener("scroll", () => { onScroll(); hidePreview(); }, { passive: true });
  onScroll();

  $("vaultMenuBtn").addEventListener("click", () => setDrawer(true));
  document.querySelectorAll("[data-side-close]").forEach(n => n.addEventListener("click", () => setDrawer(false)));
  sidebarDocked.addEventListener("change", () => setDrawer(false));
}

function setDrawer(open){
  const side = $("vaultSide");
  const wasOpen = side.classList.contains("is-open");
  if (open === wasOpen) return;
  side.classList.toggle("is-open", open);
  $("vaultSideScrim").hidden = !open;
  $("vaultMenuBtn").setAttribute("aria-expanded", String(open));
  document.documentElement.classList.toggle("vault-scroll-lock", open || !!vault.overlay);
  if (open) side.querySelector(".vault-side-nav a").focus({ preventScroll: true });
  else if (!sidebarDocked.matches) $("vaultMenuBtn").focus({ preventScroll: true });
}

/* ---------- search ---------- */

function searchInputs(){ return Array.from(document.querySelectorAll(".vault-search-input")); }

function syncSearchInputs(){
  searchInputs().forEach(input => { if (document.activeElement !== input) input.value = vault.query; });
  if (vault.query && !sidebarDocked.matches) setTopSearch(true, false);
}

function setTopSearch(open, focus){
  const row = $("vaultTopSearch");
  row.hidden = !open;
  $("vaultTopSearchBtn").setAttribute("aria-expanded", String(open));
  $("vaultTopbar").classList.toggle("has-search", open);
  if (open && focus) row.querySelector("input").focus();
}

function initSearch(){
  let timer = 0;
  searchInputs().forEach(input => {
    input.addEventListener("input", () => {
      searchInputs().forEach(other => { if (other !== input) other.value = input.value; });
      clearTimeout(timer);
      timer = setTimeout(() => setQuery(input.value), 160);
    });
    input.addEventListener("keydown", e => {
      if (e.key === "Escape"){
        input.value = "";
        setQuery("");
        input.blur();
        if (!sidebarDocked.matches) setTopSearch(false);
      } else if (e.key === "Enter"){
        input.blur();  // close the on-screen keyboard so results are visible
      }
    });
  });

  $("vaultTopSearchBtn").addEventListener("click", () => {
    const open = $("vaultTopSearch").hidden;
    setTopSearch(open, open);
    if (!open && vault.query){
      searchInputs().forEach(i => { i.value = ""; });
      setQuery("");
    }
  });

  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === "/" && !typing && !vault.overlay){
      e.preventDefault();
      if (sidebarDocked.matches) $("vaultSearch").focus();
      else setTopSearch(true, true);
    } else if (e.key === "Escape" && $("vaultSide").classList.contains("is-open")){
      setDrawer(false);
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
    if (!canHoverPreview.matches || window.innerWidth < 900) return;
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
  const minLeft = sidebarDocked.matches ? $("vaultSide").getBoundingClientRect().right + 12 : 12;
  const width = Math.min(Math.max(r.width * 1.45, 300), 420);
  const left = Math.min(Math.max(r.left + r.width / 2 - width / 2, minLeft), vw - width - 12);
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
  bindOverlayClick(art, "titel", entry.slug);

  const play = el("a", { class: "vault-round-btn vault-round-btn--solid", href: info.href, "aria-label": info.label + ": " + entry.title, title: info.label, html: ICONS.play });
  const more = el("button", { type: "button", class: "vault-round-btn vault-round-btn--push", "aria-label": "Mer info om " + entry.title, title: "Mer info", html: ICONS.down });
  more.addEventListener("click", () => openOverlay("titel", entry.slug));

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
    entry.genres.length ? el("p", { class: "vault-preview-genres", text: entry.genres.join(" / ") }) : null
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

/* ---------- overlays: title modal (?titel=) and live theater (?live=) ---------- */

const VAULT_OVERLAYS = {
  titel: {
    root: "vaultModal",
    card: ".vault-modal-card",
    find: slug => findEntryBySlug(vault.manifest, slug),
    fill: entry => fillModal(entry),
    hide: () => {}
  },
  live: {
    root: "vaultTheater",
    card: ".vault-theater-card",
    find: id => findLive(id),
    fill: live => fillTheater(live),
    hide: () => { $("vaultTheaterFrame").src = "about:blank"; }  // stops playback
  }
};

function openOverlay(kind, key, opts){
  opts = opts || {};
  const cfg = VAULT_OVERLAYS[kind];
  const item = cfg && cfg.find(key);
  if (!item) return;
  const prev = vault.overlay;
  if (prev && prev.kind === kind && prev.key === key) return;
  hidePreview();
  setDrawer(false);
  if (prev && prev.kind !== kind) hideOverlayRoot(prev.kind, true);

  vault.overlay = { kind: kind, key: key };
  cfg.fill(item);

  if (!opts.fromRoute){
    if (prev) history.replaceState(history.state, "", urlForState());
    else {
      history.pushState({ vaultOverlay: true }, "", urlForState());
      vault.overlayPushed = true;
    }
  }
  if (!prev){
    vault.lastFocus = document.activeElement;
    lockScroll(true);
    setHeroTrailerPaused(true);
  }

  const root = $(cfg.root);
  if (root.hidden){
    root.hidden = false;
    requestAnimationFrame(() => root.classList.add("is-open"));
  }
  root.scrollTop = 0;
  root.querySelector(cfg.card).focus({ preventScroll: true });
}

function closeOverlay(){
  if (!vault.overlay) return;
  if (vault.overlayPushed && history.state && history.state.vaultOverlay){
    history.back();  // popstate -> applyRoute -> hideOverlay
    return;
  }
  const closing = vault.overlay;
  vault.overlay = null;
  history.replaceState(history.state, "", urlForState());
  hideOverlay(closing);
}

function hideOverlayRoot(kind, instant){
  const cfg = VAULT_OVERLAYS[kind];
  const root = $(cfg.root);
  root.classList.remove("is-open");
  cfg.hide();
  if (instant) root.hidden = true;
  else setTimeout(() => { if (!vault.overlay || vault.overlay.kind !== kind) root.hidden = true; }, 220);
}

function hideOverlay(closing){
  closing = closing || vault.overlay;
  vault.overlay = null;
  vault.overlayPushed = false;
  if (!closing) return;
  hideOverlayRoot(closing.kind);
  lockScroll(false);
  setHeroTrailerPaused(false);

  let focusTarget = vault.lastFocus;
  if (!focusTarget || !document.contains(focusTarget)){
    const attr = closing.kind === "live" ? "data-live" : "data-slug";
    focusTarget = document.querySelector("#vaultMain [" + attr + '="' + CSS.escape(closing.key) + '"]');
    if (focusTarget && !focusTarget.matches("a")) focusTarget = focusTarget.querySelector("a");
  }
  if (focusTarget) focusTarget.focus({ preventScroll: true });
}

function lockScroll(on){
  const gap = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.classList.toggle("vault-scroll-lock", on);
  document.body.style.paddingRight = on && gap > 0 ? gap + "px" : "";
}

function initOverlays(){
  Object.keys(VAULT_OVERLAYS).forEach(kind => {
    const root = $(VAULT_OVERLAYS[kind].root);
    root.querySelectorAll("[data-overlay-close]").forEach(n => n.addEventListener("click", closeOverlay));
    root.addEventListener("keydown", e => {
      if (e.key === "Escape"){
        e.preventDefault();
        closeOverlay();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(root.querySelectorAll("a[href], button:not([disabled]), iframe"))
        .filter(n => !n.closest("[hidden]") && n.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === root.querySelector(VAULT_OVERLAYS[kind].card))){
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last){
        e.preventDefault();
        first.focus();
      }
    });
  });
}

/* ---------- title modal ---------- */

function fillModal(entry){
  const progress = readProgress();
  const info = playInfo(entry, true);
  const target = info.target;
  const ep = target.episode;

  $("vaultModalKicker").textContent = typeLabel(entry);
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

  fillSlate($("vaultModalSlate"), slateCells(entry, true));
  $("vaultModalSynopsis").textContent = entry.synopsis || "";

  const epSection = $("vaultModalEpisodes");
  const epList = $("vaultModalEpisodeList");
  epList.replaceChildren();
  if (entry.type === "series"){
    $("vaultModalEpisodeCount").textContent = String(entry.episodes.length).padStart(2, "0");
    entry.episodes.forEach(item => epList.append(buildEpisodeItem(entry, item, progress, ep)));
    epSection.hidden = false;
  } else {
    epSection.hidden = true;
  }

  const similar = similarTitles(entry);
  $("vaultModalMoreGrid").replaceChildren(...similar.map(buildMoreCard));
  $("vaultModalMore").hidden = !similar.length;

  $("vaultModalAboutHeading").textContent = "Om " + entry.title;
  const about = $("vaultModalAboutList");
  about.replaceChildren();
  const addFact = (label, value) => {
    if (!value || (Array.isArray(value) && !value.length)) return;
    about.append(el("div", {}, [
      el("dt", { text: label }),
      el("dd", { text: Array.isArray(value) ? value.join(", ") : String(value) })
    ]));
  };
  addFact("Regi", entry.director);
  addFact("Medverkande", entry.cast);
  addFact("Genrer", entry.genres);
  addFact("Typ", typeLabel(entry));
  addFact("År", entry.year);
  addFact(entry.type === "series" ? "Avsnitt" : "Längd", runtimeLabel(entry));
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
      el("span", { class: "vault-episode-num", text: String(ep.episode).padStart(2, "0") }),
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
  bindOverlayClick(art, "titel", entry.slug);

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

/* ---------- live theater ---------- */

function fillTheater(live){
  const start = live.start ? Math.floor(live.start) : 0;
  const frame = $("vaultTheaterFrame");
  frame.src = "https://www.youtube-nocookie.com/embed/" + live.id + "?autoplay=1&rel=0&playsinline=1" + (start ? "&start=" + start : "");
  frame.title = liveTitle(live);

  const title = $("vaultTheaterTitle");
  title.setAttribute("data-live-title", live.id);
  title.textContent = liveTitle(live);
  const meta = $("vaultTheaterMeta");
  meta.setAttribute("data-live-meta", live.id);
  meta.textContent = liveMetaLine(live);
  const desc = $("vaultTheaterDesc");
  desc.textContent = live.description || "";
  desc.hidden = !live.description;
  $("vaultTheaterYouTube").href = "https://www.youtube.com/watch?v=" + live.id + (start ? "&t=" + start + "s" : "");

  const others = vault.manifest.lives.filter(l => l !== live).slice(0, 6);
  $("vaultTheaterMore").hidden = !others.length;
  $("vaultTheaterList").replaceChildren(...others.map(other => {
    const row = el("a", { class: "vault-theater-item", href: liveHref(other) }, [
      el("div", { class: "vault-theater-item-thumb" }, [el("img", { src: liveThumbSrc(other), alt: "", loading: "lazy" })]),
      el("div", {}, [
        el("p", { class: "vault-live-title", "data-live-title": other.id, text: liveTitle(other) }),
        el("p", { class: "vault-live-meta", "data-live-meta": other.id, text: liveMetaLine(other) })
      ])
    ]);
    bindOverlayClick(row, "live", other.id);
    return row;
  }));
}

/* ---------- boot ---------- */

function showEmptyState(){
  $("vaultEmpty").hidden = false;
  ["vaultHero", "vaultRows", "vaultResults", "vaultLive"].forEach(id => { $(id).hidden = true; });
}

async function initVaultPage(){
  const manifest = await loadManifest();
  $("vaultSkeleton").hidden = true;
  if (!manifest.titles.length && !manifest.lives.length){
    showEmptyState();
    return;
  }
  vault.manifest = manifest;
  vault.liveMeta = readLiveMeta();

  initNav();
  initSearch();
  initHeroTrailer();
  initPreview();
  initOverlays();
  renderSideCategories();
  applyRoute();
  hydrateLives();

  window.addEventListener("popstate", applyRoute);
  window.addEventListener("resize", () => vault.rowSyncs.forEach(fn => fn()));

  // coming back from the player (bfcache) or another tab: refresh progress + Min lista
  const refresh = () => {
    renderView();
    if (vault.overlay && vault.overlay.kind === "titel"){
      const open = findEntryBySlug(manifest, vault.overlay.key);
      if (open) fillModal(open);
    }
  };
  window.addEventListener("pageshow", e => { if (e.persisted) refresh(); });
  window.addEventListener("storage", e => {
    if (e.key === VAULT_PROGRESS_KEY || e.key === VAULT_LIST_KEY) refresh();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("vaultRows")) initVaultPage();
});
