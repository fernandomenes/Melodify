/* ==========================================================================
   Reproductor central — Cola, audio y sidebar
   Playlists de sistema en reproductor-discover.js (MDFDiscover)
   y acciones en reproductor-actions.js.
   ========================================================================== */

import {
  slugify,
  ensureAbs,
  absHref,
  _songKey,
  registerKnownSongs,
  normalizeSong,
  _getUsername,
  _getCurrentUserInfo,
  _extractPlaylistOwner,
  fetchMyMusic,
  fetchMyLikes,
  fetchAllPlaylistsWithSongs,
  fetchFollowedArtistsPlaylists,
  buildPlaylistsModel,
} from "./reproductor-data.js";

// ---------------------------- Helpers básicos ------------------------------
const q = (sel, ctx = document) => ctx.querySelector(sel);
const qa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

function clamp(v, min, max) {
  v = Number(v);
  if (Number.isNaN(v)) v = min;
  return v < min ? min : v > max ? max : v;
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const total = Math.floor(sec);
  const s = total % 60;
  const m = Math.floor(total / 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fire(name, detail) {
  try {
    const ev = new CustomEvent(name, { detail });
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
  } catch {
    /* ignore */
  }
}

// Toast global simple (fallback si no hay mdfToast/_globalToast)
function _toast(message) {
  if (!message) return;

  if (typeof window !== "undefined") {
    if (typeof window.mdfToast === "function") {
      window.mdfToast(message);
      return;
    }
    if (typeof window._globalToast === "function") {
      window._globalToast(message);
      return;
    }
  }

  let bar = document.querySelector(".mdf-toast-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.className = "mdf-toast-bar";
    Object.assign(bar.style, {
      position: "fixed",
      left: "50%",
      bottom: "16px",
      transform: "translateX(-50%)",
      background: "#222",
      color: "#fff",
      padding: "8px 14px",
      borderRadius: "999px",
      fontSize: "0.85rem",
      zIndex: "9999",
      boxShadow: "0 4px 16px rgba(0,0,0,.6)",
      opacity: "0",
      pointerEvents: "none",
      transition: "opacity .2s ease",
      maxWidth: "80vw",
      textAlign: "center",
      whiteSpace: "nowrap",
      textOverflow: "ellipsis",
      overflow: "hidden",
    });
    document.body.appendChild(bar);
  }

  bar.textContent = message;
  bar.style.opacity = "1";

  clearTimeout(bar._hideTimer);
  bar._hideTimer = setTimeout(() => {
    bar.style.opacity = "0";
  }, 2300);
}

// Exponer en window para scripts sin módulos
window._toast = _toast;

// Actualiza barra inferior del reproductor si existe
function fireBar() {
  try {
    if (window.MDFBar && typeof window.MDFBar.refresh === "function") {
      window.MDFBar.refresh();
    }
  } catch {
    /* ignore */
  }
}

const COUNT_AT_SECONDS = 5;

// ---------------------------- Estado interno -------------------------------
let _state = {
  queue: [],
  index: -1,
  audio: null,
  boundItems: new Set(),
  guardHooked: false,
  moView: null,
  moList: null,
  countedForKey: null,
};

// ---------------------------- Vistas / roles -------------------------------
function _currentSong() {
  return _state.queue[_state.index] || null;
}

function isArtistUser() {
  const main = document.getElementById("main-content");
  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const role = norm(main?.dataset.role || "");
  if (role.includes("artista")) return true;

  const v =
    main?.dataset.isArtist ??
    window.__IS_ARTIST__ ??
    document.querySelector('meta[name="is-artist"]')?.content ??
    "";
  const s = norm(v);
  return s === "1" || s === "true";
}

function isPlayableView() {
  const PLAYABLE_VIEWS = new Set(["reproductor", "playlist", "home"]);
  const m = document.getElementById("main-content");
  const v = (m?.dataset.view || m?.dataset.initialView || "").trim();
  return PLAYABLE_VIEWS.has(v);
}

function getCurrentView() {
  const m = document.getElementById("main-content");
  return (m?.dataset.view || m?.dataset.initialView || "").trim();
}

// ---------------------------- Normalización / keys -------------------------
function _isSongLiked(song) {
  const key = _songKey(song);
  if (!key) return false;
  const likes = Array.isArray(window._likes) ? window._likes : [];
  return likes.some((s) => _songKey(s) === key);
}

function _esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, '&quot;');
}

// ---------------------------- Render filas (lista izquierda) --------------
function _playlistSongRow(
  song,
  {
    countsMode = null,
    countsStamp = null, // compat
    weeklyAgg = null, // compat
    showLikeBtn = true,
    showHistoryTime = false,
    playlistId = null,
    allowRemoveFromPlaylist = false,
  } = {}
) {
  const isStr = typeof song === "string";
  const title = isStr ? song : song?.title || "—";
  const author = isStr
    ? "—"
    : song?.author || song?.artist_display_name || song?.artist || "—";
  const cover = isStr
    ? null
    : ensureAbs(song?.coverUrl || song?.cover_url || song?.cover || "");
  const audio = isStr
    ? ""
    : ensureAbs(song?.audioUrl || song?.audio_url || song?.audio || "");
  const genre = !isStr ? song?.genre || song?.genero || "" : "";
  const skey = _songKey(song);
  const idAttr = song && song.id != null ? String(song.id) : "";

  // Badges de reproducciones (rellenados por MDFDiscover)
  let playsBadge = "";
  if (
    countsMode === "daily" &&
    window.MDFDiscover &&
    typeof window.MDFDiscover.getTodayCount === "function"
  ) {
    const plays = window.MDFDiscover.getTodayCount(song);
    playsBadge = `<span class="rep-badge" data-badge="plays" data-skey="${_esc(
      skey
    )}" data-scope="day">${plays}</span>`;
  } else if (
    countsMode === "weekly" &&
    window.MDFDiscover &&
    typeof window.MDFDiscover.getWeeklyPlayCount === "function"
  ) {
    const plays = window.MDFDiscover.getWeeklyPlayCount(song, true);
    playsBadge = `<span class="rep-badge" data-badge="plays" data-skey="${_esc(
      skey
    )}" data-scope="week">${plays}</span>`;
  }

  const coverHTML = cover
    ? `<img src="${_esc(cover)}" alt="${_esc(title)}" class="song-cover">`
    : `<div class="song-cover song-cover--placeholder"></div>`;

  const liked = showLikeBtn ? _isSongLiked(song) : false;

  let likeHTML = "";
  let addHTML = "";
  let removeHTML = "";

  if (showLikeBtn && idAttr) {
    likeHTML = `
      <button type="button"
              class="song-like-btn ${liked ? "is-liked" : ""}"
              data-song-id="${_esc(idAttr)}"
              data-skey="${_esc(skey)}"
              onclick="
                event.preventDefault();
                event.stopPropagation();
                if (window.MDFCore && typeof window.MDFCore.toggleLikeFromReproductor === 'function') {
                  window.MDFCore.toggleLikeFromReproductor(event, '${_esc(
                    idAttr
                  )}');
                } else if (window._toast) {
                  window._toast('Acción de like no disponible.');
                }
              ">
        ${liked ? "♥" : "♡"}
      </button>`;
  }

  // Botón para añadir a playlist (lista izquierda)
  if (showLikeBtn && idAttr) {
    addHTML = `
      <button type="button"
              class="song-add-btn"
              data-song-id="${_esc(idAttr)}"
              data-skey="${_esc(skey)}"
              title="Añadir a playlist"
              onclick="
                event.preventDefault();
                event.stopPropagation();
                if (window.MDFCore && typeof window.MDFCore.openAddToPlaylistDialog === 'function') {
                  window.MDFCore.openAddToPlaylistDialog(event, '${_esc(
                    idAttr
                  )}');
                } else if (typeof window.openAddToPlaylistForSong === 'function') {
                  window.openAddToPlaylistForSong('${_esc(idAttr)}');
                } else if (window._toast) {
                  window._toast('No se encontró la UI para agregar a playlist.');
                }
              ">
        +
      </button>`;
  }

  // Botón para quitar de la playlist actual (si aplica)
  if (allowRemoveFromPlaylist && playlistId && idAttr) {
    removeHTML = `
      <button type="button"
              class="song-add-btn song-remove-btn"
              data-song-id="${_esc(idAttr)}"
              data-playlist-id="${_esc(playlistId)}"
              title="Quitar de esta playlist"
              onclick="
                event.preventDefault();
                event.stopPropagation();
                if (window.MDFCore && typeof window.MDFCore.removeSongFromCurrentPlaylist === 'function') {
                  window.MDFCore.removeSongFromCurrentPlaylist('${_esc(
                    idAttr
                  )}', '${_esc(playlistId)}');
                }
              ">
        −
      </button>`;
  }

  // Historial: sólo marcamos data-history-ts y un span vacío
  let historyHTML = "";
  let historyTsAttr = "";
  if (showHistoryTime && !isStr) {
    const ts =
      song._historyTs || song.historyTs || song.ts || song.played_at || null;
    if (ts) {
      historyTsAttr = String(ts);
      historyHTML = ` <span class="song-history-time"></span>`;
    }
  }
  const historyAttrPart = historyTsAttr
    ? ` data-history-ts="${_esc(historyTsAttr)}"`
    : "";

  return `
    <div class="song-item"
         data-id="${_esc(idAttr)}"
         data-audio-url="${_esc(audio)}"
         data-title="${_esc(title)}"
         data-author="${_esc(author)}"
         data-genre="${_esc(genre)}"
         data-skey="${_esc(skey)}"${historyAttrPart}>
      ${coverHTML}
      <div class="song-info">
        <div class="song-title">
          ${_esc(title)} ${playsBadge}
          ${likeHTML}
          ${addHTML}
          ${removeHTML}
        </div>
        <div class="song-author">${_esc(author)}${historyHTML}</div>
      </div>
    </div>`;
}

