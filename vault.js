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

function countLabel(n, one, many){ return n + " " + (n === 1 ? one : many); }

/* ==========================================================================
   BROWSE PAGE (vault.html)
   ========================================================================== */

const VAULT_VIEWS = { serier: "Serier", filmer: "Filmer", "min-lista": "Min lista", live: "Live", sok: "Sök", genre: "Genre" };
const HERO_INTERVAL = 9000;
const CURRENT_YEAR = new Date().getFullYear();

const vault = {
  manifest: null,
  view: "hem",
  kategori: "",   // live category (?visa=live&kategori=)
  genre: "",      // film genre (?visa=genre&genre=)
  query: "",
  overlay: null,  // { kind: "titel" | "live", key }
  overlayPushed: false,
  lastFocus: null,
  liveMeta: {},
  rowSyncs: [],
  routed: false
};

const hero = { view: null, slides: [], nodes: [], index: 0, timer: 0, deadline: 0, remaining: HERO_INTERVAL, holds: {}, trailerTimer: 0 };

const sidebarDocked = window.matchMedia("(min-width: 900px)");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

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

/* ---------- film helpers ---------- */

function filmGenres(titles){
  const out = [];
  titles.forEach(t => t.genres.forEach(g => {
    const slug = slugify(g);
    let group = out.find(x => x.slug === slug);
    if (!group) out.push(group = { slug: slug, label: g, items: [] });
    group.items.push(t);
  }));
  return out;
}

function playInfo(entry, withEpisode){
  const target = resumeTarget(entry);
  const ep = target.episode;
  let label = "Spela upp";
  if (target.record) label = "Fortsätt" + (withEpisode && ep ? " " + episodeLabel(ep) : "");
  else if (target.upNext) label = "Spela " + episodeLabel(ep);
  return { href: watchHref(entry, ep), label: label, target: target };
}

function isNew(entry){ return entry.year && entry.year >= CURRENT_YEAR; }

function badgeEl(text, variant){
  return el("span", { class: "vault-badge" + (variant ? " vault-badge--" + variant : ""), text: text });
}

function titleBadges(entry, withRank){
  const out = [];
  if (isNew(entry)) out.push(badgeEl(entry.type === "series" ? "Ny serie" : "Ny film", "new"));
  else out.push(badgeEl(typeLabel(entry)));
  if (withRank && entry.top) out.push(badgeEl("Nr " + entry.top + " i valvet"));
  return out;
}

function metaSpans(entry){
  return [entry.year, runtimeLabel(entry)].concat(entry.genres)
    .filter(Boolean).map(v => el("span", { text: String(v) }));
}

/* ---------- cards ---------- */

function bindOverlayClick(node, kind, key){
  node.addEventListener("click", e => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    openOverlay(kind, key);
  });
}

function cardText(title, meta, attrs){
  return el("div", { class: "vcard-text" }, [
    el("p", Object.assign({ class: "vcard-title", text: title }, attrs && attrs.title)),
    meta ? el("p", Object.assign({ class: "vcard-meta", text: meta }, attrs && attrs.meta)) : null
  ]);
}

function buildCard(entry, shape){
  shape = shape || "land";
  const src = shape === "poster" ? entry.portrait || entry.poster : entry.poster || entry.backdrop;
  const art = el("div", { class: "vcard-art" }, [
    el("img", { src: src || "", alt: "", loading: "lazy", decoding: "async" }),
    isNew(entry) ? badgeEl(entry.type === "series" ? "Ny serie" : "Ny film", "new") : null
  ]);
  const card = el("a", { class: "vcard vcard--" + shape, href: detailHref(entry), "data-slug": entry.slug }, [
    art,
    cardText(entry.title, [typeLabel(entry), entry.year].filter(Boolean).join(" · "))
  ]);
  bindOverlayClick(card, "titel", entry.slug);
  return card;
}

function buildContinueCard(entry, target){
  const ep = target.episode;
  const sub = ep
    ? (target.upNext ? "Nästa: " : "") + episodeLabel(ep) + (target.record ? " · " + remainingLabel(target.record) : " · " + ep.title)
    : remainingLabel(target.record);

  const link = el("a", {
    class: "vcard-art",
    href: watchHref(entry, ep),
    "aria-label": "Fortsätt titta på " + entry.title + (ep ? ", " + episodeLabel(ep) : "")
  }, [
    el("img", { src: (ep && ep.poster) || entry.poster || "", alt: "", loading: "lazy", decoding: "async" }),
    el("span", { class: "vcard-play", html: ICONS.play }),
    progressBar(target.record ? progressRatio(target.record) : 0)
  ]);
  const remove = el("button", { type: "button", class: "vcard-remove", "aria-label": "Ta bort " + entry.title + " från Fortsätt titta", title: "Ta bort från raden", html: ICONS.close });
  remove.addEventListener("click", () => {
    clearProgress(entry);
    renderView();
  });
  const title = el("a", { class: "vcard-title", href: detailHref(entry), text: entry.title });
  bindOverlayClick(title, "titel", entry.slug);

  return el("div", { class: "vcard vcard--land vcard--continue", "data-slug": entry.slug }, [
    el("div", { class: "vcard-media" }, [link, remove]),
    el("div", { class: "vcard-text" }, [title, el("p", { class: "vcard-meta", text: sub })])
  ]);
}

