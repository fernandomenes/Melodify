// static/reproductor/reproductor-playlists.js
// Gestión de playlists desde el reproductor: creación y asignación de canciones.

(function () {
  "use strict";

  function _toast(msg) {
    const message = String(msg || "");
    if (!message) return;

    if (typeof window._toast === "function") {
      window._toast(message);
      return;
    }
    if (typeof window.mdfToast === "function") {
      window.mdfToast(message);
      return;
    }
    if (typeof window.__melodifyShowLikeToast === "function") {
      window.__melodifyShowLikeToast(message);
      return;
    }

    let t = document.getElementById("mdf-toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "mdf-toast";
      t.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);" +
        "background:#222;color:#eee;border:1px solid #333;border-radius:10px;" +
        "padding:10px 14px;z-index:99999;font-size:14px;opacity:0;transition:.18s";
      document.body.appendChild(t);
    }
    t.textContent = message;
    t.style.opacity = "1";
    clearTimeout(_toast._t);
    _toast._t = setTimeout(() => {
      t.style.opacity = "0";
    }, 1500);
  }

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

  function _getUsername() {
    const mc = document.getElementById("main-content");
    return (
      (window.__SESSION_USER__ &&
        (window.__SESSION_USER__.username || window.__SESSION_USER__.user)) ||
      (mc && mc.dataset && mc.dataset.username) ||
      (document.querySelector('meta[name="username"]') || {}).content ||
      (document.body && document.body.dataset
        ? document.body.dataset.username
        : "") ||
      ""
    );
  }

  function _getAllSongsUrl() {
    const main = document.getElementById("main-content");
    const ds = (main && main.dataset) || {};
    const bodyDs = (document.body && document.body.dataset) || {};
    return (
      window.__MDF_URL_ALL_SONGS__ ||
      bodyDs.urlAllSongsJson ||
      ds.urlAllSongsJson ||
      ds.urlAllsongsJson ||
      ds.urlAllSongs ||
      "/get_all_songs/"
    );
  }

  function _getPlaylistSongsUrl(backendId) {
    return `/playlist/${encodeURIComponent(backendId)}/songs/`;
  }

  // Actualiza la playlist activa en el reproductor y en el modelo en memoria
  function _refreshActivePlaylistInReproductor(backendIdRaw) {
    try {
      const backendId = String(backendIdRaw || "").trim();
      if (!backendId) return;

      const main = document.getElementById("main-content");
      if (!main) return;
      const view = (main.dataset.view || main.dataset.initialView || "").trim();
      if (view !== "reproductor") return;

      const left = document.querySelector(".rep-left");
      const ul = document.getElementById("rep-playlists");

      const currentPlaylistAttr =
        (left && left.dataset && left.dataset.currentPlaylist) || "";
      const currentBackendId = String(currentPlaylistAttr)
        .replace(/^pl:/, "")
        .trim();

      const shouldUpdateLeft =
        currentBackendId && currentBackendId === backendId;

      let liForBadge = null;
      if (ul) {
        const selector = `li[data-pl="pl:${backendId}"]`;
        try {
          liForBadge = ul.querySelector(selector);
        } catch {
          liForBadge =
            ul.querySelector(`li[data-pl="pl:${backendId}"]`) || null;
        }
      }

      let plName = "Playlist";
      if (liForBadge) {
        const nameEl =
          liForBadge.querySelector(".rep-pl-name") ||
          liForBadge.querySelector(".name") ||
          liForBadge.querySelector("span") ||
          liForBadge;
        plName = nameEl ? nameEl.textContent.trim() : plName;
      }

      const url = _getPlaylistSongsUrl(backendId);

      fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "X-Requested-With": "fetch" },
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!j || !Array.isArray(j.songs)) return;
          const songs = j.songs;

          if (
            shouldUpdateLeft &&
            window.MDFCore &&
            typeof window.MDFCore.renderLeftSongs === "function"
          ) {
            const playlistDomId =
              currentPlaylistAttr || `pl:${backendId}`;

            const leftNode = document.querySelector(".rep-left");
            const backBtn =
              leftNode &&
              leftNode.querySelector(".rep-pl-root-back");
            let backRoot = null;
            if (backBtn) {
              const rId = backBtn.getAttribute("data-root") || "";
              if (rId === "pl:my-root") backRoot = "my";
              else if (rId === "pl:public-root") backRoot = "public";
            }
            const removeTpl =
              (leftNode &&
                leftNode.dataset &&
                leftNode.dataset.removeSongUrlTemplate) ||
              "";

            const canEdit = !!removeTpl;

            window.MDFCore.renderLeftSongs(songs, plName, {
              countsMode: null,
              showLikeBtn: true,
              playlistId: playlistDomId,
              allowRemoveFromPlaylist: canEdit,
              allowAddToPlaylist: canEdit,
              backRoot,
              playlistRemoveSongUrlTemplate: removeTpl || null,
            });
          }

          try {
            if (liForBadge) {
              const badge = liForBadge.querySelector(".rep-badge");
              if (badge) badge.textContent = String(songs.length);
            }
          } catch (e) {
            console.warn("No se pudo actualizar badge de playlist:", e);
          }

          try {
            const fullId = `pl:${backendId}`;
            if (Array.isArray(window._playlists)) {
              const idx = window._playlists.findIndex(
                (p) => p && String(p.id) === String(fullId)
              );
              if (idx >= 0) {
                window._playlists[idx] = Object.assign(
                  {},
                  window._playlists[idx],
                  { songs: songs.slice() }
                );
              }
            }
          } catch (e) {
            console.warn("No se pudo sincronizar _playlists:", e);
          }
        })
        .catch((e) => {
          console.warn("Error refrescando playlist:", e);
        });
    } catch (e) {
      console.warn("refreshActivePlaylistInReproductor falló:", e);
    }
  }

  async function _createPlaylistFromPlayer(name, { isPrivate = false } = {}) {
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
    if (!res.ok || !j || !j.playlist_id) {
      throw new Error((j && j.error) || "No se pudo crear la playlist");
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
      if (!r2.ok) console.warn("No se pudo marcar como privada");
    }

    document.dispatchEvent(
      new CustomEvent("melodify:playlists:changed", {
        detail: { type: "create", playlistId: pid },
      })
    );
    return pid;
  }

  let _createPlOverlay = null;

  function _ensureCreatePlaylistOverlay() {
    if (_createPlOverlay) return _createPlOverlay;

    const overlay = document.createElement("div");
    overlay.id = "mdf-create-playlist-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="cpl-backdrop">
        <div class="cpl-modal" role="dialog" aria-modal="true">
          <h3 class="cpl-title">Nueva playlist</h3>
          <label class="cpl-label">Nombre</label>
          <input id="cpl-name" class="cpl-input" type="text" maxlength="80" placeholder="Mi playlist"/>
          <div class="cpl-error" id="cpl-error" aria-live="polite"></div>
          <div class="cpl-footer">
            <button type="button" class="cpl-cancel">Cancelar</button>
            <button type="button" class="cpl-ok">Crear</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", () => {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    });
    const modal = overlay.querySelector(".cpl-modal");
    if (modal) {
      modal.addEventListener("click", (ev) => ev.stopPropagation());
    }

    if (!document.getElementById("mdf-create-playlist-styles")) {
      const style = document.createElement("style");
      style.id = "mdf-create-playlist-styles";
      style.textContent = `
        #mdf-create-playlist-overlay{
          position:fixed;inset:0;display:none;
          align-items:center;justify-content:center;
          background:rgba(0,0,0,.55);z-index:9999;
        }
        #mdf-create-playlist-overlay.is-open{display:flex}
        #mdf-create-playlist-overlay .cpl-modal{
          background:#181818;color:#f5f5f5;border-radius:12px;
          padding:16px 18px;max-width:360px;width:min(360px,90vw);
          box-shadow:0 22px 45px rgba(0,0,0,.7);
          border:1px solid var(--line,#333);
        }
        .cpl-title{margin:0 0 8px;font-size:16px}
        .cpl-label{display:block;margin:6px 0 4px;font-size:12px;opacity:.9}
        .cpl-input{
          width:100%;padding:8px 10px;border-radius:8px;
          border:1px solid var(--line,#333);background:#202020;color:#eee;
        }
        .cpl-input:focus{outline:none;border-color:#4a3f8f}
        .cpl-error{
          min-height:16px;color:#f39;font-size:12px;margin:6px 0 0;
        }
        .cpl-footer{
          display:flex;gap:8px;justify-content:flex-end;margin-top:12px;
        }
        .cpl-cancel{
          border:none;background:transparent;color:#9aa0a6;cursor:pointer;
        }
        .cpl-ok{
          padding:6px 12px;border:1px solid var(--line,#333);
          background:#202020;color:#eee;border-radius:8px;cursor:pointer;
        }
        .cpl-ok:hover{background:#292929}
      `;
      document.head.appendChild(style);
    }

    _createPlOverlay = overlay;
    return overlay;
  }

  async function _openCreatePlaylistModal() {
    const ov = _ensureCreatePlaylistOverlay();
    const input = ov.querySelector("#cpl-name");
    const err = ov.querySelector("#cpl-error");
    const btnOk = ov.querySelector(".cpl-ok");
    const btnCa = ov.querySelector(".cpl-cancel");

    if (err) err.textContent = "";
    if (input) input.value = "";

    function close() {
      ov.classList.remove("is-open");
      ov.setAttribute("aria-hidden", "true");
      if (btnOk) btnOk.onclick = null;
      if (btnCa) btnCa.onclick = null;
      if (input) input.onkeydown = null;
    }

    async function submit() {
      const name = String((input && input.value) || "").trim();
      if (!name) {
        if (err) err.textContent = "Escribe un nombre.";
        if (input) input.focus();
        return;
      }
      try {
        const pid = await _createPlaylistFromPlayer(name, {
          isPrivate: true,
        });

        _toast("Playlist creada.");

        try {
          const mainContent = document.getElementById("main-content");
          const contentDiv = document.getElementById("content");
          if (
            mainContent &&
            contentDiv &&
            typeof window.renderMenuReproductor === "function"
          ) {
            await window.renderMenuReproductor({
              mainContent,
              contentDiv,
              URL_MI_MUSICA_JSON: mainContent.dataset
                ? mainContent.dataset.urlMiMusicaJson
                : undefined,
            });

            const ul = document.getElementById("rep-playlists");
            if (ul && pid != null && typeof CSS !== "undefined") {
              const li = ul.querySelector(
                `li[data-pl="pl:${CSS.escape(String(pid))}"]`
              );
              if (li && typeof li.click === "function") {
                li.click();
              }
            }
          }
        } catch (e) {
          console.warn("No se pudo refrescar el menú del reproductor:", e);
        }

        close();
      } catch (e) {
        if (err) {
          err.textContent =
            (e && e.message) || "No se pudo crear la playlist.";
        }
      }
    }

    if (btnOk) btnOk.onclick = submit;
    if (btnCa) btnCa.onclick = close;
    if (input) {
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") submit();
        if (ev.key === "Escape") close();
      };
    }

    ov.classList.add("is-open");
    ov.setAttribute("aria-hidden", "false");
    setTimeout(() => {
      if (input) input.focus();
    }, 50);
  }

  // Overlay "Agregar a playlist" (una canción)
  const _ADD_TO_PLAYLIST_FORBIDDEN = new Set([
    "pl:all",
    "pl:mine",
    "pl:likes",
    "pl:top10",
    "pl:discover",
    "pl:history",
  ]);

  let _addToPlaylistOverlay = null;

  function _ensureAddToPlaylistOverlay() {
    if (_addToPlaylistOverlay) return _addToPlaylistOverlay;

    const overlay = document.createElement("div");
    overlay.id = "mdf-add-to-playlist-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="atp-backdrop">
        <div class="atp-modal" role="dialog" aria-modal="true">
          <h3 class="atp-title">Agregar a playlist</h3>
          <p class="atp-subtitle">Elige una playlist para añadir esta canción.</p>
          <ul class="atp-list"></ul>
          <div class="atp-footer">
            <button type="button" class="atp-cancel">Cancelar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", () => {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    });

    const modal = overlay.querySelector(".atp-modal");
    if (modal) {
      modal.addEventListener("click", (ev) => ev.stopPropagation());
    }

    const btnCancel = overlay.querySelector(".atp-cancel");
    if (btnCancel) {
      btnCancel.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        overlay.classList.remove("is-open");
        overlay.setAttribute("aria-hidden", "true");
      });
    }

    if (!document.getElementById("mdf-add-to-playlist-styles")) {
      const style = document.createElement("style");
      style.id = "mdf-add-to-playlist-styles";
      style.textContent = `
        #mdf-add-to-playlist-overlay {
          position: fixed;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,.55);
          z-index: 9999;
        }
        #mdf-add-to-playlist-overlay.is-open {
          display: flex;
        }
        #mdf-add-to-playlist-overlay .atp-modal {
          background: #181818;
          color: #f5f5f5;
          border-radius: 12px;
          padding: 16px 18px 14px;
          max-width: 360px;
          width: min(360px, 90vw);
          box-shadow: 0 22px 45px rgba(0,0,0,.7);
          border: 1px solid var(--line, #333);
          font-size: 14px;
        }
        #mdf-add-to-playlist-overlay .atp-title {
          margin: 0 0 4px;
          font-size: 15px;
        }
        #mdf-add-to-playlist-overlay .atp-subtitle {
          margin: 0 0 10px;
          font-size: 12px;
          opacity: .8;
        }
        #mdf-add-to-playlist-overlay .atp-list {
          list-style: none;
          margin: 0 0 10px;
          padding: 0;
          max-height: 230px;
          overflow: auto;
        }
        #mdf-add-to-playlist-overlay .atp-item {
          margin: 3px 0;
        }
        #mdf-add-to-playlist-overlay .atp-btn {
          width: 100%;
          text-align: left;
          padding: 6px 9px;
          border-radius: 8px;
          border: 1px solid var(--line, #333);
          background: #202020;
          color: inherit;
          cursor: pointer;
          font-size: 13px;
        }
        #mdf-add-to-playlist-overlay .atp-btn:hover {
          background: #292929;
        }
        #mdf-add-to-playlist-overlay .atp-footer {
          display: flex;
          justify-content: flex-end;
        }
        #mdf-add-to-playlist-overlay .atp-cancel {
          border: none;
          background: transparent;
          color: #9aa0a6;
          cursor: pointer;
          font-size: 12px;
          padding: 4px 6px;
        }
        #mdf-add-to-playlist-overlay .atp-cancel:hover {
          color: #e0e0e0;
        }
      `;
      document.head.appendChild(style);
    }

    _addToPlaylistOverlay = overlay;
    return overlay;
  }

  async function _fetchBasicPlaylists() {
    try {
      const uname = _getUsername();
      const url = uname
        ? `/playlist/getAllList/?u=${encodeURIComponent(uname)}&t=${Date.now()}`
        : `/playlist/getAllList/?t=${Date.now()}`;

      const res = await fetch(url, {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "X-Requested-With": "fetch" },
      });
      if (!res.ok) return [];
      const data = await res.json();
      const lists =
        (Array.isArray(data) && data) ||
        (Array.isArray(data && data.playlists) && data.playlists) ||
        (Array.isArray(data && data.results) && data.results) ||
        [];

      const out = [];
      for (const pl of lists) {
        if (!pl) continue;
        const pid =
          pl.id ??
          pl.pk ??
          pl.id_playlist ??
          pl.playlist_id ??
          null;
        if (pid == null) continue;
        out.push({
          id: `pl:${pid}`,
          name: pl.name || pl.nombre || `Playlist ${pid}`,
        });
      }
      return out;
    } catch (e) {
      console.warn("fetchAllPlaylists (básico) falló:", e);
      return [];
    }
  }

  // Operaciones HTTP para agregar/quitar canciones
  async function _fallbackAddSongToPlaylistBackend(backendId, songId) {
    const pid = String(backendId || "").trim();
    const sid = String(songId || "").trim();
    if (!pid || !sid) throw new Error("Playlist o canción inválida.");

    let position = 1;
    try {
      const r = await fetch(
        `/playlist/${encodeURIComponent(pid)}/songs/`,
        {
          credentials: "same-origin",
          cache: "no-store",
          headers: { "X-Requested-With": "fetch" },
        }
      );
      if (r.ok) {
        const j = await r.json();
        const arr = Array.isArray(j && j.songs) ? j.songs : [];
        const already = arr.some((s) => {
          const idStr = String(s && s.id);
          return idStr === sid || idStr === String(Number(sid));
        });
        if (already) {
          _toast("Esta canción ya está en la playlist.");
          return;
        }
        position = (arr.length || 0) + 1;
      }
    } catch (e) {
      console.warn("No se pudo calcular posición en playlist:", e);
    }

    const csrftoken = getCookie("csrftoken") || "";
    const res = await fetch("/playlist/addsong/", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        ...(csrftoken ? { "X-CSRFToken": csrftoken } : {}),
      },
      body: JSON.stringify({
        playlist_id: Number(pid) || pid,
        song_id: Number(sid) || sid,
        position,
      }),
    });

    if (!res.ok) {
      let err = "";
      try {
        const j = await res.json();
        err = (j && j.error) || "";
      } catch {
        // ignore
      }
      throw new Error(err || `HTTP ${res.status}`);
    }

    document.dispatchEvent(
      new CustomEvent("melodify:playlists:changed", {
        detail: {
          type: "add-song",
          playlistId: pid,
          songId: sid,
          source: "reproductor-playlists",
        },
      })
    );

    _toast("Canción agregada a la playlist.");
  }

  async function _fallbackRemoveSongFromPlaylistBackend(backendId, songId) {
    const pid = String(backendId || "").trim();
    const sid = String(songId || "").trim();
    if (!pid || !sid) throw new Error("Playlist o canción inválida.");

    const csrftoken = getCookie("csrftoken") || "";
    const res = await fetch("/playlist/removesong/", {
      method: "DELETE",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        ...(csrftoken ? { "X-CSRFToken": csrftoken } : {}),
      },
      body: JSON.stringify({
        playlist_id: Number(pid) || pid,
        song_id: Number(sid) || sid,
      }),
    });

    if (!res.ok) {
      let err = "";
      try {
        const j = await res.json();
        err = (j && j.error) || "";
      } catch {
        // ignore
      }
      throw new Error(err || `HTTP ${res.status}`);
    }

    document.dispatchEvent(
      new CustomEvent("melodify:playlists:changed", {
        detail: {
          type: "remove-song",
          playlistId: pid,
          songId: sid,
          source: "reproductor-playlists",
        },
      })
    );

    _toast("Canción eliminada de la playlist.");
  }

  // Lógica de agregar / quitar / bulk
  async function _performAddSongToPlaylist(plId, idSong) {
    const backendId = String(plId || "").replace(/^pl:/, "").trim();
    const songId = String(idSong || "").trim();
    if (!backendId || !songId) {
      console.warn(
        "Playlist o canción inválida en _performAddSongToPlaylist:",
        plId,
        idSong
      );
      _toast("No se pudo agregar la canción.");
      return;
    }

    try {
      await _fallbackAddSongToPlaylistBackend(backendId, songId);
      _refreshActivePlaylistInReproductor(backendId);
    } catch (err) {
      console.error("Fallback agregar canción falló:", err);
      _toast("No se pudo agregar la canción.");
    }
  }

  async function _performRemoveSongFromPlaylist(plId, idSong) {
    const backendId = String(plId || "").replace(/^pl:/, "").trim();
    const songId = String(idSong || "").trim();
    if (!backendId || !songId) {
      console.warn(
        "Playlist o canción inválida en _performRemoveSongFromPlaylist:",
        plId,
        idSong
      );
      _toast("No se pudo quitar la canción de la playlist.");
      return;
    }

    try {
      await _fallbackRemoveSongFromPlaylistBackend(backendId, songId);
      _refreshActivePlaylistInReproductor(backendId);
    } catch (err) {
      console.error("Fallback quitar canción falló:", err);
      _toast("No se pudo quitar la canción de la playlist.");
    }
  }

  async function _bulkAddSongsToPlaylist(plId, songIds) {
    const ids = Array.from(
      new Set(
        (songIds || [])
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      )
    );
    for (const sid of ids) {
      await _performAddSongToPlaylist(plId, sid);
    }
  }

  async function _bulkRemoveSongsFromPlaylist(plId, songIds) {
    const ids = Array.from(
      new Set(
        (songIds || [])
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      )
    );
    for (const sid of ids) {
      await _performRemoveSongFromPlaylist(plId, sid);
    }
  }

  function openAddToPlaylistForSong(idSongRaw) {
    const idSong = String(idSongRaw || "").trim();
    if (!idSong) return;

    (async () => {
      try {
        const getCandidates = (list) => {
          const arr = Array.isArray(list) ? list : [];
          return arr.filter((p) => {
            const pid = String((p && p.id) || "").trim();
            if (!pid || _ADD_TO_PLAYLIST_FORBIDDEN.has(pid)) return false;
            return true;
          });
        };

        let pls = Array.isArray(window._playlists)
          ? window._playlists.slice()
          : [];
        let candidates = getCandidates(pls);

        if (!candidates.length) {
          const serverPlaylists = await _fetchBasicPlaylists();
          candidates = getCandidates(serverPlaylists);
        }

        if (!candidates.length) {
          _toast("No tienes playlists disponibles.");
          return;
        }

        const overlay = _ensureAddToPlaylistOverlay();
        const listEl = overlay.querySelector(".atp-list");
        if (!listEl) return;

        listEl.innerHTML = "";
        candidates.forEach((pl, idx) => {
          const li = document.createElement("li");
          li.className = "atp-item";

          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "atp-btn";
          btn.textContent = pl.name || `Playlist ${idx + 1}`;
          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            overlay.classList.remove("is-open");
            overlay.setAttribute("aria-hidden", "true");
            _performAddSongToPlaylist(pl.id, idSong);
          });

          li.appendChild(btn);
          listEl.appendChild(li);
        });

        overlay.classList.add("is-open");
        overlay.setAttribute("aria-hidden", "false");
      } catch (e) {
        console.error("openAddToPlaylistForSong falló:", e);
        alert("No se pudieron cargar tus playlists. Intenta de nuevo.");
      }
    })();
  }

  function _openAddToPlaylistDialog(evt, idSongRaw) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }
    const idSong = String(idSongRaw || "").trim();
    if (!idSong) return;
    openAddToPlaylistForSong(idSong);
  }

  // Overlay "Agregar canciones" para una playlist concreta
  let _addSongsOverlay = null;
  let _addSongsCache = null;

  function _ensureAddSongsOverlay() {
    if (_addSongsOverlay) return _addSongsOverlay;

    const overlay = document.createElement("div");
    overlay.id = "mdf-add-songs-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <div class="as-backdrop">
        <div class="as-modal" role="dialog" aria-modal="true">
          <div class="as-header">
            <h3 class="as-title">Agregar canciones a la playlist</h3>
            <button type="button" class="as-close" aria-label="Cerrar">×</button>
          </div>
          <div class="as-search-row">
            <input type="text" class="as-search" placeholder="Buscar por título o artista...">
          </div>
          <div class="as-body">
            <ul class="as-list"></ul>
          </div>
          <div class="as-footer">
            <button type="button" class="as-cancel">Cerrar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", () => {
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    });

    const modal = overlay.querySelector(".as-modal");
    if (modal) {
      modal.addEventListener("click", (ev) => ev.stopPropagation());
    }

    const btnClose = overlay.querySelector(".as-close");
    const btnCancel = overlay.querySelector(".as-cancel");
    const close = (ev) => {
      if (ev) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      overlay.classList.remove("is-open");
      overlay.setAttribute("aria-hidden", "true");
    };
    if (btnClose) btnClose.addEventListener("click", close);
    if (btnCancel) btnCancel.addEventListener("click", close);

    if (!document.getElementById("mdf-add-songs-styles")) {
      const style = document.createElement("style");
      style.id = "mdf-add-songs-styles";
      style.textContent = `
        #mdf-add-songs-overlay {
          position: fixed;
          inset: 0;
          display: none;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,.55);
          z-index: 10000;
        }
        #mdf-add-songs-overlay.is-open {
          display: flex;
        }
        #mdf-add-songs-overlay .as-modal {
          background: #181818;
          color: #f5f5f5;
          border-radius: 12px;
          padding: 14px 16px 12px;
          max-width: 520px;
          width: min(520px, 95vw);
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 22px 45px rgba(0,0,0,.7);
          border: 1px solid var(--line, #333);
          font-size: 14px;
        }
        #mdf-add-songs-overlay .as-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }
        #mdf-add-songs-overlay .as-title {
          margin: 0;
          font-size: 15px;
        }
        #mdf-add-songs-overlay .as-close {
          border: none;
          background: transparent;
          color: #aaa;
          cursor: pointer;
          font-size: 18px;
          padding: 0 4px;
        }
        #mdf-add-songs-overlay .as-close:hover {
          color: #fff;
        }
        #mdf-add-songs-overlay .as-search-row {
          margin-bottom: 8px;
        }
        #mdf-add-songs-overlay .as-search {
          width: 100%;
          padding: 6px 9px;
          border-radius: 8px;
          border: 1px solid var(--line, #333);
          background: #202020;
          color: #eee;
          font-size: 13px;
        }
        #mdf-add-songs-overlay .as-search:focus {
          outline: none;
          border-color: #4a3f8f;
        }
        #mdf-add-songs-overlay .as-body {
          flex: 1;
          overflow: auto;
          margin-bottom: 8px;
        }
        #mdf-add-songs-overlay .as-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        #mdf-add-songs-overlay .as-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 6px 4px;
          border-radius: 8px;
        }
        #mdf-add-songs-overlay .as-item:nth-child(odd) {
          background: rgba(255,255,255,0.02);
        }
        #mdf-add-songs-overlay .as-meta {
          min-width: 0;
          margin-right: 8px;
        }
        #mdf-add-songs-overlay .as-title-text {
          font-size: 13px;
          font-weight: 500;
          margin-bottom: 1px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #mdf-add-songs-overlay .as-artist {
          font-size: 11px;
          opacity: .8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        #mdf-add-songs-overlay .as-add-btn {
          border-radius: 999px;
          padding: 4px 10px;
          font-size: 12px;
          border: 1px solid var(--line, #444);
          background: #202020;
          color: #eee;
          cursor: pointer;
          white-space: nowrap;
        }
        #mdf-add-songs-overlay .as-add-btn:hover {
          background: #292929;
        }
        #mdf-add-songs-overlay .as-footer {
          display: flex;
          justify-content: flex-end;
        }
        #mdf-add-songs-overlay .as-cancel {
          border: none;
          background: transparent;
          color: #9aa0a6;
          cursor: pointer;
          font-size: 12px;
          padding: 4px 6px;
        }
        #mdf-add-songs-overlay .as-cancel:hover {
          color: #e0e0e0;
        }
      `;
      document.head.appendChild(style);
    }

    _addSongsOverlay = overlay;
    return overlay;
  }

  async function _loadAllSongsForOverlay() {
    if (Array.isArray(_addSongsCache) && _addSongsCache.length) {
      return _addSongsCache;
    }

    if (
      Array.isArray(window.__MDF_ALL_SONGS__) &&
      window.__MDF_ALL_SONGS__.length
    ) {
      _addSongsCache = window.__MDF_ALL_SONGS__;
      return _addSongsCache;
    }

    const url = _getAllSongsUrl();
    const res = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "fetch" },
    });
    if (!res.ok) {
      throw new Error("HTTP " + res.status);
    }
    const data = await res.json();

    const raw =
      (Array.isArray(data?.songs) && data.songs) ||
      (Array.isArray(data?.results) && data.results) ||
      (Array.isArray(data?.playlist?.songs) && data.playlist.songs) ||
      (Array.isArray(data) && data) ||
      [];

    _addSongsCache = raw;
    return raw;
  }

  function _renderAddSongsList(overlay, songs, backendId) {
    const listEl = overlay.querySelector(".as-list");
    const searchInput = overlay.querySelector(".as-search");
    if (!listEl) return;

    const all = Array.isArray(songs) ? songs : [];

    function applyFilter() {
      const q = (searchInput && searchInput.value) || "";
      const needle = q.toLowerCase().trim();
      listEl.innerHTML = "";

      let filtered = all;
      if (needle) {
        filtered = all.filter((s) => {
          const t = (s.title || "").toLowerCase();
          const a =
            (s.artist_display_name || s.author || "").toLowerCase();
          return t.includes(needle) || a.includes(needle);
        });
      }

      if (!filtered.length) {
        const li = document.createElement("li");
        li.className = "as-item";
        li.textContent = "No se encontraron canciones.";
        listEl.appendChild(li);
        return;
      }

      filtered.forEach((s) => {
        const li = document.createElement("li");
        li.className = "as-item";

        const meta = document.createElement("div");
        meta.className = "as-meta";

        const t = document.createElement("div");
        t.className = "as-title-text";
        t.textContent = s.title || "Sin título";

        const a = document.createElement("div");
        a.className = "as-artist";
        a.textContent =
          s.artist_display_name || s.author || "—";

        meta.appendChild(t);
        meta.appendChild(a);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "as-add-btn";
        btn.textContent = "Agregar";
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const sid = s.id;
          if (sid == null) return;
          _performAddSongToPlaylist("pl:" + backendId, sid);
        });

        li.appendChild(meta);
        li.appendChild(btn);
        listEl.appendChild(li);
      });
    }

    if (searchInput && !searchInput._mdfBound) {
      searchInput._mdfBound = true;
      searchInput.addEventListener("input", applyFilter);
    }

    applyFilter();
  }

  function _openAddSongsDialogForPlaylist(playlistIdRaw) {
    const plId = String(playlistIdRaw || "").trim();
    if (!plId) return;

    const backendId = plId.replace(/^pl:/, "");

    (async () => {
      try {
        const overlay = _ensureAddSongsOverlay();
        overlay.dataset.playlistId = backendId;

        const titleNode = overlay.querySelector(".as-title");
        if (titleNode) {
          titleNode.textContent =
            "Agregar canciones a la playlist";
        }

        overlay.classList.add("is-open");
        overlay.setAttribute("aria-hidden", "false");

        const songs = await _loadAllSongsForOverlay();
        _renderAddSongsList(overlay, songs, backendId);
      } catch (e) {
        console.error("openAddSongsDialogForPlaylist falló:", e);
        _toast(
          "No se pudo abrir la lista de canciones para esta playlist."
        );
      }
    })();
  }

  document.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-add-songs-pl]");
    if (!btn) return;

    ev.preventDefault();
    ev.stopPropagation();

    const raw =
      btn.getAttribute("data-add-songs-pl") ||
      (btn.dataset && btn.dataset.addSongsPl) ||
      "";

    if (!raw) return;

    _openAddSongsDialogForPlaylist(raw);
  });

  const api = {
    openCreatePlaylistModal: _openCreatePlaylistModal,
    openAddToPlaylistDialog: _openAddToPlaylistDialog,
    openAddSongsDialogForPlaylist: _openAddSongsDialogForPlaylist,
    performAddSongToPlaylist: _performAddSongToPlaylist,
    performRemoveSongFromPlaylist: _performRemoveSongFromPlaylist,
    bulkAddSongsToPlaylist: _bulkAddSongsToPlaylist,
    bulkRemoveSongsFromPlaylist: _bulkRemoveSongsFromPlaylist,
  };

  window.MDFPlaylists = Object.assign(window.MDFPlaylists || {}, api);
})();