export function renderLeftSongs(songs, titleForEmpty = "Playlist", opts = {}) {
  const {
    countsMode = null,
    countsStamp = null,
    weeklyAgg = null,
    showLikeBtn = true,
    showHistoryTime = false,
    playlistId = null,
    allowRemoveFromPlaylist = false,
    allowAddToPlaylist = false,
    backRoot = null,
    playlistRemoveSongUrlTemplate = null,
  } = opts;

  const left = q(".rep-left");
  if (!left) return;

  if (playlistId) {
    left.dataset.currentPlaylist = String(playlistId);
  } else {
    left.removeAttribute("data-current-playlist");
  }

  if (playlistRemoveSongUrlTemplate) {
    left.dataset.removeSongUrlTemplate = String(playlistRemoveSongUrlTemplate);
  } else {
    left.removeAttribute("data-remove-song-url-template");
  }

  const rootId =
    backRoot === "my"
      ? MY_ROOT_ID
      : backRoot === "public"
      ? PUBLIC_ROOT_ID
      : backRoot === "followed"
      ? FOLLOWED_ROOT_ID
      : window.__MDF_CURRENT_PL_ROOT || "";

  let backLabel = "";
  if (rootId === MY_ROOT_ID) backLabel = "Tus playlists";
  else if (rootId === PUBLIC_ROOT_ID) backLabel = "Playlists públicas";
  else if (rootId === FOLLOWED_ROOT_ID) backLabel = "Artistas que sigues";

  const hasBack = !!backLabel;

  const backChipHTML = hasBack
    ? `
      <button type="button"
              class="rep-pl-root-back"
              style="
                border-radius:999px;
                border:1px solid var(--line,#333);
                background:#181818;
                padding:4px 12px;
                font-size:12px;
                display:inline-flex;
                align-items:center;
                gap:6px;
                cursor:pointer;
                color:inherit;
              "
              data-root="${_esc(rootId)}"
              onclick="
                event.preventDefault();
                event.stopPropagation();
                if (window.MDFCore && typeof window.MDFCore.backToPlaylistRoot === 'function') {
                  window.MDFCore.backToPlaylistRoot('${_esc(rootId)}');
                }
              ">
        <span style="font-size:14px;line-height:1">←</span>
        <span>${_esc(backLabel)}</span>
      </button>`
    : "";

  const addBtnHTML =
    allowAddToPlaylist && playlistId
      ? `
      <div class="rep-addsongs-inline">
        <button type="button"
                class="rep-addsongs-btn"
                onclick="
                  if (window.MDFCore && typeof window.MDFCore.openAddSongsDialogForPlaylist === 'function') {
                    window.MDFCore.openAddSongsDialogForPlaylist('${_esc(
                      playlistId
                    )}');
                  }
                ">
          + Agregar canciones
        </button>
      </div>`
      : "";

  const headerHTML =
    backChipHTML || addBtnHTML
      ? `
      <div class="rep-pl-inline-header"
           style="
             display:flex;
             align-items:center;
             justify-content:space-between;
             margin-bottom:8px;
             gap:12px;
           ">
        <div class="rep-pl-inline-left">
          ${backChipHTML}
        </div>
        <div class="rep-pl-inline-right">
          ${addBtnHTML}
        </div>
      </div>`
      : "";

  if (!songs || !songs.length) {
    left.innerHTML = `
      ${headerHTML}
      <div class="rep-empty">
        <div>
          <h3 style="margin:0">${_esc(titleForEmpty)}</h3>
          <p>No hay canciones.</p>
          ${
            !addBtnHTML && allowAddToPlaylist && playlistId
              ? `
          <div class="rep-addsongs-inline">
            <button type="button"
                    class="rep-addsongs-btn"
                    onclick="
                      if (window.MDFCore && typeof window.MDFCore.openAddSongsDialogForPlaylist === 'function') {
                        window.MDFCore.openAddSongsDialogForPlaylist('${_esc(
                          playlistId
                        )}');
                      }
                    ">
              + Agregar canciones
            </button>
          </div>`
              : ""
          }
        </div>
      </div>`;
  } else {
    const rows = songs
      .map((s) =>
        _playlistSongRow(s, {
          countsMode,
          countsStamp,
          weeklyAgg,
          showLikeBtn,
          showHistoryTime,
          playlistId,
          allowRemoveFromPlaylist,
        })
      )
      .join("");

    left.innerHTML = `
      ${headerHTML}
      <div class="songs-wrap">
        ${rows}
      </div>`;
  }

  try {
    inicializarReproductor();
  } catch {
    /* ignore */
  }
}

// ---------------------------- Audio core -----------------------------------
function setMetaFor(song) {
  const meta = {
    title: song?.title || "—",
    artist: song?.author || song?.artist_display_name || song?.artist || "—",
    cover: ensureAbs(song?.coverUrl || song?.cover_url || song?.cover || ""),
    genre: song?.genre || song?.genero || "",
  };
  fire("melodify:trackmeta", meta);
}

function ensureAudio() {
  if (_state.audio) return;
  const a = new Audio();
  a.preload = "metadata";

  a.addEventListener("timeupdate", () => {
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    const cur = Number.isFinite(a.currentTime) ? a.currentTime : 0;

    fire("melodify:time", {
      currentTime: cur,
      duration: dur,
      label: `${fmtTime(cur)} / ${fmtTime(dur)}`,
    });

    const s = _currentSong();
    const k = s ? _songKey(s) : null;

    if (s && k && _state.countedForKey !== k && cur >= COUNT_AT_SECONDS) {
      if (
        window.MDFDiscover &&
        typeof window.MDFDiscover.registerPlay === "function"
      ) {
        window.MDFDiscover.registerPlay(s);
      }
      _state.countedForKey = k;
    }
  });

  a.addEventListener("loadedmetadata", () => {
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    fire("melodify:loaded", { duration: dur });
  });
  a.addEventListener("play", () => {
    fire("melodify:state", { playing: true, paused: false });
  });
  a.addEventListener("pause", () => {
    fire("melodify:state", { playing: false, paused: true });
  });
  a.addEventListener("ended", () => {
    fire("melodify:ended", {});
    next();
  });

  _state.audio = a;
  fire("melodify:audioReady", { audio: a });
}

function load(idx, autoplay = true) {
  ensureAudio();
  idx = Number(idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= _state.queue.length) return;
  _state.index = idx;

  const s = _state.queue[idx];
  const url = ensureAbs(s.audioUrl || s.audio_url || s.audio || "");
  if (!url) return;

  setMetaFor(s);
  _state.audio.src = url;
  _state.audio.currentTime = 0;
  _state.countedForKey = null;
  highlightCurrent();

  fire("melodify:trackchange", { index: idx, song: s });
  if (autoplay) _state.audio.play().catch(() => {});
  fireBar();
}

function toggle() {
  if (!_state.audio || !_state.audio.src) return;
  if (_state.audio.paused) _state.audio.play().catch(() => {});
  else _state.audio.pause();
}

function prev() {
  if (_state.queue.length === 0) return;
  const i = _state.index > 0 ? _state.index - 1 : _state.queue.length - 1;
  load(i, true);
}

function next() {
  if (_state.queue.length === 0) return;
  const i = (_state.index + 1) % _state.queue.length;
  load(i, true);
}

// ---------------------------- Queue / binding ------------------------------
function clearRowHighlight() {
  qa(".song-item.is-playing").forEach((el) =>
    el.classList.remove("is-playing")
  );
}

function highlightCurrent() {
  clearRowHighlight();
  const n = q(`.song-item[data-_idx="${_state.index}"]`);
  if (n) n.classList.add("is-playing");
}

function collectQueueFromDOM({ retainIfEmpty = true } = {}) {
  const items = qa(".song-item,[data-audio-url]");
  const curHref = absHref(_state.audio?.src || "");
  const nextQueue = [];
  let k = 0;

  items.forEach((el) => {
    const id = el.dataset.id || el.getAttribute("data-id") || null;
    const title =
      el.dataset.title ||
      el.getAttribute("data-title") ||
      el.querySelector(".song-title")?.textContent ||
      "—";
    const author =
      el.dataset.author ||
      el.getAttribute("data-author") ||
      el.dataset.artist ||
      el.getAttribute("data-artist") ||
      el.querySelector(".song-author")?.textContent ||
      "—";
    const coverUrl = ensureAbs(
      el.dataset.coverUrl ||
        el.getAttribute("data-cover-url") ||
        el.querySelector(".song-cover")?.getAttribute("src") ||
        ""
    );
    const audioUrl = ensureAbs(
      el.dataset.audioUrl || el.getAttribute("data-audio-url") || ""
    );
    const genre = el.dataset.genre || el.getAttribute("data-genre") || "";

    if (audioUrl) {
      nextQueue.push({ id, title, author, coverUrl, audioUrl, genre });
      el.dataset._idx = String(k++);
      if (!el.classList.contains("song-item")) el.classList.add("song-item");
      const img = el.querySelector(".song-cover");
      if (img && coverUrl) img.src = coverUrl;
    } else {
      el.removeAttribute("data-_idx");
    }
  });

  if (nextQueue.length === 0 && retainIfEmpty) return;
  registerKnownSongs(nextQueue);

  const prevQueue = _state.queue;
  const prevIndex = _state.index;

  _state.queue = nextQueue;

  if (nextQueue.length > 0) {
    const want = curHref
      ? _state.queue.findIndex(
          (s) => absHref(ensureAbs(s.audioUrl)) === curHref
        )
      : -1;
    if (want !== -1) _state.index = want;
    else if (
      prevQueue === nextQueue &&
      prevIndex >= 0 &&
      prevIndex < nextQueue.length
    ) {
      _state.index = prevIndex;
    } else if (_state.index < 0) {
      _state.index = 0;
    }
  }

  highlightCurrent();
}

function bindClicks(enable) {
  _state.boundItems.forEach((el) => (el.onclick = null));
  _state.boundItems.clear();
  if (!enable) return;

  qa(".song-item").forEach((el) => {
    el.onclick = (ev) => {
      // Ignora clicks en botones internos
      if (
        ev &&
        ev.target &&
        ev.target.closest &&
        ev.target.closest(".song-like-btn, .song-add-btn, .song-remove-btn")
      ) {
        return;
      }

      const idx = Number(el.dataset._idx ?? -1);
      if (idx < 0) return;
      const wants = _state.queue[idx];
      const nextH = absHref(ensureAbs(wants?.audioUrl || ""));
      const curH = absHref(_state.audio?.src || "");
      if (idx === _state.index && nextH && curH && nextH === curH) {
        toggle();
      } else {
        load(idx, true);
      }
    };
    _state.boundItems.add(el);
  });
}

function observeListChanges() {
  const host = document.getElementById("content") || document.body;
  if (_state.moList) {
    _state.moList.disconnect();
    _state.moList = null;
  }
  _state.moList = new MutationObserver((muts) => {
    let touched = false;
    for (const m of muts) {
      if (
        m.type === "childList" ||
        (m.type === "attributes" &&
          m.target instanceof HTMLElement &&
          m.target.hasAttribute("data-audio-url"))
      ) {
        touched = true;
        break;
      }
    }
    if (touched) {
      if (!isPlayableView()) return;
      const hadSrc = !!_state.audio?.src;
      collectQueueFromDOM();
      bindClicks(isPlayableView());
      if (hadSrc) fireBar();
    }
  });
  _state.moList.observe(host, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "data-audio-url",
      "data-id",
      "data-title",
      "data-author",
      "data-genre",
      "data-cover-url",
    ],
  });
}

