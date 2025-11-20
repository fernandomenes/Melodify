// static/muro/muro.js
// Muro del artista: reproducción básica, selección, borrado, subida, likes y playlists.

(function () {
  "use strict";

  // Helpers DOM y CSRF
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

  // Reproductor usado en el muro (stub o MDFCore)
  let muroPlayer = null;

  // Toast local de likes / playlists
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
      const root = card.closest("#songs-grid") || document;
      queueCards = Array.from(root.querySelectorAll(".js-song-card"));
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

    // Eventos del <audio> interno
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

    // API mínima MDFCore para el muro
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

  // Elementos del muro
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
    bulkDelete: main?.dataset?.urlMuroBulk     || "/mi-muro/canciones/eliminar-multiples/",
    undo:       main?.dataset?.urlRevertirMuro || "/mi-muro/undo/",
  };

  // Barra de "Deshacer"
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

  // Selección de canciones
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

  // Checkboxes (selección múltiple)
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

  // Undo
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
          bindSongCardsToGlobalPlayer(grid);
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

  // Menú lateral (mismo comportamiento que en Home, pero local al muro)
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

    // Estado inicial: barra lateral OCULTA (colapsada)
    applyCollapsed(true);

    function handleToggleClick() {
      const nowCollapsed = menuLateral.classList.contains("collapsed");
      applyCollapsed(!nowCollapsed);
    }

    // Botón ☰ y logo de la barra lateral
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
          // fallback
        }
        location.href = url;
      });
    }
  })();

  // Subida de canción con barra de progreso (subida normal)
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

      // limpia mensaje previo
      showInlineMsg("", "error");

      const fd   = new FormData(form);
      const xhr  = new XMLHttpRequest();
      const csrf = getCSRF();

      xhr.open("POST", form.action, true);
      if (csrf) xhr.setRequestHeader("X-CSRFToken", csrf);
      // Marcamos como "fetch" para que el backend devuelva JSON
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
          // En éxito simplemente recargamos para ver la nueva canción en el grid
          setTimeout(() => location.reload(), 500);
          return;
        }

        // Error: quitar barra y re-habilitar botón
        btn?.removeAttribute("disabled");
        bar?.classList.remove("is-visible");

        if (data && typeof data.error === "string" && data.error) {
          // Mensaje de validación del backend (título inválido, duplicado, etc.)
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

  // Likes desde el muro (sin estilos especiales)
  window.toggleSongLikeFromMuro = function (evt, songId, btn) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }
    if (!btn && evt && evt.target) {
      btn = evt.target;
    }

    const rawId =
      songId ||
      (btn && (btn.dataset.songId || btn.getAttribute("data-song-id"))) ||
      "";
    const idNum = Number(rawId);
    if (!idNum || Number.isNaN(idNum)) return;

    if (
      window.MDFCore &&
      typeof window.MDFCore.toggleLikeFromReproductor === "function"
    ) {
      window.MDFCore.toggleLikeFromReproductor(evt, idNum, btn);
      return;
    }

    const csrftoken = getCSRF();

    fetch(`/api/like/song/${idNum}/`, {
      method: "POST",
      headers: {
        "X-CSRFToken": csrftoken || "",
        "X-Requested-With": "fetch",
      },
      credentials: "same-origin",
    })
      .then((res) => res.json())
      .then((data) => {
        const liked = !!data.liked;

        const allButtons = document.querySelectorAll(
          `.song-like-btn[data-song-id="${idNum}"]`
        );
        allButtons.forEach((b) => {
          b.dataset.liked = liked ? "1" : "0";

          const txt = (b.textContent || "").trim();
          if (txt === "♥" || txt === "♡" || txt === "") {
            b.textContent = "♡";
          }
        });

        showLikeToast(
          liked ? "Añadida a tus Me gusta" : "Quitada de tus Me gusta"
        );

        if (
          window.MDFCore &&
          typeof window.MDFCore.syncLikeModelFromClient === "function"
        ) {
          let meta = null;
          const row =
            (btn && btn.closest && btn.closest(".js-song-card")) || null;
          if (row) {
            const ds = row.dataset || {};
            meta = {
              id:       ds.songId   || String(idNum),
              title:    ds.title    || "",
              artist:   ds.artist   || "",
              audioUrl: ds.audioUrl || "",
              coverUrl: ds.coverUrl || "",
              genre:    ds.genre    || "",
            };
          }
          try {
            window.MDFCore.syncLikeModelFromClient(String(idNum), liked, meta);
          } catch (err) {
            console.warn("No se pudo sincronizar likes con MDFCore (muro):", err);
          }
        }
      })
      .catch((err) => {
        console.error("Error al dar like a la canción desde el muro:", err);
      });
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

  // Init del muro
  function initMuro() {
    window.__MDF_FORMS_HIDE_BAR__ = false;
    document.dispatchEvent(new CustomEvent("melodify:bar:shouldShow"));
    updateUI();
    if (grid) {
      bindSongCardsToGlobalPlayer(root);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMuro);
  } else {
    initMuro();
  }
})();