function buildTopCard(entry, rank){
  const card = el("a", { class: "vtop", href: detailHref(entry), "data-slug": entry.slug, "aria-label": "Nummer " + rank + ": " + entry.title }, [
    el("span", { class: "vtop-num", text: String(rank), "aria-hidden": "true" }),
    el("div", { class: "vcard-art" }, [
      el("img", { src: entry.portrait || entry.poster || "", alt: "", loading: "lazy", decoding: "async" }),
      el("span", { class: "vtop-title", text: entry.title })
    ])
  ]);
  bindOverlayClick(card, "titel", entry.slug);
  return card;
}

function buildLiveCard(live){
  const card = el("a", { class: "vcard vcard--land vcard--live", href: liveHref(live), "data-live": live.id }, [
    el("div", { class: "vcard-art" }, [
      el("img", { src: liveThumbSrc(live), alt: "", loading: "lazy", decoding: "async" }),
      el("span", { class: "vault-badge vault-badge--live" }, [el("i"), document.createTextNode("Live")]),
      live.duration ? el("span", { class: "vcard-duration", text: formatClock(live.duration) }) : null,
      el("span", { class: "vcard-play vcard-play--live", html: ICONS.play })
    ]),
    cardText(liveTitle(live), liveMetaLine(live), {
      title: { "data-live-title": live.id },
      meta: { "data-live-meta": live.id }
    })
  ]);
  bindOverlayClick(card, "live", live.id);
  return card;
}

function exploreTiles(){
  const m = vault.manifest;
  const used = new Set();
  const pickArt = items => {
    const hit = items.find(t => !used.has(t.backdrop || t.poster)) || items[0];
    const src = hit ? hit.backdrop || hit.poster : "";
    used.add(src);
    return src;
  };
  const tiles = [];
  const series = m.titles.filter(t => t.type === "series");
  const movies = m.titles.filter(t => t.type !== "series");
  if (series.length) tiles.push({ label: "Serier", sub: countLabel(series.length, "titel", "titlar"), image: pickArt(series), href: "/vault?visa=serier", view: "serier" });
  if (movies.length) tiles.push({ label: "Filmer", sub: countLabel(movies.length, "titel", "titlar"), image: pickArt(movies), href: "/vault?visa=filmer", view: "filmer" });
  filmGenres(m.titles)
    .filter(g => g.items.length >= 2 && g.items.length < m.titles.length)
    .forEach(g => tiles.push({ label: g.label, sub: countLabel(g.items.length, "titel", "titlar"), image: pickArt(g.items), href: "/vault?visa=genre&genre=" + g.slug, view: "genre", genre: g.slug }));
  if (m.lives.length) tiles.push({ label: "Live", sub: countLabel(m.lives.length, "sändning", "sändningar"), image: "/vault-art/live-backdrop.jpg", href: "/vault?visa=live", view: "live", live: true });
  return tiles;
}

function buildTile(t){
  const tile = el("a", { class: "vtile" + (t.live ? " vtile--live" : ""), href: t.href, "data-view": t.view }, [
    el("span", { class: "vtile-bg", style: "background-image:" + cssUrl(t.image) }),
    el("span", { class: "vtile-label", text: t.label }),
    el("span", { class: "vtile-sub", text: t.sub })
  ]);
  if (t.genre) tile.dataset.genre = t.genre;
  bindNavLink(tile);
  return tile;
}