function playFromDomItem(card) {
  if (!card || !(card instanceof HTMLElement)) return;

  ensureAudio();

  const audioUrl = ensureAbs(
    card.dataset.audioUrl || card.getAttribute("data-audio-url") || ""
  );
  if (!audioUrl) return;

  const targetHref = absHref(audioUrl);

  collectQueueFromDOM({ retainIfEmpty: false });

  let idx = -1;

  if (Array.isArray(_state.queue) && _state.queue.length) {
    idx = _state.queue.findIndex(
      (s) =>
        absHref(
          ensureAbs(s.audioUrl || s.audio_url || s.audio || "")
        ) === targetHref
    );
  }

  if (idx === -1) {
    const id = card.dataset.id || card.getAttribute("data-id") || null;
    const title =
      card.dataset.title ||
      card.getAttribute("data-title") ||
      card.querySelector(".song-title")?.textContent ||
      "—";
    const author =
      card.dataset.author ||
      card.getAttribute("data-author") ||
      card.dataset.artist ||
      card.getAttribute("data-artist") ||
      card.querySelector(".song-author")?.textContent ||
      "—";
    const coverUrl = ensureAbs(
      card.dataset.coverUrl ||
        card.getAttribute("data-cover-url") ||
        card.querySelector(".song-cover")?.getAttribute("src") ||
        ""
    );
    const genre = card.dataset.genre || card.getAttribute("data-genre") || "";

    const track = { id, title, author, coverUrl, audioUrl, genre };

    if (!Array.isArray(_state.queue)) {
      _state.queue = [];
    }
    _state.queue.push(track);
    idx = _state.queue.length - 1;

    card.dataset._idx = String(idx);
    card.classList.add("song-item");
  }

  load(idx, true);
}

// ---------------------------- Vistas / guards ------------------------------
function hookViewGuard() {
  if (_state.guardHooked) return;
  _state.guardHooked = true;
  const main = document.getElementById("main-content");
  if (!main) return;

  const apply = () => {
    const playable = isPlayableView();
    if (playable) {
      collectQueueFromDOM({ retainIfEmpty: true });
      bindClicks(true);
      observeListChanges();
    } else {
      bindClicks(false);
      observeListChanges();
    }
  };
  apply();
  if (_state.moView) _state.moView.disconnect();
  _state.moView = new MutationObserver(apply);
  _state.moView.observe(main, {
    attributes: true,
    attributeFilter: ["data-view"],
  });
}

function playExternalSong(audioUrl, title, artist, coverUrl) {
  if (!audioUrl) return;

  try {
    const absTarget = new URL(audioUrl, window.location.origin).href;
    let idx = -1;

    for (let i = 0; i < _state.queue.length; i++) {
      const qUrl = _state.queue[i]?.audioUrl
        ? new URL(_state.queue[i].audioUrl, window.location.origin).href
        : "";
      if (qUrl === absTarget) {
        idx = i;
        break;
      }
    }

    if (idx === -1) {
      const track = {
        id: null,
        title: title || "Sin título",
        author: artist || "",
        artist_display_name: artist || "",
        artist: artist || "",
        audioUrl,
        coverUrl: coverUrl || "",
        fromSearch: true,
      };
      _state.queue.push(track);
      idx = _state.queue.length - 1;

      try {
        if (typeof renderQueue === "function") {
          renderQueue();
        }
      } catch {
        /* ignore */
      }
    }

    load(idx, true);
  } catch (err) {
    console.warn("playExternalSong falló:", err);
  }
}

// ---------------------------- API global -----------------------------------
const MDFCoreExports = {
  getAudio() {
    ensureAudio();
    return _state.audio;
  },
  getQueue() {
    return _state.queue.slice();
  },
  getIndex() {
    return _state.index;
  },
  load: (idx, autoplay = true) => load(idx, autoplay),
  toggle: () => toggle(),
  prev: () => prev(),
  next: () => next(),
  playExternalSong,
  playFromDomItem: (card) => playFromDomItem(card),

  seekPercent: (p01) => {
    ensureAudio();
    const a = _state.audio;
    if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
    const pct = clamp(Number(p01) || 0, 0, 1);
    a.currentTime = Math.max(
      0,
      Math.min(a.duration * pct, a.duration - 0.25)
    );
  },

  setVolume: (v) => {
    ensureAudio();
    _state.audio.volume = clamp(Number(v) || 0, 0, 1);
  },

  // Para otros módulos
  renderLeftSongs: (songs, title, opts) =>
    renderLeftSongs(songs, title, opts),

  toggleLikeFromReproductor: (evt, idSongRaw) =>
    _toggleLikeFromReproductor(evt, idSongRaw),

  // Likes: actualiza el modelo local; MDFActions puede engancharse si quiere
  syncLikeModelFromClient: (idSong, liked, meta) => {
    const result = _syncLikeModelFromClient(idSong, liked, meta);

    if (
      window.MDFActions &&
      typeof window.MDFActions.syncLikeModelFromClient === "function"
    ) {
      try {
        window.MDFActions.syncLikeModelFromClient(idSong, liked, meta);
      } catch (e) {
        console.warn("MDFActions.syncLikeModelFromClient falló", e);
      }
    }

    return result;
  },

  // Playlists (mutaciones desde la UI)
  removeSongFromCurrentPlaylist: async (idSong, playlistId) => {
    if (
      window.MDFActions &&
      typeof window.MDFActions.removeSongFromCurrentPlaylist === "function"
    ) {
      const result =
        await window.MDFActions.removeSongFromCurrentPlaylist(
          idSong,
          playlistId
        );
      try {
        _dispatchPlaylistsChanged({
          type: "remove-song",
          playlistId,
          songId: idSong,
          source: "MDFActions",
        });
      } catch (e) {
        console.warn("playlists:changed (remove-song) falló", e);
      }
      return result;
    }
    return _removeSongFromCurrentPlaylist(idSong, playlistId);
  },

  togglePlaylistVisibility: async (playlistId) => {
    if (
      window.MDFActions &&
      typeof window.MDFActions.togglePlaylistVisibility === "function"
    ) {
      const result =
        await window.MDFActions.togglePlaylistVisibility(playlistId);
      try {
        _dispatchPlaylistsChanged({
          type: "toggle-visibility",
          playlistId,
          source: "MDFActions",
        });
      } catch (e) {
        console.warn("playlists:changed (toggle-visibility) falló", e);
      }
      return result;
    }
    return _togglePlaylistVisibility(playlistId);
  },

  deletePlaylist: async (playlistId) => {
    if (
      window.MDFActions &&
      typeof window.MDFActions.deletePlaylist === "function"
    ) {
      const result = await window.MDFActions.deletePlaylist(playlistId);
      try {
        _dispatchPlaylistsChanged({
          type: "delete",
          playlistId,
          source: "MDFActions",
        });
      } catch (e) {
        console.warn("playlists:changed (delete) falló", e);
      }
      return result;
    }
    return _deletePlaylist(playlistId);
  },

  backToPlaylistRoot: (rootId) => _backToPlaylistRoot(rootId),

  openAddToPlaylistDialog: (evt, idSong) => {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }

    const sid = String(idSong || "").trim();
    if (!sid) {
      console.warn("MDFCore.openAddToPlaylistDialog: idSong vacío:", idSong);
      return;
    }

    // UI moderna (reproductor-playlists.js)
    if (
      window.MDFPlaylists &&
      typeof window.MDFPlaylists.openAddToPlaylistDialog === "function"
    ) {
      window.MDFPlaylists.openAddToPlaylistDialog(evt, sid);
      return;
    }

    // Fallback histórico
    if (typeof window.openAddToPlaylistForSong === "function") {
      window.openAddToPlaylistForSong(sid);
      return;
    }

    alert("No se encontró la UI para agregar a playlist.");
  },

  // Botón "+ Agregar canciones" dentro de la playlist
  openAddSongsDialogForPlaylist: (playlistId) =>
    _openAddSongsDialogForPlaylist(playlistId),

  rebindReproductor: () => rebindReproductor(),
};

// Mezcla con lo que ya exista (por ejemplo reproductor-actions.js)
window.MDFCore = Object.assign(window.MDFCore || {}, MDFCoreExports);

// ---------------------------- Sidebar / UI ---------------------------------
export const DEFAULT_GENRES = [
  { value: "pop", label: "Pop" },
  { value: "rock", label: "Rock" },
  { value: "electronica", label: "Electrónica" },
  { value: "salsa", label: "Salsa" },
  { value: "indie", label: "Indie" },
  { value: "hiphop", label: "Hip-Hop" },
  { value: "reggaeton", label: "Reguetón" },
  { value: "regional", label: "Regional Mexicano" },
  { value: "balada", label: "Balada" },
  { value: "jazz", label: "Jazz" },
  { value: "clasica", label: "Clásica" },
  { value: "otro", label: "Otro" },
];

// Nodos raíz para agrupar playlists
const PUBLIC_ROOT_ID = "pl:public-root"; // Playlists públicas
const MY_ROOT_ID = "pl:my-root"; // Playlists propias
const FOLLOWED_ROOT_ID = "pl:followed-root"; // "Artistas que sigues"

// IDs reservados del sistema
const SYSTEM_PLAYLIST_IDS = new Set([
  "pl:all",
  "pl:mine",
  "pl:likes",
  "pl:top10",
  "pl:discover",
  "pl:history",
]);

function splitPlaylistsForSidebar(allPlaylists) {
  const info =
    typeof _getCurrentUserInfo === "function"
      ? _getCurrentUserInfo()
      : {
          username:
            (typeof _getUsername === "function" ? _getUsername() : "") + "",
          userId: "",
        };

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const currentNorm = norm(info.username || "");
  const currentId = (info.userId || "").trim();

  const system = [];
  const mine = [];
  const publics = [];

  (allPlaylists || []).forEach((pl) => {
    if (!pl || !pl.id) return;
    const id = String(pl.id);

    if (SYSTEM_PLAYLIST_IDS.has(id)) {
      system.push({ ...pl, isMine: false });
      return;
    }

    const ownerInfo = _extractPlaylistOwner(pl) || {};
    const ownerName = ownerInfo.ownerName || "";
    const ownerId = ownerInfo.ownerId || "";
    const ownerNorm = norm(ownerName);

    const isPrivate = pl.isprivate === true || pl.is_private === true;
    const explicitIsMine = typeof pl.isMine === "boolean" ? pl.isMine : null;

    let isMine = false;

    if (explicitIsMine !== null) {
      isMine = explicitIsMine;
    } else {
      const sameByName =
        currentNorm && ownerNorm ? currentNorm === ownerNorm : false;
      const sameById =
        currentId && ownerId ? String(currentId) === String(ownerId) : false;
      isMine = sameByName || sameById;
    }

    if (!isMine && isPrivate) {
      return;
    }

    if (isMine) {
      mine.push({
        ...pl,
        isMine: true,
        owner: ownerName,
        idUser: ownerId,
        user_id: ownerId,
      });
    }

    if (!isPrivate) {
      publics.push({
        ...pl,
        isMine,
        owner: ownerName,
        idUser: ownerId,
        user_id: ownerId,
        isprivate: false,
        is_private: false,
      });
    }
  });

  return { system, mine, publics };
}

