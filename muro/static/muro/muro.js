// static/muro/muro.js
// ============================================================================
// Melodify — Muro del artista
// Lógica del muro del artista:
//   - Reproducción básica (cola local con <audio>) si no existe MDFCore.
//   - Selección de canciones (checkboxes) y borrado individual/múltiple con undo.
//   - Subida de canción con barra de progreso.
//   - Likes desde el muro (sin romper el núcleo MDFCore).
//   - Apertura de diálogo para agregar a playlists.
//   - Manejo básico de menú lateral y menú de usuario.
// ============================================================================

(function () {
  "use strict";

  // ============================= Utilidades DOM / CSRF =============================
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

  // ========================= Toast local de likes / playlists ======================
  let likeToastTimer = null;

  /**
   * Muestra un pequeño toast en el muro usando #like-toast (si existe).
   * No afecta al helper global de HOME, es un fallback local.
   *
   * @param {string} message - Texto a mostrar en el toast.
   */
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

  // ======================= Núcleo mínimo de reproducción (MDFCore stub) ===========
  // Si ya existe window.MDFCore (reproductor global), NO se reemplaza.
  (function setupMuroCore() {
    if (window.MDFCore) return;

    const audio = new Audio();
    audio.preload = "metadata";

    let queue      = []; // Cola de canciones normalizadas
    let queueCards = []; // Tarjetas .js-song-card asociadas a la cola
    let index      = -1; // Índice actual en la cola

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

      // Recorrido circular de la cola
      if (i < 0) i = queue.length - 1;
      if (i >= queue.length) i = 0;
      index = i;

      const track = queue[index];
      if (!track || !track.audioUrl) {
        clearPlayingClass();
        return;
      }

      markCurrentPlaying();

      // Notifica metadatos a posibles escuchas (barra global, etc.)
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

      if (audio.src !== track.audioUrl) {
        audio.src = track.audioUrl;
      }
      audio.play().catch(() => {});
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

    // API expuesta como MDFCore mínimo (solo para el muro)
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

    window.MDFCore = core;

    // Aviso para la barra global
    dispatch("melodify:audioReady", { audio });
    window.__MDF_FORMS_HIDE_BAR__ = false;
    document.dispatchEvent(new CustomEvent("melodify:bar:shouldShow"));
  })();

  // =========================== Elementos del muro ===============================
  const root = document.getElementById("muro-content");
  if (!root) return;

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

  // ============================= Barra de "Deshacer" ============================
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

  // ================= Vinculación de tarjetas con el reproductor global ==========
  /**
   * Enlaza tarjetas .js-song-card con MDFCore (click en tarjeta = reproducir).
   *
   * @param {HTMLElement} [scopeRoot=document] - Nodo raíz donde buscar tarjetas.
   */
  function bindSongCardsToGlobalPlayer(scopeRoot = document) {
    const cards = scopeRoot.querySelectorAll(".js-song-card");
    if (!cards.length) return;

    cards.forEach((card) => {
      if (card.dataset.playerBound === "1") return;
      card.dataset.playerBound = "1";

      card.addEventListener("click", (ev) => {
        // No reproducir si el click fue sobre controles interactivos
        if (ev.target.closest('input[type="checkbox"], button, a, form')) {
          return;
        }

        const core = window.MDFCore;
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

  // ============================== Estado de selección ===========================
  const selected     = new Set(); // IDs de canciones seleccionadas
  const removedCache = new Map(); // id -> nodo .js-song-card eliminado

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

  // ========================= Modal de confirmación genérico =====================
  /**
   * Muestra un modal de confirmación (si existe) o window.confirm() si no.
   *
   * @param {string} texto - Mensaje a mostrar.
   * @returns {Promise<boolean>} true si el usuario confirma, false en otro caso.
   */
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

  // =================== Manejo de checkboxes (selección múltiple) ================
  root.addEventListener("change", (e) => {
    const t = e.target;
    if (!t) return;

    // Checkbox "Seleccionar todo"
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

    // Checkbox individual
    if (t.classList && t.classList.contains("song-select")) {
      const id = parseInt(t.value, 10);
      if (!isNaN(id)) {
        if (t.checked) selected.add(id);
        else selected.delete(id);
        updateUI();
      }
    }
  });

  // ================= Cache previa a la eliminación individual ===================
  // Guardamos la tarjeta por si luego se hace undo.
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

  // ================== Eliminación individual de canciones =======================
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

        // Respuesta JSON (gestión con undo en servidor)
        if (ct.includes("application/json")) {
          const j = await res.json();
          if (card) card.remove();
          showUndo(j.undo_label || `Se eliminó “${title}”.`);
          resetSelection();
          return;
        }

        // Sin contenido pero todo OK
        if (res.status === 204) {
          if (card) card.remove();
          showUndo(`Se eliminó “${title}”.`);
          resetSelection();
          return;
        }

        // Fallback recargando la página
        location.reload();
      } catch {
        location.reload();
      }
    },
    true
  );

  // ================== Eliminación múltiple (botón "Eliminar seleccionadas") =====
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

      // Eliminamos del DOM las tarjetas indicadas
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

  // ============================== Undo (revertir eliminación) ====================
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
        // Restauramos del cache local las tarjetas eliminadas
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

  // ======================= Menú lateral (colapsar / expandir) ====================
  (function menuToggle() {
    const btn    = document.getElementById("menu-toggle-btn");
    const menu   = document.getElementById("menuLateral");
    const header = document.getElementById("header");

    btn?.addEventListener("click", () => {
      menu?.classList.toggle("collapsed");
      document.getElementById("main-content")?.classList.toggle("menuLateral-collapsed");
      header?.classList.toggle("menuLateral-collapsed");
    });
  })();

  // ========================= Menú de usuario y logout vía POST ===================
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
          // Redirección de respaldo
        }
        location.href = url;
      });
    }
  })();

  // ================== Subida de canción con barra de progreso ====================
  (function singleUploadProgress() {
    const form = document.getElementById("form-upload");
    if (!form) return;

    // Campo "otro" para género
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
      // Solo si se indicó data-ajax="1" en el form
      if (form.dataset.ajax !== "1") return;
      e.preventDefault();

      const fd   = new FormData(form);
      const xhr  = new XMLHttpRequest();
      const csrf = getCSRF();

      xhr.open("POST", form.action, true);
      if (csrf) xhr.setRequestHeader("X-CSRFToken", csrf);
      xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");

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
        alert("No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.");
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setPct(100);
          setTimeout(() => location.reload(), 500);
        } else {
          btn?.removeAttribute("disabled");
          bar?.classList.remove("is-visible");
          alert("Error al subir: " + xhr.status + " " + xhr.statusText);
        }
      };

      xhr.send(fd);
    });
  })();

  // ============================= Likes desde el muro =============================
  /**
   * Marca / desmarca "Me gusta" en una canción del muro.
   *
   * Reglas visuales:
   *  - Solo se actualiza data-liked en los botones .song-like-btn de ese ID.
   *  - Se fuerza siempre el icono "♡" (sin clases de selección).
   *  - El real modelo de likes vive en MDFCore; aquí solo lo sincronizamos.
   */
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

    // Si el núcleo global sabe gestionar likes, delegamos allí
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
        "X-Requested-With": "XMLHttpRequest",
      },
      credentials: "same-origin",
    })
      .then((res) => res.json())
      .then((data) => {
        const liked = !!data.liked;

        // Actualizamos todos los corazones que representen esa canción en el muro
        const allButtons = document.querySelectorAll(
          `.song-like-btn[data-song-id="${idNum}"]`
        );
        allButtons.forEach((b) => {
          // Solo actualizamos el estado lógico
          b.dataset.liked = liked ? "1" : "0";

          // Nada de clases especiales ni iconos rellenados,
          // dejamos siempre el corazón vacío
          const txt = (b.textContent || "").trim();
          if (txt === "♥" || txt === "♡" || txt === "") {
            b.textContent = "♡";
          }
        });

        // Toast: Me gusta / Ya no me gusta
        showLikeToast(
          liked ? "Añadida a tus Me gusta" : "Quitada de tus Me gusta"
        );

        // Mantener sincronizado el modelo de likes en MDFCore (si existe)
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
              id:       ds.songId  || String(idNum),
              title:    ds.title   || "",
              artist:   ds.artist  || "",
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

  // ======================= Diálogo de playlists desde el muro ====================
  /**
   * Abre el diálogo de "Agregar a playlist" para una canción del muro.
   *
   * Prioridades:
   *   1) window.openAddToPlaylistForSong(id)
   *   2) window.MDFCore.openAddToPlaylistDialog(evt, id)
   *   3) alert fallback
   */
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

  // ============================== Inicialización del muro ========================
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