function listButton(entry, variant){
  const pill = variant === "pill";
  const btn = el("button", { type: "button", class: pill ? "vault-btn vault-btn--glass" : "vault-btn vault-btn--glass vault-btn--icon" });
  const sync = () => {
    const on = inList(entry.slug);
    btn.innerHTML = (on ? ICONS.check : ICONS.plus) + (pill ? "<span>Min lista</span>" : "");
    btn.classList.toggle("is-on", on);
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", on ? "Ta bort " + entry.title + " från Min lista" : "Lägg till " + entry.title + " i Min lista");
    btn.title = on ? "Ta bort från Min lista" : "Lägg till i Min lista";
  };
  btn.dataset.listSlug = entry.slug;
  btn._syncList = sync;
  btn.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    toggleList(entry.slug);
    // every other + button for the same title (hero, title page) follows along
    document.querySelectorAll('[data-list-slug="' + CSS.escape(entry.slug) + '"]').forEach(b => b._syncList && b._syncList());
    if (!vault.overlay) renderView();
    else vault.rowsDirty = true;
  });
  sync();
  return btn;
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

  const tiles = exploreTiles();
  if (tiles.length > 1) rows.push({ title: "Utforska", kind: "explore", items: tiles });

  const list = readList().map(slug => findEntryBySlug(manifest, slug)).filter(Boolean);
  if (list.length) rows.push({ title: "Min lista", items: list });

  const top = titles.filter(t => t.top).sort((a, b) => a.top - b.top).slice(0, 10);
  if (top.length >= 3) rows.push({ title: "Topp " + top.length + " i valvet", kind: "top", items: top });

  const newest = titles.slice().sort((a, b) => (b.year || 0) - (a.year || 0));
  if (newest.length) rows.push({ title: "Nytt i valvet", kind: "poster", items: newest });

  if (manifest.lives.length) rows.push({ title: "Senast från Live", kind: "live", items: manifest.lives.slice(0, 10), link: { text: "Live-arkivet", href: "/vault?visa=live", view: "live" } });

  const series = titles.filter(t => t.type === "series");
  const movies = titles.filter(t => t.type !== "series");
  if (series.length >= 2) rows.push({ title: "Serier", items: series });
  if (movies.length >= 2) rows.push({ title: "Filmer", items: movies });

  // a genre row earns its place once it groups some, but not all, titles
  filmGenres(titles)
    .filter(g => g.items.length >= 2 && g.items.length < titles.length)
    .forEach(g => rows.push({ title: g.label, items: g.items, link: { text: "Visa alla", href: "/vault?visa=genre&genre=" + g.slug, view: "genre", genre: g.slug } }));

  return rows;
}

function buildRow(row){
  const track = el("div", { class: "vault-row-track" });
  row.items.forEach((item, i) => {
    if (row.kind === "continue") track.append(buildContinueCard(item.entry, item.target));
    else if (row.kind === "top") track.append(buildTopCard(item, i + 1));
    else if (row.kind === "live") track.append(buildLiveCard(item));
    else if (row.kind === "explore") track.append(buildTile(item));
    else if (row.kind === "poster") track.append(buildCard(item, "poster"));
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
  track.addEventListener("scroll", sync, { passive: true });
  vault.rowSyncs.push(sync);

  const heading = el("h2", { class: "vault-row-heading", text: row.title });
  if (row.link){
    const link = el("a", { class: "vault-row-link", href: row.link.href, "data-view": row.link.view, text: row.link.text });
    if (row.link.genre) link.dataset.genre = row.link.genre;
    bindNavLink(link);
    heading.append(link);
  }

  return el("section", { class: "vault-row" + (row.kind ? " vault-row--" + row.kind : "") }, [
    heading,
    el("div", { class: "vault-row-viewport" }, [prev, track, next])
  ]);
}

function renderRows(){
  const wrap = $("vaultRows");
  wrap.replaceChildren();
  vault.rowSyncs = [];
  buildHomeRows(vault.manifest).forEach(row => wrap.append(buildRow(row)));
  requestAnimationFrame(() => vault.rowSyncs.forEach(fn => fn()));
}

function renderResults(heading, groups, emptyText){
  $("vaultResultsHeading").textContent = heading;
  $("vaultResultsHeading").hidden = !heading;
  const body = $("vaultResultsBody");
  body.replaceChildren();
  const filled = groups.filter(g => g.items.length);
  filled.forEach(g => {
    if (g.label) body.append(el("h2", { class: "vault-row-heading", text: g.label }));
    const grid = el("div", { class: "vault-grid vault-grid--" + (g.kind === "tile" ? "tile" : g.kind === "poster" ? "poster" : "land") });
    g.items.forEach(item => grid.append(
      g.kind === "live" ? buildLiveCard(item) :
      g.kind === "tile" ? buildTile(item) :
      buildCard(item, g.kind === "poster" ? "poster" : "land")
    ));
    body.append(grid);
  });
  const empty = $("vaultResultsEmpty");
  empty.textContent = emptyText || "";
  empty.hidden = filled.length > 0 || !emptyText;
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

  $("vaultLiveHeading").textContent = vault.kategori ? cats.find(c => c.slug === vault.kategori).label : "Alla sändningar";
  $("vaultLiveGrid").replaceChildren(...shown.map(buildLiveCard));
  $("vaultLiveEmpty").hidden = shown.length > 0;

  const latest = $("vaultLiveLatest");
  latest.hidden = !lives.length;
  if (lives.length) latest.href = liveHref(lives[0]);
}

/* ---------- hero carousel + ambient colour ---------- */

const ambientCache = {};

/* Tints the page with the dominant colour of whatever is on screen, the
   way TV apps glow around their artwork. Same-origin images only. */
function setAmbient(src){
  if (!src) return;
  const apply = rgb => document.documentElement.style.setProperty("--ambient", rgb.join(" "));
  if (ambientCache[src]) return apply(ambientCache[src]);
  const img = new Image();
  img.onload = () => {
    try{
      const c = document.createElement("canvas");
      c.width = 24; c.height = 14;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 14);
      const d = ctx.getImageData(0, 0, 24, 14).data;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let i = 0; i < d.length; i += 4){
        const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2]);
        const w = 1 + (max - min) / 32;  // favour colourful pixels over grey
        r += d[i] * w; g += d[i + 1] * w; b += d[i + 2] * w; wsum += w;
      }
      const rgb = [r, g, b].map(v => v / wsum);
      const peak = Math.max(...rgb) || 1;
      ambientCache[src] = rgb.map(v => Math.round(v / peak * 150));  // normalise brightness
      apply(ambientCache[src]);
    } catch(e){}
  };
  img.src = src;
}