// Sólo candado en playlists propias (no sistema / no públicas)
function canToggleVisibility(pl) {
  if (!pl) return false;

  const id = String(pl.id || "");

  if (SYSTEM_PLAYLIST_IDS.has(id) || id === PUBLIC_ROOT_ID) {
    return false;
  }

  if (!/^pl:\d+$/.test(id)) return false;

  if (pl.isMine === true) return true;
  if (pl.isMine === false) return false;

  const info =
    typeof _getCurrentUserInfo === "function"
      ? _getCurrentUserInfo()
      : { username: "", userId: "" };

  const curName = (info.username || "").trim();
  const curId = (info.userId || "").trim();

  const owner = _extractPlaylistOwner(pl) || {};
  const ownName = (owner.ownerName || "").trim();
  const ownId = (owner.ownerId || "").trim();

  const norm = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  const sameByName =
    curName && ownName ? norm(curName) === norm(ownName) : false;
  const sameById = curId && ownId ? String(curId) === String(ownId) : false;

  return sameByName || sameById;
}

export function buildRightSidebarHTML({
  playlists,
  genres = DEFAULT_GENRES,
  followedArtists = [],
}) {
  let P = Array.isArray(playlists) ? playlists.slice() : [];

  if (
    window.MDFDiscover &&
    typeof window.MDFDiscover.prepareSystemPlaylists === "function"
  ) {
    try {
      P = window.MDFDiscover.prepareSystemPlaylists(P, {
        likes: Array.isArray(window._likes) ? window._likes : [],
      });
    } catch (e) {
      console.warn("prepareSystemPlaylists falló", e);
    }
  }

  const { system, mine, publics } = splitPlaylistsForSidebar(P);

  window.__MDF_PUBLIC_PLAYLISTS__ = publics.slice();
  window.__MDF_MY_PLAYLISTS__ = mine.slice();
  window.__MDF_FOLLOWED_PLAYLISTS__ = Array.isArray(followedArtists)
    ? followedArtists.slice()
    : [];

  const hasFollowed = window.__MDF_FOLLOWED_PLAYLISTS__.length > 0;

  const liParts = [];

  // Playlists de sistema
  system.forEach((pl) => {
    const songs = Array.isArray(pl.songs) ? pl.songs : [];
    const label =
      pl.id === "pl:top10"
        ? "Top 10 personal"
        : pl.id === "pl:discover"
        ? "Discover Weekly"
        : pl.id === "pl:history"
        ? "Historial"
        : pl.id === "pl:likes"
        ? "Music that i love"
        : pl.id === "pl:mine"
        ? "Mi música"
        : pl.id === "pl:all"
        ? "Todas tus canciones"
        : pl.name || "Playlist";

    const canT = canToggleVisibility(pl);
    const isPrivate = pl.isprivate === true || pl.is_private === true;

    const lockHTML = canT
      ? `
        <button type="button"
                class="rep-pl-lock"
                data-pl="${_esc(pl.id)}"
                data-private="${isPrivate ? "1" : "0"}"
                title="${
                  isPrivate
                    ? "Solo tú puedes ver esta playlist"
                    : "Visible para todos los usuarios"
                }"
                onclick="
                  event.preventDefault();
                  event.stopPropagation();
                  if (window.MDFCore && typeof window.MDFCore.togglePlaylistVisibility === 'function') {
                    window.MDFCore.togglePlaylistVisibility('${_esc(
                      pl.id
                    )}');
                  }
                ">
          ${isPrivate ? "🔒" : "🔓"}
        </button>`
      : "";

    const deleteHTML = canT
      ? `
        <button type="button"
                class="rep-pl-delete"
                data-pl="${_esc(pl.id)}"
                title="Eliminar esta playlist"
                onclick="
                  event.preventDefault();
                  event.stopPropagation();
                  if (window.MDFCore && typeof window.MDFCore.deletePlaylist === 'function') {
                    window.MDFCore.deletePlaylist('${_esc(pl.id)}');
                  }
                ">
          🗑
        </button>`
      : "";

    liParts.push(`
      <li data-pl="${_esc(pl.id)}"
          style="display:flex;align-items:center;gap:10px;background:#181818;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0;cursor:pointer">
        <span style="flex:1">${_esc(label)}</span>
        ${lockHTML}
        ${deleteHTML}
        <span class="rep-badge">${songs.length}</span>
      </li>`);
  });

  // Nodo "Tus playlists"
  if (mine.length > 0) {
    const totalSongs = mine.reduce(
      (acc, pl) =>
        acc + (Array.isArray(pl.songs) ? pl.songs.length : 0),
      0
    );

    liParts.push(`
      <li data-pl="${_esc(MY_ROOT_ID)}"
          class="rep-pl-my-root"
          style="display:flex;align-items:center;gap:10px;background:#181818;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0;cursor:pointer">
        <span style="flex:1">Tus playlists</span>
        <span class="rep-badge">${totalSongs}</span>
      </li>`);
  }

  // Nodo "Playlists públicas"
  if (publics.length > 0) {
    liParts.push(`
      <li data-pl="${_esc(PUBLIC_ROOT_ID)}"
          class="rep-pl-public-root"
          style="display:flex;align-items:center;gap:10px;background:#181818;border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:6px 0;cursor:pointer">
        <span style="flex:1">Playlists públicas</span>
        <span class="rep-badge">${publics.length}</span>
      </li>`);
  }

  // Nodo "Artistas que sigues"
  if (hasFollowed) {
    liParts.push(`
      <li data-pl="${_esc(FOLLOWED_ROOT_ID)}"
          class="rep-pl-followed-root"
          style="display:flex;align-items:center;gap:10px;
                 background:#181818;border:1px solid var(--line);
                 border-radius:8px;padding:8px 10px;margin:6px 0;
                 cursor:pointer">
        <span style="flex:1">Artistas que sigues</span>
        <span class="rep-badge">${window.__MDF_FOLLOWED_PLAYLISTS__.length}</span>
      </li>`);
  }

  const liHTML = liParts.join("");

  const playlistsHTML = `
    <div class="rep-panel">
      <div class="rep-head" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <h3 style="margin:0">Playlists</h3>
        <button id="rep-add-playlist-btn"
                type="button"
                class="rep-add-playlist-btn">
          + Nueva
        </button>
      </div>
      <ul id="rep-playlists" class="rep-list" style="list-style:none;margin:0;padding:0">
        ${
          liHTML ||
          '<li class="muted" style="padding:8px 10px;">(sin playlists)</li>'
        }
      </ul>
    </div>`;

  const chipsHTML = (genres || [])
    .map(
      (g) =>
        `<span class="rep-chip" data-genre="${_esc(
          g.value
        )}">${_esc(g.label)}</span>`
    )
    .join("");

  const genresHTML = `
    <div class="rep-panel">
      <div class="rep-head"><h3 style="margin:0">Géneros</h3></div>
      <div id="rep-genres">${chipsHTML}</div>
    </div>`;

  return playlistsHTML + "\n" + genresHTML;
}

// ---------------------------- Vistas: listas de playlists ------------------
function renderMyPlaylistsView(playlistsParam) {
  const playlists = Array.isArray(playlistsParam)
    ? playlistsParam
    : Array.isArray(window.__MDF_MY_PLAYLISTS__)
    ? window.__MDF_MY_PLAYLISTS__
    : [];

  const left = q(".rep-left");
  if (!left) return;

  if (!playlists.length) {
    left.innerHTML = `
      <div class="rep-empty">
        <div>
          <h3 style="margin:0">Tus playlists</h3>
          <p>No tienes playlists creadas todavía.</p>
        </div>
      </div>`;
    return;
  }

  const html = `
    <div class="rep-public-header" style="margin-bottom:8px">
      <h3 style="margin:0 0 4px">Tus playlists</h3>
      <p class="rep-public-sub" style="margin:0 0 10px;font-size:12px;opacity:.8">
        Selecciona una playlist para ver o editar sus canciones.
      </p>
    </div>
    <ul class="rep-public-list rep-my-list" style="list-style:none;margin:0;padding:0">
      ${playlists
        .map((pl, idx) => {
          const isPrivate = pl.isprivate === true || pl.is_private === true;
          const canT = canToggleVisibility(pl);
          const count = Array.isArray(pl.songs) ? pl.songs.length : 0;

          const lockHTML = canT
            ? `
              <button type="button"
                      class="rep-pl-lock rep-pl-lock--inline"
                      data-pl="${_esc(pl.id)}"
                      data-private="${isPrivate ? "1" : "0"}"
                      title="${
                        isPrivate
                          ? "Solo tú puedes ver esta playlist"
                          : "Visible para todos los usuarios"
                      }"
                      onclick="
                        event.preventDefault();
                        event.stopPropagation();
                        if (window.MDFCore && typeof window.MDFCore.togglePlaylistVisibility === 'function') {
                          window.MDFCore.togglePlaylistVisibility('${_esc(
                            pl.id
                          )}');
                        }
                      ">
                ${isPrivate ? "🔒" : "🔓"}
              </button>`
            : "";

          const deleteHTML = canT
            ? `
              <button type="button"
                      class="rep-pl-delete rep-pl-delete--inline"
                      data-pl="${_esc(pl.id)}"
                      title="Eliminar esta playlist"
                      onclick="
                        event.preventDefault();
                        event.stopPropagation();
                        if (window.MDFCore && typeof window.MDFCore.deletePlaylist === 'function') {
                          window.MDFCore.deletePlaylist('${_esc(pl.id)}');
                        }
                      ">
                🗑
              </button>`
            : "";

          return `
            <li class="rep-public-item rep-my-item"
                data-pl-id="${_esc(pl.id)}"
                style="margin:4px 0;display:flex;align-items:center;gap:8px">
              <button type="button"
                      class="rep-public-btn rep-my-btn"
                      style="flex:1;display:flex;align-items:center;justify-content:space-between;
                             padding:7px 10px;border-radius:8px;border:1px solid var(--line,#333);
                             background:#202020;color:inherit;cursor:pointer">
                <div>
                  <div>${_esc(pl.name || `Playlist ${idx + 1}`)}</div>
                  <div style="font-size:11px;opacity:.7">
                    ${isPrivate ? "Privada" : "Pública"}
                  </div>
                </div>
                <span class="rep-badge">${count}</span>
              </button>
              ${lockHTML}
              ${deleteHTML}
            </li>`;
        })
        .join("")}
    </ul>
  `;

  left.innerHTML = html;

  left.querySelectorAll(".rep-my-item .rep-my-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const li = btn.closest(".rep-my-item");
      if (!li) return;
      const pid = li.getAttribute("data-pl-id");
      if (!pid) return;

      const pl =
        (window._playlists || []).find((p) => String(p.id) === String(pid)) ||
        null;
      const songs = Array.isArray(pl?.songs) ? pl.songs : [];
      const canEdit = pl ? canToggleVisibility(pl) : false;

      const removeTpl =
        pl?.api_remove_song_url ||
        pl?.api_remove_song ||
        pl?.remove_song_url ||
        "";

      // Marcar esta playlist como actual
      try {
        window.__MDF_CURRENT_PL_ROOT = pid;
        const ul = document.getElementById("rep-playlists");
        if (ul) {
          ul.querySelectorAll("li[data-pl]").forEach((node) =>
            node.classList.remove("active")
          );
          const liPl = ul.querySelector(`li[data-pl="${CSS.escape(pid)}"]`);
          if (liPl) liPl.classList.add("active");
        }
      } catch {
        /* ignore */
      }

      renderLeftSongs(songs, pl?.name || "Playlist", {
        countsMode: null,
        playlistId: pid,
        allowRemoveFromPlaylist: canEdit,
        allowAddToPlaylist: canEdit,
        backRoot: "my",
        playlistRemoveSongUrlTemplate: removeTpl,
      });
    });
  });
}

