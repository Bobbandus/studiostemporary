/* ==========================================================================
   A+ VAULT — watch page player (vault-watch.html)
   Streaming-style controls over a plain <video>: auto-hiding UI, scrubber,
   keyboard shortcuts, skip intro, "Nästa avsnitt" countdown, episode panel,
   subtitles/speed, resume. Depends on the shared helpers in vault.js.
   ========================================================================== */

const PLAYER_VOLUME_KEY = "aplusVaultVolume";
const PLAYER_SUBS_KEY = "aplusVaultSubs";
const PLAYER_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];
const PLAYER_IDLE_MS = 3000;
const PLAYER_NEXT_LEAD = 15;       // seconds before the end the next-episode card appears (unless `credits` is set)
const PLAYER_NEXT_COUNTDOWN = 10;  // seconds of playback before it rolls on by itself

const player = {
  manifest: null,
  entry: null,
  episode: null,
  key: null,
  ready: false,
  startAt: 0,
  lastSave: 0,
  idleTimer: 0,
  overControls: false,
  raf: 0,
  next: { shown: false, dismissed: false, elapsed: 0, timer: 0 },
  scrubbing: false,
  pendingTime: null,
  lastTap: { t: 0, side: "" }
};

/* Vercel rewrites /vault/<slug> to vault-watch.html?slug=<slug> on the
   server side only — the browser's own address bar (and therefore
   location.search) still just shows /vault/<slug>, so the slug has to be
   read from the path. Falls back to ?slug= for direct/local access. */
function getSlugFromPath(){
  const m = window.location.pathname.match(/\/vault\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function currentItem(){ return player.episode || player.entry; }

function nextEpisode(){
  const { entry, episode } = player;
  if (!entry || entry.type !== "series" || !episode) return null;
  return entry.episodes[entry.episodes.indexOf(episode) + 1] || null;
}

/* ---------- loading ---------- */

function loadItem(entry, episode, opts){
  opts = opts || {};
  const video = $("vaultPlayer");
  saveProgress();

  player.entry = entry;
  player.episode = episode;
  player.key = progressKey(entry.slug, episode ? episode.episode : null);
  player.ready = false;
  resetNextCard();
  $("playerEnd").hidden = true;
  $("playerError").hidden = true;
  $("playerSkipIntro").hidden = true;
  closePanels();

  const item = currentItem();
  const label = episode ? entry.title + " · " + episode.title : entry.title;
  document.title = label + " | A+ Vault";
  const titleNodes = () => [
    el("strong", { text: entry.title }),
    episode ? el("span", { text: episodeLabel(episode) + "  " + episode.title }) : null
  ];
  $("playerTitle").replaceChildren(...titleNodes().filter(Boolean));
  $("playerTopTitle").replaceChildren(...titleNodes().filter(Boolean));
  if (opts.updateUrl) history.replaceState(null, "", watchHref(entry, episode));

  const rec = readProgress()[player.key];
  player.startAt = opts.startAt != null ? opts.startAt : (isResumable(rec) ? rec.position : 0);

  video.querySelectorAll("track").forEach(t => t.remove());
  const subsPref = localStorage.getItem(PLAYER_SUBS_KEY);
  (item.subtitles || []).forEach(s => {
    video.append(el("track", {
      kind: "subtitles",
      src: s.src,
      srclang: s.lang || "sv",
      label: s.label || s.lang || "Undertexter",
      default: subsPref && subsPref === (s.lang || "sv")
    }));
  });

  video.poster = item.poster || entry.backdrop || entry.poster || "";
  video.src = item.video;
  video.load();

  $("playerNextBtn").hidden = !nextEpisode();
  $("playerEpisodesBtn").hidden = entry.type !== "series";
  renderEpisodePanel();
  renderSettings();
  updateIntroMark();
  setupMediaSession();
  setActive();
  attemptPlay();
}

function attemptPlay(){
  const video = $("vaultPlayer");
  const p = video.play();
  if (p && p.catch){
    p.catch(err => {
      if (err && err.name === "NotAllowedError") $("playerBigPlay").hidden = false;
    });
  }
}

function playNext(){
  const ep = nextEpisode();
  if (!ep) return;
  loadItem(player.entry, ep, { updateUrl: true, startAt: 0 });
}

/* ---------- progress ---------- */

function saveProgress(){
  const video = $("vaultPlayer");
  if (!player.key || !player.ready) return;
  const d = video.duration;
  if (!d || !isFinite(d)) return;
  const map = readProgress();
  const watched = video.ended || video.currentTime >= d * VAULT_DONE_RATIO;
  map[player.key] = {
    position: watched ? d : video.currentTime,
    duration: d,
    updatedAt: Date.now(),
    completed: watched || undefined
  };
  writeProgress(map);
  player.lastSave = Date.now();
}

/* ---------- UI state ---------- */

function setActive(){
  const root = $("player");
  root.classList.add("is-active");
  clearTimeout(player.idleTimer);
  player.idleTimer = setTimeout(() => {
    const video = $("vaultPlayer");
    if (video.paused || player.overControls || player.scrubbing || anyPanelOpen()) return;
    root.classList.remove("is-active");
  }, PLAYER_IDLE_MS);
}

function setInactive(){
  clearTimeout(player.idleTimer);
  const video = $("vaultPlayer");
  if (!video.paused && !anyPanelOpen()) $("player").classList.remove("is-active");
}

function flash(kind){
  const node = $("playerFlash");
  const icons = {
    play: ICONS.play,
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="fill" d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/></svg>',
    back: '<span>−10</span>',
    fwd: '<span>+10</span>'
  };
  node.innerHTML = icons[kind] || "";
  node.className = "player-flash player-flash--" + kind;
  void node.offsetWidth;  // restart the animation
  node.classList.add("is-on");
}

function togglePlay(showFlash){
  const video = $("vaultPlayer");
  if (!$("playerEnd").hidden) return;
  if (video.paused || video.ended){
    attemptPlay();
    if (showFlash) flash("play");
  } else {
    video.pause();
    if (showFlash) flash("pause");
  }
}

function seekBy(delta, showFlash){
  const video = $("vaultPlayer");
  if (!video.duration) return;
  video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), video.duration - 0.1);
  if (showFlash) flash(delta < 0 ? "back" : "fwd");
  updateTimeUI();
  setActive();
}