function heroSlidesFor(view){
  const titles = vault.manifest.titles;
  if (view === "serier" || view === "filmer"){
    const series = view === "serier";
    return titles.filter(t => (t.type === "series") === series).slice(0, 5).map(entry => ({ kind: "title", entry: entry }));
  }
  const picked = titles.filter(t => t.featured)
    .concat(titles.filter(t => !t.featured && t.top).sort((a, b) => a.top - b.top));
  const slides = picked.slice(0, 5).map(entry => ({ kind: "title", entry: entry }));
  if (!slides.length && titles.length) slides.push({ kind: "title", entry: titles[0] });
  if (vault.manifest.lives.length) slides.push({ kind: "live" });
  return slides;
}

function buildSlide(slide, i, total){
  const node = el("article", { class: "vault-slide", "aria-roledescription": "bild", "aria-label": (i + 1) + " av " + total });
  const content = el("div", { class: "vault-slide-content" });

  if (slide.kind === "live"){
    slide.image = "/vault-art/live-backdrop.jpg";
    const latest = vault.manifest.lives[0];
    const play = el("a", { class: "vault-btn vault-btn--primary", href: liveHref(latest) }, []);
    play.innerHTML = ICONS.play + "<span>Senaste sändningen</span>";
    bindOverlayClick(play, "live", latest.id);
    const more = el("a", { class: "vault-btn vault-btn--glass", href: "/vault?visa=live", "data-view": "live", text: "Live-arkivet" });
    bindNavLink(more);
    content.append(
      el("div", { class: "vault-badges" }, [
        el("span", { class: "vault-badge vault-badge--live" }, [el("i"), document.createTextNode("Live")]),
        badgeEl(countLabel(vault.manifest.lives.length, "sändning", "sändningar"))
      ]),
      el("h2", { class: "vault-slide-title", text: "Live-arkivet" }),
      el("p", { class: "vault-hero-desc", text: "Flera kameror, klippt i realtid. Evenemang, sport och annat vi har sänt live." }),
      el("div", { class: "vault-actions" }, [play, more])
    );
  } else {
    const entry = slide.entry;
    slide.image = entry.backdrop || entry.poster;
    const info = playInfo(entry, false);
    const play = el("a", { class: "vault-btn vault-btn--primary", href: info.href });
    play.innerHTML = ICONS.play + "<span></span>";
    play.lastChild.textContent = info.label;
    slide.play = play;
    const details = el("a", { class: "vault-btn vault-btn--glass vault-btn--icon", href: detailHref(entry), "aria-label": "Mer om " + entry.title, title: "Mer info", html: ICONS.info });
    bindOverlayClick(details, "titel", entry.slug);
    content.append(
      el("div", { class: "vault-badges" }, titleBadges(entry, true)),
      el("h2", { class: "vault-slide-title", text: entry.title }),
      el("p", { class: "vault-meta" }, metaSpans(entry)),
      entry.synopsis ? el("p", { class: "vault-hero-desc", text: entry.synopsis }) : null,
      el("div", { class: "vault-actions" }, [play, listButton(entry, "pill"), details])
    );
    if (entry.trailer) slide.trailer = entry.trailer;
  }

  const bg = el("div", { class: "vault-slide-bg", style: "background-image:" + cssUrl(slide.image) });
  node.append(bg);
  if (slide.trailer){
    slide.video = el("video", { class: "vault-slide-trailer", muted: true, playsinline: true, preload: "none", "aria-hidden": "true" });
    slide.video.muted = true;
    slide.video.addEventListener("playing", () => { node.classList.add("is-trailer"); $("vaultHeroMute").hidden = false; holdHero("trailer", true); });
    slide.video.addEventListener("ended", () => { node.classList.remove("is-trailer"); $("vaultHeroMute").hidden = true; holdHero("trailer", false); });
    node.append(slide.video);
  }
  node.append(content);
  return node;
}