function renderPublicPlaylistsView(playlistsParam) {
  const playlists = Array.isArray(playlistsParam)
    ? playlistsParam
    : Array.isArray(window.__MDF_PUBLIC_PLAYLISTS__)
    ? window.__MDF_PUBLIC_PLAYLISTS__
    : [];

  const left = q(".rep-left");
  if (!left) return;

  if (!playlists.length) {
    left.innerHTML = `
      <div class="rep-empty">
        <div>
          <h3 style="margin:0">Playlists públicas</h3>
          <p>No hay playlists públicas disponibles.</p>
        </div>
      </div>`;
    return;
  }

  const me = (typeof _getUsername === "function" ? _getUsername() : "") + "";

  const html = `
    <div class="rep-public-header" style="margin-bottom:8px">
      <h3 style="margin:0 0 4px">Playlists públicas</h3>
      <p class="rep-public-sub" style="margin:0 0 10px;font-size:12px;opacity:.8">
        Selecciona una playlist para ver sus canciones.
      </p>
    </div>
    <ul class="rep-public-list" style="list-style:none;margin:0;padding:0">
      ${playlists
        .map((pl, idx) => {
          const owner =
            pl.owner ||
            pl.user ||
            pl.username ||
            pl.owner_username ||
            "";
          const ownerLabel = owner && owner === me ? "ti" : owner || "";
          const count = Array.isArray(pl.songs) ? pl.songs.length : 0;

          return `
            <li class="rep-public-item"
                data-pl-id="${_esc(pl.id)}"
                style="margin:4px 0">
              <button type="button" class="rep-public-btn"
                      style="width:100%;display:flex;align-items:center;justify-content:space-between;
                             padding:7px 10px;border-radius:8px;
                             border:1px solid var(--line,#333);
                             background:#202020;color:inherit;cursor:pointer">
                <div>
                  <div>${_esc(pl.name || `Playlist ${idx + 1}`)}</div>
                  ${
                    ownerLabel
                      ? `<div style="font-size:11px;opacity:.7">de ${_esc(
                          ownerLabel
                        )}</div>`
                      : ""
                  }
                </div>
                <span class="rep-badge">${count}</span>
              </button>
            </li>`;
        })
        .join("")}
    </ul>
  `;

  left.innerHTML = html;

  left.querySelectorAll(".rep-public-item").forEach((li) => {
    li.addEventListener("click", () => {
      const pid = li.getAttribute("data-pl-id");
      if (!pid) return;

      const pl = (window._playlists || []).find(
        (p) => String(p.id) === String(pid)
      );
      const songs = Array.isArray(pl?.songs) ? pl.songs : [];

      const id = String(pl?.id || pid);
      const isPrivate = pl?.isprivate === true || pl?.is_private === true;
      const isPublic = !isPrivate;

      const canEdit =
        pl &&
        !SYSTEM_PLAYLIST_IDS.has(id) &&
        id !== PUBLIC_ROOT_ID &&
        canToggleVisibility(pl);

      const canAddSongs =
        pl &&
        !SYSTEM_PLAYLIST_IDS.has(id) &&
        id !== PUBLIC_ROOT_ID &&
        isPublic;

      const removeTpl =
        pl?.api_remove_song_url ||
        pl?.api_remove_song ||
        pl?.remove_song_url ||
        "";

      // Guardar como actual
      try {
        window.__MDF_CURRENT_PL_ROOT = id;
        const ul = document.getElementById("rep-playlists");
        if (ul) {
          ul.querySelectorAll("li[data-pl]").forEach((node) =>
            node.classList.remove("active")
          );
          const liPl = ul.querySelector(`li[data-pl="${CSS.escape(id)}"]`);
          if (liPl) liPl.classList.add("active");
        }
      } catch {
        /* ignore */
      }

      renderLeftSongs(songs, pl?.name || "Playlist", {
        countsMode: null,
        playlistId: id,
        allowRemoveFromPlaylist: canEdit,
        allowAddToPlaylist: canAddSongs,
        backRoot: "public",
        playlistRemoveSongUrlTemplate: removeTpl,
      });
    });
  });
}

function renderFollowedArtistsView(followedParam) {
  const artists = Array.isArray(followedParam)
    ? followedParam
    : Array.isArray(window.__MDF_FOLLOWED_PLAYLISTS__)
    ? window.__MDF_FOLLOWED_PLAYLISTS__
    : [];

  const left = q(".rep-left");
  if (!left) return;

  if (!artists.length) {
    left.innerHTML = `
      <div class="rep-empty">
        <div>
          <h3 style="margin:0">Artistas que sigues</h3>
          <p>No sigues a ningún artista todavía.</p>
        </div>
      </div>`;
    return;
  }

  const html = `
    <div class="rep-public-header" style="margin-bottom:8px">
      <h3 style="margin:0 0 4px">Artistas que sigues</h3>
      <p class="rep-public-sub" style="margin:0 0 10px;font-size:12px;opacity:.8">
        Elige un artista para reproducir sus canciones.
      </p>
    </div>
    <ul class="rep-public-list rep-followed-list" style="list-style:none;margin:0;padding:0">
      ${artists
        .map((pl, idx) => {
          const artistName =
            pl.artist_display_name || pl.artist_name || pl.name || "";
          const username =
            pl.artist_username || pl.owner || pl.user || pl.username || "";
          const count = Array.isArray(pl.songs) ? pl.songs.length : 0;
          const label = artistName || username || `Artista ${idx + 1}`;
          return `
            <li class="rep-followed-item"
                data-pl-id="${_esc(pl.id || username || label)}"
                data-artist-username="${_esc(username)}">
              <button type="button"
                      class="rep-followed-btn"
                      style="width:100%;display:flex;align-items:center;justify-content:space-between;
                             padding:7px 10px;border-radius:8px;border:1px solid var(--line,#333);
                             background:#202020;color:inherit;cursor:pointer">
                <div>
                  <div>${_esc(label)}</div>
                  ${
                    username
                      ? `<div style="font-size:11px;opacity:.7">@${_esc(
                          username
                        )}</div>`
                      : ""
                  }
                </div>
                <span class="rep-badge">${count}</span>
              </button>
            </li>`;
        })
        .join("")}
    </ul>
  `;

  left.innerHTML = html;

  left
    .querySelectorAll(".rep-followed-item .rep-followed-btn")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const li = btn.closest(".rep-followed-item");
        if (!li) return;
        const pid = li.getAttribute("data-pl-id") || "";
        const username = li.getAttribute("data-artist-username") || "";

        let pl =
          artists.find((p) => String(p.id) === String(pid)) ||
          artists.find(
            (p) =>
              (p.artist_username || p.username || p.owner || "") === username
          ) ||
          null;

        let songs = Array.isArray(pl?.songs) ? pl.songs : [];

        const songsUrl =
          pl?.songs_url ||
          pl?.api_songs_url ||
          (username
            ? `/api/artist/${encodeURIComponent(username)}/songs/`
            : "");

        if (!songs.length && songsUrl) {
          try {
            const res = await fetch(songsUrl, {
              credentials: "same-origin",
              cache: "no-store",
              headers: { "X-Requested-With": "fetch" },
            });
            if (res.ok) {
              const data = await res.json();
              const arr = Array.isArray(data?.songs)
                ? data.songs
                : Array.isArray(data)
                ? data
                : [];
              songs = arr;
              if (pl) pl.songs = arr;
            }
          } catch (e) {
            console.warn("No se pudieron cargar canciones del artista", e);
          }
        }

        const displayName =
          (pl &&
            (pl.artist_display_name || pl.artist_name || pl.name)) ||
          username ||
          "Artista";

        renderLeftSongs(Array.isArray(songs) ? songs : [], displayName, {
          countsMode: null,
          showLikeBtn: true,
          backRoot: "followed",
        });
      });
    });
}

