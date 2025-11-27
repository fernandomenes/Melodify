// static/gestion/gestion.js
// ============================================================================
// Melodify – Panel de gestión (administrador)
// Header, menú lateral, pestañas, catálogo, formularios, deshacer y playlists.
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

  function hideGestionLikeButtons() {
    document
      .querySelectorAll(
        ".song-like-btn, .cat-like-btn, .search-btn-like, [data-like-song-id]"
      )
      .forEach((el) => {
        el.style.display = "none";
      });
  }

  // ---------------------------------------------------------------------------
  // Diálogo global de confirmación (mdfConfirm)
  // ---------------------------------------------------------------------------
  if (typeof window.mdfConfirm !== "function") {
    window.mdfConfirm = function (message, opts = {}) {
      return new Promise((resolve) => {
        const prev = document.querySelector(".mdf-dialog-backdrop");
        if (prev) prev.remove();

        const backdrop = document.createElement("div");
        backdrop.className = "mdf-dialog-backdrop";
        Object.assign(backdrop.style, {
          position: "fixed",
          inset: "0",
          background: "rgba(0,0,0,0.55)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: "9999",
        });

        const dialog = document.createElement("div");
        dialog.className = "mdf-dialog";
        if (opts.className) dialog.classList.add(opts.className);
        Object.assign(dialog.style, {
          minWidth: "260px",
          maxWidth: "360px",
          background: "#181818",
          borderRadius: "14px",
          padding: "18px 20px",
          border: "1px solid rgba(255,255,255,0.12)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.7)",
          color: "#f5f5f5",
          fontFamily:
            "system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        });
        if (opts.danger) {
          dialog.style.border = "1px solid #ff4fa3";
          dialog.style.boxShadow =
            "0 0 0 1px rgba(255,79,163,0.7),0 18px 40px rgba(0,0,0,0.7)";
        }

        const titleEl = document.createElement("h3");
        titleEl.className = "mdf-dialog-title";
        titleEl.textContent = opts.title || "Confirmar acción";
        Object.assign(titleEl.style, {
          margin: "0 0 6px",
          fontSize: "15px",
          fontWeight: "600",
        });

        const textEl = document.createElement("p");
        textEl.className = "mdf-dialog-message";
        textEl.textContent = message || "";
        Object.assign(textEl.style, {
          margin: "0 0 14px",
          fontSize: "13px",
          color: "#dddddd",
        });

        const actions = document.createElement("div");
        actions.className = "mdf-dialog-actions";
        Object.assign(actions.style, {
          display: "flex",
          justifyContent: "flex-end",
          gap: "8px",
        });

        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.textContent = opts.cancelText || "Cancelar";
        cancelBtn.className = "btn btnSecondary";
        Object.assign(cancelBtn.style, {
          fontSize: "13px",
          padding: "6px 12px",
        });

        const okBtn = document.createElement("button");
        okBtn.type = "button";
        okBtn.textContent = opts.confirmText || "Aceptar";
        okBtn.className = "btn" + (opts.danger ? " btnDanger" : "");
        Object.assign(okBtn.style, {
          fontSize: "13px",
          padding: "6px 12px",
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(okBtn);
        dialog.appendChild(titleEl);
        dialog.appendChild(textEl);
        dialog.appendChild(actions);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        const cleanup = (value) => {
          resolve(value);
          backdrop.remove();
          document.removeEventListener("keydown", onKey);
        };

        const onKey = (ev) => {
          if (ev.key === "Escape") {
            ev.preventDefault();
            cleanup(false);
          } else if (ev.key === "Enter") {
            ev.preventDefault();
            cleanup(true);
          }
        };

        document.addEventListener("keydown", onKey);
        cancelBtn.addEventListener("click", () => cleanup(false));
        okBtn.addEventListener("click", () => cleanup(true));
        backdrop.addEventListener("click", (ev) => {
          if (ev.target === backdrop) cleanup(false);
        });

        setTimeout(() => okBtn.focus(), 10);
      });
    };
  }

  // ---------------------------------------------------------------------------
  // Núcleo mínimo de reproducción (MDFCore) para Gestión
  // ---------------------------------------------------------------------------
  (function setupGestionCore() {
    if (window.MDFCore) return;

    const audio = new Audio();
    audio.preload = "metadata";

    let queue = [];
    let queueCards = [];
    let index = -1;

    function dispatch(name, detail) {
      document.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function datasetToTrack(card) {
      const ds = card.dataset || {};
      return {
        id: ds.songId || null,
        title: ds.title || "—",
        author: ds.artist || "—",
        coverUrl: ds.coverUrl || "",
        audioUrl: ds.audioUrl || "",
        genre: ds.genre || "",
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

      queueCards = Array.from(root.querySelectorAll(".js-song-card"));
      queue = queueCards.map(datasetToTrack);
      index = Math.max(0, queueCards.indexOf(card));
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

      markCurrentPlaying();

      dispatch("melodify:trackmeta", {
        title: track.title,
        artist: track.author,
        cover: track.coverUrl || "",
        genre: track.genre || "",
      });

      dispatch("melodify:trackchange", {
        index,
        total: queue.length,
        id: track.id || null,
      });

      audio.play().catch(() => {});
    }

    audio.addEventListener("timeupdate", () => {
      dispatch("melodify:time", {
        currentTime: audio.currentTime || 0,
        duration: audio.duration || 0,
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
    window.__MDF_FORMS_HIDE_BAR__ = false;
    document.dispatchEvent(new CustomEvent("melodify:bar:shouldShow"));
  })();

  // ---------------------------------------------------------------------------
  // Header: avatar, nombre y menú perfil/logout
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

    if (perfil) {
      perfil.addEventListener("click", (e) => {
        e.preventDefault();
        menu?.classList.remove("show");
        location.href = `${homeURL}?view=perfil&no_spa=1`;
      });
    }

    if (logout) {
      const logoutUrl =
        logout.getAttribute("href") || logout.dataset.logoutUrl || "/logout/";
      logout.addEventListener("click", async (e) => {
        e.preventDefault();
        menu?.classList.remove("show");
        try {
          const res = await fetch(logoutUrl, {
            method: "POST",
            headers: { "X-CSRFToken": getCSRF() },
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
        }
        location.href = logoutUrl;
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Menú lateral
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

    applyCollapsed(true);

    function handleToggleClick() {
      const nowCollapsed = menuLateral.classList.contains("collapsed");
      applyCollapsed(!nowCollapsed);
    }

    btnToggle?.addEventListener("click", handleToggleClick);
    logoToggle?.addEventListener("click", handleToggleClick);
  }

  // ---------------------------------------------------------------------------
  // Mensajes inline y barra de deshacer
  // ---------------------------------------------------------------------------
  function showInlineError(msg) {
    const box = $("#inline-msg");
    if (!box) return;
    box.textContent = msg || "No se pudo completar la acción.";
    box.className = "msg error";
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

    if (window.__melodify_admin_rebind_player) {
      window.__melodify_admin_rebind_player();
    }
  }

  // ---------------------------------------------------------------------------
  // Catálogo: integración con reproductor global
  // ---------------------------------------------------------------------------
  function bindCatalogSongCardsToGlobalPlayer(scopeRoot = document) {
    const cards = scopeRoot.querySelectorAll(".js-song-card");
    if (!cards.length) return;

    cards.forEach((card) => {
      if (card.dataset.playerBound === "1") return;
      card.dataset.playerBound = "1";

      card.addEventListener("click", (ev) => {
        if (ev.target.closest('input[type="checkbox"], button, a, form')) {
          return;
        }

        const core = window.MDFCore;
        if (!core || typeof core.playFromDomItem !== "function") {
          console.warn("MDFCore.playFromDomItem no disponible en Gestión.");
          return;
        }

        core.playFromDomItem(card);

        window.__MDF_FORMS_HIDE_BAR__ = false;
        document.dispatchEvent(new CustomEvent("melodify:bar:shouldShow"));
      });
    });
  }

  function bindCatalogToPlayer() {
    const grid = document.getElementById("catalogo-grid");
    if (grid) bindCatalogSongCardsToGlobalPlayer(grid);
    else bindCatalogSongCardsToGlobalPlayer(document);
  }

  window.__melodify_admin_rebind_player = function () {
    bindCatalogToPlayer();
  };

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

    tablist.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;

      const btns = Array.from(tablist.querySelectorAll('.tab-btn[role="tab"]'));
      let i = btns.indexOf(document.activeElement);
      if (i === -1) {
        i = btns.findIndex((b) => b.getAttribute("aria-selected") === "true");
      }
      let j = i;

      if (e.key === "ArrowRight") j = (i + 1) % btns.length;
      if (e.key === "ArrowLeft") j = (i - 1 + btns.length) % btns.length;
      if (e.key === "Home") j = 0;
      if (e.key === "End") j = btns.length - 1;

      btns[j].focus();
      btns[j].click();
    });

    activateTabs((location.hash || "").slice(1) || "usuarios", false);
  }

  // ---------------------------------------------------------------------------
  // Borrado múltiple de canciones (Catálogo)
  // ---------------------------------------------------------------------------
  async function doBulkDelete(ids) {
    try {
      const fd = new FormData();
      ids.forEach((id) => fd.append("ids[]", String(id)));

      const res = await fetch("/gestion/canciones/eliminar-multiples/", {
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
      const fd = new FormData(form);
      const res = await fetch(form.action, {
        method: "POST",
        body: fd,
        headers: { ...H, "X-CSRFToken": getCSRF() },
        redirect: "follow",
        credentials: "same-origin",
      });

      const ct = (res.headers.get("content-type") || "").toLowerCase();

      if (ct.includes("application/json")) {
        const j = await res.json();

        if (j.ok === false) {
          console.error("Error al eliminar usuario:", j.error);
          showInlineError(j.error || "No se pudo completar la acción.");
          return;
        }

        if (j.undo_label) showUndo(j.undo_label);
        if (j.usuarios_html) replaceUsuariosTab(j.usuarios_html);
        if (j.catalogo_html) replaceCatalogo(j.catalogo_html);

        if (!j.usuarios_html && !j.catalogo_html) {
          const rowOrCard = form.closest(".js-song-card, tr, .song");
          if (rowOrCard) rowOrCard.remove();
        }
        return;
      }

      location.reload();
    } catch (err) {
      console.error("Fallo de red en doDelete:", err);
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
      all.checked = checks.length > 0 && checks.every((ch) => ch.checked);
      all.indeterminate = count > 0 && count < checks.length;
    }
  }

  function resetSelection() {
    selected.clear();
    const checks = $all("#catalogo-grid .song-select");
    checks.forEach((ch) => (ch.checked = false));
    updateBulkUI();
  }

  document.addEventListener("change", (e) => {
    const t = e.target;

    if (t && t.classList && t.classList.contains("song-select")) {
      const id = parseInt(t.value, 10);
      if (!isNaN(id)) {
        if (t.checked) selected.add(id);
        else selected.delete(id);
        updateBulkUI();
      }
    }

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

  document.addEventListener("click", async (e) => {
    const btn = e.target.closest("#bulk-delete");
    if (!btn) return;

    e.preventDefault();
    if (selected.size === 0) return;

    const n   = selected.size;
    const ids = Array.from(selected);
    const noun = n === 1 ? "canción seleccionada" : "canciones seleccionadas";

    const ok = await (typeof window.mdfConfirm === "function"
      ? window.mdfConfirm(`¿Eliminar ${n} ${noun}?`, {
          title: "Eliminar canciones",
          danger: true,
          confirmText: "Eliminar",
          cancelText: "Cancelar",
        })
      : Promise.resolve(window.confirm(`¿Eliminar ${n} ${noun}?`)));

    if (!ok) return;
    await doBulkDelete(ids);
  });

  // ---------------------------------------------------------------------------
  // Validación del ID de usuario
  // ---------------------------------------------------------------------------
  function validateFriendlyUserId(raw) {
    const v = (raw || "").trim();
    if (!v) {
      return "El usuario es obligatorio.";
    }

    if (v.length > 27) {
      return "Máximo 27 caracteres para el usuario.";
    }

    if (!/^[a-zA-Z0-9._áéíóúÁÉÍÓÚñÑ]+$/.test(v)) {
      return "Usa solo letras, números, punto o guion bajo.";
    }

    const letters = v.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ]/g, "");
    const vowels  = v.replace(/[^aeiouáéíóúAEIOUÁÉÍÓÚ]/g, "");
    const digits  = v.replace(/[^0-9]/g, "");

    if (letters.length >= 5 && vowels.length === 0) {
      return "sin vocales (parece código aleatorio)";
    }

    const letterRatio = letters.length / v.length;
    const digitRatio  = digits.length / v.length;

    if (v.length >= 10 && letterRatio < 0.5 && digitRatio > 0.3) {
      return "demasiados números/símbolos";
    }

    if (
      v.length >= 16 &&
      !v.includes(" ") &&
      /^[A-Za-z0-9\-_=]+$/.test(v) &&
      letterRatio > 0.7
    ) {
      return "parece un identificador (hash/UUID/base64)";
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Registro de artista/admin con barra de progreso
  // ---------------------------------------------------------------------------
  async function registerWithProgress(form) {
    const bar   = document.getElementById("upload-bar");
    const fill  = bar?.querySelector(".progress > i");
    const pctEl = document.getElementById("upload-pct");
    const submitB = form.querySelector('button[type="submit"]');

    const setPct = (p) => {
      const pct = Math.max(0, Math.min(100, p | 0));
      bar?.classList.add("is-visible");
      if (fill) fill.style.width = pct + "%";
      if (pctEl) pctEl.textContent = pct + "%";
    };

    const hideBar = () => {
      if (bar) bar.classList.remove("is-visible");
      if (fill) fill.style.width = "0%";
      if (pctEl) pctEl.textContent = "0%";
    };

    const uInput = form.querySelector('input[name="user"]');
    const pInput = form.querySelector('input[name="password"]');
    const dInput = form.querySelector('textarea[name="description"]');

    const u    = uInput?.value?.trim() || "";
    const p    = pInput?.value || "";
    const desc = dInput?.value || "";

    const userErr = validateFriendlyUserId(u);
    if (userErr) {
      showInlineError(userErr);
      uInput?.focus();
      return;
    }

    if (!p) {
      showInlineError("Completa la contraseña.");
      pInput?.focus();
      return;
    }
    if (p.length < 6) {
      showInlineError("La contraseña debe tener al menos 6 caracteres.");
      pInput?.focus();
      return;
    }

    if (desc && desc.length > 200) {
      showInlineError("La descripción no puede superar 200 caracteres.");
      dInput?.focus();
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
              if (j.undo_label) showUndo(j.undo_label);
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
  // Toast global y playlists
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

  window.__melodifyShowToast = showToast;
  window.__melodifyShowPlaylistToast = showPlaylistToast;

  // Likes deshabilitados en Gestión
  window.toggleSongLikeFromGestion = function (evt) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.stopImmediatePropagation) evt.stopImmediatePropagation();
    }
    console.info("Likes deshabilitados en Gestión.");
  };

  window.openAddToPlaylistFromGestion = function (evt, songId) {
    if (evt) {
      evt.preventDefault();
      evt.stopPropagation();
    }

    const id = String(songId || "").trim();
    if (!id) return;

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

    alert("No se encontró la UI para agregar a playlist.");
  };

  document.addEventListener("click", (e) => {
    const addBtn = e.target.closest?.(".song-add-btn[data-song-id]");
    if (addBtn) {
      const id =
        addBtn.dataset.songId || addBtn.getAttribute("data-song-id") || "";
      if (id) {
        window.openAddToPlaylistFromGestion(e, id);
      }
    }
  });

  document.addEventListener("melodify:playlist:song-added", (ev) => {
    const d = ev.detail || {};
    const name = d.playlistName || d.playlist || d.name || "";
    showPlaylistToast(true, name);
  });

  document.addEventListener("melodify:playlist:song-removed", (ev) => {
    const d = ev.detail || {};
    const name = d.playlistName || d.playlist || d.name || "";
    showPlaylistToast(false, name);
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

      // Formularios de borrado
      if (form.classList.contains("js-delete-form")) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        const t = form.dataset.title || "este elemento";

        const ok = await (typeof window.mdfConfirm === "function"
          ? window.mdfConfirm(`¿Eliminar “${t}”?`, {
              title: "Eliminar",
              danger: true,
              confirmText: "Eliminar",
              cancelText: "Cancelar",
            })
          : Promise.resolve(window.confirm(`¿Eliminar “${t}”?`)));

        if (!ok) return;
        await doDelete(form);
        return;
      }

      const isUndo =
        href.includes("/revertir_accion") || href.endsWith("/gestion/undo/");
      if (isUndo) {
        e.preventDefault();
        e.stopPropagation();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();

        try {
          const fd = new FormData(form);
          const res = await fetch(href, {
            method: "POST",
            body: fd,
            headers: { ...H, "X-CSRFToken": getCSRF() },
            redirect: "follow",
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

      const isEliminar =
        href.includes("/gestion/usuarios/eliminar/") ||
        href.includes("/gestion/canciones/eliminar/");
      const isToggle =
        href.includes("/gestion/usuarios/desactivar/") ||
        href.includes("/gestion/usuarios/activar/");
      const isRegister = /\/gestion\/registrar[-_](?:artista|admin)\/?$/i.test(
        href
      );
      const isUndoable = isEliminar || isToggle || isRegister;

      if (!isUndoable) return;

      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      clearInlineMsg();

      if (isRegister) {
        await registerWithProgress(form);
        return;
      }

      try {
        const fd = new FormData(form);
        const res = await fetch(href, {
          method: "POST",
          body: fd,
          headers: { ...H, "X-CSRFToken": getCSRF() },
          redirect: "follow",
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

          if (j.undo_label) showUndo(j.undo_label);
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
  // Filtros del catálogo (artista y texto de búsqueda)
  // ---------------------------------------------------------------------------
  function initCatalogFilters() {
    const main      = document.getElementById("main-content");
    const artistSel = document.getElementById("f-artist");
    const qInput    = document.getElementById("f-q");
    const applyBtn  = document.getElementById("f-apply");

    if (!main || (!artistSel && !qInput && !applyBtn)) return;

    const baseUrl =
      main.dataset.urlCatalogoFragment || "/gestion/catalogo/";

    async function cargarCatalogo() {
      const params = new URLSearchParams();

      if (artistSel && artistSel.value) {
        params.set("artist", artistSel.value);
      }
      if (qInput && qInput.value.trim()) {
        params.set("q", qInput.value.trim());
      }

      const qs  = params.toString();
      const url = qs ? `${baseUrl}?${qs}` : baseUrl;

      try {
        const res = await fetch(url, {
          method: "GET",
          headers: H,
          credentials: "same-origin",
        });

        if (!res.ok) {
          console.error(
            "Error al cargar catálogo filtrado:",
            res.status,
            res.statusText
          );
          window.location.href = url;
          return;
        }

        const html = await res.text();
        replaceCatalogo(html);
      } catch (err) {
        console.error("Error de red en filtro de catálogo:", err);
        window.location.href = baseUrl;
      }
    }

    if (applyBtn) {
      applyBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        cargarCatalogo();
      });
    }

    if (artistSel) {
      artistSel.addEventListener("change", () => {
        cargarCatalogo();
      });
    }

    if (qInput) {
      qInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          cargarCatalogo();
        }
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Inicialización global
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    applyHeaderIdentity();
    initHeaderMenu();
    initSideToggle();
    initTabs();
    resetSelection();
    initCatalogFilters();
    hideGestionLikeButtons();

    if (window.__melodify_admin_rebind_player) {
      window.__melodify_admin_rebind_player();
    }
  });
})();