function updateTimeUI(){
  const video = $("vaultPlayer");
  const d = video.duration || 0;
  const t = player.pendingTime != null ? player.pendingTime : video.currentTime;
  const pct = d ? (t / d) * 100 : 0;
  $("playerPlayed").style.width = pct + "%";
  $("playerThumb").style.left = pct + "%";
  $("playerTime").textContent = d ? formatClock(d - t) : "0:00";

  const scrub = $("playerScrub");
  scrub.setAttribute("aria-valuemax", String(Math.floor(d)));
  scrub.setAttribute("aria-valuenow", String(Math.floor(t)));
  scrub.setAttribute("aria-valuetext", formatClock(t) + " av " + formatClock(d));

  if (d && video.buffered.length){
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++){
      if (video.buffered.start(i) <= video.currentTime + 0.5) end = Math.max(end, video.buffered.end(i));
    }
    $("playerBuffered").style.width = (end / d) * 100 + "%";
  }
}

function tick(){
  updateTimeUI();
  if (!$("vaultPlayer").paused) player.raf = requestAnimationFrame(tick);
}

/* ---------- volume ---------- */

function applyVolumeUI(){
  const video = $("vaultPlayer");
  const root = $("player");
  const vol = video.muted ? 0 : video.volume;
  root.classList.toggle("is-muted", vol === 0);
  root.classList.toggle("is-vol-low", vol > 0 && vol < 0.5);
  const slider = $("playerVolume");
  slider.value = String(vol);
  slider.style.setProperty("--fill", vol * 100 + "%");
  const mute = $("playerMute");
  mute.setAttribute("aria-label", vol === 0 ? "Slå på ljud (m)" : "Stäng av ljud (m)");
}

function storeVolume(){
  const video = $("vaultPlayer");
  try{ localStorage.setItem(PLAYER_VOLUME_KEY, JSON.stringify({ volume: video.volume, muted: video.muted })); } catch(e){}
}