// ---------------------------- Handlers sidebar -----------------------------
export function attachSidebarHandlers() {
  const clearGenres = () => {
    const w = document.getElementById("rep-genres");
    if (!w) return;
    w.querySelectorAll(
      '.rep-chip.active,[aria-selected="true"],[aria-pressed="true"]'
    ).forEach((x) => {
      x.classList.remove("active");
      x.removeAttribute("aria-selected");
      x.removeAttribute("aria-pressed");
    });
  };
  const clearPlaylists = () => {
    const ul = document.getElementById("rep-playlists");
    if (!ul) return;
    ul.querySelectorAll("li.active").forEach((x) =>
      x.classList.remove("active")
    );
  };

  const addBtn = document.getElementById("rep-add-playlist-btn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      if (
        window.MDFPlaylists &&
        typeof window.MDFPlaylists.openCreatePlaylistModal === "function"
      ) {
        window.MDFPlaylists.openCreatePlaylistModal();
      } else {
        console.warn(
          "MDFPlaylists.openCreatePlaylistModal no disponible (¿falta reproductor-playlists.js?)"
        );
      }
    });
  }

  const ul = document.getElementById("rep-playlists");
  if (ul) {
    ul.querySelectorAll("li[data-pl]").forEach((li) => {
      li.addEventListener("click", () => {
        clearGenres();
        clearPlaylists();
        li.classList.add("active");
        const id = li.dataset.pl;

        window.__MDF_CURRENT_PL_ROOT = id;

        const left = q(".rep-left");
        if (left) {
          const oldH = left.querySelector(".rep-stats");
          if (oldH) oldH.remove();
        }

        if (id === MY_ROOT_ID) {
          renderMyPlaylistsView(
            Array.isArray(window.__MDF_MY_PLAYLISTS__)
              ? window.__MDF_MY_PLAYLISTS__
              : []
          );
          return;
        }

        if (id === PUBLIC_ROOT_ID) {
          renderPublicPlaylistsView(
            Array.isArray(window.__MDF_PUBLIC_PLAYLISTS__)
              ? window.__MDF_PUBLIC_PLAYLISTS__
              : []
          );
          return;
        }

        if (id === FOLLOWED_ROOT_ID) {
          renderFollowedArtistsView(
            Array.isArray(window.__MDF_FOLLOWED_PLAYLISTS__)
              ? window.__MDF_FOLLOWED_PLAYLISTS__
              : []
          );
          return;
        }

        if (id === "pl:top10") {
          if (
            window.MDFDiscover &&
            typeof window.MDFDiscover.renderTop10View === "function"
          ) {
            window.MDFDiscover.renderTop10View();
          }
          return;
        }

        if (id === "pl:discover") {
          if (
            window.MDFDiscover &&
            typeof window.MDFDiscover.renderDiscoverView === "function"
          ) {
            window.MDFDiscover.renderDiscoverView();
          }
          return;
        }

        if (id === "pl:likes") {
          const plLikes =
            (window._playlists || []).find((p) => p.id === "pl:likes") || {
              name: "Music that i love",
              songs: window._likes || [],
            };
          renderLeftSongs(
            Array.isArray(plLikes.songs) ? plLikes.songs : [],
            plLikes.name || "Music that i love",
            { countsMode: null, showLikeBtn: true }
          );
          return;
        }

        if (id === "pl:history") {
          if (
            window.MDFDiscover &&
            typeof window.MDFDiscover.renderHistoryView === "function"
          ) {
            window.MDFDiscover.renderHistoryView();
          }
          return;
        }

        const pl =
          (window._playlists || []).find(
            (p) => String(p.id) === String(id)
          ) || { name: "—", songs: [] };

        const isPrivate = pl.isprivate === true || pl.is_private === true;
        const isPublic = !isPrivate;

        const canEdit =
          pl &&
          !SYSTEM_PLAYLIST_IDS.has(id) &&
          id !== PUBLIC_ROOT_ID &&
          canToggleVisibility(pl);

        const canAddSongs =
          pl &&
          !SYSTEM_PLAYLIST_IDS.has(id) &&
          id !== PUBLIC_ROOT_ID &&
          isPublic;

        const removeTpl =
          pl?.api_remove_song_url ||
          pl?.api_remove_song ||
          pl?.remove_song_url ||
          "";

        renderLeftSongs(
          Array.isArray(pl.songs) ? pl.songs : [],
          pl.name || "Playlist",
          {
            countsMode: null,
            playlistId: id,
            allowRemoveFromPlaylist: canEdit,
            allowAddToPlaylist: canAddSongs,
            playlistRemoveSongUrlTemplate: removeTpl,
          }
        );
      });
    });

    const saved = window.__MDF_CURRENT_PL_ROOT;
    let first =
      (saved && ul.querySelector(`li[data-pl="${CSS.escape(saved)}"]`)) ||
      ul.querySelector('li[data-pl="pl:all"]') ||
      ul.querySelector("li[data-pl]");

    if (first) {
      first.classList.add("active");
      clearGenres();
      first.click();
    }
  }

  const chipsWrap = document.getElementById("rep-genres");
  if (chipsWrap) {
    const all = Array.from(chipsWrap.querySelectorAll(".rep-chip"));
    all.forEach((ch) => {
      ch.addEventListener("click", () => {
        clearPlaylists();
        all.forEach((x) => {
          x.classList.remove("active");
          x.removeAttribute("aria-selected");
          x.removeAttribute("aria-pressed");
        });
        ch.classList.add("active");
        ch.setAttribute("aria-selected", "true");

        const g = slugify(ch.dataset.genre || "");
        const allSongs = (window._playlists || []).flatMap((p) =>
          Array.isArray(p.songs) ? p.songs : []
        );
        const filtered = allSongs.filter((s) => {
          const sg = slugify(s.genre || s.genero || s.gen || "");
          if (!g || g === "otro") return true;
          return sg && sg === g;
        });
        renderLeftSongs(filtered, ch.textContent || "Género", {
          countsMode: null,
        });
      });
    });
  }
}

// ======== Navegación a raíz de playlists (chip "volver") ===================
function _backToPlaylistRoot(rootIdRaw) {
  const rootId = String(rootIdRaw || "").trim();

  if (rootId === MY_ROOT_ID) {
    renderMyPlaylistsView(
      Array.isArray(window.__MDF_MY_PLAYLISTS__)
        ? window.__MDF_MY_PLAYLISTS__
        : []
    );
  } else if (rootId === PUBLIC_ROOT_ID) {
    renderPublicPlaylistsView(
      Array.isArray(window.__MDF_PUBLIC_PLAYLISTS__)
        ? window.__MDF_PUBLIC_PLAYLISTS__
        : []
    );
  } else if (rootId === FOLLOWED_ROOT_ID) {
    renderFollowedArtistsView(
      Array.isArray(window.__MDF_FOLLOWED_PLAYLISTS__)
        ? window.__MDF_FOLLOWED_PLAYLISTS__
        : []
    );
  }
}

// ---------------------------- SPA: render menú -----------------------------
export async function renderMenuReproductor({
  mainContent,
  contentDiv,
  URL_MI_MUSICA_JSON,
}) {
  try {
    wireReproductorPlaylistEvents({ mainContent });
  } catch {
    /* ignore */
  }

  const u = new URL(location.href);
  u.searchParams.set("view", "reproductor");
  history.replaceState(null, "", u.toString());
  mainContent.dataset.view = "reproductor";

  const IS_ARTIST = isArtistUser();

  const URL_ALL_SONGS_JSON =
    mainContent?.dataset?.urlAllSongsJson ||
    document.body?.dataset?.urlAllSongsJson ||
    "";

  window.__MDF_URL_ALL_SONGS__ = URL_ALL_SONGS_JSON;

  const URL_MIS_LIKES_JSON =
    mainContent?.dataset?.urlMisLikesJson ||
    document.getElementById("main-content")?.dataset?.urlMisLikesJson ||
    "/mis-likes/json/";

  let [allPlaylists, mySongs, myLikes, followedArtists] = await Promise.all([
    fetchAllPlaylistsWithSongs(),
    IS_ARTIST ? fetchMyMusic(URL_MI_MUSICA_JSON) : Promise.resolve([]),
    fetchMyLikes(URL_MIS_LIKES_JSON),
    fetchFollowedArtistsPlaylists().catch(() => []),
  ]);

  window.__MDF_FOLLOWED_PLAYLISTS__ = Array.isArray(followedArtists)
    ? followedArtists
    : [];

  // Fallback "Mi música" si no vino nada desde el endpoint JSON
  if (!mySongs || mySongs.length === 0) {
    try {
      const el = document.getElementById("playlists-data-json");
      const injected = JSON.parse(el?.textContent || "[]");
      const norm = (s) =>
        String(s || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .trim();
      let candidates = [];
      if (Array.isArray(injected)) {
        const byName = injected.find((p) =>
          norm(p?.name).includes("mi musica")
        );
        if (byName && Array.isArray(byName.songs)) candidates = byName.songs;
        if (
          !candidates.length &&
          injected.length === 1 &&
          Array.isArray(injected[0]?.songs)
        ) {
          candidates = injected[0].songs;
        }
      } else if (Array.isArray(injected?.songs)) {
        candidates = injected.songs;
      }
      if (candidates.length)
        mySongs = candidates.map(normalizeSong).filter(Boolean);
    } catch (e) {
      console.warn("Fallback Mi música (injected) falló:", e);
    }
  }

  window._likes = Array.isArray(myLikes) ? myLikes : [];
  let basePlaylists = buildPlaylistsModel({
    allPlaylists,
    mySongs,
    myLikes,
    isArtist: IS_ARTIST,
  });

  if (
    window.MDFDiscover &&
    typeof window.MDFDiscover.injectHistoryIntoPlaylists === "function"
  ) {
    try {
      basePlaylists = window.MDFDiscover.injectHistoryIntoPlaylists(
        basePlaylists
      );
    } catch (e) {
      console.warn("injectHistoryIntoPlaylists falló", e);
    }
  }

  window._playlists = basePlaylists;

  try {
    const allFromPlaylists = basePlaylists.flatMap((pl) =>
      Array.isArray(pl.songs) ? pl.songs : []
    );
    registerKnownSongs(allFromPlaylists);
  } catch {
    /* ignore */
  }

  try {
    if (
      window.MDFDiscover &&
      typeof window.MDFDiscover.ensureDailyRoll === "function"
    ) {
      window.MDFDiscover.ensureDailyRoll(window._playlists);
    }
  } catch (e) {
    console.warn("ensureDailyRoll falló", e);
  }

  const P = Array.isArray(window._playlists) ? window._playlists : [];
  const rightHTML =
    buildRightSidebarHTML({
      playlists: P,
      genres: DEFAULT_GENRES || [],
      followedArtists: window.__MDF_FOLLOWED_PLAYLISTS__ || [],
    }) || "";

  contentDiv.innerHTML = `
    <div class="rep-grid">
      <div class="rep-left"></div>
      <div class="rep-right">${rightHTML}</div>
    </div>`;

  const savedRoot = window.__MDF_CURRENT_PL_ROOT;

  if (!savedRoot) {
    const all =
      P.find((p) => p.id === "pl:all") ||
      P[0] || { id: "pl:tmp", name: "(sin playlists)", songs: [] };

    renderLeftSongs(
      Array.isArray(all.songs) ? all.songs : [],
      all.name || "Playlist",
      { countsMode: null }
    );
  }

  inicializarReproductor();
  attachSidebarHandlers();
}

window.renderMenuReproductor = renderMenuReproductor;

// ---------------------------- Ciclo de vida --------------------------------
export function inicializarReproductor() {
  ensureAudio();
  hookViewGuard();
  if (isPlayableView()) {
    collectQueueFromDOM();
    bindClicks(true);
    if (_state.audio?.src) fireBar();
    observeListChanges();
  } else {
    bindClicks(false);
    observeListChanges();
  }
}

export function stopReproductor() {
  bindClicks(false);
  if (_state.audio) _state.audio.pause();
  clearRowHighlight();
  if (_state.moList) {
    _state.moList.disconnect();
    _state.moList = null;
  }
}

export function rebindReproductor() {
  ensureAudio();
  collectQueueFromDOM();
  bindClicks(isPlayableView());
  if (_state.audio?.src) fireBar();
}

export async function stopReproductorIfLoaded() {
  try {
    stopReproductor();
  } catch {
    /* ignore */
  }
}

let _wiredPlaylistsChanged = false;

export function wireReproductorPlaylistEvents({ mainContent }) {
  if (_wiredPlaylistsChanged) return;
  _wiredPlaylistsChanged = true;

  const handler = async (ev) => {
    if ((mainContent?.dataset.view || "") !== "reproductor") return;

    const detail = (ev && ev.detail) || {};
    const type = detail.type || "";

    // Para añadir/quitar canciones refresca la barra
    if (type === "add-song" || type === "remove-song") {
      try {
        fireBar();
      } catch {
        /* ignore */
      }
      return;
    }

    // Para crear/eliminar playlists o cambiar visibilidad recargamos todo
    try {
      await renderMenuReproductor({
        mainContent,
        contentDiv: document.getElementById("content"),
        URL_MI_MUSICA_JSON: mainContent?.dataset?.urlMiMusicaJson,
      });
    } catch (e) {
      console.warn(
        "Error refrescando menú del reproductor tras playlists:changed",
        e
      );
    }
  };

  window.addEventListener("melodify:playlists:changed", handler);
  document.addEventListener("melodify:playlists:changed", handler);
}

// ---------------------------- Cookies / playlists / likes ------------------

// Cookie básica para CSRF
function getCookie(name) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== "") {
    const cookies = document.cookie.split(";");
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.substring(0, name.length + 1) === name + "=") {
        cookieValue = decodeURIComponent(
          cookie.substring(name.length + 1)
        );
        break;
      }
    }
  }
  return cookieValue;
}