function renderHero(view){
  if (hero.view === view && hero.slides.length){
    refreshHeroLabels();
    return true;
  }
  stopHero();
  hero.view = view;
  hero.slides = heroSlidesFor(view);
  const total = hero.slides.length;
  hero.nodes = hero.slides.map((s, i) => buildSlide(s, i, total));
  $("vaultHeroSlides").replaceChildren(...hero.nodes);

  const dots = $("vaultHeroDots");
  dots.replaceChildren(...hero.slides.map((s, i) => {
    const label = s.kind === "live" ? "Live-arkivet" : s.entry.title;
    const dot = el("button", { type: "button", class: "vault-dot", "aria-label": "Visa " + label }, [el("span")]);
    dot.addEventListener("click", () => goToSlide(i));
    return dot;
  }));
  const multi = total > 1;
  dots.hidden = !multi;
  $("vaultHeroPrev").hidden = !multi;
  $("vaultHeroNext").hidden = !multi;
  if (total) goToSlide(0);
  return total > 0;
}

function refreshHeroLabels(){
  hero.slides.forEach(s => {
    if (s.play && s.entry){
      const info = playInfo(s.entry, false);
      s.play.href = info.href;
      s.play.lastChild.textContent = info.label;
    }
  });
}

function goToSlide(i){
  const total = hero.slides.length;
  if (!total) return;
  const prevSlide = hero.slides[hero.index];
  if (prevSlide && prevSlide.video){ prevSlide.video.pause(); hero.nodes[hero.index].classList.remove("is-trailer"); }
  $("vaultHeroMute").hidden = true;
  holdHero("trailer", false);

  hero.index = (i + total) % total;
  hero.nodes.forEach((node, n) => {
    const active = n === hero.index;
    node.classList.toggle("is-active", active);
    node.inert = !active;
    node.setAttribute("aria-hidden", String(!active));
  });
  Array.from($("vaultHeroDots").children).forEach((dot, n) => {
    dot.classList.toggle("is-active", n === hero.index);
    if (n === hero.index) dot.setAttribute("aria-current", "true"); else dot.removeAttribute("aria-current");
  });
  const slide = hero.slides[hero.index];
  setAmbient(slide.image);

  clearTimeout(hero.trailerTimer);
  if (slide.video && !reducedMotion.matches && !(navigator.connection && navigator.connection.saveData)){
    hero.trailerTimer = setTimeout(() => {
      if (!slide.video.getAttribute("src")) slide.video.src = slide.trailer;
      slide.video.currentTime = 0;
      slide.video.play().catch(() => {});
    }, 2500);
  }
  scheduleHero(HERO_INTERVAL);
}

/* Auto-advance pauses while anything "holds" it: pointer over the hero,
   keyboard focus inside it, an open overlay, a hidden tab, a playing trailer. */
function scheduleHero(ms){
  clearTimeout(hero.timer);
  hero.remaining = ms;
  const heroEl = $("vaultHero");
  const held = Object.keys(hero.holds).some(k => hero.holds[k]);
  const dotFill = $("vaultHeroDots").querySelector(".is-active span");
  if (dotFill){
    // restart the progress line for this slide
    dotFill.style.animation = "none";
    void dotFill.offsetWidth;
    dotFill.style.animation = "";
    dotFill.style.animationDuration = HERO_INTERVAL + "ms";
  }
  heroEl.classList.toggle("is-held", held || reducedMotion.matches);
  if (held || reducedMotion.matches || hero.slides.length < 2) return;
  hero.deadline = Date.now() + ms;
  hero.timer = setTimeout(() => goToSlide(hero.index + 1), ms);
}

function holdHero(reason, on){
  const wasHeld = Object.keys(hero.holds).some(k => hero.holds[k]);
  hero.holds[reason] = on;
  const isHeld = Object.keys(hero.holds).some(k => hero.holds[k]);
  const heroEl = $("vaultHero");
  heroEl.classList.toggle("is-held", isHeld || reducedMotion.matches);
  if (isHeld && !wasHeld){
    clearTimeout(hero.timer);
    hero.remaining = Math.max(0, hero.deadline - Date.now());
  } else if (!isHeld && wasHeld && hero.slides.length > 1 && !reducedMotion.matches){
    hero.deadline = Date.now() + hero.remaining;
    hero.timer = setTimeout(() => goToSlide(hero.index + 1), hero.remaining);
  }
}

function stopHero(){
  clearTimeout(hero.timer);
  clearTimeout(hero.trailerTimer);
  hero.slides.forEach(s => { if (s.video) s.video.pause(); });
  hero.view = null;
  hero.slides = [];
  hero.nodes = [];
}