function initVolume(){
  const video = $("vaultPlayer");
  try{
    const saved = JSON.parse(localStorage.getItem(PLAYER_VOLUME_KEY) || "null");
    if (saved){
      video.volume = Math.min(Math.max(Number(saved.volume) || 0, 0), 1);
      video.muted = !!saved.muted;
    }
  } catch(e){}
  $("playerMute").addEventListener("click", () => {
    if (video.muted || video.volume === 0){
      video.muted = false;
      if (video.volume === 0) video.volume = 0.5;
    } else {
      video.muted = true;
    }
  });
  $("playerVolume").addEventListener("input", e => {
    video.volume = Number(e.target.value);
    video.muted = video.volume === 0;
  });
  video.addEventListener("volumechange", () => { applyVolumeUI(); storeVolume(); });
  applyVolumeUI();
}

function nudgeVolume(delta){
  const video = $("vaultPlayer");
  video.muted = false;
  video.volume = Math.round(Math.min(Math.max(video.volume + delta, 0), 1) * 100) / 100;
  setActive();
}

/* ---------- fullscreen ---------- */

function isFullscreen(){
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen(){
  const root = $("player");
  const video = $("vaultPlayer");
  if (isFullscreen()){
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else if (root.requestFullscreen){
    root.requestFullscreen().catch(() => {});
  } else if (root.webkitRequestFullscreen){
    root.webkitRequestFullscreen();
  } else if (video.webkitEnterFullscreen){
    video.webkitEnterFullscreen();  // iOS Safari: only the <video> itself can go fullscreen
  }
}

/* ---------- scrubber ---------- */

function initScrubber(){
  const scrub = $("playerScrub");
  const tip = $("playerScrubTip");
  const video = $("vaultPlayer");

  const timeAt = clientX => {
    const r = scrub.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    return { ratio: ratio, time: ratio * (video.duration || 0), x: ratio * r.width };
  };
  const showTip = pos => {
    tip.hidden = !video.duration;
    tip.textContent = formatClock(pos.time);
    const half = tip.offsetWidth / 2;
    tip.style.left = Math.min(Math.max(pos.x, half), scrub.clientWidth - half) + "px";
  };

  scrub.addEventListener("pointerdown", e => {
    if (!video.duration) return;
    player.scrubbing = true;
    scrub.setPointerCapture(e.pointerId);
    scrub.classList.add("is-scrubbing");
    const pos = timeAt(e.clientX);
    player.pendingTime = pos.time;
    showTip(pos);
    updateTimeUI();
  });
  scrub.addEventListener("pointermove", e => {
    const pos = timeAt(e.clientX);
    if (e.pointerType === "mouse" || player.scrubbing) showTip(pos);
    if (player.scrubbing){
      player.pendingTime = pos.time;
      updateTimeUI();
    }
  });
  const finish = e => {
    if (!player.scrubbing) return;
    player.scrubbing = false;
    scrub.classList.remove("is-scrubbing");
    if (e.type === "pointerup" && player.pendingTime != null) video.currentTime = player.pendingTime;
    player.pendingTime = null;
    if (e.pointerType !== "mouse") tip.hidden = true;
    updateTimeUI();
    setActive();
  };
  scrub.addEventListener("pointerup", finish);
  scrub.addEventListener("pointercancel", finish);
  scrub.addEventListener("pointerleave", () => { if (!player.scrubbing) tip.hidden = true; });
}

/* ---------- skip intro + next episode ---------- */

function updateIntroMark(){
  const mark = $("playerIntroMark");
  const intro = currentItem() && currentItem().intro;
  const d = $("vaultPlayer").duration;
  if (!intro || !d){ mark.hidden = true; return; }
  mark.hidden = false;
  mark.style.left = (intro.start / d) * 100 + "%";
  mark.style.width = ((intro.end - intro.start) / d) * 100 + "%";
}

function checkIntro(){
  const intro = currentItem() && currentItem().intro;
  const btn = $("playerSkipIntro");
  if (!intro){ btn.hidden = true; return; }
  const t = $("vaultPlayer").currentTime;
  btn.hidden = !(t >= intro.start && t < intro.end - 1);
}

function creditsAt(){
  const d = $("vaultPlayer").duration;
  const ep = player.episode;
  if (ep && ep.credits) return ep.credits;
  return Math.max(d - PLAYER_NEXT_LEAD, d * 0.75);
}

function checkNextCard(){
  const video = $("vaultPlayer");
  const next = nextEpisode();
  const n = player.next;
  if (!next || !video.duration) return;
  if (video.currentTime < creditsAt()){
    if (n.shown || n.dismissed) resetNextCard();  // seeked back out of the credits
    return;
  }
  if (!n.shown && !n.dismissed && !video.ended) showNextCard(next);
}

function showNextCard(next){
  const n = player.next;
  n.shown = true;
  n.elapsed = 0;
  $("playerNextImg").src = next.poster || player.entry.poster || "";
  $("playerNextTitle").textContent = episodeLabel(next) + " · " + next.title;
  $("playerNextFill").style.width = "0%";
  $("playerNext").hidden = false;
  clearInterval(n.timer);
  n.timer = setInterval(() => {
    const video = $("vaultPlayer");
    if (video.paused && !video.ended) return;
    n.elapsed += 0.25;
    const left = Math.max(0, Math.ceil(PLAYER_NEXT_COUNTDOWN - n.elapsed));
    $("playerNextLabel").textContent = "Nästa avsnitt om " + left;
    $("playerNextFill").style.width = Math.min(100, (n.elapsed / PLAYER_NEXT_COUNTDOWN) * 100) + "%";
    if (n.elapsed >= PLAYER_NEXT_COUNTDOWN) playNext();
  }, 250);
}

function resetNextCard(dismissed){
  const n = player.next;
  clearInterval(n.timer);
  n.shown = false;
  n.elapsed = 0;
  n.dismissed = !!dismissed;
  $("playerNext").hidden = true;
  $("playerNextLabel").textContent = "Nästa avsnitt";
}

/* ---------- end screen ---------- */

function showEndScreen(){
  const { entry, manifest } = player;
  $("playerEndTitle").textContent = player.episode ? entry.title + " · " + player.episode.title : entry.title;
  const others = manifest.titles.filter(t => t !== entry).slice(0, 3);
  const grid = $("playerEndGrid");
  grid.replaceChildren();
  others.forEach(t => {
    const target = resumeTarget(t);
    grid.append(el("a", { class: "player-end-card", href: watchHref(t, target.episode) }, [
      el("div", { class: "player-end-card-art" }, [
        el("img", { src: t.poster || t.backdrop || "", alt: "", loading: "lazy" }),
        el("span", { class: "vault-card-title", text: t.title })
      ]),
      el("span", { class: "player-end-card-meta", text: [typeLabel(t), metaLine(t)].filter(Boolean).join(" · ") })
    ]));
  });
  $("playerEndMore").hidden = !others.length;
  $("playerEnd").hidden = false;
  $("player").classList.add("is-active");
  $("playerReplay").focus({ preventScroll: true });
}

/* ---------- panels: episodes + settings ---------- */

function anyPanelOpen(){
  return !$("playerEpisodes").hidden || !$("playerSettings").hidden;
}

function closePanels(){
  ["playerEpisodes", "playerSettings"].forEach(id => { $(id).hidden = true; });
  ["playerEpisodesBtn", "playerSettingsBtn"].forEach(id => $(id).setAttribute("aria-expanded", "false"));
}

function togglePanel(id, btnId){
  const open = $(id).hidden;
  closePanels();
  $(id).hidden = !open;
  $(btnId).setAttribute("aria-expanded", String(open));
  setActive();
  if (open){
    const panel = $(id);
    const current = panel.querySelector(".is-current button") || panel.querySelector(".player-chip.is-selected") || panel.querySelector("button");
    if (current) current.focus({ preventScroll: true });
  }
}

function renderEpisodePanel(){
  const { entry, episode } = player;
  const list = $("playerEpisodeList");
  list.replaceChildren();
  if (entry.type !== "series") return;
  $("playerEpisodesHeading").textContent = entry.title;
  const progress = readProgress();
  entry.episodes.forEach(ep => {
    const ratio = progressRatio(progress[progressKey(entry.slug, ep.episode)]);
    const btn = el("button", { type: "button", class: "player-episode" }, [
      el("span", { class: "player-episode-num", text: String(ep.episode) }),
      el("div", { class: "player-episode-thumb" }, [
        el("img", { src: ep.poster || entry.poster || "", alt: "", loading: "lazy" }),
        ratio > 0 ? progressBar(ratio) : null
      ]),
      el("div", { class: "player-episode-text" }, [
        el("span", { class: "player-episode-title", text: ep.title }),
        el("span", { class: "player-episode-meta", text: formatDuration(ep.duration) }),
        ep.synopsis ? el("span", { class: "player-episode-synopsis", text: ep.synopsis }) : null
      ])
    ]);
    if (ep === episode) btn.setAttribute("aria-current", "true");
    btn.addEventListener("click", () => {
      if (ep === player.episode){ closePanels(); return; }
      loadItem(entry, ep, { updateUrl: true });
    });
    list.append(el("li", { class: ep === episode ? "is-current" : "" }, [btn]));
  });
}

function renderSettings(){
  const video = $("vaultPlayer");
  const item = currentItem();

  const speedRow = $("playerSpeedOptions");
  speedRow.replaceChildren();
  PLAYER_SPEEDS.forEach(rate => {
    const chip = el("button", {
      type: "button",
      class: "player-chip" + (video.playbackRate === rate ? " is-selected" : ""),
      "aria-pressed": String(video.playbackRate === rate),
      text: rate === 1 ? "Normal" : String(rate).replace(".", ",") + "×"
    });
    chip.addEventListener("click", () => {
      video.playbackRate = rate;
      renderSettings();
    });
    speedRow.append(chip);
  });

  const subs = item.subtitles || [];
  $("playerSubsGroup").hidden = !subs.length;
  const subsRow = $("playerSubsOptions");
  subsRow.replaceChildren();
  if (!subs.length) return;
  const active = Array.from(video.textTracks).find(t => t.mode === "showing");
  const options = [{ lang: "off", label: "Av" }].concat(subs.map(s => ({ lang: s.lang || "sv", label: s.label || s.lang || "Undertexter" })));
  options.forEach(opt => {
    const selected = opt.lang === "off" ? !active : !!active && active.language === opt.lang;
    const chip = el("button", { type: "button", class: "player-chip" + (selected ? " is-selected" : ""), "aria-pressed": String(selected), text: opt.label });
    chip.addEventListener("click", () => {
      Array.from(video.textTracks).forEach(t => { t.mode = t.language === opt.lang ? "showing" : "disabled"; });
      try{ localStorage.setItem(PLAYER_SUBS_KEY, opt.lang); } catch(e){}
      renderSettings();
    });
    subsRow.append(chip);
  });
}

/* ---------- media session (lock screen / hardware keys) ---------- */

function setupMediaSession(){
  if (!("mediaSession" in navigator) || !window.MediaMetadata) return;
  const { entry, episode } = player;
  const art = (episode && episode.poster) || entry.poster;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: episode ? episode.title : entry.title,
    artist: "A+ Studios",
    album: entry.title,
    artwork: art ? [{ src: new URL(art, location.href).href, sizes: "640x360", type: "image/jpeg" }] : []
  });
  const set = (action, fn) => { try{ navigator.mediaSession.setActionHandler(action, fn); } catch(e){} };
  set("play", () => attemptPlay());
  set("pause", () => $("vaultPlayer").pause());
  set("seekbackward", () => seekBy(-10));
  set("seekforward", () => seekBy(10));
  set("seekto", d => { $("vaultPlayer").currentTime = d.seekTime; });
  set("nexttrack", nextEpisode() ? playNext : null);
}

