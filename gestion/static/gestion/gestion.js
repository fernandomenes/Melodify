// static/gestion/gestion.js
// ============================================================================
// Melodify – Panel de Gestión (administrador)
// Header, menú lateral, pestañas, catálogo, formularios y gestión de likes/playlists.
// ============================================================================

(function () {
  "use strict";

  // Marca global de inicialización
  window.__gestion_loaded__ = true;

  // ---------------------------------------------------------------------------
  // Utilidades básicas
  // ---------------------------------------------------------------------------
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const $all = $$;

  // Cabecera común para peticiones AJAX
  const H = { "X-Requested-With": "fetch" };

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

  function showLikeToast(liked) {
    const el = document.getElementById("like-toast");
    if (!el) return;

    el.textContent = liked
      ? "Añadido a tus Me gusta"
      : "Quitado de tus Me gusta";

    el.classList.add("show");
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 1400);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---------------------------------------------------------------------------
  // Núcleo mínimo de reproducción (MDFCore) para Gestión
  // ---------------------------------------------------------------------------
  (function setupGestionCore() {
    if (window.MDFCore) return;

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
        id:       ds.songId || null,
        title:    ds.title  || "—",
        author:   ds.artist || "—",
        coverUrl: ds.coverUrl || "",
        audioUrl: ds.audioUrl || "",
        genre:    ds.genre || "",
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
      const root =
        card.closest("#catalogo-grid") ||
        card.closest('[data-feed-list="songs"]') ||
        document;

      // Cola basada en elementos .js-song-card
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

  // Primero aseguramos que el <audio> ya tenga src
  if (audio.src !== track.audioUrl) {
    audio.src = track.audioUrl;
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

  audio.play().catch(() => {});
}


    // Eventos del <audio> → barra de reproducción
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
      __fromGestion: true,

      getAudio() {
        return audio;
      },

      playFromDomItem(card) {
        if (!card) return;
        buildQueueFromCard(card);
        playIndex(index);
      },

      // Métodos usados por la barra global
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

    // Extensión de MDFCore con API global (playlists, likes, diálogos)
    window.MDFCore = {
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

      // API de playlists para otras vistas (Gestión, Mi música, etc.)
      addSongToPlaylist: (playlistId, songId) =>
        _performAddSongToPlaylist(playlistId, songId),

      addSongsToPlaylistBulk: (playlistId, songIds) =>
        _bulkAddSongsToPlaylist(playlistId, songIds),

      removeSongFromPlaylist: (playlistId, songId) =>
        _performRemoveSongFromPlaylist(playlistId, songId),

      removeSongsFromPlaylistBulk: (playlistId, songIds) =>
        _bulkRemoveSongsFromPlaylist(playlistId, songIds),

      // Likes y diálogos expuestos al reproductor
      syncLikeModelFromClient: _syncLikeModelFromClient,
      toggleLikeFromReproductor: (evt, idSong) =>
        _toggleLikeFromReproductor(evt, idSong),
      openAddToPlaylistDialog: (evt, idSong) =>
        _openAddToPlaylistDialog(evt, idSong),
    };

    // Aviso global de audio listo y solicitud de mostrar la barra
    dispatch("melodify:audioReady", { audio });
    window.__MDF_FORMS_HIDE_BAR__ = false;
    document.dispatchEvent(new CustomEvent("melodify:bar:shouldShow"));
  })();

  // ---------------------------------------------------------------------------
  // Header: avatar / nombre y menú perfil / logout
  // ---------------------------------------------------------------------------
  function applyHeaderIdentity() {
    const mc   = $("#main-content");
    const name = $("#username");
    const icon = $("#user-trigger .user-icon");

    const USERNAME = (mc?.dataset.username || "Usuario").trim();
    const AVATAR   = (mc?.dataset.avatar || "").trim();

    if (name) name.textContent = USERNAME || "Usuario";

    if (icon) {
      if (AVATAR) {
        icon.innerHTML = `<img src="${escapeHtml(AVATAR)}" alt="${escapeHtml(
          USERNAME
        )}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`;
      } else {
        icon.textContent = (USERNAME || "U").charAt(0).toUpperCase();
      }
    }
  }

  function initHeaderMenu() {
    const trigger = $("#user-trigger");
    const menu    = $("#user-menu");
    const perfil  = $("#menu-perfil");
    const logout  = $("#menu-logout");
    const homeURL = window.MELODIFY_HOME_URL || "/home/";

    // Toggle del menú de usuario
    if (trigger && menu) {
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        menu.classList.toggle("show");
      });
      document.addEventListener("click", () => menu.classList.remove("show"));
      menu.addEventListener("click", (e) => e.stopPropagation());
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") menu.classList.remove("show");
      });
    }

    // Ir al perfil (versión servidor)
    if (perfil) {
      perfil.addEventListener("click", (e) => {
        e.preventDefault();
        menu?.classList.remove("show");
        location.href = `${homeURL}?view=perfil&no_spa=1`;
      });
    }

    // Logout por POST con CSRF y fallback a GET
    if (logout) {
      const logoutUrl =
        logout.getAttribute("href") || logout.dataset.logoutUrl || "/logout/";
      logout.addEventListener("click", async (e) => {
        e.preventDefault();
        menu?.classList.remove("show");
        try {
          const res = await fetch(logoutUrl, {
            method:      "POST",
            headers:     { "X-CSRFToken": getCSRF() },
            credentials: "same-origin",
          });
          if (res.redirected) {
            location.href = res.url;
            return;
          }
          if (res.ok) {
            location.href = homeURL;
            return;
          }
        } catch {
          // Fallback a GET
        }
        location.href = logoutUrl;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Toggle del menú lateral
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Toggle del menú lateral (mismo comportamiento que Home / Muro)
  // ---------------------------------------------------------------------------
  function initSideToggle() {
    const btnToggle   = $("#menu-toggle-btn");
    const logoToggle  = $("#toggle-menu");
    const menuLateral = $("#menuLateral");
    const mainContent = $("#main-content");
    const header      = $("#header");

    if (!menuLateral || !mainContent) return;

    function applyCollapsed(collapsed) {
      menuLateral.classList.toggle("collapsed", collapsed);
      mainContent.classList.toggle("menuLateral-collapsed", collapsed);
      header?.classList.toggle("menuLateral-collapsed", collapsed);
      document
        .querySelector("._mdf-player-bar")
        ?.classList.toggle("menuLateral-collapsed", collapsed);
    }

    // Estado inicial: menú colapsado
    applyCollapsed(true);

    function handleToggleClick() {
      const nowCollapsed = menuLateral.classList.contains("collapsed");
      applyCollapsed(!nowCollapsed);
    }

    // Botón ☰ y clic en el logo
    btnToggle?.addEventListener("click", handleToggleClick);
    logoToggle?.addEventListener("click", handleToggleClick);
  }


  // ---------------------------------------------------------------------------
  // Mensajes inline + barra de deshacer
  // ---------------------------------------------------------------------------
  function showInlineError(msg) {
    const box = $("#inline-msg");
    if (!box) return;
    box.textContent   = msg || "No se pudo completar la acción.";
    box.className     = "msg error";
    box.style.display = "block";
  }

  function clearInlineMsg() {
    const box = $("#inline-msg");
    if (box) box.style.display = "none";
  }

  function showUndo(label) {
    const bar = $("#undo-bar");
    const lbl = $("#undo-label");
    if (lbl) lbl.textContent = label || "Acción realizada.";
    if (bar) bar.style.display = "flex";
  }

  function hideUndo() {
    const bar = $("#undo-bar");
    const lbl = $("#undo-label");
    if (lbl) lbl.textContent = "";
    if (bar) bar.style.display = "none";
  }

  // ---------------------------------------------------------------------------
  // Reemplazos parciales (pestaña Usuarios / Catálogo)
  // ---------------------------------------------------------------------------
  function replaceUsuariosTab(html) {
    if (!html) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();

    const fresh = wrap.querySelector("#tab-usuarios");
    const old   = $("#tab-usuarios");

    if (fresh && old) old.replaceWith(fresh);

    const tabBtn = $('.tab-btn[data-tab="usuarios"]');
    if (tabBtn) tabBtn.setAttribute("aria-selected", "true");
  }

  function replaceCatalogo(html) {
    const cont = $("#catalogo-songs");
    if (!cont || typeof html !== "string") return;

    const wrap = document.createElement("div");
    wrap.innerHTML = html.trim();

    const fresh = wrap.querySelector("#catalogo-grid") || wrap.firstElementChild;
    const old   = cont.querySelector("#catalogo-grid");

    if (fresh) {
      if (old) old.replaceWith(fresh);
      else cont.innerHTML = html;
    } else {
      cont.innerHTML = html;
    }

    resetSelection();

    // Reenlaza las tarjetas del catálogo con el reproductor global
    if (window.__melodify_admin_rebind_player) {
      window.__melodify_admin_rebind_player();
    }
  }

  // ---------------------------------------------------------------------------
  // Catálogo: integración con reproductor global (MDFCore + barra)
  // ---------------------------------------------------------------------------
  function bindCatalogSongCardsToGlobalPlayer(scopeRoot = document) {
    const cards = scopeRoot.querySelectorAll(".js-song-card");
    if (!cards.length) return;

    cards.forEach((card) => {
      // Evita registrar varias veces el mismo listener
      if (card.dataset.playerBound === "1") return;
      card.dataset.playerBound = "1";

      card.addEventListener("click", (ev) => {
        // No reproducir si el click fue en controles interactivos
        if (ev.target.closest('input[type="checkbox"], button, a, form')) {
          return;
        }

        const core = window.MDFCore;
        if (!core || typeof core.playFromDomItem !== "function") {
          console.warn("MDFCore.playFromDomItem no disponible en Gestión.");
          return;
        }

        core.playFromDomItem(card);

        // Solicita mostrar la barra de reproducción
        window.__MDF_FORMS_HIDE_BAR__ = false;
        document.dispatchEvent(new CustomEvent("melodify:bar:shouldShow"));
      });
    });
  }

  function bindCatalogToPlayer() {
    const grid = document.getElementById("catalogo-grid");
    if (grid) bindCatalogSongCardsToGlobalPlayer(grid);
    else      bindCatalogSongCardsToGlobalPlayer(document);
  }

  // Función global para re-enlazar catálogo cuando cambie por AJAX
  window.__melodify_admin_rebind_player = function () {
    bindCatalogToPlayer();
  };

  // Enlaza catálogo cuando el módulo del reproductor está listo
  window.addEventListener("melodify:player-module-ready", () => {
    bindCatalogToPlayer();
  });

  // ---------------------------------------------------------------------------
  // Tabs (Usuarios / Catálogo)
  // ---------------------------------------------------------------------------
  function activateTabs(tabName, push = true) {
    const tablist = $('.tabs[role="tablist"]');
    if (!tablist) return;

    tablist.querySelectorAll('.tab-btn[role="tab"]').forEach((b) => {
      const on = b.dataset.tab === tabName;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
    });

    $$('.tab[role="region"]').forEach((p) => {
      const show = p.id === "tab-" + tabName;
      p.classList.toggle("active", show);
      p.hidden = !show;
    });

    if (push) {
      const u = new URL(location.href);
      u.hash = tabName;
      history.replaceState(null, "", u);
    }
  }

  function initTabs() {
    const tablist = $('.tabs[role="tablist"]');
    if (!tablist) return;

    tablist.addEventListener("click", (e) => {
      const btn = e.target.closest('.tab-btn[role="tab"]');
      if (!btn) return;
      e.preventDefault();
      activateTabs(btn.dataset.tab);
    });

    // Navegación por teclado entre pestañas
    tablist.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;

      const btns = Array.from(tablist.querySelectorAll('.tab-btn[role="tab"]'));
      let i = btns.indexOf(document.activeElement);
      if (i === -1) {
        i = btns.findIndex((b) => b.getAttribute("aria-selected") === "true");
      }
      let j = i;

      if (e.key === "ArrowRight") j = (i + 1) % btns.length;
      if (e.key === "ArrowLeft")  j = (i - 1 + btns.length) % btns.length;
      if (e.key === "Home")       j = 0;
      if (e.key === "End")        j = btns.length - 1;

      btns[j].focus();
      btns[j].click();
    });

    activateTabs((location.hash || "").slice(1) || "usuarios", false);
  }

  // ---------------------------------------------------------------------------
  // Modal de confirmación (borrado individual / múltiple)
  // ---------------------------------------------------------------------------
  const modal = $("#confirm-modal");
  const txt   = $("#confirm-text");

  let pendingForm    = null; // HTMLFormElement pendiente de confirmación
  let pendingBulkIds = null; // IDs para borrado múltiple

  function openModal(message) {
    if (!modal) return false;
    if (txt) txt.textContent = message || "¿Eliminar este elemento?";
    modal.classList.add("show");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => $("#confirm-accept")?.focus(), 0);
    return true;
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("show");
    modal.setAttribute("aria-hidden", "true");
  }

  // Clic fuera del diálogo → cerrar
  modal?.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  // Botones de aceptar/cancelar del modal (delegación global)
  document.addEventListener("click", async (e) => {
    const accept = e.target.closest?.("#confirm-accept");
    if (accept) {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (pendingForm) {
          await doDelete(pendingForm);
          pendingForm = null;
        } else if (pendingBulkIds && pendingBulkIds.length) {
          await doBulkDelete(pendingBulkIds);
          pendingBulkIds = null;
        }
      } finally {
        closeModal();
      }
      return;
    }

    const cancel = e.target.closest?.("#confirm-cancel");
    if (cancel) {
      e.preventDefault();
      e.stopPropagation();
      pendingForm    = null;
      pendingBulkIds = null;
      closeModal();
    }
  });

  // ---------------------------------------------------------------------------
  // Borrado múltiple de canciones (Catálogo)
  // ---------------------------------------------------------------------------
  async function doBulkDelete(ids) {
    try {
      const fd = new FormData();
      ids.forEach((id) => fd.append("ids[]", String(id)));

      const res = await fetch("/gestion/canciones/eliminar-multiples/", {
        method:      "POST",
        body:        fd,
        headers:     { ...H, "X-CSRFToken": getCSRF() },
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("application/json")) {
        location.reload();
        return;
      }

      const j = await res.json();
      if (!j.ok) {
        showInlineError(j.error || "No fue posible eliminar las canciones.");
        return;
      }

      if (j.undo_label) showUndo(j.undo_label);
      if (j.catalogo_html) {
        replaceCatalogo(j.catalogo_html);
      } else {
        (j.removed_ids || []).forEach((id) => {
          const card = document.querySelector(
            `.js-song-card[data-song-id="${id}"]`
          );
          if (card) card.remove();
        });
      }
    } catch {
      location.reload();
    } finally {
      resetSelection();
    }
  }

  // ---------------------------------------------------------------------------
  // Borrado individual (usuarios / canciones)
  // ---------------------------------------------------------------------------
  async function doDelete(form) {
    try {
      const fd  = new FormData(form);
      const res = await fetch(form.action, {
        method:      "POST",
        body:        fd,
        headers:     { ...H, "X-CSRFToken": getCSRF() },
        redirect:    "follow",
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();

      if (ct.includes("application/json")) {
        const j = await res.json();
        if (j.ok === false) {
          showInlineError(j.error || "No se pudo completar la acción.");
          return;
        }

        if (j.undo_label)    showUndo(j.undo_label);
        if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
        if (j.catalogo_html) replaceCatalogo(j.catalogo_html);

        // Si no hay HTML devuelto, elimina la fila/tarjeta asociada
        if (!j.usuarios_html && !j.catalogo_html) {
          const rowOrCard = form.closest(".js-song-card, tr, .song");
          if (rowOrCard) rowOrCard.remove();
        }
        return;
      }

      // Si no hay JSON, recarga
      location.reload();
    } catch {
      location.reload();
    }
  }

  // ---------------------------------------------------------------------------
  // Selección múltiple en el catálogo
  // ---------------------------------------------------------------------------
  const selected = new Set();

  function updateBulkUI() {
    const btn   = $("#bulk-delete");
    const count = selected.size;

    if (btn) btn.disabled = count === 0;

    const sc = $("#sel-count");
    if (sc) {
      sc.textContent = count
        ? `${count} seleccionada${count !== 1 ? "s" : ""}`
        : "";
    }

    const all = $("#sel-all");
    if (all) {
      const checks = $all("#catalogo-grid .song-select");
      all.checked       = checks.length > 0 && checks.every((ch) => ch.checked);
      all.indeterminate = count > 0 && count < checks.length;
    }
  }

  function resetSelection() {
    selected.clear();
    const checks = $all("#catalogo-grid .song-select");
    checks.forEach((ch) => (ch.checked = false));
    updateBulkUI();
  }

  // Checkboxes individuales + "seleccionar todo"
  document.addEventListener("change", (e) => {
    const t = e.target;

    // Checkbox de una canción
    if (t && t.classList && t.classList.contains("song-select")) {
      const id = parseInt(t.value, 10);
      if (!isNaN(id)) {
        if (t.checked) selected.add(id);
        else selected.delete(id);
        updateBulkUI();
      }
    }

    // Checkbox "seleccionar todo"
    if (t && t.id === "sel-all") {
      const checks = $all("#catalogo-grid .song-select");
      checks.forEach((ch) => {
        ch.checked = t.checked;
        const id = parseInt(ch.value, 10);
        if (!isNaN(id)) {
          if (t.checked) selected.add(id);
          else selected.delete(id);
        }
      });
      updateBulkUI();
    }
  });

  // Botón "Eliminar seleccionadas"
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("#bulk-delete");
    if (!btn) return;

    e.preventDefault();
    if (selected.size === 0) return;

    const n    = selected.size;
    const ids  = Array.from(selected);
    const noun = n === 1 ? "canción seleccionada" : "canciones seleccionadas";

    if (openModal(`¿Eliminar ${n} ${noun}?`)) {
      pendingBulkIds = ids;
      return;
    }

    // Fallback con confirm nativo
    if (!window.confirm(`¿Eliminar ${n} ${noun}?`)) return;
    await doBulkDelete(ids);
  });

  // ---------------------------------------------------------------------------
  // Intercepción de formularios con soporte de deshacer
  // ---------------------------------------------------------------------------
  document.addEventListener(
    "submit",
    async (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      const href = form.action || "";

      // Formularios de borrado con modal (usuarios/canciones)
      if (form.classList.contains("js-delete-form")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        const t = form.dataset.title || "este elemento";
        pendingForm = form;

        if (!openModal(`¿Eliminar “${t}”?`)) {
          if (window.confirm(`¿Eliminar “${t}”?`)) {
            await doDelete(form);
          }
        }
        return;
      }

      // Botón "Deshacer"
      const isUndo =
        href.includes("/revertir_accion") || href.endsWith("/gestion/undo/");
      if (isUndo) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        try {
          const fd  = new FormData(form);
          const res = await fetch(href, {
            method:      "POST",
            body:        fd,
            headers:     { ...H, "X-CSRFToken": getCSRF() },
            redirect:    "follow",
            credentials: "same-origin",
          });

          const ct = (res.headers.get("content-type") || "").toLowerCase();
          if (ct.includes("application/json")) {
            const j = await res.json();
            hideUndo();
            if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
            if (j.catalogo_html) replaceCatalogo(j.catalogo_html);
            return;
          }

          hideUndo();
          location.reload();
        } catch {
          hideUndo();
          location.reload();
        }
        return;
      }

      // Acciones administrables: eliminar, activar/desactivar, registrar
      const isEliminar =
        href.includes("/gestion/usuarios/eliminar/") ||
        href.includes("/gestion/canciones/eliminar/");
      const isToggle =
        href.includes("/gestion/usuarios/desactivar/") ||
        href.includes("/gestion/usuarios/activar/");
      const isRegister = /\/gestion\/registrar[-_](?:artista|admin)\/?$/i.test(href);
      const isUndoable = isEliminar || isToggle || isRegister;

      if (!isUndoable) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      clearInlineMsg();

      // Registro de artista/admin con barra de progreso
      if (isRegister) {
        await registerWithProgress(form);
        return;
      }

      // Eliminar / activar / desactivar con fetch
      try {
        const fd  = new FormData(form);
        const res = await fetch(href, {
          method:      "POST",
          body:        fd,
          headers:     { ...H, "X-CSRFToken": getCSRF() },
          redirect:    "follow",
          credentials: "same-origin",
        });

        if (res.status === 204) {
          hideUndo();
          return;
        }

        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) {
          const j = await res.json();

          if (j.ok === false) {
            showInlineError(j.error || "No se pudo completar la acción.");
            return;
          }

          if (j.undo_label)    showUndo(j.undo_label);
          if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
          if (j.catalogo_html) replaceCatalogo(j.catalogo_html);

          if (isEliminar && !j.usuarios_html && !j.catalogo_html) {
            const rowOrCard = form.closest(".js-song-card, tr, .song");
            if (rowOrCard) rowOrCard.remove();
          }
          return;
        }

        showInlineError("No se pudo completar la acción (valida los campos).");
      } catch {
        showInlineError("Error de red.");
      }
    },
    true
  );

  // ---------------------------------------------------------------------------
  // Registro de artista/admin con barra de progreso
  // ---------------------------------------------------------------------------
  async function registerWithProgress(form) {
    const bar     = document.getElementById("upload-bar");
    const fill    = bar?.querySelector(".progress > i");
    const pctEl   = document.getElementById("upload-pct");
    const submitB = form.querySelector('button[type="submit"]');

    const setPct = (p) => {
      const pct = Math.max(0, Math.min(100, p | 0));
      bar?.classList.add("is-visible");
      if (fill)  fill.style.width = pct + "%";
      if (pctEl) pctEl.textContent = pct + "%";
    };

    const hideBar = () => {
      if (bar)  bar.classList.remove("is-visible");
      if (fill) fill.style.width = "0%";
      if (pctEl) pctEl.textContent = "0%";
    };

    // Validaciones básicas antes de enviar
    const u = form.querySelector('input[name="user"]')?.value?.trim() || "";
    const p = form.querySelector('input[name="password"]')?.value || "";
    if (!u || !p) {
      showInlineError("Completa usuario y contraseña.");
      return;
    }
    if (p.length < 6) {
      showInlineError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    const desc = form.querySelector('textarea[name="description"]')?.value || "";
    if (desc && desc.length > 200) {
      showInlineError("La descripción no puede superar 200 caracteres.");
      return;
    }

    clearInlineMsg();

    const fd   = new FormData(form);
    const xhr  = new XMLHttpRequest();
    const csrf = getCSRF();

    xhr.open("POST", form.action, true);
    if (csrf) xhr.setRequestHeader("X-CSRFToken", csrf);
    xhr.setRequestHeader("X-Requested-With", "fetch");

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setPct((ev.loaded / ev.total) * 100);
      else setPct(15);
    };
    xhr.onloadstart = () => {
      submitB?.setAttribute("aria-busy", "true");
      setPct(0);
    };
    xhr.onerror = xhr.onabort = () => {
      hideBar();
      submitB?.removeAttribute("aria-busy");
      showInlineError("No se pudo registrar. Revisa tu conexión e inténtalo de nuevo.");
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setPct(100);
        const ct = (xhr.getResponseHeader("content-type") || "").toLowerCase();

        try {
          if (ct.includes("application/json")) {
            const j = JSON.parse(xhr.responseText || "{}");
            if (j.ok === false) {
              showInlineError(j.error || "No se pudo completar la acción.");
            } else {
              if (j.undo_label)    showUndo(j.undo_label);
              if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
              form.reset();
            }
          } else {
            location.reload();
            return;
          }
        } catch {
          location.reload();
          return;
        }

        setTimeout(() => {
          hideBar();
          submitB?.removeAttribute("aria-busy");
        }, 350);
        return;
      }

      hideBar();
      submitB?.removeAttribute("aria-busy");
      showInlineError(
        "Error al registrar: " + xhr.status + " " + xhr.statusText
      );
    };

    xhr.send(fd);
  }

  // ---------------------------------------------------------------------------
  // Toast global para avisos de likes y playlists
  // ---------------------------------------------------------------------------
  function showToast(message) {
    const el = document.getElementById("like-toast");
    if (!el) return;

    el.textContent = message || "";
    el.classList.add("show");

    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.classList.remove("show");
    }, 1400);
  }

  // Mensaje específico para likes de canciones
  function showLikeToast(liked) {
    showToast(
      liked ? "Añadido a tus Me gusta" : "Quitado de tus Me gusta"
    );
  }

  // Mensaje específico para playlists
  function showPlaylistToast(added, playlistName) {
    const nombre = (playlistName || "").trim();

    if (added) {
      showToast(
        nombre
          ? `Añadida a la playlist “${nombre}”`
          : "Añadida a una playlist"
      );
    } else {
      showToast(
        nombre
          ? `Quitada de la playlist “${nombre}”`
          : "Quitada de la playlist"
      );
    }
  }

  // Helpers globales para reutilizar toasts desde otros módulos
  window.__melodifyShowToast = showToast;
  window.__melodifyShowPlaylistToast = showPlaylistToast;

  // ---------------------------------------------------------------------------
  // Likes y playlists desde Gestión (delegados al core global del reproductor)
  // ---------------------------------------------------------------------------

  // Actualiza botones de like de una canción sin cambiar su estilo visual
  function _updateGestionLikeButtons(id, liked) {
    const selector = [
      `.song-like-btn[data-song-id="${id}"]`,
      `.cat-like-btn[data-song-id="${id}"]`,
      `.search-btn-like[data-song-id="${id}"]`,
      `[data-like-song-id="${id}"]`,
    ].join(", ");

    document.querySelectorAll(selector).forEach((btn) => {
      if (!btn) return;

      // Estado lógico
      btn.dataset.liked = liked ? "1" : "0";
      btn.setAttribute("aria-pressed", liked ? "true" : "false");

      // Icono original (se guarda una sola vez)
      const originalIcon =
        btn.dataset.iconOriginal ||
        (btn.textContent || "").trim() ||
        "♡";

      btn.dataset.iconOriginal = originalIcon;

      // Se mantiene el aspecto inicial
      btn.textContent = originalIcon;
      btn.classList.remove("is-liked", "active");
    });
  }

  // Toggle de like desde Gestión (botones del catálogo)
  window.toggleSongLikeFromGestion = function (evt, songId, btn) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
    }

    if (!btn && evt && evt.target) {
      btn = evt.target.closest(".song-like-btn[data-song-id]");
    }

    const rawId =
      songId ||
      (btn && (btn.dataset.songId || btn.getAttribute("data-song-id"))) ||
      "";
    const id = String(rawId || "").trim();
    if (!id) return;

    const csrftoken = getCSRF() || "";

    fetch(`/api/like/song/${encodeURIComponent(id)}/`, {
      method: "POST",
      headers: {
        "X-CSRFToken": csrftoken,
        "X-Requested-With": "XMLHttpRequest",
      },
      credentials: "same-origin",
    })
      .then((res) => res.json())
      .then((data) => {
        const liked = !!data.liked;

        // Actualiza todos los botones de esa canción
        _updateGestionLikeButtons(id, liked);

        // Feedback visual
        showLikeToast(liked);

        // Sincroniza con MDFCore si está disponible
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
              id,
              title: ds.title || "",
              artist: ds.artist || "",
              audioUrl: ds.audioUrl || "",
              coverUrl: ds.coverUrl || "",
              genre: ds.genre || "",
            };
          }
          try {
            window.MDFCore.syncLikeModelFromClient(id, liked, meta);
          } catch (err) {
            console.warn(
              "No se pudo sincronizar likes con MDFCore (Gestión):",
              err
            );
          }
        }

      })
      .catch((err) => {
        console.error("Error al dar like desde Gestión:", err);
      });
  };

  // Wrapper para HTML que use onclick="openAddToPlaylistFromGestion(...)"
  window.openAddToPlaylistFromGestion = function (evt, songId) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }

    const id = String(songId || "").trim();
    if (!id) return;

    // UI overlay global si la expone el reproductor
    if (typeof window.openAddToPlaylistForSong === "function") {
      window.openAddToPlaylistForSong(id);
      return;
    }

    // Helper expuesto por MDFCore
    if (
      window.MDFCore &&
      typeof window.MDFCore.openAddToPlaylistDialog === "function"
    ) {
      window.MDFCore.openAddToPlaylistDialog(evt, id);
      return;
    }

    // Fallback mínimo
    alert("No se encontró la UI para agregar a playlist.");
  };

  // Delegación global de clicks para corazones y botón "+"
  document.addEventListener("click", (e) => {
    // Corazón (like)
    const likeBtn = e.target.closest(".song-like-btn[data-song-id]");
    if (likeBtn) {
      const id =
        likeBtn.dataset.songId || likeBtn.getAttribute("data-song-id") || "";
      if (id) {
        window.toggleSongLikeFromGestion(e, id, likeBtn);
      }
      return;
    }

    // Botón "+"
    const addBtn = e.target.closest(".song-add-btn[data-song-id]");
    if (addBtn) {
      const id =
        addBtn.dataset.songId || addBtn.getAttribute("data-song-id") || "";
      if (id) {
        window.openAddToPlaylistFromGestion(e, id);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Hooks para playlists (eventos globales disparados desde otros módulos)
  // ---------------------------------------------------------------------------

  // Cuando se agrega una canción a una playlist
  document.addEventListener("melodify:playlist:song-added", (ev) => {
    const d = ev.detail || {};
    const name = d.playlistName || d.playlist || d.name || "";
    showPlaylistToast(true, name);
  });

  // Cuando se elimina una canción de una playlist
  document.addEventListener("melodify:playlist:song-removed", (ev) => {
    const d = ev.detail || {};
    const name = d.playlistName || d.playlist || d.name || "";
    showPlaylistToast(false, name);
  });

  // ---------------------------------------------------------------------------
  // Init global
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    applyHeaderIdentity();
    initHeaderMenu();
    initSideToggle();
    initTabs();
    resetSelection();

    // Enlaza el catálogo inicial con el reproductor global
    if (window.__melodify_admin_rebind_player) {
      window.__melodify_admin_rebind_player();
    }
  });
})();