function initHero(){
  const heroEl = $("vaultHero");
  $("vaultHeroPrev").addEventListener("click", () => goToSlide(hero.index - 1));
  $("vaultHeroNext").addEventListener("click", () => goToSlide(hero.index + 1));
  heroEl.addEventListener("pointerenter", e => { if (e.pointerType === "mouse") holdHero("pointer", true); });
  heroEl.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") holdHero("pointer", false); });
  heroEl.addEventListener("focusin", () => holdHero("focus", true));
  heroEl.addEventListener("focusout", e => { if (!heroEl.contains(e.relatedTarget)) holdHero("focus", false); });
  document.addEventListener("visibilitychange", () => holdHero("hidden", document.hidden));
  if ("IntersectionObserver" in window){
    new IntersectionObserver(entries => holdHero("offscreen", !entries[0].isIntersecting), { threshold: 0.35 }).observe(heroEl);
  }

  // swipe between slides on touch screens
  let startX = null, startY = 0;
  heroEl.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse"){ startX = e.clientX; startY = e.clientY; } });
  heroEl.addEventListener("pointerup", e => {
    if (startX == null) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    startX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) goToSlide(hero.index + (dx < 0 ? 1 : -1));
  });

  const mute = $("vaultHeroMute");
  mute.addEventListener("click", () => {
    const slide = hero.slides[hero.index];
    if (!slide || !slide.video) return;
    slide.video.muted = !slide.video.muted;
    mute.classList.toggle("is-unmuted", !slide.video.muted);
    mute.setAttribute("aria-label", slide.video.muted ? "Slå på ljud" : "Stäng av ljud");
  });

  $("vaultLiveLatest").addEventListener("click", e => {
    if (!isPlainClick(e) || !vault.manifest.lives.length) return;
    e.preventDefault();
    openOverlay("live", vault.manifest.lives[0].id);
  });
}

/* ---------- search ---------- */

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

function searchInputs(){ return Array.from(document.querySelectorAll(".vault-search-input")); }

function syncSearchInputs(){
  searchInputs().forEach(input => { if (document.activeElement !== input) input.value = vault.query; });
}

function setQuery(raw){
  const query = raw.trim();
  if (query === vault.query) return;
  const starting = !vault.query && query;
  vault.query = query;
  history.replaceState(history.state, "", urlForState());
  renderView();
  if (starting && vault.view !== "sok") window.scrollTo(0, 0);
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
      } else if (e.key === "Enter"){
        input.blur();  // drop the on-screen keyboard so the results show
      }
    });
  });
  document.addEventListener("keydown", e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key !== "/" || typing || vault.overlay) return;
    e.preventDefault();
    if (sidebarDocked.matches) $("vaultSearch").focus();
    else navigateTo({ view: "sok" });
  });
}

/* ---------- views ---------- */