/* ---------- wiring ---------- */

function bindVideoEvents(){
  const video = $("vaultPlayer");
  const root = $("player");
  let spinnerTimer = 0;

  video.addEventListener("loadedmetadata", () => {
    if (player.startAt > 0 && player.startAt < video.duration * VAULT_DONE_RATIO){
      video.currentTime = player.startAt;
    }
    player.ready = true;
    updateIntroMark();
    updateTimeUI();
  });
  video.addEventListener("play", () => {
    root.classList.remove("is-paused");
    $("playerBigPlay").hidden = true;
    $("playerEnd").hidden = true;
    $("playerToggle").setAttribute("aria-label", "Pausa (k)");
    $("playerToggle").title = "Pausa (k)";
    cancelAnimationFrame(player.raf);
    tick();
    setActive();
  });
  video.addEventListener("pause", () => {
    root.classList.add("is-paused");
    $("playerToggle").setAttribute("aria-label", "Spela upp (k)");
    $("playerToggle").title = "Spela upp (k)";
    root.classList.add("is-active");
    saveProgress();
  });
  video.addEventListener("timeupdate", () => {
    if (!player.raf || video.paused) updateTimeUI();
    if (Date.now() - player.lastSave > 4000) saveProgress();
    checkIntro();
    checkNextCard();
  });
  video.addEventListener("progress", updateTimeUI);
  video.addEventListener("seeked", () => { saveProgress(); checkNextCard(); });
  video.addEventListener("waiting", () => {
    clearTimeout(spinnerTimer);
    spinnerTimer = setTimeout(() => { $("playerSpinner").hidden = false; }, 350);
  });
  ["playing", "canplay", "pause"].forEach(type => video.addEventListener(type, () => {
    clearTimeout(spinnerTimer);
    $("playerSpinner").hidden = true;
  }));
  video.addEventListener("ended", () => {
    saveProgress();
    renderEpisodePanel();
    const next = nextEpisode();
    if (next && !player.next.dismissed) playNext();
    else if (next){
      // credits watched to the end: offer the next episode again, counting down
      resetNextCard();
      showNextCard(next);
    } else {
      resetNextCard();
      showEndScreen();
    }
  });
  video.addEventListener("error", () => {
    if (!video.getAttribute("src")) return;
    $("playerErrorTitle").textContent = "Videon kunde inte spelas upp.";
    $("playerError").hidden = false;
  });
  video.addEventListener("ratechange", renderSettings);

  // pointer on the picture: mouse click = play/pause, double-click = fullscreen;
  // touch tap = show/hide controls, double-tap on a side = ±10 s
  video.addEventListener("pointerdown", e => { player.pointerType = e.pointerType; });
  video.addEventListener("click", () => {
    if (player.pointerType === "touch") return;
    if (player.suppressClick){ player.suppressClick = false; return; }
    togglePlay(true);
  });
  video.addEventListener("dblclick", e => {
    if (player.pointerType === "touch") return;
    e.preventDefault();
    toggleFullscreen();
  });
  video.addEventListener("pointerup", e => {
    if (e.pointerType !== "touch") return;
    const r = video.getBoundingClientRect();
    const side = e.clientX < r.left + r.width * 0.35 ? "left" : e.clientX > r.right - r.width * 0.35 ? "right" : "mid";
    const now = Date.now();
    if (now - player.lastTap.t < 300 && side !== "mid" && side === player.lastTap.side){
      seekBy(side === "left" ? -10 : 10, true);
      player.lastTap.t = 0;
      return;
    }
    player.lastTap = { t: now, side: side };
    if (root.classList.contains("is-active") && !video.paused) setInactive();
    else setActive();
  });
}

