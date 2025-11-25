// static/reproductor/reproductor-actions.js
// ============================================================================
// Reproductor — Acciones de likes y playlists.
// ============================================================================

import {
  _songKey,
  normalizeSong,
  ensureAbs,
  _getUsername,
  _getCurrentUserInfo,
  _extractPlaylistOwner,
  fetchAllSongsFromBackend,
} from "./reproductor-data.js";

// Fallback de window.mdfConfirm con diálogo modal básico
if (typeof window.mdfConfirm !== "function") {
  window.mdfConfirm = function (message, opts = {}) {
    return new Promise((resolve) => {
      const prev = document.querySelector(".mdf-dialog-backdrop");
      if (prev) prev.remove();

      const backdrop = document.createElement("div");
      backdrop.className = "mdf-dialog-backdrop";

      const dialog = document.createElement("div");
      dialog.className = "mdf-dialog";
      if (opts.className) dialog.classList.add(opts.className);

      const titleText = opts.title || "Confirmar acción";
      const danger = !!opts.danger;

      const titleEl = document.createElement("h2");
      titleEl.className = "mdf-dialog-title";
      titleEl.textContent = titleText;

      const msgEl = document.createElement("p");
      msgEl.className = "mdf-dialog-message";
      msgEl.textContent = message || "";

      const buttonsWrap = document.createElement("div");
      buttonsWrap.className = "mdf-dialog-buttons";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "mdf-dialog-btn mdf-dialog-btn--ghost";
      cancelBtn.textContent = opts.cancelLabel || "Cancelar";

      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.className = "mdf-dialog-btn";
      if (danger) okBtn.classList.add("mdf-dialog-btn--danger");
      okBtn.textContent = opts.okLabel || "Aceptar";

      buttonsWrap.appendChild(cancelBtn);
      buttonsWrap.appendChild(okBtn);

      dialog.appendChild(titleEl);
      dialog.appendChild(msgEl);
      dialog.appendChild(buttonsWrap);

      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      let finished = false;
      const close = (value) => {
        if (finished) return;
        finished = true;
        backdrop.remove();
        resolve(value);
      };

      cancelBtn.addEventListener("click", () => close(false));
      okBtn.addEventListener("click", () => close(true));

      backdrop.addEventListener("click", (ev) => {
        if (ev.target === backdrop) close(false);
      });

      const onKey = (ev) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          close(false);
        } else if (ev.key === "Enter") {
          ev.preventDefault();
          close(true);
        }
      };
      document.addEventListener("keydown", onKey, { once: true });

      setTimeout(() => okBtn.focus(), 0);
    });
  };
}

// --------------------------------------------------------------------------
// Constantes de integración con el core
// --------------------------------------------------------------------------
const PUBLIC_ROOT_ID = "pl:public-root";
const MY_ROOT_ID = "pl:my-root";
const FOLLOWED_ROOT_ID = "pl:followed-root";
const SYSTEM_PLAYLIST_IDS = new Set([
  "pl:all",
  "pl:mine",
  "pl:likes",
  "pl:top10",
  "pl:discover",
  "pl:history",
]);

// --------------------------------------------------------------------------
// Eventos y toast de feedback
// --------------------------------------------------------------------------
function fire(name, detail) {
  try {
    const ev = new CustomEvent(name, { detail });
    window.dispatchEvent(ev);
    document.dispatchEvent(ev);
  } catch {
    /* ignore */
  }
}

function emitPlaylistsChangedCore(detail) {
  const main = document.getElementById("main-content");
  const view = (main?.dataset.view || main?.dataset.initialView || "").trim();

  if (view === "reproductor") return;
  fire("melodify:playlists:changed", detail || {});
}