function syncNav(){
  document.querySelectorAll(".vault-nav a[data-view], .vault-tabbar a[data-view], .vault-mchips a[data-view]").forEach(a => {
    const searching = !!vault.query && a.dataset.view !== "sok";
    let active = !searching && a.dataset.view === vault.view &&
      (a.dataset.kategori || "") === (vault.view === "live" ? vault.kategori : "");
    if (a.closest(".vault-tabbar") && a.dataset.view === "hem") active = !vault.query && ["hem", "serier", "filmer", "genre"].includes(vault.view);
    if (a.closest(".vault-tabbar") && a.dataset.view === "sok") active = vault.view === "sok" || !!vault.query;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}

function renderSideCategories(){
  const wrap = $("vaultLiveCats");
  wrap.replaceChildren();
  const cats = liveCategories(vault.manifest.lives);
  if (cats.length < 2) return;
  cats.forEach(c => {
    const a = el("a", { href: "/vault?visa=live&kategori=" + c.slug, class: "vault-nav-sub", "data-view": "live", "data-kategori": c.slug, text: c.label });
    bindNavLink(a);
    wrap.append(a);
  });
}

function renderView(){
  const manifest = vault.manifest;
  if (!manifest) return;
  vault.rowsDirty = false;
  syncNav();

  const parts = {};
  if (vault.view === "sok" || vault.query){
    parts.search = vault.view === "sok";
    parts.results = true;
    if (vault.query){
      renderResults("Resultat för ”" + vault.query + "”", [
        { label: "Film", kind: "land", items: searchTitles(manifest.titles, vault.query) },
        { label: "Live", kind: "live", items: searchLives(manifest.lives, vault.query) }
      ], "Inga träffar på ”" + vault.query + "”. Prova en titel, en genre eller ett årtal.");
    } else {
      renderResults("", [{ label: "Utforska", kind: "tile", items: exploreTiles() }], "");
    }
    document.title = "Sök | A+ Vault";
  } else if (vault.view === "live"){
    parts.live = true;
    renderLive();
    setAmbient("/vault-art/live-backdrop.jpg");
    document.title = "Live | A+ Vault";
  } else if (vault.view === "min-lista"){
    parts.results = true;
    const items = readList().map(slug => findEntryBySlug(manifest, slug)).filter(Boolean);
    renderResults("Min lista", [{ kind: "poster", items: items }], "Du har inte sparat något än. Tryck på + på en titel så hamnar den här.");
    document.title = "Min lista | A+ Vault";
  } else if (vault.view === "genre"){
    parts.results = true;
    const group = filmGenres(manifest.titles).find(g => g.slug === vault.genre);
    renderResults(group ? group.label : "Genre", [{ kind: "poster", items: group ? group.items : [] }], "Inga titlar i den här genren.");
    if (group) setAmbient(group.items[0].backdrop || group.items[0].poster);
    document.title = (group ? group.label : "Genre") + " | A+ Vault";
  } else {
    const type = vault.view === "serier" ? "series" : vault.view === "filmer" ? "movie" : null;
    parts.hero = renderHero(vault.view);
    if (type){
      parts.results = true;
      const pool = manifest.titles.filter(t => (t.type === "series") === (type === "series"));
      renderResults("Alla " + VAULT_VIEWS[vault.view].toLowerCase(), [{ kind: "poster", items: pool }], type === "series" ? "Inga serier i valvet än." : "Inga filmer i valvet än.");
      document.title = VAULT_VIEWS[vault.view] + " | A+ Vault";
    } else {
      parts.rows = true;
      renderRows();
      document.title = "A+ Vault";
    }
  }

  $("vaultHero").hidden = !parts.hero;
  $("vaultSearchPage").hidden = !parts.search;
  $("vaultRows").hidden = !parts.rows;
  $("vaultResults").hidden = !parts.results;
  $("vaultLive").hidden = !parts.live;
  if (!parts.hero) stopHero();
  document.body.classList.toggle("vault-has-hero", !!(parts.hero || parts.live));
}

/* ---------- routing: /vault?visa=…&genre=…&kategori=…&sok=…&titel=…|live=… ---------- */

function currentParams(){
  const p = new URLSearchParams();
  if (vault.view !== "hem") p.set("visa", vault.view);
  if (vault.view === "genre" && vault.genre) p.set("genre", vault.genre);
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
  const genre = view === "genre" ? p.get("genre") || "" : "";
  const query = (p.get("sok") || "").trim();
  if (!vault.routed || view !== vault.view || kategori !== vault.kategori || genre !== vault.genre || query !== vault.query){
    vault.routed = true;
    Object.assign(vault, { view: view, kategori: kategori, genre: genre, query: query });
    syncSearchInputs();
    renderView();
  }
  const kind = p.get("titel") ? "titel" : p.get("live") ? "live" : null;
  if (kind) openOverlay(kind, p.get(kind), { fromRoute: true });
  else if (vault.overlay) hideOverlay();
}

function navigateTo(target, opts){
  const wasView = vault.view;
  vault.view = target.view || "hem";
  vault.kategori = target.kategori || "";
  vault.genre = target.genre || "";
  if (vault.view !== "sok") vault.query = "";
  syncSearchInputs();
  history.pushState(null, "", urlForState());
  renderView();
  if (!(opts && opts.keepScroll)) window.scrollTo(0, 0);
  if (vault.view === "sok" && wasView !== "sok") $("vaultSearchBig").focus({ preventScroll: true });
}

function bindNavLink(a, opts){
  a.addEventListener("click", e => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    // tapping the active mobile chip again clears it
    if (a.closest(".vault-mchips") && a.classList.contains("active")) return navigateTo({ view: "hem" });
    navigateTo({ view: a.dataset.view, kategori: a.dataset.kategori, genre: a.dataset.genre }, opts);
  });
}

function initNav(){
  document.querySelectorAll(".vault-nav a[data-view], .vault-tabbar a[data-view], .vault-mchips a[data-view], .vault-logo").forEach(a => bindNavLink(a));
  const head = $("vaultMHead");
  const onScroll = () => head.classList.toggle("is-scrolled", window.scrollY > 24);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

/* ---------- overlays: title page (?titel=) and live theater (?live=) ---------- */

const VAULT_OVERLAYS = {
  titel: {
    root: "vaultDetail",
    card: ".vault-detail-page",
    find: slug => findEntryBySlug(vault.manifest, slug),
    fill: entry => fillDetail(entry),
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
    holdHero("overlay", true);
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
  else setTimeout(() => { if (!vault.overlay || vault.overlay.kind !== kind) root.hidden = true; }, 260);
}

function hideOverlay(closing){
  closing = closing || vault.overlay;
  vault.overlay = null;
  vault.overlayPushed = false;
  if (!closing) return;
  hideOverlayRoot(closing.kind);
  lockScroll(false);
  holdHero("overlay", false);
  if (vault.rowsDirty) renderView();
  else if (hero.slides[hero.index]) setAmbient(hero.slides[hero.index].image);

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
      const focusables = Array.from(root.querySelectorAll("a[href], button:not([disabled]), iframe, [tabindex='0']"))
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
  initTabs();
}

/* ---------- title page ---------- */

function selectTab(tab){
  document.querySelectorAll(".vault-tab").forEach(t => {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  });
}

function initTabs(){
  const tabs = Array.from(document.querySelectorAll(".vault-tab"));
  tabs.forEach(tab => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", e => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const visible = tabs.filter(t => !t.hidden);
      const next = visible[(visible.indexOf(tab) + (e.key === "ArrowRight" ? 1 : -1) + visible.length) % visible.length];
      selectTab(next);
      next.focus();
    });
  });
}

