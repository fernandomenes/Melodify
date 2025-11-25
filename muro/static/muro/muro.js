// static/muro/muro.js
// ============================================================================
// Melodify – Muro del artista
// Reproducción básica, selección, borrado, subida, likes y playlists.
// ============================================================================

(function () {
  "use strict";

  // Helpers DOM y cabeceras comunes
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const H  = { "X-Requested-With": "fetch" };

  function getCookie(name) {
    const m = document.cookie.match(new RegExp("(^|;)\\s*" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[2]) : "";
  }

  function getCSRF() {
    return (
      document.querySelector('meta[name="csrf-token"]')?.getAttribute("content") ||
      getCookie("csrftoken")
    );
  }

  // Reproductor usado en el muro (stub local o MDFCore global)
  let muroPlayer = null;

  // Toast local para likes / playlists
  let likeToastTimer = null;

  function showLikeToast(message) {
    if (!message) return;
    const toast = document.getElementById("like-toast");
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add("show");

    if (likeToastTimer) {
      clearTimeout(likeToastTimer);
    }
    likeToastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2000);
  }

  // Stub de reproducción si no existe MDFCore global
  (function setupMuroCore() {
    if (window.MDFCore && typeof window.MDFCore.playFromDomItem === "function") {
      muroPlayer = window.MDFCore;
      return;
    }

    const audio = new Audio();
    audio.preload = "metadata";

    let queue      = [];
    let queueCards = [];
    let index      = -1;

    function dispatch(name, detail) {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function datasetToTrack(card) {
      const ds = card.dataset || {};
      return {
        id:       ds.songId   || null,
        title:    ds.title    || "—",
        author:   ds.artist   || "—",
        coverUrl: ds.coverUrl || "",
        audioUrl: ds.audioUrl || "",
        genre:    ds.genre    || "",
      };
    }

    function clearPlayingClass() {
      if (!queueCards || !queueCards.length) return;
      queueCards.forEach((c) => c.classList && c.classList.remove("is-playing"));
    }

    function markCurrentPlaying() {
      if (!queueCards || !queueCards.length) return;
      clearPlayingClass();
      const card = queueCards[index];
      if (card) card.classList.add("is-playing");
    }

    function buildQueueFromCard(card) {
      const rootGrid = card.closest("#songs-grid") || document;
      queueCards = Array.from(rootGrid.querySelectorAll(".js-song-card"));
      queue      = queueCards.map(datasetToTrack);
      index      = Math.max(0, queueCards.indexOf(card));
    }

    function playIndex(i) {
      if (!queue.length) {
        clearPlayingClass();
        return;
      }

      if (i < 0) i = queue.length - 1;
      if (i >= queue.length) i = 0;
      index = i;

      const track = queue[index];
      if (!track || !track.audioUrl) {
        clearPlayingClass();
        return;
      }

      if (audio.src !== track.audioUrl) {
        audio.src = track.audioUrl;
      }
      audio.play().catch(() => {});

      markCurrentPlaying();

      dispatch("melodify:trackmeta", {
        title:  track.title,
        artist: track.author,
        cover:  track.coverUrl || "",
        genre:  track.genre || "",
      });

      dispatch("melodify:trackchange", {
        index,
        total: queue.length,
        id:    track.id || null,
      });
    }

    audio.addEventListener("timeupdate", () => {
      dispatch("melodify:time", {
        currentTime: audio.currentTime || 0,
        duration:    audio.duration || 0,
      });
    });

    audio.addEventListener("loadedmetadata", () => {
      dispatch("melodify:loaded", { duration: audio.duration || 0 });
      dispatch("melodify:audioReady", { audio });
    });

    audio.addEventListener("play", () => {
      dispatch("melodify:state", { playing: true });
    });

    audio.addEventListener("pause", () => {
      dispatch("melodify:state", { playing: false });
    });

    audio.addEventListener("ended", () => {
      if (queue.length > 0) playIndex(index + 1);
    });

    const core = {
      __fromMuro: true,

      getAudio() {
        return audio;
      },

      playFromDomItem(card) {
        if (!card) return;
        buildQueueFromCard(card);
        playIndex(index);
      },

      prev() {
        if (!queue.length) return;
        playIndex(index - 1);
      },

      next() {
        if (!queue.length) return;
        playIndex(index + 1);
      },

      toggle() {
        if (audio.paused) audio.play().catch(() => {});
        else audio.pause();
      },

      seekPercent(p) {
        const pct = Math.max(0, Math.min(1, Number(p) || 0));
        if (audio.duration > 0 && Number.isFinite(audio.duration)) {
          audio.currentTime = audio.duration * pct;
        }
      },

      setVolume(v) {
        const vol = Math.max(0, Math.min(1, Number(v) || 0));
        audio.volume = vol;
      },
    };

    if (!window.MDFCore) {
      window.MDFCore = core;
      window.__MDF_MURO_CORE__ = core;
      muroPlayer = core;

      dispatch("melodify:audioReady", { audio });
      window.__MDF_FORMS_HIDE_BAR__ = false;
      document.dispatchEvent(new CustomEvent("melodify:bar:shouldShow"));
    } else {
      if (typeof window.MDFCore.playFromDomItem !== "function") {
        window.MDFCore.playFromDomItem = core.playFromDomItem;
      }
      muroPlayer = window.MDFCore;
    }
  })();

  // Elementos base del muro
  const root = document.getElementById("muro-content");
  if (!root) return;

  const inlineMsg = root.querySelector("#inline-msg");

  function showInlineMsg(text, type = "error") {
    if (!inlineMsg) {
      if (text) window.alert(text);
      return;
    }
    inlineMsg.textContent = text || "";
    inlineMsg.style.display = text ? "block" : "none";
    inlineMsg.classList.remove("error");
    if (type === "error" && text) {
      inlineMsg.classList.add("error");
    }
  }

  const grid     = $("#songs-grid", root);
  const selAll   = $("#sel-all", root);
  const btnBulk  = $("#bulk-delete", root);
  const selCount = $("#sel-count", root);
  const undoForm = $("#muro-undo-form", root);

  const main = document.getElementById("main-content");
  const URLS = {
    bulkDelete:
      main?.dataset?.urlMuroBulk || "/mi-muro/canciones/eliminar-multiples/",
    undo:       main?.dataset?.urlRevertirMuro || "/mi-muro/undo/",
    follow:     main?.dataset?.urlFollowArtist || "",
    followersFragment:
      main?.dataset?.urlFollowersFragment || "",
  };

  const ARTIST = {
    username: main?.dataset?.artistUsername || "",
    isFollowing:
      main?.dataset?.artistFollowing === "1" ||
      main?.dataset?.artistFollowing === "true",
  };

  // Barra de "Deshacer" (undo)
  function showUndo(label) {
    const bar = $("#undo-bar", root);
    const lbl = $("#undo-label", root);
    if (lbl) lbl.textContent = label || "Acción realizada.";
    if (bar) bar.style.display = "flex";
  }

  function hideUndo() {
    const bar = $("#undo-bar", root);
    const lbl = $("#undo-label", root);
    if (lbl) lbl.textContent = "";
    if (bar) bar.style.display = "none";
  }

  // Click en tarjeta → reproducir (evitando controles internos)
  function bindSongCardsToGlobalPlayer(scopeRoot = document) {
    const cards = scopeRoot.querySelectorAll(".js-song-card");
    if (!cards.length) return;

    cards.forEach((card) => {
      if (card.dataset.playerBound === "1") return;
      card.dataset.playerBound = "1";

      card.addEventListener("click", (ev) => {
        if (ev.target.closest('input[type="checkbox"], button, a, form')) {
          return;
        }

        const core = muroPlayer || window.MDFCore;
        if (!core || typeof core.playFromDomItem !== "function") {
          console.warn("MDFCore no disponible en muro.");
          return;
        }

        core.playFromDomItem(card);
        window.__MDF_FORMS_HIDE_BAR__ = false;
        document.dispatchEvent(new CustomEvent("melodify:bar:shouldShow"));
      });
    });
  }

  // Selección múltiple de canciones
  const selected     = new Set();
  const removedCache = new Map();

  function updateUI() {
    const n = selected.size;

    if (btnBulk) {
      btnBulk.disabled = n === 0;
    }
    if (selCount) {
      selCount.textContent = n
        ? `${n} seleccionada${n !== 1 ? "s" : ""}`
        : "";
    }

    const checks = grid ? $$(".song-select", grid) : [];
    if (selAll) {
      selAll.checked = checks.length > 0 && checks.every((ch) => ch.checked);
      selAll.indeterminate = n > 0 && n < checks.length;
    }
  }

  function resetSelection() {
    selected.clear();
    if (grid) {
      $$(".song-select", grid).forEach((ch) => {
        ch.checked = false;
      });
    }
    updateUI();
  }

  // Confirm genérico (modal o window.confirm)
  function confirmWithModal(texto = "¿Eliminar este elemento?") {
    const modal     = $("#confirm-modal", document);
    const dlg       = modal?.querySelector(".dialog");
    const txt       = modal?.querySelector("#confirm-text");
    const btnOk     = modal?.querySelector("#confirm-accept");
    const btnCancel = modal?.querySelector("#confirm-cancel");

    if (!modal || !btnOk || !btnCancel) {
      return Promise.resolve(window.confirm(texto));
    }
    if (txt) txt.textContent = texto;

    return new Promise((resolve) => {
      function cleanup() {
        modal.classList.remove("show");
        btnOk.removeEventListener("click", onOk);
        btnCancel.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKey);
      }
      function onOk() {
        cleanup();
        resolve(true);
      }
      function onCancel() {
        cleanup();
        resolve(false);
      }
      function onKey(e) {
        if (e.key === "Escape") onCancel();
      }

      btnOk.addEventListener("click", onOk);
      btnCancel.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKey);

      modal.classList.add("show");
      (dlg || modal).focus?.();
    });
  }

  // Checkboxes de selección múltiple
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (!t) return;

    if (t.id === "sel-all") {
      if (!grid) return;
      $$(".song-select", grid).forEach((ch) => {
        ch.checked = t.checked;
        const id = parseInt(ch.value, 10);
        if (!isNaN(id)) {
          if (t.checked) selected.add(id);
          else selected.delete(id);
        }
      });
      updateUI();
      return;
    }

    if (t.classList && t.classList.contains("song-select")) {
      const id = parseInt(t.value, 10);
      if (!isNaN(id)) {
        if (t.checked) selected.add(id);
        else selected.delete(id);
        updateUI();
      }
    }
  });

  // Cache de tarjetas antes de delete individual
  root.addEventListener(
    "submit",
    (e) => {
      const f = e.target;
      if (!f || !f.classList || !f.classList.contains("js-delete-form")) return;

      const card = f.closest(".js-song-card");
      const sid  = Number(f.dataset.songId || card?.dataset.songId || NaN);
      if (card && !Number.isNaN(sid) && !removedCache.has(sid)) {
        removedCache.set(sid, card);
      }
    },
    true
  );

  // Delete individual
  root.addEventListener(
    "submit",
    async (e) => {
      const f = e.target;
      if (!f || !f.classList || !f.classList.contains("js-delete-form")) return;

      e.preventDefault();

      const title = f.dataset.title || "este elemento";
      const ok = await confirmWithModal(`¿Eliminar “${title}”?`);
      if (!ok) return;

      const card = f.closest(".js-song-card");

      try {
        const fd = new FormData(f);
        const res = await fetch(f.action, {
          method: "POST",
          body: fd,
          headers: { ...H, "X-CSRFToken": getCSRF() },
          credentials: "same-origin",
        });

        const ct = (res.headers.get("content-type") || "").toLowerCase();

        if (ct.includes("application/json")) {
          const j = await res.json();
          if (card) card.remove();
          showUndo(j.undo_label || `Se eliminó “${title}”.`);
          resetSelection();
          return;
        }

        if (res.status === 204) {
          if (card) card.remove();
          showUndo(`Se eliminó “${title}”.`);
          resetSelection();
          return;
        }

        location.reload();
      } catch {
        location.reload();
      }
    },
    true
  );

  // Delete múltiple
  btnBulk?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (selected.size === 0) return;

    const n    = selected.size;
    const noun = n === 1 ? "canción seleccionada" : "canciones seleccionadas";

    const ok = await confirmWithModal(`¿Eliminar ${n} ${noun}?`);
    if (!ok) return;

    try {
      const fd = new FormData();
      Array.from(selected).forEach((id) => fd.append("ids[]", String(id)));
      fd.append("ids", JSON.stringify(Array.from(selected)));

      const res = await fetch(URLS.bulkDelete, {
        method: "POST",
        body: fd,
        headers: { ...H, "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) {
        location.reload();
        return;
      }

      const j = await res.json();
      if (!j.ok) {
        alert(j.error || "No fue posible eliminar las canciones.");
        return;
      }

      (j.removed_ids || []).forEach((id) => {
        const card = grid?.querySelector(`.js-song-card[data-song-id="${id}"]`);
        if (card) {
          removedCache.set(id, card);
          card.remove();
        }
      });

      selected.clear();
      updateUI();
      showUndo(j.undo_label || `Se eliminaron ${n} ${noun}.`);
    } catch {
      location.reload();
    }
  });

  // Undo de acciones en el muro
  undoForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData(undoForm);
      const res = await fetch(URLS.undo || undoForm.action, {
        method: "POST",
        body: fd,
        headers: { ...H, "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      if (res.status === 204) {
        const frag = document.createDocumentFragment();
        removedCache.forEach((node) => {
          if (node) frag.appendChild(node);
        });
        if (frag.childNodes.length && grid) {
          grid.prepend(frag);
          bindSongCardsToGlobalPlayer(root);
        }
        removedCache.clear();
        resetSelection();
        hideUndo();
        return;
      }

      location.reload();
    } catch {
      location.reload();
    }
  });

  // Menú lateral del muro
  (function setupMuroMenuToggle() {
    const btnToggle   = document.getElementById("menu-toggle-btn");
    const logoToggle  = document.getElementById("toggle-menu");
    const menuLateral = document.getElementById("menuLateral");
    const mainContent = document.getElementById("main-content");
    const header      = document.getElementById("header");

    if (!menuLateral || !mainContent) return;

    function applyCollapsed(collapsed) {
      menuLateral.classList.toggle("collapsed", collapsed);
      mainContent.classList.toggle("menuLateral-collapsed", collapsed);
      header?.classList.toggle("menuLateral-collapsed", collapsed);
      document
        .querySelector("._mdf-player-bar")
        ?.classList.toggle("menuLateral-collapsed", collapsed);
    }

    // Estado inicial: barra lateral oculta
    applyCollapsed(true);

    function handleToggleClick() {
      const nowCollapsed = menuLateral.classList.contains("collapsed");
      applyCollapsed(!nowCollapsed);
    }

    btnToggle?.addEventListener("click", handleToggleClick);
    logoToggle?.addEventListener("click", handleToggleClick);
  })();

  // Menú de usuario y logout
  (function userMenu() {
    const trigger = document.getElementById("user-trigger");
    const menu    = document.getElementById("user-menu");

    if (trigger && menu) {
      trigger.addEventListener("click", (e) => {
        const inside = e.target.closest("#user-menu");
        if (!inside) {
          e.preventDefault();
          menu.style.display = menu.style.display === "block" ? "none" : "block";
        }
      });
    }

    const logout = document.getElementById("menu-logout");
    if (logout) {
      logout.addEventListener("click", async (e) => {
        e.preventDefault();
        const url = window.MELODIFY_LOGOUT_URL || "/logout/";

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "X-CSRFToken": getCSRF() },
            credentials: "same-origin",
          });

          if (res.redirected) {
            location.href = res.url;
            return;
          }
          if (res.ok) {
            location.href =
              document.getElementById("main-content")?.dataset.urlHome || "/";
            return;
          }
        } catch {
          // fallback a redirección directa
        }
        location.href = url;
      });
    }
  })();

  // Subida de canción con barra de progreso (modo AJAX opcional)
  (function singleUploadProgress() {
    const form = document.getElementById("form-upload");
    if (!form) return;

    const genreSel   = form.querySelector("#genre");
    const genreOther = document.getElementById("genre-other");
    if (genreSel && genreOther) {
      const toggleOther = () => {
        genreOther.style.display =
          genreSel.value === "_other" ? "block" : "none";
      };
      genreSel.addEventListener("change", toggleOther);
      toggleOther();
    }

    const bar     = document.getElementById("upload-bar");
    const barFill = bar?.querySelector(".progress > i");
    const barPct  = document.getElementById("upload-pct");
    const btn     = form.querySelector('button[type="submit"]');

    function setPct(p) {
      const pct = Math.max(0, Math.min(100, p | 0));
      bar?.classList.add("is-visible");
      if (barFill) barFill.style.width = pct + "%";
      if (barPct)  barPct.textContent  = pct + "%";
    }

    form.addEventListener("submit", (e) => {
      if (form.dataset.ajax !== "1") return;
      e.preventDefault();

      showInlineMsg("", "error");

      const fd   = new FormData(form);
      const xhr  = new XMLHttpRequest();
      const csrf = getCSRF();

      xhr.open("POST", form.action, true);
      if (csrf) xhr.setRequestHeader("X-CSRFToken", csrf);
      xhr.setRequestHeader("X-Requested-With", "fetch");

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setPct((ev.loaded / ev.total) * 100);
        else setPct(10);
      };

      xhr.onloadstart = () => {
        btn?.setAttribute("disabled", "disabled");
        setPct(0);
      };

      xhr.onerror = xhr.onabort = () => {
        setPct(0);
        bar?.classList.remove("is-visible");
        btn?.removeAttribute("disabled");
        showInlineMsg(
          "No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.",
          "error"
        );
      };

      xhr.onload = () => {
        const ct = (xhr.getResponseHeader("content-type") || "").toLowerCase();
        let data = null;
        if (ct.includes("application/json")) {
          try {
            data = JSON.parse(xhr.responseText || "{}");
          } catch {
            data = null;
          }
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          setPct(100);
          setTimeout(() => location.reload(), 500);
          return;
        }

        btn?.removeAttribute("disabled");
        bar?.classList.remove("is-visible");

        if (data && typeof data.error === "string" && data.error) {
          showInlineMsg(data.error, "error");
        } else {
          const msg =
            xhr.status === 0
              ? "No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo."
              : "Error al subir la canción (" + xhr.status + ").";
          showInlineMsg(msg, "error");
        }
      };

      xhr.send(fd);
    });
  })();

  // Likes en el muro (UI)
  function setLikeUIForSong(idStr, liked) {
    if (!idStr) return;
    document
      .querySelectorAll(`.song-like-btn[data-song-id="${idStr}"]`)
      .forEach((btn) => {
        btn.dataset.liked = liked ? "1" : "0";
        btn.classList.toggle("liked", liked);
        btn.classList.toggle("is-liked", liked);
        btn.classList.toggle("active", liked);
        btn.textContent = liked ? "♥" : "♡";
        btn.setAttribute(
          "aria-label",
          liked ? "Quitar de tus Me gusta" : "Añadir a tus Me gusta"
        );
      });
  }

  // Toggle de like desde el muro
  window.toggleSongLikeFromMuro = async function (evt, songId, btn) {
    try {
      evt?.preventDefault?.();
      evt?.stopPropagation?.();
    } catch {}

    if (!btn && evt && evt.target) {
      btn = evt.target.closest(".song-like-btn");
    }

    const idStr = String(
      songId ||
      (btn && (btn.dataset.songId || btn.getAttribute("data-song-id"))) ||
      ""
    ).trim();
    if (!idStr) return;

    const idNum = Number(idStr);
    if (!idNum || Number.isNaN(idNum)) return;

    const anyBtn =
      btn ||
      document.querySelector(`.song-like-btn[data-song-id="${idStr}"]`);

    const prevLiked = anyBtn?.dataset?.liked === "1";
    const nowLiked  = !prevLiked;

    setLikeUIForSong(idStr, nowLiked);
    showLikeToast(
      nowLiked ? "Añadida a tus Me gusta" : "Quitada de tus Me gusta"
    );

    try {
      const csrf = getCSRF();
      const res = await fetch(`/api/like/song/${encodeURIComponent(idNum)}/`, {
        method: "POST",
        headers: {
          "X-CSRFToken": csrf || "",
          "X-Requested-With": "fetch",
        },
        credentials: "same-origin",
      });

      if (!res.ok) {
        setLikeUIForSong(idStr, prevLiked);
        showLikeToast("No se pudo actualizar el like.");
        return;
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const data = await res.json().catch(() => null);
        if (data && typeof data.liked !== "undefined") {
          setLikeUIForSong(idStr, !!data.liked);
        }
      }
    } catch (err) {
      console.error("MURO: error al hacer POST de like:", err);
      setLikeUIForSong(idStr, prevLiked);
      showLikeToast("No se pudo actualizar el like.");
    }
  };

  // Diálogo de playlists desde el muro
  window.openAddToPlaylistFromMuro = function (evt, songId) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }

    const id = Number(songId);
    if (!id || Number.isNaN(id)) return;

    if (typeof window.openAddToPlaylistForSong === "function") {
      window.openAddToPlaylistForSong(id);
      return;
    }

    if (
      window.MDFCore &&
      typeof window.MDFCore.openAddToPlaylistDialog === "function"
    ) {
      window.MDFCore.openAddToPlaylistDialog(evt, id);
      return;
    }

    alert("No se encontró la función para agregar a playlist.");
  };

  // Botón de seguir / dejar de seguir artista
  function setupFollowButton() {
    const btn = document.getElementById("btn-follow-artist");
    if (!btn || !URLS.follow || !ARTIST.username) return;

    const counter = document.getElementById("muro-followers-count");

    function applyState(following, followers) {
      btn.dataset.following = following ? "1" : "0";
      btn.textContent = following ? "Siguiendo" : "Seguir";
      btn.classList.toggle("is-following", following);
      if (counter && typeof followers === "number") {
        counter.textContent = String(followers);
      }
    }

    const initialFollowers = Number(counter?.textContent || 0);
    applyState(ARTIST.isFollowing, initialFollowers);

    btn.addEventListener("click", async (e) => {
      e.preventDefault();

      const prevFollowing = btn.dataset.following === "1";
      const optimisticFollowing = !prevFollowing;
      applyState(optimisticFollowing);

      try {
        const res = await fetch(URLS.follow, {
          method: "POST",
          headers: { ...H, "X-CSRFToken": getCSRF() },
          credentials: "same-origin",
        });

        if (!res.ok) {
          applyState(prevFollowing, initialFollowers);
          showLikeToast("No se pudo actualizar el seguimiento.");
          return;
        }

        const data = await res.json().catch(() => null);
        if (data && typeof data.following !== "undefined") {
          ARTIST.isFollowing = !!data.following;
          applyState(ARTIST.isFollowing, data.followers);
          showLikeToast(
            ARTIST.isFollowing
              ? "Ahora sigues a este artista"
              : "Dejaste de seguir al artista"
          );
        } else {
          applyState(prevFollowing, initialFollowers);
          showLikeToast("No se pudo actualizar el seguimiento.");
        }
      } catch (err) {
        console.error("MURO: error al seguir artista:", err);
        applyState(prevFollowing, initialFollowers);
        showLikeToast("No se pudo actualizar el seguimiento.");
      }
    });
  }

  // Lista de seguidores (carga perezosa desde el backend)
  function setupFollowersList() {
    const btn = document.getElementById("btn-show-followers");
    const box = document.getElementById("muro-followers-list");
    if (!btn || !box || !URLS.followersFragment) return;

    let visible = false;

    async function loadAndToggle() {
      if (!visible && !box.dataset.loaded) {
        try {
          box.innerHTML =
            '<p class="muted" style="margin:0;">Cargando seguidores…</p>';

          const res = await fetch(URLS.followersFragment, {
            credentials: "same-origin",
            headers: H,
          });
          const html = await res.text();
          box.innerHTML = html;
          box.dataset.loaded = "1";
        } catch (e) {
          console.error("MURO: error cargando seguidores:", e);
          box.innerHTML =
            '<p class="muted" style="margin:0;">No se pudo cargar la lista de seguidores.</p>';
        }
      }

      visible = !visible;
      box.style.display = visible ? "block" : "none";
      btn.textContent = visible ? "Ocultar lista" : "Ver lista";
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      loadAndToggle();
    });
  }

  // Viewer de playlists del artista (likes + públicas)
  function setupArtistPlaylistViewer() {
    const sec     = document.getElementById("artist-playlists-section");
    const wrapper = document.getElementById("artist-playlist-songs-wrapper");
    if (!sec || !wrapper) return;

    const publicPL = Array.isArray(window.__ARTIST_PUBLIC_PLAYLISTS__)
      ? window.__ARTIST_PUBLIC_PLAYLISTS__
      : [];
    const likesPL =
      window.__ARTIST_LIKES_PLAYLIST__ &&
      typeof window.__ARTIST_LIKES_PLAYLIST__ === "object"
        ? window.__ARTIST_LIKES_PLAYLIST__
        : null;

    const playlistById = new Map();
    publicPL.forEach((pl) => {
      if (pl && typeof pl.id !== "undefined") {
        playlistById.set(String(pl.id), pl);
      }
    });
    if (likesPL && typeof likesPL.id !== "undefined") {
      playlistById.set(String(likesPL.id), likesPL);
    }

    function setActivePlaylistCard(plId) {
      const cards  = sec.querySelectorAll(".artist-pl-card");
      const target = plId != null ? String(plId) : "";
      cards.forEach((c) => {
        const id = c.dataset.plId || "";
        if (target && id === target) {
          c.classList.add("is-active");
        } else {
          c.classList.remove("is-active");
        }
      });
    }

    function escapeHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function clearView() {
      wrapper.innerHTML = "";
      wrapper.style.display = "none";
    }

    function renderPlaylist(pl) {
      if (!pl) {
        clearView();
        return;
      }

      wrapper.innerHTML = "";
      wrapper.style.display = "block";

      const header = document.createElement("div");
      header.className = "artist-pl-songs-header";
      header.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 8px;">
          <h3 style="margin:0;font-size:16px;">Playlist: ${escapeHtml(pl.name || "")}</h3>
          <button type="button" class="btn btn-small" data-action="artist-pl-close">Cerrar</button>
        </div>
      `;
      wrapper.appendChild(header);

      const songs = Array.isArray(pl.songs) ? pl.songs : [];
      if (!songs.length) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = "Esta playlist no tiene canciones públicas.";
        wrapper.appendChild(p);
        return;
      }

      const grid2 = document.createElement("div");
      grid2.className = "grid artist-pl-songs-grid";

      songs.forEach((song) => {
        if (!song) return;

        const card = document.createElement("article");
        card.className = "song js-song-card";

        const title = song.title || "—";
        const artist =
          song.author || song.artist_display_name || "—";
        const genre = song.genre || "";
        const audioUrl = song.audioUrl || song.audio_url || "";
        const coverUrl = song.coverUrl || song.cover_url || "";

        if (song.id != null) card.dataset.songId = String(song.id);
        card.dataset.title = title;
        card.dataset.artist = artist;
        if (genre) card.dataset.genre = genre;
        if (audioUrl) card.dataset.audioUrl = audioUrl;
        if (coverUrl) card.dataset.coverUrl = coverUrl;

        card.innerHTML = `
          <div class="row js-song-main">
            ${
              coverUrl
                ? `<img class="preview" src="${escapeHtml(coverUrl)}" alt="Portada de ${escapeHtml(
                    title
                  )}" loading="lazy">`
                : `<div class="preview" aria-hidden="true"></div>`
            }
            <div>
              <div class="song-title" style="font-weight:600;">${escapeHtml(
                title
              )}</div>
              <div class="muted">${escapeHtml(artist)}</div>
              ${
                genre
                  ? `<div class="muted">Género: ${escapeHtml(genre)}</div>`
                  : ""
              }
            </div>
          </div>
        `;
        grid2.appendChild(card);
      });

      wrapper.appendChild(grid2);
      bindSongCardsToGlobalPlayer(wrapper);
    }

    // Click en cards de playlists
    sec.addEventListener("click", (e) => {
      const card = e.target.closest(".artist-pl-card");
      if (!card) return;

      const id = card.dataset.plId;
      if (!id) return;

      const pl = playlistById.get(String(id));
      renderPlaylist(pl);
      setActivePlaylistCard(id);
    });

    // Botón "Cerrar" del viewer
    wrapper.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action='artist-pl-close']");
      if (btn) {
        clearView();
        setActivePlaylistCard(null);
      }
    });

    // Estado inicial del viewer:
    // - Prioriza "Music that i love" si tiene canciones.
    // - En su defecto, primera playlist pública con canciones.
    let initial = null;
    if (likesPL && Array.isArray(likesPL.songs) && likesPL.songs.length) {
      initial = likesPL;
    } else {
      initial =
        publicPL.find(
          (pl) => pl && Array.isArray(pl.songs) && pl.songs.length
        ) || null;
    }

    if (initial && typeof initial.id !== "undefined") {
      renderPlaylist(initial);
      setActivePlaylistCard(String(initial.id));
    }
  }

  // Inicialización principal del muro
  function initMuro() {
    window.__MDF_FORMS_HIDE_BAR__ = false;
    document.dispatchEvent(new CustomEvent("melodify:bar:shouldShow"));

    updateUI();
    if (grid) {
      bindSongCardsToGlobalPlayer(root);
    }

    setupFollowButton();
    setupFollowersList();
    setupArtistPlaylistViewer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMuro);
  } else {
    initMuro();
  }
})();