function bindControls(){
  const root = $("player");
  const video = $("vaultPlayer");

  $("playerToggle").addEventListener("click", () => togglePlay(false));
  $("playerBigPlay").addEventListener("click", () => togglePlay(false));
  root.querySelectorAll("[data-toggle]").forEach(b => b.addEventListener("click", () => togglePlay(false)));
  root.querySelectorAll("[data-seek]").forEach(b => b.addEventListener("click", () => seekBy(Number(b.dataset.seek), false)));
  $("playerFullscreen").addEventListener("click", toggleFullscreen);
  $("playerNextBtn").addEventListener("click", playNext);
  $("playerEpisodesBtn").addEventListener("click", () => togglePanel("playerEpisodes", "playerEpisodesBtn"));
  $("playerSettingsBtn").addEventListener("click", () => {
    renderSettings();  // text tracks may have switched on since the item loaded
    togglePanel("playerSettings", "playerSettingsBtn");
  });
  root.querySelectorAll("[data-panel-close]").forEach(b => b.addEventListener("click", () => { closePanels(); setActive(); }));

  $("playerSkipIntro").addEventListener("click", () => {
    const intro = currentItem().intro;
    if (intro) video.currentTime = intro.end;
    $("playerSkipIntro").hidden = true;
  });
  $("playerNextPlay").addEventListener("click", playNext);
  $("playerNextDismiss").addEventListener("click", () => resetNextCard(true));
  $("playerReplay").addEventListener("click", () => {
    $("playerEnd").hidden = true;
    video.currentTime = 0;
    attemptPlay();
  });

  $("playerBack").addEventListener("click", e => {
    if (!isPlainClick(e)) return;
    saveProgress();
    let fromVault = false;
    try{
      const ref = new URL(document.referrer);
      fromVault = ref.origin === location.origin && /^\/vault(\.html)?\/?$/.test(ref.pathname);
    } catch(err){}
    if (fromVault && history.length > 1){
      e.preventDefault();
      history.back();
    }
  });

  ["pointermove", "pointerdown"].forEach(type => root.addEventListener(type, e => {
    if (e.pointerType === "mouse") setActive();
  }));
  root.addEventListener("mouseleave", setInactive);
  root.querySelectorAll(".player-bottom, .player-top, .player-panel, .player-next").forEach(zone => {
    zone.addEventListener("pointerenter", () => { player.overControls = true; });
    zone.addEventListener("pointerleave", () => { player.overControls = false; setActive(); });
  });

  // clicking outside an open panel closes it
  document.addEventListener("pointerdown", e => {
    if (!anyPanelOpen()) return;
    if (e.target.closest(".player-panel, #playerEpisodesBtn, #playerSettingsBtn")) return;
    closePanels();
    if (e.target === $("vaultPlayer")) player.suppressClick = true;
  });

  document.addEventListener("fullscreenchange", () => root.classList.toggle("is-fullscreen", isFullscreen()));
  document.addEventListener("webkitfullscreenchange", () => root.classList.toggle("is-fullscreen", isFullscreen()));

  window.addEventListener("pagehide", saveProgress);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveProgress(); });
}