function fillDetail(entry){
  const progress = readProgress();
  const info = playInfo(entry, true);
  const target = info.target;
  const ep = target.episode;
  const backdrop = entry.backdrop || entry.poster;

  $("vaultDetailBg").style.backgroundImage = cssUrl(backdrop);
  setAmbient(backdrop);
  $("vaultDetailBadges").replaceChildren(...titleBadges(entry, true));
  $("vaultDetailTitle").textContent = entry.title;
  $("vaultDetailMeta").replaceChildren(...metaSpans(entry));
  $("vaultDetailPlay").href = info.href;
  $("vaultDetailPlayLabel").textContent = info.label;
  $("vaultDetailListSlot").replaceChildren(listButton(entry, "pill"));

  const restart = $("vaultDetailRestart");
  restart.hidden = !target.record;
  restart.href = watchHref(entry, ep, { restart: true });

  const prog = $("vaultDetailProgress");
  prog.hidden = !target.record;
  if (target.record){
    $("vaultDetailProgressFill").style.width = Math.round(progressRatio(target.record) * 100) + "%";
    $("vaultDetailProgressText").textContent = (ep ? episodeLabel(ep) + " · " : "") + remainingLabel(target.record);
  }
  $("vaultDetailSynopsis").textContent = entry.synopsis || "";

  // Avsnitt
  const isSeries = entry.type === "series";
  $("vaultTabEpisodes").hidden = !isSeries;
  $("vaultDetailEpisodes").replaceChildren(...(isSeries ? entry.episodes.map(item => buildEpisodeItem(entry, item, progress, ep)) : []));

  // Mer som detta
  const similar = similarTitles(entry);
  $("vaultDetailMore").replaceChildren(...similar.map(t => buildCard(t)));
  $("vaultDetailMoreEmpty").hidden = similar.length > 0;

  // Detaljer
  const facts = $("vaultDetailFacts");
  facts.replaceChildren();
  const addFact = (label, value) => {
    if (!value || (Array.isArray(value) && !value.length)) return;
    facts.append(el("div", {}, [
      el("dt", { text: label }),
      el("dd", { text: Array.isArray(value) ? value.join(", ") : String(value) })
    ]));
  };
  addFact("Titel", entry.title);
  addFact("Typ", typeLabel(entry));
  addFact("År", entry.year);
  addFact(isSeries ? "Avsnitt" : "Längd", runtimeLabel(entry));
  addFact("Genrer", entry.genres);
  addFact("Regi", entry.director);
  addFact("Medverkande", entry.cast);
  addFact("Produktion", "A+ Studios, Alingsås");

  selectTab(isSeries ? $("vaultTabEpisodes") : $("vaultTabMore"));
}

function buildEpisodeItem(entry, ep, progress, currentEp){
  const rec = progress[progressKey(entry.slug, ep.episode)];
  const ratio = progressRatio(rec);
  const thumb = el("div", { class: "vault-episode-thumb" }, [
    el("img", { src: ep.poster || entry.poster || "", alt: "", loading: "lazy", decoding: "async" }),
    el("span", { class: "vcard-play", html: ICONS.play })
  ]);
  if (ratio > 0) thumb.append(progressBar(ratio));

  return el("li", { class: "vault-episode" + (ep === currentEp ? " is-current" : "") }, [
    el("a", { class: "vault-episode-link", href: watchHref(entry, ep), "aria-label": "Spela " + episodeLabel(ep) + ": " + ep.title }, [
      thumb,
      el("div", { class: "vault-episode-text" }, [
        el("p", { class: "vault-episode-kicker", text: episodeLabel(ep) + (ep.duration ? " · " + formatDuration(ep.duration) : "") }),
        el("p", { class: "vault-episode-title", text: ep.title }),
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
      cardText(liveTitle(other), liveMetaLine(other), {
        title: { "data-live-title": other.id },
        meta: { "data-live-meta": other.id }
      })
    ]);
    bindOverlayClick(row, "live", other.id);
    return row;
  }));
}

/* ---------- boot ---------- */

function showEmptyState(){
  $("vaultEmpty").hidden = false;
  ["vaultHero", "vaultRows", "vaultResults", "vaultLive", "vaultSearchPage"].forEach(id => { $(id).hidden = true; });
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
  initHero();
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
      if (open) fillDetail(open);
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