// --------- Helpers de URLs para playlists ----------------------------------
function _resolvePlaylistToggleUrl(playlistIdRaw) {
  const id = String(playlistIdRaw || "").trim();
  if (!id) return "";

  const meta =
    document.querySelector('meta[name="api-playlist-toggle-visibility"]')
      ?.content || "";
  if (meta) {
    return meta.replace("__ID__", id).replace(":id", id);
  }

  const li =
    document.querySelector(
      `#rep-playlists li[data-pl="${CSS.escape(id)}"]`
    ) || null;
  if (li) {
    const url =
      li.dataset.toggleUrl ||
      li.getAttribute("data-toggle-url") ||
      "";
    if (url) return url;
  }

  const pl =
    (window._playlists || []).find(
      (p) => p && String(p.id) === id
    ) || null;
  if (pl) {
    const url =
      pl.api_toggle_visibility_url ||
      pl.api_toggle_visibility ||
      pl.toggle_visibility_url ||
      "";
    if (url) return url;
  }

  console.warn(
    "MDFCore: no se pudo resolver URL de visibilidad para playlist",
    id
  );
  return "";
}

function _resolvePlaylistDeleteUrl(playlistIdRaw) {
  const id = String(playlistIdRaw || "").trim();
  if (!id) return "";

  const meta =
    document.querySelector('meta[name="api-playlist-delete"]')
      ?.content || "";
  if (meta) {
    return meta.replace("__ID__", id).replace(":id", id);
  }

  const li =
    document.querySelector(
      `#rep-playlists li[data-pl="${CSS.escape(id)}"]`
    ) || null;
  if (li) {
    const url =
      li.dataset.deleteUrl ||
      li.getAttribute("data-delete-url") ||
      "";
    if (url) return url;
  }

  const pl =
    (window._playlists || []).find(
      (p) => p && String(p.id) === id
    ) || null;
  if (pl) {
    const url =
      pl.api_delete_url || pl.api_delete || pl.delete_url || "";
    if (url) return url;
  }

  console.warn(
    "MDFCore: no se pudo resolver URL de borrado para playlist",
    id
  );
  return "";
}

function _resolvePlaylistRemoveSongUrl(playlistIdRaw, songIdRaw) {
  const pid = String(playlistIdRaw || "").trim();
  const sid = String(songIdRaw || "").trim();
  if (!pid || !sid) return "";

  const left = document.querySelector(".rep-left");
  const tpl =
    left?.dataset.removeSongUrlTemplate ||
    left?.getAttribute("data-remove-song-url-template") ||
    "";
  if (tpl) {
    return tpl
      .replace("__PL__", pid)
      .replace("__PID__", pid)
      .replace("__PLAYLIST__", pid)
      .replace(":playlist_id", pid)
      .replace(":playlist", pid)
      .replace("__ID__", sid)
      .replace(":song_id", sid)
      .replace(":id", sid);
  }

  const meta =
    document.querySelector('meta[name="api-playlist-remove-song"]')
      ?.content || "";
  if (meta) {
    return meta
      .replace("__PL__", pid)
      .replace("__ID__", sid)
      .replace(":playlist_id", pid)
      .replace(":id", sid);
  }

  console.warn(
    "MDFCore: no se pudo resolver URL para quitar canción de playlist",
    pid,
    sid
  );
  return "";
}

function _dispatchPlaylistsChanged(detail) {
  const d = detail || {};
  try {
    const ev = new CustomEvent("melodify:playlists:changed", {
      detail: d,
    });
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
  } catch (e) {
    console.warn("No se pudo despachar melodify:playlists:changed", e);
  }
}

// --------- Likes: resolver URL de like por canción -------------------------
function _resolveLikeUrlForSongId(idSong) {
  const id = String(idSong || "").trim();
  if (!id) return "";

  let el = document.querySelector(
    [
      `.song-like-btn[data-song-id="${CSS.escape(id)}"]`,
      `.search-btn-like[data-song-id="${CSS.escape(id)}"]`,
      `.cat-like-btn[data-song-id="${CSS.escape(id)}"]`,
      `[data-like-song-id="${CSS.escape(id)}"]`,
    ].join(", ")
  );

  let url = "";

  if (el) {
    url =
      el.dataset.likeUrl ||
      el.dataset.apiLikeUrl ||
      el.getAttribute("data-like-url") ||
      el.getAttribute("data-api-like-url") ||
      "";

    if (!url) {
      const row = el.closest(
        ".song-item, .search-item-song, article.song, article.cat-song, .muro-song-row, .gestion-song-row"
      );
      if (row) {
        url =
          row.dataset.likeUrl ||
          row.dataset.apiLikeUrl ||
          row.getAttribute("data-like-url") ||
          row.getAttribute("data-api-like-url") ||
          "";
      }
    }
  }

  if (url) return url;

  const meta =
    document.querySelector('meta[name="api-like-song"]')?.content || "";
  if (meta) {
    return meta.replace("__ID__", id).replace(":id", id);
  }

  console.warn("MDFCore: no se pudo resolver URL de like para canción", id);
  return "";
}

// --------- Actualizar modelo local de likes / playlist "Music that i love" --
function _syncLikeModelFromClient(idSong, liked, meta) {
  const idStr = idSong != null ? String(idSong) : "";
  let likes = Array.isArray(window._likes) ? window._likes.slice() : [];

  function fromMeta() {
    if (!meta) return null;
    return normalizeSong({
      id: idSong,
      title: meta.title,
      artist_display_name: meta.artist,
      audioUrl: meta.audioUrl,
      coverUrl: meta.coverUrl,
      genre: meta.genre,
    });
  }

  function fromPlaylists() {
    const pls = Array.isArray(window._playlists) ? window._playlists : [];
    for (const pl of pls) {
      const songs = Array.isArray(pl.songs) ? pl.songs : [];
      for (const s of songs) {
        if (s.id != null && String(s.id) === idStr) return s;
      }
    }
    return null;
  }

  let baseSong = fromMeta() || fromPlaylists() || fromMeta();
  if (!baseSong) return;

  const key = _songKey(baseSong);
  if (!key) return;

  if (liked) {
    const exists = likes.some((s) => _songKey(s) === key);
    if (!exists) likes.push(baseSong);
  } else {
    likes = likes.filter((s) => _songKey(s) !== key);
  }

  window._likes = likes;

  const pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
  let likesIdx = pls.findIndex((p) => p.id === "pl:likes");

  if (likesIdx >= 0) {
    pls[likesIdx] = {
      ...pls[likesIdx],
      songs: likes.slice(),
    };
  } else if (likes.length) {
    const afterMine = pls.findIndex((p) => p.id === "pl:mine");
    const insertAt = afterMine >= 0 ? afterMine + 1 : 1;
    pls.splice(insertAt, 0, {
      id: "pl:likes",
      name: "Music that i love",
      songs: likes.slice(),
    });
  }

  window._playlists = pls;

  const ul = document.getElementById("rep-playlists");
  if (ul) {
    const li = ul.querySelector('li[data-pl="pl:likes"]');
    if (li) {
      const badge = li.querySelector(".rep-badge");
      if (badge) badge.textContent = String(likes.length);
    }
  }

  const main = document.getElementById("main-content");
  const isReproductor = (main?.dataset.view || "").trim() === "reproductor";

  if (isReproductor) {
    const activeLikes = document.querySelector(
      '#rep-playlists li.active[data-pl="pl:likes"]'
    );
    if (activeLikes) {
      const plLikes =
        window._playlists.find((p) => p.id === "pl:likes") || {
          name: "Music that i love",
          songs: likes,
        };
      renderLeftSongs(
        Array.isArray(plLikes.songs) ? plLikes.songs : [],
        plLikes.name || "Music that i love",
        { countsMode: null, showLikeBtn: true }
      );
    }

    const activeDiscover = document.querySelector(
      '#rep-playlists li.active[data-pl="pl:discover"]'
    );
    if (activeDiscover) {
      try {
        if (
          window.MDFDiscover &&
          typeof window.MDFDiscover.renderDiscoverView === "function"
        ) {
          window.MDFDiscover.renderDiscoverView();
        }
      } catch (e) {
        console.warn("discover refresh after like failed", e);
      }
    }
  }
}