function bindKeyboard(){
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    const onControl = t.closest && t.closest("button, a, input");
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

    if (key === "Escape"){
      if (anyPanelOpen()){ closePanels(); setActive(); }
      return;
    }
    if (t.matches && t.matches("input[type=range]") && /^Arrow/.test(key)) return;

    switch (key){
      case " ":
        if (onControl) return;  // let the focused button do its own thing
        e.preventDefault(); togglePlay(true); break;
      case "k": togglePlay(true); break;
      case "ArrowLeft": case "j": e.preventDefault(); seekBy(-10, true); break;
      case "ArrowRight": case "l": e.preventDefault(); seekBy(10, true); break;
      case "ArrowUp": e.preventDefault(); nudgeVolume(0.1); break;
      case "ArrowDown": e.preventDefault(); nudgeVolume(-0.1); break;
      case "m": $("playerMute").click(); setActive(); break;
      case "f": toggleFullscreen(); break;
      case "n": if (nextEpisode()) playNext(); break;
      case "s": if (!$("playerSkipIntro").hidden) $("playerSkipIntro").click(); break;
      case "Home": e.preventDefault(); $("vaultPlayer").currentTime = 0; break;
      case "End": e.preventDefault(); $("vaultPlayer").currentTime = Math.max(0, ($("vaultPlayer").duration || 0) - 1); break;
      default: return;
    }
    setActive();
  });
}

function showPlayerError(message){
  $("playerErrorTitle").textContent = message;
  $("playerError").hidden = false;
  $("player").classList.add("is-active");
}

async function initWatchPage(){
  const manifest = await loadManifest();
  player.manifest = manifest;

  bindVideoEvents();
  bindControls();
  bindKeyboard();
  initScrubber();
  initVolume();

  const params = new URLSearchParams(window.location.search);
  const slug = getSlugFromPath() || params.get("slug");
  const entry = slug && findEntryBySlug(manifest, slug);
  if (!entry){
    document.title = "Hittades inte | A+ Vault";
    showPlayerError("Videon kunde inte hittas.");
    return;
  }

  let episode = null;
  if (entry.type === "series"){
    const num = Number(params.get("ep"));
    episode = entry.episodes.find(ep => ep.episode === num) || resumeTarget(entry).episode;
  }
  const t = params.get("t");
  loadItem(entry, episode, { startAt: t != null && t !== "" && isFinite(t) ? Number(t) : undefined });
}

document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("vaultPlayer")) initWatchPage();
});