function _toast(msg) {
  const text = String(msg || "");

  if (typeof window.__melodifyShowLikeToast === "function") {
    try {
      window.__melodifyShowLikeToast(text);
      return;
    } catch (e) {
      console.warn("__melodifyShowLikeToast falló, uso fallback:", e);
    }
  }

  let t = document.getElementById("mdf-actions-toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "mdf-actions-toast";
    t.style.cssText =
      "position:fixed;left:50%;bottom:26px;transform:translateX(-50%);" +
      "background:#222;color:#eee;border:1px solid #333;border-radius:10px;" +
      "padding:8px 12px;z-index:99999;font-size:14px;opacity:0;transition:.18s";
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.style.opacity = "1";
  clearTimeout(_toast._t);
  _toast._t = setTimeout(() => {
    t.style.opacity = "0";
  }, 1500);
}

// --------------------------------------------------------------------------
// Cookies y helpers de usuario / playlists
// --------------------------------------------------------------------------
function getCookie(name) {
  let cookieValue = null;
  if (document.cookie && document.cookie !== "") {
    const cookies = document.cookie.split(";");
    for (let cookie of cookies) {
      cookie = cookie.trim();
      if (cookie.substring(0, name.length + 1) === name + "=") {
        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
        break;
      }
    }
  }
  return cookieValue;
}

function _inferBackRootForCurrentView() {
  const root = window.__MDF_CURRENT_PL_ROOT || "";
  if (root === MY_ROOT_ID) return "my";
  if (root === PUBLIC_ROOT_ID) return "public";
  return null;
}

// Permiso para cambiar visibilidad: sólo playlists normales del usuario
function canToggleVisibility(pl) {
  if (!pl) return false;

  const id = String(pl.id || "");
  if (SYSTEM_PLAYLIST_IDS.has(id) || id === PUBLIC_ROOT_ID) return false;
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
  const sameById =
    curId && ownId ? String(curId) === String(ownId) : false;

  return sameByName || sameById;
}

// --------------------------------------------------------------------------
// Modelo local de likes
// --------------------------------------------------------------------------
function syncLikeModelFromClient(idSong, liked, meta) {
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
    const mdfCore = window.MDFCore;

    const activeLikes = document.querySelector(
      '#rep-playlists li.active[data-pl="pl:likes"]'
    );
    if (activeLikes && mdfCore && typeof mdfCore.renderLeftSongs === "function") {
      const plLikes =
        window._playlists.find((p) => p.id === "pl:likes") || {
          name: "Music that i love",
          songs: likes,
        };
      mdfCore.renderLeftSongs(
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

// --------------------------------------------------------------------------
// Agregar canción a playlist
// --------------------------------------------------------------------------
async function addSongToPlaylistCore(plKeyRaw, song) {
  const plKey = String(plKeyRaw || "").trim();
  if (!plKey || !song || song.id == null) return false;

  const playlistId = plKey.replace(/^pl:/, "");
  const idSong = String(song.id);
  const csrftoken = getCookie("csrftoken") || "";

  const pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
  const idxPl = pls.findIndex((p) => String(p.id) === String(plKey));

  const currentLength =
    idxPl >= 0 && Array.isArray(pls[idxPl].songs)
      ? pls[idxPl].songs.length
      : 0;

  const position = currentLength + 1;

  let res, data;
  try {
    res = await fetch("/playlist/addsong/", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRFToken": csrftoken,
      },
      body: JSON.stringify({
        playlist_id: playlistId,
        song_id: idSong,
        position: position,
      }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    console.error("Error al agregar canción a playlist:", e);
    _toast("No se pudo agregar la canción.");
    return false;
  }

  if (!res.ok) {
    console.error("Backend addSong error:", data);
    _toast(data?.error || "No se pudo agregar la canción.");
    return false;
  }

  if (idxPl >= 0) {
    const pl = pls[idxPl];
    const prevSongs = Array.isArray(pl.songs) ? pl.songs.slice() : [];
    if (!prevSongs.some((s) => String(s.id) === idSong)) {
      prevSongs.push(song);
    }
    pls[idxPl] = { ...pl, songs: prevSongs };
    window._playlists = pls;
  }

  const mdfCore = window.MDFCore;
  const left = document.querySelector(".rep-left");
  const currentPlKey = left?.dataset?.currentPlaylist || "";

  const plCurrent = (window._playlists || []).find(
    (p) => String(p.id) === String(plKey)
  );
  const songsNow = Array.isArray(plCurrent?.songs) ? plCurrent.songs : [];


  if (
    currentPlKey &&
    String(currentPlKey) === String(plKey) &&
    mdfCore &&
    typeof mdfCore.renderLeftSongs === "function"
  ) {
    const isPrivate =
      plCurrent?.isprivate === true || plCurrent?.is_private === true;
    const isPublic = !isPrivate;

    const canEdit =
      plCurrent &&
      !SYSTEM_PLAYLIST_IDS.has(plKey) &&
      plKey !== PUBLIC_ROOT_ID &&
      canToggleVisibility(plCurrent);

    const canAddSongs =
      plCurrent &&
      !SYSTEM_PLAYLIST_IDS.has(plKey) &&
      plKey !== PUBLIC_ROOT_ID &&
      isPublic;

    const backRoot = _inferBackRootForCurrentView();

    mdfCore.renderLeftSongs(songsNow, plCurrent?.name || "Playlist", {
      countsMode: null,
      playlistId: plKey,
      allowRemoveFromPlaylist: canEdit,
      allowAddToPlaylist: canAddSongs,
      backRoot,
    });
  }

  const liForPl = document.querySelector(
    `#rep-playlists li[data-pl="${CSS.escape(plKey)}"]`
  );
  if (liForPl && plCurrent) {
    const badge = liForPl.querySelector(".rep-badge");
    if (badge) badge.textContent = String(songsNow.length || 0);
  }

  emitPlaylistsChangedCore();
  _toast("Canción añadida a la playlist");
  return true;
}

// --------------------------------------------------------------------------
// Quitar canción de playlist activa
// --------------------------------------------------------------------------
async function removeSongFromCurrentPlaylist(idSongRaw, plKeyRaw) {
  const idSong = String(idSongRaw || "").trim();
  if (!idSong) return;

  let plKey = String(plKeyRaw || "").trim();

  if (!plKey) {
    const activeLi = document.querySelector(
      "#rep-playlists li.active[data-pl]"
    );
    if (!activeLi) {
      console.warn("No hay playlist activa para quitar canción");
      return;
    }
    plKey = activeLi.dataset.pl || "";
  }

  if (!plKey || !/^pl:\d+$/.test(plKey)) {
    console.warn("Playlist activa no es una playlist editable:", plKey);
    return;
  }

  const ok = await (typeof window.mdfConfirm === "function"
    ? window.mdfConfirm(
        "¿Seguro que quieres quitar esta canción de la playlist?",
        { title: "Quitar de playlist" }
      )
    : Promise.resolve(true));

  if (!ok) return;

  const playlistId = plKey.replace(/^pl:/, "");
  const csrftoken = getCookie("csrftoken") || "";

  let res, data;
  try {
    res = await fetch("/playlist/removeSong/", {
      method: "DELETE",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        "X-CSRFToken": csrftoken,
      },
      body: JSON.stringify({
        playlist_id: playlistId,
        song_id: idSong,
      }),
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    console.error("Error al quitar canción de playlist:", e);
    _toast("No se pudo quitar la canción.");
    return;
  }

  if (!res.ok) {
    console.error("Backend removeSong error:", data);
    _toast(data?.error || "No se pudo quitar la canción.");
    return;
  }

  const pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
  const idxPl = pls.findIndex((p) => String(p.id) === String(plKey));
  const mdfCore = window.MDFCore;

  if (idxPl >= 0) {
    const pl = pls[idxPl];
    const prevSongs = Array.isArray(pl.songs) ? pl.songs.slice() : [];
    const nextSongs = prevSongs.filter((s) => String(s.id) !== idSong);
    pls[idxPl] = { ...pl, songs: nextSongs };
    window._playlists = pls;

    const plCurrent = (window._playlists || []).find(
      (p) => String(p.id) === String(plKey)
    );
    const songs = Array.isArray(plCurrent?.songs) ? plCurrent.songs : [];

    const backRoot = _inferBackRootForCurrentView();

    if (mdfCore && typeof mdfCore.renderLeftSongs === "function") {
      mdfCore.renderLeftSongs(songs, plCurrent?.name || "Playlist", {
        countsMode: null,
        playlistId: plKey,
        allowRemoveFromPlaylist: true,
        allowAddToPlaylist: true,
        backRoot,
      });
    }

    const activeLi = document.querySelector(
      `#rep-playlists li[data-pl="${CSS.escape(plKey)}"]`
    );
    if (activeLi && plCurrent) {
      const badge = activeLi.querySelector(".rep-badge");
      if (badge) badge.textContent = String(plCurrent.songs.length || 0);
    }
  }

  _toast("Canción quitada de la playlist");
}

// --------------------------------------------------------------------------
// Diálogo "Agregar canciones a esta playlist"
// --------------------------------------------------------------------------
async function openAddSongsDialogForPlaylist(plKeyRaw) {
  const plKey = String(plKeyRaw || "").trim();
  if (!plKey) return;

  const pls = Array.isArray(window._playlists) ? window._playlists : [];
  const plCurrent =
    pls.find((p) => String(p.id) === String(plKey)) || null;

  if (!plCurrent) {
    console.warn("Playlist no encontrada para agregar canciones:", plKey);
    return;
  }

  const existingIds = new Set(
    (Array.isArray(plCurrent.songs) ? plCurrent.songs : []).map((s) =>
      String(s.id)
    )
  );

  const allSongsRaw = [];

  try {
    const catalog = await fetchAllSongsFromBackend();
    if (Array.isArray(catalog) && catalog.length) {
      allSongsRaw.push(...catalog);
    }
  } catch (e) {
    console.warn("No se pudo cargar catálogo global de canciones:", e);
  }

  if (Array.isArray(window.__MDF_GLOBAL_SONGS__)) {
    allSongsRaw.push(...window.__MDF_GLOBAL_SONGS__);
  }

  pls.forEach((pl) => {
    if (Array.isArray(pl.songs)) {
      allSongsRaw.push(...pl.songs);
    }
  });

  document
    .querySelectorAll(".song-item,[data-audio-url]")
    .forEach((el) => {
      const id =
        el.dataset.id || el.getAttribute("data-id") || null;
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
      const genre =
        el.dataset.genre || el.getAttribute("data-genre") || "";

      if (audioUrl) {
        allSongsRaw.push({
          id,
          title,
          author,
          coverUrl,
          audioUrl,
          genre,
        });
      }
    });

  const seenKeys = new Set();
  const candidates = [];
  allSongsRaw.forEach((song) => {
    if (!song || song.id == null) return;
    const key = _songKey(song);
    if (!key || seenKeys.has(key)) return;
    seenKeys.add(key);

    if (!existingIds.has(String(song.id))) {
      candidates.push(song);
    }
  });

  if (!candidates.length) {
    _toast("No hay más canciones para agregar.");
    return;
  }

  const backdrop = document.createElement("div");
  backdrop.className = "mdf-dialog-backdrop rep-addsongs-backdrop";

  const dialog = document.createElement("div");
  dialog.className = "mdf-dialog rep-addsongs-dialog";

  const titleEl = document.createElement("div");
  titleEl.className = "mdf-dialog-title";
  titleEl.textContent = `Agregar canciones a "${plCurrent.name || "Playlist"}"`;

  const msgEl = document.createElement("div");
  msgEl.className = "mdf-dialog-message";
  msgEl.textContent = "Elige las canciones que quieres agregar.";

  const listWrap = document.createElement("div");
  listWrap.className = "rep-addsongs-list";

  candidates.forEach((song) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "rep-addsongs-row";

    const spanTitle = document.createElement("span");
    spanTitle.className = "rep-addsongs-title";
    spanTitle.textContent = song.title || "—";

    const spanAuthor = document.createElement("span");
    spanAuthor.className = "rep-addsongs-author";
    spanAuthor.textContent =
      song.author || song.artist_display_name || "—";

    row.appendChild(spanTitle);
    row.appendChild(spanAuthor);

    row.addEventListener("click", async () => {
      if (row.disabled) return;
      row.disabled = true;
      row.classList.add("is-pending");

      const ok = await addSongToPlaylistCore(plKey, song);
      if (ok) {
        row.classList.remove("is-pending");
        row.classList.add("is-added");
      } else {
        row.disabled = false;
        row.classList.remove("is-pending");
      }
    });

    listWrap.appendChild(row);
  });

  const btns = document.createElement("div");
  btns.className = "mdf-dialog-buttons";

  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.className = "mdf-dialog-btn mdf-dialog-btn--ghost";
  btnClose.textContent = "Cerrar";

  btns.appendChild(btnClose);

  dialog.appendChild(titleEl);
  dialog.appendChild(msgEl);
  dialog.appendChild(listWrap);
  dialog.appendChild(btns);

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  const cleanup = () => {
    backdrop.remove();
  };

  btnClose.addEventListener("click", cleanup);
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) cleanup();
  });
}

// --------------------------------------------------------------------------
// Visibilidad y eliminación de playlists
// --------------------------------------------------------------------------
async function togglePlaylistVisibility(plKeyRaw) {
  const plKey = String(plKeyRaw || "").trim();
  if (!plKey) return;

  const pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
  const idx = pls.findIndex((p) => String(p.id) === plKey);
  if (idx < 0) {
    console.warn("toggleVisibility: playlist no encontrada:", plKey);
    return;
  }

  const pl = pls[idx];

  if (!canToggleVisibility(pl)) {
    console.warn("toggleVisibility: usuario no es dueño de la playlist:", plKey);
    _toast("Sólo el creador puede cambiar la visibilidad de esta playlist.");
    return;
  }

  const m = String(pl.id || "").match(/^pl:(\d+)$/);
  if (!m) {
    _toast("Esta playlist especial no se puede hacer pública desde aquí.");
    return;
  }
  const playlistId = m[1];

  const nowPrivate = pl.isprivate === true || pl.is_private === true;
  const nextPrivate = !nowPrivate;

  const csrftoken = getCookie("csrftoken") || "";

  try {
    const res = await fetch(
      `/playlist/${encodeURIComponent(playlistId)}/update/`,
      {
        method: "PUT",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrftoken,
        },
        body: JSON.stringify({ isprivate: nextPrivate }),
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("toggleVisibility backend error:", data);
      _toast(data?.error || "No se pudo cambiar la visibilidad.");
      return;
    }

    pls[idx] = {
      ...pl,
      isprivate: nextPrivate,
      is_private: nextPrivate,
    };
    window._playlists = pls;

    emitPlaylistsChangedCore();

    _toast(
      nextPrivate
        ? "Playlist marcada como privada"
        : "Playlist marcada como pública"
    );
  } catch (e) {
    console.error("Error al cambiar visibilidad de playlist:", e);
    _toast("No se pudo cambiar la visibilidad.");
  }
}

async function deletePlaylist(plKeyRaw) {
  const plKey = String(plKeyRaw || "").trim();
  if (!plKey) return;

  const pls = Array.isArray(window._playlists) ? window._playlists.slice() : [];
  const idx = pls.findIndex((p) => String(p.id) === plKey);
  if (idx < 0) {
    console.warn("deletePlaylist: playlist no encontrada:", plKey);
    return;
  }

  const pl = pls[idx];

  if (!canToggleVisibility(pl)) {
    _toast("Sólo el creador puede eliminar esta playlist.");
    return;
  }

  const m = String(pl.id || "").match(/^pl:(\d+)$/);
  if (!m) {
    _toast("Esta playlist especial no se puede eliminar desde aquí.");
    return;
  }
  const playlistId = m[1];

  const ok = await (typeof window.mdfConfirm === "function"
    ? window.mdfConfirm(
        `¿Seguro que quieres eliminar la playlist "${pl.name || "sin nombre"}"? Esta acción no se puede deshacer.`,
        { title: "Eliminar playlist" }
      )
    : Promise.resolve(true));

  if (!ok) return;

  const csrftoken = getCookie("csrftoken") || "";

  try {
    const res = await fetch(
      `/playlist/${encodeURIComponent(playlistId)}/delete/`,
      {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrftoken,
        },
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("deletePlaylist backend error:", data);
      _toast(data?.error || "No se pudo eliminar la playlist.");
      return;
    }

    _toast("Playlist eliminada.");

    const nextPls = pls.filter((p) => String(p.id) !== plKey);
    window._playlists = nextPls;

    if (Array.isArray(window.__MDF_MY_PLAYLISTS__)) {
      window.__MDF_MY_PLAYLISTS__ = window.__MDF_MY_PLAYLISTS__.filter(
        (p) => String(p.id) !== plKey
      );
    }
    if (Array.isArray(window.__MDF_PUBLIC_PLAYLISTS__)) {
      window.__MDF_PUBLIC_PLAYLISTS__ =
        window.__MDF_PUBLIC_PLAYLISTS__.filter(
          (p) => String(p.id) !== plKey
        );
    }

    if (window.__MDF_CURRENT_PL_ROOT === plKey) {
      window.__MDF_CURRENT_PL_ROOT = "pl:all";
    }

    emitPlaylistsChangedCore();
  } catch (e) {
    console.error("Error al eliminar playlist:", e);
    _toast("No se pudo eliminar la playlist.");
  }
}

// --------------------------------------------------------------------------
// Crear playlist desde el reproductor
// --------------------------------------------------------------------------
async function createPlaylistFromPlayer(name, { isPrivate = false } = {}) {
  const n = String(name || "").trim();
  if (!n) throw new Error("Nombre vacío");

  const body = { user: _getUsername(), name: n };
  const res = await fetch("/playlist/create/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": getCookie("csrftoken") || "",
    },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j?.playlist_id) {
    throw new Error(j?.error || "No se pudo crear la playlist");
  }

  const pid = j.playlist_id;

  if (isPrivate === true) {
    const r2 = await fetch(`/playlist/${pid}/update/`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken") || "",
      },
      credentials: "same-origin",
      body: JSON.stringify({ isprivate: true }),
    });
    if (!r2.ok) console.warn("No se pudo marcar como privada (continúo)");
  }

  emitPlaylistsChangedCore();
  return pid;
}