// --------- Toggle like desde el reproductor -------------------------------
function _toggleLikeFromReproductor(evt, idSongRaw) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }

  const idSong = String(idSongRaw || "").trim();
  if (!idSong) return;

  const csrftoken = getCookie("csrftoken") || "";
  const url = _resolveLikeUrlForSongId(idSong);

  if (!url) {
    console.warn("No tengo URL de like para esta canción:", idSong);
    return;
  }

  fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "X-CSRFToken": csrftoken,
      "X-Requested-With": "XMLHttpRequest",
    },
  })
    .then(async (res) => {
      let data = {};
      try {
        data = await res.json();
      } catch (e) {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      }

      if (!res.ok) {
        const msg = (data && data.error) || `HTTP ${res.status}`;
        throw new Error(msg);
      }

      return data;
    })
    .then((data) => {
      const liked = !!data.liked;

      const selector = [
        `.song-like-btn[data-song-id="${CSS.escape(idSong)}"]`,
        `.search-btn-like[data-song-id="${CSS.escape(idSong)}"]`,
        `.cat-like-btn[data-song-id="${CSS.escape(idSong)}"]`,
        `[data-like-song-id="${CSS.escape(idSong)}"]`,
      ].join(", ");

      const buttons = document.querySelectorAll(selector);
      let rowForMeta = null;

      buttons.forEach((btn) => {
        const scope = btn.dataset.likeScope || "";

        btn.dataset.liked = liked ? "1" : "0";
        btn.setAttribute("data-liked", liked ? "1" : "0");
        btn.setAttribute("aria-pressed", liked ? "true" : "false");

        if (scope === "home") {
          const txt = (btn.textContent || "").trim();
          if (txt === "♥" || txt === "♡" || txt === "") {
            btn.textContent = "♡";
          }
          btn.classList.remove("is-liked", "liked", "active");
        } else {
          btn.classList.toggle("is-liked", liked);
          const txt = (btn.textContent || "").trim();
          if (txt === "♥" || txt === "♡") {
            btn.textContent = liked ? "♥" : "♡";
          }
        }

        if (!rowForMeta) {
          const cand = btn.closest(
            ".song-item, .search-item-song, article.song, article.cat-song, .muro-song-row, .gestion-song-row"
          );
          if (cand) rowForMeta = cand;
        }
      });

      let meta = null;
      if (rowForMeta) {
        meta = {
          title: rowForMeta.getAttribute("data-title") || "",
          artist: rowForMeta.getAttribute("data-author") || "",
          audioUrl: rowForMeta.getAttribute("data-audio-url") || "",
          coverUrl:
            rowForMeta.querySelector(".song-cover")?.getAttribute("src") ||
            "",
          genre: rowForMeta.getAttribute("data-genre") || "",
        };
      }

      if (
        window.MDFCore &&
        typeof window.MDFCore.syncLikeModelFromClient === "function"
      ) {
        window.MDFCore.syncLikeModelFromClient(idSong, liked, meta);
      }

      document.dispatchEvent(
        new CustomEvent("melodify:likes:changed", {
          detail: { songId: idSong, liked },
        })
      );

      _toast(
        liked ? "Añadido a tus me gusta" : "Quitado de tus me gusta"
      );
    })
    .catch((err) => {
      console.error("Error en like desde reproductor:", err);
      _toast("No se pudo actualizar tus me gusta.");
    });
}

// --------- Quitar canción de playlist -------------------------------------
function _removeSongFromCurrentPlaylist(idSongRaw, playlistIdRaw) {
  const songId = String(idSongRaw || "").trim();
  const playlistId = String(playlistIdRaw || "").trim();
  if (!songId || !playlistId) return;

  const url = _resolvePlaylistRemoveSongUrl(playlistId, songId);
  if (!url) {
    _toast("No se pudo encontrar la URL para quitar la canción.");
    return;
  }

  const csrftoken = getCookie("csrftoken") || "";

  fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "X-CSRFToken": csrftoken,
      "X-Requested-With": "XMLHttpRequest",
    },
  })
    .then(async (res) => {
      let data = {};
      try {
        data = await res.json();
      } catch (e) {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) {
        const msg = (data && data.error) || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    })
    .then((data) => {
      const row = document.querySelector(
        `.rep-left .song-item[data-id="${CSS.escape(songId)}"]`
      );
      if (row && row.parentElement) {
        row.parentElement.removeChild(row);
      }

      collectQueueFromDOM();
      bindClicks(isPlayableView());
      fireBar();

      _toast("Canción quitada de la playlist.");
      _dispatchPlaylistsChanged({
        type: "remove-song",
        playlistId,
        songId,
        response: data,
      });
    })
    .catch((err) => {
      console.error("Error al quitar canción de playlist:", err);
      _toast("No se pudo quitar la canción de la playlist.");
    });
}

// --------- Cambiar visibilidad de playlist --------------------------------
function _togglePlaylistVisibility(playlistIdRaw) {
  const playlistId = String(playlistIdRaw || "").trim();
  if (!playlistId) return;

  const url = _resolvePlaylistToggleUrl(playlistId);
  if (!url) {
    _toast("No se pudo encontrar la URL para cambiar visibilidad.");
    return;
  }

  const csrftoken = getCookie("csrftoken") || "";

  fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "X-CSRFToken": csrftoken,
      "X-Requested-With": "XMLHttpRequest",
    },
  })
    .then(async (res) => {
      let data = {};
      try {
        data = await res.json();
      } catch (e) {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) {
        const msg = (data && data.error) || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return data;
    })
    .then((data) => {
      let isPrivate =
        data.is_private ?? data.private ?? data.isprivate ?? null;

      const locks = document.querySelectorAll(
        `.rep-pl-lock[data-pl="${CSS.escape(playlistId)}"]`
      );
      locks.forEach((btn) => {
        let priv = isPrivate;
        if (priv === null) {
          const current = btn.dataset.private === "1";
          priv = !current;
        }
        const privAttr = priv ? "1" : "0";
        btn.dataset.private = privAttr;
        btn.setAttribute("data-private", privAttr);
        btn.textContent = priv ? "🔒" : "🔓";
        btn.title = priv
          ? "Solo tú puedes ver esta playlist"
          : "Visible para todos los usuarios";
      });

      _toast(
        (isPrivate ?? true)
          ? "Playlist marcada como privada."
          : "Playlist marcada como pública."
      );
      _dispatchPlaylistsChanged({
        type: "toggle-visibility",
        playlistId,
        response: data,
      });
    })
    .catch((err) => {
      console.error("Error al cambiar visibilidad de playlist:", err);
      _toast("No se pudo cambiar la visibilidad de la playlist.");
    });
}

// --------- Eliminar playlist ----------------------------------------------
async function _deletePlaylist(playlistIdRaw) {
  const playlistId = String(playlistIdRaw || "").trim();
  if (!playlistId) return;

  const url = _resolvePlaylistDeleteUrl(playlistId);
  if (!url) {
    _toast("No se pudo encontrar la URL para eliminar la playlist.");
    return;
  }

  // Confirmación antes de eliminar
  const ok = await window.mdfConfirm(
    "¿Eliminar esta playlist? Esta acción no se puede deshacer.",
    {
      title: "Eliminar playlist",
      danger: true,
      okLabel: "Eliminar",
      cancelLabel: "Cancelar",
    }
  );
  if (!ok) return;

  const csrftoken = getCookie("csrftoken") || "";

  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-CSRFToken": csrftoken,
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    }
    if (!res.ok) {
      const msg = (data && data.error) || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    // Actualizar modelo local en memoria
    if (Array.isArray(window._playlists)) {
      window._playlists = window._playlists.filter(
        (p) => p && String(p.id) !== playlistId
      );
    }

    if (Array.isArray(window.__MDF_MY_PLAYLISTS__)) {
      window.__MDF_MY_PLAYLISTS__ = window.__MDF_MY_PLAYLISTS__.filter(
        (p) => p && String(p.id) !== playlistId
      );
    }

    if (Array.isArray(window.__MDF_PUBLIC_PLAYLISTS__)) {
      window.__MDF_PUBLIC_PLAYLISTS__ =
        window.__MDF_PUBLIC_PLAYLISTS__.filter(
          (p) => p && String(p.id) !== playlistId
        );
    }

    // Panel derecho: quitar el item de #rep-playlists
    const li = document.querySelector(
      `#rep-playlists li[data-pl="${CSS.escape(playlistId)}"]`
    );
    if (li && li.parentElement) {
      li.parentElement.removeChild(li);
    }

    // Columna izquierda: quitar de "Tus playlists" / "Playlists públicas"
    document
      .querySelectorAll(
        `.rep-my-item[data-pl-id="${CSS.escape(
          playlistId
        )}"], .rep-public-item[data-pl-id="${CSS.escape(playlistId)}"]`
      )
      .forEach((node) => {
        if (node.parentElement) node.parentElement.removeChild(node);
      });

    // Si la playlist abierta es ésta, mostrar estado vacío
    const left = document.querySelector(".rep-left");
    if (left && left.dataset.currentPlaylist === playlistId) {
      left.innerHTML = `
        <div class="rep-empty">
          <div>
            <h3 style="margin:0">Playlist eliminada</h3>
            <p>Selecciona otra playlist en la barra derecha.</p>
          </div>
        </div>`;
      delete left.dataset.currentPlaylist;
    }

    _toast("Playlist eliminada.");

    // Avisar al resto de módulos
    _dispatchPlaylistsChanged({
      type: "delete",
      playlistId,
      response: data,
    });
  } catch (err) {
    console.error("Error al eliminar playlist:", err);
    _toast("No se pudo eliminar la playlist.");
  }
}

// --------- Abrir diálogo para agregar canciones a una playlist ------------
function _openAddSongsDialogForPlaylist(playlistIdRaw) {
  const playlistId = String(playlistIdRaw || "").trim();
  if (!playlistId) return;

  if (
    window.MDFPlaylists &&
    typeof window.MDFPlaylists.openAddSongsDialogForPlaylist === "function"
  ) {
    window.MDFPlaylists.openAddSongsDialogForPlaylist(playlistId);
    return;
  }

  if (typeof window.openAddSongsToPlaylist === "function") {
    window.openAddSongsToPlaylist(playlistId);
    return;
  }

  _toast("No se encontró la UI para agregar canciones a la playlist.");
}

// ---------------------------- SPA playlists (ganchos vacíos) --------------
let currentViewPlaylist = "allPlayList";
export function crearPlaylist() {
  console.log("crearPlaylist no implementado");
}
export function likePlaylist(id) {
  console.log("likePlaylist no implementado:", id);
}
export function editarPlaylist(id) {
  console.log("editarPlaylist no implementado:", id);
}
export function eliminarPlaylist(id) {
  console.log("eliminarPlaylist no implementado:", id);
}
export function showPlaylists() {}
export function verSongs(playlistId) {}
export function playSong(id) {
  console.log("Reproduciendo canción con ID:", id);
}
export function likeSong() {}

// ==== Helpers de debug (solo consola) =====================================
window.__MDF_DEBUG = {
  getCurrentUserInfo: _getCurrentUserInfo,
  extractPlaylistOwner: _extractPlaylistOwner,
  canToggleVisibility: canToggleVisibility,
};