// --------------------------------------------------------------------------
// Toggle de "me gusta" para canciones
// --------------------------------------------------------------------------
function resolveLikeUrlForSongId(idSong) {
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

  console.warn("MDFActions: no se pudo resolver URL de like para canción", id);
  return "";
}

function toggleLikeFromReproductor(evt, idSongRaw) {
  if (evt) {
    evt.preventDefault();
    evt.stopPropagation();
  }

  const idSong = String(idSongRaw || "").trim();
  if (!idSong) return;

  const csrftoken = getCookie("csrftoken") || "";
  const url = resolveLikeUrlForSongId(idSong);

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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

      syncLikeModelFromClient(idSong, liked, meta);

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

// --------------------------------------------------------------------------
// API pública MDFActions e integración con MDFCore
// --------------------------------------------------------------------------
const MDFActions = {
  showToast: _toast,

  // Likes
  syncLikeModelFromClient,
  toggleLikeFromReproductor,

  // Playlists
  addSongToPlaylistCore,
  removeSongFromCurrentPlaylist,
  openAddSongsDialogForPlaylist,
  togglePlaylistVisibility,
  deletePlaylist,
  createPlaylistFromPlayer,
};

window.MDFActions = Object.assign(window.MDFActions || {}, MDFActions);

// Integración con MDFCore si ya está definido
if (window.MDFCore && typeof window.MDFCore === "object") {
  window.MDFCore.syncLikeModelFromClient = syncLikeModelFromClient;
  window.MDFCore.toggleLikeFromReproductor = (evt, idSong) =>
    toggleLikeFromReproductor(evt, idSong);

  window.MDFCore.removeSongFromCurrentPlaylist = (idSong, plKey) =>
    removeSongFromCurrentPlaylist(idSong, plKey);

  window.MDFCore.openAddSongsDialogForPlaylist = (plKey) =>
    openAddSongsDialogForPlaylist(plKey);

  window.MDFCore.togglePlaylistVisibility = (plKey) =>
    togglePlaylistVisibility(plKey);

  window.MDFCore.deletePlaylist = (plKey) => deletePlaylist(plKey);
}
